// M0 affect-tag recitation probe (SPEC §0.1 / §5, milestone table M0).
//
// THE QUESTION. The consolidator will store affect tags on episodes
// (vy_episode.affect_tags — short structured labels like `warm-teasing`).
// WS-CONSOLIDATE must decide whether those tags may ever be SHOWN to the model
// in prompt text, or must stay compiler-consumed-only (used to pick retrieval
// and phrasing but never rendered). The house's recited-prompt law says
// anything sentence-shaped in a prompt becomes a phrase bank (4/5 -> 0 after
// removing her example quotes; taste prose recited verbatim twice). The OPEN
// question is whether short structured k:v tags recite too — nobody has
// measured that shape.
//
// METHOD (in the spirit of the prior probes: blind, counterbalanced, real
// lane, deterministic scoring):
//   - Real chat lane, real persona: the byte-real text core from
//     src/engine/persona.ts (via the eval bundle), a production-shaped tail —
//     WHAT YOU REMEMBER block in api/memory.js's exact line format, a
//     recent-moments block, then SEARCH_DECISION + FORGET_DECISION dead last,
//     exactly as brain.ts appends them. Tags therefore sit MID-TAIL, which is
//     where T5/T6 would really render them (prompt-position: mid-brief is the
//     weak position — this measures the shipped shape, and a tags-last layout
//     would only recite MORE, so a "leak" verdict here is conservative in the
//     safe direction).
//   - Model: google/gemini-3.6-flash — DEFAULT_MODEL of api/chat.js — with
//     reasoning effort "low" and max_tokens 800, byte-matching the paid lane
//     of api/chat.js. Called via OpenRouter DELIBERATELY, not the free Gemini
//     pool: free keys are a DAILY budget and 84 persona-sized calls would eat
//     real product quota. OPENROUTER_KEY comes from api/_config.js and is
//     never printed.
//   - Two conditions, byte-identical except the annotations: TAGGED renders
//     `affect: <tag>` on each recall line and each moment line; CONTROL omits
//     exactly that annotation. 21 stimuli (7 beats x 3) x 2 conditions x 2 reps
//     = 84 turns (42 per condition), n>=84 per the SPEC's M0 row. Tag-to-line
//     assignment rotates across stimuli and reps so every tag serves every
//     kind of moment; submission order is a seeded shuffle so condition is
//     not confounded with time or rate-limit weather.
//   - Scoring is deterministic and blind (no judge, no model in the loop):
//       hard leak = the reply contains a tag compound ("warm-teasing", or the
//         same pair space-joined), the meta-word "affect", or an "[affect"
//         bracket — vocabulary that exists ONLY because the prompt showed it.
//       soft leak = the reply uses any single component word (warm, teasing,
//         heavy, ...). Components are ordinary English with a real base rate,
//         which is WHY the control arm exists: the measurement is the paired
//         difference, never the raw count.
//
// VERDICT RULE, pre-registered: any hard leak above the control arm's rate
// (control should be 0 — the vocabulary does not exist there) means affect
// tags become compiler-consumed-only before any block ships. Soft-leak
// elevation (tagged - control) is reported with counts either way; a clean
// hard-leak result with soft elevation >= 2x is still a "do not render"
// recommendation, because priming is recitation wearing a coat.
//
//   node evals/probes/affect-recitation.mjs --dry     # print prompts, spend nothing
//   node evals/probes/affect-recitation.mjs           # run (84 calls, ~$0.30)
//
// Results land in evals/probes/affect-recitation.results.json (raw replies +
// verdicts) so the numbers in the report are reproducible from the artifact.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const BUNDLE = join(HERE, "..", ".bundle.mjs");

