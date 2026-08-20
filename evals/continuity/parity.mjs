// WS-CONTINUITY — G-C1 (call parity), G-C5 (chat byte-identity) and the
// NEGATIVE CONTROL, offline and DB-free.
//
//   node evals/continuity/parity.mjs
//
// The claim under test is the one sentence SPEC-CONTINUITY §3 makes: "every
// relational and self slot that renders in chat renders on a call for the same
// person and turn". So the two compiles below differ in exactly two fields —
// medium and mode — and in nothing else. Anything that differs in the output
// is therefore a property of the LANE, which is the only thing this gate is
// allowed to be about.
//
// The negative control is not decoration. A parity gate that cannot fail is a
// green light with no wiring behind it, and this repo has shipped one of those
// before (`meera_tel_session`). §4 below re-runs the identical assertion
// against a call compile with the bundle removed — i.e. the exact state this
// workstream found production in — and REQUIRES it to fail. A suite where §4
// passes silently is a broken suite, not a passing build.
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseInput, REL_BUNDLE, MS_DAY } from "./_fixtures.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "wscont-"));
const BUNDLE = join(tmp, "continuity.bundle.mjs");
execSync(
  `npx esbuild ${join(ROOT, "evals/continuity/_entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const { compile, TAIL_ORDER } = await import(BUNDLE);

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? `  ${detail}` : ""}`);
  return cond;
};

// Slots the chat lane legitimately has and a call legitimately does not — the
// two are named here rather than discovered, so a slot going missing by
// accident can never be mistaken for one of these.
//   culture  cultureNoteText is `mode === "chat"` inside compile() by design.
//   T10      folds SEARCH_DECISION (chat-only: she cannot browse aloud) and
//            FORGET_DECISION (BOTH lanes). It is therefore expected to differ
//            in SIZE across lanes and is checked for PRESENCE only.
const CHAT_ONLY = new Set(["culture"]);
const SIZE_EXEMPT = new Set(["T10"]);

// ── T-H1: the self bundle, for the T11/T12/T13 assertions in §2 ───────────
//
// It lives here rather than in _fixtures.mjs because that file is shared and
// T-H1 owns only these assertions. Rows are the REAL shapes (texture.ts's
// TextureRow, selfarc.ts's SelfArcRow, life.ts's UntoldRow), for the reason
// _fixtures.mjs states about the relational ones: a parity gate built on
// made-up shapes passes while the render functions filter every row out.
//
// Each row is chosen to CLEAR its renderer's own gate, so a dark slot below
// means the wiring is dark and never that the fixture was thin:
//   texture  n_turns 210, well over TEXTURE_N_TURNS_FLOOR (40)
//   arc      dim "patience", which SELF_ARC_MOMENTS maps to moment "stress" —
//            the shape `turn.latestUserText` below actually produces (measured
//            through momentGate, not assumed). 3 citations / 190d clears the
//            >=3 / >=42 CHECKs the row would carry in the database.
//   untold   one approved beat, under MAX_UNTOLD_BEATS and MAX_BEAT_CHARS.
// `sheInitiated` is absent, i.e. false: neither lane's turn here is one she
// started, so T13's G2 gate is open.
const SELF_BUNDLE = {
  texture: {
    agent_id: "a0000000-0000-4000-8000-000000000001",
    person_id: "wscont-test-fixture-person",
    teasing: 0.18,
    humour: 0.22,
    media_rate: 0.31,
    words_median: 9,
    emoji_rate: 0.4,
    profanity: 0.03,
    nickname: "bandar",
    avoid: [],
    avoid_cites: [],
    n_turns: 210,
  },
  arc: [
    {
      id: 1,
      agent_id: "a0000000-0000-4000-8000-000000000001",
      dim: "patience",
      note: "waits out a long pause",
      from_note: "rushes the ending",
      citations: [1, 2, 3],
      span_days: 190,
      superseded_by: null,
      created_at: new Date(Date.now() - 3 * MS_DAY).toISOString(),
    },
  ],
  untold: [
    {
      id: 1,
      at: new Date(Date.now() - 5 * MS_DAY).toISOString(),
      beat: "client moved the launch to next friday",
      kind: "work",
      arc_key: "",
      media: [],
    },
  ],
};

