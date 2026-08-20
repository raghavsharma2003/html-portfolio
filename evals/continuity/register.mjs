// WS-CONTINUITY — G-C7, THE GATE THAT DECIDES WHETHER THIS SHIPS.
//
//   WSCONT_RUN_LLM=1 node evals/continuity/register.mjs [reps]
//
// GENERATIVE. Real model calls, real money (small — Google's free pool first,
// same rotation api/chat.js uses). Gated behind an env var and deliberately
// NOT in evals/run.mjs, the same rule evals/dbattery/d2.mjs is under: a judged
// or generative suite that runs in CI is a suite someone turns off.
//
// WHAT IT MEASURES AND WHAT IT DOES NOT.
// Adding seven relational slots to the call lane is exactly the change that
// makes her LONGER on the phone, and the whole point of the voice medium is
// that she is shorter there. The reference numbers, from context/rejected.md:
//
//   incumbent (shipped)   20.5 words/turn
//   `brain-model`         declined a model at 36.1
//   `realtime-azure`      declined at 41, then 53; questions 13/24 turns
//                         against a ceiling of about 1 in 3
//
// This measures the PROMPT's contribution to that register, not the realtime
// model's: it sends the compiled call-lane system instruction (medium voice,
// live speech style — byte-for-byte what useCallEngine now hands
// startLiveCall) to gemini-3.6-flash through the same Google endpoint
// api/chat.js's free lane uses, at the same reasoning tier a call uses. It is
// NOT a measurement of the Gemini Live lane, which speaks rather than writes
// and cannot be driven from here. Stated plainly because the alternative —
// letting a proxy pass as the real thing — is how a number outlives its
// method. What it CAN answer is the only question this change puts at risk:
// does the added context, by itself, make her longer.
//
// Both arms are identical except for the one field under test: BEFORE is
// `relBundle: null`, which is literally what production compiled on every call
// before this workstream (brain.ts's `mode === "call"` null). AFTER is the
// same person with their real bundle.
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseInput } from "./_fixtures.mjs";

