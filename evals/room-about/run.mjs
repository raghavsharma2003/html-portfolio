// WS-R97: the follower's transparency page (`/r/<slug>/about`, no migration).
//
//   node evals/room-about/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no model call. Drives the
// REAL `api/_room-about.js` (the read + the pure HTML builder) through a
// small hand-rolled fake `db`, `evals/creator-page/run.mjs`'s own shape one
// surface over.
//
// WHAT THIS PROVES:
//   1. `publicRoomAboutBySlug` admits a Room when published and unpaused -
//      unlike `/c/<slug>`, NEVER gated on `listed_at`: a follower who
//      already holds this Room's link must be able to read this page
//      whether or not the creator opted into the public directory.
//   2. `buildRoomAboutHtml` is pure: same input, same bytes, every time, in
//      both locales.
//   3. Every number on the page is the REAL imported constant, never a
//      typed literal - checked two ways: the rendered bytes carry the real
//      value, and a static source scan proves the import exists (so a
//      future edit that swaps the import for a hardcoded number fails this
//      suite even if nobody happened to change the fixture's own numbers to
//      something that would otherwise still match).
//   4. The retention section reads `room.dormancy_days`, never a platform
//      default, and renders different content when it is null.
//   5. hreflang/x-default/og:locale, `_creator-page.js`'s own WS-R90 shape.
//
// NEGATIVE CONTROL, this workstream's own law 4: a published-but-unlisted
// Room's page is NOT collapsed to the platform card (the one place this
// page's predicate deliberately differs from `/c/<slug>`'s), while an
// unpublished Room, a paused Room, and an unknown slug all ARE, and all
// three render BYTE IDENTICAL output - nobody may learn which of the three
// happened, or that any Room exists at all, from this page's shape.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const API = join(REPO, "api");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const { publicRoomAboutBySlug, buildRoomAboutHtml } = await import(pathToFileURL(join(API, "_room-about.js")).href);
const { PULSE_MIN_FOLLOWERS } = await import(pathToFileURL(join(API, "_pulse.js")).href);
const { DORMANCY_GRACE_DAYS } = await import(pathToFileURL(join(API, "_dormancy.js")).href);
const {
  ROOM_FREE_MONTHLY_MESSAGES, ROOM_PAID_MONTHLY_MESSAGES, ROOM_PAID_MONTHLY_VOICE_SECONDS,
} = await import(pathToFileURL(join(API, "_room-surface.js")).href);

function freshRoom(overrides = {}) {
  return {
    slug: "anjali-physics",
    display_name: "Anjali",
    default_locale: "en",
    dormancy_days: 365,
    free_monthly_messages: 20,
    paid_monthly_messages: 500,
    paid_monthly_voice_seconds: 1800,
    published_at: "2026-08-01T00:00:00.000Z",
    paused_at: null,
    listed_at: null, // deliberately unlisted - this page must still work
    ...overrides,
  };
}

/** A small, purpose-built fake `db`, matched on the exact SQL text
 *  `api/_room-about.js` actually sends - an unmatched statement throws, so a
 *  real drift between this fixture and the shipping SQL fails LOUD rather
 *  than returning an empty set that reads as "not found" (`evals/
 *  creator-page/run.mjs`'s own posture, restated). */
