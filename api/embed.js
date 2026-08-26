// The embeddable widget — Gurukul WS-N item 3, the client half.
//
// Served as JavaScript from this deployment so a teacher's whole integration
// is one line on their own site:
//
//   <script src="https://<deployment>/embed.js" data-clone="arjun-sir-physics"></script>
//
// ── why this is a hand-written string and not a bundle ────────────────────
//
// Vanilla, ~7KB, no React, no build step, no dependency. Three reasons, in
// order of how expensive getting them wrong would be:
//
//  1. IT RUNS ON SOMEBODY ELSE'S PAGE. Anything we ship here shares a global
//     scope with a stranger's site. A framework runtime is a large surface for
//     that; an IIFE with no globals and no prototype patching is a small one.
//  2. CSP. A third-party site's Content-Security-Policy is theirs, and a
//     bundle that needs `eval`, inline styles, or a CDN origin is a bundle
//     that silently does not load on the strictest customers — the ones most
//     likely to be a school. Everything below is one external script, one
//     `<style>` element, and `fetch` to one origin, which is the smallest
//     policy a site can be asked for.
//  3. NO COOKIES. Nothing here writes a cookie, and the visitor id is a random
//     value in `sessionStorage` that dies with the tab. A widget that set a
//     cookie on a teacher's domain would make every one of their customers a
//     party to a consent question they were never asked.
//
// ── the disclosure is rendered because it is RETURNED, not because we ask ─
//
// `/api/clone-chat` `open` returns the card and binds its digest into the
// session token, so a fork of this file that deleted the render would still
// not be able to chat without having received it (api/_clonechat.js's header
// states the mechanism). What this file guarantees is that the card is the
// FIRST thing in the panel, above the composer, before any turn — P1's shape.
//
// ── what this file must never grow ────────────────────────────────────────
//
// A provider name, a model name, an agent uuid, or a second reply path. The
// first three are the internals fence; the fourth is the whole reason
// api/_clonechat.js goes through `gatedReply()`.

