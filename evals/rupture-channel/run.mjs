// WS-EMOTION (task #82) — "a rupture that survives a channel change".
//
// THE DEFECT CLASS THIS SUITE EXISTS FOR, in the owner's framing: she is hurt
// in chat and sunny on the phone. `docs/research/AFFECT-CONTINUITY.md` §0 move
// 2 names the cause exactly — "a rupture that exists in chat does not exist on
// the phone" — and calls it "a call site, not a feature". That is precisely
// why it needs a suite: a call site that forgets to hand something in produces
// NO artefact. An absent block and a block that was never wired look identical
// in the prompt, in the logs, and in the telemetry. The only way to know a
// lane still carries her is to compile every lane and diff the bytes.
//
// So the properties here are cross-LANE, not per-function. `evals/rupture-
// lapse.mjs` already proves `ruptureStance` itself is correct (record survives,
// stance lapses, a fresh rupture re-opens); nothing below re-tests that. This
// asks the next question: does the SAME state reach chat, the cascade call,
// the realtime call and the native watch compile as the same bytes, and does
// it stop reaching them in the same breath when it lapses.
//
// Offline, fixture-based, deterministic, $0 — no network, no database, no
// model call, no clock beyond an explicit `now`. Bundled fresh from the real
// source on every run for `gates-that-live-nowhere`'s reason.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "rupture-channel-"));
const BUNDLE = join(tmp, "rupture-channel.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const {
  compile,
  initialRelState,
  ruptureStance,
  innerContext,
  GAP_ENTRY_MS,
  RUPTURE_STANCE_LAPSE_DAYS,
  RUPTURE_STANCE_LAPSE_WARM_EPISODES,
} = await import(BUNDLE);

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    console.log(`  ok  ${name}`);
    return;
  }
  fail++;
  console.log(`FAIL  ${name}${extra ? " — " + extra : ""}`);
};
const note = (s) => console.log(`  ..  ${s}`);

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 22, 9, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

// ─────────────────────────────────────────────────────────────────────────
// The fixture: one dyad, one open rupture, everything else quiet so the T2
// block is the only thing that can move between lanes.
// ─────────────────────────────────────────────────────────────────────────
const PERSON = "wsemotion-fixture-person";
const RUPTURED = {
  ...initialRelState(PERSON),
  honorific: "tum",
  trust: 0.42,
  rupture_open: true,
  repair_state: "open",
  cs_ratio: 0.55,
  cs_on_stress: "retreat_l2",
  pacing_gap_s: 90,
};

const relBundle = (over = {}) => ({
  relState: RUPTURED,
  lastHonorificMoveAt: iso(NOW - 21 * DAY),
  patterns: [],
  rituals: [],
  homeRegion: null,
  currency: [],
  weEpisodes: [],
  phrases: [],
  phraseLedger: [],
  ...over,
});

const USER = { name: "Aarav", vibe: ["someone to talk to"], facts: {} };
const baseInput = (over) => ({
  user: USER,
  messageCount: 42,
  medium: "text",
  mode: "chat",
  voiceEngine: "gemini",
  isDirective: false,
  watching: false,
  innerThread: "",
  innerWants: "",
  memories: "",
  herLife: "",
  cultureNoteText: "",
  latestUserText: "",
  gapSinceLastMs: 60_000,
  nowMs: NOW,
  ...over,
});

// The four real assemblies, transcribed from their actual call sites so a
// lane cannot pass here and differ in production:
//   chat        — brain.ts think(mode:"chat")
//   cascade     — brain.ts think(mode:"call"), the fallback voice lane
//   live        — useCallEngine.ts tryStartLive(), frozen at connect
//   watch       — useCallEngine.ts startWatchMode(), the native share compile
// `watch` sets innerThread:"" at its call site on purpose (innerContext
// returns "" for surface "watch"); that is about her INTERIOR, not about the
// relationship record, so T2 must be there all the same.
const LANES = {
  chat: (b) => baseInput({ relBundle: b }),
  cascade: (b) => baseInput({ medium: "voice", mode: "call", relBundle: b }),
  live: (b) => baseInput({ medium: "voice", mode: "call", voiceEngine: "live", relBundle: b }),
  watch: (b) =>
    baseInput({ medium: "voice", mode: "call", voiceEngine: "live", innerThread: "", relBundle: b }),
};

const T2_RE = /RELATIONSHIP STATE \(context only, never raise unprompted\):\n(?:- [^\n]*\n?)+/;
const t2Of = (compiled) => (compiled.tail.match(T2_RE) || [""])[0].trimEnd();
const t2OnEveryLane = (b) =>
  Object.fromEntries(Object.entries(LANES).map(([k, f]) => [k, t2Of(compile(f(b)))]));