function makeDb(room) {
  return async (sql, params = []) => {
    if (sql.includes("from vy_room") && sql.includes("lower(slug) = $1") && sql.includes("published_at is not null")) {
      const [slug] = params.map(String);
      if (!room) return [];
      const match = room.slug.toLowerCase() === slug && room.published_at != null && room.paused_at == null;
      return match ? [{ ...room }] : [];
    }
    throw new Error(`evals/room-about/run.mjs fake db: unmatched SQL: ${sql}`);
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 1. THE PREDICATE: published + unpaused, NEVER listed_at
// ═════════════════════════════════════════════════════════════════════════
{
  const unlisted = freshRoom({ listed_at: null });
  const row = await publicRoomAboutBySlug(makeDb(unlisted), "anjali-physics");
  ok("a published, unpaused, UNLISTED Room is found (unlike /c/<slug>)", row?.slug === "anjali-physics");

  const unknown = await publicRoomAboutBySlug(makeDb(unlisted), "nobody-here");
  ok("an unknown slug returns null", unknown === null);

  const unpublished = freshRoom({ published_at: null });
  ok("an unpublished Room returns null", (await publicRoomAboutBySlug(makeDb(unpublished), "anjali-physics")) === null);

  const paused = freshRoom({ paused_at: "2026-09-02T00:00:00.000Z" });
  ok("a paused Room returns null", (await publicRoomAboutBySlug(makeDb(paused), "anjali-physics")) === null);

  const empty = await publicRoomAboutBySlug(async () => { throw new Error("must not query"); }, "");
  ok("an empty slug returns null before any query runs (slugOf refuses it at the door)", empty === null);
}

// ═════════════════════════════════════════════════════════════════════════
// 2. buildRoomAboutHtml: PURE, both locales
// ═════════════════════════════════════════════════════════════════════════
{
  const room = freshRoom();
  const htmlA = buildRoomAboutHtml(room, { origin: "https://vyakti.app", slug: "anjali-physics" });
  const htmlB = buildRoomAboutHtml(room, { origin: "https://vyakti.app", slug: "anjali-physics" });
  ok("buildRoomAboutHtml is pure: identical input, identical bytes", htmlA === htmlB);
  ok("carries the creator's name in the title", htmlA.includes("Anjali AI"));
  ok("the disclosure card's own three sentences are present", htmlA.includes("You are talking with Anjali AI. It is not Anjali."));
  ok("the join link points at /r/<slug>, no query string appended by this page", htmlA.includes('href="https://vyakti.app/r/anjali-physics">'));

  const htmlHi = buildRoomAboutHtml({ ...room, default_locale: "hi" }, { origin: "https://vyakti.app", slug: "anjali-physics" });
  ok('?lang= is honoured over the room default (English room, "hi" via lang)',
    buildRoomAboutHtml(room, { origin: "https://vyakti.app", slug: "anjali-physics", lang: "hi" }).includes('lang="hi"'));
  ok("a Hindi Room renders lang=hi", htmlHi.includes('lang="hi"'));
  ok("a Hindi Room's headings are in Hindi, not English", htmlHi.includes("आपका अपना दायरा") && !htmlHi.includes(">Your own scope<"));
}

// ═════════════════════════════════════════════════════════════════════════
// 3. EVERY NUMBER IS THE REAL IMPORTED CONSTANT
// ═════════════════════════════════════════════════════════════════════════
{
  const room = freshRoom();
  const html = buildRoomAboutHtml(room, { origin: "https://vyakti.app", slug: "anjali-physics" });
  ok("the creator-view sentence carries the real PULSE_MIN_FOLLOWERS floor", html.includes(`at least ${PULSE_MIN_FOLLOWERS} followers`));
  ok("the retention grace window carries the real DORMANCY_GRACE_DAYS", html.includes(`within ${DORMANCY_GRACE_DAYS} more days`));
  ok("the free cap carries the Room's own free_monthly_messages value", html.includes(`gets ${room.free_monthly_messages} messages a month`));
  ok("the paid messages figure carries the Room's own paid_monthly_messages value", html.includes(`${room.paid_monthly_messages} messages a month`));
  ok("the paid voice figure is the Room's own paid_monthly_voice_seconds, in minutes",
    html.includes(`up to ${Math.round(room.paid_monthly_voice_seconds / 60)} minutes`));

  // A Room row with NO overrides at all falls back to the platform defaults
  // - the real exported constants, never a second copy of their numbers.
  const bareRoom = { slug: "bare-room", display_name: "Bare", default_locale: "en", dormancy_days: null };
  const bareHtml = buildRoomAboutHtml(bareRoom, { origin: "https://vyakti.app", slug: "bare-room" });
  ok("a Room row with no free_monthly_messages falls back to ROOM_FREE_MONTHLY_MESSAGES",
    bareHtml.includes(`gets ${ROOM_FREE_MONTHLY_MESSAGES} messages a month`));
  ok("a Room row with no paid_monthly_messages falls back to ROOM_PAID_MONTHLY_MESSAGES",
    bareHtml.includes(`${ROOM_PAID_MONTHLY_MESSAGES} messages a month`));
  ok("a Room row with no paid_monthly_voice_seconds falls back to ROOM_PAID_MONTHLY_VOICE_SECONDS, in minutes",
    bareHtml.includes(`up to ${Math.round(ROOM_PAID_MONTHLY_VOICE_SECONDS / 60)} minutes`));

  // STATIC: a source scan proving these are real imports, never a literal
  // that happens to match today's fixture numbers.
  const src = readFileSync(join(API, "_room-about.js"), "utf8");
  ok("STATIC: PULSE_MIN_FOLLOWERS is imported from ./_pulse.js", /import\s*\{[^}]*\bPULSE_MIN_FOLLOWERS\b[^}]*\}\s*from\s*"\.\/_pulse\.js"/.test(src));
  ok("STATIC: DORMANCY_GRACE_DAYS is imported from ./_dormancy.js", /import\s*\{[^}]*\bDORMANCY_GRACE_DAYS\b[^}]*\}\s*from\s*"\.\/_dormancy\.js"/.test(src));
  ok("STATIC: the three cap constants are imported from ./_room-surface.js",
    /import\s*\{[^}]*\bROOM_FREE_MONTHLY_MESSAGES\b[^}]*\bROOM_PAID_MONTHLY_MESSAGES\b[^}]*\bROOM_PAID_MONTHLY_VOICE_SECONDS\b[^}]*\}\s*from\s*"\.\/_room-surface\.js"/.test(src));
}

