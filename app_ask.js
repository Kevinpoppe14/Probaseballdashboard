// The app's own small question boxes, in place of the browser's prompt() and confirm() pop-ups (which show the
// site's address and the browser's styling). Each returns a promise:
//   askText({ title, text, placeholder, value, ok, maxLength }) → the text typed (trimmed), or null if cancelled
//   askConfirm({ title, text, ok, danger }) → true or false
// Enter answers, Esc or a click outside cancels.
(function () {
  const { useState } = React;

  function Ask({ o, done }) {
    const [v, setV] = useState(o.value || "");
    const typing = o.kind === "text";
    const answer = () => done(typing ? (v.trim() || null) : true);
    const cancel = () => done(typing ? null : false);
    const keys = (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (!typing || v.trim()) answer(); }
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
      e.stopPropagation(); // the builder behind it doesn't see these keys
    };
    return (
      <div className="zoom-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>
        <div className="zoom-modal app-ask" role="dialog" aria-label={o.title} onKeyDown={keys}>
          <h2>{o.title}</h2>
          {o.text && <p>{o.text}</p>}
          {typing && <input autoFocus value={v} maxLength={o.maxLength || 60} placeholder={o.placeholder || ""} onChange={(e) => setV(e.target.value)} />}
          <div className="app-ask-actions">
            <button className={`btn ${o.danger ? "btn-danger" : ""}`} autoFocus={!typing} disabled={typing && !v.trim()} onClick={answer}>{o.ok || (typing ? "Add" : "OK")}</button>
            <button className="btn btn-secondary" onClick={cancel}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  const open = (o) => new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    const done = (value) => { root.unmount(); host.remove(); resolve(value); };
    root.render(<Ask o={o} done={done} />);
  });
  window.askText = (o) => open({ ...o, kind: "text" });
  window.askConfirm = (o) => open({ ...o, kind: "confirm" });
})();
