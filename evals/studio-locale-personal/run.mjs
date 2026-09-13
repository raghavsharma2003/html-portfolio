// The PERSONAL studio in Hindi (WS-R159) — offline, deterministic, $0.
//
//   node evals/studio-locale-personal/run.mjs
//
// `evals/studio-locale/run.mjs` (WS-R52 onward) already proves
// `src/creatorStudio/copy.ts`'s Hindi table byte for byte; this suite proves
// the SEPARATE, new personal-studio registry this workstream built
// (`src/studio/copy.ts` / `hiCopy.ts` — two different products since Codex's
// handoff206 rename moved the wave-era creator studio from `src/studio/` to
// `src/creatorStudio/` and gave `src/studio/` a new, unrelated meaning: the
// personal journey, `context/decisions.md
// #ws-r159-mixed-copy-regex-matched-the-wrong-studio`). Reused, not
// re-derived: `evals/studio-locale/jsx-text.mjs`'s `literalEnglishTextNodes`
// scanner and `scripts/check-copy.mjs`'s real `scanSource`, the SAME two
// tools that suite already trusts.
//
// 1. KEY PARITY. `STUDIO_COPY_TABLE.en` and `.hi` carry the exact same keys
//    at every level, asserted against the REAL export (bundled with esbuild,
//    the Hindi chunk installed through the real `loadStudioCopy` loader).
// 2. THE STATIC SCAN. Every file this workstream actually converted
//    (`TIER_1_FILES`) carries zero literal JSX text nodes of three or more
//    words not routed through `copy.` / `t.`. Every OTHER file the brief
//    named is in `TIER_2_ALLOWLIST`, one entry per file with the reason it
//    was not converted this session — this suite's own completeness check is
//    scoped to exactly the files THIS brief named, never the whole
//    `src/studio/` directory: nine sibling workstreams (WS-R151..WS-R160
//    minus this one) edit other personal-studio files in the same window,
//    and a directory-wide scan would fail on their in-flight work rather
//    than on anything this workstream shipped.
// 3. THREE NEGATIVE CONTROLS, `evals/studio-locale/run.mjs`'s own shape one
//    file over: (a) a Hindi string with an em dash fails the dash rule; (b)
//    a Hindi string containing क्लोन fails the rooms-vocabulary rule when
//    the scanner is asked to apply it (`roomsVocab: true`) — this file's own
//    real strings are NOT under that rule today by path
//    (`context/decisions.md#ws-r159-tier-1-scope-and-tier-2-allowlist`
//    explains why: private expert-preparation copy is exempt, only
//    Room-recipient/Room-publishing surfaces are held to it), but the words
//    are avoided anyway and this control proves the scanner still bites
//    Hindi exactly as English when asked to; (c) every REAL Hindi string
//    this workstream shipped, run through the real scanner with the general
//    (non-rooms-vocabulary) rules, trips nothing.
// 4. THE LOCALE ORDER. `resolveStudioLocale` (shared with
//    `src/creatorStudio/`, not reimplemented) called with `replica: null`
//    always — the personal studio's own `Replica` type carries no `locale`
//    column and this workstream ships no migration, so the chain here is
//    one step shorter than the creator studio's own order:
//    `?lang=` -> remembered choice -> `"en"`.
// 5. THE LOADER. A fresh module instance: reading any section before
//    `loadStudioCopy("hi")` runs throws `studio_personal_copy_hi_not_loaded`
//    by name; after it resolves, every section (including `personalAuth`,
//    merged in from the EXISTING `personalAuthCopyRegistry.ts` loader, not
//    re-fetched or re-translated) reads real Hindi text.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { literalEnglishTextNodes } from "../studio-locale/jsx-text.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const STUDIO_DIR = join(REPO, "src/studio");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const checkCopy = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);
const { scanSource } = checkCopy;

