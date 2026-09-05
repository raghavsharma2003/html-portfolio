// api/_room-about.js — the follower's transparency page at /r/<slug>/about
// (WS-R97). Server-rendered, publicly readable, no bearer token, no session:
// what this AI knows about you, what the creator can see, how long it is
// kept, what a referral link carries, and every switch that changes it,
// stated from the Room's own row and the platform's own constants, never
// from a follower's own data — `api/_creator-page.js`'s own header, "the
// page is public", restated here for a page that names no follower at all,
// signed in or not.
//
// ── THE PREDICATE: `api/_room-publish.js`'s own `publicRoomBySlug`, NOT
//    `api/_creator-page.js`'s `listed_at`-gated one ──────────────────────
//
// `/c/<slug>` additionally requires `listed_at is not null` because it is a
// stranger's search result. This page is reached from links a follower
// already holds (the account page, the join screen) — a creator who never
// opted into the public directory still owes a follower who already joined
// an honest account of what happens to their words. So the gate here is
// exactly `publicRoomBySlug`'s own two clauses, published and unpaused,
// restated (not imported — that function selects only four columns, this
// page needs different ones, and the shared PREDICATE is the published/
// paused pair, not the SELECT list built on it).
//
// ── "NOBODY MAY LEARN WHETHER A SLUG EXISTS" ──────────────────────────────
//
// The same law every other public Room surface holds: an unpaused-and-
// unpublished row, a paused row, and an actually unknown slug all resolve to
// `null` here and render the IDENTICAL platform-only card —
// `buildRoomAboutHtml(null, ...)` — never a different shape that would leak
// which of the three actually happened.
//
// ── EVERY NUMBER IS AN IMPORT, NEVER A TYPED LITERAL ──────────────────────
//
// `PULSE_MIN_FOLLOWERS` (api/_pulse.js), `ROOM_FREE_MONTHLY_MESSAGES` /
// `ROOM_PAID_MONTHLY_MESSAGES` / `ROOM_PAID_MONTHLY_VOICE_SECONDS`
// (api/_room-surface.js), `DORMANCY_GRACE_DAYS` (api/_dormancy.js) are all
// imported directly rather than mirrored — this file and every one of those
// are `api/` modules, so nothing here crosses the `src/` cannot-import-`api/`
// boundary `scripts/check-mirrors.mjs` exists to police (that gate scans
// `src/`/`site/` only, precisely because only those directories are
// structurally unable to import the real export). An api-to-api import IS
// the real export, which is a stronger guarantee than a marker-plus-scan
// pair exists to approximate.
//
// ── NO IMPORT OF ./_db.js ─────────────────────────────────────────────────
//
// `db` is a parameter, `api/_creator-page.js`'s own shape, so a fake `db` in
// an offline eval can reach every line below it.
import { roomDisclosureCard, normalizeLocale, slugOf, ROOM_FREE_MONTHLY_MESSAGES, ROOM_PAID_MONTHLY_MESSAGES, ROOM_PAID_MONTHLY_VOICE_SECONDS } from "./_room-surface.js";
import { PULSE_MIN_FOLLOWERS } from "./_pulse.js";
import { DORMANCY_GRACE_DAYS } from "./_dormancy.js";
import { PLATFORM_TITLE, PLATFORM_DESCRIPTION } from "./_room-page.js";

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── WS-R79: language tagging for screen readers ───────────────────────────
// The only creator-authored free text this page ever shows is the creator's
// own NAME — no bio, no showcase, this page renders no other creator words
// at all. `detectPageTextLang`/`langSpan`/`withLangSplicedName` are
// `api/_creator-page.js`'s own three functions, restated for the identical
// reason that file restates `src/room/copy.ts`'s `withName`: this is a
// second `api/` module rendering pure server HTML with no client bundle to
// share a helper through, and the functions are not exported (only the
// public read/write surface of `_creator-page.js` is).
const DEVANAGARI_RANGE = /[ऀ-ॿ]/;
function detectPageTextLang(text) {
  return DEVANAGARI_RANGE.test(String(text || "")) ? "hi" : "en";
}
function langSpan(tag, text, attrs = "") {
  const t = String(text || "");
  return `<${tag} lang="${detectPageTextLang(t)}"${attrs}>${esc(t)}</${tag}>`;
}
function withLangSplicedName(label, name) {
  const n = String(name || "");
  const idx = n ? label.indexOf(n) : -1;
  if (idx === -1) return esc(label);
  return esc(label.slice(0, idx)) + langSpan("span", n) + esc(label.slice(idx + n.length));
}

