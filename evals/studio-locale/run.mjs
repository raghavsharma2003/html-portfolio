// The studio in Hindi (WS-R52, migration 112) — offline, deterministic, $0.
//
//   node evals/studio-locale/run.mjs
//
// What this suite is actually guarding, `evals/room-locale/run.mjs`'s own
// proof shape reused rather than re-derived (this workstream's law 1):
//
// 1. KEY PARITY. `STUDIO_COPY_TABLE.en` and `.hi` carry the EXACT same keys
//    at every level, asserted against the REAL export.
// 2. THE STATIC SCAN. Every `src/studio/*.tsx` file this workstream converted
//    (`TIER_1_FILES` below) carries ZERO literal JSX text nodes of three or
//    more words that are not routed through `t.` — a heuristic scan (no full
//    JSX/TS parser is a dependency of this repo), so a code-shaped false
//    positive (a TS generic like `useState<Foo | null>`) is filtered by a
//    second pass rather than hand-allowlisted string by string. Every OTHER
//    `src/studio/*.tsx` file is in `TIER_2_ALLOWLIST`, one entry per file,
//    each with the reason it was not converted this workstream — the
//    brief's own "an allowlist you justify entry by entry" law, applied at
//    file granularity because these files were not touched at all rather
//    than touched-with-one-exception.
// 3. THE OWNERSHIP PREDICATE. `setOwnedReplicaLocale` (api/_replica.js) is
//    driven through a fake db shaped like the real `vy_replica` table.
//    NEGATIVE CONTROL: an owner attempting to set a SECOND account's
//    replica locale is refused (0 rows updated) and that account's own row
//    is completely unchanged — proven by reading it back.
// 4. THREE MORE NEGATIVE CONTROLS, `evals/room-locale/run.mjs`'s own shape
//    one surface over: (a) a Hindi string with an em dash fails
//    `scripts/check-copy.mjs`'s dash rule; (b) a Hindi string containing
//    क्लोन or मॉडल fails its rooms-vocabulary rule; (c) an invalid locale
//    value is refused BY NAME (`studio_locale_invalid`), never silently
//    folded into "en".
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
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

const REPLICA = await import(pathToFileURL(join(REPO, "api/_replica.js")).href);
const { setOwnedReplicaLocale, getOwnedReplica, STUDIO_LOCALES: SERVER_LOCALES } = REPLICA;

const checkCopy = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);
const { scanSource } = checkCopy;

