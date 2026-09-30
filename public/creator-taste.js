// The taste, on the creator's own public page (`/c/<slug>`, WS-R80). Static,
// dependency-free, no build step — `api/_room-embed.js`'s own shape, applied
// to a form instead of a button.
//
// `api/_creator-page.js`'s own no-JS form already works without this file:
// a plain GET to `/r/<slug>?via=search`, the Room's own taste screen for a
// signed-out visitor. Everything below only UPGRADES that same form to
// answer inline, through the exact taste call `api/room.js` already serves
// (room, message, locale) and the same 3-a-day `room_taste` rate scope
// every other taste caller goes through — nothing here mints a session,
// reads a cookie, or names a follower table or a follower op.
//
// THE ONE FETCH TARGET is /api/room, and the ONE op literal this file ever
// sends is the taste op, nothing else — asserted statically in
// evals/room-taste/run.mjs's own self-scan, api/_room-embed.js's "one
// fetch, one target" technique applied to op literals instead of a URL.
//
// EVERY STRING THIS FILE RENDERS comes from one of two places: a `data-*`
// attribute `api/_creator-page.js` already wrote from `src/room/copy.ts`'s
// own `taste` section (never a line typed here), or the server's own JSON
// reply (`turn.reply`, `turn.disclosure`) — always written with
// `textContent`, never `innerHTML`, so a visitor's own typed question (or a
// reply that happened to contain markup) can never execute as script on this
// page. This file writes no prose of its own.
(function () {
  "use strict";
  var form = document.getElementById("vy-taste-form");
  if (!form) return;
  var slug = form.getAttribute("data-room") || "";
  var locale = form.getAttribute("data-locale") || "en";
  if (!slug) return;

  var input = document.getElementById("vy-taste-input");
  var button = document.getElementById("vy-taste-submit");
  var turnsEl = document.getElementById("vy-taste-turns");
  var statusEl = document.getElementById("vy-taste-status");
  var joinEl = document.getElementById("vy-taste-join");
  var ledeEl = document.getElementById("vy-taste-lede");
  var discEl = document.getElementById("vy-taste-disclosure");
  if (!input || !button || !turnsEl || !statusEl || !joinEl) return;

  var sendLabel = button.getAttribute("data-send") || button.textContent;
  var thinkingLabel = button.getAttribute("data-thinking") || sendLabel;
  var busy = false;
  var spent = false;

  function setStatus(text) {
    statusEl.textContent = text || "";
  }

  function turnsLeftText(n) {
    if (n === 1) return statusEl.getAttribute("data-turns-left-one") || "";
    var template = statusEl.getAttribute("data-turns-left") || "";
    return template.split("{n}").join(String(n));
  }

  function addTurn(question, answer) {
    var block = document.createElement("div");
    block.className = "room-taste-turn";
    var q = document.createElement("p");
    q.className = "room-taste-q";
    q.textContent = question;
    var a = document.createElement("p");
    a.className = "room-taste-a";
    a.textContent = answer;
    block.appendChild(q);
    block.appendChild(a);
    turnsEl.appendChild(block);
  }

  function endOfTasteFlow() {
    spent = true;
    input.hidden = true;
    button.hidden = true;
    joinEl.hidden = false;
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy || spent) return;
    var text = (input.value || "").trim();
    if (!text) return;

    busy = true;
    input.disabled = true;
    button.disabled = true;
    button.textContent = thinkingLabel;
    setStatus("");

    fetch("/api/room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "taste", room: slug, message: text, locale: locale }),
    })
      .then(function (r) {
        return r.json().then(function (body) {
          return { ok: r.ok, body: body };
        });
      })
      .then(function (res) {
        if (!res.ok) {
          if (res.body && res.body.error === "rate_limited") {
            setStatus(statusEl.getAttribute("data-rate-limited") || "");
            endOfTasteFlow();
          } else {
            // Any other refusal (an unavailable engine, a message too long,
            // the switch flipped off mid-visit) is a FAILURE, not the
            // taste's own natural end — `RoomApp.tsx`'s own TasteScreen
            // draws the identical line: recoverable, never spends a turn.
            setStatus(statusEl.getAttribute("data-generic-error") || "");
            input.disabled = false;
            button.disabled = false;
          }
          return;
        }
        var turn = res.body || {};
        input.value = "";
        addTurn(text, turn.reply || "");
        if (turn.disclosure) {
          if (ledeEl) ledeEl.hidden = true;
          if (discEl) {
            discEl.textContent = turn.disclosure;
            discEl.hidden = false;
          }
        }
        var left = Number(turn.turns_left);
        if (!(left > 0)) {
          setStatus(statusEl.getAttribute("data-spent") || "");
          endOfTasteFlow();
        } else {
          setStatus(turnsLeftText(left));
          input.disabled = false;
          button.disabled = false;
        }
      })
      .catch(function () {
        setStatus(statusEl.getAttribute("data-generic-error") || "");
        input.disabled = false;
        button.disabled = false;
      })
      .then(function () {
        busy = false;
        if (!spent) button.textContent = sendLabel;
      });
  });

  // Proof for `scripts/check-headers.mjs` that this island actually mounted,
  // not just that nothing on the page violated CSP while it sat inert.
  form.setAttribute("data-enhanced", "1");
})();
