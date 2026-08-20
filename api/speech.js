// Meera voice proxy — Gemini expressive TTS, key held server-side.
// POST { text, voice?, style?, stream? } → audio.
//
// Two response shapes, one upstream:
//   stream: true  → audio/l16 PCM, 24kHz mono, chunked as it synthesises.
//                   Playback can start on the first frame. This is the call path.
//   otherwise     → a complete audio/wav file, exactly as before. The Android
//                   WebView, the backchannel prefetch and the IndexedDB clip
//                   cache all want a whole Blob and keep getting one.
//
// Upstream is the SSE lane in BOTH cases: streaming is not only earlier to its
// first frame, it is earlier to its last one too (1321ms p50 complete against
// 2064ms for the same model non-streamed, n=10/6), so the buffered callers get
// a free speedup out of it.

import { allow, ipOf } from "./_ratelimit.js";
import { withGeminiKey, isQuota, isTransient, poolSize, poolHealth } from "./_gkeys.js";

import { OPENROUTER_KEY } from "./_config.js";

// ── WHERE TEXT STOPS BEING TEXT ─────────────────────────────────────────
// The owner's report was "saying Dash dash in voice call". Nothing in this
// repo ever separated what she WRITES from what she SAYS: the same string is
// displayed in the chat and handed to a synthesiser, so every writing
// convention in it — em-dashes, markdown, bullets, brackets, arrows, emoji,
// URL protocols — was being read out loud.
//
// This is that seam, and it is deliberately HERE rather than in each client:
// three different callers reach this endpoint (speech.ts's streaming and
// complete-file paths, VoiceNote.tsx, and liveCall.ts's backchannel prewarm)
// and only one of them strips anything today. A server-side seam covers all
// three and covers every future one by construction. It also cannot be
// skipped by an old APK that has not updated.
//
// The rules and their per-class reasoning live in src/voice/spokenText.ts.
// The block below is MIRRORED FROM IT VERBATIM — a Vercel function cannot
// import TypeScript (see scripts/build-engine-bundle.mjs's header) — and
// `node scripts/verify-voice.mjs` compares the two regions character for
// character on every release, so they cannot drift.
//
// ORDERING, which this depends on and which was verified rather than assumed:
// media/protocol tags are parsed and ACTED ON upstream (brain.ts `parseReply`
// lifts [tone:]/[voicenote:]/[forget:] out and performs the delete; speech.ts
// strips the residue) BEFORE anything is POSTed here. That is what licenses
// rule B to drop a surviving bracket segment whole.

/* ─── SPOKEN-TEXT CORE — MIRRORED VERBATIM INTO api/speech.js ───────────────
   Do not edit one copy. `node scripts/verify-voice.mjs` compares the two
   regions character for character and fails when they differ. A Vercel
   function cannot import TypeScript (see scripts/build-engine-bundle.mjs's
   header for the same constraint), and this is small enough that mirroring it
   beats generating it — the house pattern is MIRROR, then assert. */
const SPOKEN_RULES_VERSION = "st1";

