// WS-O — the EXAMPLE-DIALOGUE FORMAT EXPERIMENT. ROADMAP-100X item 5.
//
//   node evals/exdialog/run.mjs     (needs evals/.bundle.mjs — run.mjs builds it)
//   node evals/run.mjs exdialog
//
// Offline, deterministic, $0, no keys, no DB, no model call, no clock.
//
// ── THE CONTRADICTION THIS EXISTS TO RESOLVE ─────────────────────────────
//
// `docs/gurukul/research/relationalos-100x.md` §5 flags the one place where an
// outside consensus and a measured in-house result point opposite ways:
//
//   OUTSIDE (SillyTavern and the persona-agent community, item #10 in that
//   file's ranked table): "example dialogues are the single most powerful
//   tool" — write them as many short mini-scenes.
//
//   IN HOUSE (`context/rejected.md` `recited-prompt`): her persona once
//   contained example quotes; she recited them verbatim on 4 of 5 turns, and
//   removing them took it to 0 at n=84. The law that came out of it is "write
//   shapes, never lines she could say".
//
// The research file's own reading — and it says out loud that it is a
// hypothesis, not a resolution — is that the variable is FORMAT rather than
// PRESENCE: a mini-scene teaches a PATTERN, a quoted line supplies a PHRASE
// BANK, and the rejected version was the second kind.
//
// ── WHAT THIS SUITE MEASURES, PRECISELY, AND WHAT IT DOES NOT ────────────
//
// IT MEASURES: how much LIFTABLE TEXT each format puts in the prompt. Three
// structural numbers per arm, over the REAL compiled prompt:
//
//   1. EMITTABLE SPANS — how many contiguous runs of the example block are
//      complete utterances that could be emitted as a reply with zero
//      adaptation. A phrase bank is, definitionally, a list of these.
//   2. LIFTABLE RATIO — what fraction of the block's characters live inside
//      those spans. Two blocks can have the same number of quotes and differ
//      by an order of magnitude in how much of the block is quote.
//   3. REGISTER OVERLAP — the fraction of the block's word n-grams that also
//      occur in a corpus of HER OWN turns (n=96, evals/recallbench's three
//      dyads, authored by a different workstream for a different purpose).
//      This is the "drawn from the same distribution as her replies" number:
//      text that is already made of things she says is text that costs the
//      model nothing to emit unchanged.
//
// IT DOES NOT MEASURE RECITATION. Recitation is a property of a MODEL's
// output, and no offline harness can observe it. What is measured here is the
// SURFACE recitation would have to come from — necessary, not sufficient. The
// decisive arm needs generation and a judge, it needs keys and money, and it
// is §5's provider seam, reporting `judged: false` so a fake can never be read
// as a measurement. That is WS-K's discipline in `evals/drift.mjs` §5, applied
// to the same class of problem.
//
// ── THE ONE GROUND-TRUTH ANCHOR, AND ITS LIMIT ───────────────────────────
// Exactly one arm here has a measured recitation rate behind it: arm A, the
// control, at 0/… (n=84) — the state the repo has been in since
// `recited-prompt`. Arm B reconstructs the shape that measured 4 of 5, but it
// is a RECONSTRUCTION: the original text is not in version control and cannot
// be recovered, so arm B's number is anchored at one end only. Stated in the
// output table, not just here.
import {
  compile,
  DEFAULT_AGENT,
  lintLine,
  assertManifestArithmetic,
  CORE_CAP,
  OPERATIONAL_CORE_CAP,
} from "../.bundle.mjs";
import { ARMS, SITUATIONS } from "./arms.mjs";
import { HER_TURNS, HIS_TURNS, ngrams, ngramList, words } from "./corpus.mjs";

let fail = 0;
let pass = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
};

// Same shape evals/drift.mjs uses, and deliberately the same kind of mundane:
// this suite measures the PROMPT, so a profile engineered to be interesting
// would be measuring the profile.
const USER = { name: "Sam", vibe: ["company"], facts: { city: "Pune" } };