/** The disclosure card, one `<p>` per line, each line tagged on its own —
 *  `src/room/Localized.tsx`'s own `LocalizedDisclosure`, restated for server
 *  HTML: a disclosure line is mostly-platform prose with the creator's own
 *  name embedded in it, and tagging by LINE (not splicing the name inside
 *  it) is that component's own choice, restated here rather than re-derived,
 *  so the two renders of the identical card can never silently disagree
 *  about how it is tagged. */
function disclosureHtml(text) {
  return String(text || "")
    .split("\n")
    .map((line) => langSpan("p", line, ' class="room-card-line"'))
    .join("\n      ");
}

/**
 * `days` in whole years/months where the number divides evenly, days
 * otherwise — never a raw day count when a rounder word says the same thing
 * ("a year", never "365 days"). `src/room/copy.ts`'s own
 * `dormancyDurationLabel`, restated for the identical reason every other
 * helper on this page is: two runtimes, no shared boundary to cross.
 */
function dormancyDurationLabel(days, locale) {
  const n = Math.round(Number(days));
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n % 365 === 0) {
    const years = n / 365;
    if (locale === "hi") return years === 1 ? "एक साल" : `${years} साल`;
    return years === 1 ? "a year" : `${years} years`;
  }
  if (n % 30 === 0) {
    const months = n / 30;
    if (locale === "hi") return `${months} महीने`;
    return `${months} months`;
  }
  return locale === "hi" ? `${n} दिन` : `${n} days`;
}

// ─────────────────────────────────────────────────────────────────────────
// WS-R97 (following WS-R90's own precedent on /c/<slug>): hreflang
// alternates, x-default, and og:locale. Restated, not imported, from
// `api/_creator-page.js` — that file's own constants are unexported and, per
// this file's own header, a second page restating them rather than sharing
// an unexported private constant is this codebase's own established shape
// (`api/_sitemap.js` already restates the identical two constants for its
// own hreflang cluster, `evals/creator-page/run.mjs`'s own §14 checks the
// two stay byte-identical). Named constants, not inline literals, so
// `scripts/probeLiveExpectations.mjs` can parse them straight out of this
// file's own source the same way it already does for `_creator-page.js`.
// ─────────────────────────────────────────────────────────────────────────
const HREFLANG_CODES = ["en", "hi", "x-default"];
const HI_LANG_QUERY = "?lang=hi";
const OG_LOCALE = { en: "en_US", hi: "hi_IN" };

// ─────────────────────────────────────────────────────────────────────────
// THE READ
// ─────────────────────────────────────────────────────────────────────────

/**
 * slug -> the Room's public fields this page needs, or null for anything not
 * currently showable — unpublished, paused, or unknown. `api/_room-publish.js`'s
 * `publicRoomBySlug` predicate (published and unpaused), restated with a
 * different SELECT list, never `listed_at`-gated — this file's own header
 * explains why: a follower who already holds the link must be able to read
 * this page whether or not the creator opted into the public directory.
 */