if (process.env.WSCONT_RUN_LLM !== "1") {
  console.log(
    "SKIPPED — generative suite. Re-run with WSCONT_RUN_LLM=1 to spend real model calls.\n" +
      "  WSCONT_RUN_LLM=1 node evals/continuity/register.mjs 2",
  );
  process.exit(0);
}

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const REPS = Math.max(1, Number(process.argv[2] || 2));
const tmp = mkdtempSync(join(tmpdir(), "wscont-reg-"));
const BUNDLE = join(tmp, "continuity.bundle.mjs");
execSync(
  `npx esbuild ${join(ROOT, "evals/continuity/_entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const { compile } = await import(BUNDLE);
const cfg = await import(`${ROOT}/api/_config.js`);
const KEYS = [cfg.GOOGLE_KEY, ...(cfg.GOOGLE_KEYS || [])].filter(Boolean);
const URL_OAI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

// Spoken turns, not typed ones: transcription-shaped, no punctuation, the mix
// of registers a real call has (small talk, a real thing, a callback cue, a
// factual ask, a tease). One of them contains explicit deixis, which is the
// only turn where T6 is allowed to become ACTIVE — included on purpose, since
// the pull is exactly where an over-long answer would show up first.
const TURNS = [
  "haan bol kya kar rahi thi",
  "aaj office me bahut zyada kaam tha yaar mai thak gaya hu",
  "acha suno wo tumhare flatmate wali baat ka kya hua",
  "remember when we stayed up till 4am that night",
  "kal ka plan kya hai tumhara",
  "mujhe lagta hai mai wo job change kar lunga",
  "arre tum toh bilkul badal gayi ho",
  "khana khaya tumne",
  "mera mood kharab hai bas aise hi",
  "tumhe wo movie dekhni thi na kaunsi thi",
  "kuch bhi bolo bas bore ho raha hu",
  "ok toh mai rakhta hu phone",
];

const call = async (system, userText) => {
  const body = {
    model: "gemini-3.6-flash",
    reasoning_effort: "minimal", // api/chat.js's `no_think === true` tier — a call
    max_tokens: 400, // brain.ts's call cap
    messages: [
      { role: "system", content: system },
      { role: "user", content: "[8:14 pm] [a voice call starts]\nhello?" },
      { role: "assistant", content: "haan haan bolo, sun rahi hu" },
      { role: "user", content: `[8:15 pm] ${userText}` },
    ],
  };
  for (const k of KEYS) {
    try {
      const r = await fetch(URL_OAI, {
        method: "POST",
        headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
      if (r.status === 429 || r.status === 503) continue;
      if (!r.ok) return { err: `http ${r.status}` };
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content || "";
      if (!text.trim()) return { err: "empty" };
      return { text };
    } catch (e) {
      return { err: String(e.message).slice(0, 60) };
    }
  }
  return { err: "pool exhausted" };
};

// What reaches a listener: the tone marker and any bracketed machinery are
// metadata, never spoken, so they must not be counted as her words.
const spoken = (t) =>
  t
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const words = (t) => spoken(t).split(/\s+/).filter(Boolean).length;
// Question rate on a call is a REGISTER measure, not a grammar one: "kya",
// "na?", "haina" and a bare "?" all count. Measured per TURN (did this turn
// ask anything), which is how `realtime-azure`'s 13/24 was measured.
const asks = (t) => /\?/.test(spoken(t)) || /\b(kya|kyun|kaise|kab|kahan|kaun|na)\s*$/i.test(spoken(t));

const stat = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  return {
    n: xs.length,
    mean: Number(mean.toFixed(1)),
    median: s[Math.floor(s.length / 2)] ?? 0,
    p90: s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] ?? 0,
    max: s[s.length - 1] ?? 0,
  };
};

async function arm(label, input) {
  const compiled = compile(input);
  const w = [];
  let q = 0;
  let errs = 0;
  for (let rep = 0; rep < REPS; rep++) {
    for (const t of TURNS) {
      const r = await call(compiled.system, t);
      if (r.err) {
        errs++;
        continue;
      }
      w.push(words(r.text));
      if (asks(r.text)) q++;
    }
  }
  const s = stat(w);
  console.log(
    `  ${label.padEnd(8)} tail=${String(compiled.tail.length).padStart(5)}b  n=${String(s.n).padStart(3)}  ` +
      `words/turn mean=${String(s.mean).padStart(5)} median=${String(s.median).padStart(3)} p90=${String(s.p90).padStart(3)} max=${String(s.max).padStart(3)}  ` +
      `questions=${q}/${s.n} (${((100 * q) / (s.n || 1)).toFixed(0)}%)${errs ? `  [${errs} failed calls]` : ""}`,
  );
  return { ...s, q, errs, tail: compiled.tail.length };
}

const turnInput = (extra) =>
  baseInput({
    medium: "voice",
    mode: "call",
    voiceEngine: "live",
    innerThread: "",
    innerWants: "",
    latestUserText: "",
    gapSinceLastMs: 20 * 3_600_000,
    ...extra,
  });

console.log(`\n── G-C7 register, ${REPS} rep(s) x ${TURNS.length} turns per arm ──`);
console.log("   reference: incumbent 20.5 w/t; declined at 36.1; declined at 41-53; question ceiling ~1 in 3\n");
const before = await arm("BEFORE", turnInput({ relBundle: null }));
const after = await arm("AFTER", turnInput({}));

console.log("");
let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? `  ${detail}` : ""}`);
};
// The bands, as numbers rather than prose. 36.1 is the number a model was
// declined at, so it is the hard ceiling; the delta bar is what stops a slow
// drift that never trips the ceiling.
ok("AFTER stays under the 36.1 decline threshold", after.mean < 36.1, `${after.mean} w/t`);
ok("AFTER does not add more than 15% to BEFORE's length", after.mean <= before.mean * 1.15, `${before.mean} -> ${after.mean} w/t (${(((after.mean - before.mean) / (before.mean || 1)) * 100).toFixed(1)}%)`);
ok("question rate stays at or under ~1 in 3", after.q / (after.n || 1) <= 0.40, `${after.q}/${after.n}`);
ok("enough calls landed to mean anything", after.n >= 10 && before.n >= 10, `before n=${before.n}, after n=${after.n}`);

console.log(
  failed
    ? "\nFAILED — G-C7. Per SPEC-CONTINUITY §5, the answer is NOT to ship anyway: take a measured SUBSET of slots (T2/T3 are the cheapest and least directive; T4/T6 carry the most words), log which and why, and re-run."
    : "\nPASS — G-C7: the added context does not move her voice register out of band.",
);
process.exit(failed ? 1 : 0);
