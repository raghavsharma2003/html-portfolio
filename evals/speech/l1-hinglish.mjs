// #88 TEST L1 — does the live speech-to-speech lane mispronounce romanised
// Hinglish? INVESTIGATION FIRST, recorded here rather than assumed:
//
// The LIVE lane (src/voice/liveCall.ts) is a browser-only bidi WebSocket
// session against `gemini-3.1-flash-live-preview` (api/live-token.js),
// authenticated by a single-use ephemeral token and driven entirely by
// client-side audio (AudioContext mic capture in, PCM chunks played back).
// It cannot be driven headlessly for a PRONUNCIATION probe, for two
// independent reasons, not one:
//   1. Mechanical — echosim (evals/echosim/) already proves liveCall.ts CAN
//      be transpiled and driven standalone, but only for the ACOUSTIC/
//      barge-in floor (simulated echo timing against a scripted turn taker).
//      It never asserts on WHAT was said, only on WHEN audio moved — there
//      is no STT step in that harness at all.
//   2. Structural, and this is the one that actually rules it out: the live
//      lane is CONVERSATIONAL, not a command-follower. There is no
//      documented, tested mechanism to force the live model to utter one
//      exact corpus line verbatim — asking her to "say X" is itself a user
//      turn she is free to answer in character (a paraphrase, a tease, a
//      refusal), which would confound "did the ENGINE mispronounce it" with
//      "did the MODEL decide to say something else". A pronunciation probe
//      needs the text spoken to be under the harness's control, not the
//      persona's.
// CONFIRMED, per the ticket's own out clause: this suite covers the CASCADE
// TTS lane (api/speech.js) instead, which shares the register (same voice
// name, same delivery-direction prompt shape, same underlying model family
// — see api/speech.js's own MODEL/FREE_MODEL) and, unlike the live lane, IS
// a pure text-to-audio call with no conversational layer between the
// harness and what gets synthesised.
//
// METHOD:
//   (a) CORPUS — 20 lines. 18 are real fragments quoted from
//       src/engine/persona.ts (READ-ONLY — nothing here edits it), covering
//       the stretched-vowel register (§131), the full spoken spelling rule
//       (§141: "nahi", "hai", not "nhi", "h"), self-correction (§135), and
//       common register markers actually used in the brief. 2 are the
//       task's own named ambiguous-romanisation pairs that do NOT appear
//       verbatim in persona.ts (bahut/bohot, padh/pad) — flagged as such,
//       never misrepresented as a persona.ts quote. See CORPUS below; every
//       entry carries its citation.
//   (b) SYNTHESIS — the REAL cascade lane's free/direct-Google leg: same
//       model (api/speech.js's FREE_MODEL), same voice (DEFAULT_VOICE), same
//       delivery-direction prompt template, same key pool (withGeminiKey
//       from api/_gkeys.js, keys from api/_config.js) — reimplemented here
//       non-streaming (generateContent, not streamGenerateContent) because a
//       one-shot probe has no playback deadline to race; the audio bytes and
//       the model are identical either way. wavHeader is copied verbatim
//       from api/speech.js (a pure function, safe to duplicate for a probe
//       that must not import a Vercel request handler).
//   (c) ROUND-TRIP — the synthesised WAV is sent back through Gemini as a
//       multimodal transcription request (audio in, romanised-text out).
//       This repo has NO existing server-side STT call to reuse (voice-note
//       transcription today is client-side Web Speech API, and the live
//       lane's STT is internal to the bidi session) — the call here is a
//       new, minimal, direct use of the same already-available Google key,
//       not a wrapper around anything that already shipped.
//   (d) SCORING — per-line: the normalised transcript, a token-overlap
//       ratio against the expected line, and an explicit mispronunciation
//       flag when the transcript substitutes a plausible ENGLISH reading for
//       the Hindi token in the exact positions this suite's own corpus
//       targets (hai→he/hi, kal→call/kul, main→man/mane, kya→kaya/kia,
//       pad/padh→pad(as in notepad), bahut/bohot→boat/bo hot) — a curated
//       confusable list, not a generic spellchecker, because the task asks
//       specifically for "STT returns an English-word reading", which a
//       generic diff cannot distinguish from an unrelated STT miss.
//
// COST AND GATING: real paid calls (Google TTS + Google multimodal
// transcription), n=20, cents at most. Gated behind SPEECH_RUN=1 so this
// never runs by accident in evals/run.mjs (which is why it is deliberately
// NOT wired into that suite map — same by-construction exclusion as
// evals/dbattery/d2.mjs (WSBAT_RUN_JUDGED=1) and evals/self/wiring.mjs
// --live: a paid, network suite has no business running on every commit).
// Unset SPEECH_RUN prints SKIP and exits 0 — never silent.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