const allEqual = (obj) => {
  const vs = Object.values(obj);
  return vs.every((v) => v === vs[0]);
};
const disagreeing = (obj) => {
  const vs = Object.entries(obj);
  const [, first] = vs[0];
  return vs.filter(([, v]) => v !== first).map(([k]) => k).join(",") || "none";
};

// ─────────────────────────────────────────────────────────────────────────
// 1. THE SAME STATE IS THE SAME BYTES ON EVERY LANE
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── 1. one rupture, four assemblies, one set of bytes ──");
{
  // freshly opened: the stance is unambiguously "open" on any reading
  const fresh = relBundle({ lastRuptureMoveAt: iso(NOW - 2 * DAY), warmEpisodesSinceRupture: 1 });
  const blocks = t2OnEveryLane(fresh);
  ok("every lane rendered a T2 block at all", Object.values(blocks).every((b) => b.length > 0),
    JSON.stringify(Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, v.length]))));
  ok("chat and the two call lanes are byte-identical", allEqual(blocks), `differ: ${disagreeing(blocks)}`);
  ok("the block actually carries the rupture", blocks.chat.includes("repair: open (open)"), blocks.chat);
  // sections.T2 is what the budget gate and the manifest read; if the bytes
  // agree but the accounting does not, a future drop-order change can silently
  // starve one lane.
  const sizes = Object.fromEntries(
    Object.entries(LANES).map(([k, f]) => [k, compile(f(fresh)).sections.T2]),
  );
  ok("sections.T2 agrees across lanes too", allEqual(sizes), JSON.stringify(sizes));
  ok("sections.T2 is non-zero", Object.values(sizes).every((n) => n > 0));
}

