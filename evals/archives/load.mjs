// Normalizer over evals/archives/* — the ONE shape the D-battery consumes.
//
// The three bake-off archives were written by three different rigs on three
// different days, so their raw shapes share nothing. Rather than teach every
// future battery all three dialects (and re-teach them when someone forgets
// which file holds what), this module reads the raw files VERBATIM — it never
// copies or rewrites archive data, because the archives are evidence and a
// normalizer with a transcription step is a place for evidence to rot — and
// exposes each bake-off as one fixture object:
//
//   {
//     id,                    // 'charm-grok' | 'charm-luna' | 'realtime-azure'
//     usableForD0,           // false when the archive cannot, BY ITSELF,
//                            //   let a battery flag the bake-off (charm-luna)
//     candidate,             // { model, turns: [...] } | null
//     incumbent,             // { model, turns: [...] } | null
//     judgments,             // pairwise verdicts | null
//     aggregates,            // rig-computed aggregate objects, verbatim
//     gaps,                  // what is MISSING, stated as data not prose
//   }
//
// turns are { lane, beat, rep, text } — text is the raw reply string; nothing
// is cleaned here. Deterministic metrics (word counts, question rates) belong
// to the consumer, so two batteries can never disagree because of a hidden
// normalization step. Expected-flag thresholds live in fixtures.json, next to
// this file, so the numbers the battery must reproduce are data under review,
// not constants buried in harness code.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const readJ = (...p) => JSON.parse(readFileSync(join(HERE, ...p), "utf8"));

export function loadFixtureIndex() {
  return readJ("fixtures.json");
}

export function loadFixture(id) {
  if (id === "charm-grok") return charmGrok();
  if (id === "charm-luna") return charmLuna();
  if (id === "realtime-azure") return realtimeAzure();
  throw new Error(`unknown fixture: ${id}`);
}

export function loadAllFixtures() {
  return ["charm-grok", "charm-luna", "realtime-azure"].map(loadFixture);
}

// shared extractor: battery files carry {results: [{model, lane, beat,
// turns: [{user, reply}, ...]}]} — flatten one model's replies across reps
function batteryTurns(files, model) {
  const turns = [];
  files.forEach((d, rep) => {
    for (const conv of d.results) {
      if (conv.model !== model) continue;
      conv.turns.forEach((t, i) =>
        turns.push({ lane: conv.lane, beat: conv.beat, rep, turn: i, text: t.reply }),
      );
    }
  });
  return turns;
}

function charmGrok() {
  // pb-grok1/2 are the two battery reps: 24 conversations each (text+voice
  // lanes x 12 beats), 6 turns per conversation, grok's replies only.
  // pb-merged1/2 (recovered 2026-08-13 from the live scratchpad) are the
  // merged judge inputs: the same grok replies byte-identical PLUS the
  // incumbent arm on the same stimuli — the incumbent side the first
  // archive pass flagged as missing.
  const reps = [readJ("charm-grok", "pb-grok1.json"), readJ("charm-grok", "pb-grok2.json")];
  const merged = [readJ("charm-grok", "pb-merged1.json"), readJ("charm-grok", "pb-merged2.json")];
  const judged = readJ("charm-grok", "pb-judged-grok.json");
  return {
    id: "charm-grok",
    usableForD0: true,
    candidate: { model: "grok-4-20-non-reasoning", turns: batteryTurns(reps, "grok-4-20-non-reasoning") },
    incumbent: { model: "google/gemini-3.6-flash", turns: batteryTurns(merged, "google/gemini-3.6-flash") },
    // the merged files also duplicate the candidate arm; exposed so the suite
    // can assert the two copies never drift apart
    candidateFromMerged: batteryTurns(merged, "grok-4-20-non-reasoning"),
    judgments: {
      judge: judged.judge,
      // unit = (lane, beat, rep); judged twice with slots swapped; the house
      // rule (measurements.md `charm-grok`) counts a win only when both
      // orders agree — position bias measured 56-61% toward slot A.
      verdicts: judged.verdicts,
      unitKey: ["lane", "beat", "rep"],
      bothOrdersAgreeRule: true,
    },
    aggregates: null,
    gaps: ["audio (.wav) never archived, by decision — see README.md"],
  };
}