export async function publicRoomAboutBySlug(db, slug) {
  if (typeof db !== "function") throw new Error("room_about_db_required");
  // WS-R89's law, restated a third slug-consuming door over
  // (`context/decisions.md#ws-r89-creator-page-slug-read-shares-slugof`):
  // every new door built after that workstream uses the SAME `slugOf`, never
  // a second, weaker copy of its own.
  const s = slugOf(slug);
  if (!s) return null;
  const rows = await db(
    `select slug, display_name, default_locale, dormancy_days,
            free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds
       from vy_room
      where lower(slug) = $1
        and published_at is not null
        and paused_at is null
      limit 1`,
    [s],
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// THE COPY — both locales, plain functional prose, no dash of any kind, and
// no word `scripts/check-copy.mjs`'s Rooms vocabulary rule bans (this file
// is not itself in that gate's scanned scope — `api/` is not — but every
// string here is written to the same standard by hand, the way
// `api/_creator-page.js`'s own `PAGE_COPY` already is).
// ─────────────────────────────────────────────────────────────────────────
const PAGE_COPY = {
  en: {
    heading: "What this AI knows about you",
    pageTitle: (name) => `${name} AI, what it knows about you`,
    whatThisIsLabel: "What this is",
    scopeLabel: "Your own scope",
    scopeBody:
      "What you say to this AI stays in your own thread. It never reaches the creator, and it never reaches anyone else who talks to this AI.",
    creatorViewLabel: "What the creator can see",
    creatorViewBody: (n) =>
      `The creator never reads your words. They only ever see a topic as a count, and only once at least ${n} followers show a similar interest. A smaller number never appears at all, and no follower is ever named.`,
    retentionLabel: "How long it is kept",
    retentionWithPolicy: (duration, grace) =>
      `This creator keeps a follower's conversation until ${duration} after that follower's last visit. Before then, a notice goes out, and if there is still no visit within ${grace} more days, the conversation is deleted.`,
    retentionNoPolicy: "This creator has not set an automatic time limit. Your conversation is kept until you ask otherwise.",
    receiptNote: "You can ask to be forgotten at any time from your account. You get a receipt that says exactly what was deleted.",
    referralLabel: "Your referral link",
    referralBody:
      "If you bring a friend with your own link, the creator learns only that a friend joined, never who. Your link itself carries a one way scrambled code tied to this room and your own account, so even someone holding the underlying records directly cannot turn it back into your name.",
    capsLabel: "Free and paid",
    capsFreeBody: (n) => `A free follower gets ${n} messages a month, no voice calls, and no scheduled check-ins.`,
    capsPaidBody: (messages, minutes) =>
      `A paid follower gets ${messages} messages a month plus up to ${minutes} minutes of voice a month, and can turn on check-ins.`,
    controlsLabel: "Your controls",
    controlsBody:
      "Memory, language, check-in channels, your subscription, downloading your data, and asking to be forgotten all live in your account, inside the room.",
    openLink: (name) => `Open ${name} AI`,
  },
  hi: {
    heading: "यह AI आपके बारे में क्या जानता है",
    pageTitle: (name) => `${name} AI, यह आपके बारे में क्या जानता है`,
    whatThisIsLabel: "यह क्या है",
    scopeLabel: "आपका अपना दायरा",
    scopeBody:
      "आप इस AI से जो कहते हैं वह सिर्फ आपकी अपनी थ्रेड में रहता है। यह न तो क्रिएटर तक पहुंचता है, न ही इस AI से बात करने वाले किसी और तक।",
    creatorViewLabel: "क्रिएटर क्या देख सकते हैं",
    creatorViewBody: (n) =>
      `क्रिएटर कभी आपके शब्द नहीं पढ़ते। वे किसी विषय को सिर्फ एक गिनती के रूप में देखते हैं, और तभी जब कम से कम ${n} फॉलोअर एक जैसी रुचि दिखाएं। इससे कम संख्या कभी नहीं दिखाई जाती, और किसी फॉलोअर का नाम कभी नहीं बताया जाता।`,
    retentionLabel: "कितने समय तक रखा जाता है",
    retentionWithPolicy: (duration, grace) =>
      `यह क्रिएटर एक फॉलोअर की बातचीत उस फॉलोअर की आखिरी विज़िट के ${duration} बाद तक रखते हैं। उससे पहले एक सूचना भेजी जाती है, और अगर फिर भी ${grace} और दिनों में कोई विज़िट न हो, तो बातचीत मिटा दी जाती है।`,
    retentionNoPolicy: "इस क्रिएटर ने कोई स्वचालित समय सीमा तय नहीं की है। आपकी बातचीत तब तक रखी जाती है जब तक आप कुछ और न कहें।",
    receiptNote: "आप किसी भी समय अपने अकाउंट से भुलाए जाने के लिए कह सकते हैं। आपको एक रसीद मिलती है जो बताती है कि ठीक क्या मिटाया गया।",
    referralLabel: "आपका रेफ़रल लिंक",
    referralBody:
      "अगर आप अपने लिंक से किसी दोस्त को लाते हैं, तो क्रिएटर को सिर्फ इतना पता चलता है कि एक दोस्त जुड़ा, कभी यह नहीं कि कौन। आपके लिंक में इस रूम और आपके अकाउंट से जुड़ा एक एकतरफ़ा स्क्रैम्बल्ड कोड होता है, इसलिए मूल रिकॉर्ड रखने वाला कोई भी इसे वापस आपके नाम में नहीं बदल सकता।",
    capsLabel: "फ्री और पेड",
    capsFreeBody: (n) => `एक फ्री फॉलोअर को महीने में ${n} मैसेज मिलते हैं, कोई वॉइस कॉल नहीं, और कोई शेड्यूल्ड चेक-इन नहीं।`,
    capsPaidBody: (messages, minutes) =>
      `एक पेड फॉलोअर को महीने में ${messages} मैसेज के साथ महीने में ${minutes} मिनट तक वॉइस मिलता है, और चेक-इन चालू कर सकते हैं।`,
    controlsLabel: "आपके नियंत्रण",
    controlsBody:
      "मेमोरी, भाषा, चेक-इन चैनल, आपकी सदस्यता, अपना डेटा डाउनलोड करना, और भुलाए जाने के लिए कहना, यह सब रूम के अंदर आपके अकाउंट में मिलता है।",
    openLink: (name) => `${name} AI खोलें`,
  },
};

// ─────────────────────────────────────────────────────────────────────────
// THE PAGE — PURE. `room` is exactly what `publicRoomAboutBySlug` returns,
// or null. `lang` is the raw `?lang=` query value; `normalizeLocale` decides.
// ─────────────────────────────────────────────────────────────────────────

export function buildRoomAboutHtml(room, { origin, slug, lang } = {}) {
  const base = String(origin || "").replace(/\/+$/, "");
  const path = `/r/${encodeURIComponent(String(slug || ""))}/about`;
  const url = base ? `${base}${path}` : path;
  const hreflangHiUrl = `${url}${HI_LANG_QUERY}`;

  if (!room) {
    return renderPage({
      title: PLATFORM_TITLE,
      description: PLATFORM_DESCRIPTION,
      url,
      hreflangHiUrl,
      locale: "en",
      body: `<p>${esc(PLATFORM_DESCRIPTION)}</p>`,
    });
  }

  const locale = normalizeLocale(lang ?? room.default_locale);
  const c = PAGE_COPY[locale];
  const name = room.display_name || "";
  const title = name ? c.pageTitle(name) : c.heading;
  const disclosure = roomDisclosureCard(name, locale);
  const openUrl = `${base}/r/${encodeURIComponent(String(slug || ""))}`;

  const freeCap = Number(room.free_monthly_messages ?? ROOM_FREE_MONTHLY_MESSAGES);
  const paidMessages = Number(room.paid_monthly_messages ?? ROOM_PAID_MONTHLY_MESSAGES);
  const paidVoiceSeconds = Number(room.paid_monthly_voice_seconds ?? ROOM_PAID_MONTHLY_VOICE_SECONDS);
  const paidVoiceMinutes = Math.round(paidVoiceSeconds / 60);

  const retentionHtml =
    room.dormancy_days != null
      ? `<p>${esc(c.retentionWithPolicy(dormancyDurationLabel(room.dormancy_days, locale), String(DORMANCY_GRACE_DAYS)))}</p>`
      : `<p>${esc(c.retentionNoPolicy)}</p>`;

  const body = `<main>
    <h1>${esc(c.heading)}</h1>
    ${name ? `<p class="room-about-sub">${withLangSplicedName(`${name} AI`, name)}</p>` : ""}

    <section aria-labelledby="about-what-title">
      <h2 id="about-what-title">${esc(c.whatThisIsLabel)}</h2>
      <div class="room-card" role="note">
        ${disclosureHtml(disclosure)}
      </div>
    </section>

    <section aria-labelledby="about-scope-title">
      <h2 id="about-scope-title">${esc(c.scopeLabel)}</h2>
      <p>${esc(c.scopeBody)}</p>
    </section>

    <section aria-labelledby="about-creator-view-title">
      <h2 id="about-creator-view-title">${esc(c.creatorViewLabel)}</h2>
      <p>${esc(c.creatorViewBody(String(PULSE_MIN_FOLLOWERS)))}</p>
    </section>

    <section aria-labelledby="about-retention-title">
      <h2 id="about-retention-title">${esc(c.retentionLabel)}</h2>
      ${retentionHtml}
      <p>${esc(c.receiptNote)}</p>
    </section>

    <section aria-labelledby="about-referral-title">
      <h2 id="about-referral-title">${esc(c.referralLabel)}</h2>
      <p>${esc(c.referralBody)}</p>
    </section>

    <section aria-labelledby="about-caps-title">
      <h2 id="about-caps-title">${esc(c.capsLabel)}</h2>
      <p>${esc(c.capsFreeBody(String(freeCap)))}</p>
      <p>${esc(c.capsPaidBody(String(paidMessages), String(paidVoiceMinutes)))}</p>
    </section>

    <section aria-labelledby="about-controls-title">
      <h2 id="about-controls-title">${esc(c.controlsLabel)}</h2>
      <p>${esc(c.controlsBody)}</p>
    </section>

    <p><a href="${esc(openUrl)}">${withLangSplicedName(c.openLink(name), name)}</a></p>
  </main>`;

  return renderPage({ title, description: c.scopeBody, url, hreflangHiUrl, locale, body });
}

function renderPage({ title, description, url, hreflangHiUrl, locale, body }) {
  const t = esc(title);
  const d = esc(description);
  const u = esc(url);
  const hiU = esc(hreflangHiUrl);
  const htmlLang = locale === "hi" ? "hi" : "en";
  const ogLocale = OG_LOCALE[htmlLang] || OG_LOCALE.en;
  const hreflangLinks = HREFLANG_CODES
    .map((code) => `<link rel="alternate" hreflang="${code}" href="${code === "hi" ? hiU : u}" />`)
    .join("\n    ");
  return `<!doctype html>
<html lang="${htmlLang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${u}" />
    ${hreflangLinks}
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${ogLocale}" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${u}" />
    <meta name="robots" content="noindex" />
    <style>${PAGE_STYLE}</style>
  </head>
  <body>
    ${body}
  </body>
</html>
`;
}

/** Plain, small, no build step — `api/_creator-page.js`'s own `PAGE_STYLE`,
 *  restated with this page's own class names, for the identical reason that
 *  file's own comment gives: no CSS bundling step exists here to share
 *  values through, and this page's needs are its own. Zero script, zero web
 *  font. */
const PAGE_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem 3rem; max-width: 40rem; margin-inline: auto;
    background: #f4f1e9; color: #171915;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Devanagari", sans-serif;
  }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
  .room-about-sub { color: #52564e; margin: 0 0 1.5rem; }
  h2 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; }
  p { margin: 0 0 0.75rem; }
  .room-card { border: 1px solid rgba(28, 32, 26, 0.12); border-radius: 0.75rem; padding: 1rem; background: #fff; }
  .room-card .room-card-line { margin: 0 0 0.5rem; }
  .room-card .room-card-line:last-child { margin-bottom: 0; }
  a { color: #17493b; font-weight: 600; }
`;