// The person and the turn are identical. Only the transport differs.
const turn = {
  latestUserText: "yaar aaj bahut thak gayi thi office me",
  gapSinceLastMs: 30 * 60_000,
  innerThread: "\n\nWHERE YOUR HEAD IS COMING INTO THIS: some carried line.",
  innerWants: "\n\nWHAT YOU ARE IN THE MIDDLE OF: some want.",
};
const chat = compile(baseInput({ ...turn, selfBundle: SELF_BUNDLE, medium: "text", mode: "chat", voiceEngine: "gemini" }));
// The call lane exactly as useCallEngine.ts now compiles it.
const call = compile(baseInput({ ...turn, selfBundle: SELF_BUNDLE, medium: "voice", mode: "call", voiceEngine: "live" }));

console.log("\n§1 — G-C1 call parity (every slot that renders in chat renders on a call)");
const missing = [];
for (const id of TAIL_ORDER) {
  const c = chat.sections[id] ?? 0;
  const v = call.sections[id] ?? 0;
  if (c > 0 && v === 0 && !CHAT_ONLY.has(id)) missing.push(`${id} (chat ${c}b, call 0b)`);
}
ok("no slot renders in chat and nothing on a call", missing.length === 0, missing.join(", "));

const sizeDiffs = [];
for (const id of TAIL_ORDER) {
  if (CHAT_ONLY.has(id) || SIZE_EXEMPT.has(id)) continue;
  const c = chat.sections[id] ?? 0;
  const v = call.sections[id] ?? 0;
  if (c !== v) sizeDiffs.push(`${id} chat=${c}b call=${v}b`);
}
// Slot CONTENT must not depend on the transport at all: §2's first invariant
// ("state is channel-blind — only rendering differs; `medium: voice` shortens
// her, it does not make her forget"). A byte difference in a relational slot
// means some state was read differently on one lane, which is the failure.
ok("relational/self slot bytes are identical across lanes", sizeDiffs.length === 0, sizeDiffs.join(", "));

const rendered = TAIL_ORDER.filter((id) => (call.sections[id] ?? 0) > 0);
console.log(`      call renders: ${rendered.join(", ")}`);
console.log(`      call tail ${call.tail.length}b vs chat tail ${chat.tail.length}b`);

console.log("\n§2 — the seven slots SPEC-CONTINUITY §0 names, on a call");
for (const id of ["T2", "T3", "T4", "T6"]) {
  ok(`${id} renders on a call`, (call.sections[id] ?? 0) > 0, `${call.sections[id] ?? 0}b`);
}
// ── T-H1 (`selfbundle-never-set`): these three assertions were pinned the
// other way up. They asserted T11/T12/T13 were DARK on both lanes, and that
// was the honest reading of the tree at the time: the slots were gated behind
// `input.selfBundle` and NOTHING in the repo ever set it, so the spec's table
// claiming chat ✅ was wrong and the gate recorded the truth instead.
//
// They are FLIPPED rather than deleted, because the pinned negative is what
// makes the positive mean something: the same three ids, the same two lanes,
// the same measurement — only the expected answer moved, and the diff between
// the two versions of this file is the whole story of the fix.
//
// What this assertion is and is NOT. It proves that a bundle handed to
// compile() reaches the tail on both lanes. It CANNOT prove anything about
// where a bundle comes from — that is exactly the gap `selfbundle-never-set`
// fell through, since a render function existing is not a slot being wired.
// The producer half is gated by evals/self/wiring.mjs, which drives the real
// op:"recall" against real rows in the real database and asserts these same
// three headers appear in a REAL PROMPT. Neither gate is sufficient alone and
// this comment is here so nobody deletes one thinking the other covers it.
for (const id of ["T11", "T12", "T13"]) {
  ok(
    `${id} renders on BOTH lanes when a self bundle exists`,
    (chat.sections[id] ?? 0) > 0 && (call.sections[id] ?? 0) > 0,
    `chat ${chat.sections[id] ?? 0}b, call ${call.sections[id] ?? 0}b`,
  );
}
// The headers themselves, not just a byte count: a non-zero section delta says
// SOMETHING was appended at that tracking point, and the thing this ticket
// exists to assert is that the block's own bytes are what landed.
const SELF_HEADERS = [
  ["T11", "HOW YOU TWO TALK"],
  ["T12", "SELF, OVER TIME"],
  ["T13", "YOUR LIFE — WHAT THEY HAVE NOT HEARD"],
];
for (const [id, header] of SELF_HEADERS) {
  ok(
    `${id}'s header is in the compiled tail on both lanes`,
    chat.tail.includes(header) && call.tail.includes(header),
    `"${header}"`,
  );
}
// NEGATIVE CONTROL for the flip, in the same section as the flip so it cannot
// be read without it: the state this ticket found production in — a compile
// with no self bundle at all — must be CAUGHT by the assertions above. If
// this reports "NOTHING", the three assertions above are green against a
// compiler that would render them dark, which is the failure mode
// `selfbundle-never-set` is about.
const noSelf = compile(baseInput({ ...turn, selfBundle: null, medium: "voice", mode: "call", voiceEngine: "live" }));
const darkWithoutBundle = ["T11", "T12", "T13"].filter((id) => (noSelf.sections[id] ?? 0) === 0);
ok(
  "a compile with no self bundle leaves all three DARK — the pre-T-H1 state, caught",
  darkWithoutBundle.length === 3,
  `dark: ${darkWithoutBundle.join(", ") || "NOTHING — the gate is blind"}`,
);
// and the mirror, the one `relstate-zero-rows` teaches: a bundle OBJECT that
// carries no rows must not be mistaken for a wired slot. An empty bundle is
// what every real person has today, because the derivers have not run for
// them — so this is the state the gate is most likely to meet in the wild.
const emptySelf = compile(
  baseInput({
    ...turn,
    selfBundle: { texture: null, arc: [], untold: [] },
    medium: "voice",
    mode: "call",
    voiceEngine: "live",
  }),
);
ok(
  "an EMPTY self bundle renders nothing (rows, not the bundle object, are what light a slot)",
  (emptySelf.sections.T11 ?? 0) === 0 &&
    (emptySelf.sections.T12 ?? 0) === 0 &&
    (emptySelf.sections.T13 ?? 0) === 0,
);
// and the floor, which is the one guard most likely to be softened later: a
// texture row UNDER TEXTURE_N_TURNS_FLOOR is a personality assigned at random
// from a handful of turns, and it must stay dark even though the bundle,
// the wiring and the row all exist.
const thinSelf = compile(
  baseInput({
    ...turn,
    selfBundle: { ...SELF_BUNDLE, texture: { ...SELF_BUNDLE.texture, n_turns: 39 } },
    medium: "voice",
    mode: "call",
    voiceEngine: "live",
  }),
);
ok("T11 stays dark one turn under the n_turns floor, wired or not", (thinSelf.sections.T11 ?? 0) === 0);

