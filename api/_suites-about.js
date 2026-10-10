// api/_suites-about.js — the Suite admin's transparency page at
// /suites/about (WS-R117). Server-rendered, publicly readable, no bearer
// token, no session: what a Suite is, what an admin sees once they attach a
// Room, what an admin never sees, what happens to a Room when a Suite
// lapses, and the seat price — `api/_room-about.js`'s own shape, one surface
// over, restated for the SAME reason that file's own header gives: this is
// the written promise an institute's admin should be able to read BEFORE
// they attach a Room, not after.
//
// ── NOT SLUG-SCOPED, NOT DB-BACKED ─────────────────────────────────────────
//
// Unlike `/r/<slug>/about`, this page describes no single Suite's own row —
// it is the platform's own standing promise, identical for every Suite that
// will ever exist. So there is no `db` parameter and no SQL at all: the
// whole page is `origin` and `lang` in, HTML out, exactly as pure as
// `buildRoomAboutHtml` but with no read step ahead of it. `evals/suites-
// about/run.mjs`'s own static import scan asserts this file imports neither
// `./_db.js` nor any follower-table-reading module, `_room-about.js`'s own
// header note ("no import of ./_db.js") restated for a file that needs no
// database access of any kind, not merely one routed through a parameter.
//
// ── EVERY NUMBER IS AN IMPORT, NEVER A TYPED LITERAL ──────────────────────
//
// `SUITE_SEAT_PRICE_STARTER_INR`/`SUITE_SEAT_PRICE_INSTITUTE_INR`/
// `SUITE_SEAT_PRICE_INSTITUTE_MIN_SEATS` (api/_org.js) and
// `PULSE_MIN_FOLLOWERS` (api/_pulse.js) are imported directly — an api-to-api
// import, `_room-about.js`'s own reasoning restated: this file and both of
// those are `api/` modules, so nothing here crosses the `src/` cannot-
// import-`api/` boundary `scripts/check-mirrors.mjs` polices, and a real
// import is a stronger guarantee than a marker-plus-scan pair approximates.
import { normalizeLocale } from "./_room-surface.js";
import { PLATFORM_TITLE, PLATFORM_DESCRIPTION } from "./_room-page.js";
import { PULSE_MIN_FOLLOWERS } from "./_pulse.js";
import {
  SUITE_SEAT_PRICE_STARTER_INR,
  SUITE_SEAT_PRICE_INSTITUTE_INR,
  SUITE_SEAT_PRICE_INSTITUTE_MIN_SEATS,
} from "./_org.js";

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────
// WS-R90/WS-R97's own shape, restated a third surface over: hreflang
// alternates, x-default, and og:locale. Named constants, not inline
// literals, so `scripts/probeLiveExpectations.mjs` can parse them straight
// out of this file's own source the same way it already does for
// `_creator-page.js` and `_room-about.js`.
// ─────────────────────────────────────────────────────────────────────────
const HREFLANG_CODES = ["en", "hi", "x-default"];
const HI_LANG_QUERY = "?lang=hi";
const OG_LOCALE = { en: "en_US", hi: "hi_IN" };

const inr = (n) => `₹${Number(n).toLocaleString("en-IN")}`;

