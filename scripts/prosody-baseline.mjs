// scripts/prosody-baseline.mjs — the nightly voice-drift job (SPEC.md
// §4.1.10 "Prosody baseline... standing drift alarm; catches silent vendor
// drift of a 'same' model"; §9.5 "doubles as the unconsented-vendor-swap
// detector"; D6's voice axis — context/rejected.md `voice-ears`: "pitch
// numbers alone already misled once", 266 Hz anchor).
//
// SYNTHESIS NOTE (stated plainly, because it's a merge of two SPEC
// passages, not a literal quote of either): §4.1.10 itself describes TEXT
// register bands recomputed from production turns — no audio involved. The
// task brief that started this workstream asked specifically for f0/
// duration on a TTS deck, which is D6's voice axis, not §4.1.10's text axis.
// This file does BOTH, on the grounds that §9.5 explicitly says the §4.1.10
// job "doubles as the unconsented-vendor-swap detector" and the ONE thing a
// text-only register check cannot catch is exactly what sank realtime-azure
// and what `voice-ears` warns about: a TTS vendor changing the actual voice
// under an unchanged model string. Two decks, one nightly job:
//   TEXT deck  → words/turn-shaped register markers on the FIXED deck text
//                itself (proves the deck didn't drift, cheap sanity check)
//   AUDIO deck → f0 (median, autocorrelation), duration, words/sec pacing —
//                synthesized fresh every run through the SAME paid TTS lane
//                api/speech.js uses (google/gemini-3.1-flash-tts-preview,
//                voice Aoede, response_format pcm) — read-only reuse of that
//                file's documented shape, not an edit to it.
//
// COST: 5 short lines, ~15 words each, PCM output. Real OpenRouter spend —
// pennies (measured and printed on every run, never estimated silently).
//
//   node scripts/prosody-baseline.mjs             → run + compare + log
//   node scripts/prosody-baseline.mjs --establish → force this run to become
//                                                     the new baseline
//
// Log/baseline: evals/dbattery/prosody-baseline-log.json (WS-BATTERY's own
// dir — no other workstream reads or writes it). First run creates the
// baseline; every run after that compares and ALARMS on drift beyond
// tolerance. Wiring a nightly cron trigger is a `.github/workflows/*.yml`
// concern — SPEC §13 grants `.github/workflows/drift.yml` to WS-ROUTER, not
// this workstream; that file does not exist yet (checked, not assumed) —
// ticketed: point it at `node scripts/prosody-baseline.mjs` once it lands.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const LOG_PATH = join(ROOT, "evals", "dbattery", "prosody-baseline-log.json");

// ── the fixed deck (authored here, deliberately generic test lines — not
// quotes of persona.ts content, which the shape-lint/recited-prompt law
// reserves for the model's own prompt, not a diagnostic TTS deck) ──
const DECK = [
  { id: "casual-tease", text: "arey tu phir se late? sochti hu kya karu tera" },
  { id: "warm-comfort", text: "hey, sab thik hoga na, mai hu yaha, chill kar" },
  { id: "question", text: "aaj kaisa raha tera din, sab acha tha na?" },
  { id: "stretched-vowel", text: "arreee sacchi?? ye toh mast hai yaar" },
  { id: "casual-statement", text: "bas thoda busy thi aaj, ab free hu finally" },
];

// paid lane shape from api/speech.js (read-only reuse, not an edit)
const TTS_MODEL = "google/gemini-3.1-flash-tts-preview";
// HER VOICE, MIRRORED — asserted equal to api/speech.js's DEFAULT_VOICE by
// scripts/verify-voice.mjs §1, and moved by `verify-voice.mjs --set <Voice>`
// along with every other lane.
//
// It was `"Aoede"` from the day this file was written until 2026-08-24, and her
// voice moved to Autonoe on 2026-08-21. So for three days the standing
// vendor-drift alarm — the one thing in the repo whose whole job is to notice
// her voice changing under an unchanged model string — was synthesising and
// comparing a voice the product no longer used. It could not have alarmed on
// the real one, and it would not have alarmed on this either, because its
// baseline was recorded in the same wrong voice: a green check about the wrong
// bytes, which is `gates-that-live-nowhere` wearing a different hat. This site
// is now inside the one-voice fence for exactly that reason.
const TTS_VOICE = "Despina";
const SAMPLE_RATE = 24000;

