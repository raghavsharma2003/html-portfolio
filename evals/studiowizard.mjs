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
//
//  7. OURS IS NEVER RENDERED AS THEIRS (WS-AJ). The studio shipped "9 things on
//     Meet it are still waiting on you" while the true blocker was a processing
//     queue nothing drained. Section 8 asserts, over the whole input space,
//     that no platform-owned blocker's prose blames the person and that no
//     blocking sentence counts opaque things, and it carries the strongest
//     negative control in this file: the exact sentence the owner was shown,
//     asserted to FAIL. If that check goes quiet the sentence can come back.
//
//  8. A BUTTON SAYS WHERE IT GOES. Section 9. "Next: Deploy it" is a step name
//     in a sentence slot, and DESIGN-LAW §1's read-aloud test is the gate.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "studiowizard-"));
const ENTRY = join(OUT, "entry.ts");
// Both pure modules, bundled from the REAL source on every run. `blockerClass`
// is exported alongside the wizard rather than reached through it because §8
// asserts on its detectors directly, and a suite that can only see a rule
// through the code it is meant to police is a suite that goes quiet the moment
// that code stops calling it.
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/studio/wizardModel"))};\n` +
  `export * as honesty from ${JSON.stringify(join(REPO, "src/studio/blockerClass"))};\n`,
);
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
  stepFromQuery,
  queryForStep,
  STEP_ORDER,
  stepBlockReason,
  allBlockerCodes,
  voicePreviewBlockReason,
  honesty,
} = M;

const { blamesThePerson, countsOpaqueThings, reasonIsHonest, activityClass, CLASS_COPY } = honesty;

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
  // WS-R7. `null` is "RoomStudio has not answered yet", the same shape
  // `connectedChannels` above already carries — see §9 for the coverage.
  roomPublished: null,
  // WS-AJ. `null` is "the activity surface has not answered", and it must
  // reclassify nothing: the wizard has to behave exactly as it did before this
  // field existed when it is absent. §8 asserts that directly.
  platformWork: null,
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

/* The platform's own state, in the four shapes that change an answer.
 *
 * `null` is the unread case and is the one that must change nothing.
 * `IDLE` is the platform having answered and having nothing in flight, which is
 * NOT the same as `null` and is the pair that catches an `?? {}` written by
 * someone tidying up. The last two are the two ways work is ours: moving, and
 * stopped. The stuck one is the owner's actual situation on the day they
 * tested, with audio sitting at `quarantined` behind a queue nothing drained. */