const WIDGET_JS = String.raw`(function () {
  "use strict";
  var me = document.currentScript;
  if (!me || me.__vyMounted) return;
  me.__vyMounted = true;

  var slug = (me.getAttribute("data-clone") || "").trim();
  if (!slug) return;
  var origin = new URL(me.src, location.href).origin;
  var api = origin + "/api/clone-chat";
  var label = me.getAttribute("data-label") || "Ask a question";
  var accent = me.getAttribute("data-accent") || "#2f6df6";

  // Per-tab, not per-device: sessionStorage dies with the tab and is never a
  // cookie, so nothing here follows a visitor between visits.
  var visitor = "";
  try {
    visitor = sessionStorage.getItem("vy.visitor") || "";
    if (!visitor) {
      visitor = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("vy.visitor", visitor);
    }
  } catch (e) {
    visitor = "";
  }

  var session = null;
  var transcript = [];
  var busy = false;

  var css = document.createElement("style");
  css.textContent = [
    ".vy-b{position:fixed;right:20px;bottom:20px;z-index:2147483000;border:0;border-radius:999px;",
    "padding:13px 20px;font:600 15px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;",
    "color:#fff;background:", accent, ";box-shadow:0 6px 24px rgba(0,0,0,.24);cursor:pointer}",
    ".vy-p{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:min(380px,calc(100vw - 32px));",
    "max-height:min(620px,calc(100vh - 40px));display:none;flex-direction:column;border-radius:16px;",
    "overflow:hidden;background:#fff;color:#14161a;box-shadow:0 12px 48px rgba(0,0,0,.28);",
    "font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}",
    ".vy-p.vy-open{display:flex}",
    ".vy-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;",
    "background:", accent, ";color:#fff;font-weight:600}",
    ".vy-x{background:none;border:0;color:#fff;font-size:20px;line-height:1;cursor:pointer;padding:0 4px}",
    ".vy-d{margin:0;padding:12px 14px;background:#f3f5f9;border-bottom:1px solid #e3e7ee;",
    "font-size:13px;color:#3a4150;white-space:pre-wrap}",
    ".vy-l{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}",
    ".vy-m{max-width:85%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}",
    ".vy-m.vy-u{align-self:flex-end;background:", accent, ";color:#fff;border-bottom-right-radius:4px}",
    ".vy-m.vy-a{align-self:flex-start;background:#eef1f6;border-bottom-left-radius:4px}",
    ".vy-m.vy-e{align-self:center;background:none;color:#8a91a0;font-size:13px;text-align:center}",
    ".vy-f{display:flex;gap:8px;padding:10px;border-top:1px solid #e3e7ee;background:#fff}",
    ".vy-i{flex:1;border:1px solid #ccd3de;border-radius:10px;padding:9px 11px;font:inherit;color:inherit;",
    "background:#fff;min-width:0}",
    ".vy-s{border:0;border-radius:10px;padding:0 14px;background:", accent, ";color:#fff;font:600 15px/1 inherit;cursor:pointer}",
    ".vy-s[disabled],.vy-i[disabled]{opacity:.55;cursor:default}",
    "@media (prefers-color-scheme:dark){",
    ".vy-p{background:#14161a;color:#e9edf4}.vy-d{background:#1b1f26;border-bottom-color:#272d36;color:#aab3c2}",
    ".vy-m.vy-a{background:#232830;color:#e9edf4}.vy-f{background:#14161a;border-top-color:#272d36}",
    ".vy-i{background:#1b1f26;border-color:#333a45;color:#e9edf4}}",
  ].join("");
  document.head.appendChild(css);

  var el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  var bubble = el("button", "vy-b", label);
  bubble.type = "button";
  bubble.setAttribute("aria-haspopup", "dialog");

  var panel = el("div", "vy-p");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", label);

  var head = el("div", "vy-h");
  var title = el("span", null, label);
  var close = el("button", "vy-x", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  head.appendChild(title);
  head.appendChild(close);

  // THE DISCLOSURE. First child of the panel body, above the log and above the
  // composer, filled from the server's open() response and never from a string
  // in this file — see the header.
  var card = el("p", "vy-d", "");
  var log = el("div", "vy-l");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");

  var form = el("form", "vy-f");
  var input = el("input", "vy-i");
  input.type = "text";
  input.placeholder = "Type your question";
  input.setAttribute("aria-label", "Your question");
  input.maxLength = 2000;
  var send = el("button", "vy-s", "Send");
  send.type = "submit";
  form.appendChild(input);
  form.appendChild(send);

  panel.appendChild(head);
  panel.appendChild(card);
  panel.appendChild(log);
  panel.appendChild(form);
  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  function say(cls, text) {
    var n = el("div", "vy-m " + cls, text);
    log.appendChild(n);
    log.scrollTop = log.scrollHeight;
    return n;
  }

  function lock(on) {
    busy = on;
    input.disabled = on;
    send.disabled = on;
  }

  function post(payload) {
    return fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error) || "failed");
        return j;
      });
    });
  }

  function open() {
    panel.classList.add("vy-open");
    bubble.style.display = "none";
    input.focus();
    if (session) return;
    lock(true);
    post({ op: "open", clone: slug, visitor: visitor })
      .then(function (j) {
        session = j.session;
        // Rendered before the composer is usable, every session.
        card.textContent = j.disclosure || "";
        if (j.display_name) title.textContent = j.display_name;
        lock(false);
        input.focus();
      })
      .catch(function () {
        card.textContent = "";
        say("vy-e", "This assistant is not available right now.");
      });
  }

  function shut() {
    panel.classList.remove("vy-open");
    bubble.style.display = "";
    bubble.focus();
  }

  bubble.addEventListener("click", open);
  close.addEventListener("click", shut);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel.classList.contains("vy-open")) shut();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy || !session) return;
    input.value = "";
    say("vy-u", text);
    lock(true);
    var pending = say("vy-e", "…");
    post({ op: "say", session: session, message: text, transcript: transcript, visitor: visitor })
      .then(function (j) {
        pending.remove();
        session = j.session;
        transcript.push({ role: "user", content: text });
        var bubbles = j.bubbles || [];
        for (var i = 0; i < bubbles.length; i++) say("vy-a", bubbles[i]);
        // ONE assistant turn, and it is the server's own reply string
        // rather than a rejoin of the fragments — the digest covers that
        // string, and render() trims at split points, so a rejoin is not
        // guaranteed to reproduce it. Fragments are a rendering decision; the
        // record is not.
        if (j.reply) transcript.push({ role: "assistant", content: j.reply });
        lock(false);
        input.focus();
      })
      .catch(function (err) {
        pending.remove();
        var code = (err && err.message) || "";
        if (code === "clone_disclosure_stale" || code === "clone_session_expired") {
          // Re-open, which re-renders the card. Never continue under a
          // disclosure this visitor has not seen.
          session = null;
          transcript = [];
          log.textContent = "";
          lock(false);
          open();
          return;
        }
        say("vy-e", "Something went wrong. Please try again.");
        lock(false);
      });
  });
})();
`;

/**
 * The whole endpoint. Immutable content, so it is cached hard — a teacher's
 * page should not pay a round trip for this on every view — but only for an
 * hour, because the day a disclosure or a limit changes, every embedded copy
 * on the internet has to pick it up without anyone editing anyone's site.
 */
export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return res.status(405).json({ error: "GET only" });
  }
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");
  // Not a security boundary (the browser applies the HOSTING page's CSP to
  // what this script does), but it is the correct declaration for a static
  // script asset and it costs nothing.
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "HEAD") return res.status(200).end();
  return res.status(200).send(WIDGET_JS);
}

/** Exported so `evals/clonechannel.mjs` can assert over the shipped bytes —
 *  notably that the disclosure element is filled from the server's response
 *  and that no provider or model name appears anywhere in it. */
export { WIDGET_JS };
