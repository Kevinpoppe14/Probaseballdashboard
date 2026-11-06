// Video export — any of our videos made into one MP4 to download: the video with a data panel beside it (horizontal,
// for a computer or a TV: the panel on the right) or under it (vertical, for a phone: the panel along the bottom), the
// athlete's name in the panel and the DST logo in the bottom right corner. Nothing is uploaded or kept: it's drawn in
// the browser, frame by frame, and handed to the phone's or computer's downloads only when a coach asks for it.
// Used by Bullpens (bullpen_video.js: the session's pitches, each clip with its TrackMan numbers) and Motion Capture
// (mocap.js: the clip with its skeleton and numbers).
//
//   const blob = await VideoExport.render({ layout: "horizontal" | "vertical", title: { lines: [...] } | null,
//     segments: [{ url, start, end, rate, panel(g, box, info), overlay(g, rect, info) }], onProgress(text, fraction), cancelled() })
//   VideoExport.download(blob, "name.mp4")
//   VideoExport.panel(g, box, { name, sub, tag: [text, color], big: [value, unit], rows: [[label, value]], widgets: [(g, x, y, size) => {}] })
//
// Each segment plays its stretch of a video (start to end, in seconds of the file) at `rate` (0.5: half speed) and
// every frame it shows is drawn: the video fitted into its area, `overlay` over it (a skeleton, say), and `panel` into
// the panel. info is { k (which segment), t (seconds into the file), elapsed (seconds into the segment as it plays) }.
// The MP4 is made with the browser's own encoder (WebCodecs, H.264); a browser without it records the canvas as it
// plays instead (MP4 where it can, WebM otherwise).
(function () {
  const MUXER = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.min.js";
  const LOGO = "assets/dst-logo-light.png";
  const FPS = 30;

  const LAYOUTS = {
    horizontal: { W: 1920, H: 1080, video: { x: 0, y: 0, w: 1440, h: 1080 }, panel: { x: 1440, y: 0, w: 480, h: 1080 } },
    vertical: { W: 1080, H: 1920, video: { x: 0, y: 0, w: 1080, h: 1200 }, panel: { x: 0, y: 1200, w: 1080, h: 720 } },
  };

  const loaded = {};
  const script = (src) => loaded[src] || (loaded[src] = new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => { delete loaded[src]; bad(new Error("Couldn't load the video maker. Check your connection and try again.")); };
    document.head.append(s);
  }));
  let logoP = null;
  const logo = () => logoP || (logoP = new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = LOGO; }));

  const canEncode = () => typeof window.VideoEncoder === "function" && typeof window.VideoFrame === "function";
  const canRecord = () => typeof window.MediaRecorder === "function" && !!HTMLCanvasElement.prototype.captureStream;
  const supported = () => canEncode() || canRecord();
  const appleTouch = () => /iPhone|iPad|iPod/.test(navigator.userAgent || "") || (/Macintosh/.test(navigator.userAgent || "") && navigator.maxTouchPoints > 1);

  // the video into its area, whole (bars where its shape differs), or filling it (`fill`: zoomed in, the edges trimmed),
  // and where it went (beyond the area when filling; what's drawn over it is trimmed to the area the same way)
  function fit(g, v, area, fill) {
    const vw = v.videoWidth || 16, vh = v.videoHeight || 9, s = (fill ? Math.max : Math.min)(area.w / vw, area.h / vh);
    const w = vw * s, h = vh * s, x = area.x + (area.w - w) / 2, y = area.y + (area.h - h) / 2;
    g.save(); g.beginPath(); g.rect(area.x, area.y, area.w, area.h); g.clip();
    g.drawImage(v, x, y, w, h);
    g.restore();
    return { x, y, w, h, scale: s };
  }

  // ---- the panel -----------------------------------------------------------------------------------------------
  const DIM = "rgba(255,255,255,0.62)", LINE = "rgba(255,255,255,0.14)", RED = "#c8102e";
  const fitText = (g, text, maxW, size, weight) => { let s = size; do { g.font = `${weight} ${s}px "Helvetica Neue", Arial, sans-serif`; s -= 2; } while (g.measureText(text).width > maxW && s > 12); };
  function panel(g, box, p) {
    const vertical = box.w > box.h, pad = vertical ? 40 : 34;
    g.save();
    const bg = g.createLinearGradient(box.x, box.y, box.x + (vertical ? 0 : box.w), box.y + (vertical ? box.h : 0));
    bg.addColorStop(0, "#151515"); bg.addColorStop(1, "#0b0b0b");
    g.fillStyle = bg; g.fillRect(box.x, box.y, box.w, box.h);
    g.fillStyle = RED;
    if (vertical) g.fillRect(box.x, box.y, box.w, 6); else g.fillRect(box.x, box.y, 6, box.h);
    g.textBaseline = "alphabetic"; g.textAlign = "left";
    // the heading (name, date, the pitch or moment, the big number) across a horizontal panel, or down the left of a
    // vertical one with its widgets (the ball, a movement plot) beside it; the figures under it, the panel's full width
    const full = box.w - 2 * pad, colW = vertical ? Math.round(full * 0.56) : full;
    const widgets = (p.widgets || []).filter(Boolean);
    const drawWidgets = (area) => {
      const n = widgets.length, gap = 16, size = Math.max(0, Math.min((area.w - gap * (n - 1)) / n, area.h));
      if (size >= 90) widgets.forEach((wd, i) => { g.save(); wd(g, area.x + i * (size + gap), area.y, size); g.restore(); });
    };
    let x = box.x + pad, y = box.y + pad + 34;
    if (p.name) { g.fillStyle = "#fff"; fitText(g, p.name, colW, vertical ? 46 : 38, 800); g.fillText(p.name, x, y); y += vertical ? 40 : 34; }
    if (p.sub) { g.fillStyle = DIM; fitText(g, p.sub, colW, 24, 500); g.fillText(p.sub, x, y); y += 26; }
    y += 14;
    if (p.tag) {
      const [text, color] = p.tag;
      g.font = `800 ${vertical ? 34 : 30}px "Helvetica Neue", Arial, sans-serif`;
      const w = g.measureText(text).width + 28;
      g.fillStyle = color || RED; roundRect(g, x, y, w, vertical ? 50 : 46, 10); g.fill();
      g.fillStyle = "#fff"; g.fillText(text, x + 14, y + (vertical ? 36 : 33));
      if (p.tagNote) { g.fillStyle = DIM; g.font = `600 22px "Helvetica Neue", Arial, sans-serif`; g.fillText(p.tagNote, x + w + 14, y + (vertical ? 34 : 31)); }
      y += vertical ? 64 : 58;
    }
    if (p.big) {
      const [value, unit] = p.big;
      g.fillStyle = "#fff"; g.font = `800 ${vertical ? 100 : 92}px "Helvetica Neue", Arial, sans-serif`;
      g.fillText(String(value), x - 4, y + (vertical ? 88 : 80));
      const vw = g.measureText(String(value)).width;
      if (unit) { g.fillStyle = DIM; g.font = `700 30px "Helvetica Neue", Arial, sans-serif`; g.fillText(unit, x + vw + 10, y + (vertical ? 86 : 78)); }
      y += vertical ? 112 : 104;
    }
    if (vertical && widgets.length) drawWidgets({ x: x + colW + 24, y: box.y + pad, w: full - colW - 24, h: y - box.y - pad - 4 });
    // the figures: label over value in columns (two across a horizontal panel, four across a vertical one)
    const rows = (p.rows || []).filter((r) => r && r[1] != null && r[1] !== "");
    if (rows.length) {
      const rowW = full;
      g.strokeStyle = LINE; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + rowW, y); g.stroke();
      y += 16;
      // short labels (a pitch's): label over value in columns; long ones (a delivery's): a line each, label then value
      const up = (s) => String(s).toUpperCase();
      g.font = `700 16px "Helvetica Neue", Arial, sans-serif`;
      const wide = rows.some(([label]) => g.measureText(up(label)).width > rowW / (vertical ? 4 : 2) - 14);
      if (!wide) {
        const cols = vertical ? 4 : 2, cw = rowW / cols, rh = vertical ? 66 : 70;
        rows.forEach(([label, value], i) => {
          const cx = x + (i % cols) * cw, cy = y + Math.floor(i / cols) * rh;
          g.fillStyle = DIM; fitText(g, up(label), cw - 12, 17, 700); g.fillText(up(label), cx, cy + 18);
          g.fillStyle = "#fff"; fitText(g, String(value), cw - 12, vertical ? 34 : 32, 700); g.fillText(String(value), cx, cy + 54);
        });
        y += Math.ceil(rows.length / cols) * rh + 8;
      } else {
        const cols = vertical ? 2 : 1, gap = vertical ? 40 : 0, w = (rowW - gap * (cols - 1)) / cols, rh = vertical ? 46 : 50;
        rows.forEach(([label, value], i) => {
          const cx = x + (i % cols) * (w + gap), cy = y + Math.floor(i / cols) * rh;
          g.textAlign = "right"; g.fillStyle = "#fff"; fitText(g, String(value), w * 0.42, vertical ? 30 : 28, 700); g.fillText(String(value), cx + w, cy + 32);
          const vw = g.measureText(String(value)).width;
          g.textAlign = "left"; g.fillStyle = DIM; fitText(g, up(label), w - vw - 14, 16, 700); g.fillText(up(label), cx, cy + 30);
          g.strokeStyle = LINE; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, cy + rh - 6); g.lineTo(cx + w, cy + rh - 6); g.stroke();
        });
        y += Math.ceil(rows.length / cols) * rh + 8;
      }
    }
    // a horizontal panel's widgets: squares side by side under the figures, clear of the logo
    if (!vertical && widgets.length) drawWidgets({ x: box.x + pad, y: y + 6, w: full, h: box.y + box.h - pad - 130 - (y + 6) });
    g.restore();
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function drawLogo(g, L, im) {
    if (!im) return;
    if (L.plain) { // over the video itself: sized to it, with a soft shadow so it reads on a light background
      const s = Math.min(L.W, L.H), w = Math.round(s * 0.26), h = (im.height / im.width) * w, m = Math.round(s * 0.035);
      g.save(); g.shadowColor = "rgba(0,0,0,0.65)"; g.shadowBlur = Math.round(s * 0.02); g.globalAlpha = 0.95;
      g.drawImage(im, L.W - w - m, L.H - h - m, w, h);
      g.restore();
      return;
    }
    const w = L.W > L.H ? 280 : 300, h = (im.height / im.width) * w;
    g.globalAlpha = 0.95; g.drawImage(im, L.W - w - 30, L.H - h - 26, w, h); g.globalAlpha = 1;
  }

  // ---- making the video ------------------------------------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // A video to read frames from. It goes on the page, out of sight (Safari on an iPhone or iPad won't load one that
  // isn't), and waits for its length, then its first frame (an iPhone doesn't load the picture until it's asked for).
  // Nothing here waits forever: a browser that doesn't answer gets an error, or the next step, instead of a hang.
  async function openVideo(url) {
    const v = document.createElement("video");
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous"; // stored clips come from another origin: without this the frames couldn't be read back
    v.setAttribute("muted", ""); v.setAttribute("playsinline", "");
    v.style.cssText = "position:fixed;left:-10000px;top:0;width:4px;height:4px;opacity:0;pointer-events:none";
    document.body.append(v);
    v.src = url;
    try {
      await new Promise((ok, bad) => {
        const timer = setTimeout(() => bad(new Error("A video took too long to open. Check the connection and try again.")), 45000);
        v.addEventListener("loadedmetadata", () => { clearTimeout(timer); ok(); }, { once: true });
        v.addEventListener("error", () => { clearTimeout(timer); bad(new Error("A video wouldn't open in this browser (it needs to be an MP4 or MOV it can play).")); }, { once: true });
      });
      // some files (browser and screen recordings) don't say how long they are: running off the end makes it find out
      if (!Number.isFinite(v.duration)) {
        await new Promise((ok) => { v.ontimeupdate = () => { if (Number.isFinite(v.duration)) { v.ontimeupdate = null; ok(); } }; v.currentTime = 1e9; setTimeout(ok, 8000); });
        v.ontimeupdate = null;
      }
      await seek(v, 0.01);
      return v;
    } catch (e) { closeVideo(v); throw e; }
  }
  const closeVideo = (v) => { try { v.pause(); v.removeAttribute("src"); v.load(); v.remove(); } catch (e) { /* gone */ } };
  // to time t, once the frame there is ready (or after a few seconds, whatever happens)
  const seek = (v, t) => new Promise((ok) => {
    if (Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2) { ok(); return; }
    const done = () => { clearTimeout(timer); v.removeEventListener("seeked", done); ok(); };
    const timer = setTimeout(done, 5000);
    v.addEventListener("seeked", done);
    v.currentTime = t;
  });

  // layout "plain": the video alone at its own size (up to 1920 on its long side) with the logo in its corner, no panel
  // (an exercise library video, athlete.js); `audioFrom` (the original file) carries its sound across, for a single
  // segment played whole at its own speed
  async function render({ layout = "horizontal", fill = false, title = null, segments, audioFrom = null, onProgress = () => {}, cancelled = () => false }) {
    if (!supported()) throw new Error("This browser can't make videos. Use Chrome or Edge on a computer, or Chrome on Android, or a recent iPhone.");
    // How big: big enough that the video shows at its own resolution, not shrunk into its area (a 1080p Edgertronic clip
    // in the horizontal frame makes a 2560 x 1440 file, in the vertical one 4K), as far as this browser's encoder goes.
    // Everything is laid out in the layout's own units (1920 x 1080 or 1080 x 1920) and drawn scaled up.
    let srcW = 1920, srcH = 1080;
    try { const pv = await openVideo(segments[0].url); srcW = pv.videoWidth || srcW; srcH = pv.videoHeight || srcH; closeVideo(pv); } catch (e) { /* the segment itself will say */ }
    let L = LAYOUTS[layout] || LAYOUTS.horizontal;
    if (layout === "plain") {
      const k = Math.min(1, 1920 / Math.max(srcW, srcH)), W = 2 * Math.round((srcW * k) / 2), H = 2 * Math.round((srcH * k) / 2);
      L = { W, H, video: { x: 0, y: 0, w: W, h: H }, panel: null, plain: true };
    }
    const want = 1 / Math.min((fill ? Math.max : Math.min)(L.video.w / srcW, L.video.h / srcH), 1);
    // (on a phone, 1080p at a modest bitrate: a 4K bullpen ran to half a gigabyte, more than an iPhone will share to Photos)
    const small = isPhone();
    // An iPhone or iPad records it instead (as its camera would, in real time): what its own Safari encodes with
    // WebCodecs came out as a file the phone then wouldn't play.
    const encode = canEncode() && !(appleTouch() && canRecord());
    const SCALES = L.plain || small ? [1] : [1, 4 / 3, 2];
    let scale = SCALES.find((s) => s >= want - 0.01) || SCALES[SCALES.length - 1], cfg = null;
    const bitrateAt = (s) => Math.round((L.plain ? 8_000_000 : small ? 8_000_000 : 16_000_000) * ((L.W * s * L.H * s) / (1920 * 1080)));
    // A tall video is stored as a phone camera stores one: the picture on its side with a note to turn it upright when
    // played. iPhones (and plenty else) won't play an H.264 picture taller than about 2300, so a 4K vertical stored
    // standing up didn't play on the phone at all. (A plain video, an exercise clip, is never past 1920 tall: it's
    // stored upright, as the exercise library has always had them.)
    const turned = !L.plain && L.H > L.W;
    if (encode) {
      for (const s of SCALES.filter((x) => x <= scale).reverse()) {
        for (const codec of ["avc1.640033", "avc1.640028", "avc1.4d0033", "avc1.4d0028", "avc1.420033", "avc1.420028"]) {
          const w = Math.round(L.W * s), h = Math.round(L.H * s);
          const c = { codec, width: turned ? h : w, height: turned ? w : h, bitrate: bitrateAt(s), framerate: FPS, avc: { format: "avc" } }; // (avc: the form an MP4 file holds)
          try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch (e) { /* try the next */ }
        }
        if (cfg) { scale = s; break; }
      }
      if (!cfg) throw new Error("This browser can't encode H.264 video at this size.");
    } else scale = 1; // recorded as it plays: kept to 1080p
    const cv = document.createElement("canvas");
    cv.width = Math.round(L.W * scale); cv.height = Math.round(L.H * scale);
    const g = cv.getContext("2d");
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    const im = await logo();
    const total = segments.reduce((s, sg) => s + Math.max(0.1, ((sg.end || 0) - (sg.start || 0)) / (sg.rate || 1)), 0) || 1;
    let done = 0;

    // the encoder (or, without one, a recording of the canvas as it's drawn)
    let emit, finish, abort;
    if (encode) {
      await script(MUXER);
      const M = window.Mp4Muxer;
      // the sound, when asked for: the original's track read whole and made AAC (none, or one this browser can't
      // read or encode: the video goes without it)
      let audio = null;
      if (audioFrom && typeof AudioEncoder === "function" && typeof AudioData === "function") {
        try {
          const ac = new (window.AudioContext || window.webkitAudioContext)();
          const ab = await ac.decodeAudioData(await audioFrom.arrayBuffer());
          ac.close();
          const ch = Math.min(2, ab.numberOfChannels), acfg = { codec: "mp4a.40.2", sampleRate: ab.sampleRate, numberOfChannels: ch, bitrate: 128000 };
          if ((await AudioEncoder.isConfigSupported(acfg)).supported) audio = { ab, ch, acfg };
        } catch (e) { audio = null; }
      }
      // (on its side: the frame drawn upright is copied turned a quarter left, and the file says to turn it back right)
      const side = turned ? document.createElement("canvas") : null, sg2 = side && side.getContext("2d");
      if (side) { side.width = cv.height; side.height = cv.width; }
      const muxer = new M.Muxer({ target: new M.ArrayBufferTarget(), video: { codec: "avc", width: cfg.width, height: cfg.height, rotation: turned ? 90 : 0 }, ...(audio ? { audio: { codec: "aac", sampleRate: audio.acfg.sampleRate, numberOfChannels: audio.ch } } : {}), fastStart: "in-memory", firstTimestampBehavior: "offset" });
      let failed = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
      enc.configure(cfg);
      const addAudio = async () => {
        if (!audio) return;
        const { ab, ch, acfg } = audio, rate = acfg.sampleRate, N = 8192;
        const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failed = e; } });
        aenc.configure(acfg);
        for (let off = 0; off < ab.length; off += N) {
          const n = Math.min(N, ab.length - off), data = new Float32Array(n * ch);
          for (let c = 0; c < ch; c++) data.set(ab.getChannelData(c).subarray(off, off + n), c * n);
          const ad = new AudioData({ format: "f32-planar", sampleRate: rate, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((off / rate) * 1e6), data });
          aenc.encode(ad); ad.close();
          while (aenc.encodeQueueSize > 8) await sleep(2);
        }
        await aenc.flush(); aenc.close();
      };
      let last = -1, lastKey = -10;
      emit = async (sec) => {
        if (failed) throw failed;
        const ts = Math.round(sec * 1e6);
        if (ts <= last) return; // the same moment twice (a repeated frame): once is enough
        last = ts;
        if (side) { sg2.setTransform(1, 0, 0, 1, 0, 0); sg2.translate(0, cv.width); sg2.rotate(-Math.PI / 2); sg2.drawImage(cv, 0, 0); }
        const frame = new VideoFrame(side || cv, { timestamp: ts });
        const key = sec - lastKey >= 2;
        if (key) lastKey = sec;
        enc.encode(frame, { keyFrame: key });
        frame.close();
        while (enc.encodeQueueSize > 6) await sleep(4);
      };
      finish = async () => { await enc.flush(); await addAudio(); if (failed) throw failed; muxer.finalize(); enc.close(); return new Blob([muxer.target.buffer], { type: "video/mp4" }); };
      abort = () => { try { enc.close(); } catch (e) { /* closed */ } };
    } else {
      const type = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const rec = new MediaRecorder(cv.captureStream(FPS), { mimeType: type, videoBitsPerSecond: bitrateAt(1) });
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
      rec.start(1000);
      emit = async () => {};
      finish = () => new Promise((ok) => { rec.onstop = () => ok(new Blob(parts, { type: (type || "video/webm").split(";")[0] })); rec.stop(); });
      abort = () => { try { rec.stop(); } catch (e) { /* stopped */ } };
    }
    const realTime = !encode; // recording: the title card has to be held on screen for as long as it shows
    let tOut = 0, open = null; // open: { url, v }, the video the clips are coming from
    try {
      // a title card: who, what and when, for two seconds
      if (title) {
        g.fillStyle = "#0b0b0b"; g.fillRect(0, 0, L.W, L.H);
        g.fillStyle = RED; g.fillRect(L.W / 2 - 60, L.H / 2 - 130, 120, 6);
        g.textAlign = "center"; g.textBaseline = "alphabetic";
        (title.lines || []).forEach((line, i) => {
          g.fillStyle = i === 0 ? "#fff" : DIM;
          fitText(g, line, L.W - 120, i === 0 ? 86 : 40, i === 0 ? 800 : 600);
          g.fillText(line, L.W / 2, L.H / 2 - 40 + i * (i === 1 ? 90 : 60) + (i > 1 ? 30 : 0));
        });
        g.textAlign = "left";
        drawLogo(g, L, im);
        for (let f = 0; f < FPS * 2; f++) { await emit(tOut); tOut += 1 / FPS; if (realTime) await sleep(1000 / FPS); }
      }
      for (let k = 0; k < segments.length; k++) {
        if (cancelled()) throw new Error("cancelled");
        const sg = segments[k], rate = sg.rate || 1;
        onProgress(segments.length > 1 ? `Making the video: ${k + 1} of ${segments.length}` : "Making the video", done / total);
        // one video kept open while the clips come from it (a bullpen's are all in one long video)
        if (!open || open.url !== sg.url) { if (open) closeVideo(open.v); open = null; open = { url: sg.url, v: await openVideo(sg.url) }; }
        const v = open.v;
        try {
          const start = sg.start || 0, end = Math.min(sg.end != null ? sg.end : v.duration, v.duration || Infinity);
          if (!Number.isFinite(end)) throw new Error("Couldn't tell how long that video is. Save it as an MP4 and try again.");
          const base = tOut;
          const drawAt = async (t) => {
            g.fillStyle = "#000"; g.fillRect(0, 0, L.W, L.H);
            const rect = fit(g, v, L.video, fill);
            const info = { k, t, elapsed: (t - start) / rate };
            if (sg.overlay) { g.save(); g.beginPath(); g.rect(L.video.x, L.video.y, L.video.w, L.video.h); g.clip(); sg.overlay(g, rect, info); g.restore(); }
            if (sg.panel) sg.panel(g, L.panel, info);
            drawLogo(g, L, im);
            await emit(base + info.elapsed);
            onProgress(segments.length > 1 ? `Making the video: ${k + 1} of ${segments.length}` : "Making the video", Math.min(1, (done + info.elapsed) / total));
          };
          await seek(v, start);
          await drawAt(start);
          // stepped through, a frame of the output at a time, from `from` on: sure, but slower (each one a seek)
          const stepFrom = async (from) => { for (let t = from + rate / FPS; t < end; t += rate / FPS) { if (cancelled()) throw new Error("cancelled"); await seek(v, t); await drawAt(t); } };
          if (v.requestVideoFrameCallback && !realTime && document.visibilityState === "visible") {
            // played, each frame it shows drawn as it comes (paused while the encoder catches up; the timing comes from the
            // file's own clock, so the playback speed doesn't matter). A browser window that's hidden or behind another
            // one stops handing over frames: then the rest is stepped through instead.
            const left = await new Promise((ok, bad) => {
              let over = false, prev = start, heard = Date.now(), drawing = false;
              // Cancel answered at once, and a video that stops handing over frames (4 s with none) stepped through instead
              const watch = setInterval(() => {
                if (over) { clearInterval(watch); return; }
                if (cancelled()) { over = true; clearInterval(watch); v.pause(); bad(new Error("cancelled")); return; }
                if (!drawing && Date.now() - heard > 4000) stop(prev);
              }, 500);
              const stop = (rest) => { if (over) return; over = true; clearInterval(watch); v.pause(); ok(rest); };
              const onFrame = async (now, meta) => {
                if (over) return;
                heard = Date.now();
                if (cancelled()) { over = true; clearInterval(watch); v.pause(); bad(new Error("cancelled")); return; }
                const t = meta.mediaTime;
                if (t >= end - 1e-3) { stop(null); return; }
                if (t - prev > 3 / FPS) { stop(prev); return; } // frames being skipped
                v.pause();
                drawing = true;
                try { await drawAt(t); } catch (e) { over = true; clearInterval(watch); bad(e); return; } finally { drawing = false; heard = Date.now(); }
                prev = t;
                if (over) return;
                v.requestVideoFrameCallback(onFrame);
                v.play().catch(() => stop(prev));
              };
              v.requestVideoFrameCallback(onFrame);
              v.onended = () => stop(prev >= end - 2 / FPS ? null : prev); // ended without its frames reaching the clip's end: step through the rest
              v.play().catch(() => stop(prev));
            });
            if (left != null) await stepFrom(left);
          } else if (realTime) {
            // recording: played in real time at the speed chosen, drawn on every animation frame
            v.playbackRate = rate;
            await new Promise((ok) => {
              const tick = async () => { if (cancelled() || v.ended || v.currentTime >= end - 1e-3) { v.pause(); ok(); return; } await drawAt(v.currentTime); requestAnimationFrame(tick); };
              v.play().then(() => requestAnimationFrame(tick), ok);
            });
          } else await stepFrom(start); // no frame callbacks, or a hidden page
          tOut = base + (end - start) / rate;
          done += (end - start) / rate;
        } finally { v.pause(); }
      }
      if (open) { closeVideo(open.v); open = null; }
      await emit(tOut); // the last frame held to the end
      onProgress("Finishing…", 1);
      return await finish();
    } catch (e) { if (open) closeVideo(open.v); abort(); throw e; }
  }

  // to the phone's or computer's downloads (a phone that can share files offers its share sheet: Save Video there
  // puts it in the camera roll)
  // A phone only opens its share sheet straight after a tap, and making a video takes longer than that: so on a phone
  // the share sheet is tried, and when the phone says no (NotAllowedError) it returns "tap" without downloading, for
  // the caller to show a Save button whose own tap opens the sheet. Otherwise it returns "done".
  let shareError = ""; // why the phone's last share didn't go through, in its own words
  async function download(blob, name, { share = false } = {}) {
    // just the file, marked as video: given a title or text alongside it, an iPhone leaves Save Video out of the sheet
    const type = /webm/.test(blob.type || "") ? "video/webm" : "video/mp4";
    const file = typeof File === "function" ? new File([blob], name, { type }) : null;
    if (share && file && !(navigator.canShare && navigator.canShare({ files: [file] }))) shareError = navigator.canShare ? `This phone won't share a video this size (${Math.round(blob.size / 1048576)} MB).` : "This browser can't share files.";
    if (share && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      shareError = "";
      try { await navigator.share({ files: [file] }); return "done"; } catch (e) {
        shareError = `${(e && e.name) || "Error"}${e && e.message ? `: ${e.message}` : ""}`;
        // closed without saving (or a phone that says so when it fails): keep the Save button for another try
        if (e && (e.name === "NotAllowedError" || e.name === "AbortError")) return "tap";
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    // a phone that couldn't share it has it in its downloads (an iPhone: Files › Downloads), not its photos
    return share ? "files" : "done";
  }
  const fileName = (who, what, date, blob) => `${String(who || "athlete").replace(/[^a-z0-9]+/gi, "_")}-${what}${date ? `-${date}` : ""}.${/webm/.test((blob && blob.type) || "") ? "webm" : "mp4"}`;
  // (an iPad, or an iPhone asking for the desktop site, says it's a Mac: one with a touch screen is one of them)
  const isPhone = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "") || (/Macintosh/.test(navigator.userAgent || "") && navigator.maxTouchPoints > 1);
  // the video in a tab of its own, to watch and save from there (Share › Save Video on an iPhone): from a tap
  const view = (blob) => { const u = URL.createObjectURL(new Blob([blob], { type: /webm/.test(blob.type || "") ? "video/webm" : "video/mp4" })); if (!window.open(u, "_blank")) window.location.href = u; };

  window.VideoExport = { render, download, view, panel, supported, fileName, isPhone, shareError: () => shareError, LAYOUTS };
})();
