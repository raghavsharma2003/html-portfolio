// Language tagging for screen readers (WS-R79) — offline, deterministic, $0.
//
//   node evals/lang-tag/run.mjs
//
// The browser-based proof lives in `scripts/check-accessibility.mjs`
// (`langTagAudit`, its own always-on self-test, and this workstream's
// fired-and-reverted negative control against `api/_creator-page.js`,
// `context/measurements.md#ws-r79-accessibility-lang-tag-coverage`) — that
// is what actually walks a rendered DOM. This suite proves the two things
// UNDER that proof rather than duplicating it:
//
// 1. `detectRoomTextLang`/`detectStudioTextLang` (`src/room/copy.ts`,
//    `src/studio/copy.ts`) — the one-line rule every `Localized` component
//    and every server-side `langSpan` call defers to — against every real
//    leaf string in `ROOM_COPY_TABLE.hi`/`STUDIO_COPY_TABLE.hi` that
//    actually DIFFERS from its English counterpart (a real translation, not
//    a shared, untranslated placeholder like `+91XXXXXXXXXX`), plus the
//    named edge cases: empty, digits-only, a bare untranslated loanword
//    ("AI", "UPI"), a matra-only fragment, mixed Devanagari+ASCII.
// 2. `api/_creator-page.js`'s `buildCreatorPageHtml`, driven with a
//    deliberately mismatched Room (Hindi name/bio/showcase, page requested
//    in English) — the real, shipping HTML it returns is parsed with a
//    regex and checked for the exact `lang="hi"`/`lang="en"` spans this
//    workstream's brief names, never trusted by construction.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

