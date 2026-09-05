// evals/studio-path/run.mjs — WS-R65. The creator's first five minutes,
// offline.
//
//   node evals/studio-path/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no model call, no GPU, no
// browser. Bundles the REAL `src/studio/CreatorPath.tsx` on every run
// (`evals/studio-shell/run.mjs`'s own pattern: a temp entry file
// re-exporting the real source, then esbuild), so this suite gates the tree
// being shipped rather than a frozen copy.
//
// ── what this suite is actually guarding ──────────────────────────────────
//
// 1. THE STEP ORDER EQUALS `api/_funnel.js#FUNNEL_STEPS` BYTE FOR BYTE. The
//    brief's own law 5. `CreatorPath.tsx#CREATOR_PATH_STEPS` is derived from
//    a mirrored string (`CREATOR_PATH_STEPS_ORDER`), never a second
//    hand-typed array — asserted against the REAL, unbundled
//    `api/_funnel.js` export, not a copy.
// 2. THE READINESS FLOORS MATCH `api/_readiness.js` EXACTLY — the two
//    numbers `readiness_passed_lock`'s own sentence names, mirrored rather
//    than duplicated.
// 3. `computeCreatorPath` IS A PURE FUNCTION OF ITS READS. Fuzzed over the
//    input space: calling it twice on the same input is byte-identical
//    (JSON equal); the returned `state` column is always a DONE prefix,
//    then AT MOST ONE `current`, then an AHEAD suffix — never interleaved;
//    `account_created`/`studio_opened` are always done once the studio can
//    render this card at all; `visible` is false exactly when
//    `room_published` is reached and the Room is not paused, true
//    otherwise — the disappearance rule, computed, not asserted by hand on
//    one example.
// 4. NEGATIVE CONTROL: a REORDERED `CREATOR_PATH_STEPS_ORDER` mirror fails
//    `scripts/check-mirrors.mjs`'s own `checkMirrors`, run through the REAL
//    checker against the REAL `api/_funnel.js` source — proving the gate
//    the brief asks for ("mirror the list... so check-mirrors gates it")
//    actually bites a drift, not merely that the two files happen to agree
//    once.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkMirrors } from "../../scripts/check-mirrors.mjs";

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

// ── bundle the real pure model, evals/studio-shell/run.mjs's own pattern ──

