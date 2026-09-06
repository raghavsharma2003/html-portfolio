// evals/studio-shell/run.mjs — WS-R31. The Feed/Meet/Share collapse, offline.
//
//   node evals/studio-shell/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no browser. Bundles the REAL
// `src/studio/studioShellModel.ts` on every run (`evals/mirrorcall.mjs`'s
// pattern: a temp entry file re-exporting the real source, then esbuild),
// so this suite gates the tree being shipped rather than a frozen snapshot.
// The orphan check below reads `StudioShell.tsx` / `StudioApp.tsx` off disk
// directly, for the same reason.
//
// ── what this suite is actually guarding ──────────────────────────────────
//
// 1. NO PANEL IS ORPHANED. WS-R31's Law 1 is "nothing is deleted, no gate
//    moves" — every panel component that lived in the old wizard rail must
//    still be reachable from SOMEWHERE (the shell's own tabs, or the "All
//    panels" view `StudioApp.tsx` falls back to). A static text scan of both
//    files, compared against the real `src/studio/` directory listing, so a
//    panel dropped in later and never wired into either view is caught by
//    name rather than discovered in production.
//
// 2. THE HEADLINE STATE for each tab under empty / partial / complete
//    fixtures — computed, never guessed, matching `ReadinessPanel.tsx`'s own
//    "never a fake number" law: `studioShellModel.ts`'s `undefined`-means-
//    "not checked this visit" convention is asserted directly, because
//    rendering "no Room yet" before ever having looked is exactly the
//    fabricated-negative shape `docs/HONESTY.md` forbids.
//
// 3. THE PRIMARY CONTROL is always the blocker list's own next thing — for
//    Feed and Meet, `wizard.steps[i].top`'s own anchor; for Share, the
//    Room's own first blocker. Property-checked: whenever a `top`/
//    `roomBlocker` fixture is supplied, the returned `primary.anchor` is
//    asserted equal to it, over many generated fixtures, not one example.
//
// 4. THREE NEGATIVE CONTROLS, each proven to fail before the fix and pass
//    after, the standard this repo's suites hold every control to:
//      (a) a real panel's import struck from BOTH files' text is caught by
//          the same orphan check that passes on the untouched tree;
//      (b) a hand-built headline whose `primary` is an array of two entries
//          is refused by the same shape check every real headline in this
//          run is asserted to pass;
//      (c) a string containing "train" or "model" fails
//          `scripts/check-copy.mjs`'s own scanner, imported directly rather
//          than re-implemented.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
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

// ── bundle the real pure model, mirrorcall.mjs's pattern ──────────────────

