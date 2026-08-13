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

function charmGrok() {
  // pb-grok1/2 are the two battery reps: 24 conversations each (text+voice
  // lanes x 12 beats), 6 turns per conversation, grok's replies only.
  const reps = [readJ("charm-grok", "pb-grok1.json"), readJ("charm-grok", "pb-grok2.json")];
  const turns = [];
  reps.forEach((d, rep) => {
    for (const conv of d.results)
      conv.turns.forEach((t, i) =>
        turns.push({ lane: conv.lane, beat: conv.beat, rep, turn: i, text: t.reply }),
      );
  });
  const judged = readJ("charm-grok", "pb-judged-grok.json");
  return {
    id: "charm-grok",
    usableForD0: true,
    candidate: { model: "grok-4-20-non-reasoning", turns },
    // The incumbent's replies to the same battery lived in pb-merged1/2.json,
    // which were NOT archived — only the verdicts naming who won each axis
    // survive. See gaps.
    incumbent: { model: "google/gemini-3.6-flash", turns: null },
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
    gaps: [
      "incumbent transcripts (pb-merged1/2.json) not archived — incumbent-side register metrics must come from the judged verdicts or be regenerated",
      "audio (.wav) never archived, by decision — see README.md",
    ],
  };
}

function charmLuna() {
  // HONESTY NOTE, load-bearing: this directory does NOT contain the luna
  // bake-off. It holds the incumbent stack's "A/before" register battery
  // (module base0; text/cascade/live lanes; 28 turns each) — the baseline arm
  // of the tone-cascade work. No luna reply, no charm verdict, and none of
  // the recorded luna evidence (17-18 tie, 28.2 words/turn, 0/144 media tags,
  // crisis-beat collapse — measurements.md `charm-luna`) is recomputable from
  // these files. usableForD0=false is the honest verdict; do not flip it by
  // pointing the battery at the incumbent's own baseline and calling the
  // flag a luna flag.
  const lanes = ["text", "cascade", "live"];
  const turns = [];
  const aggregates = {};
  const judgedAgg = {};
  for (const lane of lanes) {
    const d = readJ("charm-luna", `A-before-${lane}.json`);
    aggregates[lane] = d.agg;
    d.rows.forEach((r) =>
      turns.push({ lane, beat: r.beat, rep: r.rep, text: r.raw, spoken: r.spoken }),
    );
    judgedAgg[lane] = readJ("charm-luna", `A-before-${lane}.judged.json`).res;
  }
  return {
    id: "charm-luna",
    usableForD0: false,
    candidate: null, // luna's replies are not in the archive
    incumbent: { model: "incumbent stack (module base0; engines per agg)", turns },
    judgments: null, // the 17-18 judged tie is not in the archive
    aggregates: { register: aggregates, judgedQuality: judgedAgg },
    gaps: [
      "no luna transcripts — the files are the incumbent 'A/before' baseline register battery",
      "no judged luna-vs-incumbent verdicts (the 17-18 tie, the 9-25 specificity split)",
      "the three known-bad luna signatures (28.2 words/turn, 0/144 media tags, crisis-beat collapse) exist only as recorded aggregates in context/measurements.md, not as recomputable data here",
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