function spokenTextCore(input = "") {
  if (typeof input !== "string" || !input) return "";
  let t = input;

  // A. INVISIBLES AND ENTITIES — normalised.
  // Zero-width joiners and soft hyphens are invisible on screen and are read by
  // some engines as a break mid-word; non-breaking spaces are just spaces.
  t = t.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "");
  t = t.replace(/[\u00A0\u2007\u202F]/g, " ");
  // Decoded to the CHARACTER, never to a word: "&" is spoken "and" by every
  // engine on its own, and putting the word there ourselves would be text she
  // never wrote.
  t = t
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;|&gt;/gi, " ");

  // B. PROTOCOL SEGMENTS — the whole segment DROPPED, brackets and contents.
  // Justified only by the ordering above: every bracket that carried meaning
  // has already been parsed and acted on, so what is left is a leaked marker or
  // a stage direction, and `ack-bracket-direction` measured what happens to
  // those — they are performed as words. <…> is this app's own machine framing
  // (liveCall.ts `direct()` sends "<context: …>"); {…} is template residue.
  // Bounded lengths so a stray opener cannot swallow a whole reply.
  t = t.replace(/<[^<>\n]{0,200}>/g, " ");
  t = t.replace(/\{[^{}\n]{0,200}\}/g, " ");
  t = t.replace(/\[[^\][\n]{0,200}\]/g, " ");
  // An UNCLOSED tag at the very end is the truncation case brain.ts already
  // guards for its own path; a synthesiser hands back "bracket laughs".
  t = t.replace(/\[[^\][\n]{0,40}$/, " ");

  // C. URLs — the PROTOCOL removed, the address KEPT.
  // Not dropped, and this is a safety decision rather than a stylistic one. The
  // crisis-helpline block this repo protects with an invariant suite can carry
  // an address, and on a call the spoken copy is the ONLY copy — deleting it
  // would delete the helpline. "aasra.info" is said fine by every engine;
  // "h-t-t-p-s colon slash slash" is what actually had to go.
  t = t.replace(/\bhttps?:\/\/(?:www\.)?/gi, " ").replace(/\bwww\./gi, " ");

  // D. LINE STRUCTURE — the MARKER removed, the ITEM kept, joined as a list.
  // Runs BEFORE the dash rule on purpose: a line-leading "- " is a bullet, not
  // a dash, and treating it as one would put a comma in front of every item.
  t = t.replace(/^[ \t]*([-*_=\u2014\u2013]{3,})[ \t]*$/gm, " ");
  t = t.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  t = t.replace(/^[ \t]*>[ \t]?/gm, "");
  t = t.replace(/^[ \t]*(?:[-*+\u2022\u00B7\u25AA\u2023\u25E6][ \t]+|\d{1,2}[.)][ \t]+)/gm, "");
  t = t.replace(/[\u2022\u00B7\u25AA\u2023\u25E6]/g, ", ");

  // E. MARKDOWN EMPHASIS — the MARKERS removed, the WORDS kept.
  // Not the same class as a stage direction: "*shrugs*" is an action the
  // caller's stripProtocol already dropped, but "**sach**" is emphasis on a
  // real word and deleting the word loses what she said. The opener has to sit
  // on a boundary so `snake_case` is not mistaken for emphasis.
  t = t.replace(/`{1,3}/g, " ");
  t = t.replace(/(^|[\s(,.!?;:"'])(\*\*|__)(?=\S)([\s\S]*?\S)\2/g, "$1$3");
  t = t.replace(/(^|[\s(,.!?;:"'])([*_])(?=\S)([^*_\n]*?\S)\2(?![\w])/g, "$1$3");
  // Anything still standing is not a word: an asterisk is a spoken asterisk.
  // An underscore is only removed at a word EDGE, where it is leftover markup —
  // one BETWEEN two word characters is part of an address or a name
  // ("priya_sharma@gmail.com") and "underscore" is exactly what a person says
  // for it, so removing it there would break the thing it is holding together.
  t = t.replace(/\*+/g, " ").replace(/(?<!\w)_+|_+(?!\w)/g, " ");

  // F. DASHES — REPLACED with the spoken equivalent, which is a PAUSE.
  // This is the reported bug, and the reason it is a replace and not a delete:
  // an em-dash between clauses is how she was told to cut herself off, so it
  // carries real timing. Delete it and two clauses run together breathlessly;
  // keep it and the engine says "dash". A comma is the pause token every
  // synthesiser here already honours.
  //
  // THE TRAP, and where the line is drawn. A hyphen INSIDE a word is a
  // spelling, not a dash: "well-known", "e-mail", "T-shirt", "1800-599-0019".
  // Those are never touched. Only a dash that is punctuation gets replaced —
  // the true dash characters, a doubled ASCII hyphen, or a single hyphen with
  // whitespace on both sides.
  t = t.replace(/\s*[\u2012-\u2015]+\s*$/g, "");
  t = t.replace(/[\u2012-\u2015]+/g, ", ");
  t = t.replace(/\s*-{2,}\s*/g, ", ");
  t = t.replace(/ +- +/g, ", ");
  t = t.replace(/[ ,]*-+\s*$/g, "");

  // G. ARROWS — REPLACED with a pause, never with a word.
  // "→" most often means "then" or "to", but which one is a guess, and putting
  // a word she did not write into her mouth is the thing this repo calls
  // fabrication. A pause keeps the sentence intact and invents nothing.
  t = t.replace(/[\u2190-\u21FF\u27F0-\u27FF\u2B00-\u2B11]+/g, ", ");
  t = t.replace(/(^|\s)(?:->|<-|=>|<=>|<->)(\s|$)/g, ", ");
  // A pipe is the same class — a separator that some engines announce as
  // "vertical bar". It never carries meaning she said out loud.
  t = t.replace(/\s*\|+\s*/g, ", ");

  // H. PARENTHESES — the WORDS kept, the brackets become pauses.
  // Different from rule B and deliberately so: a parenthetical is an aside a
  // person actually says out loud, so dropping the segment would drop real
  // speech. Only the punctuation is a writing convention.
  t = t.replace(/\s*[([]\s*/g, ", ").replace(/\s*[)\]]\s*/g, ", ");

  // I. EMOJI AND PICTOGRAPHS — DROPPED.
  // Engines disagree: some skip them, some announce the Unicode name aloud
  // ("face with tears of joy"). There is no spoken equivalent to substitute,
  // and her laughter is already written out as "hahaha" by her brief, so
  // nothing is lost by removing them.
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}\u{FE0F}\u{20E3}\u{2764}\u{2049}\u{203C}]/gu,
    " ",
  );

  // J. ELLIPSES — KEPT, only absurd runs capped.
  // NOT a writing convention here: "..." is load-bearing prosody in this
  // product. persona.ts uses it as her softness and speech.ts turns it into an
  // explicit thinking pause, and `stripTagsForPlainVoice` deliberately POSTs
  // "…" to this very endpoint in place of a tag. Removing it would flatten her.
  t = t.replace(/\.{4,}/g, "…").replace(/…{2,}/g, "…");

  // K. TIDY. Collapsing the debris the rules above leave behind — doubled
  // separators, a comma before a full stop, a phrase that now starts on
  // punctuation.
  t = t.replace(/[ \t]*\n[ \t]*/g, ", ");
  t = t.replace(/\s+/g, " ");
  t = t.replace(/\s+([,.;:!?…])/g, "$1");
  t = t.replace(/([,;:])(?:\s*[,;:])+/g, "$1");
  t = t.replace(/([,;:])\s*(?=[.!?…])/g, "");
  t = t.replace(/^[\s,;:.!?…]+/, "");
  t = t.replace(/[ ,;:]+$/, "");
  t = t.trim();

  // L. NOTHING SPEAKABLE LEFT. A reply that was only a tag, only emoji or only
  // a separator must produce SILENCE, not a synthesiser reading punctuation.
  // The caller is expected to refuse rather than send this upstream.
  if (!/[\p{L}\p{N}]/u.test(t)) return "";
  return t;
}
/* ─── END SPOKEN-TEXT CORE ─────────────────────────────────────────────── */

const MODEL = "google/gemini-3.1-flash-tts-preview";
// The free lane runs the same model directly. 2.5 was here briefly and cannot
// stream: it answers a streaming request with HTTP 200 and ONE frame holding
// the whole file, so streaming looks unsupported at the API level when it is
// unsupported at the MODEL level. That is why this was missed for a round.
const FREE_MODEL = "gemini-3.1-flash-tts-preview";
// HER VOICE, EVERYWHERE. This is Aoede because the two lanes that cannot
// choose — the Gemini Live call and the native live watch engine — both speak
// Aoede and there is no setting that changes them. Every lane that CAN choose
// therefore has to match, or she changes voice mid-conversation.
//
// She did. This default was Leda, so a call that started live (Aoede) and fell
// back to the cascade (Leda) swapped her for a different woman mid-sentence,
// and screen share — where the live→cascade handoff is most likely — was where
// it was heard: "two or three different voices", reported as multiple
// personalities. Both lanes were working exactly as designed; they just
// disagreed about who she was.
//
// To move her voice, move it HERE and in the two live speechConfigs together —
// liveCall.ts and LiveWatchEngine.java — or this comes straight back.
const DEFAULT_VOICE = "Aoede";
const ALLOWED_VOICES = new Set(["Leda", "Kore", "Aoede", "Zephyr"]);
const SAMPLE_RATE = 24000;

// Bytes of PCM that prove a response is real audio rather than the empty-200
// failure this proxy has been bitten by twice.
//
// THIS NUMBER IS DELIBERATELY SHARED between the flush gate and the "this key
// is spent" test, and the sharing is the safety property: a key that produced
// less than this never flushed a byte to the client, so `withGeminiKey`
// retrying onto a second key can never splice two different renderings of the
// same phrase together. Change one, change the other, or that stops being true.
const FLUSH_MIN = 1000;

// The free lane clears the flush gate at 722ms p90 (n=10). A lane that has
// produced nothing by this point is not slow, it is broken — and waiting for
// it serially is how a 20180ms worst case got measured in a run of 8. So the
// paid lane starts ALONGSIDE rather than after, and the first lane to clear
// the gate owns the response. Cost stays the tiebreak, not the driver: the
// free lane beat this on every measured sample, so the paid call is not
// actually made in the healthy case.
const PAID_ARM_MS = 1500;

// How long one free key may produce NOTHING before the next one is tried.
// Healthy keys clear their first frame at 615-1051 ms (measured across the live
// pool, 6 of 9 keys), so this is generous to a slow-but-working key while
// bounding a sick one — the 503 that took 6518 ms cost the whole free lane.
const FREE_FIRST_FRAME_MS = 1400;

function wavHeader(pcmBytes) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcmBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); // fmt chunk size
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  h.writeUInt16LE(2, 32); // block align
  h.writeUInt16LE(16, 34); // bits per sample
  h.write("data", 36);
  h.writeUInt32LE(pcmBytes, 40);
  return h;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // the native app is cross-origin: without this it pays a preflight RTT on
  // EVERY speech request — pure added latency on the hottest path
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "speech", 60)) return res.status(429).json({ error: "slow down" });

  const key = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
  if (!key) return res.status(500).json({ error: "no key configured" });

  // declared out here so the catch can tell "nothing sent yet" (safe to reply
  // with an error status) from "already streaming" (all we can do is end)
  let committed = false;

  try {
    const { text, voice, style, stream } = req.body || {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text required" });
    }
    // THE SEAM. Past this line nothing may read `text` again — `spoken` is the
    // only string that reaches a synthesiser, and the caller's own copy (the
    // one on screen) is untouched because it never left the caller.
    const spoken = spokenTextCore(text);
    // A request whose whole content was a tag, an emoji or a separator has
    // nothing to say. Refusing is the correct answer: synthesising the residue
    // is how a voice note once read out the word "softly", and billing a
    // generation for punctuation is pure waste. 422 rather than 400 so a caller
    // can tell "you sent nothing" from "there was nothing speakable in what you
    // sent" — the clients treat any non-2xx as "no clip", so neither is fatal.
    if (!spoken) return res.status(422).json({ error: "nothing speakable in text" });
    const wantStream = stream === true;
    const voiceName = ALLOWED_VOICES.has(voice) ? voice : DEFAULT_VOICE;
    // per-utterance delivery mood, improvised by her brain from the actual
    // conversation ("low and comforting", "teasing, mock-offended", …)
    const mood =
      typeof style === "string" && style.trim()
        ? style.replace(/[\[\]{}<>\n\r"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
        : "relaxed, natural, casual";

    /* ── the response body, and who owns it ──────────────────────────────
       Both lanes may be in flight at once (see PAID_ARM_MS). Each accumulates
       into its OWN buffer until it clears FLUSH_MIN; the first to clear it
       becomes `winner` and the other's audio is dropped on the floor. Audio
       from two lanes can therefore never end up concatenated — that would be
       two different renderings of the same sentence spliced mid-word. ── */
    const lanes = { free: { held: [], bytes: 0 }, paid: { held: [], bytes: 0 } };
    let winner = null;

    const sink = (lane, buf) => {
      if (winner && winner !== lane) return false; // the other lane owns the body
      const L = lanes[lane];
      L.held.push(buf);
      L.bytes += buf.length;
      if (L.bytes < FLUSH_MIN) return true; // not yet proven to be real audio
      winner = lane;
      if (!wantStream) return true; // assembled into a WAV at the end
      if (!committed) {
        committed = true;
        res.writeHead(200, {
          "Content-Type": "audio/l16; rate=24000; channels=1",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          // WHICH LANE SPOKE, and how much of the free pool was usable when it
          // did. Without this a slow first byte is unattributable from outside:
          // a cold function, a slow free key and a fall-through to the paid arm
          // all look identical, and the first production battery had a p50 of
          // 1000ms against a p90 of 2427ms with no way to tell which. Two
          // header writes, no extra work on the request path.
          "X-Meera-Lane": lane,
          "X-Meera-Pool": poolHealth(),
          // WHICH MODEL AND WHICH VOICE ACTUALLY SPOKE. `verify-voice.mjs`
          // proves the four lanes agree on her voice NAME; it cannot prove
          // they sound alike, because the same name on a different model is a
          // different voice, and this lane and the live call lane run
          // different models by design (docs/VOICE-LANE.md). Until somebody
          // measures that, a production sample must at least be able to SAY
          // what produced it — an unattributable timbre complaint is exactly
          // how the Leda/Aoede incident stayed open. Two more header writes,
          // no extra work on the request path.
          "X-Meera-Model": lane === "free" ? FREE_MODEL : MODEL,
          "X-Meera-Voice": voiceName,
          "X-Meera-Rules": SPOKEN_RULES_VERSION,
          "Access-Control-Expose-Headers":
            "X-Meera-Lane, X-Meera-Pool, X-Meera-Model, X-Meera-Voice, X-Meera-Rules",
        });
      }
      for (const h of L.held) res.write(h);
      L.held.length = 0;
      return true;
    };

    const freeAbort = new AbortController();
    const paidAbort = new AbortController();

    /* ── free lane: Google direct, SSE, streamed frame by frame ──
       Frames are uniform 1920 bytes = exactly 40ms of L16/24kHz mono, which is
       byte-identical to what this proxy has always wrapped in a WAV header.
       Generation runs 1.6–2.2x realtime, so after the first frame delivery
       never falls behind playback. ── */
    const streamFree = async () => {
      if (!poolSize()) return false;
      const got = await withGeminiKey(async (k) => {
        // EACH KEY ATTEMPT STARTS ITS OWN ACCUMULATOR. Without this, a key that
        // emitted 512 bytes and died would leave them in the buffer, and the
        // next key's 512 would carry the pair over the 1000-byte gate — two
        // renderings of the same sentence spliced mid-word, which is the exact
        // thing the shared threshold exists to make impossible. A committed
        // attempt never retries, so this only ever discards sub-gate bytes.
        if (winner !== "free") {
          lanes.free.held.length = 0;
          lanes.free.bytes = 0;
        }
        // A BOUNDED ATTEMPT. Aborts if the outer lane gives up, OR if this key
        // has produced no audio by FREE_FIRST_FRAME_MS — measured, one sick key
        // took 6518 ms to return its 503, which is four times the paid arm and
        // was being paid in full before the free lane even looked at key two.
        // Cleared on the first frame, so a key that is merely mid-sentence is
        // never cut off.
        const attempt = new AbortController();
        const giveUp = () => attempt.abort();
        freeAbort.signal.addEventListener("abort", giveUp, { once: true });
        let deadline = setTimeout(giveUp, FREE_FIRST_FRAME_MS);
        const armed = () => {
          clearTimeout(deadline);
          deadline = null;
        };
        try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${FREE_MODEL}:streamGenerateContent?alt=sse`,
          {
            method: "POST",
            headers: { "x-goog-api-key": k, "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `Say in a warm, natural Indian-accented Hinglish, ${mood}: ${spoken.slice(0, 1100)}`,
                    },
                  ],
                },
              ],
              generationConfig: {
                responseModalities: ["AUDIO"],
                // her voice, not a hardcoded one — this lane used to ignore the
                // `voice` argument it validates above, so which voice she had
                // depended on which key had quota and could flip between the
                // phrases of one sentence
                speechConfig: {
                  voiceConfig: { prebuiltVoiceConfig: { voiceName } },
                },
              },
            }),
            signal: attempt.signal,
          },
        );
        if (!r.ok) {
          if (isQuota(r.status)) return { ok: false, exhausted: true };
          // sick server, not a spent key — the next key is very likely fine
          if (isTransient(r.status)) return { ok: false, retry: true, error: `tts ${r.status}` };
          return { ok: false, error: `tts ${r.status}` };
        }

        const dec = new TextDecoder();
        let buf = "";
        let wrote = 0;
        try {
          for await (const c of r.body) {
            buf += dec.decode(c, { stream: true });
            let i;
            while ((i = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, i).trim();
              buf = buf.slice(i + 1);
              if (!line.startsWith("data:")) continue;
              let d;
              try {
                d = JSON.parse(line.slice(5))?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
              } catch {
                continue; // not a frame we can use; the next line may be
              }
              if (!d?.data) continue;
              const b = Buffer.from(d.data, "base64");
              armed(); // real audio is flowing — the deadline has done its job
              wrote += b.length;
              if (!sink("free", b)) {
                // the paid lane cleared the gate first — stop generating
                freeAbort.abort();
                return { ok: false, error: "lost the race" };
              }
            }
          }
        } catch (e) {
          // Upstream died mid-stream. Past the gate we have already committed
          // this rendering, so a retry onto another key would splice; end with
          // what we have and let the client's own fallback cover a short clip.
          if (wrote >= FLUSH_MIN) return { ok: true, value: wrote };
          throw e; // nothing flushed — withGeminiKey treats a throw as a free retry
        }
        // a 200 with no audio is the silent failure — treat it as a spent key
        // so the next one, and then the paid lane, still get their turn
        if (wrote < FLUSH_MIN) return { ok: false, exhausted: true };
        return { ok: true, value: wrote };
        } catch (e) {
          // The outer lane gave up — the paid lane already owns the body, or the
          // response is over. Burning another key on it would be pure waste.
          if (freeAbort.signal.aborted) return { ok: false, error: "lost the race" };
          // Our own deadline fired: this key produced nothing in time. That is
          // exactly the case another key should get, so ask for one.
          if (attempt.signal.aborted) return { ok: false, retry: true, error: "slow" };
          throw e;
        } finally {
          clearTimeout(deadline);
          freeAbort.signal.removeEventListener("abort", giveUp);
        }
      });
      return Boolean(got.value);
    };

    /* ── paid lane: OpenRouter, complete file, unchanged behaviour ── */
    const generate = async () => {
      const upstream = await fetch("https://openrouter.ai/api/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "X-Title": "Meera",
        },
        body: JSON.stringify({
          model: MODEL,
          // Gemini TTS takes natural-language delivery direction in the input.
          // Kept SHORT — direction length adds real latency (~0.6s measured
          // between a full paragraph and none). Identity constant; the mood
          // comes from the conversation so delivery follows the call's flow.
          input: `Warm 24-year-old Mumbai woman on a casual phone call with a close friend: natural Indian accent, easy Hinglish, real pacing, never performative, no laughs unless the words are laughter. Mood: ${mood}. Say: ${spoken.slice(0, 1100)}`,
          voice: voiceName,
          response_format: "pcm",
        }),
        signal: paidAbort.signal,
      });
      if (!upstream.ok) return null;
      return Buffer.from(await upstream.arrayBuffer());
    };

    // upstream occasionally returns an empty 200. A serial retry doubled
    // worst-case latency on the path the user waits on in silence — instead,
    // if the primary is slow a second request races it and the first non-empty
    // result wins.
    const racePaid = () =>
      new Promise((resolve) => {
        let settled = false;
        let pending = 0;
        let hedged = false;
        const settle = (buf) => {
          if (settled) return;
          pending--;
          if (buf && buf.length >= FLUSH_MIN) {
            settled = true;
            clearTimeout(hedgeT);
            resolve(buf);
          } else if (!hedged) {
            launchHedge(); // fast empty/fail — retry immediately
          } else if (pending <= 0) {
            settled = true;
            resolve(null);
          }
        };
        const launchHedge = () => {
          if (settled || hedged) return;
          hedged = true;
          pending++;
          generate().then(settle, () => settle(null));
        };
        pending++;
        generate().then(settle, () => settle(null));
        // synthesis time scales with text length — a flat trigger would fire
        // the hedge on every long voice note (pure double cost, no win)
        const hedgeT = setTimeout(launchHedge, Math.min(4000, 900 + spoken.length * 15));
      });

    // The response is finished when the lane that OWNS the body is finished.
    // Waiting on the loser too would hold a streamed reply open long after all
    // its audio had arrived — the client's reader would block, and the phrase
    // queued behind it would not start. So the winner ends the response and the
    // loser is aborted rather than awaited.
    let finish;
    const finished = new Promise((r) => (finish = r));
    const ownerDone = (lane) => {
      if (winner !== lane) return;
      (lane === "free" ? paidAbort : freeAbort).abort();
      finish();
    };

    let paidPromise = null;
    const startPaid = () => {
      if (!paidPromise && !winner) {
        paidPromise = racePaid()
          .then((pcm) => (pcm ? sink("paid", pcm) : false))
          .catch(() => false)
          .then((ok) => {
            ownerDone("paid");
            return ok;
          });
      }
      return paidPromise;
    };

    // FREE TIER FIRST, and this lane needs it more than the others: if the paid
    // account is empty she has NO VOICE AT ALL, which happened once already.
    const freeDone = streamFree()
      .catch(() => false)
      .then((ok) => {
        ownerDone("free");
        return ok;
      });
    const arm = setTimeout(startPaid, PAID_ARM_MS);

    // the fallback chain, for when the free lane produces nothing at all
    const chain = (async () => {
      await freeDone;
      clearTimeout(arm);
      if (winner === "free") return;
      startPaid();
      await paidPromise;
    })().catch(() => {});

    await Promise.race([finished, chain]);
    clearTimeout(arm);
    // nothing further can reach the body — stop any generation still billing
    freeAbort.abort();
    paidAbort.abort();

    if (!winner) {
      if (committed) return res.end(); // unreachable: committing sets a winner
      return res.status(502).json({ error: "upstream empty" });
    }
    if (wantStream) return res.end();

    const pcm = Buffer.concat(lanes[winner].held);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Meera-Lane", winner); // same attribution on the buffered path
    res.setHeader("X-Meera-Pool", poolHealth());
    res.setHeader("X-Meera-Model", winner === "free" ? FREE_MODEL : MODEL);
    res.setHeader("X-Meera-Voice", voiceName);
    res.setHeader("X-Meera-Rules", SPOKEN_RULES_VERSION);
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Meera-Lane, X-Meera-Pool, X-Meera-Model, X-Meera-Voice, X-Meera-Rules",
    );
    return res.status(200).send(Buffer.concat([wavHeader(pcm.length), pcm]));
  } catch (e) {
    // once bytes are on the wire the status line is spent — all that is left
    // is to end the body and let the client fall back
    if (committed) return res.end();
    return res.status(500).json({ error: "speech failure" });
  }
}
