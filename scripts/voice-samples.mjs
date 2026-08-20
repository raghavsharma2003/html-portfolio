// scripts/voice-samples.mjs — WS-VOICES: 5-6 candidate Gemini TTS voices,
// same Hinglish deck, one WAV per voice, for the owner to A/B by ear.
//
// Owner's ask verbatim: "gimme 5-6 version of her voice not just my tweaking
// her voice i want a completely new voices, cute morden voice needed."
//
// WHY THE PAID OPENROUTER LANE, NOT THE FREE GOOGLE POOL:
// context/measurements.md `free-tts-daily` — all 9 free Google keys 429'd
// TOGETHER after "a few dozen" calls, and that quota is SHARED WITH
// PRODUCTION (api/speech.js's free lane). A voice-shopping run is exactly the
// kind of burst that measurement warns about, and there is zero reason to
// risk her actual voice going silent for a comparison reel. This mirrors the
// precedent already set by scripts/prosody-baseline.mjs, which made the same
// call for the same reason ("never the free Gemini pool"). Real money, a few
// cents — see the cost note printed at the end.
//
// WHY ONE CALL PER VOICE: 6 voices synthesized individually per line would be
// 30-36 calls. Gemini TTS takes the whole deck as one input and produces one
// continuous utterance, so the deck is joined into ONE string per voice —
// 6 calls total, not 30+. Exact count is printed BEFORE any call is made.
//
// WHAT THIS SCRIPT DOES NOT TOUCH: api/speech.js, src/voice/liveCall.ts,
// ALLOWED_VOICES, DEFAULT_VOICE. This is a standalone sampler. Nothing here
// changes what the app actually plays. Read-only reuse of the paid-lane shape
// (model string, input framing, response_format) from api/speech.js and
// scripts/prosody-baseline.mjs, not an edit to either.
//
//   node scripts/voice-samples.mjs
//
// Output: <scratchpad>/voices/voice-A.wav … voice-F.wav (or fewer, if the
// pool dies partway — see the 429 handling below).

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT_DIR =
  process.env.VOICE_SAMPLES_OUT ||
  "/tmp/claude-0/-home-user-html-portfolio/1ba94af4-9738-526a-a464-53a4a3882724/scratchpad/voices";

// ── paid-lane shape, read-only reuse from api/speech.js / prosody-baseline.mjs ──
const TTS_MODEL = "google/gemini-3.1-flash-tts-preview";
const SAMPLE_RATE = 24000;

// ── the candidate list ──────────────────────────────────────────────────
// Source: Gemini API docs (ai.google.dev/gemini-api/docs/speech-generation)
// for the 30-voice roster + style descriptors, cross-checked against Google
// Cloud's Gemini-TTS voice table (docs.cloud.google.com/text-to-speech/docs/
// gemini-tts) for gender, since the AI Studio page doesn't label it. The
// prebuilt voice set is shared across the Gemini TTS model family (2.5 and
// 3.1 preview alike use the same `prebuiltVoiceConfig.voiceName` enum) — not
// separately confirmed for 3.1-flash-tts-preview by name, so an unexpected
// per-voice rejection from THIS model is itself a finding, not a bug in this
// script.
//
// AOEDE IS THE INCUMBENT — her shipped voice today (api/speech.js
// DEFAULT_VOICE), included unlabelled as the fair A/B reference, per the
// brief. The other five are picked to plausibly read as a young, warm,
// modern, casual Indian woman ~24, and deliberately exclude Leda/Kore/Zephyr
// — those are already selectable in ALLOWED_VOICES today, so they are not
// "a completely new voice" to the owner even though they're in the same
// family.
const VOICES = [
  { name: "Sulafat", gender: "female", style: "Warm", note: "documented as the warmest-styled voice in the set" },
  { name: "Aoede", gender: "female", style: "Breezy", note: "INCUMBENT — her current shipped voice, unlabelled reference" },
  { name: "Autonoe", gender: "female", style: "Bright", note: "energetic, modern-reading" },
  { name: "Achernar", gender: "female", style: "Soft", note: "gentler, quieter register" },
  { name: "Callirrhoe", gender: "female", style: "Easy-going", note: "documented as suited to friendly/amused delivery — good for teasing" },
  { name: "Laomedeia", gender: "female", style: "Upbeat", note: "lively, younger-reading" },
];

// Anonymized, and deliberately NOT in the same order as VOICES above, so
// skimming the file top-to-bottom doesn't hand the mapping away for free.
const LETTERS = ["C", "A", "E", "F", "B", "D"];

