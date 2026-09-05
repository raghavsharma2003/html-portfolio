// The share kit (WS-R85, migration 122) — offline, deterministic, $0, no DB,
// no network, no model call, no GPU.
//
//   node evals/share-kit/run.mjs
//
// Drives the REAL `buildShareKit`/`SHARE_KIT_CHANNELS`/`SHARE_KIT_LIMITS`/
// `SHARE_KIT_PICTURE`/`SHARE_KIT_COPY`/`ShareKitError` (`api/_share-kit.js`,
// a pure builder — no fake `db` needed, the identical `api/_room-card.js`
// posture one file over). Proves:
//
//   1. THE FOUR CHANNELS, BOTH LOCALES. Every one of whatsapp/instagram/
//      youtube/telegram is present, its text is under that platform's own
//      `SHARE_KIT_LIMITS` entry, its url is `<origin>/r/<slug>?via=<channel>`
//      with `<channel>` a member of `api/_room-surface.js`'s own
//      `ROOM_ARRIVAL_VIA` (migration 122's own CHECK, cross-checked below the
//      same way `evals/room-share/run.mjs`'s own §3 cross-checks migration
//      121's poster value), and its picture matches the brief's own mapping
//      (the story card for WhatsApp and Telegram, the og image for YouTube,
//      none for Instagram).
//   2. NOTHING IS PROMISED BEFORE READINESS PASSES. `buildShareKit` returns
//      `null` for a Room whose `publishedAt` is falsy — nothing honest to
//      hand a creator to paste into a WhatsApp group for a Room that is not
//      actually reachable yet.
//   3. THE TEXT NEVER NAMES A FOLLOWER (static). A scan of this file's own
//      source finds no follower/session/person/thread identifier — proven by
//      first showing the SAME scan catches a poisoned fixture.
//   4. COPY PARITY. `SHARE_KIT_COPY` is byte-identical, both locales, to the
//      REAL `src/studio/copy.ts`/`hiCopy.ts` `shareKit` section —
//      `evals/studio-locale/run.mjs`'s own esbuild-bundle technique,
//      `loadStudioCopy("hi")` awaited before `.hi` is read
//      (`context/decisions.md#studio-hindi-table-is-its-own-chunk`).
//   5. NEGATIVE CONTROLS: (a) a text over its channel's own limit THROWS
//      `ShareKitError('share_kit_text_over_limit', ...)` rather than
//      truncating; (b) a `via` outside `ROOM_ARRIVAL_VIA`'s allowlist is
//      refused by the real `resolveArrivalVia` before it would ever reach
//      SQL — the arrival write's own defence, exercised here against every
//      one of this kit's four channel names to prove they all actually pass
//      it (the thing this whole workstream exists to make true); (c) a
//      drifted copy of one template is caught by the same parity comparator
//      §4 already proved bites.
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const API = join(REPO, "api");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const {
  buildShareKit,
  SHARE_KIT_CHANNELS,
  SHARE_KIT_LIMITS,
  SHARE_KIT_PICTURE,
  SHARE_KIT_COPY,
  ShareKitError,
} = await import(pathToFileURL(join(API, "_share-kit.js")).href);
const { ROOM_ARRIVAL_VIA, resolveArrivalVia } = await import(pathToFileURL(join(API, "_room-surface.js")).href);

const ORIGIN = "https://vyakti-silk.vercel.app";
const NAME = "Anjali Physics";
const SLUG = "anjali-physics";
const PUBLISHED_AT = "2026-09-01T00:00:00.000Z";

