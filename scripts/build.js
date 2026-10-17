// Vercel build step: compiles the dashboard's JSX ahead of time, so the live site doesn't download Babel and
// translate ~10,000 lines in the browser on every visit.
//
// The repo stays exactly as it is, and still runs without a build: opened locally (serve.ps1), index.html loads
// Babel standalone and compiles its <script type="text/babel"> tags in the browser. On Vercel this runs first, on
// Vercel's own copy of the repo, and rewrites that copy:
//   - each <script type="text/babel" src="x.js"> file is compiled in place and loaded as a plain script
//   - the big inline <script type="text/babel"> block is compiled into app.js
//   - the Babel standalone tag is taken out
// The compiled scripts load in the same order and run as ordinary scripts, as Babel standalone ran them. Each
// gets ?v=<content hash> so a browser never runs an old copy after a deploy. If anything fails to compile, the
// build fails and the live site stays on the last good deploy.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const babel = require("@babel/core");

// It overwrites the JSX files with their compiled versions, which is only right on Vercel's throwaway copy. Run
// on a working copy it would replace the source, so it refuses unless it's on Vercel (or told to with --here).
if (!process.env.VERCEL && !process.argv.includes("--here")) {
  console.error("build.js rewrites the source files in place, so it only runs on Vercel. Use --here to run it on a throwaway copy.");
  process.exit(1);
}

const root = path.join(__dirname, "..");
// what Babel standalone does for data-presets="react": JSX to React.createElement, nothing else
const OPTIONS = {
  presets: [["@babel/preset-react", { runtime: "classic" }]],
  sourceType: "script",
  retainLines: true, // line numbers in an error match the source file
  babelrc: false,
  configFile: false,
};
const compile = (code, filename) => babel.transformSync(code, { ...OPTIONS, filename }).code;
const version = (code) => crypto.createHash("sha1").update(code).digest("hex").slice(0, 10);

const indexPath = path.join(root, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
const done = [];

html = html.replace(/<script type="text\/babel" data-presets="react" src="([^"]+)"><\/script>/g, (tag, src) => {
  const file = path.join(root, src);
  const out = compile(fs.readFileSync(file, "utf8"), src);
  fs.writeFileSync(file, out);
  done.push(src);
  return `<script src="${src}?v=${version(out)}"></script>`;
});

let inline = 0;
html = html.replace(/<script type="text\/babel" data-presets="react">([\s\S]*?)<\/script>/g, (tag, code) => {
  inline += 1;
  if (inline > 1) throw new Error("index.html has more than one inline JSX block; build.js only knows the one it compiles into app.js");
  const out = compile(code, "index.html (inline)");
  fs.writeFileSync(path.join(root, "app.js"), out);
  done.push("index.html inline block -> app.js");
  return `<script src="app.js?v=${version(out)}"></script>`;
});

html = html.replace(/[ \t]*<!-- Babel standalone[^\n]*-->\r?\n/, "").replace(/[ \t]*<script[^>]*@babel\/standalone[^>]*><\/script>\r?\n/, "");

if (/text\/babel|@babel\/standalone/.test(html)) throw new Error("index.html still has JSX or Babel standalone after the build");
if (!inline) throw new Error("index.html's inline JSX block wasn't found");
fs.writeFileSync(indexPath, html);
console.log(`Compiled ${done.length} scripts:\n  ${done.join("\n  ")}`);
