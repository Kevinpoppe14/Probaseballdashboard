// Vercel Serverless Function — the deployed equivalent of serve.ps1's /api/news route (which only
// runs when someone has the dashboard open locally via start-dashboard.bat). Same job: browsers
// can't read Bing News or Google News results directly (cross-origin), so this fetches both
// server-side, merges + de-dupes them, and hands back the same JSON shape news.js already expects.
// No npm dependencies on purpose — this project has no build step, so parsing is done with regex
// instead of an XML library (RSS's structure is simple and consistent enough for that to be safe).

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function tagAny(block, localName) {
  // Matches <name>...</name> or <ns:name>...</ns:name> — Bing's RSS puts Source/Image in a
  // namespace, and regex doesn't know/care about namespace prefixes the way an XML parser would.
  const re = new RegExp(`<(?:[\\w-]+:)?${localName}[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${localName}>`, "i");
  const m = re.exec(block);
  return m ? m[1] : "";
}

function stripCdata(s) {
  const m = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(s);
  return m ? m[1] : s;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function cleanText(raw) {
  return decodeEntities(stripCdata(raw || "")).trim();
}

function stripHtml(html) {
  let t = html.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t).replace(/\s+/g, " ").trim();
  if (t.length > 260) t = t.slice(0, 257) + "...";
  return t;
}

function toIsoDate(text) {
  const d = new Date(text);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function extractItems(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) items.push(m[1]);
  return items;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Bing News (cleaner relevance).
async function bingNews(q) {
  const out = [];
  try {
    const xml = await fetchText(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`);
    for (const block of extractItems(xml)) {
      let link = cleanText(tagAny(block, "link"));
      const wrapped = /[?&]url=([^&]+)/.exec(link);
      if (wrapped) { try { link = decodeURIComponent(wrapped[1]); } catch (e) { /* keep original link */ } }
      out.push({
        title: cleanText(tagAny(block, "title")),
        url: link,
        source: cleanText(tagAny(block, "Source")),
        date: toIsoDate(cleanText(tagAny(block, "pubDate"))),
        snippet: stripHtml(cleanText(tagAny(block, "description"))),
        image: cleanText(tagAny(block, "Image")),
        kind: "article",
      });
    }
  } catch (e) { /* one source failing shouldn't sink the other */ }
  return out;
}

// Google News (broader reach).
async function googleNews(q) {
  const out = [];
  try {
    const xml = await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`);
    for (const block of extractItems(xml)) {
      const src = cleanText(tagAny(block, "source"));
      if (/Baseball Savant/i.test(src)) continue; // hundreds of per-pitch clip pages — noise
      let title = cleanText(tagAny(block, "title"));
      if (src && title.endsWith(` - ${src}`)) title = title.slice(0, -(src.length + 3));
      out.push({
        title,
        url: cleanText(tagAny(block, "link")),
        source: src,
        date: toIsoDate(cleanText(tagAny(block, "pubDate"))),
        snippet: "",
        image: "",
        kind: "article",
      });
    }
  } catch (e) { }
  return out;
}

module.exports = async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  res.setHeader("Cache-Control", "no-store");
  if (!q) { res.status(200).json({ items: [], error: "missing q" }); return; }
  try {
    const [bing, google] = await Promise.all([bingNews(q), googleNews(q)]);
    const merged = [...bing, ...google].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const seen = new Set();
    const out = [];
    for (const item of merged) {
      if (!item.title) continue;
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= 30) break;
    }
    res.status(200).json({ items: out });
  } catch (e) {
    res.status(200).json({ items: [], error: String((e && e.message) || e) });
  }
};