async function synthesize(key, text) {
  const r = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Meera WS-BATTERY prosody" },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: `Warm 24-year-old Mumbai woman on a casual phone call with a close friend: natural Indian accent, easy Hinglish, real pacing. Say: ${text}`,
      voice: TTS_VOICE,
      response_format: "pcm",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`TTS upstream ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}

// ── f0 via autocorrelation, 16-bit PCM mono, 24 kHz — no deps ──
function pcmToInt16(buf) {
  const n = buf.length >> 1;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

function frameF0(frame, sr) {
  const n = frame.length;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += frame[i] * frame[i];
  energy /= n;
  if (energy < 1_000_000) return null; // silence/noise floor gate (16-bit PCM)

  const minLag = Math.floor(sr / 400); // 400 Hz ceiling
  const maxLag = Math.ceil(sr / 70); // 70 Hz floor
  let bestLag = -1, bestVal = 0;
  // normalized autocorrelation
  let r0 = 0;
  for (let i = 0; i < n; i++) r0 += frame[i] * frame[i];
  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += frame[i] * frame[i + lag];
    const norm = r0 > 0 ? sum / r0 : 0;
    if (norm > bestVal) {
      bestVal = norm;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestVal < 0.3) return null; // low-confidence voicing
  return sr / bestLag;
}

function analyzeAudio(pcmBuf) {
  const samples = pcmToInt16(pcmBuf);
  const durationS = samples.length / SAMPLE_RATE;
  const frameLen = Math.round(SAMPLE_RATE * 0.03); // 30ms
  const hop = Math.round(SAMPLE_RATE * 0.015); // 15ms, 50% overlap
  const f0s = [];
  for (let start = 0; start + frameLen <= samples.length; start += hop) {
    const f0 = frameF0(samples.subarray(start, start + frameLen), SAMPLE_RATE);
    if (f0) f0s.push(f0);
  }
  f0s.sort((a, b) => a - b);
  const median = f0s.length ? f0s[Math.floor(f0s.length / 2)] : null;
  return { durationS, voicedFrames: f0s.length, totalFrames: Math.floor((samples.length - frameLen) / hop) + 1, medianF0: median, byteLength: pcmBuf.length };
}

function loadLog() {
  if (!existsSync(LOG_PATH)) return { baseline: null, runs: [] };
  return JSON.parse(readFileSync(LOG_PATH, "utf8"));
}

function drift(current, baseline, tolPct) {
  if (baseline == null || current == null) return { pct: null, alarm: false };
  const pct = ((current - baseline) / baseline) * 100;
  return { pct, alarm: Math.abs(pct) > tolPct };
}

async function main() {
  const args = process.argv.slice(2);
  const establish = args.includes("--establish");

  const { OPENROUTER_KEY } = await import(join(ROOT, "api", "_config.js"));
  if (!OPENROUTER_KEY) throw new Error("OPENROUTER_KEY not configured");

  console.log(`── prosody baseline — ${DECK.length} lines, model ${TTS_MODEL}, voice ${TTS_VOICE} ──\n`);

  const perLine = [];
  let totalBytes = 0;
  for (const line of DECK) {
    const pcm = await synthesize(OPENROUTER_KEY, line.text);
    totalBytes += pcm.length;
    const a = analyzeAudio(pcm);
    const words = line.text.split(/\s+/).filter(Boolean).length;
    const wps = a.durationS > 0 ? words / a.durationS : null;
    perLine.push({ id: line.id, words, ...a, wordsPerSec: wps });
    console.log(
      `${line.id.padEnd(16)} dur=${a.durationS.toFixed(2)}s  f0(median)=${a.medianF0 ? a.medianF0.toFixed(0) + "Hz" : "n/a (no voiced frames)"}  ` +
        `voiced=${a.voicedFrames}/${a.totalFrames}  words/s=${wps ? wps.toFixed(2) : "n/a"}`,
    );
  }

  const f0s = perLine.map((l) => l.medianF0).filter((x) => x != null);
  const durations = perLine.map((l) => l.durationS);
  const paces = perLine.map((l) => l.wordsPerSec).filter((x) => x != null);
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const summary = {
    date: new Date().toISOString(),
    model: TTS_MODEL,
    voice: TTS_VOICE,
    medianF0: median(f0s),
    meanDurationS: durations.reduce((a, b) => a + b, 0) / durations.length,
    medianWordsPerSec: median(paces),
    totalBytes,
    linesWithVoicedFrames: f0s.length,
    linesTotal: DECK.length,
  };

  console.log(`\nsummary: median f0=${summary.medianF0?.toFixed(0)}Hz (anchor 266Hz, context/rejected.md voice-ears) mean dur=${summary.meanDurationS.toFixed(2)}s median pace=${summary.medianWordsPerSec?.toFixed(2)} words/s`);
  console.log(`bytes synthesized: ${totalBytes} (${(totalBytes / 1024).toFixed(0)} KB) — see cost note below\n`);

  const log = loadLog();
  if (!log.baseline || establish) {
    log.baseline = summary;
    console.log(establish ? "BASELINE ESTABLISHED (--establish forced this run).\n" : "BASELINE ESTABLISHED (first run — nothing to compare against yet).\n");
  } else {
    const F0_TOL_PCT = 8; // f0 is the axis `voice-ears` says misled once — kept tight
    const DUR_TOL_PCT = 20;
    const dF0 = drift(summary.medianF0, log.baseline.medianF0, F0_TOL_PCT);
    const dDur = drift(summary.meanDurationS, log.baseline.meanDurationS, DUR_TOL_PCT);
    console.log(`vs baseline (${log.baseline.date}, ${log.baseline.model}):`);
    console.log(`  f0: ${dF0.pct === null ? "n/a" : dF0.pct.toFixed(1) + "%"}  ${dF0.alarm ? `ALARM (>${F0_TOL_PCT}%)` : "within tolerance"}`);
    console.log(`  duration: ${dDur.pct === null ? "n/a" : dDur.pct.toFixed(1) + "%"}  ${dDur.alarm ? `ALARM (>${DUR_TOL_PCT}%)` : "within tolerance"}`);
    if (log.baseline.model !== summary.model) console.log(`  ALARM: model string itself changed (${log.baseline.model} -> ${summary.model}) — this is the "unconsented-vendor-swap" case §9.5 names directly`);
    // A VOICE CHANGE INVALIDATES THE BASELINE, and silently comparing across
    // one is worse than not comparing: the two numbers are then measurements of
    // two different women, and every drift figure printed above is noise
    // dressed as a trend. The baseline is not auto-rolled — that decision costs
    // the alarm's whole history and belongs to whoever made the switch.
    const voiceChanged = (log.baseline.voice ?? null) !== summary.voice;
    if (voiceChanged) {
      console.log(
        `  ALARM: her VOICE changed (${log.baseline.voice ?? "<unrecorded>"} -> ${summary.voice}). Every drift % above compares two different voices and means nothing. Re-run with --establish once the new voice is the intended one.`,
      );
    }
    log.lastAlarm = dF0.alarm || dDur.alarm || log.baseline.model !== summary.model || voiceChanged;
  }
  log.runs = [...(log.runs || []), summary].slice(-90); // ~3 months of nightly runs
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2) + "\n");
  console.log(`\nlogged to ${LOG_PATH.replace(ROOT + "/", "")}`);

  // cost, measured not estimated: OpenRouter TTS billing isn't in /models'
  // chat-completions pricing table (checked, absent) — report bytes/lines
  // synthesized so a real invoice can be reconciled against this run.
  console.log(`\ncost note: ${DECK.length} lines synthesized this run via the PAID OpenRouter TTS lane (never the free Gemini pool — context/measurements.md \`free-tts-daily\`: that quota is shared product infrastructure). "Pennies per night" per the task brief; reconcile against OpenRouter's dashboard for the exact figure — audio pricing was not exposed on the /models pricing table at authoring time.`);
}

await main();
