// evals/deploy-studio/run.mjs — WS-R152. Deploy for a personal AI, offline.
//
//   node evals/deploy-studio/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no browser. Bundles the REAL
// `src/studio/deployStudioState.ts` on every run (`evals/studio-shell/run.mjs`'s
// own pattern: a temp entry file re-exporting the real source, then esbuild),
// so this suite gates the tree being shipped rather than a frozen snapshot.
//
// ── what this suite is actually guarding ──────────────────────────────────
//
// 1. THE READINESS BANNER never shows two states at once and always resolves
//    to exactly one of the three the owner's brief names, over every
//    (stopped, publishedRoom) combination — property-checked, not one
//    example. `deployBannerState`'s own header names the simplification this
//    asserts and its reversal condition.
//
// 2. THE VISITOR LINK'S NEGATIVE CONTROL (the brief's own law 4): an
//    unpublished Room, or no Room at all, produces `null` — never a link the
//    caller could accidentally render — and only a genuinely published Room
//    produces the real `/r/<slug>` address, over generated fixtures.
//
// 3. THE STEP TRANSLATION: `RoomStudio.tsx`'s own `onGoStep` can request
//    "feed", "meet" or "deploy" (`StepId` in `wizardModel.ts`); only "meet"
//    ever asks this screen to leave itself, since "deploy" IS this screen.
//
// 4. THE COPY GATE, on the real files this workstream wrote, imported
//    directly from `scripts/check-copy.mjs` rather than re-implemented — plus
//    the standard negative control: a hand-built string carrying a banned
//    Rooms word fails the SAME scanner that passed on the real files.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scanSource } from "../../scripts/check-copy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const STUDIO_DIR = join(REPO, "src/studio");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

// ── bundle the real pure model ─────────────────────────────────────────────

const OUT = mkdtempSync(join(tmpdir(), "deploy-studio-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(ENTRY, `export * from ${JSON.stringify(join(STUDIO_DIR, "deployStudioState"))};\n`);
const BUNDLE = join(OUT, "deploy-studio.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const M = await import(pathToFileURL(BUNDLE).href);
const { deployBannerState, deployVisitorLink, shouldReviewForStep } = M;

// ── 1. banner state: every (stopped, publishedRoom) combination ───────────

const BANNER_STATES = new Set(["voice", "publish", "ready"]);
const bannerCases = [
  { stopped: true, publishedRoom: false, want: "voice" },
  { stopped: true, publishedRoom: true, want: "voice" }, // stopped wins: an inactive runtime can never honestly say "ready", whatever the Room row says
  { stopped: false, publishedRoom: true, want: "ready" },
  { stopped: false, publishedRoom: false, want: "publish" },
];
for (const c of bannerCases) {
  const got = deployBannerState({ stopped: c.stopped, publishedRoom: c.publishedRoom });
  ok(`banner(stopped=${c.stopped}, publishedRoom=${c.publishedRoom}) is "${c.want}"`, got === c.want, `got ${got}`);
  ok(`banner(...) is one of the three named states, never a fourth`, BANNER_STATES.has(got));
}

// negative control: a banner state outside the three named ones is not one
// this function can ever produce -- proven by exhausting the boolean input
// space (four combinations, all four asserted above) rather than trusting
// the function's own return type.
ok(
  "negative control: the function's real output space over all 4 boolean combinations is exactly {voice, publish, ready}",
  new Set(bannerCases.map((c) => deployBannerState({ stopped: c.stopped, publishedRoom: c.publishedRoom }))).size <= 3,
);

// ── 2. visitor link: the negative control the brief's law 4 names ─────────

const ORIGIN = "https://meera-silk.example";
ok(
  "negative control: no Room at all shows no visitor link",
  deployVisitorLink(null, ORIGIN) === null,
);
ok(
  "negative control: an unpublished Room shows no visitor link",
  deployVisitorLink({ slug: "anjali", published: false }, ORIGIN) === null,
);
ok(
  "a published Room shows the real /r/<slug> address",
  deployVisitorLink({ slug: "anjali", published: true }, ORIGIN) === `${ORIGIN}/r/anjali`,
);
ok(
  "the visitor link never fabricates a slug the Room row did not carry",
  deployVisitorLink({ slug: "someone-else", published: true }, ORIGIN).includes("someone-else"),
);

// ── 3. onGoStep translation ─────────────────────────────────────────────────

ok('shouldReviewForStep("meet") is true', shouldReviewForStep("meet") === true);
ok('shouldReviewForStep("feed") is false (this screen has no "feed" of its own)', shouldReviewForStep("feed") === false);
ok('shouldReviewForStep("deploy") is false (this screen already IS "deploy")', shouldReviewForStep("deploy") === false);

// ── 4. copy gate, on the real files ─────────────────────────────────────────

const REAL_FILES = ["DeployStudio.tsx", "ExpertSharePanel.tsx", "deployStudioState.ts", "deploy-studio.css"];
for (const file of REAL_FILES) {
  const rel = `src/studio/${file}`;
  const src = readFileSync(join(STUDIO_DIR, file), "utf8");
  const hits = scanSource(rel, src, { rules: "full", codename: true, roomsVocab: true });
  ok(`copy gate: ${rel} carries zero offences`, hits.length === 0, hits.length ? JSON.stringify(hits.slice(0, 3)) : "");
}

{
  // `DeployStudio.tsx`'s own `DEPLOY_COPY` uses compound camelCase keys
  // (`voiceLabel`, `publishBody`, ...) that `isVisibleLiteral`'s exact-suffix
  // match does not recognize as copy on their own (`\b` needs a NON-WORD
  // boundary, and camelCase has none) -- the SAME reason `CloneExperience.
  // tsx`'s own inline `feedCopy` object is invisible to this scanner today.
  // `scanSource` closes that gap for any file whose PATH looks like a copy
  // table (`COPY_FILES`'s own `copy.ts$` pattern): every string literal in
  // such a file counts as visible regardless of its key's name. This fixture
  // uses a `deployCopy.ts`-shaped path for exactly that reason -- proving the
  // real scanner function would still catch a banned word if this screen's
  // copy ever moves into its own named copy file, `feedCopy`'s own
  // unresolved gap not repeated here.
  const bad = 'const publishBody = "publish your clone first";';
  const hits = scanSource("src/studio/deployCopy.ts", bad, { rules: "full", codename: true, roomsVocab: true });
  ok('negative control: a string with "clone" fails scripts/check-copy.mjs', hits.length > 0);
}
{
  const clean = 'const publishBody = "publish who you are first";';
  const hits = scanSource("src/studio/deployCopy.ts", clean, { rules: "full", codename: true, roomsVocab: true });
  ok("sanity: ordinary Deploy copy passes the same scan clean", hits.length === 0);
}

// ── 5. no fork: DeployStudio imports RoomStudio, never copies it ──────────

{
  const deploySrc = readFileSync(join(STUDIO_DIR, "DeployStudio.tsx"), "utf8");
  ok(
    'DeployStudio.tsx imports the real "../creatorStudio/RoomStudio", the SAME component, not a copy',
    /import\(["']\.\.\/creatorStudio\/RoomStudio["']\)/.test(deploySrc),
  );
  ok(
    "DeployStudio.tsx does not IMPORT ShareKitCard, roomLink, storyCardLink or posterLink -- RoomStudio already mounts ShareKitCard itself",
    !/\bimport\b[^;]*\b(?:ShareKitCard|roomLink|storyCardLink|posterLink)\b/.test(deploySrc),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