// ═══ 1. THE FOUR CHANNELS, BOTH LOCALES ═════════════════════════════════════
console.log("\n── 1. the four channels, en and hi ──");
for (const locale of ["en", "hi"]) {
  const kit = buildShareKit({ name: NAME, slug: SLUG, locale, origin: ORIGIN, publishedAt: PUBLISHED_AT });
  ok(`${locale}: a published Room returns a kit, not null`, Array.isArray(kit));
  ok(`${locale}: exactly the four named channels, in SHARE_KIT_CHANNELS' own order`,
    kit.map((r) => r.channel).join(",") === SHARE_KIT_CHANNELS.join(","));
  for (const row of kit) {
    ok(`${locale}/${row.channel}: text is under its own platform limit`,
      row.text.length <= SHARE_KIT_LIMITS[row.channel], `${row.text.length}/${SHARE_KIT_LIMITS[row.channel]}`);
    ok(`${locale}/${row.channel}: text carries the creator's own name`, row.text.includes(NAME));
    ok(`${locale}/${row.channel}: text carries the built url`, row.text.includes(row.url));
    ok(`${locale}/${row.channel}: url is <origin>/r/<slug>?via=<channel>`,
      row.url === `${ORIGIN}/r/${SLUG}?via=${row.channel}`);
    ok(`${locale}/${row.channel}: via is a member of ROOM_ARRIVAL_VIA (migration 122's own CHECK)`,
      ROOM_ARRIVAL_VIA.includes(row.channel));
    ok(`${locale}/${row.channel}: picture matches the brief's own mapping`,
      row.picture === SHARE_KIT_PICTURE[row.channel]);
  }
  ok(`${locale}: whatsapp and telegram both link the story card`,
    kit.find((r) => r.channel === "whatsapp").picture === "story" &&
      kit.find((r) => r.channel === "telegram").picture === "story");
  ok(`${locale}: youtube links the og image`, kit.find((r) => r.channel === "youtube").picture === "og");
  ok(`${locale}: instagram links no picture at all`, kit.find((r) => r.channel === "instagram").picture === null);
}

// ═══ 2. NOTHING IS PROMISED BEFORE READINESS PASSES ═════════════════════════
console.log("\n── 2. an unpublished Room gets no kit ──");
{
  const noPublishedAt = buildShareKit({ name: NAME, slug: SLUG, locale: "en", origin: ORIGIN, publishedAt: null });
  ok("publishedAt: null -> null, never a kit for a Room nobody can actually reach",
    noPublishedAt === null);
  const undefinedPublishedAt = buildShareKit({ name: NAME, slug: SLUG, locale: "en", origin: ORIGIN });
  ok("publishedAt omitted entirely -> null, the same honest refusal", undefinedPublishedAt === null);
  const emptyName = buildShareKit({ name: "", slug: SLUG, locale: "en", origin: ORIGIN, publishedAt: PUBLISHED_AT });
  ok("an empty name -> null (nothing coherent to build), never a kit naming nobody", emptyName === null);
}

// ═══ 3. THE TEXT NEVER NAMES A FOLLOWER (static) ════════════════════════════
console.log("\n── 3. static: no follower/session/person/thread identifier reachable ──");
{
  const dangerous = /session|follower|person_?id|token|thread/i;
  // Comments in this file's own header prose FREELY discuss "why there is
  // no follower field" (that is the whole point of the law being proven) —
  // so the scan runs over CODE only, `scripts/check-copy.mjs`'s own
  // `stripJsComments` reasoning restated in miniature: this is a static
  // reachability check on identifiers a running function could actually
  // touch, not a word ban on the file's own English.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const src = stripComments(readFileSync(join(API, "_share-kit.js"), "utf8"));
  // NEGATIVE CONTROL FIRST: the same scan catches a poisoned fixture before
  // trusting it against the real file — `evals/room-share/run.mjs`'s own §5a
  // shape.
  const poisoned = `export function leak(followerId) { return followerId; }`;
  ok("NEGATIVE CONTROL: the follower-identifier scan catches a poisoned fixture", dangerous.test(poisoned));
  ok("api/_share-kit.js's own CODE (comments stripped) names no follower id, session, person id, token, or thread",
    !dangerous.test(src), src.match(dangerous)?.[0]);
}

