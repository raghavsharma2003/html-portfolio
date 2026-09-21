// The burst wiring, checked STRUCTURALLY against the real source files.
//
// Everything in evals/burst.mjs is about the policy, which is pure and easy to
// test. This file is about the two things that cannot be tested that way and
// have each already cost this product a conversation:
//
//   1. A POLICY THE SURFACE REIMPLEMENTS. `surface-bypasses-parse` is what
//      happens when a surface owns a decision the engine should have made: it
//      drifts, and it drifts silently. burst.ts says in its own header that
//      only the TIMER belongs to the surface. So the surface is checked for
//      having a timer and nothing else.
//
//   2. A FLAG NOBODY LOWERS. `busy-held-across-recursion` (rejected.md) was
//      one missing release on one of three recursive paths, and it did not
//      cost one reply — it killed the conversation until reload, from a burst,
//      on the path written to serve bursts. Review missed it because "a
//      missing release is invisible in a diff that contains no releases".
//      A diff cannot show an absence; a rule can. So the rule is: `replyPass`
//      never releases anything, and `replyCycle` releases in a `finally`.
//      A fourth branch added to the pass tomorrow cannot reintroduce the bug,
//      and if someone moves a release back into the pass, this goes red.
//
// Source text, deliberately: these are claims about the shape of the code, and
// bundling it would erase exactly the shape being claimed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (path) => readFileSync(join(ROOT, path), "utf8").replaceAll("\r\n", "\n");
const chat = src("src/components/Chat.tsx");
const brain = src("src/engine/brain.ts");
const burst = src("src/engine/burst.ts");
const greeting = src("src/engine/greeting.ts");

let fail = 0;
let n = 0;
const ok = (name, cond, extra = "") => {
  n++;
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};

/**
 * The body of a `function name(` declared at component scope.
 *
 * Ends at the first closing brace in column 2, which is what a component-scope
 * function's closer is in this file. Brace matching from the first `{` is what
 * a reader would reach for and it is wrong here: TypeScript return-type
 * annotations are brace-shaped (`): { fire: boolean } | null {`), so it walks
 * the type literal and reports an empty body.
 */
function bodyOf(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return "";
  const end = src.indexOf("\n  }\n", i);
  return end < 0 ? "" : src.slice(i, end + 4);
}

// ── 1. the policy lives in the engine ──────────────────────────────────────
ok("the surface asks burst.ts for the decision", chat.includes("burstDecide("));
ok(
  "the surface does not reimplement the wait",
  !chat.includes("burstWaitMs("),
  "burstWaitMs belongs to burst.ts; the surface calls burstDecide",
);
for (const k of [
  "COMPOSE_ACTIVE_MS",
  "COMPOSE_ABANDON_MS",
  "BURST_INTERJECT_MS",
  "CONTINUATION_WEAK_MS",
  // WS-BREATH's four. The focus/keyboard hold is the newest place a surface
  // could grow half a policy, so it is the first place to look for one.
  "BURST_GRACE_FLOOR_MS",
  "BURST_HANDOFF_MS",
  "FOCUS_HOLD_MS",
  "SETTLE_MS",
]) {
  ok(`no ${k} constant leaked into the surface`, !chat.includes(k));
}
ok("burst.ts imports only ./greeting", (burst.match(/^import .*$/gm) || []).every((l) => l.includes('"./greeting"')));
ok("greeting.ts imports nothing at all", !/^import /m.test(greeting));