// ── the deck: same 5 lines for every voice, her actual register ───────────
// Authored fresh here (not copied from persona.ts's own examples — those are
// reserved for her prompt, and reciting them elsewhere is the exact
// phrase-bank failure context/rejected.md `recited-prompt` documents), but
// built from the same vocabulary and shapes persona.ts describes: roman
// Hindi shortforms, stretched vowels, "hahaha" written as the laugh, no
// bracketed stage directions (context/rejected.md `ack-bracket-direction` —
// a bracket in a TTS payload gets performed as words, not obeyed).
const DECK = [
  { id: "greeting", text: "heyyy kya kar rha hai, mai abhi free hui yaar" },
  { id: "tease", text: "arre tu phir se late? sochti hu kya karu tera hahaha" },
  { id: "warm", text: "hey sab thik hoga na, mai hu na yaha, chill kar thoda" },
  { id: "tired", text: "uff aaj itna busy tha, bas ab so jana hai yaar" },
  { id: "code-switch", text: "wait tumne wo bug fix kiya ya still deploy pending hai?" },
];

const FULL_TEXT = DECK.map((l) => l.text).join(". ") + ".";

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

async function synthesize(key, voiceName) {
  const r = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Meera WS-VOICES sampler" },
    body: JSON.stringify({
      model: TTS_MODEL,
      // same framing as api/speech.js's paid lane, mood held CONSTANT across
      // every voice so voice identity is the only variable in the deck
      input: `Warm 24-year-old Mumbai woman on a casual phone call with a close friend: natural Indian accent, easy Hinglish, real pacing, never performative, no laughs unless the words are laughter. Mood: relaxed, natural, casual. Say: ${FULL_TEXT}`,
      voice: voiceName,
      response_format: "pcm",
    }),
    signal: AbortSignal.timeout(45_000),
  });
  return r;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main() {
  const { OPENROUTER_KEY } = await import(join(ROOT, "api", "_config.js"));
  const key = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
  if (!key) throw new Error("no OpenRouter key configured");

  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`── voice sampler ── ${VOICES.length} voices x 1 batched call each = ${VOICES.length} API calls total, model ${TTS_MODEL} ──`);
  console.log(`deck: ${DECK.length} lines (${FULL_TEXT.split(/\s+/).length} words), same text for every voice`);
  console.log(`lane: paid OpenRouter TTS — deliberately NOT the free Google pool (context/measurements.md \`free-tts-daily\`: that quota is shared with production)\n`);

  const results = [];
  for (let i = 0; i < VOICES.length; i++) {
    const v = VOICES[i];
    const letter = LETTERS[i];
    process.stdout.write(`[${i + 1}/${VOICES.length}] voice-${letter}.wav <- ${v.name} ... `);
    let r;
    try {
      r = await synthesize(key, v.name);
    } catch (e) {
      console.log(`FAILED (network/timeout: ${e.message})`);
      results.push({ letter, voice: v.name, ok: false, error: e.message });
      continue;
    }
    if (r.status === 429 || r.status === 403) {
      const body = await r.text().catch(() => "");
      console.log(`STOPPING — ${r.status} (quota) on this call. Not hammering a dead key.`);
      results.push({ letter, voice: v.name, ok: false, error: `${r.status} ${body.slice(0, 200)}` });
      break; // error-marked-done: a quota failure here means every later call fails too
    }
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.log(`FAILED (${r.status}): ${body.slice(0, 200)}`);
      results.push({ letter, voice: v.name, ok: false, error: `${r.status} ${body.slice(0, 200)}` });
      continue; // not a quota failure — this voice specifically may be rejected; try the next
    }
    const pcm = Buffer.from(await r.arrayBuffer());
    if (pcm.length < 1000) {
      console.log(`FAILED (empty/near-empty response, ${pcm.length} bytes)`);
      results.push({ letter, voice: v.name, ok: false, error: `only ${pcm.length} bytes` });
      continue;
    }
    const wav = Buffer.concat([wavHeader(pcm.length), pcm]);
    const outPath = join(OUT_DIR, `voice-${letter}.wav`);
    writeFileSync(outPath, wav);
    const seconds = pcm.length / 2 / SAMPLE_RATE;
    console.log(`ok — ${(wav.length / 1024).toFixed(0)} KB, ${seconds.toFixed(1)}s -> ${outPath}`);
    results.push({ letter, voice: v.name, ok: true, bytes: wav.length, seconds, path: outPath });
    if (i < VOICES.length - 1) await sleep(1500); // pace the calls, don't hammer
  }

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n── done: ${ok.length}/${VOICES.length} voices produced, ${failed.length} failed/missing ──`);
  if (failed.length) {
    console.log("missing:");
    for (const f of failed) console.log(`  voice-${f.letter} (${f.voice}): ${f.error}`);
  }
  console.log(`\ncost note: ${ok.length} synthesis call(s) against the PAID OpenRouter lane, ~${(ok.reduce((a, r) => a + (r.seconds || 0), 0)).toFixed(0)}s of audio total. Real spend, expected to be a few cents — reconcile against the OpenRouter dashboard for the exact figure (audio pricing was not on the /models pricing table at authoring time, same caveat scripts/prosody-baseline.mjs already notes).`);

  writeFileSync(
    join(OUT_DIR, "_manifest.json"),
    JSON.stringify({ model: TTS_MODEL, deck: DECK, results, generatedAt: new Date().toISOString() }, null, 2) + "\n",
  );
}

await main();