// ═══ 4. COPY PARITY ══════════════════════════════════════════════════════════
console.log("\n── 4. SHARE_KIT_COPY is byte-identical to the REAL src/studio/copy.ts + hiCopy.ts ──");
{
  // `evals/studio-locale/run.mjs`'s own technique: `copy.ts` is plain TS with
  // no JSX, bundled with esbuild rather than imported directly (this file
  // cannot import a `.ts` module any more than `api/_share-kit.js` itself
  // can — the same boundary, crossed to read the REAL export instead of
  // trusting a copy of its text).
  const OUT = mkdtempSync(join(tmpdir(), "share-kit-copy-eval-"));
  const ENTRY = join(OUT, "entry.ts");
  writeFileSync(
    ENTRY,
    `export { STUDIO_COPY_TABLE, loadStudioCopy } from ${JSON.stringify(join(REPO, "src/studio/copy"))};\n`,
  );
  const BUNDLE = join(OUT, "copy.bundle.mjs");
  execSync(
    `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
    { cwd: REPO, stdio: "inherit" },
  );
  const { STUDIO_COPY_TABLE, loadStudioCopy: installStudioCopy } = await import(pathToFileURL(BUNDLE).href);
  // The Hindi table is its own chunk since the WS-R71 merge
  // (src/studio/hiCopy.ts, context/decisions.md#studio-hindi-table-is-its-
  // own-chunk): `STUDIO_COPY_TABLE.hi` throws until the app's own loader
  // has installed it, so this eval installs it the same way the app does.
  await installStudioCopy("hi");

  const CHANNEL_KEY = { whatsapp: "whatsappTemplate", instagram: "instagramTemplate", youtube: "youtubeTemplate", telegram: "telegramTemplate" };
  for (const locale of ["en", "hi"]) {
    const real = STUDIO_COPY_TABLE[locale].shareKit;
    const mine = SHARE_KIT_COPY[locale];
    for (const channel of SHARE_KIT_CHANNELS) {
      ok(`SHARE_KIT_COPY.${locale}.${channel} matches the REAL src/studio/copy.ts shareKit.${CHANNEL_KEY[channel]}`,
        mine[channel] === real[CHANNEL_KEY[channel]]);
    }
  }

  // NEGATIVE CONTROL: the comparator above actually bites.
  const poisonedCopy = { ...SHARE_KIT_COPY.en, whatsapp: "Submit" };
  ok("NEGATIVE CONTROL: a drifted copy of the whatsapp template is caught by the same comparator",
    poisonedCopy.whatsapp !== STUDIO_COPY_TABLE.en.shareKit.whatsappTemplate);
}

// ═══ 5b. NEGATIVE CONTROLS (over-limit throw, via allowlist) ════════════════
console.log("\n── 5. negative controls: over-limit throw, via allowlist ──");
{
  const longName = "A".repeat(400);
  let threw = null;
  try {
    buildShareKit({ name: longName, slug: SLUG, locale: "en", origin: ORIGIN, publishedAt: PUBLISHED_AT });
  } catch (e) {
    threw = e;
  }
  ok("NEGATIVE CONTROL: a text over its channel's own limit THROWS ShareKitError, never truncates",
    threw instanceof ShareKitError && threw.code === "share_kit_text_over_limit");
  ok("the thrown error names which channel and by how much", threw?.details?.channel === "whatsapp" && threw?.details?.length > threw?.details?.limit);

  for (const channel of SHARE_KIT_CHANNELS) {
    ok(`resolveArrivalVia round-trips '${channel}' unchanged (the arrival write's own allowlist admits every kit channel)`,
      resolveArrivalVia(channel) === channel);
  }
  ok("a via NOT in this kit's own four (nor any of the other six existing values) becomes 'direct' before it reaches SQL",
    resolveArrivalVia("newsletter") === "direct");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