// ─────────────────────────────────────────────────────────────────────────
// 2. WHEN IT LAPSES, IT LAPSES EVERYWHERE AT ONCE
// ─────────────────────────────────────────────────────────────────────────
// The record/stance split (`decisions.md#stance-lapses-record-stays`) is only
// worth anything if BOTH halves cross the channel boundary together. A lane
// that kept rendering "(open)" after the stance settled would be a person who
// is over the fight in chat and still mid-fight on the phone — the same defect
// as the original one, wearing the fix as a costume.
console.log("\n── 2. the lapse is a property of the state, not of the lane ──");
{
  const byTime = relBundle({
    lastRuptureMoveAt: iso(NOW - (RUPTURE_STANCE_LAPSE_DAYS + 3) * DAY),
    warmEpisodesSinceRupture: 0,
  });
  const byWarmth = relBundle({
    lastRuptureMoveAt: iso(NOW - 2 * DAY),
    warmEpisodesSinceRupture: RUPTURE_STANCE_LAPSE_WARM_EPISODES,
  });
  for (const [label, b] of [["time", byTime], ["warm episodes", byWarmth]]) {
    const blocks = t2OnEveryLane(b);
    ok(`lapse by ${label}: identical on every lane`, allEqual(blocks), `differ: ${disagreeing(blocks)}`);
    ok(
      `lapse by ${label}: no lane still says the fight is open`,
      Object.values(blocks).every((t) => !t.includes("repair: open (open)")),
    );
    ok(
      `lapse by ${label}: every lane says it settled instead`,
      Object.values(blocks).every((t) => t.includes("not currently held")),
      blocks.live,
    );
  }
  // THE RECORD IS UNTOUCHED. compile() may not mutate the state it renders —
  // if it did, the lapse would stop being derived and start being a write, and
  // the permanent half of `stance-lapses-record-stays` would quietly rot.
  const before = JSON.stringify(byTime.relState);
  Object.values(LANES).forEach((f) => compile(f(byTime)));
  ok("compiling on four lanes leaves rupture_open true and the row unmoved",
    JSON.stringify(byTime.relState) === before && byTime.relState.rupture_open === true);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. THE NEGATIVE CONTROL
// ─────────────────────────────────────────────────────────────────────────
// Sections 1 and 2 both assert "identical", and "identical" is trivially true
// of two empty strings. This is the assertion that makes them mean something.
console.log("\n── 3. open and settled are genuinely different bytes ──");
{
  const open = t2Of(compile(LANES.live(relBundle({ lastRuptureMoveAt: iso(NOW - 2 * DAY), warmEpisodesSinceRupture: 0 }))));
  const settled = t2Of(compile(LANES.live(relBundle({ lastRuptureMoveAt: iso(NOW - 40 * DAY), warmEpisodesSinceRupture: 0 }))));
  ok("an open stance and a settled stance do not render the same", open !== settled);
  ok("both are non-empty (so the difference is content, not absence)", open.length > 0 && settled.length > 0);
  ok("ruptureStance itself agrees with what was rendered",
    ruptureStance({ ruptureOpen: true, repairState: "open", lastMoveAt: iso(NOW - 2 * DAY), warmEpisodesSince: 0 }, new Date(NOW)) === "open" &&
    ruptureStance({ ruptureOpen: true, repairState: "open", lastMoveAt: iso(NOW - 40 * DAY), warmEpisodesSince: 0 }, new Date(NOW)) === "settled");
}

// ─────────────────────────────────────────────────────────────────────────
// 4. BYTE-IDENTITY FOR STATE THAT PREDATES THE SPLIT
// ─────────────────────────────────────────────────────────────────────────
// Every caller and fixture written before `lastRuptureMoveAt`/
// `warmEpisodesSinceRupture` existed must be unaffected, on every lane. This
// is the same law the 83 compiler fixtures are under, restated for the two
// optional fields the split added.
console.log("\n── 4. a bundle that predates the split renders as it always did ──");
{
  const legacy = relBundle(); // neither new field set
  const explicitNull = relBundle({ lastRuptureMoveAt: null, warmEpisodesSinceRupture: 0 });
  for (const [lane, f] of Object.entries(LANES)) {
    ok(`${lane}: absent fields === explicit nulls, whole prompt`,
      compile(f(legacy)).system === compile(f(explicitNull)).system);
  }
  ok("and an un-timestamped open rupture still reads as open, never as a guessed lapse",
    t2Of(compile(LANES.chat(legacy))).includes("repair: open (open)"));
}

// ─────────────────────────────────────────────────────────────────────────
// 5. G2 ACROSS CHANNELS — the defect this wave actually fixed
// ─────────────────────────────────────────────────────────────────────────
// `inner.ts` G2: she never initiates carrying a feeling. The chat lane has
// always suppressed the carried thread on a message she sent first. The CALL
// lane had no such notion: `useCallEngine.ts` reasoned "a pickup is THEM
// calling HER" and left `sheInitiated` unset — true of a pickup, false of the
// CALLBACK she places herself after a drop, which is the one call she starts.
// The self layer in the very same compile() call already knew (`sheCalled &&
// b ? {...b, sheInitiated: true}`), so the two notions of "she started this"
// had already drifted apart inside one function.
console.log("\n── 5. G2 holds on a call she placed, not just on a chat she opened ──");
{
  const thread = { text: "still off about that thing at work", at: NOW - 3 * 3_600_000, w: 0.7, sign: -1, told: false };
  const inner = { thread, wants: [], owed: [], lastAppraisedAt: 0, at: NOW };
  const opts = { now: NOW, lastMsgAt: NOW - (GAP_ENTRY_MS + 60_000), userText: "chai peene chalein" };

  const theyCalled = innerContext(inner, { ...opts, surface: "pickup" });
  const sheCalled = innerContext(inner, { ...opts, surface: "pickup", sheInitiated: true });
  const theyTyped = innerContext(inner, { ...opts, surface: "chat" });
  const sheOpened = innerContext(inner, { ...opts, surface: "chat", sheInitiated: true });

  ok("they call her after a gap: she walks in carrying it", theyCalled.thread.includes("WHERE YOUR HEAD IS"));
  ok("SHE calls them back: nothing interior rides out", sheCalled.thread === "");
  ok("the chat lane behaves the same way, both directions",
    theyTyped.thread.includes("WHERE YOUR HEAD IS") && sheOpened.thread === "");
  ok("the two lanes agree byte-for-byte on the suppressed case", sheCalled.thread === sheOpened.thread);
  // G7: an opinion volunteered on a line she opened is the same failure in a
  // different slot, and it must be suppressed by the SAME flag.
  ok("her taste is suppressed on a call she placed too",
    !sheCalled.wants.includes("A VIEW OF YOURS") && theyCalled.wants.includes("A VIEW OF YOURS"));
  // The default must not change for any existing caller.
  ok("omitting sheInitiated is byte-identical to passing false",
    innerContext(inner, { ...opts, surface: "pickup" }).thread ===
      innerContext(inner, { ...opts, surface: "pickup", sheInitiated: false }).thread);
}

// ─────────────────────────────────────────────────────────────────────────
// 6. THE CALL SITES, IN SOURCE
// ─────────────────────────────────────────────────────────────────────────
// Sections 1–5 prove the compiler and inner.ts behave. They cannot prove the
// lane HANDS THE STATE IN — that is the actual historical failure mode here
// (`selfbundle-never-set`: reader wired, writer forgotten; and this arc's own
// "a rupture that exists in chat does not exist on the phone"). So the wiring
// is asserted against the real file, the way evals/chattail/run.mjs asserts
// its own.
console.log("\n── 6. every call-lane assembly still hands the bundle in ──");
{
  const src = readFileSync(join(ROOT, "src/components/useCallEngine.ts"), "utf8");
  const handIns = (src.match(/relBundle: relBundleRef\.current/g) || []).length;
  ok("all three call-lane assemblies read the ring-fetched bundle (cascade keys, live compile, native watch compile)",
    handIns === 3, `found ${handIns}`);
  const pickup = src.match(/innerContext\(stateRef\.current\.inner,\s*\{[\s\S]*?surface:\s*"pickup"[\s\S]*?\}\)/);
  ok("the realtime pickup still calls innerContext", Boolean(pickup));
  ok("...and still tells it who placed the call (G2)",
    Boolean(pickup) && /sheInitiated:\s*sheCalled/.test(pickup[0]),
    "the pickup compile must thread `sheCalled`, never re-derive or omit it");
  ok("the self bundle reads the SAME fact, never a second one",
    /sheCalled && b \? \{ \.\.\.b, sheInitiated: true \}/.test(src));
}

// ─────────────────────────────────────────────────────────────────────────
// 7. G4, NEGATIVELY — none of this may reach a surface
// ─────────────────────────────────────────────────────────────────────────
// AFFECT-CONTINUITY §1.3: "No rupture, repair state, or affective stance may
// reach any UI, including the closeness card." Written down because the card
// already renders honorific and trust, so someone will reasonably infer that
// it may render repair. A permanent visual guilt object is exactly G4's "a
// status the user feels responsible for checking".
console.log("\n── 7. nothing from this feature reaches a surface ──");
{
  const dir = join(ROOT, "src/components");
  const files = readdirSync(dir).filter((f) => /\.(tsx|ts)$/.test(f) && f !== "useCallEngine.ts");
  const offenders = files.filter((f) =>
    /rupture|repair_state|repairState|ruptureStance/.test(readFileSync(join(dir, f), "utf8")),
  );
  ok("no component reads rupture / repair / stance", offenders.length === 0, offenders.join(","));
  note(`${files.length} component files scanned (useCallEngine.ts is the call ASSEMBLY, not a surface)`);
}

// ─────────────────────────────────────────────────────────────────────────
// 8. WHAT COUNTS AS A WARM EPISODE
// ─────────────────────────────────────────────────────────────────────────
// The lapse has two conditions and one of them is a COUNT, which means the
// count's population is load-bearing: every row wrongly included lapses her
// stance earlier than the design says. api/consolidate.js's warm-episode query
// derives from the same table as every other episode query in that file and
// must therefore carry the same three predicates — finalized, dyadic, current.
console.log("\n── 8. the warm-episode count is scoped like every other episode query ──");
{
  const src = readFileSync(join(ROOT, "api/consolidate.js"), "utf8");
  const fn = src.match(/async function ruptureStanceLapsedFor[\s\S]*?\n}\n/);
  ok("ruptureStanceLapsedFor still exists", Boolean(fn));
  const warm = fn && fn[0].match(/select count\(\*\)::int as c from vy_episode[\s\S]*?\`/);
  ok("its warm-episode count is a vy_episode count", Boolean(warm));
  for (const pred of ["e.provisional = false", "e.group_id is null", "e.superseded_by is null"]) {
    ok(`warm count excludes rows failing \`${pred}\``, Boolean(warm) && warm[0].includes(pred));
  }
  ok("and it is still bounded to before the batch's own fresh episode",
    Boolean(warm) && warm[0].includes("e.started_at < $3::timestamptz"));
  // Cross-file, reported rather than asserted: the READ path
  // (api/memory.js fetchRelBundle) computes the same number for the prompt and
  // is owned by another workstream this wave. Its query carries none of the
  // three predicates, so the writer and the reader can disagree about whether
  // the same rupture has lapsed. Filed in the WS-EMOTION report; NOT asserted
  // here, because a suite that fails on another workstream's file is a suite
  // people learn to ignore.
  const mem = readFileSync(join(ROOT, "api/memory.js"), "utf8");
  const memWarm = mem.match(/warmEpisodesSinceRupture[\s\S]{0,600}?count\(\*\)::int as c from vy_episode[\s\S]*?\`/);
  const memScoped = Boolean(memWarm) && /provisional = false/.test(memWarm[0]);
  note(
    memScoped
      ? "api/memory.js's warm count is scoped too — the reader and the writer agree"
      : "OPEN: api/memory.js's warm count is UNSCOPED (no provisional/group/superseded filter) — reader and writer can disagree on the same lapse. Owner: WS-MEMORY.",
  );
}

console.log(
  `\n${fail === 0 ? "PASS" : "FAIL"} — rupture-channel: ${fail} failing assertion${fail === 1 ? "" : "s"}`,
);
process.exit(fail ? 1 : 0);