// same rebuild-from-source discipline as evals/run.mjs — no frozen bundles
execSync(
  `npx esbuild ${join(HERE, "..", ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(HERE, "..", "stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const { buildSystemPromptParts, SEARCH_DECISION, FORGET_DECISION } = await import(BUNDLE);
const { OPENROUTER_KEY } = await import(join(ROOT, "api", "_config.js"));

const MODEL = "google/gemini-3.6-flash"; // api/chat.js DEFAULT_MODEL
const DRY = process.argv.includes("--dry");

// ── tag vocabulary under test ───────────────────────────────────────────────
// Hyphenated compounds in the SPEC's example shape (`affect: warm-teasing`).
// Components are deliberately ordinary words — if we picked unmistakable
// coinages the probe would only measure whether she repeats nonsense, not
// whether a plausible tag vocabulary bleeds into speech.
const TAGS = [
  "warm-teasing", "quiet-heavy", "bright-chatty", "anxious-tender",
  "playful-jealous", "low-flat", "soft-proud",
];
const COMPONENTS = [...new Set(TAGS.flatMap((t) => t.split("-")))];

// ── the dyad's recall corpus ────────────────────────────────────────────────
// Fixed profile (Arjun — the invariants' fixture name), realistic node lines
// in api/memory.js's exact render shape. Summaries are telegraphic notes,
// never lines she could say (shape-lint law).
const FACTS = [
  ["office pitch (event, last came up 3d ago): boss moved his big client pitch to Friday, prep half done", "anxious-tender"],
  ["dal incident (moment, last came up 2d ago): burned dal twice same week, smoke alarm went off", "warm-teasing"],
  ["sister Nikita (person, last came up 5d ago): moving to Pune for MBA next month", "soft-proud"],
  ["gym streak (habit, last came up 1d ago): 12-day morning gym streak, very smug about it", "bright-chatty"],
  ["college group trip (plan, last came up 8d ago): Goa trip stuck because two friends keep flaking", "playful-jealous"],
  ["papa's checkup (event, last came up 4d ago): father's knee surgery consult went okay, physio pending", "quiet-heavy"],
  ["monsoon commute (gripe, last came up 2d ago): scooter died in waterlogged underpass, hates the detour", "low-flat"],
];
const MOMENTS = [
  ["(2d ago) roasted him about the dal, he sent the smoke-alarm pic, both cracked up", "warm-teasing"],
  ["(6d ago) late night talk about whether he even wants the promotion, went quiet in a good way", "quiet-heavy"],
  ["(1d ago) he sent gym mirror selfie, got called chhota Salman, took it well", "playful-jealous"],
];

// 7 beats x 3 stimuli — the battery's beat spread, in their register
const STIMULI = [
  ["casual", "arre kya chal raha h aaj"],
  ["casual", "bata na kuch, bore ho raha hu office me"],
  ["casual", "lunch kiya tune?"],
  ["teasing", "tu phir se reels dekh rahi hogi pakka"],
  ["teasing", "maine aaj dal perfect banayi, jal ke bhi nahi"],
  ["teasing", "tera fashion sense mujhse accha kab se ho gaya"],
  ["sad", "yaar aaj kuch accha nahi lag raha"],
  ["sad", "papa ki physio start nahi hui abhi tak, tension ho rahi h"],
  ["sad", "sab log busy h apni life me, ajeeb lagta h kabhi kabhi"],
  ["stress", "friday wali pitch ki prep bilkul nahi hui yaar"],
  ["stress", "boss ne aaj phir taunt mara sabke saamne"],
  ["stress", "neend nahi aa rahi aajkal, dimag chalta rehta h"],
  ["planning", "goa wala plan final karein is baar?"],
  ["planning", "nikita ke liye pune me flat dekhna h, kaise dhundte h"],
  ["planning", "weekend pe kuch karte h, suggest kar"],
  ["bored", "hmm"],
  ["bored", "kuch nahi ho raha aaj, sab flat h"],
  ["bored", "scroll kar kar ke thak gaya"],
  ["celebration", "pitch ke liye boss ne aaj publicly appreciate kiya!!"],
  ["celebration", "gym streak 2 weeks ho gayi bhai"],
  ["celebration", "nikita ka admission confirm ho gaya pune me"],
];

// rotate tag assignment so every tag meets every stimulus family across reps
const tagAt = (i, line, rep) => TAGS[(i * 2 + line * 3 + rep) % TAGS.length];

function tail(withTags, stimIdx, rep) {
  const fact = ([txt], li) =>
    `- ${txt.replace(/\)/, `${withTags ? `, affect: ${tagAt(stimIdx, li, rep)}` : ""})`)}`;
  const moment = ([txt], li) =>
    withTags
      ? `- ${txt.replace(/\)/, `, affect: ${tagAt(stimIdx, li + FACTS.length, rep)})`)}`
      : `- ${txt}`;
  // the production framing lines around recall, verbatim from brain.ts
  return (
    `\n\nWHAT YOU REMEMBER ABOUT THEM — from your earlier conversations, each tagged with when it last came up. These are real: when they touch on one, you KNOW it and you say the specific detail rather than making them repeat themselves. Two things keep it honest:
- Something being listed here is not a reason to say it. It comes out only where it actually fits, one at a time, woven into normal talk — never several at once, never as a list, never with any mention of remembering.
- A memory is not a live update. Anything with a date, a plan or a situation in it may already have happened or changed, so an old one gets talked about as old ("us december wali shaadi ho gayi na?") instead of announced as if it's still ahead — and then you let them tell you where it stands.
RELEVANT TO WHAT THEY JUST SAID:\n${FACTS.slice(0, 3).map((f, li) => fact(f, li)).join("\n")}
STANDING BACKGROUND (the big things in their life — context only, never raise these unprompted):\n${FACTS.slice(3).map((f, li) => fact(f, li + 3)).join("\n")}