/** An AgentModule that is the REAL one with the arm's example block appended
 *  to the persona CORE. Wrapping rather than editing is deliberate and is
 *  drift.mjs's idiom: the arm then travels the same assembly path, the same
 *  cache key and the same budget as the shipping brief, and `src/engine/
 *  persona.ts` is never touched by this experiment. */
function agentFor(arm) {
  if (!arm.text) return DEFAULT_AGENT;
  return {
    ...DEFAULT_AGENT,
    personaVersion: `${DEFAULT_AGENT.personaVersion}+ex${arm.id}`,
    buildSystemPromptParts(user, count, medium, dimsStage) {
      const parts = DEFAULT_AGENT.buildSystemPromptParts(user, count, medium, dimsStage);
      return { ...parts, core: `${parts.core}\n\n${arm.text}` };
    },
  };
}

function compileArm(arm, { mode = "chat" } = {}) {
  return compile({
    user: USER,
    messageCount: 120,
    medium: mode === "call" ? "voice" : "text",
    mode,
    voiceEngine: mode === "call" ? "eleven" : "gemini",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    memories: "",
    herLife: "",
    cultureNoteText: "",
    agent: agentFor(arm),
  });
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§0 the control really is the shipping prompt");
// ═════════════════════════════════════════════════════════════════════════
//
// The claim `arms.mjs` makes in its header — arm B's quotable lines reach no
// shipping prompt — is only worth anything if it is checked. Arm A must compile
// to exactly the bytes a caller with no `agent` gets today.
{
  const shipping = compile({
    user: USER,
    messageCount: 120,
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
  });
  const a = compileArm(ARMS[0]);
  ok("[X-1] arm A is byte-identical to a compile with no agent override", a.system === shipping.system);
  for (const arm of ARMS.slice(1)) {
    const c = compileArm(arm);
    ok(`[X-2] arm ${arm.id}'s text is absent from the shipping prompt`, !shipping.system.includes(arm.text.split("\n")[1]));
    ok(`[X-3] arm ${arm.id}'s text IS present in its own compile (the wrapper works)`, c.system.includes(arm.text));
  }
  ok("[X-4] the manifest arithmetic still holds under every arm", (() => { try { assertManifestArithmetic(); return true; } catch { return false; } })());
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§1 the arms are MATCHED on everything except format");
// ═════════════════════════════════════════════════════════════════════════
//
// An arm that also differed in length, in situation coverage, or in ordering
// would confound format with those. Asserted rather than intended.
{
  const b = ARMS[1].text;
  const c = ARMS[2].text;
  ok("[M-1] both example arms cover the same six situations", SITUATIONS.every((s) => b.includes(s) && c.includes(s)));
  ok("[M-2] in the same order", SITUATIONS.map((s) => b.indexOf(s)).every((v, i, a) => i === 0 || v > a[i - 1]) && SITUATIONS.map((s) => c.indexOf(s)).every((v, i, a) => i === 0 || v > a[i - 1]));
  const ratio = Math.max(b.length, c.length) / Math.min(b.length, c.length);
  ok(`[M-3] within 40% of each other in bytes (${b.length} vs ${c.length}, ratio ${ratio.toFixed(2)})`, ratio < 1.4);
  // The BUDGET, against the guard api/chat.js actually enforces
  // (OPERATIONAL_CORE_CAP, 72,000) rather than against SPEC's target CORE_CAP
  // of 40,000 — the shipping brief is already ~50 kB and exceeds the target,
  // which is a known and documented state (compiler.ts's own note on why the
  // live guard was raised to 72,000 rather than the persona cut). Asserting
  // against the target would fail on the control and measure nothing about
  // these arms.
  const base = compileArm(ARMS[0]).core.length;
  for (const arm of ARMS.slice(1)) {
    const grown = compileArm(arm).core.length;
    ok(
      `[M-4] arm ${arm.id} fits under the enforced core guard (${grown}/${OPERATIONAL_CORE_CAP}, +${grown - base} over the control)`,
      grown <= OPERATIONAL_CORE_CAP,
    );
  }
  console.log(`  the shipping core is ${base} B; SPEC's CORE_CAP target is ${CORE_CAP} and the enforced guard is ${OPERATIONAL_CORE_CAP}.`);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 THE METRIC — emittable spans and the liftable ratio");
// ═════════════════════════════════════════════════════════════════════════
//
// AN EMITTABLE SPAN is a run of text that could be sent as a reply with zero
// adaptation. Detected structurally, two ways, because her register and the
// repo's English prose fail in opposite directions:
//
//   (a) DOUBLE-QUOTED runs. A quoted span in a brief is the strongest possible
//       signal: the author has already marked where the utterance starts and
//       stops, which is precisely the work a model would otherwise have to do.
//       This is what makes a phrase bank a phrase bank.
//   (b) SENTENCE-SHAPED English, via the real `lintLine` — capital start,
//       terminal punctuation, under the word cap. That is shapelint's own
//       `recited-prompt` rule and it runs here unchanged.
//
// A FINDING, stated because it is the kind that gets lost: (b) CANNOT SEE A
// HINGLISH PHRASE BANK. `lintLine`'s sentence-shape test is
// /^[A-Z][^.?!]*[.?!]$/ — capital start, terminal punctuation — and every line
// she actually says is lowercase romanised Hinglish with no full stop. So
// shapelint, the repo's mechanised guard against `recited-prompt`, would pass
// arm B silently. That is a real gap in a live gate, it is measured below
// rather than asserted, and it is why (a) exists in this metric at all.

const QUOTED_RE = /"([^"]{4,})"/g;

function emittableSpans(text) {
  const spans = [];
  for (const m of String(text).matchAll(QUOTED_RE)) spans.push({ kind: "quoted", text: m[1] });
  for (const line of String(text).split("\n")) {
    const t = line.replace(/^[-*]\s*/, "").trim();
    if (!t) continue;
    if (/"/.test(t)) continue; // already counted by (a)
    if (lintLine(t).reasons.includes("sentence-shaped")) spans.push({ kind: "sentence", text: t });
  }
  return spans;
}

function liftableRatio(text) {
  const spans = emittableSpans(text);
  const chars = spans.reduce((s, x) => s + x.text.length, 0);
  return text.length ? chars / text.length : 0;
}

// ── REGISTER OVERLAP ──────────────────────────────────────────────────────
// Her n-grams MINUS his: an n-gram both speakers use is a fact about Hinglish,
// not about her, and counting it would turn this metric into "how Hindi is the
// text". The subtraction is what makes the number about HER distribution.
function registerOverlap(text, n) {
  const hers = ngrams(HER_TURNS, n);
  const his = ngrams(HIS_TURNS, n);
  const characteristic = new Set([...hers].filter((g) => !his.has(g)));
  const list = ngramList(text, n);
  if (!list.length) return { ratio: 0, hits: 0, total: 0 };
  const hits = list.filter((g) => characteristic.has(g)).length;
  return { ratio: hits / list.length, hits, total: list.length };
}

// ── THE CORPUS IS SMALL, AND THAT DECIDES WHICH n IS USABLE ─────────────
// 96 turns of hers, most of them two or three words ("accha", "hmm", "so jao
// ab"). A 3-gram needs four consecutive words to exist in both texts, and at
// this corpus size the characteristic-3-gram set is nearly empty — so a 3-gram
// overlap of 0.000 for BOTH arms is a fact about the corpus, not about the
// arms, and reporting it as a comparison would be reporting noise as a result.
// The usable orders are printed with their support so a reader can see which
// ones carry signal; §3 only ASSERTS on the ones that do.
const HER_SUPPORT = (n) => {
  const hers = ngrams(HER_TURNS, n);
  const his = ngrams(HIS_TURNS, n);
  return [...hers].filter((g) => !his.has(g)).length;
};
console.log(`  corpus: n=${HER_TURNS.length} of her turns, ${HIS_TURNS.length} of his (evals/recallbench dyads a/b/c)`);
console.log(
  `  characteristic n-grams in the corpus (hers minus his): 1-gram ${HER_SUPPORT(1)}, 2-gram ${HER_SUPPORT(2)}, 3-gram ${HER_SUPPORT(3)}` +
    `\n  -> both arms score 0.000 at 3-gram, so that column separates nothing here; reported, not asserted (§3 R-6b).`,
);
console.log("\n  arm | format        | core B added | emittable spans | liftable ratio | 1-gram | 2-gram | 3-gram | shapelint flags");
console.log("  ----+---------------+--------------+-----------------+----------------+--------+--------+--------+----------------");

const TABLE = [];
for (const arm of ARMS) {
  const spans = emittableSpans(arm.text);
  const lift = liftableRatio(arm.text);
  const g1 = registerOverlap(arm.text, 1);
  const g2 = registerOverlap(arm.text, 2);
  const g3 = registerOverlap(arm.text, 3);
  const flags = arm.text
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .reduce((s, l) => s + lintLine(l).reasons.length, 0);
  const row = { id: arm.id, label: arm.label, bytes: arm.text.length, spans: spans.length, lift, g1, g2, g3, flags };
  TABLE.push(row);
  console.log(
    `   ${arm.id}  | ${arm.label.padEnd(13)} | ${String(row.bytes).padStart(12)} | ${String(row.spans).padStart(15)} | ${lift.toFixed(3).padStart(14)} | ${g1.ratio.toFixed(3).padStart(6)} | ${g2.ratio.toFixed(3).padStart(6)} | ${g3.ratio.toFixed(3).padStart(6)} | ${String(flags).padStart(15)}`,
  );
}

const [A, B, C] = TABLE;

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 what the numbers say — asserted, so a regression is a failure");
// ═════════════════════════════════════════════════════════════════════════
ok("[R-1] the control has no example surface at all", A.spans === 0 && A.lift === 0 && A.bytes === 0);
ok(`[R-2] the quotable arm is ALL emittable spans (${B.spans} spans, ${(B.lift * 100).toFixed(1)}% of the block)`, B.spans === SITUATIONS.length && B.lift > 0.25);
ok(`[R-3] the micro-scene arm has ZERO emittable spans (${C.spans})`, C.spans === 0, JSON.stringify(emittableSpans(ARMS[2].text)));
ok(`[R-4] liftable ratio: quotable ${(B.lift * 100).toFixed(1)}% vs micro-scene ${(C.lift * 100).toFixed(1)}%`, B.lift > C.lift);
ok(
  `[R-5] register overlap 1-gram: quotable ${B.g1.ratio.toFixed(3)} vs micro-scene ${C.g1.ratio.toFixed(3)}`,
  B.g1.ratio > C.g1.ratio,
  `${B.g1.hits}/${B.g1.total} vs ${C.g1.hits}/${C.g1.total}`,
);
ok(
  `[R-6] register overlap 2-gram: quotable ${B.g2.ratio.toFixed(3)} vs micro-scene ${C.g2.ratio.toFixed(3)}`,
  B.g2.ratio > C.g2.ratio,
  `${B.g2.hits}/${B.g2.total} vs ${C.g2.hits}/${C.g2.total}`,
);
// The 3-gram column is REPORTED, never asserted, and the reason is visible in
// the table: BOTH arms score exactly 0.000. Neither 600-byte block reuses a
// three-word run from a 96-turn corpus, so the column separates nothing here.
// A strict inequality on it would be an assertion on which arm happened to
// collide first, which is a fact about the fixture and not about format. If a
// larger corpus ever gives it support, promote it — that is what this
// assertion is for.
ok(
  "[R-6b] the 3-gram column separates nothing at this corpus size, and is not asserted on",
  B.g3.ratio === 0 && C.g3.ratio === 0,
  `B ${B.g3.ratio} / C ${C.g3.ratio} — one arm now has 3-gram support; promote R-6b to a real comparison`,
);

// THE MECHANICAL TEST OF WHETHER A ROW BELONGS IN ARM C. Strip the situation
// half; what is left must not be sayable. "Sayable" is operationalised as
// "would be counted as an emittable span", which is the same predicate the
// table uses — no second definition.
{
  const responseHalves = ARMS[2].text
    .split("\n")
    .slice(1)
    .map((l) => l.split(" — ").slice(1).join(" — ").trim())
    .filter(Boolean);
  ok("[R-7] every micro-scene row HAS a response half", responseHalves.length === SITUATIONS.length);
  ok(
    "[R-8] no micro-scene response half is emittable on its own",
    responseHalves.every((r) => emittableSpans(r).length === 0),
    responseHalves.filter((r) => emittableSpans(r).length).join(" | "),
  );
  const quotedHalves = ARMS[1].text
    .split("\n")
    .slice(1)
    .map((l) => l.split(" — ").slice(1).join(" — ").trim())
    .filter(Boolean);
  ok("[R-9] every quotable-arm response half IS emittable (the negative control)", quotedHalves.every((r) => emittableSpans(r).length === 1));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 A GAP IN A LIVE GATE — shapelint cannot see a Hinglish phrase bank");
// ═════════════════════════════════════════════════════════════════════════
//
// Reported, and asserted so it cannot silently close without somebody
// noticing. `lintLine`'s sentence-shape rule is the repo's mechanised
// `recited-prompt` guard, and it is anchored on ENGLISH orthography: a capital
// first letter and a terminal `.?!`. Her lines are lowercase romanised
// Hinglish with no full stop, so a phrase bank written IN HER OWN VOICE — the
// only kind anyone would actually write — passes it clean.
{
  const perLine = ARMS[1].text
    .split("\n")
    .slice(1)
    .map((l) => lintLine(l.replace(/^[-*]\s*/, "").trim()).reasons);
  const sentenceFlags = perLine.filter((r) => r.includes("sentence-shaped")).length;
  ok(
    `[G-1] shapelint flags 0 of ${perLine.length} quotable-arm rows as sentence-shaped (the gap)`,
    sentenceFlags === 0,
    `flagged ${sentenceFlags} — if this now fails, shapelint learned Hinglish and §4 should be rewritten`,
  );
  console.log(
    `  shapelint sentence-shape flags on the quotable arm: ${sentenceFlags}/${perLine.length}.` +
      `\n  The quote-span detector in §2 catches ${emittableSpans(ARMS[1].text).length}/${SITUATIONS.length}.` +
      `\n  A quote-delimiter rule is the cheap fix and is NOT applied here: shapelint runs over TAIL content rows` +
      `\n  (facts, taste, summaries) where a quoted span is legitimately a person's own words — "their own words` +
      `\n  for it" is a live feature of api/memory.js's fact renderer — so the rule would fire on the wrong file.`,
  );
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 THE DECISIVE ARM — a provider seam, reporting judged:false");
// ═════════════════════════════════════════════════════════════════════════
//
// Everything above measures the SURFACE. The question the roadmap item asks —
// does a micro-scene format let example dialogue be used at all without the
// recitation the repo measured at 4/5 — is a question about MODEL OUTPUT, and
// answering it needs generation.
//
// The protocol, so a keyed session can run it without re-deriving it:
//
//   1. For each arm, compile the prompt (this file's `compileArm`).
//   2. Generate N replies per arm over a fixed probe set of user turns, one
//      per situation plus N-6 unrelated turns. The unrelated turns matter: the
//      original 4/5 finding was recitation on turns the examples were not
//      about, which is what makes it a phrase bank rather than a demonstration.
//   3. Score RECITATION as longest-common-substring between the reply and any
//      emittable span of that arm's block, normalised by the span length. A
//      threshold is not needed for the comparison — the DISTRIBUTION per arm
//      is the result.
//   4. Score the confound: reply quality/register must not collapse in arm C.
//      An arm that recites nothing because it learned nothing is not a win.
//
// The seam takes a provider rather than constructing one, so the judged arm is
// a PARAMETER of this file and never a branch inside it — evals/drift.mjs §5's
// shape, for its reason.
export function makeStructuralProvider() {
  return {
    name: "structural-fake",
    judged: false,
    score(arm) {
      const spans = emittableSpans(arm.text);
      return {
        recitationSurface: liftableRatio(arm.text),
        spans: spans.length,
        note: "surface only — no model was called, nothing was generated, this is not a recitation rate",
      };
    },
  };
}

/** The harness a keyed session plugs a real judge into. */
export function runExDialogArm(arms, provider) {
  return arms.map((a) => ({ arm: a.id, ...provider.score(a) }));
}

{
  const provider = makeStructuralProvider();
  const rows = runExDialogArm(ARMS, provider);
  console.log(`  provider: ${provider.name}  judged: ${provider.judged}  (NOT a model — no recitation rate exists offline)`);
  for (const r of rows) console.log(`    arm ${r.arm}: surface ${r.recitationSurface.toFixed(3)}  spans ${r.spans}`);
  ok("[S-1] the provider seam reports itself as unjudged, so a fake can never be read as a measurement", provider.judged === false);
  ok("[S-2] no arm's structural score is presented as a recitation rate", rows.every((r) => !("recitationRate" in r)));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§6 THE HONEST SUMMARY");
// ═════════════════════════════════════════════════════════════════════════
console.log(
  `
  WHAT IS MEASURED (structural, offline, n=${HER_TURNS.length} corpus turns):
    The quotable format puts ${B.spans} ready-to-emit utterances into the prompt and
    ${(B.lift * 100).toFixed(1)}% of its block is quote; the micro-scene format puts ${C.spans} in and
    ${(C.lift * 100).toFixed(1)}%. Vocabulary drawn characteristically from her own turns:
    ${B.g1.ratio.toFixed(3)} (1-gram) and ${B.g2.ratio.toFixed(3)} (2-gram) for the quotable arm against
    ${C.g1.ratio.toFixed(3)} and ${C.g2.ratio.toFixed(3)} for the micro-scene arm. Both formats carry the
    same six situations in the same order at comparable length, so FORMAT is the
    only variable between them.

    The 3-gram column is reported and NOT asserted: both arms score 0.000, so it
    separates nothing at this corpus size (${HER_SUPPORT(3)} characteristic 3-grams over
    ${HER_TURNS.length} turns). That is a fact about the corpus, not about the arms.

  WHAT IS NOT MEASURED:
    Recitation. That is a property of model output and no offline harness can
    see it. These numbers say the micro-scene format supplies a much smaller
    surface for recitation to come from; they do not say it recites less. The
    one arm with a measured rate behind it is A (0, n=84, from the removal that
    produced \`recited-prompt\`); arm B RECONSTRUCTS the 4-of-5 shape from its
    description because the original text is not in version control.

    Also unmeasured: whether examples TEACH anything. This suite scores the cost
    side of the trade only. An example format that recites nothing because it
    conveys nothing would score perfectly here and be worthless.

  THEREFORE:
    ROADMAP-100X item 5 is NOT resolved by this run and no law is written from
    it. What lands is a harness with a provider seam (§5) and a protocol, so
    the decisive comparison costs a keyed session and not a redesign.
`,
);

console.log(`${fail ? "FAILED" : "PASS"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