console.log("\n§3 — the medium is honoured (voice register, not a longer prompt lane)");
ok("call core carries the live speech style", call.core.includes("YOUR VOICE IS THE DELIVERY"));
ok("chat core carries no speech style at all", !chat.core.includes("YOUR VOICE IS THE DELIVERY"));
ok("call core is the VOICE medium", call.core.includes("THIS IS A LIVE PHONE CALL"));
// FORGET_DECISION is "both lanes" per compile()'s own comment, and the old
// hand-assembled live prompt did not have it. This is the regression that
// proves the drift was real rather than theoretical.
ok("FORGET_DECISION reaches the call lane", (call.sections.T10 ?? 0) > 0);
ok("SEARCH_DECISION does NOT reach the call lane", (call.sections.T10 ?? 0) < (chat.sections.T10 ?? 0));

console.log("\n§4 — NEGATIVE CONTROL (this assertion must FAIL for the gate to mean anything)");
// Production before this change: mode "call" hard-nulled the bundle.
// T-H1: the self bundle is held CONSTANT here so this control isolates the
// thing it is named after. Without it the control also drops T11/T12/T13 —
// true, but for the other reason — and the printed "caught:" line would read
// as if relBundle drove the self slots. It does not: T11 and T13 are gated on
// selfBundle alone. T12 is the one real coupling and it is caught below
// exactly because it is real (compile() computes its moment gate only when
// relBundle is present, so an absent relBundle gives renderSelfArc an empty
// moment). That is a compiler property, filed as a finding, not fixed here.
const callBefore = compile(baseInput({ ...turn, selfBundle: SELF_BUNDLE, medium: "voice", mode: "call", voiceEngine: "live", relBundle: null }));
const wouldMiss = TAIL_ORDER.filter(
  (id) => (chat.sections[id] ?? 0) > 0 && (callBefore.sections[id] ?? 0) === 0 && !CHAT_ONLY.has(id),
);
ok(
  "a call compiled with no relBundle is CAUGHT by §1's assertion",
  wouldMiss.length > 0,
  `caught: ${wouldMiss.join(", ") || "NOTHING — the gate is blind"}`,
);
// and the mirror: a bundle that renders nothing must not be mistaken for parity
const emptyish = compile(
  baseInput({ ...turn, medium: "voice", mode: "call", voiceEngine: "live", relBundle: { ...REL_BUNDLE, patterns: [], weEpisodes: [], phrases: [] } }),
);
ok(
  "an emptied bundle is caught too (rows, not just the bundle object, are checked)",
  (emptyish.sections.T4 ?? 0) === 0 && (emptyish.sections.T6 ?? 0) === 0,
);