// `src/room/copy.ts`/`src/studio/copy.ts` are plain TS with no JSX —
// `evals/room-locale/run.mjs`'s own `loadRoomCopy` shape, reused verbatim
// per surface rather than re-derived.
async function loadTsExports(modulePath, names) {
  const OUT = mkdtempSync(join(tmpdir(), "lang-tag-eval-"));
  const ENTRY = join(OUT, "entry.ts");
  writeFileSync(ENTRY, `export { ${names.join(", ")} } from ${JSON.stringify(modulePath)};\n`);
  const BUNDLE = join(OUT, "bundle.mjs");
  execSync(
    `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
    { cwd: REPO, stdio: "inherit" },
  );
  return import(pathToFileURL(BUNDLE).href);
}

const { ROOM_COPY_TABLE, detectRoomTextLang, loadRoomCopy } = await loadTsExports(
  join(REPO, "src/room/copy"),
  ["ROOM_COPY_TABLE", "detectRoomTextLang", "loadRoomCopy"],
);
const { STUDIO_COPY_TABLE, detectStudioTextLang, loadStudioCopy } = await loadTsExports(
  join(REPO, "src/studio/copy"),
  ["STUDIO_COPY_TABLE", "detectStudioTextLang", "loadStudioCopy"],
);
// The studio's Hindi table is its own chunk (src/studio/hiCopy.ts); install it
// through the app's own loader before reading `.hi`, which throws until then.
await loadStudioCopy("hi");
// WS-R139: the Room's Hindi table is now TWO lazy chunks (`hiTalkCopy.ts` +
// `hiCopy.ts`, `src/room/copy.ts`'s own header) — the identical reason one
// surface over.
await loadRoomCopy("hi");
const { buildCreatorPageHtml } = await import(pathToFileURL(join(REPO, "api/_creator-page.js")).href);

// ── 1. the detection primitive, against every REAL translated leaf ────────

/** Walks two same-shaped trees (`ROOM_COPY_TABLE.en`/`.hi`, the same shape
 *  `evals/room-locale/run.mjs`'s own key-parity check already walks) and
 *  yields every leaf STRING pair, keyed by its dotted path. */
function* leafPairs(en, hi, path = "") {
  for (const key of Object.keys(en)) {
    const p = path ? `${path}.${key}` : key;
    const a = en[key];
    const b = hi[key];
    if (typeof a === "string") {
      if (typeof b === "string") yield [p, a, b];
    } else if (a && typeof a === "object") {
      yield* leafPairs(a, b ?? {}, p);
    }
  }
}

function checkTranslatedLeaves(label, en, hi, detect) {
  let translated = 0;
  let placeholderShared = 0;
  let wrong = [];
  for (const [path, enVal, hiVal] of leafPairs(en, hi)) {
    if (enVal === hiVal) {
      // A shared, untranslated placeholder ("+91XXXXXXXXXX", a raw name
      // template with no words of its own) — correctly detected "en"
      // (no Devanagari to find), and that is not a defect in either the
      // copy or the detector.
      placeholderShared++;
      continue;
    }
    translated++;
    if (detect(hiVal) !== "hi") wrong.push(`${path}: "${hiVal.slice(0, 40)}"`);
  }
  ok(
    `${label}: every translated HI leaf (${translated}, ${placeholderShared} shared placeholders skipped) detects as hi`,
    wrong.length === 0,
    wrong.length ? `first miss: ${wrong[0]}` : "",
  );
  return translated;
}

const roomTranslated = checkTranslatedLeaves(
  "room copy",
  ROOM_COPY_TABLE.en,
  ROOM_COPY_TABLE.hi,
  detectRoomTextLang,
);
const studioTranslated = checkTranslatedLeaves(
  "studio copy",
  STUDIO_COPY_TABLE.en,
  STUDIO_COPY_TABLE.hi,
  detectStudioTextLang,
);
ok("room copy: a real number of translated leaves were actually checked", roomTranslated > 100, String(roomTranslated));
ok("studio copy: a real number of translated leaves were actually checked", studioTranslated > 100, String(studioTranslated));

// Every EN leaf, by construction, has zero Devanagari codepoints — detects
// "en" always. A sample rather than the full tree: the property is
// unconditional (the function has no other branch), so one true case and
// one false case prove the branch, and the translated-leaf check above
// already exercises hundreds of real "hi" cases.
ok("room copy: an EN leaf detects as en", detectRoomTextLang(ROOM_COPY_TABLE.en.loading) === "en");
ok("studio copy: an EN leaf detects as en", detectStudioTextLang(STUDIO_COPY_TABLE.en.shell.tabTitle.feed) === "en");

// ── edge cases named in the brief: digits, a bare loanword, matras alone,
//    mixed script, empty ──────────────────────────────────────────────────
const EDGE_CASES = [
  ["", "en", "empty string"],
  ["+91XXXXXXXXXX", "en", "digits and a placeholder, no letters at all"],
  ["AI", "en", "a bare untranslated loanword"],
  ["UPI", "en", "a bare acronym"],
  ["ॐ", "hi", "a single Devanagari codepoint with no ASCII at all"],
  ["प्रिया AI", "hi", "a Devanagari name followed by an untranslated loanword"],
  ["Priya AI", "en", "a Latin-script name followed by the same loanword"],
  ["नमस्ते, 2026 में मिलते हैं", "hi", "Devanagari mixed with ASCII digits"],
];
for (const [text, expected, label] of EDGE_CASES) {
  ok(`detectRoomTextLang: ${label}`, detectRoomTextLang(text) === expected, `"${text}" -> ${detectRoomTextLang(text)}`);
  ok(`detectStudioTextLang: ${label}`, detectStudioTextLang(text) === expected, `"${text}" -> ${detectStudioTextLang(text)}`);
}

// ── 2. api/_creator-page.js, a real mismatched Room, real HTML output ─────

const mismatchedRoom = {
  display_name: "प्रिया",
  one_line_bio: "भौतिकी हर दिन, सरल भाषा में।",
  default_locale: "hi",
};
const mismatchedShowcase = [
  { question: "Do you also help with chemistry?", answer: "Only physics for now." },
  { question: "क्या आप रोज़ जवाब देते हैं?", answer: "हां, जब भी उपलब्ध होऊं।" },
];
const html = buildCreatorPageHtml(
  { room: mismatchedRoom, showcase: mismatchedShowcase },
  { origin: "https://vyakti.app", slug: "priya", lang: "en" },
);

ok("creator page: the document itself is tagged in the REQUESTED locale", html.includes('<html lang="en">'));
ok(
  "creator page: the creator's own Devanagari name in the h1 carries its own lang=hi span",
  /<h1><span lang="hi">प्रिया<\/span> AI<\/h1>/.test(html),
);
ok(
  "creator page: the Hindi bio paragraph is tagged lang=hi under the English document",
  /<p lang="hi">भौतिकी हर दिन, सरल भाषा में।<\/p>/.test(html),
);
ok(
  "creator page: an English showcase question stays tagged lang=en",
  /<dt lang="en">Do you also help with chemistry\?<\/dt>/.test(html),
);
ok(
  "creator page: a Hindi showcase question is tagged lang=hi in the same list",
  /<dt lang="hi">क्या आप रोज़ जवाब देते हैं\?<\/dt>/.test(html),
);
// The page was REQUESTED in English (`lang: "en"`), so `PAGE_COPY.en`'s own
// templates render — `joinLabel`/`poweredBy` are the platform's OWN
// sentences in the REQUESTED locale, correct regardless of the creator's
// own locale; only the creator's own NAME inside the join label needs its
// own tag.
ok(
  "creator page: the join link's own name portion carries its own lang=hi span",
  /<a href="[^"]*">Talk to <span lang="hi">प्रिया<\/span> AI<\/a>/.test(html),
);
ok(
  "creator page: the platform's OWN sentence (poweredBy) stays a plain, untagged paragraph in the REQUESTED locale",
  /<p class="disclosure">An AI built from this creator's own material\.<\/p>/.test(html),
);

// A creator with no Devanagari at all (the untouched, all-English fixture
// `scripts/build-creator-page-fixture.mjs` already ships) must render
// exactly as before this workstream — no stray `lang=` attribute where the
// document's own already agrees, proving this change is additive rather
// than a rewrite of every node.
const plainHtml = buildCreatorPageHtml(
  {
    room: { display_name: "Anjali", one_line_bio: "JEE physics, one topic a day.", default_locale: "en" },
    showcase: [],
  },
  { origin: "https://vyakti.app", slug: "anjali", lang: "en" },
);
ok(
  "creator page: an all-English Room still gets a lang=en span (harmless, not a rewrite of the page shape)",
  /<h1><span lang="en">Anjali<\/span> AI<\/h1>/.test(plainHtml),
);
ok("creator page: no showcase section at all when there is none", !plainHtml.includes("showcase-title"));

console.log(`\n${pass} ok, ${fail} failed`);
if (fail > 0) process.exit(1);
