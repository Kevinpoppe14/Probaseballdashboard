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
    vertical: { W: 1080, H: 1920, video: { x: 0, y: 0, w: 1080, h: 1320 }, panel: { x: 0, y: 1320, w: 1080, h: 600 } },
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

  // the video into its area, whole (bars where its shape differs), and where it went
  function fit(g, v, area) {
    const vw = v.videoWidth || 16, vh = v.videoHeight || 9, s = Math.min(area.w / vw, area.h / vh);
    const w = vw * s, h = vh * s, x = area.x + (area.w - w) / 2, y = area.y + (area.h - h) / 2;
    g.drawImage(v, x, y, w, h);
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
    // the left of a vertical panel (or all of a horizontal one) holds the words; widgets go right (or below)
    const colW = vertical ? Math.round(box.w * 0.58) - pad : box.w - 2 * pad;
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
    // the figures: two columns across (three on a vertical panel's wider text side), label over value
    const rows = (p.rows || []).filter((r) => r && r[1] != null && r[1] !== "");
    if (rows.length) {
      g.strokeStyle = LINE; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + colW, y); g.stroke();
      y += 16;
      // short labels (a pitch's): label over value in columns; long ones (a delivery's): a line each, label then value
      const up = (s) => String(s).toUpperCase();
      g.font = `700 16px "Helvetica Neue", Arial, sans-serif`;
      const wide = rows.some(([label]) => g.measureText(up(label)).width > colW / (vertical ? 3 : 2) - 14);
      if (!wide) {
        const cols = vertical ? 3 : 2, cw = colW / cols, rh = vertical ? 66 : 70;
        rows.forEach(([label, value], i) => {
          const cx = x + (i % cols) * cw, cy = y + Math.floor(i / cols) * rh;
          g.fillStyle = DIM; fitText(g, up(label), cw - 12, 17, 700); g.fillText(up(label), cx, cy + 18);
          g.fillStyle = "#fff"; fitText(g, String(value), cw - 12, vertical ? 34 : 32, 700); g.fillText(String(value), cx, cy + 54);
        });
        y += Math.ceil(rows.length / cols) * rh + 8;
      } else {
        const cols = vertical ? 2 : 1, cw = colW / cols, rh = vertical ? 46 : 50, gap = vertical ? 24 : 0;
        rows.forEach(([label, value], i) => {
          const cx = x + (i % cols) * (cw + gap / cols), cy = y + Math.floor(i / cols) * rh, w = cw - gap;
          g.textAlign = "right"; g.fillStyle = "#fff"; fitText(g, String(value), w * 0.42, vertical ? 30 : 28, 700); g.fillText(String(value), cx + w, cy + 32);
          const vw = g.measureText(String(value)).width;
          g.textAlign = "left"; g.fillStyle = DIM; fitText(g, up(label), w - vw - 14, 16, 700); g.fillText(up(label), cx, cy + 30);
          g.strokeStyle = LINE; g.lineWidth = 1; g.beginPath(); g.moveTo(cx, cy + rh - 6); g.lineTo(cx + w, cy + rh - 6); g.stroke();
        });
        y += Math.ceil(rows.length / cols) * rh + 8;
      }
    }
    // widgets (the spinning ball, a movement plot): squares side by side, clear of the logo
    const widgets = (p.widgets || []).filter(Boolean);
    if (widgets.length) {
      const logoH = 96;
      const area = vertical
        ? { x: box.x + Math.round(box.w * 0.58), y: box.y + pad, w: Math.round(box.w * 0.42) - pad, h: box.h - 2 * pad - logoH }
        : { x: box.x + pad, y: y + 6, w: box.w - 2 * pad, h: box.y + box.h - pad - logoH - (y + 6) };
      const n = widgets.length, gap = 16, size = Math.max(0, Math.min((area.w - gap * (n - 1)) / n, area.h));
      if (size >= 90) widgets.forEach((wd, i) => { g.save(); wd(g, area.x + i * (size + gap), area.y, size); g.restore(); });
    }
    g.restore();
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function drawLogo(g, L, im) {
    if (!im) return;
    const w = L.W > L.H ? 200 : 210, h = (im.height / im.width) * w;
    g.globalAlpha = 0.95; g.drawImage(im, L.W - w - 30, L.H - h - 26, w, h); g.globalAlpha = 1;
  }

  // ---- making the video ------------------------------------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function openVideo(url) {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous"; // stored clips come from another origin: without this the frames couldn't be read back
    v.src = url;
    await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error("A video wouldn't open in this browser (it needs to be an MP4 or MOV it can play).")); });
    return v;
  }
  const seek = (v, t) => new Promise((ok) => { if (Math.abs(v.currentTime - t) < 1e-3) { ok(); return; } v.onseeked = () => { v.onseeked = null; ok(); }; v.currentTime = t; });

  async function render({ layout = "horizontal", title = null, segments, onProgress = () => {}, cancelled = () => false }) {
    if (!supported()) throw new Error("This browser can't make videos. Use Chrome or Edge on a computer, or Chrome on Android, or a recent iPhone.");
    const L = LAYOUTS[layout] || LAYOUTS.horizontal;
    const cv = document.createElement("canvas");
    cv.width = L.W; cv.height = L.H;
    const g = cv.getContext("2d");
    const im = await logo();
    const total = segments.reduce((s, sg) => s + Math.max(0.1, ((sg.end || 0) - (sg.start || 0)) / (sg.rate || 1)), 0) || 1;
    let done = 0;

    // the encoder (or, without one, a recording of the canvas as it's drawn)
    let emit, finish, abort;
    if (canEncode()) {
      await script(MUXER);
      const M = window.Mp4Muxer;
      const muxer = new M.Muxer({ target: new M.ArrayBufferTarget(), video: { codec: "avc", width: L.W, height: L.H }, fastStart: "in-memory", firstTimestampBehavior: "offset" });
      let failed = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
      let cfg = null;
      for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.420028"]) {
        const c = { codec, width: L.W, height: L.H, bitrate: 10_000_000, framerate: FPS };
        try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch (e) { /* try the next */ }
      }
      if (!cfg) throw new Error("This browser can't encode H.264 video at this size.");
      enc.configure(cfg);
      let last = -1, lastKey = -10;
      emit = async (sec) => {
        if (failed) throw failed;
        const ts = Math.round(sec * 1e6);
        if (ts <= last) return; // the same moment twice (a repeated frame): once is enough
        last = ts;
        const frame = new VideoFrame(cv, { timestamp: ts });
        const key = sec - lastKey >= 2;
        if (key) lastKey = sec;
        enc.encode(frame, { keyFrame: key });
        frame.close();
        while (enc.encodeQueueSize > 6) await sleep(4);
      };
      finish = async () => { await enc.flush(); if (failed) throw failed; muxer.finalize(); enc.close(); return new Blob([muxer.target.buffer], { type: "video/mp4" }); };
      abort = () => { try { enc.close(); } catch (e) { /* closed */ } };
    } else {
      const type = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
      const rec = new MediaRecorder(cv.captureStream(FPS), { mimeType: type, videoBitsPerSecond: 10_000_000 });
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
      rec.start(1000);
      emit = async () => {};
      finish = () => new Promise((ok) => { rec.onstop = () => ok(new Blob(parts, { type: (type || "video/webm").split(";")[0] })); rec.stop(); });
      abort = () => { try { rec.stop(); } catch (e) { /* stopped */ } };
    }
    const realTime = !canEncode(); // recording: the title card has to be held on screen for as long as it shows
    let tOut = 0;
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
        const v = await openVideo(sg.url);
        try {
          const start = sg.start || 0, end = Math.min(sg.end != null ? sg.end : v.duration, v.duration || Infinity);
          const base = tOut;
          const drawAt = async (t) => {
            g.fillStyle = "#000"; g.fillRect(0, 0, L.W, L.H);
            const rect = fit(g, v, L.video);
            const info = { k, t, elapsed: (t - start) / rate };
            if (sg.overlay) { g.save(); sg.overlay(g, rect, info); g.restore(); }
            if (sg.panel) sg.panel(g, L.panel, info);
            drawLogo(g, L, im);
            await emit(base + info.elapsed);
            onProgress(segments.length > 1 ? `Making the video: ${k + 1} of ${segments.length}` : "Making the video", Math.min(1, (done + info.elapsed) / total));
          };
          await seek(v, start);
          await drawAt(start);
          if (v.requestVideoFrameCallback && !realTime) {
            // played at its speed, each frame it shows drawn as it comes (paused while the encoder catches up)
            v.playbackRate = rate >= 0.25 ? Math.min(1, rate) : 0.25;
            await new Promise((ok, bad) => {
              let over = false;
              const stop = () => { if (over) return; over = true; v.pause(); ok(); };
              const onFrame = async (now, meta) => {
                if (over) return;
                if (cancelled()) { over = true; v.pause(); bad(new Error("cancelled")); return; }
                const t = meta.mediaTime;
                if (t >= end - 1e-3) { stop(); return; }
                v.pause();
                try { await drawAt(t); } catch (e) { over = true; bad(e); return; }
                if (over) return;
                v.requestVideoFrameCallback(onFrame);
                v.play().catch(stop);
              };
              v.requestVideoFrameCallback(onFrame);
              v.onended = stop;
              v.play().catch(bad);
            });
            // the timing: from the file's own clock, at the speed chosen (paused between frames, so the playback speed doesn't matter)
          } else if (realTime) {
            // recording: played in real time at the speed chosen, drawn on every animation frame
            v.playbackRate = rate;
            await new Promise((ok) => {
              const tick = async () => { if (cancelled() || v.ended || v.currentTime >= end - 1e-3) { v.pause(); ok(); return; } await drawAt(v.currentTime); requestAnimationFrame(tick); };
              v.play().then(() => requestAnimationFrame(tick), ok);
            });
          } else {
            // no frame callbacks: stepped through, a frame of the output at a time
            for (let t = start + rate / FPS; t < end; t += rate / FPS) { if (cancelled()) throw new Error("cancelled"); await seek(v, t); await drawAt(t); }
          }
          tOut = base + (end - start) / rate;
          done += (end - start) / rate;
        } finally { v.removeAttribute("src"); v.load(); }
      }
      await emit(tOut); // the last frame held to the end
      onProgress("Finishing…", 1);
      return await finish();
    } catch (e) { abort(); throw e; }
  }

  // to the phone's or computer's downloads (a phone that can share files offers its share sheet: Save Video there
  // puts it in the camera roll)
  async function download(blob, name, { share = false } = {}) {
    const file = typeof File === "function" ? new File([blob], name, { type: blob.type }) : null;
    if (share && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  const fileName = (who, what, date, blob) => `${String(who || "athlete").replace(/[^a-z0-9]+/gi, "_")}-${what}${date ? `-${date}` : ""}.${/webm/.test((blob && blob.type) || "") ? "webm" : "mp4"}`;
  const isPhone = () => /iPhone|iPad|Android/i.test(navigator.userAgent || "");

  window.VideoExport = { render, download, panel, supported, fileName, isPhone, LAYOUTS };
})();