console.log("\n§5 — the REALTIME lane's structural limit, measured rather than glossed");
// The two call lanes are not equally reachable by a turn-gated slot, and the
// difference is a property of the transport, not a bug to fix here:
//
//   cascade — compiles per spoken turn, so it sees the real turn and T4's
//             moment gate and T6's pull label are both accurate. §1-§3 above
//             are that lane.
//   live    — compiles ONCE at connect, which is correct and load-bearing (a
//             mid-call prompt change is a different person mid-sentence). At
//             connect there is no user turn, so a slot gated ON the turn
//             cannot be turn-accurate. T6 handles this correctly: it renders
//             under its STANDING BACKGROUND heading, which is exactly the
//             0-unprompted-raises behaviour. T4 renders NOTHING, because
//             renderDyadicActive selects by moment shape and there is no
//             moment.
//
// T4 going dark on the realtime lane is the honest outcome — the alternative
// is guessing a moment from the last thing they typed before dialling, which
// is the pull-only law inverted — but it is a real remaining gap and it is
// recorded here so nobody rediscovers it as a surprise.
const pickup = compile(baseInput({ ...turn, medium: "voice", mode: "call", voiceEngine: "live", latestUserText: "", innerThread: "", innerWants: "" }));
ok("live pickup renders T2 (state, not turn-gated)", (pickup.sections.T2 ?? 0) > 0, `${pickup.sections.T2 ?? 0}b`);
ok("live pickup renders T3 (rituals/currency, not turn-gated)", (pickup.sections.T3 ?? 0) > 0, `${pickup.sections.T3 ?? 0}b`);
ok("live pickup renders T6 as STANDING BACKGROUND", (pickup.sections.T6 ?? 0) > 0 && pickup.tail.includes("STANDING BACKGROUND"));
ok("live pickup never renders T6 as ACTIVE (no turn to have referenced it)", !pickup.tail.includes("SHARED HISTORY — ACTIVE"));
ok("T4 is dark at a live pickup — KNOWN, by construction, not a regression", (pickup.sections.T4 ?? 0) === 0);

// T-H1: the same measurement for the three self slots, because they divide
// along the SAME line and the division should be recorded once rather than
// rediscovered per slot. T11 is state (how the two of them talk) and T13 is
// her calendar; neither is turn-shaped, so both reach a pickup. T12 is
// moment-gated exactly as T4 is, so it goes dark at a pickup for the identical
// reason — no turn, no moment — and guessing a moment from the last thing they
// typed before dialling is the pull-only law inverted.
const pickupSelf = compile(
  baseInput({
    ...turn,
    selfBundle: SELF_BUNDLE,
    medium: "voice",
    mode: "call",
    voiceEngine: "live",
    latestUserText: "",
    innerThread: "",
    innerWants: "",
  }),
);
ok("live pickup renders T11 (rapport state, not turn-gated)", (pickupSelf.sections.T11 ?? 0) > 0, `${pickupSelf.sections.T11 ?? 0}b`);
ok("live pickup renders T13 (her calendar, not turn-gated)", (pickupSelf.sections.T13 ?? 0) > 0, `${pickupSelf.sections.T13 ?? 0}b`);
ok("T12 is dark at a live pickup — same construction as T4, not a regression", (pickupSelf.sections.T12 ?? 0) === 0);

console.log("\n§6 — G-C5 chat byte-identity (the chat lane must not move)");
// Delegated to the frozen-oracle harness rather than re-implemented: that is
// the 83-fixture proof, run against this tree.
try {
  const out = execSync("node src/engine/__fixtures__/byte-identity.mjs", { cwd: ROOT }).toString().trim();
  const m = /(\d+)\/(\d+) fixtures pass/.exec(out);
  ok("83/83 byte-identity fixtures pass", Boolean(m) && m[1] === m[2] && Number(m[1]) >= 83, m ? `${m[1]}/${m[2]}` : out);
} catch (e) {
  ok("83/83 byte-identity fixtures pass", false, String(e.stdout || e.message).slice(-400));
}

console.log(failed ? `\nFAILED — ${failed} assertion(s)` : "\nPASS — parity, medium, negative control, byte-identity");
process.exit(failed ? 1 : 0);