// ── 2. the composer's typing signal is actually wired ──────────────────────
ok("the draft is reported to the policy", chat.includes("draftRef.current = e.target.value"));
ok("keystrokes are timestamped on change", /composer\.change\([^)]*\);[\s\S]{0,400}lastKeyAt\.current = Date\.now\(\)/.test(chat));
ok("and on keydown, so a held key counts", /composer\.key\([\s\S]{0,600}lastKeyAt\.current = Date\.now\(\)/.test(chat));
ok("sending empties the tracked draft", (chat.match(/draftRef\.current = ""/g) || []).length >= 2);
ok(
  "the draft signal costs no render",
  !chat.includes("useState(\"\");\n  const draftRef"),
  "draftRef must be a ref",
);

// ── 2b. WS-BREATH: the signals the shipped fix did not have ────────────────
//
// The recurrence was not a tuning miss. It was three signals that existed in
// the browser and reached nothing: whether the composer is focused, whether the
// keyboard is up, and how often HE doubles. Each is asserted wired here, and
// each cost a measured second of the owner's patience when it was not.
ok("the composer's FOCUS reaches the policy", /composerFocused\.current = true;/.test(chat));
ok("and blur clears it", /composerFocused\.current = false;/.test(chat));
ok("the soft keyboard is sensed from the visual viewport", /keyboardOpen\.current = open;/.test(chat));
ok("all three are handed to burstDecide", /composerFocused: composerFocused\.current,[\s\S]{0,200}keyboardOpen: keyboardOpen\.current,/.test(chat));
ok("his doubling rate is computed from the thread, not guessed", /followUpRate: followUpRate\(turns\)/.test(chat));
ok("the engagement clock is a ref, so presence costs no render", /const lastEngagedAt = useRef\(0\)/.test(chat));
ok("presence costs no render either", /const composerFocused = useRef\(false\)/.test(chat) && /const keyboardOpen = useRef\(false\)/.test(chat));
// The mirror bug, structurally: blur must NOT stamp the engagement clock, or
// the blur that every send produces would arm a hold under every message.
{
  // comments stripped: the reason this must NOT be here is written right here,
  // and a grep that cannot tell a rule from its rationale fails on its own docs
  const blur = chat
    .slice(chat.indexOf("onBlur={() => {"), chat.indexOf("onBlur={() => {") + 600)
    .replace(/\/\/.*$/gm, "");
  ok("blur does not stamp the engagement clock — the send's own blur would arm a hold", !/engaged\(\)/.test(blur), blur.slice(0, 200));
}
// …and neither may keyboard CLOSE, for exactly the same reason.
{
  const kb = chat.slice(chat.indexOf("keyboardOpen.current = open;"), chat.indexOf("keyboardOpen.current = open;") + 400);
  ok("only keyboard OPEN is an act", /if \(open\) engaged\(\);/.test(kb), kb.slice(0, 200));
}
ok("the burst telemetry says what shortened the breath", /done: d\.completion\.reason/.test(chat));

// ── 3. the flags: taken once, released once, never in the pass ─────────────
const cycle = bodyOf(chat, "replyCycle");
const pass = bodyOf(chat, "replyPass");
ok("replyCycle exists", cycle.length > 0);
ok("replyPass exists", pass.length > 0);
ok("replyCycle releases in a finally", /finally\s*\{[\s\S]*?busy\.current = false/.test(cycle));
ok("replyCycle releases thinkingChat in the same finally", /finally\s*\{[\s\S]*?thinkingChat\.current = false/.test(cycle));
ok(
  "replyPass NEVER releases busy — it cannot forget what it does not do",
  !pass.includes("busy.current = false"),
);
ok(
  "replyPass NEVER releases thinkingChat",
  !pass.includes("thinkingChat.current = false"),
);
ok(
  "replyPass does not recurse — that is what held the flag across the burst path",
  !pass.includes("replyCycle("),
);
ok(
  "the chain is a bounded loop, not a recursion",
  /for \(let i = 0; i < REPLY_CHAIN_MAX/.test(cycle),
);
ok("delivering is released in a finally too", /finally\s*\{[\s\S]{0,200}delivering\.current = false/.test(pass));

// ── 4. every waiter stops on "nothing of his is waiting" ───────────────────
// never-scheduled: she does not speak on a bare timer, only because something
// of his is unanswered. Both waiters share one gate that returns null for it.
const now = bodyOf(chat, "burstNow");
ok("burstNow refuses when nothing is waiting", /if \(!firstAt\) return null/.test(now));
for (const w of ["armBurst", "awaitBurst"]) {
  const b = bodyOf(chat, w);
  ok(`${w} consults the shared gate`, b.includes("burstNow()"));
  ok(`${w} stops dead when the gate refuses`, /if \(!d\) return/.test(b));
}
ok(
  "a cleared chat cancels an armed burst",
  /epoch\.current \+= 1;[\s\S]{0,600}clearTimeout\(burstTimer\.current\)/.test(chat),
);
ok("and drops dirty with it", /epoch\.current \+= 1;[\s\S]{0,700}dirty\.current = false/.test(chat));

// ── 5. greet-once rides the shared output path ─────────────────────────────
// `gate0-structural`: a gate the bytes can walk around is an absent gate, and
// brain.ts's own comment says this is applied at EVERY parseBubbles site
// rather than once before `return`, because the [search:] holding bubble is
// handed to the UI from inside that branch.
const gate = brain.slice(brain.indexOf("const gate = (r: ParsedReply)"), brain.indexOf("let parsed = gate("));
ok("the greet-once predicate is inside gate()", gate.includes("greetOnce("));
ok(
  "it runs after the dash strip and before the honesty gate",
  gate.indexOf("stripTextingDashes") < gate.indexOf("greetOnce(") &&
    gate.indexOf("greetOnce(") < gate.indexOf("guardReply("),
);
ok("text lane only — a spoken hello is a different act", /mode !== "call"[\s\S]{0,1600}greetOnce\(/.test(gate));
// STRUCTURAL, NOT A COUNT. This used to assert the two literal numbers 2 and 3
// — "exactly two gated sites, exactly three mentions including the
// declaration" — and it caught the right thing for the wrong reason: the
// property being protected is that NO parse escapes the gate, and a magic
// number also fails when a new site is added correctly. WS-INTERNALS-FENCE
// added a third, properly gated site (the fence's re-draft), which is exactly
// the case the old form could not tell from a leak.
//
// So the invariant is stated as the invariant: every `parseBubbles(` in this
// file is either the declaration or immediately wrapped in `gate(`. A bubble
// reaching the UI around the gate is an absent gate (`gate0-structural`), and
// that is now decidable rather than counted.
const parses = (brain.match(/parseBubbles\(/g) || []).length;
const gated = (brain.match(/gate\(parseBubbles\(/g) || []).length;
const declared = (brain.match(/export function parseBubbles\(/g) || []).length;
ok("parseBubbles is declared exactly once", declared === 1);
ok("every parseBubbles result goes through gate()", gated >= 2 && gated === parses - declared);
ok("no parseBubbles call sites outside gate()", parses - declared - gated === 0);

console.log(fail ? `${fail} FAILURES of ${n}` : `ALL ${n} PASS`);
process.exit(fail ? 1 : 0);