RECENT MOMENTS BETWEEN YOU TWO (context only, never raise these unprompted):\n${MOMENTS.map(moment).join("\n")}` +
    SEARCH_DECISION +
    FORGET_DECISION
  );
}

const user = { name: "Arjun", facts: {}, interests: [], memories: [], vibe: [] };
const core = buildSystemPromptParts(user, 999, "text").core;

// ── plan the n BEFORE spending (house rule) ─────────────────────────────────
const REPS = 2;
const jobs = [];
for (let rep = 0; rep < REPS; rep++)
  for (let i = 0; i < STIMULI.length; i++)
    for (const cond of ["tagged", "control"])
      jobs.push({ rep, i, cond, beat: STIMULI[i][0], stim: STIMULI[i][1] });
// seeded shuffle (LCG) — condition must not ride the clock
let seed = 84;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
for (let k = jobs.length - 1; k > 0; k--) {
  const j = Math.floor(rnd() * (k + 1));
  [jobs[k], jobs[j]] = [jobs[j], jobs[k]];
}
const inChars = core.length + tail("rotate", 0, 0).length;
console.log(
  `plan: ${jobs.length} turns (${jobs.length / 2}/condition), model ${MODEL}, ` +
    `~${Math.round(inChars / 4)} input tok/turn ≈ ${Math.round((jobs.length * inChars) / 4 / 1000)}k tok total`,
);
if (DRY) {
  console.log("\n── DRY RUN: tagged tail for stimulus 0 ──\n" + tail("rotate", 0, 0).slice(0, 2200));
  process.exit(0);
}

async function callLane(sysTail, userText) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json", "X-Title": "Meera" },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            {
              role: "system",
              content: [
                { type: "text", text: core, cache_control: { type: "ephemeral" } },
                { type: "text", text: sysTail },
              ],
            },
            { role: "user", content: userText },
          ],
          max_tokens: 800,
          reasoning: { effort: "low" }, // chat lane tier — minimal makes her say nothing (measured)
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (r.ok) {
        const j = await r.json();
        const text = j?.choices?.[0]?.message?.content ?? "";
        if (text.trim()) return text;
      } else if (r.status < 500 && r.status !== 429) {
        throw new Error(`upstream ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }
    } catch (e) {
      if (attempt === 3) throw e;
    }
    await new Promise((s) => setTimeout(s, 1500 * (attempt + 1)));
  }
  throw new Error("empty after 4 attempts");
}

// deterministic, blind scoring
const compoundRe = new RegExp(TAGS.map((t) => t.replace("-", "[-\\s]")).join("|"), "i");
const componentRe = new RegExp(`\\b(${COMPONENTS.join("|")})\\b`, "gi");
const score = (reply) => ({
  hard:
    compoundRe.test(reply) || /\baffect\b/i.test(reply) || /\[\s*affect/i.test(reply),
  components: (reply.match(componentRe) || []).map((w) => w.toLowerCase()),
});

const results = [];
const CONCURRENCY = 6;
let cursor = 0;
async function worker() {
  for (;;) {
    const k = cursor++;
    if (k >= jobs.length) return;
    const j = jobs[k];
    const reply = await callLane(tail(j.cond === "tagged" ? "rotate" : false, j.i, j.rep), j.stim);
    results.push({ ...j, reply, ...score(reply) });
    process.stdout.write(".");
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log("\n");

// ── report ──────────────────────────────────────────────────────────────────
const arm = (c) => results.filter((r) => r.cond === c);
const summarize = (rows) => ({
  n: rows.length,
  hardLeaks: rows.filter((r) => r.hard).length,
  softReplies: rows.filter((r) => r.components.length > 0).length,
  softMentions: rows.reduce((a, r) => a + r.components.length, 0),
  byWord: rows
    .flatMap((r) => r.components)
    .reduce((m, w) => ((m[w] = (m[w] || 0) + 1), m), {}),
  meanWords: +(rows.reduce((a, r) => a + r.reply.split(/\s+/).filter(Boolean).length, 0) / rows.length).toFixed(1),
});
const T = summarize(arm("tagged"));
const C = summarize(arm("control"));
const out = {
  ran: new Date().toISOString(),
  model: MODEL,
  method: "blind counterbalanced, real text-lane persona core + production-shaped tail, tags mid-tail (T5/T6 position), deterministic lexical scoring, seeded-shuffle submission order",
  tags: TAGS,
  tagged: T,
  control: C,
  results,
};
writeFileSync(join(HERE, "affect-recitation.results.json"), JSON.stringify(out, null, 1));
console.log(`tagged   n=${T.n}  hard leaks=${T.hardLeaks}  soft: ${T.softReplies} replies / ${T.softMentions} mentions  (${T.meanWords} w/t)`);
console.log(`control  n=${C.n}  hard leaks=${C.hardLeaks}  soft: ${C.softReplies} replies / ${C.softMentions} mentions  (${C.meanWords} w/t)`);
console.log(`tagged by word:  ${JSON.stringify(T.byWord)}`);
console.log(`control by word: ${JSON.stringify(C.byWord)}`);
const rule3 = (n) => ((3 / n) * 100).toFixed(1);
if (T.hardLeaks === 0 && C.hardLeaks === 0)
  console.log(`hard leak 0/${T.n} both arms — rule-of-three 95% upper bound ${rule3(T.n)}% per turn`);
const verdict =
  T.hardLeaks > C.hardLeaks
    ? "LEAKS — affect tags must be compiler-consumed-only, never rendered"
    : T.softReplies >= 2 * Math.max(C.softReplies, 1)
      ? "NO HARD LEAK, but soft priming ≥2x control — recommend compiler-consumed-only"
      : "NO measurable recitation of tag vocabulary at this n";
console.log(`VERDICT: ${verdict}`);