if (process.env.SPEECH_RUN !== "1") {
  console.log(
    "SKIP  evals/speech/l1-hinglish.mjs — set SPEECH_RUN=1 to run for real. " +
      "This suite makes real paid Google TTS + transcription calls (n=20, cents at most).",
  );
  process.exit(0);
}

const { withGeminiKey } = await import(join(ROOT, "api/_gkeys.js"));

// ─────────────────────────────────────────────────────────────────────────
// (a) CORPUS — see method note above. `note` names the specific ambiguity
// under test; `src` is the persona.ts citation, or "task-specified" for the
// two pairs the ticket named that are not persona.ts quotes.
// ─────────────────────────────────────────────────────────────────────────
const CORPUS = [
  { text: "nahi", note: "hai/he family baseline — full spoken spelling, never 'nhi'", src: "persona.ts:141" },
  { text: "hai", note: "the hai/he ambiguous pair itself", src: "persona.ts:141" },
  { text: "abhi", note: "full spoken spelling, never 'abi'/'avi'", src: "persona.ts:141" },
  { text: "matlab", note: "common filler, risk of being read as two English-looking syllables", src: "persona.ts:141" },
  { text: "pata nahi", note: "two-word phrase, 'nahi' full form", src: "persona.ts:141" },
  { text: "kal", note: "the kal/call ambiguous pair (kal milte hai's own word)", src: "persona.ts:141" },
  { text: "nahiii", note: "stretched vowel — must not become three separate syllables", src: "persona.ts:131" },
  { text: "acchhaaa", note: "stretched vowel, the exact ticket example", src: "persona.ts:131" },
  { text: "arreee", note: "stretched vowel on an interjection", src: "persona.ts:131" },
  { text: "yaaar", note: "stretched vowel on a loanword-adjacent term", src: "persona.ts:131" },
  { text: "chhod, tum batao", note: "the ticket's 'chhod na' family — self-correction cutoff", src: "persona.ts:135" },
  { text: "no wait, he messaged actually", note: "English 'he' pronoun ADJACENT to the hai/he confusable — tests the OTHER direction (real English word misread as Hindi, or vice versa)", src: "persona.ts:135" },
  { text: "kya kar rha", note: "the kya ambiguous word in its most common frame", src: "persona.ts:147" },
  { text: "scene kya h", note: "kya + the 'h' shortform in the same phrase, code-mixed with English 'scene'", src: "persona.ts:144" },
  { text: "acha", note: "single-word backchannel, most frequent token in her register", src: "persona.ts:151" },
  { text: "thik h", note: "'h' shortform for hai, contrasted against line 2's full 'hai'", src: "persona.ts:151" },
  { text: "arre kya hua", note: "arre + kya in a real sentence frame", src: "persona.ts:316" },
  { text: "main abhi hasi jab tu serious tha", note: "the main/mai/meyn ambiguous pair in a full clause", src: "persona.ts:238" },
  { text: "bahut", note: "the bahut/bohot ambiguous pair — NOT a persona.ts quote, task-specified addition", src: "task-specified" },
  { text: "padh", note: "the padh/pad ambiguous pair — NOT a persona.ts quote, task-specified addition", src: "task-specified" },
];
if (CORPUS.length !== 20) throw new Error(`corpus must be exactly 20 lines, got ${CORPUS.length}`);

// confusable-English-reading map for the mispronunciation flag (see method
// note (d) — curated, not generic)
const CONFUSABLES = {
  hai: ["he", "hi", "hey"],
  he: ["hai"], // the reverse direction: an English "he" read as Hindi "hai"
  kal: ["call", "cull", "kul"],
  main: ["man", "mane", "mayne", "mine"],
  kya: ["kaya", "kia", "kaia"],
  padh: ["pad", "pod"],
  pad: ["pad"],
  bahut: ["boat", "bow hot", "bahoot"],
  nahi: ["nahi", "nowhy", "no he"],
};

// ─────────────────────────────────────────────────────────────────────────
// (b) SYNTHESIS — mirrors api/speech.js's free/direct-Google leg exactly
// (model, voice, prompt template, key pool), non-streaming.
// ─────────────────────────────────────────────────────────────────────────
const TTS_MODEL = "gemini-3.1-flash-tts-preview"; // api/speech.js FREE_MODEL, verbatim
const VOICE_NAME = "Autonoe"; // api/speech.js DEFAULT_VOICE, verbatim
const SAMPLE_RATE = 24000;

// copied verbatim from api/speech.js's wavHeader — pure function, duplicated
// rather than imported so this probe never pulls in a Vercel handler module
function wavHeader(pcmBytes) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcmBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcmBytes, 40);
  return h;
}

