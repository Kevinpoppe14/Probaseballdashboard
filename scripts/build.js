// Vercel build step: compiles the dashboard's JSX ahead of time, so the live site doesn't download Babel and
// translate ~10,000 lines in the browser on every visit.
//
// The repo stays exactly as it is, and still runs without a build: opened locally (serve.ps1), index.html loads
// Babel standalone and compiles its <script type="text/babel"> tags in the browser. On Vercel this copies the
// site into public/ (what Vercel serves; vercel.json's outputDirectory) and, in that copy only:
//   - compiles each <script type="text/babel" src="x.js"> file and loads it as a plain script
//   - compiles the big inline <script type="text/babel"> block into app.js
//   - takes out the Babel standalone tag
// The compiled scripts load in the same order and run as ordinary scripts, as Babel standalone ran them. Each
// gets ?v=<content hash> so a browser never runs an old copy after a deploy. If anything fails to compile, the
// build fails and the live site stays on the last good deploy. The serverless functions in api/ are deployed by
// Vercel from the repo as before.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const babel = require("@babel/core");

const root = path.join(__dirname, "..");
const out = path.join(root, "public");
// the repo's own tooling, which isn't part of the site
const SKIP = new Set([".git", ".claude", ".vercel", "node_modules", "public", "api", "scripts", "supabase", "package.json", "package-lock.json", "vercel.json", ".gitignore", "serve.ps1", "start-dashboard.bat"]);

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

// 1. the site, copied into public/
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
fs.readdirSync(root).filter((name) => !SKIP.has(name)).forEach((name) => fs.cpSync(path.join(root, name), path.join(out, name), { recursive: true }));

// 2. the JSX in the copy, compiled
const indexPath = path.join(out, "index.html");
let html = fs.readFileSync(indexPath, "utf8");
const done = [];

html = html.replace(/<script type="text\/babel" data-presets="react" src="([^"]+)"><\/script>/g, (tag, src) => {
  const file = path.join(out, src);
  const code = compile(fs.readFileSync(file, "utf8"), src);
  fs.writeFileSync(file, code);
  done.push(src);
  return `<script src="${src}?v=${version(code)}"></script>`;
});

let inline = 0;
html = html.replace(/<script type="text\/babel" data-presets="react">([\s\S]*?)<\/script>/g, (tag, source) => {
  inline += 1;
  if (inline > 1) throw new Error("index.html has more than one inline JSX block; build.js only knows the one it compiles into app.js");
  const code = compile(source, "index.html (inline)");
  fs.writeFileSync(path.join(out, "app.js"), code);
  done.push("index.html inline block -> app.js");
  return `<script src="app.js?v=${version(code)}"></script>`;
});

html = html.replace(/[ \t]*<!-- Babel standalone[^\n]*-->\r?\n/, "").replace(/[ \t]*<script[^>]*@babel\/standalone[^>]*><\/script>\r?\n/, "");

if (/text\/babel|@babel\/standalone/.test(html)) throw new Error("index.html still has JSX or Babel standalone after the build");
if (!inline) throw new Error("index.html's inline JSX block wasn't found");
fs.writeFileSync(indexPath, html);
console.log(`Built public/ with ${done.length} compiled scripts:\n  ${done.join("\n  ")}`);