function charmLuna() {
  // Recovered 2026-08-13 from the live scratchpad (the first archive pass
  // found only the A-before-* baseline files and honestly marked this
  // fixture unusable; the raw bake-off had survived outside evals/archives).
  // pb-raw/pb-raw2: two battery reps, THREE models on the same stimuli —
  // the incumbent, gpt-5.6-luna, and gpt-5.6-terra (terra ran but was never
  // judged). pb-judged: all 96 blind counterbalanced verdicts of
  // incumbent-vs-luna. pb-metrics: the rig's deterministic per-reply
  // counters and per-(model,lane) aggregates — the source of the recorded
  // 28.2-vs-20.5 words/turn signature. pb-tagpower: auxiliary tag-power
  // probe runs, kept verbatim.
  //
  // Luna is the "charm parity is not enough" fixture: it TIED the judged
  // charm comparison (17-18) and still carries three known-bad signatures —
  // spoken register 37% long, zero media tags in 288 replies against the
  // incumbent's 11 (instruction != emission, the §0.3 adjudication's
  // evidence), and crisis-beat collapse (qualitative; transcripts now in
  // the archive). D0 must flag it from the first two, deterministically.
  const reps = [readJ("charm-luna", "pb-raw.json"), readJ("charm-luna", "pb-raw2.json")];
  const judged = readJ("charm-luna", "pb-judged.json");
  const metrics = readJ("charm-luna", "pb-metrics.json");

  // the pre-recovery A-before-* baseline register battery, kept as auxiliary
  const baseline = {};
  for (const lane of ["text", "cascade", "live"]) {
    baseline[lane] = {
      agg: readJ("charm-luna", `A-before-${lane}.json`).agg,
      judged: readJ("charm-luna", `A-before-${lane}.judged.json`).res,
    };
  }
  return {
    id: "charm-luna",
    usableForD0: true,
    candidate: { model: "openai/gpt-5.6-luna", turns: batteryTurns(reps, "openai/gpt-5.6-luna") },
    incumbent: { model: "google/gemini-3.6-flash", turns: batteryTurns(reps, "google/gemini-3.6-flash") },
    // third arm, ran but never judged — data, not a fixture arm
    unjudged: { model: "openai/gpt-5.6-terra", turns: batteryTurns(reps, "openai/gpt-5.6-terra") },
    judgments: {
      judge: judged.judge,
      verdicts: judged.verdicts,
      unitKey: ["lane", "beat", "rep"],
      bothOrdersAgreeRule: true,
    },
    aggregates: {
      rigMetrics: metrics.agg, // per-(model,lane) deterministic counters, verbatim
      rigDropped: metrics.dropped, // 3 terra voice convs lost to a key limit
      tagpower: readJ("charm-luna", "pb-tagpower.json"),
      baselineRegister: baseline, // the A-before-* files, unrelated battery
    },
    gaps: [
      "terra arm was never judged (data present, no verdicts)",
      "crisis-beat collapse is a qualitative signature — transcripts are archived but D0 flags luna on register + media-tag axes, not on an automated crisis-collapse detector",
      "audio (.wav) never archived, by decision — see README.md",
    ],
  };
}

function realtimeAzure() {
  const reg = readJ("realtime-azure", "register.json");
  const g = readJ("realtime-azure", "guarantees.json");
  const wavs = readJ("realtime-azure", "voice-transcripts.json");
  return {
    id: "realtime-azure",
    usableForD0: true,
    candidate: {
      model: "gpt-realtime (azure)",
      // register battery: 24 spoken turns with rig-side counters riding along
      turns: reg.map((r) => ({
        lane: "live",
        beat: `s${r.s}`,
        rep: r.i,
        text: r.said,
        meta: {
          firstAudioMs: r.firstAudioMs,
          words: r.words,
          devanagari: r.devanagari,
          hinglishHits: r.hinglishHits,
        },
      })),
    },
    incumbent: null, // incumbent live-lane baseline is recorded prose (20.5 w/t), not files here
    judgments: null,
    aggregates: {
      guarantees: g, // g-crisis / g-ai / g-manip probe results, verbatim
      voiceTranscripts: wavs, // judged transcripts of the 5 saved wavs (audio not archived)
    },
    gaps: [
      "n=24 register turns and n=3 per guarantee probe — small; the 1-of-3 helpline result is recorded as UNRESOLVED in rejected.md (deliberately not counted against the model), so D0 must flag azure on register, not on the helpline row",
      "no incumbent arm in-archive; the 20.5 words/turn reference comes from context/measurements.md",
    ],
  };
}
