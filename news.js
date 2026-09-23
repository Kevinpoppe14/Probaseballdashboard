// News page — one combined feed of articles (and video pages) about the active roster plus a list
// of extra tracked topics (the company, staff, etc.).
// /api/news pulls Bing News + Google News for each search and returns JSON — as a Vercel serverless
// function (api/news.js) on the deployed site, or via the local server (serve.ps1) when running off
// start-dashboard.bat; either way this page just calls the one URL and merges everything into a
// single newest-first feed with links out to the stories.
// Results are cached in localStorage so the page opens instantly and only re-fetches on request.
// Loaded as its own <script type="text/babel"> and exposes window.NewsPage.
(function () {
  const { useState, useMemo, useRef } = React;

  const CACHE_KEY = "dst-news-v1";
  const TOPICS_KEY = "dst-news-topics-v1";
  const STALE_MS = 3 * 60 * 60 * 1000; // "Refresh news" skips searches run in the last 3 hours
  const MAX_PER_SEARCH = 25;
  const PAGE_SIZE = 50;
  // Searched as exact phrases (no "baseball" added), shown as "topic" chips. Editable on the page.
  // "Name + word": the name must appear in the story; the extra word only steers the search toward the
  // right person (these are common names).
  const DEFAULT_TOPICS = [
    "DST Houston", "DST Performance", "Dynamic Sports Training",
    "Kevin Poppe + training", "Kevin Poppe + cubs", "Kevin Poppe + DST",
    ...["Lee Fiocchi", "Hayden Letts", "Garrett Kelly", "Rick Gannon", "Sam Knox", "Ryan Henry", "Kyle Kleeman"]
      .flatMap((n) => [`${n} + training`, `${n} + DST`]),
  ];
  const WINDOWS = [
    { key: "24h", label: "Last 24 hours", ms: 24 * 3600e3 },
    { key: "7d", label: "Last 7 days", ms: 7 * 24 * 3600e3 },
    { key: "30d", label: "Last 30 days", ms: 30 * 24 * 3600e3 },
    { key: "all", label: "Everything", ms: null },
  ];

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
      return { athletes: c.athletes || {}, topics: c.topics || {} };
    } catch (e) { return { athletes: {}, topics: {} }; }
  }
  function saveCache(cache) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* storage full or unavailable — cache just won't persist */ }
  }
  function loadTopics() {
    try {
      const t = JSON.parse(localStorage.getItem(TOPICS_KEY));
      if (Array.isArray(t)) return t;
    } catch (e) { /* fall through to defaults */ }
    return DEFAULT_TOPICS;
  }
  function saveTopics(topics) {
    try { localStorage.setItem(TOPICS_KEY, JSON.stringify(topics)); } catch (e) { /* ignore */ }
  }

  const isActive = (a) => (a.status || "active").toLowerCase() === "active";
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function lastNameOf(name) {
    const parts = name.trim().split(/\s+/);
    let last = parts[parts.length - 1] || "";
    if (/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(last) && parts.length > 1) last = parts[parts.length - 2];
    return last.replace(/[.,]/g, "").toLowerCase();
  }

  const textOf = (item) => `${item.title} ${item.snippet || ""}`;

  // Athletes: keep stories that name the athlete (last name) in the headline or snippet — cuts the noise
  // from common names and from roundups that only mention someone in passing.
  const mentionsAthlete = (athlete) => {
    const last = lastNameOf(athlete.name);
    return (item) => !!last && textOf(item).toLowerCase().includes(last);
  };
  // Topics: the whole phrase must appear as words ("DST Houston", not "handstand"...).
  const mentionsTopic = (topic) => {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(topic.trim()).replace(/\s+/g, "\\s+")}($|[^a-z0-9])`, "i");
    return (item) => re.test(textOf(item));
  };

  // Articles that are really video pages (MLB.com video, "Watch:" headlines, YouTube links...).
  function looksLikeVideo(item) {
    return /youtube\.com|youtu\.be|vimeo\.com|\/videos?\//i.test(item.url || "")
      || /youtube|video/i.test(item.source || "")
      || /^(watch|video)\s*[:\-–]/i.test(item.title || "")
      || /\((video|watch)\)|\[video\]/i.test(item.title || "");
  }

  async function runSearch(query, keep) {
    const res = await fetch(`/api/news?q=${encodeURIComponent(query)}`);
    if (res.status === 404) throw new Error("NO_ENDPOINT");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return (data.items || [])
      .filter((i) => i.title && i.url && keep(i))
      .slice(0, MAX_PER_SEARCH)
      .map((i) => ({
        title: i.title,
        url: i.url,
        source: i.source || "",
        date: i.date || null,
        snippet: (i.snippet || "").slice(0, 220),
        image: i.image || "",
        video: looksLikeVideo(i),
      }));
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.round(ms / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 8) return `${d}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: d > 300 ? "numeric" : undefined });
  }

  const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

  function NewsCard({ item, rosterById, onFilter }) {
    const [imgOk, setImgOk] = useState(true);
    return (
      <article className="news-card">
        {item.image && imgOk && (
          <a className="news-thumb-link" href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
            <img className="news-thumb" src={item.image} alt="" loading="lazy" onError={() => setImgOk(false)} />
          </a>
        )}
        <div className="news-body">
          <div className="news-meta">
            <span className={`news-kind ${item.video ? "video" : ""}`}>{item.video ? "Video" : "Article"}</span>
            {item.source && <span>{item.source}</span>}
            {item.date && <span title={new Date(item.date).toLocaleString()}>{timeAgo(item.date)}</span>}
          </div>
          <a className="news-title" href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
          {item.snippet && <p className="news-snippet">{item.snippet}</p>}
          <div className="news-chips">
            {item.tags.map((t) => {
              if (t.k === "a") {
                return rosterById[t.id] && (
                  <button key={`a${t.id}`} className="news-chip" title="Show only this athlete" onClick={() => onFilter(`a:${t.id}`)}>{rosterById[t.id].name}</button>
                );
              }
              return <button key={`t${t.id}`} className="news-chip topic" title="Show only this topic" onClick={() => onFilter(`t:${t.id}`)}>{t.id}</button>;
            })}
          </div>
        </div>
      </article>
    );
  }

  function NewsPage({ dataVersion }) {
    const roster = useMemo(
      () => getRoster().filter(isActive).sort((a, b) => a.name.localeCompare(b.name)),
      // eslint-disable-next-line
      [dataVersion]
    );
    const rosterById = useMemo(() => { const m = {}; roster.forEach((a) => { m[a.id] = a; }); return m; }, [roster]);

    const [topics, setTopicsState] = useState(loadTopics);
    const [editingTopics, setEditingTopics] = useState(false);
    const [newTopic, setNewTopic] = useState("");
    const [cache, setCache] = useState(loadCache);
    const [progress, setProgress] = useState(null); // { done, total, name } while refreshing
    const [error, setError] = useState("");
    const [filter, setFilter] = useState(""); // "" | "a:<athleteId>" | "t:<topic>"
    const [type, setType] = useState("all");
    const [win, setWin] = useState("7d");
    const [query, setQuery] = useState("");
    const [limit, setLimit] = useState(PAGE_SIZE);
    const stopRef = useRef(false);
    const cacheRef = useRef(cache);
    cacheRef.current = cache;

    const setTopics = (t) => { setTopicsState(t); saveTopics(t); };
    const addTopic = () => {
      const t = newTopic.trim();
      if (!t || topics.some((x) => x.toLowerCase() === t.toLowerCase())) { setNewTopic(""); return; }
      setTopics([...topics, t]);
      setNewTopic("");
    };
    const removeTopic = (t) => {
      setTopics(topics.filter((x) => x !== t));
      if (filter === `t:${t}`) setFilter("");
    };

    // Everything that gets searched: each active athlete plus each tracked topic.
    const targetFor = (kind, ref) => kind === "a"
      ? { k: "a", id: ref.id, label: ref.name, query: `"${ref.name}" baseball`, keep: mentionsAthlete(ref) }
      : (() => {
        // "Garrett Kelly + baseball": the name must appear in the story, and the extra words only steer
        // the search (useful for common names).
        const [phrase, ...extra] = ref.split("+");
        const extraWords = extra.join(" ").trim();
        return { k: "t", id: ref, label: ref, query: `"${phrase.trim()}"${extraWords ? ` ${extraWords}` : ""}`, keep: mentionsTopic(phrase) };
      })();
    const allTargets = () => [...roster.map((a) => targetFor("a", a)), ...topics.map((t) => targetFor("t", t))];
    const bucket = (t) => (t.k === "a" ? "athletes" : "topics");

    // Run searches three at a time, saving as each one arrives.
    const refresh = async (targets, force) => {
      const todo = targets.filter((t) => {
        const e = cacheRef.current[bucket(t)][t.id];
        return force || !e || Date.now() - e.fetchedAt > STALE_MS;
      });
      if (!todo.length) { setError(""); return; }
      stopRef.current = false;
      setError("");
      let next = 0;
      let done = 0;
      let failures = 0;
      setProgress({ done: 0, total: todo.length, name: todo[0].label });
      const worker = async () => {
        while (!stopRef.current) {
          const i = next++;
          if (i >= todo.length) return;
          const t = todo[i];
          try {
            const items = await runSearch(t.query, t.keep);
            setCache((prev) => {
              const updated = { ...prev, [bucket(t)]: { ...prev[bucket(t)], [t.id]: { fetchedAt: Date.now(), items } } };
              saveCache(updated);
              return updated;
            });
          } catch (e) {
            if (e.message === "NO_ENDPOINT") {
              const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
              setError(isLocal
                ? "The news feature needs the updated dashboard server. Close the dashboard's server window (the black one) and start it again with start-dashboard.bat, then reload this page."
                : "The news feature isn't available on this deployment right now — let whoever manages the dashboard know.");
              stopRef.current = true;
              return;
            }
            failures++;
          }
          done++;
          setProgress({ done, total: todo.length, name: (todo[Math.min(next, todo.length - 1)] || t).label });
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      setProgress(null);
      if (failures) setError(`${failures} lookup${failures === 1 ? "" : "s"} failed (no internet, or the news source blocked the request) — try Refresh again in a bit.`);
    };

    const feed = useMemo(() => {
      const byKey = new Map();
      const add = (it, tag) => {
        const key = normTitle(it.title);
        let m = byKey.get(key);
        if (!m) { m = { ...it, tags: [] }; byKey.set(key, m); }
        if (!m.tags.some((x) => x.k === tag.k && x.id === tag.id)) m.tags.push(tag);
      };
      roster.forEach((a) => { const e = cache.athletes[a.id]; if (e) e.items.forEach((it) => add(it, { k: "a", id: a.id })); });
      topics.forEach((t) => { const e = cache.topics[t]; if (e) e.items.forEach((it) => add(it, { k: "t", id: t })); });
      const w = WINDOWS.find((x) => x.key === win);
      const cutoff = w && w.ms ? Date.now() - w.ms : null;
      const q = query.trim().toLowerCase();
      const [fk, ...fr] = filter.split(":");
      const fid = fr.join(":");
      return [...byKey.values()]
        .filter((it) => type === "all" || (type === "video") === !!it.video)
        .filter((it) => !filter || it.tags.some((t) => t.k === fk && String(t.id) === fid))
        .filter((it) => !cutoff || (it.date && new Date(it.date).getTime() >= cutoff))
        .filter((it) => !q || `${it.title} ${it.source} ${it.snippet}`.toLowerCase().includes(q))
        .sort((a, b) => (b.date ? new Date(b.date).getTime() : 0) - (a.date ? new Date(a.date).getTime() : 0));
    }, [cache, roster, topics, type, win, filter, query]);

    const fetchedTimes = [
      ...roster.map((a) => cache.athletes[a.id] && cache.athletes[a.id].fetchedAt),
      ...topics.map((t) => cache.topics[t] && cache.topics[t].fetchedAt),
    ].filter(Boolean);
    const lastRefreshed = fetchedTimes.length ? Math.max(...fetchedTimes) : null;
    const athletesCovered = new Set(feed.flatMap((it) => it.tags.filter((t) => t.k === "a").map((t) => t.id))).size;
    const topicsCovered = new Set(feed.flatMap((it) => it.tags.filter((t) => t.k === "t").map((t) => t.id))).size;
    const notFetched = roster.filter((a) => !cache.athletes[a.id]).length + topics.filter((t) => !cache.topics[t]).length;
    const showing = feed.slice(0, limit);
    const [fk, ...fr] = filter.split(":");
    const selectedTarget = !filter ? null : fk === "a" ? (rosterById[Number(fr.join(":"))] ? targetFor("a", rosterById[Number(fr.join(":"))]) : null) : targetFor("t", fr.join(":"));

    return (
      <div>
        <div className="panel">
          <h2>In the News <small>Articles and video pages about {roster.length} active athletes and {topics.length} tracked topics</small></h2>
          <div className="news-controls">
            <div className="field">
              <label>Show</label>
              <select value={filter} onChange={(e) => { setFilter(e.target.value); setLimit(PAGE_SIZE); }}>
                <option value="">Everything</option>
                <optgroup label="Athletes">
                  {roster.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}
                </optgroup>
                <optgroup label="Topics">
                  {topics.map((t) => <option key={t} value={`t:${t}`}>{t}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="field" style={{ minWidth: 200 }}>
              <label>Search</label>
              <input placeholder="Filter by headline or source..." value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE_SIZE); }} />
            </div>
            <div className="news-refresh">
              {progress ? (
                <button className="btn btn-secondary" onClick={() => { stopRef.current = true; }}>Stop</button>
              ) : (
                <React.Fragment>
                  <button className="btn btn-primary" onClick={() => refresh(allTargets(), false)} disabled={!roster.length && !topics.length}>Refresh news</button>
                  {selectedTarget && <button className="btn btn-secondary" onClick={() => refresh([selectedTarget], true)}>Refresh {selectedTarget.label.split(" ")[0]} only</button>}
                  <button className="btn btn-secondary" onClick={() => refresh(allTargets(), true)} title="Re-check everything, even if refreshed recently">Force refresh all</button>
                </React.Fragment>
              )}
            </div>
          </div>

          <div className="pill-tabs" style={{ marginTop: 6, marginBottom: 6 }}>
            {[["all", "All"], ["article", "Articles"], ["video", "Videos"]].map(([k, label]) => (
              <button key={k} className={`pill-tab ${type === k ? "active" : ""}`} onClick={() => { setType(k); setLimit(PAGE_SIZE); }}>{label}</button>
            ))}
            <span className="news-sep" />
            {WINDOWS.map((w) => (
              <button key={w.key} className={`pill-tab ${win === w.key ? "active" : ""}`} onClick={() => { setWin(w.key); setLimit(PAGE_SIZE); }}>{w.label}</button>
            ))}
          </div>

          <div className="news-topics">
            <span className="news-topics-label">Also tracking:</span>
            {topics.map((t) => (
              <span className="news-topic-tag" key={t}>
                {t}
                {editingTopics && <button title={`Stop tracking ${t}`} onClick={() => removeTopic(t)}>×</button>}
              </span>
            ))}
            {topics.length === 0 && <span className="news-topics-empty">nothing yet</span>}
            <button className="btn-link" onClick={() => setEditingTopics(!editingTopics)}>{editingTopics ? "Done" : "Edit topics"}</button>
          </div>
          {editingTopics && (
            <div className="news-topic-edit">
              <input
                placeholder="Add a name or phrase, e.g. Dynamic Sports Training"
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addTopic(); }}
              />
              <button className="btn btn-secondary" onClick={addTopic} disabled={!newTopic.trim()}>Add</button>
              <button className="btn-link" onClick={() => setTopics(DEFAULT_TOPICS)}>Reset to the original list</button>
              <span>Topics are searched as exact phrases; click Refresh news after adding one. For a common name, add a keyword after a plus sign, e.g. <em>Garrett Kelly + baseball</em>.</span>
            </div>
          )}

          {progress && (
            <div className="news-progress">
              <div className="news-progress-bar"><span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>
              <span>Checking {progress.done + 1 > progress.total ? progress.total : progress.done + 1} of {progress.total} &middot; {progress.name}</span>
            </div>
          )}
          {error && <div className="success-banner" style={{ background: "#3a1414", color: "var(--danger)", borderColor: "#5a1f1f" }}>{error}</div>}
          <p className="timestamp-note">
            {lastRefreshed ? `Last refreshed ${timeAgo(new Date(lastRefreshed).toISOString())}` : "Nothing loaded yet"}
            {notFetched > 0 && lastRefreshed ? ` · ${notFetched} not checked yet` : ""}
            {feed.length > 0
              ? ` · ${feed.length} stor${feed.length === 1 ? "y" : "ies"} about ${athletesCovered} athlete${athletesCovered === 1 ? "" : "s"}${topicsCovered ? ` and ${topicsCovered} topic${topicsCovered === 1 ? "" : "s"}` : ""}`
              : ""}
            . Sources: Bing News and Google News; results can include stories that only mention a name in passing.
          </p>
        </div>

        {showing.length > 0 ? (
          <div>
            {showing.map((it) => (
              <NewsCard key={normTitle(it.title)} item={it} rosterById={rosterById} onFilter={(v) => { setFilter(v); setLimit(PAGE_SIZE); }} />
            ))}
            {feed.length > showing.length && (
              <div style={{ textAlign: "center", margin: "16px 0" }}>
                <button className="btn btn-secondary" onClick={() => setLimit(limit + PAGE_SIZE)}>Show more ({feed.length - showing.length} more)</button>
              </div>
            )}
          </div>
        ) : (
          <div className="panel">
            <div className="empty-state">
              {!lastRefreshed
                ? "No news loaded yet — click Refresh news to look up coverage for the active roster and your tracked topics (about a minute)."
                : "Nothing matches these filters. Try a longer time window, or clear the search."}
            </div>
          </div>
        )}
      </div>
    );
  }

  window.NewsPage = NewsPage;
})();