const PLATFORM_WORK = [
  null,
  { running: 0, stuck: 0, undeployedLanes: [] },
  { running: 2, stuck: 0, undeployedLanes: [] },
  { running: 0, stuck: 1, undeployedLanes: ["Uploaded recordings"] },
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
                    for (const platformWork of PLATFORM_WORK) {
                      universe.push(input({
                        stopped, sourceConsent, sourceCount, contextItemCount,
                        identityVerified, livenessVerified, sheetPersisted, mode,
                        runtime, connectedChannels, platformWork,
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
  // `STEP_ORDER` itself is still the property to assert: three steps, in the
  // owner's order, is checked in section 1. Per-step chain helpers
  // (`nextStep`/`previousStep`) were deleted with the sticky pager they fed
  // (WS-AP, `context/rejected.md#the-sticky-pager-was-deleted-not-shrunk`).
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
      const hits = STEP_ORDER.filter((id) => blockersForStep([code], id, input()).length > 0);
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

// ── 8. the honesty split is a PROPERTY, not a rendering accident ──────────
//
// WHAT THIS SECTION IS FOR, AND WHAT IT COSTS TO LOSE IT
//
// The studio shipped this, on a phone, under a disabled button:
//
//     "Your clone is not activatable yet. 9 things on Meet it are still
//      waiting on you, and every channel below stays refused until they clear."
//
// At the moment that rendered, the owner's uploaded audio was sitting at
// `quarantined` because nothing deployed drains the processing queue. Not one
// of those nine was an act they could perform. We told a person, nine times
// over, that our unfinished work was their unfinished work.
//
// That sentence was not a typo. It was structurally reachable: `stepEntryWarning`
// returned a bare STRING, and a string has no class, so nothing downstream
// could render "ours" differently from "yours" and nothing anywhere could
// check that a sentence had not blamed the wrong party. The repair is a type
// (`blockerClass.ts`), and a type without a check is a suggestion, so:
//
//   8a. every `us`-class string this build can produce is blame-free, over the
//       WHOLE input space, not over a demo path;
//   8b. no blocking sentence counts opaque things;
//   8c. `null` platform state reclassifies nothing, so the field is safe to
//       land before its backend is reliable;
//   8d. THE NEGATIVE CONTROL: a blocker that is ours, rendered as the person's
//       fault, must FAIL. Both detectors are run against the actual sentence
//       from the screenshot. If that stops failing, this section has gone quiet
//       and the sentence can come back.
console.log("\n── 8. ours is never rendered as theirs ──");

{
  // 8d FIRST, because a suite whose negative control is at the bottom is a
  // suite that gets read as green before anyone reaches it.
  const THE_SENTENCE =
    "Your clone is not activatable yet. 9 things on Meet it are still waiting on you, " +
    "and every channel below stays refused until they clear.";

  ok(
    "NEGATIVE CONTROL: the exact sentence the owner was shown is caught as blame",
    blamesThePerson(THE_SENTENCE),
  );
  ok(
    "NEGATIVE CONTROL: it is also caught as an opaque count",
    countsOpaqueThings(THE_SENTENCE),
  );
  ok(
    "NEGATIVE CONTROL: a hand-built OURS reason carrying that sentence is rejected",
    reasonIsHonest({
      kind: "us",
      classLabel: CLASS_COPY.us.label,
      headline: THE_SENTENCE,
      next: "Nothing for you to do here.",
    }) === false,
  );
  ok(
    "NEGATIVE CONTROL: the blame lands in `next` as well as in `headline`",
    reasonIsHonest({
      kind: "us",
      classLabel: CLASS_COPY.us.label,
      headline: "We are still processing your recordings.",
      next: "You still need to finish this before we can continue.",
    }) === false,
  );
  ok(
    "NEGATIVE CONTROL: an empty half is rejected, so a reason cannot be a shrug",
    reasonIsHonest({ kind: "us", classLabel: CLASS_COPY.us.label, headline: "Something is wrong.", next: "" }) === false,
  );
  // And the detector is not simply always-true: correct copy must survive it,
  // or the check is a switch nobody can turn green and gets deleted.
  ok(
    "the detector passes copy that is honest, so it is not a blanket refusal",
    reasonIsHonest({
      kind: "us",
      classLabel: CLASS_COPY.us.label,
      headline: "We are still processing what you gave us.",
      next: "Nothing for you to do here. You can pick this up when processing finishes.",
    }) === true,
  );
  // The near miss, kept because it is the one a well-meaning edit reaches for:
  // "this becomes your turn" is a promise, not an accusation, and the detector
  // cannot tell them apart. It is rejected, and the fix is the copy rather than
  // a looser rule. A detector relaxed to admit a nicer sentence is a detector
  // that admits the sentence it exists to catch.
  ok(
    "NEGATIVE CONTROL: even a well-meant \"this becomes your turn\" is refused in an OURS reason",
    reasonIsHonest({
      kind: "us",
      classLabel: CLASS_COPY.us.label,
      headline: "We are still processing what you gave us.",
      next: "This becomes your turn when processing finishes.",
    }) === false,
  );
  ok(
    "and it does not fire on the second person used correctly in a YOURS reason",
    reasonIsHonest({
      kind: "you",
      classLabel: CLASS_COPY.you.label,
      headline: "The box is empty, so there is nothing to say.",
      next: "Type a line for your clone to read aloud.",
    }) === true,
  );
}

{
  // 8a. Every `us` row, every `us` sentence, across the whole space.
  let blamedRows = 0;
  let blamedReasons = 0;
  let countedThings = 0;
  let classless = 0;
  let dishonest = 0;
  let firstBad = "";

  for (const row of universe) {
    const view = computeWizard(row);
    for (const step of view.steps) {
      for (const m of step.missing) {
        if (m.cls !== "you" && m.cls !== "us") classless++;
        if (m.cls === "us" && (blamesThePerson(m.note) || blamesThePerson(m.label))) {
          blamedRows++;
          if (!firstBad) firstBad = `${m.code}: ${m.note}`;
        }
        if (countsOpaqueThings(m.note)) countedThings++;
      }
    }
    for (const id of STEP_ORDER) {
      const reason = stepBlockReason(id, row);
      if (!reason) continue;
      if (!reasonIsHonest(reason)) {
        dishonest++;
        if (!firstBad) firstBad = `${id}: ${reason.headline} ${reason.next}`;
      }
      if (reason.kind === "us" && (blamesThePerson(reason.headline) || blamesThePerson(reason.next))) blamedReasons++;
      if (countsOpaqueThings(reason.headline) || countsOpaqueThings(reason.next)) countedThings++;
    }
  }

  ok(`every missing row carries a class, across all ${universe.length} inputs`, classless === 0, `bad=${classless}`);
  ok("no OURS row blames the person", blamedRows === 0, `bad=${blamedRows} ${firstBad}`);
  ok("no OURS blocking sentence blames the person", blamedReasons === 0, `bad=${blamedReasons}`);
  ok("no blocking sentence counts opaque things", countedThings === 0, `bad=${countedThings}`);
  ok("every blocking sentence is honest by its own definition", dishonest === 0, `bad=${dishonest} ${firstBad}`);
}

{
  // The whole shipped vocabulary, swept directly. `computeWizard` only reaches
  // a code the runtime happened to report in `RUNTIMES`; this reaches all of
  // them, so a new blocker added with careless copy is caught on the day it is
  // written rather than on the day a runtime first emits it.
  const codes = allBlockerCodes();
  ok("the blocker vocabulary is non-empty, so this sweep is not vacuous", codes.length > 0, `n=${codes.length}`);
  const bad = codes.filter((code) => {
    const meta = blockerMeta(code);
    return meta.owner === "platform" && (blamesThePerson(meta.note) || blamesThePerson(meta.label));
  });
  ok("no platform-owned blocker in the table blames the person", bad.length === 0, bad.join(","));
  ok(
    "no blocker note counts opaque things",
    codes.every((code) => !countsOpaqueThings(blockerMeta(code).note)),
  );
}

{
  // 8c. The safe default. This is the property that makes the field landable
  // ahead of the backend it reads from: absent must mean unchanged, not
  // "assume idle" and not "assume busy".
  const withNull = universe.filter((row) => row.platformWork === null);
  const same = withNull.every((row) => {
    const a = computeWizard(row);
    const { platformWork: _drop, ...withoutField } = row;
    const b = computeWizard(withoutField);
    return JSON.stringify(a) === JSON.stringify(b);
  });
  ok("an absent platform state behaves exactly as a null one", same, `n=${withNull.length}`);

  // And the reclassification actually happens when it should, or the field is
  // decoration. `person_profile_not_approved` is nominally the owner's turn and
  // is unreachable until our processing has produced something to approve.
  const busy = input({
    identityVerified: true,
    livenessVerified: true,
    sheetPersisted: true,
    mode: "generic",
    sourceConsent: true,
    sourceCount: 2,
    runtime: { active: false, blockers: ["person_profile_not_approved"], voiceGenomeVersion: null },
    platformWork: { running: 1, stuck: 0, undeployedLanes: [] },
  });
  const idle = input({ ...busy, platformWork: { running: 0, stuck: 0, undeployedLanes: [] } });
  const rowWhenBusy = stepOf(computeWizard(busy), "meet").missing.find((m) => m.code === "person_profile_not_approved");
  const rowWhenIdle = stepOf(computeWizard(idle), "meet").missing.find((m) => m.code === "person_profile_not_approved");
  ok("a gate that needs processed material is OURS while we are still processing", rowWhenBusy?.cls === "us");
  ok("and it is the person's turn once we are done", rowWhenIdle?.cls === "you");
  ok("the reclassified note says what is happening, not what they failed to do", !blamesThePerson(rowWhenBusy?.note || "x you have not"));
  ok(
    "and the step does not glow ember while the only open gate is ours",
    stepOf(computeWizard(busy), "meet").state === "running",
    stepOf(computeWizard(busy), "meet").state,
  );
  ok(
    "the same step IS ember once it is genuinely their turn",
    stepOf(computeWizard(idle), "meet").state === "waiting",
    stepOf(computeWizard(idle), "meet").state,
  );
}

{
  // The compact surfaces have one line each, and that line must be a NAME.
  let namedTop = 0;
  let countedTop = 0;
  for (const row of universe) {
    for (const step of computeWizard(row).steps) {
      if (step.state === "done" || step.state === "stopped") continue;
      if (step.missing.length === 0) continue;
      if (!step.top || !step.top.label) continue;
      namedTop++;
      if (countsOpaqueThings(step.top.label)) countedTop++;
    }
  }
  ok("a step with open items always names one", namedTop > 0, `n=${namedTop}`);
  ok("and the named one is never a count", countedTop === 0, `bad=${countedTop}`);
  ok(
    "the top item is the person's own next act whenever they have one",
    universe.every((row) => computeWizard(row).steps.every((s) => {
      const mine = s.missing.find((m) => m.cls === "you");
      return !mine || s.top === mine || s.top?.cls === "you";
    })),
  );
}

{
  // 8e. WS-AF's vocabulary, projected once. A second status vocabulary is a
  // second place for the truth to drift, so this asserts the mapping rather
  // than letting each surface decide.
  ok("waiting_on_you is the only activity state that is the person's turn", activityClass("waiting_on_you") === "you");
  ok("running is ours", activityClass("running") === "us");
  ok("queued is ours", activityClass("queued") === "us");
  ok("blocked is ours, which is where a quarantined upload sits", activityClass("blocked") === "us");
  ok("failed is ours", activityClass("failed") === "us");
  ok(
    "a state this build has never heard of is OURS, because not understanding it is our gap",
    activityClass("some_state_from_a_future_lane") === "us",
  );
  ok(
    "and a lane that is not deployed is ours whatever its rows say",
    activityClass("waiting_on_you", false) === "us",
  );
}

// WS-AP, 2026-08-26, owner directive: the sticky pager (`StepPager`) that
// used to live here — and the "one honest primary action" model
// (`pagerAction`/`PagerAction`) that fed it — are deleted, not shrunk. The
// owner's own words: "Remove it. Not shrink it, not reword it, not make it
// conditional. Delete it." Its two defects (a "Next:" button pointing at a
// step it simultaneously called refused; a caution sentence that truncated
// mid-word in the space it was given) are gone because the element is gone.
// What used to be sections 9 and 10 here — navigation-label copy checks and
// the `pagerAction` property/negative-control pair — tested that component
// and its model function directly and went with them.
//
// THE NEGATIVE CONTROL THIS SECTION USED TO CARRY IS NOW A DOM ASSERTION,
// NOT A MODEL ONE, because there is no longer a function to unit-test: the
// property is "this element does not exist in the rendered page", which only
// a real render can check. That assertion lives in `scripts/check-layout.mjs`
// (`pager-returned`), run against the real built studio in a real browser at
// three widths, with its own negative control proving IT bites (see that
// file's header and `context/rejected.md#the-sticky-pager-was-deleted-not-shrunk`
// for the reintroduce-and-confirm-FAIL run). `STEP_ORDER`'s three-step
// shape and the honesty properties on `stepBlockReason` (section 8, still the
// line every panel-level "waiting on us/you" reads from) are unaffected and
// still enforced above.

// ── 10. "Preview my voice" cannot invent its own class ────────────────────
//
// WS-AP, from a measured production defect. `VoicePreviewPanel` used to
// hardcode `disabledReason("us", ...)` for the "no draft yet" case
// unconditionally. On the owner's real replica — all eight processing steps
// complete, genome unapproved — the true blockers were the owner's OWN
// identity, liveness and an unreviewed evidence set, all `cls: "you"`, and
// the panel told them "nothing for you to do here" regardless.
// `voicePreviewBlockReason` is the one place that now decides, and it has to
// read the SAME classification `computeWizard` renders on the rail, or the
// two surfaces can disagree with each other again.
console.log('\n── 10. "Preview my voice" reads the rail\'s own classification ──');

{
  // THE EXACT PRODUCTION SHAPE: eight processing steps complete (no platform
  // work in flight), identity and liveness NOT verified, no runtime blockers
  // reported yet (a build has not even been queued, so there is nothing for
  // the runtime endpoint to name). This must not read "us".
  const ownerCase = input({
    sourceConsent: true,
    sourceCount: 1,
    identityVerified: false,
    livenessVerified: false,
    mode: "generic",
    runtime: null,
    platformWork: { running: 0, stuck: 0, undeployedLanes: [] },
  });
  const ownerReason = voicePreviewBlockReason(ownerCase);
  ok(
    "NEGATIVE CONTROL, PRODUCTION SHAPE: unverified identity is never reported as 'us'",
    ownerReason.kind === "you",
    ownerReason.kind,
  );
  ok("and it points at the identity gate specifically", /identity/i.test(ownerReason.next) || /identity/i.test(ownerReason.headline));

  // Identity and liveness done, but the review-and-approve gate is open and
  // our own queue is idle: also "you", because approving is a deliberate
  // human tap, never something that happens for a person.
  const reviewPending = input({
    sourceConsent: true,
    sourceCount: 1,
    identityVerified: true,
    livenessVerified: true,
    mode: "generic",
    runtime: { active: false, blockers: ["voice_genome_not_approved"], voiceGenomeVersion: null },
    platformWork: { running: 0, stuck: 0, undeployedLanes: [] },
  });
  ok(
    "and once identity/liveness are done, an unreviewed genome is 'you', not 'us'",
    voicePreviewBlockReason(reviewPending).kind === "you",
  );

  // The same gate WHILE we are still processing is genuinely ours — there is
  // nothing yet to review — which is `needsProcessedMaterial` doing its job.
  const stillProcessing = input({ ...reviewPending, platformWork: { running: 1, stuck: 0, undeployedLanes: [] } });
  ok(
    "and the identical gate reads 'us' while we are still processing",
    voicePreviewBlockReason(stillProcessing).kind === "us",
  );

  // Every reason this function can produce, over the whole space, is honest
  // by the house definition — the same law every other reason in this file
  // answers to.
  let dishonestPreview = 0;
  for (const row of universe) {
    if (!reasonIsHonest(voicePreviewBlockReason(row))) dishonestPreview++;
  }
  ok(`every voicePreviewBlockReason is honest, across all ${universe.length} inputs`, dishonestPreview === 0, `bad=${dishonestPreview}`);

  // And it never disagrees with the rail: whatever class the panel reports
  // for a still-open gate, `computeWizard`'s own Meet row for that gate (when
  // one exists) must report the same class. This is the property that keeps
  // a second surface from drifting away from the first one again.
  let disagreements = 0;
  for (const row of universe) {
    const meetRows = stepOf(computeWizard(row), "meet").missing;
    if (meetRows.length === 0) continue;
    const panelReason = voicePreviewBlockReason(row);
    const named = meetRows.find((m) => panelReason.headline.includes(m.label) || panelReason.next === m.note);
    if (named && named.cls !== panelReason.kind) disagreements++;
  }
  ok("the panel's class never disagrees with the rail's class for the gate it names", disagreements === 0, `bad=${disagreements}`);
}

// ── 11. WS-R7: a published Room is a second, honest way Deploy reads done ──
console.log("\n── 11. a published Room completes Deploy the same way a channel does ──");

{
  const live = { active: true, blockers: [], voiceGenomeVersion: 3 };

  ok(
    "a known zero channels still asks while the Room's own state is UNKNOWN (null is not published)",
    stepOf(computeWizard(input({ runtime: live, connectedChannels: 0, roomPublished: null })), "deploy")
      .missing.some((row) => row.code === "no_channel"),
  );
  ok(
    "a published Room alone, with zero channels, is enough for Deploy to read done",
    stepOf(computeWizard(input({ runtime: live, connectedChannels: 0, roomPublished: true })), "deploy").state === "done",
  );
  ok(
    "a published Room suppresses the 'connect a channel' ask",
    !stepOf(computeWizard(input({ runtime: live, connectedChannels: 0, roomPublished: true })), "deploy")
      .missing.some((row) => row.code === "no_channel"),
  );
  ok(
    "zero channels AND an unpublished Room still asks",
    stepOf(computeWizard(input({ runtime: live, connectedChannels: 0, roomPublished: false })), "deploy")
      .missing.some((row) => row.code === "no_channel"),
  );
  ok(
    "a connected channel alone is still enough on its own (unchanged from before this field existed)",
    stepOf(computeWizard(input({ runtime: live, connectedChannels: 1, roomPublished: false })), "deploy").state === "done",
  );
  ok(
    "absent `roomPublished` (a build that never mounts RoomStudio) behaves exactly as it did before this field existed",
    stepOf(computeWizard(input({ runtime: live, connectedChannels: 0 })), "deploy").state !== "done"
      && stepOf(computeWizard(input({ runtime: live, connectedChannels: 0 })), "deploy").missing.some((row) => row.code === "no_channel"),
  );
}

console.log(fail ? `\n${fail} of ${pass + fail} FAILURES` : `\nALL ${pass} CHECKS PASS`);
process.exitCode = fail ? 1 : 0;