async function synthesize(text) {
  const result = await withGeminiKey(async (key) => {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  // same delivery-direction template as api/speech.js's free lane
                  text: `Say in a warm, natural Indian-accented Hinglish, relaxed, natural, casual: ${text}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } },
          },
        }),
      },
    );
    if (!r.ok) {
      const status = r.status;
      if (status === 429 || status === 403) return { ok: false, exhausted: true };
      if (status >= 500) return { ok: false, retry: true, error: `tts ${status}` };
      return { ok: false, error: `tts ${status} — ${await r.text().catch(() => "")}` };
    }
    const j = await r.json();
    const b64 = j?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) return { ok: false, error: "no audio in response" };
    return { ok: true, value: Buffer.from(b64, "base64") };
  });
  if (!result.value) throw new Error(result.error || "tts failed on every key");
  const pcm = result.value;
  return Buffer.concat([wavHeader(pcm.length), pcm]);
}

// ─────────────────────────────────────────────────────────────────────────
// (c) ROUND-TRIP STT — new, minimal, direct Gemini multimodal call (no
// existing server-side STT to reuse — see method note (c)). Tries a short
// ordered list of model names since this repo has no precedent for which
// bare (non-OpenRouter) Gemini model name serves audio-in text-out on this
// account; the first that answers wins, and which one is recorded per line.
// ─────────────────────────────────────────────────────────────────────────
const STT_MODEL_CANDIDATES = ["gemini-3.1-flash-lite", "gemini-3.1-flash", "gemini-2.5-flash"];

const STT_PROMPT =
  "Transcribe EXACTLY what is spoken in this audio clip. Romanised script only " +
  "(Latin letters, never Devanagari), no punctuation, no translation, no " +
  "commentary — just the words as they sound, lowercase. If a word is Hindi, " +
  "write it the way it sounds in Roman letters (e.g. \"hai\" not \"he\", \"kal\" " +
  "not \"call\") using your best-effort phonetic judgement of what was actually " +
  "said, not what an English word would look like.";

async function transcribe(wavBuffer) {
  const b64 = wavBuffer.toString("base64");
  let lastErr = null;
  for (const model of STT_MODEL_CANDIDATES) {
    const result = await withGeminiKey(async (key) => {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: STT_PROMPT }, { inlineData: { mimeType: "audio/wav", data: b64 } }],
              },
            ],
          }),
        },
      );
      if (!r.ok) {
        const status = r.status;
        if (status === 404) return { ok: false, error: `model ${model} not available (404)` };
        if (status === 429 || status === 403) return { ok: false, exhausted: true };
        if (status >= 500) return { ok: false, retry: true, error: `stt ${status}` };
        return { ok: false, error: `stt ${status} — ${await r.text().catch(() => "")}` };
      }
      const j = await r.json();
      const txt = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      if (!txt.trim()) return { ok: false, error: "empty transcript" };
      return { ok: true, value: txt.trim() };
    });
    if (result.value) return { transcript: result.value, model };
    lastErr = result.error || "stt failed on every key";
  }
  throw new Error(`STT failed on every candidate model — last error: ${lastErr}`);
}

// ─────────────────────────────────────────────────────────────────────────
// (d) SCORING
// ─────────────────────────────────────────────────────────────────────────
const normalize = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (s) => normalize(s).split(" ").filter(Boolean);

function scoreLine(expectedText, transcript) {
  const expected = tokenize(expectedText);
  const got = tokenize(transcript);
  const gotSet = new Set(got);
  let matched = 0;
  const misses = [];
  const flags = [];
  for (const tok of expected) {
    if (gotSet.has(tok)) {
      matched++;
      continue;
    }
    misses.push(tok);
    const confusables = CONFUSABLES[tok];
    if (confusables && confusables.some((c) => gotSet.has(c) || got.some((g) => g.includes(c)))) {
      flags.push(`"${tok}" -> read as English ("${confusables.find((c) => gotSet.has(c) || got.some((g) => g.includes(c)))}")`);
    }
  }
  const ratio = expected.length ? matched / expected.length : 1;
  return { expected, got, matched, misses, flags, ratio };
}

// ─────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────
console.log(`Running L1 Hinglish TTS/STT audit — n=${CORPUS.length}, model=${TTS_MODEL}, voice=${VOICE_NAME}\n`);

const results = [];
for (const [i, item] of CORPUS.entries()) {
  process.stdout.write(`[${i + 1}/${CORPUS.length}] "${item.text}" ... `);
  try {
    const wav = await synthesize(item.text);
    const { transcript, model: sttModel } = await transcribe(wav);
    const score = scoreLine(item.text, transcript);
    results.push({ ...item, transcript, sttModel, score, error: null });
    console.log(
      `stt="${transcript}" ratio=${(score.ratio * 100).toFixed(0)}%${score.flags.length ? " FLAGGED: " + score.flags.join("; ") : ""}`,
    );
  } catch (e) {
    results.push({ ...item, transcript: null, sttModel: null, score: null, error: e?.message || String(e) });
    console.log(`ERROR: ${e?.message || e}`);
  }
}

const errored = results.filter((r) => r.error);
const scored = results.filter((r) => r.score);
const flagged = scored.filter((r) => r.score.flags.length > 0);
const worst = [...scored].sort((a, b) => a.score.ratio - b.score.ratio).slice(0, 5);

console.log(`\n${scored.length}/${CORPUS.length} lines scored, ${errored.length} errored, ${flagged.length} flagged as likely mispronunciations.`);
if (worst.length) {
  console.log("\nWorst offenders (lowest word-match ratio):");
  for (const w of worst) {
    console.log(`  "${w.text}" -> "${w.transcript}" (${(w.score.ratio * 100).toFixed(0)}%)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// WRITE THE AUDIT DOC — method + n + date, per this repo's own rule
// (context/measurements.md's convention, CLAUDE.md "a number without n,
// method and date cannot be compared against a future one").
// ─────────────────────────────────────────────────────────────────────────
const dateStr = new Date().toISOString().slice(0, 10);
const docPath = join(ROOT, "docs/audit", `${dateStr}-hinglish-tts.md`);

const lines = [];
lines.push(`# #88 TEST L1 — Hinglish TTS/STT round-trip audit — ${dateStr}`);
lines.push("");
lines.push(
  `Method: cascade TTS lane only (api/speech.js's free/direct-Google leg, model ` +
    `\`${TTS_MODEL}\`, voice \`${VOICE_NAME}\`) — the LIVE speech-to-speech lane ` +
    `(\`src/voice/liveCall.ts\`) cannot be driven headlessly for a pronunciation ` +
    `probe (see evals/speech/l1-hinglish.mjs's header for the two independent ` +
    `reasons: no STT step in the existing acoustic-floor harness, and no way to ` +
    `force a verbatim utterance out of a conversational model without confounding ` +
    `engine mispronunciation with model paraphrase). n=${CORPUS.length}, real paid ` +
    `Google calls, run once on ${dateStr}. Round-trip: each line synthesised, then ` +
    `sent back through Gemini multimodal transcription (romanised output requested). ` +
    `Scored by word-level token match against the source line, plus a curated ` +
    `confusable-word flag for the specific ambiguous romanisations this ticket named ` +
    `(hai/he, kal/call, main/man, kya/kaya, padh|pad, bahut/bohot).`,
);
lines.push("");
lines.push(`**Summary: ${scored.length}/${CORPUS.length} scored, ${errored.length} errored, ${flagged.length} flagged as likely mispronunciations.**`);
lines.push("");
if (worst.length) {
  lines.push("## Worst offenders (lowest word-match ratio)");
  lines.push("");
  for (const w of worst) {
    lines.push(`- **"${w.text}"** (${w.src}) -> STT: "${w.transcript}" — ${(w.score.ratio * 100).toFixed(0)}% match${w.score.flags.length ? `, FLAGGED: ${w.score.flags.join("; ")}` : ""}`);
  }
  lines.push("");
}
lines.push("## Full per-line results");
lines.push("");
lines.push("| # | line | source | STT transcript | match | flagged mispronunciation |");
lines.push("|---|------|--------|-----------------|-------|---------------------------|");
for (const [i, r] of results.entries()) {
  if (r.error) {
    lines.push(`| ${i + 1} | \`${r.text}\` | ${r.src} | ERROR | — | ${r.error.replace(/\|/g, "/")} |`);
  } else {
    lines.push(
      `| ${i + 1} | \`${r.text}\` | ${r.src} | \`${r.transcript}\` | ${(r.score.ratio * 100).toFixed(0)}% | ${r.score.flags.length ? r.score.flags.join("; ") : "—"} |`,
    );
  }
}
lines.push("");
lines.push(`STT model used: ${[...new Set(results.filter((r) => r.sttModel).map((r) => r.sttModel))].join(", ") || "n/a (all errored)"}.`);
lines.push("");

mkdirSync(join(ROOT, "docs/audit"), { recursive: true });
writeFileSync(docPath, lines.join("\n") + "\n");
console.log(`\nWrote ${docPath}`);

process.exit(errored.length === CORPUS.length ? 1 : 0);