const OUT = mkdtempSync(join(tmpdir(), "studio-path-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(ENTRY, `export * from ${JSON.stringify(join(STUDIO_DIR, "CreatorPath"))};\n`);
const BUNDLE = join(OUT, "creator-path.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const CP = await import(pathToFileURL(BUNDLE).href);
const {
  CREATOR_PATH_STEPS,
  CREATOR_PATH_STEPS_ORDER,
  CREATOR_PATH_READINESS_OVERALL_FLOOR,
  CREATOR_PATH_READINESS_PART_FLOOR,
  TAB_STEP_FOR_ANCHOR,
  computeCreatorPath,
} = CP;

// The real, unbundled server and sibling-model sources — read as text
// (`checkMirrors`'s own two-file shape), never imported, so this suite never
// pulls a database import into a $0 offline run.
const FUNNEL_SRC = readFileSync(join(REPO, "api/_funnel.js"), "utf8");
const READINESS_SRC = readFileSync(join(REPO, "api/_readiness.js"), "utf8");
const CREATOR_PATH_SRC = readFileSync(join(STUDIO_DIR, "CreatorPath.tsx"), "utf8");
const STUDIO_SHELL_MODEL_SRC = readFileSync(join(STUDIO_DIR, "studioShellModel.ts"), "utf8");

// ── 1. THE STEP ORDER, BYTE FOR BYTE ────────────────────────────────────────
{
  const funnelStepsMatch = /export const FUNNEL_STEPS_ORDER = "([^"]*)"/.exec(FUNNEL_SRC);
  ok("api/_funnel.js#FUNNEL_STEPS_ORDER is found as a single-line string literal", Boolean(funnelStepsMatch));
  const realOrder = funnelStepsMatch[1];
  ok("CREATOR_PATH_STEPS_ORDER is byte-for-byte identical to api/_funnel.js#FUNNEL_STEPS_ORDER",
    CREATOR_PATH_STEPS_ORDER === realOrder,
    `creator=${CREATOR_PATH_STEPS_ORDER}  funnel=${realOrder}`);
  ok("CREATOR_PATH_STEPS has 12 entries, the funnel's own count", CREATOR_PATH_STEPS.length === 12);
  ok("CREATOR_PATH_STEPS is a plain array in the funnel's own order",
    JSON.stringify(CREATOR_PATH_STEPS) === JSON.stringify(realOrder.split(",")));

  // The REAL server module too, not just its string literal — proves the
  // derivation (`.split(",")`) actually reproduces the array `replicaFunnel`
  // and every other caller in api/_funnel.js iterates.
  const FUNNEL = await import(pathToFileURL(join(REPO, "api/_funnel.js")).href);
  ok("CREATOR_PATH_STEPS equals the REAL, live api/_funnel.js#FUNNEL_STEPS export",
    JSON.stringify(CREATOR_PATH_STEPS) === JSON.stringify(FUNNEL.FUNNEL_STEPS));
}

// ── 2. THE READINESS FLOORS ─────────────────────────────────────────────────
{
  const overallMatch = /export const READINESS_OVERALL_FLOOR = (\d+)/.exec(READINESS_SRC);
  const partMatch = /export const READINESS_PART_FLOOR = (\d+)/.exec(READINESS_SRC);
  ok("api/_readiness.js#READINESS_OVERALL_FLOOR is found", Boolean(overallMatch));
  ok("api/_readiness.js#READINESS_PART_FLOOR is found", Boolean(partMatch));
  ok("CREATOR_PATH_READINESS_OVERALL_FLOOR mirrors the real 70",
    CREATOR_PATH_READINESS_OVERALL_FLOOR === Number(overallMatch[1]));
  ok("CREATOR_PATH_READINESS_PART_FLOOR mirrors the real 55",
    CREATOR_PATH_READINESS_PART_FLOOR === Number(partMatch[1]));
}

// ── 2b. TAB_STEP_FOR_ANCHOR agrees with studioShellModel.ts's real TAB_STEP ─
{
  const ENTRY2 = join(OUT, "entry-shell.ts");
  writeFileSync(ENTRY2, `export * from ${JSON.stringify(join(STUDIO_DIR, "studioShellModel"))};\n`);
  const BUNDLE2 = join(OUT, "studio-shell-model.bundle.mjs");
  execSync(
    `npx esbuild ${ENTRY2} --bundle --format=esm --platform=node --outfile=${BUNDLE2} --log-level=error`,
    { cwd: REPO, stdio: "inherit" },
  );
  const SHELL = await import(pathToFileURL(BUNDLE2).href);
  ok("TAB_STEP_FOR_ANCHOR (restated in CreatorPath.tsx) agrees with the real studioShellModel.ts#TAB_STEP",
    JSON.stringify(TAB_STEP_FOR_ANCHOR) === JSON.stringify(SHELL.TAB_STEP));
}

// ── 3. computeCreatorPath IS A PURE FUNCTION OF ITS READS ──────────────────

function* fixtures() {
  const readinessOptions = [
    undefined,
    null,
    { overall: null, publishLocked: true },
    { overall: 40, publishLocked: true },
    { overall: 82, publishLocked: false },
  ];
  const roomOptions = [
    undefined,
    null,
    { published: false, paused: false },
    { published: true, paused: false },
    { published: true, paused: true },
  ];
  const platformWorkOptions = [
    null,
    { running: 1, stuck: 0, undeployedLanes: [] },
    { running: 0, stuck: 1, undeployedLanes: [] },
    { running: 0, stuck: 0, undeployedLanes: ["Uploaded recordings"] },
    { running: 0, stuck: 0, undeployedLanes: [] },
  ];
  const followerOptions = [null, 0, 5];
  for (const accountCreatedAt of [null, "2026-08-01T09:00:00.000Z"]) {
    for (const sourceCount of [0, 1, 3]) {
      for (const platformWork of platformWorkOptions) {
        for (const readiness of readinessOptions) {
          for (const room of roomOptions) {
            for (const followersTotal of followerOptions) {
              yield { accountCreatedAt, sourceCount, platformWork, readiness, room, followersTotal };
            }
          }
        }
      }
    }
  }
}

let fuzzed = 0;
let determinismFailures = 0;
let orderFailures = 0;
let atMostOneCurrentFailures = 0;
let visibilityFailures = 0;
let doneStepsAlwaysHonest = 0;

for (const input of fixtures()) {
  fuzzed++;
  const a = computeCreatorPath(input);
  const b = computeCreatorPath(input);
  if (JSON.stringify(a) !== JSON.stringify(b)) determinismFailures++;

  const states = a.steps.map((s) => s.state);
  // A DONE prefix, then at most one "current", then an AHEAD suffix.
  let sawCurrent = false;
  let sawAhead = false;
  let currentCount = 0;
  let orderOk = true;
  for (const state of states) {
    if (state === "current") { currentCount++; sawCurrent = true; if (sawAhead) orderOk = false; }
    else if (state === "ahead") { sawAhead = true; }
    else if (state === "done") {
      if (sawCurrent || sawAhead) orderOk = false;
    }
  }
  if (!orderOk) orderFailures++;
  if (currentCount > 1) atMostOneCurrentFailures++;

  // account_created/studio_opened (indices 0/1) are always done once this
  // card can render at all, i.e. accountCreatedAt is set — this is the ONE
  // case where index 0 is not trivially done (no account yet is an input
  // shape the real caller never produces, but a fuzzed input can).
  if (input.accountCreatedAt && !(states[0] === "done" && states[1] === "done")) doneStepsAlwaysHonest++;

  // The disappearance rule, computed rather than sampled: visible is false
  // exactly when room_published (index 10) is done AND the Room is not
  // paused; true otherwise.
  const roomPublishedDone = states[CREATOR_PATH_STEPS.indexOf("room_published")] === "done";
  const paused = Boolean(input.room && input.room.paused);
  const expectedVisible = !roomPublishedDone || paused;
  if (a.visible !== expectedVisible) visibilityFailures++;
}

ok(`fuzzed ${fuzzed} input combinations`, fuzzed > 1000);
ok("computeCreatorPath is deterministic (same input, same output) across the whole fuzz", determinismFailures === 0, `${determinismFailures} mismatches`);
ok("every fuzzed result is a DONE prefix, then CURRENT, then an AHEAD suffix, never interleaved", orderFailures === 0, `${orderFailures} out of order`);
ok("every fuzzed result carries AT MOST ONE current step", atMostOneCurrentFailures === 0, `${atMostOneCurrentFailures} with 2+`);
ok("account_created/studio_opened are done whenever the account exists, across the whole fuzz", doneStepsAlwaysHonest === 0, `${doneStepsAlwaysHonest} violations`);
ok("the disappearance rule (law 1) holds across the whole fuzz: hidden once room_published, visible again only if paused", visibilityFailures === 0, `${visibilityFailures} violations`);

// ── 3b. hand-picked cases, named rather than only fuzzed ───────────────────
{
  const nothingYet = computeCreatorPath({
    accountCreatedAt: "2026-08-01T09:00:00.000Z", sourceCount: 0, platformWork: null,
    readiness: undefined, room: undefined, followersTotal: null,
  });
  ok("a brand new replica's current step is first_source_uploaded", nothingYet.currentStepId === "first_source_uploaded");
  ok("a brand new replica's card is visible", nothingYet.visible === true);
  ok("a brand new replica's current control stays on Feed (targetTab null)", nothingYet.control.targetTab === null);
}
{
  const published = computeCreatorPath({
    accountCreatedAt: "2026-08-01T09:00:00.000Z", sourceCount: 3,
    platformWork: { running: 0, stuck: 0, undeployedLanes: [] },
    readiness: { overall: 82, publishLocked: false },
    room: { published: true, paused: false }, followersTotal: 6,
  });
  ok("a published, unpaused Room's card is hidden", published.visible === false);
  ok("a published Room's every step reads done", published.steps.every((s) => s.state === "done"));
}
{
  const pausedAfterPublish = computeCreatorPath({
    accountCreatedAt: "2026-08-01T09:00:00.000Z", sourceCount: 3,
    platformWork: { running: 0, stuck: 0, undeployedLanes: [] },
    readiness: { overall: 82, publishLocked: false },
    room: { published: true, paused: true }, followersTotal: 6,
  });
  ok("a PAUSED, previously-published Room's card reappears", pausedAfterPublish.visible === true);
  ok("the reappeared card reports paused: true", pausedAfterPublish.paused === true);
}
{
  // The "not checked yet" convention: Meet/Share never opened this visit,
  // so nothing past processing can be confirmed, even though a fully
  // published room is possible in reality — the SAME honesty this whole
  // studio already applies (studioShellModel.ts's undefined-means-
  // unchecked), never guessed forward.
  const neverOpenedMeetOrShare = computeCreatorPath({
    accountCreatedAt: "2026-08-01T09:00:00.000Z", sourceCount: 3,
    platformWork: { running: 0, stuck: 0, undeployedLanes: [] },
    readiness: undefined, room: undefined, followersTotal: null,
  });
  ok("with Meet/Share never opened this visit, the current step is first_preview_heard (honest, not guessed)",
    neverOpenedMeetOrShare.currentStepId === "first_preview_heard");
  ok("that step's control switches to the Meet tab", neverOpenedMeetOrShare.control.targetTab === "meet");
}
{
  // room.published proves disclosure_approved/room_created/publish_clicked
  // even when readiness was never rechecked this visit — the one forward
  // fill this file allows, because the publish gate itself cannot set
  // published_at without every one of those already being true.
  const publishedButMeetNeverReopened = computeCreatorPath({
    accountCreatedAt: "2026-08-01T09:00:00.000Z", sourceCount: 3,
    platformWork: { running: 0, stuck: 0, undeployedLanes: [] },
    readiness: undefined,
    room: { published: true, paused: false }, followersTotal: null,
  });
  ok("a published Room forward-fills disclosure_approved/room_created/publish_clicked even with readiness undefined",
    publishedButMeetNeverReopened.steps
      .filter((s) => ["disclosure_approved", "room_created", "publish_clicked", "readiness_passed_lock", "readiness_first_measured", "first_preview_heard"].includes(s.id))
      .every((s) => s.state === "done"));
}

// ── 4. NEGATIVE CONTROL: a reordered mirror fails check-mirrors ────────────
{
  // Sanity first: the REAL files, unmodified, agree — the control below is
  // only meaningful if the honest case passes.
  const { mismatches: cleanMismatches } = checkMirrors(
    { "src/studio/CreatorPath.tsx": CREATOR_PATH_SRC },
    { "api/_funnel.js": FUNNEL_SRC, "api/_readiness.js": READINESS_SRC },
  );
  ok("the REAL CreatorPath.tsx mirror markers agree with the REAL api sources (0 mismatches)",
    cleanMismatches.length === 0, JSON.stringify(cleanMismatches));

  // Reorder the mirrored string by swapping its first two steps — same
  // twelve values, same marker, DIFFERENT order. `check-mirrors.mjs`
  // compares the literal VALUE (a string), so a reordered string is a
  // different string and must be caught exactly like a wrong number would.
  const markerLine = /export const CREATOR_PATH_STEPS_ORDER = "([^"]*)"; \/\/ mirror of api\/_funnel\.js#FUNNEL_STEPS_ORDER/;
  const match = markerLine.exec(CREATOR_PATH_SRC);
  ok("the real CreatorPath.tsx source still carries its own mirror marker line", Boolean(match));
  const parts = match[1].split(",");
  ok("the mirrored order still has 12 parts to reorder", parts.length === 12);
  const reorderedParts = [parts[1], parts[0], ...parts.slice(2)];
  ok("the reorder actually changed something (not a vacuous swap)", reorderedParts.join(",") !== parts.join(","));
  const reorderedSrc = CREATOR_PATH_SRC.replace(markerLine, `export const CREATOR_PATH_STEPS_ORDER = "${reorderedParts.join(",")}"; // mirror of api/_funnel.js#FUNNEL_STEPS_ORDER`);
  ok("the mutation actually changed the source text (the control is not vacuous)", reorderedSrc !== CREATOR_PATH_SRC);

  const { mismatches: reorderedMismatches } = checkMirrors(
    { "src/studio/CreatorPath.tsx": reorderedSrc },
    { "api/_funnel.js": FUNNEL_SRC, "api/_readiness.js": READINESS_SRC },
  );
  ok("NEGATIVE CONTROL: a REORDERED CREATOR_PATH_STEPS_ORDER mirror is caught by the real check-mirrors.mjs",
    reorderedMismatches.some((m) => m.name === "FUNNEL_STEPS_ORDER"),
    JSON.stringify(reorderedMismatches));
}
{
  // A second negative control, one number over: a wrong readiness floor is
  // caught the same way.
  const badFloorSrc = CREATOR_PATH_SRC.replace(
    "export const CREATOR_PATH_READINESS_OVERALL_FLOOR = 70; // mirror of api/_readiness.js#READINESS_OVERALL_FLOOR",
    "export const CREATOR_PATH_READINESS_OVERALL_FLOOR = 71; // mirror of api/_readiness.js#READINESS_OVERALL_FLOOR",
  );
  ok("the floor mutation actually changed the source text", badFloorSrc !== CREATOR_PATH_SRC);
  const { mismatches } = checkMirrors(
    { "src/studio/CreatorPath.tsx": badFloorSrc },
    { "api/_funnel.js": FUNNEL_SRC, "api/_readiness.js": READINESS_SRC },
  );
  ok("NEGATIVE CONTROL: a wrong READINESS_OVERALL_FLOOR mirror is caught by check-mirrors.mjs",
    mismatches.some((m) => m.name === "READINESS_OVERALL_FLOOR"));
}

console.log(`\nstudio-path: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