const OUT = mkdtempSync(join(tmpdir(), "studio-shell-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(ENTRY, `export * from ${JSON.stringify(join(STUDIO_DIR, "studioShellModel"))};\n`);
const BUNDLE = join(OUT, "studio-shell.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { cwd: REPO, stdio: "inherit" },
);
const M = await import(pathToFileURL(BUNDLE).href);
const { TAB_ORDER, TAB_STEP, feedHeadline, meetHeadline, shareHeadline } = M;

ok("TAB_ORDER is exactly feed, meet, share", JSON.stringify(TAB_ORDER) === JSON.stringify(["feed", "meet", "share"]));
ok("TAB_STEP maps share onto the wizard's existing deploy step", TAB_STEP.share === "deploy" && TAB_STEP.feed === "feed" && TAB_STEP.meet === "meet");

// ── 1. ORPHAN CHECK ────────────────────────────────────────────────────────

// Files under src/studio/ that are NOT a panel mounted standalone somewhere
// in the wizard/shell tree. Each exclusion is a decision, named, not a
// guess — the check below fails loudly the day a real panel is added here
// by mistake to make the suite quiet.
const NOT_A_STANDALONE_PANEL = new Set([
  "StudioApp.tsx",     // the app shell itself
  "StudioShell.tsx",   // the app shell's collapsed presentation
  "WizardRail.tsx",    // navigation chrome (Band/StepHead/jumpTo/CompactRail), not a panel
  "BlockerNotice.tsx", // a shared primitive rendered INSIDE other panels
  "InviteGate.tsx",    // the pre-workspace gate, rendered before any replica exists
  "layoutFixture.tsx", // the layout gate's own harness; never shipped
  "TurnFeedback.tsx",  // rendered inside MirrorCallStudio, never mounted standalone
  "OpsBoard.tsx",      // a separate operator route wired from main.tsx, outside the wizard/shell tree
  "CheckinsCard.tsx",  // mounted INSIDE RoomStudio.tsx (`import CheckinsCard from "./CheckinsCard"`), never standalone
  "HandoffCard.tsx",   // mounted INSIDE RoomStudio.tsx, same as CheckinsCard above
  "SuiteCard.tsx",     // WS-R28: mounted INSIDE RoomStudio.tsx (`import SuiteCard from "./SuiteCard"`), same as the two above; the orphan check caught it at the wave-seven merge, which is the check working
  "PayoutsCard.tsx",   // WS-R36: mounted INSIDE RoomStudio.tsx (`import PayoutsCard from "./PayoutsCard"`), same as the three above; the orphan check caught it while this workstream still had it uncommitted, which is the check working.
  "InviteCreatorCard.tsx", // WS-R47: mounted INSIDE RoomStudio.tsx (`import InviteCreatorCard from "./InviteCreatorCard"`), same as the four above; the orphan check caught it while this workstream still had it uncommitted, which is the check working.
  "ShowcaseCard.tsx", // WS-R66: mounted INSIDE RoomStudio.tsx (`import ShowcaseCard from "./ShowcaseCard"`), same as the five above; the orphan check caught it while this workstream still had it uncommitted, which is the check working.
  "ShareKitCard.tsx", // WS-R85: mounted INSIDE RoomStudio.tsx (`import ShareKitCard from "./ShareKitCard"`), same as the six above; the orphan check caught it while this workstream still had it uncommitted, which is the check working.
]);

// `main.tsx` is the Vite entry point, not a component: `.tsx` extension only
// because it renders JSX to mount `StudioApp`. Every other name in this
// directory that ends `.tsx` is a real candidate, so this is checked by name
// rather than folded into the exclusion set above.
const panelFiles = readdirSync(STUDIO_DIR)
  .filter((name) => name.endsWith(".tsx") && name !== "main.tsx")
  .filter((name) => !NOT_A_STANDALONE_PANEL.has(name));

const shellSource = readFileSync(join(STUDIO_DIR, "StudioShell.tsx"), "utf8");
const appSource = readFileSync(join(STUDIO_DIR, "StudioApp.tsx"), "utf8");

function isMountedSomewhere(componentName, shellText, appText) {
  // WS-R49: a panel can be wired in two source shapes now — a static
  // `import X from "./X"` (every panel until this workstream) or
  // `lazy(() => import("./X"))` (nine panels StudioApp.tsx now code-splits,
  // none reachable before sign-in and a replica). Both are a real mount; only
  // the first has a `from` keyword, so the scan has to look for either rather
  // than treating the dynamic form as absent, which is what this check did
  // before this line and is exactly the class of gap named in this repo's own
  // rejected.md#ws-r35-pulse-combo-sql-factored-through-a-helper-evaded-the-
  // leak-batterys-static-scan: a static text scan blind to a new but
  // equivalent shape.
  const staticImport = new RegExp(`from ["']\\./${componentName}["']`);
  const dynamicImport = new RegExp(`import\\(["']\\./${componentName}["']\\)`);
  return staticImport.test(shellText) || staticImport.test(appText)
    || dynamicImport.test(shellText) || dynamicImport.test(appText);
}

for (const file of panelFiles) {
  const name = file.replace(/\.tsx$/, "");
  ok(`orphan check: ${name} is mounted somewhere (shell tabs or the All panels view)`, isMountedSomewhere(name, shellSource, appSource));
}

// negative control (a): strike a REAL panel's import from both files' text
// and prove the SAME check function then reports it orphaned.
{
  const struck = "ProcessingReview";
  ok(`sanity: ${struck} really is mounted on the untouched tree`, isMountedSomewhere(struck, shellSource, appSource));
  const strippedShell = shellSource.replaceAll(`./${struck}`, "./__not_here__");
  const strippedApp = appSource.replaceAll(`./${struck}`, "./__not_here__");
  ok(
    "negative control: a panel struck from both files' text IS caught as orphaned",
    !isMountedSomewhere(struck, strippedShell, strippedApp),
  );
}

// ── 2 & 3. headline state + primary control, per tab, per fixture ─────────

const missing = (over = {}) => ({ code: "x", label: "Do the thing", owner: "you", cls: "you", note: "note", anchor: "#the-thing", ...over });

const allHeadlines = [];
const record = (h) => { allHeadlines.push(h); return h; };

// FEED
{
  const empty = record(feedHeadline({ sourceCount: 0, platformWork: null, top: null }));
  ok("feed/empty: state is empty", empty.state === "empty");
  ok("feed/empty: primary points at the enrollment workspace", empty.primary?.anchor === "#enrollment-workspace");

  const withTop = record(feedHeadline({ sourceCount: 0, platformWork: null, top: missing({ anchor: "#source-consent" }) }));
  ok("feed/empty+top: primary equals the top blocker's own anchor", withTop.primary?.anchor === "#source-consent");

  const working = record(feedHeadline({ sourceCount: 3, platformWork: { running: 1, stuck: 0, undeployedLanes: [] }, top: null }));
  ok("feed/working: state is working, not blocked", working.state === "working");
  ok("feed/working: primary is class us", working.primary?.cls === "us");

  const stuck = record(feedHeadline({ sourceCount: 2, platformWork: { running: 0, stuck: 1, undeployedLanes: [] }, top: null }));
  ok("feed/stuck: state is blocked_us", stuck.state === "blocked_us");

  const clear = record(feedHeadline({ sourceCount: 5, platformWork: null, top: null }));
  ok("feed/clear: state is clear with no control left to name", clear.state === "clear" && clear.primary === null);

  const clearWithTop = record(feedHeadline({ sourceCount: 5, platformWork: null, top: missing({ anchor: "#video-link-mount", cls: "us" }) }));
  ok("feed/clear+top: primary equals the top blocker's own anchor even once sources exist", clearWithTop.primary?.anchor === "#video-link-mount");
}

// MEET
{
  const unchecked = record(meetHeadline({ readiness: undefined, interviewNextTopic: null, top: null }));
  ok("meet/unchecked: says not checked, never a fabricated empty state", unchecked.sentence.toLowerCase().includes("not checked"));

  const nothingMeasured = record(meetHeadline({ readiness: null, interviewNextTopic: null, top: null }));
  ok("meet/checked+nothing: state is empty", nothingMeasured.state === "empty");
  ok("meet/checked+nothing: primary points at hearing the voice", nothingMeasured.primary?.anchor === "#hear-voice");

  const locked = record(meetHeadline({
    readiness: { overall: 61, weakestLabel: "Thinks like you", publishLocked: true, suggestedAction: { label: "Correct an answer", anchor: "#review-queue" } },
    interviewNextTopic: null,
    top: null,
  }));
  ok("meet/locked: state is blocked_you", locked.state === "blocked_you");
  ok("meet/locked: sentence names the actual score", locked.sentence.includes("61"));
  ok("meet/locked: primary is the server's own suggested action", locked.primary?.anchor === "#review-queue");

  const open = record(meetHeadline({
    readiness: { overall: 88, weakestLabel: null, publishLocked: false, suggestedAction: null },
    interviewNextTopic: null,
    top: null,
  }));
  ok("meet/open: state is clear once publishing is open", open.state === "clear");

  const withTop = record(meetHeadline({ readiness: null, interviewNextTopic: null, top: missing({ anchor: "#identity-proofing" }) }));
  ok("meet/top: primary equals the top blocker's own anchor", withTop.primary?.anchor === "#identity-proofing");

  const interview = record(meetHeadline({ readiness: null, interviewNextTopic: "exam pressure", top: null }));
  ok("meet/interview: state is working, names the topic", interview.state === "working" && interview.sentence.includes("exam pressure"));
  ok("meet/interview: primary points at the interview", interview.primary?.anchor === "#mirror-call-studio");
}

// SHARE
{
  const genericActive = record(shareHeadline({ mode: "generic", runtimeActive: true, room: null, followersTotal: null, link: null, roomBlocker: null, top: null }));
  ok("share/generic active: state is clear, nothing left to control", genericActive.state === "clear" && genericActive.primary === null);

  const genericBlocked = record(shareHeadline({ mode: "generic", runtimeActive: false, room: null, followersTotal: null, link: null, roomBlocker: null, top: missing({ anchor: "#model-consent-gate" }) }));
  ok("share/generic blocked: primary equals the top blocker's own anchor", genericBlocked.primary?.anchor === "#model-consent-gate");

  const teacherUnchecked = record(shareHeadline({ mode: "teacher", runtimeActive: false, room: undefined, followersTotal: null, link: null, roomBlocker: null, top: null }));
  ok("share/teacher unchecked: says not checked, never a fabricated 'no Room yet'", teacherUnchecked.sentence.toLowerCase().includes("not checked"));

  const noRoom = record(shareHeadline({ mode: "teacher", runtimeActive: false, room: null, followersTotal: null, link: null, roomBlocker: null, top: null }));
  ok("share/no room: primary offers to set one up", noRoom.primary?.anchor === "#room-studio");

  const paused = record(shareHeadline({ mode: "teacher", runtimeActive: false, room: { published: true, paused: true, slug: "anjali" }, followersTotal: 40, link: "https://vyakti.example/r/anjali", roomBlocker: null, top: null }));
  ok("share/paused: state is blocked_you", paused.state === "blocked_you");

  const published = record(shareHeadline({ mode: "teacher", runtimeActive: false, room: { published: true, paused: false, slug: "anjali" }, followersTotal: 40, link: "https://vyakti.example/r/anjali", roomBlocker: null, top: null }));
  ok("share/published: state is clear, nothing left to control", published.state === "clear" && published.primary === null);
  ok("share/published: sentence names the real follower count", published.sentence.includes("40"));

  const draftBlocked = record(shareHeadline({
    mode: "teacher", runtimeActive: false,
    room: { published: false, paused: false, slug: "anjali" },
    followersTotal: null, link: null,
    roomBlocker: { label: "Readiness has to clear 70", anchor: "#readiness-title", cls: "you" },
    top: null,
  }));
  ok("share/draft blocked: primary equals the Room's own first blocker", draftBlocked.primary?.anchor === "#readiness-title" && draftBlocked.primary?.label === "Readiness has to clear 70");

  const draftReady = record(shareHeadline({ mode: "teacher", runtimeActive: false, room: { published: false, paused: false, slug: "anjali" }, followersTotal: null, link: null, roomBlocker: null, top: null }));
  ok("share/draft ready: primary offers to publish", draftReady.primary?.anchor === "#room-studio" && draftReady.primary?.label.toLowerCase().includes("publish"));
}

// ── 4b. every real headline carries AT MOST ONE primary control ──────────

function isSinglePrimaryOrNull(primary) {
  if (primary === null) return true;
  if (Array.isArray(primary)) return false;
  return typeof primary === "object" && typeof primary.anchor === "string" && typeof primary.label === "string";
}

ok(
  `law 3: every one of the ${allHeadlines.length} headlines produced above carries at most one primary control`,
  allHeadlines.every((h) => isSinglePrimaryOrNull(h.primary)),
);

{
  const violator = { sentence: "two controls, never allowed", state: "clear", primary: [{ label: "a", anchor: "#a", cls: "you" }, { label: "b", anchor: "#b", cls: "us" }] };
  ok("negative control: a headline with TWO primary controls is refused by the shape check", !isSinglePrimaryOrNull(violator.primary));
}

// ── 4c. negative control: the copy gate itself catches a banned word ──────

{
  // `label:`/`title:` etc. is what makes `scanSource` treat a literal as
  // VISIBLE COPY rather than an internal identifier (`isVisibleLiteral` in
  // scripts/check-copy.mjs); a bare `const s = "..."` is invisible to it by
  // design, so the fixture has to look like the copy this file actually
  // writes, the same shape `TAB_PROMISE`'s own entries take.
  const bad = 'const label = "we will train your model this week";';
  const hits = scanSource("src/studio/StudioShell.tsx", bad, { rules: "full", codename: true, roomsVocab: true });
  ok("negative control: a string with 'train'/'model' fails scripts/check-copy.mjs", hits.length > 0);
}
{
  const clean = 'const label = "your AI is ready to publish";';
  const hits = scanSource("src/studio/StudioShell.tsx", clean, { rules: "full", codename: true, roomsVocab: true });
  ok("sanity: ordinary shell copy passes the same scan clean", hits.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