// ═════════════════════════════════════════════════════════════════════════
// 4. RETENTION: the room's dormancy_days, not a platform default, and
//    different content when it is null
// ═════════════════════════════════════════════════════════════════════════
{
  const withPolicy = buildRoomAboutHtml(freshRoom({ dormancy_days: 365 }), { origin: "https://vyakti.app", slug: "anjali-physics" });
  ok("a year-long policy renders as 'a year', never a raw day count", withPolicy.includes("a year") && !withPolicy.includes("365 days"));

  const monthly = buildRoomAboutHtml(freshRoom({ dormancy_days: 180 }), { origin: "https://vyakti.app", slug: "anjali-physics" });
  ok("a 180-day policy renders as whole months", monthly.includes("6 months"));

  const noPolicy = buildRoomAboutHtml(freshRoom({ dormancy_days: null }), { origin: "https://vyakti.app", slug: "anjali-physics" });
  ok("no policy set renders the 'no automatic time limit' sentence", noPolicy.includes("has not set an automatic time limit"));
  ok("no policy set never mentions a duration or the grace window", !noPolicy.includes("more days") && !/kept until [^.]+ after/.test(noPolicy));

  // The forget-receipt sentence is UNCONDITIONAL - a follower can always ask,
  // whether or not the creator ever set a dormancy policy.
  ok("the receipt sentence is present whether or not a policy is set",
    withPolicy.includes("You get a receipt") && noPolicy.includes("You get a receipt"));
}

// ═════════════════════════════════════════════════════════════════════════
// 5. WS-R90's own shape: hreflang, x-default, og:locale
// ═════════════════════════════════════════════════════════════════════════
{
  const room = freshRoom();
  const html = buildRoomAboutHtml(room, { origin: "https://vyakti.app", slug: "anjali-physics" });
  for (const code of ["en", "hi", "x-default"]) {
    ok(`carries a hreflang="${code}" alternate link`, html.includes(`hreflang="${code}"`));
  }
  ok('hreflang="en" and "x-default" point at the SAME bare address',
    html.includes('<link rel="alternate" hreflang="en" href="https://vyakti.app/r/anjali-physics/about" />')
    && html.includes('<link rel="alternate" hreflang="x-default" href="https://vyakti.app/r/anjali-physics/about" />'));
  ok('hreflang="hi" points at the ?lang=hi address', html.includes('<link rel="alternate" hreflang="hi" href="https://vyakti.app/r/anjali-physics/about?lang=hi" />'));
  ok('an English render carries og:locale content="en_US"', html.includes('<meta property="og:locale" content="en_US" />'));
  const htmlHi = buildRoomAboutHtml(room, { origin: "https://vyakti.app", slug: "anjali-physics", lang: "hi" });
  ok('the same Room requested with ?lang=hi carries og:locale content="hi_IN"', htmlHi.includes('<meta property="og:locale" content="hi_IN" />'));

  const unknownHtml = buildRoomAboutHtml(null, { origin: "https://vyakti.app", slug: "nobody-here" });
  ok("the platform-only fallback still carries all three hreflang alternates",
    ["en", "hi", "x-default"].every((code) => unknownHtml.includes(`hreflang="${code}"`)));
}