// ─────────────────────────────────────────────────────────────────────────
// THE COPY — both locales, plain functional prose, no dash of any kind, and
// no word `scripts/check-copy.mjs`'s Rooms vocabulary rule bans (this file
// is not itself in that gate's scanned scope — `api/` is not — but every
// string here is written to the same standard by hand, `api/_room-about.js`'s
// own `PAGE_COPY` restated).
// ─────────────────────────────────────────────────────────────────────────
const PAGE_COPY = {
  en: {
    pageTitle: "Suites, what an admin can and cannot see",
    heading: "What a Suite is, and what its admin can see",
    whatIsLabel: "What a Suite is",
    whatIsBody:
      "A Suite is an organisation that pays for seats, one seat per Room. A coaching institute, a creator collective, or an agency can bring several creators' Rooms under one bill, with one admin who manages seats and money.",
    seesLabel: "What an admin sees",
    seesBody:
      "A Suite admin sees the Rooms attached to their own Suite, how many seats are used against how many are paid for, who else administers or belongs to the Suite, and the Suite's own billing state. Nothing here is a follower's own data.",
    neverSeesLabel: "What an admin never sees",
    neverSeesBody: (n) =>
      `A Suite admin never reads a follower's words, and never learns a follower's identity. Even where a creator's own Room shows a shared topic as a count, that count only ever appears to the creator, and only once at least ${n} followers show a similar interest, never verbatim and never named. A Suite admin sees none of that at all, not even as a count.`,
    lapseLabel: "If a Suite's payment lapses",
    lapseBody:
      "A Room already attached to a Suite keeps its seat and stays exactly as it was. Nothing a creator published is ever removed because an institute's card stopped working. A lapsed Suite simply cannot admit a new Room until it starts paying again.",
    priceLabel: "Seat price",
    priceStarterBody: (label) => `A Starter Suite costs ${label} per seat a month.`,
    priceInstituteBody: (label, minSeats) =>
      `An Institute Suite costs ${label} per seat a month, once a Suite carries at least ${minSeats} seats.`,
    linkBack: "Back to Suites",
  },
  hi: {
    pageTitle: "Suites, एक एडमिन क्या देख सकता है और क्या नहीं",
    heading: "Suite क्या है, और उसका एडमिन क्या देख सकता है",
    whatIsLabel: "Suite क्या है",
    whatIsBody:
      "Suite एक ऐसा संगठन है जो सीटों के लिए भुगतान करता है, हर Room के लिए एक सीट। एक कोचिंग संस्थान, क्रिएटर्स का एक समूह, या एक एजेंसी कई क्रिएटर के Room एक ही बिल के तहत ला सकती है, जिसका एक एडमिन सीटों और पैसों का प्रबंधन करता है।",
    seesLabel: "एडमिन क्या देख सकता है",
    seesBody:
      "एक Suite एडमिन अपने Suite से जुड़े Room, कितनी सीटें इस्तेमाल हो रही हैं बनाम कितनी सीटों का भुगतान हुआ है, Suite का प्रबंधन या सदस्यता कौन और रखता है, और Suite की अपनी बिलिंग स्थिति देख सकता है। यहां कुछ भी किसी फॉलोअर का अपना डेटा नहीं है।",
    neverSeesLabel: "एडमिन कभी क्या नहीं देख सकता",
    neverSeesBody: (n) =>
      `एक Suite एडमिन कभी किसी फॉलोअर के शब्द नहीं पढ़ता, और कभी किसी फॉलोअर की पहचान नहीं जानता। जहां किसी क्रिएटर का अपना Room किसी साझा विषय को गिनती के रूप में दिखाता है, वह गिनती भी सिर्फ उस क्रिएटर को दिखती है, और तभी जब कम से कम ${n} फॉलोअर एक जैसी रुचि दिखाएं, कभी शब्दशः नहीं और कभी नाम के साथ नहीं। एक Suite एडमिन इसमें से कुछ भी नहीं देखता, गिनती के रूप में भी नहीं।`,
    lapseLabel: "अगर Suite का भुगतान रुक जाए",
    lapseBody:
      "Suite से पहले से जुड़ा हुआ Room अपनी सीट बनाए रखता है और बिल्कुल वैसा ही रहता है। किसी क्रिएटर द्वारा प्रकाशित कुछ भी किसी संस्थान का कार्ड काम न करने की वजह से कभी नहीं हटाया जाता। एक रुका हुआ Suite बस तब तक कोई नया Room शामिल नहीं कर सकता जब तक वह फिर से भुगतान शुरू न करे।",
    priceLabel: "सीट की कीमत",
    priceStarterBody: (label) => `एक Starter Suite की कीमत ${label} प्रति सीट प्रति माह है।`,
    priceInstituteBody: (label, minSeats) =>
      `एक Institute Suite की कीमत ${label} प्रति सीट प्रति माह है, एक बार जब Suite में कम से कम ${minSeats} सीटें हो जाएं।`,
    linkBack: "Suites पर वापस जाएं",
  },
};

// ─────────────────────────────────────────────────────────────────────────
// THE PAGE — PURE. `lang` is the raw `?lang=` query value; `normalizeLocale`
// decides.
// ─────────────────────────────────────────────────────────────────────────
export function buildSuitesAboutHtml({ origin, lang } = {}) {
  const base = String(origin || "").replace(/\/+$/, "");
  const path = "/suites/about";
  const url = base ? `${base}${path}` : path;
  const hreflangHiUrl = `${url}${HI_LANG_QUERY}`;
  const locale = normalizeLocale(lang);
  const c = PAGE_COPY[locale];

  const body = `<main>
    <h1>${esc(c.heading)}</h1>

    <section aria-labelledby="about-what-title">
      <h2 id="about-what-title">${esc(c.whatIsLabel)}</h2>
      <p>${esc(c.whatIsBody)}</p>
    </section>

    <section aria-labelledby="about-sees-title">
      <h2 id="about-sees-title">${esc(c.seesLabel)}</h2>
      <p>${esc(c.seesBody)}</p>
    </section>

    <section aria-labelledby="about-never-sees-title">
      <h2 id="about-never-sees-title">${esc(c.neverSeesLabel)}</h2>
      <p>${esc(c.neverSeesBody(String(PULSE_MIN_FOLLOWERS)))}</p>
    </section>

    <section aria-labelledby="about-lapse-title">
      <h2 id="about-lapse-title">${esc(c.lapseLabel)}</h2>
      <p>${esc(c.lapseBody)}</p>
    </section>

    <section aria-labelledby="about-price-title">
      <h2 id="about-price-title">${esc(c.priceLabel)}</h2>
      <p>${esc(c.priceStarterBody(inr(SUITE_SEAT_PRICE_STARTER_INR)))}</p>
      <p>${esc(c.priceInstituteBody(inr(SUITE_SEAT_PRICE_INSTITUTE_INR), String(SUITE_SEAT_PRICE_INSTITUTE_MIN_SEATS)))}</p>
    </section>

    <p><a href="${esc(base)}/suites">${esc(c.linkBack)}</a></p>
  </main>`;

  return renderPage({ title: c.pageTitle, description: PLATFORM_DESCRIPTION, url, hreflangHiUrl, locale, body });
}

function renderPage({ title, description, url, hreflangHiUrl, locale, body }) {
  const t = esc(`${PLATFORM_TITLE} - ${title}`);
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

/** Plain, small, no build step — `api/_room-about.js`'s own `PAGE_STYLE`,
 *  restated with this page's own class names, for the identical reason that
 *  file's own comment gives. Zero script, zero web font. */
const PAGE_STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem 3rem; max-width: 40rem; margin-inline: auto;
    background: #f4f1e9; color: #171915;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Devanagari", sans-serif;
  }
  h1 { font-size: 1.5rem; margin: 0 0 1.5rem; }
  h2 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; }
  p { margin: 0 0 0.75rem; }
  a { color: #17493b; font-weight: 600; }
`;