// `src/studio/copy.ts` is plain TS with no JSX (`src/room/copy.ts`'s own
// note: a component-free data file, bundled the same way `evals/room/
// fixtures.mjs`'s `loadFixtureAgent` bundles a source module).
async function loadStudioCopy() {
  const OUT = mkdtempSync(join(tmpdir(), "studio-locale-eval-"));
  const ENTRY = join(OUT, "entry.ts");
  writeFileSync(
    ENTRY,
    `export { STUDIO_COPY_TABLE, STUDIO_LOCALES, normalizeStudioLocale } from ${JSON.stringify(
      join(REPO, "src/studio/copy"),
    )};\n`,
  );
  const BUNDLE = join(OUT, "copy.bundle.mjs");
  execSync(
    `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
    { cwd: REPO, stdio: "inherit" },
  );
  return import(pathToFileURL(BUNDLE).href);
}
const { STUDIO_COPY_TABLE, STUDIO_LOCALES, normalizeStudioLocale } = await loadStudioCopy();

// ── 1. KEY PARITY ───────────────────────────────────────────────────────────
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

  ok("both locales are exactly {en, hi}", JSON.stringify(STUDIO_LOCALES) === JSON.stringify(["en", "hi"]));
  ok("STUDIO_LOCALES here agrees with the server's own", JSON.stringify(STUDIO_LOCALES) === JSON.stringify(SERVER_LOCALES));

  const enPaths = paths(STUDIO_COPY_TABLE.en);
  const hiPaths = paths(STUDIO_COPY_TABLE.hi);
  ok("en and hi carry the exact same key set (and the same array lengths)",
    JSON.stringify(enPaths) === JSON.stringify(hiPaths),
    enPaths.length !== hiPaths.length
      ? `en has ${enPaths.length} leaves, hi has ${hiPaths.length}`
      : "",
  );
  ok("neither locale table is empty", enPaths.length > 50);

  const blankHi = hiPaths.filter((p) => {
    const leafKey = p.replace(/\[\d+\]$/, "");
    const val = leafKey.split(".").reduce((o, k) => o?.[k], STUDIO_COPY_TABLE.hi);
    return Array.isArray(val) ? val.some((s) => !String(s).trim()) : !String(val ?? "").trim();
  });
  ok("no blank Hindi string anywhere in the table", blankHi.length === 0, blankHi.join(", "));

  const blankEn = enPaths.filter((p) => {
    const leafKey = p.replace(/\[\d+\]$/, "");
    const val = leafKey.split(".").reduce((o, k) => o?.[k], STUDIO_COPY_TABLE.en);
    return Array.isArray(val) ? val.some((s) => !String(s).trim()) : !String(val ?? "").trim();
  });
  ok("no blank English string anywhere in the table", blankEn.length === 0, blankEn.join(", "));

  ok("normalizeStudioLocale falls back to en for anything unrecognised",
    normalizeStudioLocale("fr") === "en" && normalizeStudioLocale(undefined) === "en" && normalizeStudioLocale("hi") === "hi");
}

// ── 2. THE STATIC SCAN ──────────────────────────────────────────────────────
{
  const STUDIO_DIR = join(REPO, "src/studio");
  const allTsx = readdirSync(STUDIO_DIR).filter((f) => f.endsWith(".tsx"));

  // Every literal JSX text node of >= 3 words. Anchored on an actual opening
  // tag (`<Tag ...>`) rather than a bare `>`, so a TS generic like
  // `useState<Foo | null>(null)` — which has no `<` immediately before the
  // "tag" name — never matches; a second pass drops anything left that still
  // looks like code (an operator, a keyword, a comment marker) rather than
  // prose a person reads.
  // Trailing `<` is a LOOKAHEAD, never consumed: two adjacent tags
  // (`<section><h3>...`) share that boundary character, and consuming it
  // would make the second tag's own leading `<` invisible to the next
  // `exec()` call — the exact way this scan first shipped silently blind to
  // every nested tag, caught only by its own negative control below.
  const TAG_TEXT = /<[A-Za-z][A-Za-z0-9.]*(?:\s[^<>]*)?>([^<>{}]+)(?=<)/g;
  const CODE_SHAPED = /=|;|useState|useRef|const\s|\/\*|\/\//;
  function literalEnglishTextNodes(src) {
    const hits = [];
    let m;
    TAG_TEXT.lastIndex = 0;
    while ((m = TAG_TEXT.exec(src))) {
      const text = m[1].replace(/\s+/g, " ").trim();
      if (!text || CODE_SHAPED.test(text)) continue;
      const words = text.split(" ").filter((w) => /[A-Za-z]/.test(w));
      if (words.length >= 3) hits.push(text);
    }
    return hits;
  }

  // Every file this workstream actually converted (law 1: "existing
  // components import t(); no component keeps a literal English sentence").
  const TIER_1_FILES = [
    "BlockerNotice.tsx", "WizardRail.tsx", "StudioShell.tsx", "ReadinessPanel.tsx",
    "DriftWatchCard.tsx", "ReviewQueue.tsx", "PayoutsCard.tsx", "CheckinsCard.tsx",
    "HandoffCard.tsx", "InviteCreatorCard.tsx", "InviteGate.tsx", "SuiteCard.tsx",
    // WS-R65's own new file: the Feed tab's path card. Every sentence it
    // renders routes through `t.creatorPath`, the same law this whole list
    // enforces for every other Tier 1 file.
    "CreatorPath.tsx",
    // WS-R66: the "Show on your page" showcase card - `InviteCreatorCard.tsx`'s
    // own self-contained shape, one file over, converted from its first
    // commit rather than left in Tier 2.
    "ShowcaseCard.tsx",
    // WS-R52's own new file: the locale context/provider. No literal English
    // text of its own (it renders nothing; it hands `t` to whatever mounts
    // under it), so it clears the scan the same way an empty file would, but
    // it belongs in the "converted" list rather than the "not touched" one.
    "localeContext.tsx",
    // WS-R61 (tier 2, wave one). RoomStudio.tsx first, as the brief required
    // (it carries the follower price and the TDS disclosure sentence -- see
    // context/decisions.md#ws-r61-roomstudio-money-and-tds-copy-translated-meaning-preserved),
    // then the smaller shell/lab/review panels with no honesty-gate or
    // consent-ceremony conflict. See context/decisions.md#ws-r61-tier-2-first-wave-converted
    // for the full list and why each was safe to move.
    "RoomStudio.tsx", "VideoLinkMount.tsx", "RuntimeGate.tsx", "TurnFeedback.tsx",
    "ReplicaDialogueLab.tsx", "CalibrationStudio.tsx", "CandidateEvaluationLab.tsx",
    "ProcessingReview.tsx", "PersonModelStudio.tsx",
  ];

  // Every file this workstream did NOT convert, one line each. See
  // context/decisions.md#ws-r52-tier-2-studio-files-not-localized for the
  // original argument and context/decisions.md#ws-r61-tier-2-first-wave-converted
  // for what WS-R61 moved out of this list and why the rest stayed --
  // context/rejected.md for what was tried and why a full pass in one
  // session was rejected (both sessions).
  const TIER_2_ALLOWLIST = {
    "layoutFixture.tsx": "The layout/accessibility gates' own signed-in harness, inert everywhere but loopback (its own header) -- never a page a creator reaches, so its literal strings (route stubs, fixture labels) are test data, not chrome.",
    "main.tsx": "The studio's real entry point (mounts StudioApp, no UI of its own); scanned here purely because it shares the .tsx extension with the panels that matter.",
    "ActivityPanel.tsx": "Feed step's job-status list; deep wizard internal, deferred.",
    "ChannelsStudio.tsx": "Channel connection flows; deep wizard internal, deferred.",
    "ContextLockerPanel.tsx": "File/link ingestion; deep wizard internal, deferred.",
    "DisclosurePreview.tsx": "Renders the FIXED disclosure card text a follower reads (never translated per-creator; it is the platform's own floor, identical for every published AI) alongside its own chrome; deferred as a unit rather than split.",
    "EnrollmentWorkspace.tsx": "The largest single wizard file (~2,300 lines); source upload/consent internals, deferred.",
    "IdentityProofing.tsx": "WS-R61 read this file and chose NOT to convert it: its `STATEMENTS` array is the exact English wording a creator affirmatively checks before submitting a government ID for age/identity verification (KYC-adjacent). Unlike this workstream's other wave-one files, a mistranslation here has real legal/compliance weight and no dedicated legal review was in scope for this session -- same caution `ModelConsentGate.tsx`'s own entry below states for a similar reason, see context/decisions.md#ws-r61-identity-proofing-consent-statements-deferred-not-attempted.",
    "IngestChannelStudio.tsx": "YouTube channel ownership flow; deep wizard internal, deferred.",
    "LivenessCapture.tsx": "Azure liveness challenge flow; deep wizard internal, deferred.",
    "MirrorCallStudio.tsx": "Live Mirror Call + interview UI; deep wizard internal, deferred.",
    "ModelConsentGate.tsx": "Its six `STATEMENTS` are pre-existing consent-ceremony legal text: four of them are named BY STRING, in this exact English wording, in scripts/roomsVocabAllowlist.mjs's own escape hatch (a teacher already affirmatively checked these exact words before any replica was built). WS-R61 read that file before touching this one and stopped: translating the ceremony would move the words a person already consented to, the precise failure roomsVocabAllowlist.mjs's own header names (`safety-floor-teacher.md` §2.1). See context/decisions.md#ws-r61-modelconsentgate-left-untouched-consent-ceremony-legal-text.",
    "OpsBoard.tsx": "Internal operator dashboard (`?mode=ops`), never a creator-facing screen at all.",
    "QuickStartPath.tsx": "Owns BLOCKER_META, honesty-gated prose checked by evals/studiowizard.mjs's English-only BLAME_PATTERNS regex (copy.ts's own header); localizing it without a parallel Hindi honesty check would ship an ungated safety-adjacent surface.",
    "StudioApp.tsx": "Owns TEACHER_COPY/GENERIC_COPY/TEST_COPY (pre-existing, unrelated local `StudioCopy` auth-flow copy, WS-R31 era) plus every lazy-mounted Tier 2 panel's wiring; the shell mount, locale provider and language-switch wiring this workstream added ARE converted (see StudioShell.tsx).",
    "TeacherSheetStudio.tsx": "Teacher sheet editor; deep wizard internal, deferred.",
    "VideoEnrollPanel.tsx": "Video-link enrollment; deep wizard internal, deferred.",
    "VoiceEnrollmentLab.tsx": "Voice consent + enrollment lab; deep wizard internal, deferred.",
    "VoiceExperimentPanel.tsx": "Blind voice listening lab; deep wizard internal, deferred.",
    "VoiceIdentityChallenge.tsx": "Voice identity challenge flow; deep wizard internal, deferred.",
    "VoicePreviewLab.tsx": "Voice preview/delivery lab; deep wizard internal, deferred.",
    "VoicePreviewPanel.tsx": "Voice preview control; deep wizard internal, deferred.",
  };

  const missingAllowlistEntry = allTsx.filter(
    (f) => !TIER_1_FILES.includes(f) && !(f in TIER_2_ALLOWLIST),
  );
  ok("every src/studio/*.tsx file is either Tier 1 (converted) or in the justified Tier 2 allowlist",
    missingAllowlistEntry.length === 0, missingAllowlistEntry.join(", "));

  const staleAllowlistEntries = Object.keys(TIER_2_ALLOWLIST).filter((f) => !allTsx.includes(f));
  ok("no Tier 2 allowlist entry names a file that no longer exists",
    staleAllowlistEntries.length === 0, staleAllowlistEntries.join(", "));

  let tier1Findings = 0;
  for (const f of TIER_1_FILES) {
    const src = readFileSync(join(STUDIO_DIR, f), "utf8");
    const hits = literalEnglishTextNodes(src);
    tier1Findings += hits.length;
    ok(`${f} carries zero literal English JSX text nodes`, hits.length === 0, hits.slice(0, 5).join(" | "));
  }
  ok("zero literal English text nodes across every Tier 1 file, summed", tier1Findings === 0);

  // The scan itself is not vacuous: run against a hand-built bad fixture, it
  // must actually find the planted defect.
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

// ── 3. THE OWNERSHIP PREDICATE ──────────────────────────────────────────────
{
  const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const REPLICA_A = "11111111-1111-4111-8111-111111111111";
  const REPLICA_B = "22222222-2222-4222-8222-222222222222";
  const RETURNING_COLS =
    "replica_id, display_name, subject_mode, lifecycle, policy_version, age_verified_at, " +
    "identity_verified_at, liveness_verified_at, identity_expires_at, locale, created_at, updated_at";

  function freshState() {
    return {
      replicas: [
        {
          replica_id: REPLICA_A, owner_user_id: OWNER_A, display_name: "Anjali Physics",
          subject_mode: "self", lifecycle: "active", policy_version: "replica-self-v1",
          age_verified_at: null, identity_verified_at: null, liveness_verified_at: null,
          identity_expires_at: null, locale: "en",
          created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
        },
        {
          replica_id: REPLICA_B, owner_user_id: OWNER_B, display_name: "Rahul Chemistry",
          subject_mode: "self", lifecycle: "active", policy_version: "replica-self-v1",
          age_verified_at: null, identity_verified_at: null, liveness_verified_at: null,
          identity_expires_at: null, locale: "en",
          created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    };
  }

  function projectReturning(row) {
    const out = {};
    for (const col of RETURNING_COLS.split(",").map((c) => c.trim())) out[col] = row[col];
    return out;
  }

  function fakeDb(state) {
    return async (sql, params = []) => {
      if (/^\s*update vy_replica\s+set locale = \$3, updated_at = now\(\)/.test(sql)) {
        const [replicaId, ownerUserId, locale] = params;
        const row = state.replicas.find((r) => r.replica_id === replicaId && r.owner_user_id === ownerUserId);
        if (!row) return [];
        row.locale = locale;
        row.updated_at = new Date().toISOString();
        return [projectReturning(row)];
      }
      if (/^\s*select .* from vy_replica\s+where replica_id = \$1::uuid and owner_user_id = \$2::uuid limit 1/s.test(sql)) {
        const [replicaId, ownerUserId] = params;
        const row = state.replicas.find((r) => r.replica_id === replicaId && r.owner_user_id === ownerUserId);
        return row ? [projectReturning(row)] : [];
      }
      throw new Error(`fakeDb: unhandled statement: ${sql.slice(0, 80)}`);
    };
  }

  const state = freshState();
  const db = fakeDb(state);

  const changed = await setOwnedReplicaLocale(db, OWNER_A, REPLICA_A, "hi");
  ok("the owner sets their OWN replica's locale", changed?.locale === "hi");

  const reread = await getOwnedReplica(db, OWNER_A, REPLICA_A);
  ok("the write is durable: a fresh read agrees", reread?.locale === "hi");

  // THE NEGATIVE CONTROL: owner A tries to set owner B's replica's locale,
  // by naming B's replica id while authenticated as A.
  const stolen = await setOwnedReplicaLocale(db, OWNER_A, REPLICA_B, "hi").catch((e) => e);
  ok("owner A cannot set owner B's replica locale (writes nothing, throws nothing useful to steal)",
    stolen === null || stolen === undefined);
  const bRow = state.replicas.find((r) => r.replica_id === REPLICA_B);
  ok("owner B's row is COMPLETELY untouched by A's attempt", bRow.locale === "en");

  // Same control the other direction, for symmetry.
  const stolenBack = await setOwnedReplicaLocale(db, OWNER_B, REPLICA_A, "en").catch((e) => e);
  ok("owner B cannot set owner A's replica locale either",
    stolenBack === null || stolenBack === undefined);
  const aRow = state.replicas.find((r) => r.replica_id === REPLICA_A);
  ok("owner A's row (already changed to hi above) is untouched by B's attempt", aRow.locale === "hi");

  // An unrecognised locale is refused BY NAME, before the fake db is even
  // reached — proven by the state staying byte-identical.
  const before = JSON.stringify(state);
  const badLocale = await setOwnedReplicaLocale(db, OWNER_A, REPLICA_A, "fr").catch((e) => e);
  ok("an unrecognised locale is refused by name (studio_locale_invalid)",
    badLocale?.code === "studio_locale_invalid");
  ok("the refused write changed nothing", JSON.stringify(state) === before);

  const emptyLocale = await setOwnedReplicaLocale(db, OWNER_A, REPLICA_A, "").catch((e) => e);
  ok("an empty locale is refused the same way, not read as \"no change\" silently",
    emptyLocale?.code === "studio_locale_invalid");

  // Structural half: `setOwnedReplicaLocale`'s own source names no
  // request-supplied person/follower field, only the two explicit
  // parameters `requireUser()`'s caller already verified.
  const src = readFileSync(join(REPO, "api/_replica.js"), "utf8");
  const fnStart = src.indexOf("export async function setOwnedReplicaLocale");
  const fnEnd = src.indexOf("\n}\n", fnStart) + 3;
  const fnBody = src.slice(fnStart, fnEnd);
  ok("setOwnedReplicaLocale's own source scopes the WHERE clause to both replica_id AND owner_user_id",
    fnStart > -1 && /where replica_id = \$1::uuid and owner_user_id = \$2::uuid/.test(fnBody));
}

// ── 4a/4b. NEGATIVE CONTROLS: the copy gate bites Hindi exactly as English ──
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
  ok("(b) a Hindi string containing क्लोन fails the rooms-vocabulary rule",
    vocabHit.some((o) => o.rule === "rooms-vocabulary"));

  const modelHit = scanSource("bad.html", "<p>अपने वॉइस मॉडल को ट्रेन करें।</p>", {
    rules: "full", codename: true, roomsVocab: true,
  });
  ok("(b again) मॉडल fails the same rule from a pure-Devanagari HTML text node",
    modelHit.some((o) => o.rule === "rooms-vocabulary"));

  const clean = scanSource(
    "clean.tsx",
    'const z = { label: "आपका AI तैयारी में 61 अंक पर है।" };',
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("clean, real Hindi copy trips nothing", clean.length === 0, JSON.stringify(clean));

  // Every real Hindi string this workstream shipped, run through the real
  // scanner directly — not a hand-picked sample.
  function collectStrings(obj, out) {
    if (typeof obj === "string") out.push(obj);
    else if (Array.isArray(obj)) obj.forEach((v) => collectStrings(v, out));
    else if (obj && typeof obj === "object") Object.values(obj).forEach((v) => collectStrings(v, out));
  }
  const hiStrings = [];
  collectStrings(STUDIO_COPY_TABLE.hi, hiStrings);
  const asSource = hiStrings.map((s) => `const x = ${JSON.stringify(s)};`).join("\n");
  const realHits = scanSource("src/studio/copy.ts", asSource, { rules: "full", codename: true, roomsVocab: true });
  ok(`every one of the ${hiStrings.length} real Hindi strings this workstream shipped passes the real copy gate`,
    realHits.length === 0, JSON.stringify(realHits.slice(0, 5)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