// ═════════════════════════════════════════════════════════════════════════
// 6. NEGATIVE CONTROL: unpublished / paused / unknown all collapse to the
//    IDENTICAL platform-only card; an UNLISTED-but-published Room does not
// ═════════════════════════════════════════════════════════════════════════
{
  const unpublishedDb = makeDb(freshRoom({ published_at: null }));
  const pausedDb = makeDb(freshRoom({ paused_at: "2026-09-02T00:00:00.000Z" }));
  const unknownDb = makeDb(freshRoom());

  const unpublishedRoom = await publicRoomAboutBySlug(unpublishedDb, "anjali-physics");
  const pausedRoom = await publicRoomAboutBySlug(pausedDb, "anjali-physics");
  const unknownRoom = await publicRoomAboutBySlug(unknownDb, "nobody-has-this-slug");

  const htmlA = buildRoomAboutHtml(unpublishedRoom, { origin: "https://vyakti.app", slug: "x" });
  const htmlB = buildRoomAboutHtml(pausedRoom, { origin: "https://vyakti.app", slug: "x" });
  const htmlC = buildRoomAboutHtml(unknownRoom, { origin: "https://vyakti.app", slug: "x" });
  ok("NEGATIVE CONTROL: unpublished, paused, and unknown all render BYTE IDENTICAL output (same slug plugged in)",
    htmlA === htmlB && htmlB === htmlC);
  ok("that identical page names the platform, never a creator", htmlA.includes("Vyakti") && !htmlA.includes("Anjali"));

  const unlistedRoom = await publicRoomAboutBySlug(makeDb(freshRoom({ listed_at: null })), "anjali-physics");
  const unlistedHtml = buildRoomAboutHtml(unlistedRoom, { origin: "https://vyakti.app", slug: "x" });
  ok("an unlisted-but-published Room's page is DIFFERENT from the platform-only card (this page's own predicate, unlike /c/<slug>'s)",
    unlistedHtml !== htmlA);
  ok("the unlisted Room's page names the creator", unlistedHtml.includes("Anjali"));
}

// ═════════════════════════════════════════════════════════════════════════
// 7. vercel.json: the rewrite and headers entry exist
// ═════════════════════════════════════════════════════════════════════════
{
  const vercelConfig = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8"));
  const rewrite = vercelConfig.rewrites.find((r) => r.source === "/r/:slug/about");
  ok("vercel.json rewrites /r/:slug/about to api/room-about", rewrite?.destination === "/api/room-about?slug=:slug");

  const rewrites = vercelConfig.rewrites;
  const aboutIdx = rewrites.findIndex((r) => r.source === "/r/:slug/about");
  const catchallIdx = rewrites.findIndex((r) => r.source === "/r/:slug" && r.destination === "/room.html");
  ok("the /about rewrite is ordered BEFORE the generic /r/:slug catch-all (or Vercel would never reach it)",
    aboutIdx !== -1 && catchallIdx !== -1 && aboutIdx < catchallIdx);

  const headerRule = vercelConfig.headers.find((h) => h.source === "/r/:slug/about");
  ok("vercel.json's headers array carries a rule for /r/:slug/about", Boolean(headerRule));
  const csp = headerRule?.headers?.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
  ok("that CSP carries no 'unsafe-inline'/'unsafe-eval' in script-src (no script on this page at all)",
    !/script-src[^;]*unsafe-inline/.test(csp) && !/script-src[^;]*unsafe-eval/.test(csp));
}

// ═════════════════════════════════════════════════════════════════════════
// 8. NO EM DASH / EN DASH in any user-visible string this page renders
// ═════════════════════════════════════════════════════════════════════════
{
  const room = freshRoom();
  const htmlEn = buildRoomAboutHtml(room, { origin: "https://vyakti.app", slug: "anjali-physics" });
  const htmlHi = buildRoomAboutHtml({ ...room, default_locale: "hi" }, { origin: "https://vyakti.app", slug: "anjali-physics" });
  // Strip everything outside <body> before scanning - a dash inside a URL's
  // own scheme separator or a class attribute is not prose.
  const bodyOf = (html) => html.slice(html.indexOf("<body>"));
  ok("no em dash in the English render's body", !/—/.test(bodyOf(htmlEn)));
  ok("no en dash in the English render's body", !/–/.test(bodyOf(htmlEn)));
  ok("no em dash in the Hindi render's body", !/—/.test(bodyOf(htmlHi)));
  ok("no en dash in the Hindi render's body", !/–/.test(bodyOf(htmlHi)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
