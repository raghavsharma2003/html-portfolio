// The studio wizard's state machine (WS-AE).
//
//   node evals/studiowizard.mjs
//
// Offline, deterministic, $0, no DB, no browser. Bundles the REAL TypeScript on
// every run (`evals/mirrorcall.mjs`'s pattern, and CLAUDE.md's reason: a frozen
// bundle passes forever while the source rots).
//
// ── what this suite is actually guarding ──────────────────────────────────
//
// The studio's defect, in the owner's words, was that it was "one single screen
// of nonsense". The fix is a three-step wizard, and the risk a restructure
// carries is not that the layout is wrong. It is that a rail full of confident
// green ticks tells a teacher their clone is ready when the runtime is still
// refusing to activate it. `docs/gurukul/PRODUCT-JOURNEY.md` §3.2 states the
// rule the whole rail is built to make unbreakable:
//
//     "No rail row may render a status that is not derived from data."
//
// BREAK 8 (a literal "0 / No model trained") and BREAK 11 (a hardcoded `next`
// class that made a 3-step checklist structurally unable to reach 3/3) were the
// same defect twice, in two files, both written by people who knew better. A
// status computed in JSX will eventually be typed by hand. So the status is
// computed by `src/studio/wizardModel.ts` and this file runs it over the whole
// input space rather than over the one path a demo takes.
//
// The six properties below, and why each one would go quiet under an ordinary
// looking simplification:
//
//  1. ONE EMBER AT A TIME. `DESIGN-SYSTEM.md` §4.1 caps `--state-waiting` at
//     one on screen, because a rail with three things glowing is a rail nobody
//     starts. The obvious implementation is per-row ("am I not done?"), which
//     is wrong on every input where two steps are incomplete, i.e. the normal
//     case. Section 2 fuzzes the entire input space and asserts at most one.
//
//  2. UNKNOWN IS NOT ZERO. Three of the wizard's inputs can be `null`, meaning
//     a fetch has not answered. The tempting `?? 0` turns "we did not ask" into
//     "you have none", which is a status derived from a spinner. Section 3
//     asserts a null never produces a claim about what the owner has.
//
//  3. A STEP IS NEVER SILENTLY BLOCKED. The owner's stated priority is "the
//     major thing is to interact with the agent". A wizard that refuses to open
//     Meet until Feed is perfect is the wall again wearing a progress bar.
//     Section 4 asserts every step is reachable and that arriving early
//     produces a sentence naming what is missing rather than a locked door.
//
//  4. A GATE WE DO NOT RECOGNISE STILL COUNTS. The surface this replaces
//     filtered `runtime.blockers` down to codes it had copy for, so an
//     unrecognised gate could hold the Activate button shut while the checklist
//     read clear. Section 5 asserts an unknown code is rendered, not dropped.
//
//  5. DONE MEANS DONE. No step may report `done` while it still lists something
//     missing. Section 6 asserts the two can never disagree, over the fuzz.
//
//  6. THE URL IS THE STEP. Refresh, bookmark and browser Back all have to land
//     where the owner was, and `?mode=teacher` may not be lost on the way,
//     because losing it flips the studio's whole copy mid-flow (BREAK 1 by a
//     second route). Section 7 covers the parser and the query writer,
//     including hostile input.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "studiowizard-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(ENTRY, `export * from ${JSON.stringify(join(REPO, "src/studio/wizardModel"))};\n`);
const BUNDLE = join(OUT, "wizard.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const M = await import(pathToFileURL(BUNDLE).href);
const {
  computeWizard,
  stepEntryWarning,
  blockersForStep,
  unknownBlockers,
  blockerMeta,
  nextStep,
  previousStep,
  stepFromQuery,
  queryForStep,
  STEP_ORDER,
} = M;

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

/** A fully unknown owner: nothing fetched, nothing granted. */
const BLANK = {
  stopped: false,
  sourceConsent: false,
  sourceCount: 0,
  contextItemCount: null,
  identityVerified: false,
  livenessVerified: false,
  sheetPersisted: false,
  mode: "teacher",
  runtime: null,
  connectedChannels: null,
};

const input = (over = {}) => ({ ...BLANK, ...over });
const stepOf = (view, id) => view.steps.find((row) => row.id === id);

// ── 1. the shape ──────────────────────────────────────────────────────────
console.log("\n── 1. the shape ──");

{
  const view = computeWizard(input());
  ok("three steps, in the owner's order", view.steps.map((s) => s.id).join(",") === "feed,meet,deploy");
  ok("numbering is phase scoped and 1-based", view.steps.map((s) => s.number).join(",") === "1,2,3");
  ok(
    "every step carries a WORD for its state, never only a colour",
    view.steps.every((s) => typeof s.statusLabel === "string" && s.statusLabel.length > 0),
  );
  ok("STEP_ORDER and the rendered order agree", STEP_ORDER.join(",") === view.steps.map((s) => s.id).join(","));
}

// ── 2. THE property: one ember at a time ──────────────────────────────────
console.log("\n── 2. one ember at a time, over the whole input space ──");

const BOOLS = [false, true];
const TRISTATE = [null, 0, 3];
const RUNTIMES = [
  null,
  { active: false, blockers: [], voiceGenomeVersion: null },
  { active: false, blockers: ["identity_verification_required"], voiceGenomeVersion: null },
  { active: false, blockers: ["voice_not_ready", "production_voice_required"], voiceGenomeVersion: null },
  { active: false, blockers: ["qualification_incomplete"], voiceGenomeVersion: 2 },
  { active: true, blockers: [], voiceGenomeVersion: 4 },
];

const universe = [];
for (const stopped of BOOLS) {
  for (const sourceConsent of BOOLS) {
    for (const sourceCount of [0, 2]) {
      for (const contextItemCount of TRISTATE) {
        for (const identityVerified of BOOLS) {
          for (const livenessVerified of BOOLS) {
            for (const sheetPersisted of BOOLS) {
              for (const mode of ["generic", "teacher"]) {
                for (const runtime of RUNTIMES) {
                  for (const connectedChannels of TRISTATE) {
                    universe.push(input({
                      stopped, sourceConsent, sourceCount, contextItemCount,
                      identityVerified, livenessVerified, sheetPersisted, mode,
                      runtime, connectedChannels,
                    }));
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

let embersOver = 0;
let emberMismatch = 0;
let emberOnDone = 0;
let emberWhileStopped = 0;
for (const row of universe) {
  const view = computeWizard(row);
  const embers = view.steps.filter((s) => s.state === "waiting");
  if (embers.length > 1) embersOver++;
  if ((view.emberStep === null) !== (embers.length === 0)) emberMismatch++;
  if (embers.some((s) => s.missing.length === 0)) emberOnDone++;
  if (row.stopped && embers.length > 0) emberWhileStopped++;
}

ok(`at most one ember across all ${universe.length} inputs`, embersOver === 0, `over=${embersOver}`);
ok("emberStep and the rendered waiting row never disagree", emberMismatch === 0, `bad=${emberMismatch}`);
ok("an ember always has something to act on", emberOnDone === 0, `bad=${emberOnDone}`);
ok("a revoked workspace never asks the owner for anything", emberWhileStopped === 0, `bad=${emberWhileStopped}`);

// The negative control: a rail that decided per-row would fail this property.
// Modelled here rather than described, so the assertion is that the SHAPE of
// the wrong implementation is genuinely caught.
{
  const naive = (row) => computeWizard(row).steps.filter((s) => s.state !== "done" && s.missing.length > 0);
  const someInputHasTwoIncomplete = universe.some((row) => !row.stopped && naive(row).length > 1);
  ok(
    "the negative control is real: some inputs have two incomplete steps, so per-row ember logic would light two",
    someInputHasTwoIncomplete,
  );
}

// ── 3. unknown is not zero ────────────────────────────────────────────────
console.log("\n── 3. unknown is not zero ──");

{
  const loading = computeWizard(input({ sourceConsent: true, sourceCount: 0, contextItemCount: null }));
  const feed = stepOf(loading, "feed");
  ok(
    "an unanswered Context Locker never becomes 'you have added nothing'",
    !feed.missing.some((row) => row.code === "no_material"),
  );
  ok("but an unanswered locker does not complete the step either", feed.state !== "done");

  const answered = computeWizard(input({ sourceConsent: true, sourceCount: 0, contextItemCount: 0 }));
  ok(
    "once the locker answers zero, the ask appears",
    stepOf(answered, "feed").missing.some((row) => row.code === "no_material"),
  );

  const live = { active: true, blockers: [], voiceGenomeVersion: 3 };
  const unknownChannels = computeWizard(input({ runtime: live, connectedChannels: null }));
  ok(
    "unknown channel state makes no claim about channels",
    !stepOf(unknownChannels, "deploy").missing.some((row) => row.code === "no_channel"),
  );
  ok(
    "and unknown channel state cannot complete Deploy either",
    stepOf(unknownChannels, "deploy").state !== "done",
  );
  ok(
    "a KNOWN zero does produce the ask",
    stepOf(computeWizard(input({ runtime: live, connectedChannels: 0 })), "deploy")
      .missing.some((row) => row.code === "no_channel"),
  );
  ok(
    "a live runtime with a connected channel is the only way Deploy reads done",
    stepOf(computeWizard(input({ runtime: live, connectedChannels: 1 })), "deploy").state === "done",
  );
}

// ── 4. a step is never silently blocked ───────────────────────────────────
console.log("\n── 4. reachable, with an honest line ──");

{
  const early = input();
  ok(
    "arriving at Meet with nothing fed produces a sentence, not a refusal",
    typeof stepEntryWarning("meet", early) === "string" && stepEntryWarning("meet", early).length > 20,
  );
  ok(
    "the Feed step never warns about itself",
    stepEntryWarning("feed", early) === null,
  );
  const fed = input({
    sourceConsent: true,
    sourceCount: 1,
    contextItemCount: 2,
    identityVerified: true,
    livenessVerified: true,
    sheetPersisted: true,
    runtime: { active: false, blockers: [], voiceGenomeVersion: 1 },
  });
  ok("a ready owner sees no warning on Meet", stepEntryWarning("meet", fed) === null);
  ok("a ready owner sees no warning on Deploy", stepEntryWarning("deploy", fed) === null);
  ok(
    "a revoked workspace says so on every step",
    STEP_ORDER.every((id) => /revoked/i.test(stepEntryWarning(id, input({ stopped: true })) || "")),
  );
  // The wording rule: name what is missing, never "complete step 1 first".
  const nagging = universe
    .map((row) => STEP_ORDER.map((id) => stepEntryWarning(id, row)))
    .flat()
    .filter(Boolean);
  ok(
    "no warning tells the owner they may not be here",
    !nagging.some((text) => /cannot be here|not allowed|complete step/i.test(text)),
  );
  ok("nav is a simple chain with no dead ends", nextStep("feed") === "meet" && nextStep("meet") === "deploy" && nextStep("deploy") === null);
  ok("and it walks back", previousStep("deploy") === "meet" && previousStep("meet") === "feed" && previousStep("feed") === null);
}

// ── 5. an unrecognised gate is rendered, not dropped ──────────────────────
console.log("\n── 5. an unrecognised gate still counts ──");

{
  const weird = computeWizard(input({
    runtime: { active: false, blockers: ["a_gate_this_build_has_never_heard_of"], voiceGenomeVersion: null },
  }));
  const deploy = stepOf(weird, "deploy");
  ok(
    "an unknown blocker code appears in the Deploy list",
    deploy.missing.some((row) => row.code === "a_gate_this_build_has_never_heard_of"),
  );
  ok("and it keeps the step out of done", deploy.state !== "done");
  ok("unknownBlockers names exactly the unrecognised ones", unknownBlockers(["voice_not_ready", "zzz"]).join() === "zzz");
  ok("blockerMeta answers null rather than throwing on an unknown code", blockerMeta("zzz") === null);
  ok(
    "blockersForStep routes each known code to exactly one step",
    ["identity_verification_required", "qualification_incomplete"].every((code) => {
      const hits = STEP_ORDER.filter((id) => blockersForStep([code], id).length > 0);
      return hits.length === 1;
    }),
  );
  ok(
    "every missing row names whose turn it is",
    universe.every((row) => computeWizard(row).steps.every((s) =>
      s.missing.every((m) => m.owner === "you" || m.owner === "platform"))),
  );
  // A step whose every open item belongs to the platform is slate, not ember:
  // `--state-running` means "you cannot speed this up" and a colour that looked
  // urgent for a three-minute cold start would be a lie told in paint.
  const platformOnly = computeWizard(input({
    sourceConsent: true,
    sourceCount: 1,
    identityVerified: true,
    livenessVerified: true,
    sheetPersisted: true,
    runtime: { active: false, blockers: ["voice_not_ready"], voiceGenomeVersion: null },
  }));
  ok("a platform-only step reads running, not your turn", stepOf(platformOnly, "meet").state === "running");
  ok("and it does not take the ember", platformOnly.emberStep !== "meet");
}

// ── 6. done means done ────────────────────────────────────────────────────
console.log("\n── 6. done means done ──");

{
  let contradictions = 0;
  let doneWithoutData = 0;
  for (const row of universe) {
    for (const s of computeWizard(row).steps) {
      if (s.state === "done" && s.missing.length > 0) contradictions++;
      // Deploy can only be done off a real runtime answer. A `null` runtime is
      // an unanswered fetch and may never complete a step.
      if (s.id === "deploy" && s.state === "done" && row.runtime === null) doneWithoutData++;
    }
  }
  ok("no step reports done while listing something missing", contradictions === 0, `bad=${contradictions}`);
  ok("Deploy is never done without a runtime answer", doneWithoutData === 0, `bad=${doneWithoutData}`);
  ok(
    "a stopped workspace reports stopped on every step, and never done",
    computeWizard(input({ stopped: true })).steps.every((s) => s.state === "stopped"),
  );
  // Teacher mode owes a saved sheet; generic mode has no sheet to owe.
  const teacherNoSheet = computeWizard(input({
    mode: "teacher", identityVerified: true, livenessVerified: true, sheetPersisted: false,
  }));
  const genericNoSheet = computeWizard(input({
    mode: "generic", identityVerified: true, livenessVerified: true, sheetPersisted: false,
  }));
  ok(
    "teacher mode asks for a saved sheet",
    stepOf(teacherNoSheet, "meet").missing.some((row) => row.code === "sheet_not_saved"),
  );
  ok(
    "generic mode does not invent a sheet requirement",
    !stepOf(genericNoSheet, "meet").missing.some((row) => row.code === "sheet_not_saved"),
  );
}

// ── 7. the URL is the step ────────────────────────────────────────────────
console.log("\n── 7. refresh, bookmark and Back all land where you were ──");

{
  ok("a known step round-trips", stepFromQuery("?step=meet") === "meet");
  ok("an unknown step falls back to the first, which is never destructive", stepFromQuery("?step=nonsense") === "feed");
  ok("an absent step falls back to the first", stepFromQuery("") === "feed");
  ok("a hostile query does not throw", stepFromQuery("?%%%&&step=deploy") !== undefined);
  ok(
    "teacher mode survives a Next click",
    /mode=teacher/.test(queryForStep("?mode=teacher&step=feed", "meet")),
  );
  ok(
    "and the step is actually rewritten rather than appended twice",
    (queryForStep("?mode=teacher&step=feed", "meet").match(/step=/g) || []).length === 1,
  );
  ok(
    "every step id survives a write then a read",
    STEP_ORDER.every((id) => stepFromQuery(queryForStep("?mode=teacher", id)) === id),
  );
}

console.log(fail ? `\n${fail} of ${pass + fail} FAILURES` : `\nALL ${pass} CHECKS PASS`);
process.exitCode = fail ? 1 : 0;
