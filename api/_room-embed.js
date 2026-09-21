// The Room on a creator's own site (WS-R46) — the embeddable button.
//
// Most Indian creators already own a surface: a coaching site, a Linktree, a
// WordPress blog, a YouTube description. The Room should be one paste away
// from any of them. `api/embed.js`/`api/_embed.js` is Meera's own widget and
// the precedent for everything below — dependency-free, no build step, no
// cookie, and the disclosure rendered because it is RETURNED, never asked
// for. This file is the Room's version of the same idea, with one law that
// widget did not have to carry: v0 never frames the Room.
//
// ── WHY NO IFRAME (v0) ──────────────────────────────────────────────────
//
// Framing the Room inside a creator's own page needs a per-creator allowed
// origin list — a table this workstream is not adding — so a follower who
// clicks through leaves the creator's page and lands ON the Room, in a new
// tab, at its own origin. The reversal condition is named once, here, rather
// than re-argued the day it matters: `context/decisions.md#ws-r46-no-iframe-v0`.
//
// ── THE TWO HALVES ──────────────────────────────────────────────────────
//
//   readRoomEmbed   the one database read: slug -> the resolved, published
//                    room, or null. Reuses `resolveRoom` verbatim (never a
//                    second, weaker copy of the publish/pause predicate) —
//                    the SAME function every follower's first screen goes
//                    through, so "is this Room reachable" can never disagree
//                    between the widget and the app it links to.
//   buildRoomEmbedJson  PURE. Takes what `readRoomEmbed` returns (or null)
//                    and builds the JSON body. No I/O, no database, so an
//                    offline eval can assert its shape without a fake `db`
//                    at all — a fixture row is enough. Its own source names
//                    no follower table and no count, asserted statically:
//                    the shape that would leak a stat here is a stat this
//                    function never had a way to read in the first place.
//
// An unpublished OR unknown slug produce the IDENTICAL `{ room: null }` —
// not a design choice made here, but inherited for free from `resolveRoom`'s
// own WHERE clause (`roomBySlug`'s `published_at is not null and paused_at
// is null`), which already cannot tell the two cases apart. A page must
// never learn whether a slug exists.
import { resolveRoom, roomDisclosureCard, roomNameFor, RoomError } from "./_room-surface.js";

/**
 * slug -> the resolved, published room (same shape `resolveRoom` returns),
 * or null for anything that is not currently reachable — unknown, never
 * published, or paused. `opts` is the same `{ loadAgent }` injection seam
 * `resolveRoom` itself takes, so an offline eval can drive this without a
 * live sheet lookup.
 */
export async function readRoomEmbed(db, slug, opts = {}) {
  try {
    return await resolveRoom(db, slug, opts);
  } catch (error) {
    if (error instanceof RoomError) return null;
    throw error;
  }
}

/**
 * PURE. `resolved` is exactly what `readRoomEmbed` returns. Never reads a
 * follower table and never counts anything — the button's whole point is
 * that a page embedding it learns nothing about this Room's audience.
 *
 * `disclosure` is `roomDisclosureCard` verbatim, the SAME text the Room
 * itself, the Telegram bot and WhatsApp all render — never a second,
 * shorter disclosure invented for this one surface (`context/rejected.md`'s
 * disclosure-is-bound-not-requested law, restated for a third transport).
 */
export function buildRoomEmbedJson(resolved) {
  if (!resolved || !resolved.room) return { room: null };
  const locale = resolved.room.default_locale === "hi" ? "hi" : "en";
  const name = roomNameFor(resolved.sheet) || resolved.room.display_name || "";
  return {
    room: {
      display_name: resolved.room.display_name || name,
      locale,
      disclosure: roomDisclosureCard(name, locale),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE SCRIPT — a hand-written string, `api/embed.js`'s own reasoning
// applied a second time (IIFE, no globals, no prototype patching, one
// `<style>` element, one `fetch`, no cookie).
// ─────────────────────────────────────────────────────────────────────────
//
// What THIS file's script must never grow, on top of `api/embed.js`'s own
// list (a provider name, a model name, an agent uuid, a second reply path):
// a second endpoint. The one `fetch` below names `/room-embed.js` and
// nothing else — asserted statically by `evals/room-embed/run.mjs` because a
// script that could be edited to call a second address is a script that can
// be edited to leak one.
export const ROOM_EMBED_JS = String.raw`(function () {
  "use strict";
  var me = document.currentScript;
  if (!me || me.__vyRoomMounted) return;
  me.__vyRoomMounted = true;

  var slug = (me.getAttribute("data-room") || "").trim();
  // No slug, no button — removes its own script tag rather than sitting on
  // the page inert, the same "the page never learns whether a slug exists"
  // discipline applied to a creator's own markup typo.
  if (!slug) { me.remove(); return; }
  var origin = new URL(me.src, location.href).origin;

  fetch(origin + "/room-embed.js?slug=" + encodeURIComponent(slug))
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || !j.room) { me.remove(); return; }
      render(j.room);
    })
    .catch(function () { me.remove(); });

  function render(room) {
    var css = document.createElement("style");
    css.textContent = [
      ".vyr-w{font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;",
      "max-width:360px;color:#14161a}",
      ".vyr-b{display:inline-block;text-decoration:none;border-radius:999px;",
      "padding:12px 22px;font:600 15px/1.2 inherit;color:#fff;background:#2f6df6}",
      "@media (prefers-reduced-motion:no-preference){.vyr-b{transition:background .15s ease}}",
      ".vyr-b:hover{background:#2557d1}",
      ".vyr-d{margin:10px 0 0;padding:0;font-size:13px;line-height:1.5;",
      "color:#5a6270;white-space:pre-wrap}",
      ".vyr-p{margin:6px 0 0;padding:0;font-size:11px;color:#9aa1af}",
      "@media (prefers-color-scheme:dark){",
      ".vyr-w{color:#e9edf4}.vyr-d{color:#aab3c2}.vyr-p{color:#7b8291}}",
    ].join("");
    document.head.appendChild(css);

    var wrap = document.createElement("div");
    wrap.className = "vyr-w";

    var link = document.createElement("a");
    link.className = "vyr-b";
    link.href = origin + "/r/" + encodeURIComponent(slug) + "?via=embed";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = (room.display_name || "Your") + " AI";

    // THE DISCLOSURE. Server text, never a line written into this file — see
    // the header. Rendered whether or not the visitor ever clicks through.
    var disc = document.createElement("p");
    disc.className = "vyr-d";
    disc.textContent = room.disclosure || "";

    var powered = document.createElement("p");
    powered.className = "vyr-p";
    powered.textContent = "Powered by Vyakti";

    wrap.appendChild(link);
    wrap.appendChild(disc);
    wrap.appendChild(powered);
    me.parentNode.insertBefore(wrap, me);
  }
})();
`;