function bundleAndImport(exportsLine, name) {
  const OUT = mkdtempSync(join(tmpdir(), `studio-locale-personal-${name}-`));
  const ENTRY = join(OUT, "entry.ts");
  writeFileSync(ENTRY, exportsLine);
  const BUNDLE = join(OUT, "bundle.mjs");
  execSync(
    `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
    { cwd: REPO, stdio: "inherit" },
  );
  return import(pathToFileURL(BUNDLE).href);
}

async function loadStudioCopyModule() {
  return bundleAndImport(
    `export { STUDIO_COPY_TABLE, studioCopyReady, loadStudioCopy } from ${JSON.stringify(join(REPO, "src/studio/copy"))};\n`,
    "copy",
  );
}

const { STUDIO_COPY_TABLE, loadStudioCopy: installStudioCopy } = await loadStudioCopyModule();
// `STUDIO_COPY_TABLE.hi` throws until installed (`copy.ts`'s own Proxy,
// the WS-R71 shape restated for this registry) — install it the same way
// the app does, never by importing `hiCopy.ts` around the loader.
await installStudioCopy("hi");

// ── 1. KEY PARITY ────────────────────────────────────────────────────────
{
  function paths(obj, prefix = "") {
    const out = [];
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) out.push(`${p}[${v.length}]`);
      else if (v && typeof v === "object") out.push(...paths(v, p));
      else out.push(p);
    }
    return out.sort();
  }

  const enPaths = paths(STUDIO_COPY_TABLE.en);
  const hiPaths = paths(STUDIO_COPY_TABLE.hi);
  ok("en and hi carry the exact same key set", JSON.stringify(enPaths) === JSON.stringify(hiPaths),
    enPaths.length !== hiPaths.length ? `en has ${enPaths.length} leaves, hi has ${hiPaths.length}` : "");
  ok("the table is not empty (personalAuth plus four new sections)", enPaths.length > 40, `${enPaths.length} leaves`);
  ok("personalAuth merges in from the EXISTING registry (its own known-blank keys stay blank in both locales)",
    STUDIO_COPY_TABLE.en.personalAuth.variant.generic.introEyebrow === "" &&
    STUDIO_COPY_TABLE.hi.personalAuth.variant.generic.introEyebrow === "");

  const KNOWN_BLANK_KEYS = new Set([
    "personalAuth.variant.generic.introEyebrow",
    "personalAuth.variant.teacher.introEyebrow",
    "personalAuth.variant.test.introEyebrow",
  ]);
  for (const [label, table] of [["en", STUDIO_COPY_TABLE.en], ["hi", STUDIO_COPY_TABLE.hi]]) {
    const blanks = paths(table).filter((p) => {
      if (KNOWN_BLANK_KEYS.has(p)) return false;
      const leafKey = p.replace(/\[\d+\]$/, "");
      const val = leafKey.split(".").reduce((o, k) => o?.[k], table);
      return Array.isArray(val) ? val.some((s) => !String(s).trim()) : !String(val ?? "").trim();
    });
    ok(`no blank ${label} string anywhere in the table (besides the three named intentional blanks)`, blanks.length === 0, blanks.join(", "));
  }
}

// ── 2. THE STATIC SCAN ───────────────────────────────────────────────────
{
  // Every file this workstream actually converted (law 2: existing
  // components import the copy table; no component keeps a literal English
  // sentence). `VoiceField.tsx` renders no text at all (a pure SVG dial) and
  // `PersonalStudioEntry.tsx` already read every string it shows through the
  // pre-existing `personalAuthCopy.ts` registry before this workstream
  // started — both included here as CONVERTED (zero findings expected)
  // rather than left off the list, `localeContext.tsx`/`Localized.tsx`'s own
  // creatorStudio precedent for a file with no literal English text of its
  // own.
  const TIER_1_FILES = [
    "ExpertSharePanel.tsx",
    "QuickVoiceCapture.tsx",
    "ExpertConversation.tsx",
    "PersonModelStudio.tsx",
    "VoiceField.tsx",
    "PersonalStudioEntry.tsx",
  ];

  // Every OTHER file this brief named, one line each with the reason it was
  // not converted this session. See
  // context/decisions.md#ws-r159-tier-1-scope-and-tier-2-allowlist for the
  // full argument and context/rejected.md for what was tried and rejected.
  const TIER_2_ALLOWLIST = {
    "VideoEnrollPanel.tsx": "ATTESTATION_COPY is the same five-statement YouTube channel-ownership/rights/audio-extraction consent ceremony (owns_or_controls_channel, is_rights_holder_of_uploads, authorizes_audio_extraction_for_own_replica, understands_tos_exposure_is_not_copyright_permission, understands_revocation_stops_extraction) the creatorStudio wave already carved out of src/creatorStudio/VideoEnrollPanel.tsx for the identical reason (context/decisions.md#ws-r71-consent-ceremony-files-found-and-not-converted): a mistranslation in rights-attestation text carries real legal weight and no legal review of Hindi wording was in scope for this session. Left whole and unconverted, extending that standing decision to the personal studio's own copy of the same screen.",
    "CloneExperience.tsx": "The main journey shell (1,225 lines): the Feed/Meet/Add-more/Evolve/Talk/Share tab chrome, headlines (\"Meet {name}.\", \"Choose what becomes you.\") and the tab switch labels. Renders the four converted panels above as children, so they speak Hindi under `StudioLocaleProvider` regardless of this file's own state, but the surrounding chrome is time-boxed out of this session (WS-R52/WS-R61/WS-R71's own precedent: convert a bounded set of files per session, document the rest, let the next wave continue the tier).",
    "CloneVerificationJourney.tsx": "The identity/liveness verification screen (566 lines), not reached this session; time-boxed the same way as CloneExperience.tsx.",
    "VoicePreviewPanel.tsx": "The voice preview lab (797 lines), not reached this session; time-boxed the same way as CloneExperience.tsx.",
    "MirrorCallStudio.tsx": "The live voice-call studio (1,086 lines), not reached this session; time-boxed the same way as CloneExperience.tsx.",
    "ContextLockerPanel.tsx": "The context/knowledge locker (635 lines), not reached this session; time-boxed the same way as CloneExperience.tsx.",
    "StudioApp.tsx": "The signed-in shell (2,707 lines): wrapped this session in `StudioLocaleProvider` and given the shell's own language switch (`LanguageSwitch.tsx`, law 3), but its own remaining inline strings (the legacy internal-test-studio header, the wizard rail labels, `TEACHER_COPY`/`GENERIC_COPY`/`TEST_COPY`) are not converted; the structural wrap was necessary infrastructure, the bulk conversion is time-boxed out of this session the same way as CloneExperience.tsx.",
  };

  const NAMED_FILES = [...TIER_1_FILES, ...Object.keys(TIER_2_ALLOWLIST)];
  const missingSource = NAMED_FILES.filter((f) => {
    try { readFileSync(join(STUDIO_DIR, f), "utf8"); return false; }
    catch { return true; }
  });
  ok("every named file actually exists on disk", missingSource.length === 0, missingSource.join(", "));

  let tier1Findings = 0;
  for (const f of TIER_1_FILES) {
    const src = readFileSync(join(STUDIO_DIR, f), "utf8");
    const hits = literalEnglishTextNodes(src);
    tier1Findings += hits.length;
    ok(`${f} carries zero literal English JSX text nodes`, hits.length === 0, hits.slice(0, 5).join(" | "));
  }
  ok("zero literal English text nodes across every Tier 1 file, summed", tier1Findings === 0);

  const badFixture = `
    export default function Bad() {
      return (
        <section>
          <h3>This is a literal English sentence</h3>
        </section>
      );
    }
  `;
  ok("the scan itself finds a planted literal sentence (not a vacuous pass)",
    literalEnglishTextNodes(badFixture).length === 1);
}

// ── 3. NEGATIVE CONTROLS: the copy gate bites Hindi exactly as English ─────
{
  const dashHit = scanSource(
    "bad.tsx",
    'const z = { label: "यह रुका — फिर शुरू होगा।" };',
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("(a) a Hindi string with an em dash fails the dash rule",
    dashHit.some((o) => o.rule === "dash"));

  const vocabHit = scanSource(
    "bad.tsx",
    'const z = <p>यह आपका AI क्लोन है।</p>;',
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("(b) a Hindi string containing क्लोन fails the rooms-vocabulary rule when the scanner is asked to apply it",
    vocabHit.some((o) => o.rule === "rooms-vocabulary"));

  function collectStrings(obj, out) {
    if (typeof obj === "string") out.push(obj);
    else if (Array.isArray(obj)) obj.forEach((v) => collectStrings(v, out));
    else if (obj && typeof obj === "object") Object.values(obj).forEach((v) => collectStrings(v, out));
  }
  const hiStrings = [];
  collectStrings(STUDIO_COPY_TABLE.hi, hiStrings);
  const asSource = hiStrings.map((s) => `const x = ${JSON.stringify(s)};`).join("\n");
  const realHits = scanSource("src/studio/hiCopy.ts", asSource, { rules: "full", codename: true, roomsVocab: false });
  ok(`every one of the ${hiStrings.length} real Hindi strings this workstream shipped passes the general copy gate`,
    realHits.length === 0, JSON.stringify(realHits.slice(0, 5)));
}

// ── 4. THE LOCALE ORDER (no replica-locale step: no migration this session) ─
{
  const { resolveStudioLocale } = await bundleAndImport(
    `export { resolveStudioLocale } from ${JSON.stringify(join(REPO, "src/creatorStudio/studioLocalePreference"))};\n`,
    "pref",
  );

  ok("?lang= wins over everything, no remembered choice",
    resolveStudioLocale({ urlLocale: "hi", replica: null, rememberedLocale: null }) === "hi");
  ok("no url: the remembered local choice wins",
    resolveStudioLocale({ urlLocale: null, replica: null, rememberedLocale: "hi" }) === "hi");
  ok("nothing at all: \"en\"",
    resolveStudioLocale({ urlLocale: null, replica: null, rememberedLocale: null }) === "en");
  ok("the personal studio's own provider always passes replica: null (no vy_replica-equivalent locale column exists for a personal Replica -- src/studio/types.ts, this workstream ships no migration): even a replica-shaped hint wins nothing here because this provider never constructs one",
    resolveStudioLocale({ urlLocale: null, replica: null, rememberedLocale: "en" }) === "en");
}

// ── 5. THE LOADER: fresh-module not-loaded / ready states ──────────────────
{
  const fresh = await loadStudioCopyModule();
  const freshTable = fresh.STUDIO_COPY_TABLE;

  let throwMsg = null;
  try { void freshTable.hi.expertSharePanel; } catch (e) { throwMsg = String(e && e.message); }
  ok("reading a section before any loader runs throws studio_personal_copy_hi_not_loaded",
    throwMsg !== null && throwMsg.includes("studio_personal_copy_hi_not_loaded"), throwMsg || "(did not throw)");

  ok("studioCopyReady(hi) is false before any loader runs", fresh.studioCopyReady("hi") === false);
  ok("studioCopyReady(en) is always true", fresh.studioCopyReady("en") === true);

  await fresh.loadStudioCopy("hi");
  ok("studioCopyReady(hi) is true after loadStudioCopy(\"hi\")", fresh.studioCopyReady("hi") === true);

  let personalAuthReadable = false;
  try {
    personalAuthReadable = typeof freshTable.hi.personalAuth.emailTitle === "string" && freshTable.hi.personalAuth.emailTitle.length > 0;
  } catch {}
  ok("personalAuth.emailTitle reads real Hindi text after loadStudioCopy (merged in from the EXISTING personalAuthCopyRegistry.ts loader)", personalAuthReadable);

  let sectionReadable = false;
  try {
    sectionReadable = typeof freshTable.hi.expertConversation.ariaLabel === "string" && freshTable.hi.expertConversation.ariaLabel.length > 0;
  } catch {}
  ok("expertConversation.ariaLabel reads real Hindi text after loadStudioCopy", sectionReadable);

  // A second call while the first is still in flight must not re-fetch or
  // re-translate: both promises resolve to the SAME installed object.
  const freshTwo = await loadStudioCopyModule();
  const [a, b] = await Promise.all([freshTwo.loadStudioCopy("hi"), freshTwo.loadStudioCopy("hi")]);
  ok("two concurrent loadStudioCopy(\"hi\") calls resolve to the identical installed object", a === b);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
