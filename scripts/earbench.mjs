#!/usr/bin/env node
// earbench — the blind listening bench for cloned voices.
//
//   node scripts/earbench.mjs stimuli        # build a blinded stimulus set
//   node scripts/earbench.mjs listen         # sit and listen, locally
//   node scripts/earbench.mjs score          # score the answers against the key
//   node scripts/earbench.mjs verify-trim    # hear ONLY the removed prefixes
//   node scripts/earbench.mjs selftest       # prove the mechanism, no network
//
// ── what this is ──────────────────────────────────────────────────────────
// `context/decisions.md` makes the ECAPA cosine number a REGRESSION MONITOR and
// a floor, and puts activation quality behind a blind owner-calibration pass,
// because `rejected.md#azure-tts` is the case where every measured axis said
// switch and the owner's ear said no. The project has the number (0.7753
// against a 0.8869 ceiling for the owner's own voice) and has never had the
// pass. This is the instrument for the pass.
//
// ── what it refuses to do ─────────────────────────────────────────────────
// Produce a result. It builds stimuli, runs a blind protocol and scores an
// answer sheet. With no answer sheet it reports "no human has listened", which
// is the true state of this bench until somebody sits down with headphones.
// `selftest` drives every mechanism end to end with locally generated tones and
// a simulated listener; its output is stamped SELF-TEST in the key, in the
// manifest and in every printed report, because a self-test that could be
// quoted as a bench result is worse than no self-test.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EARBENCH_VERSION, DEFAULT_POLICY, RATING_AXES,
  blindId, buildAbxTrials, buildRatingTrials, listenerView, counterbalanceReport,
  seedFrom, rng, shuffle, scoreBench, renderReport,
} from "../evals/earbench/lib.mjs";
import {
  SAMPLE_RATE, wavPcm, wrapWav, treat, toPcm, sha256,
  transcriptCarriesDisclosure,
} from "../evals/earbench/audio.mjs";
import { serveBench } from "../evals/earbench/server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BENCH_ROOT = process.env.EARBENCH_HOME || join(ROOT, "earbench-out");

// The consented reference this bench was commissioned against. 71.0 s, 24 kHz
// mono PCM16, the owner's own voice, in the private replica bucket. Read
// through `api/_replica-storage.js` — the module that already owns the bucket
// name, the service-role credential and the path validation — rather than a
// hand-built URL, so a bucket rename or a credential change moves in one place.
const DEFAULT_REFERENCE_OBJECT = "reference/owner-voice-20260826.wav";

// The runtime conditioning cap (`services/open-voice-runtime/app.py::_reference`
// rejects outside 5-90 s). Longer input is TRIMMED, never resampled.
const MAX_PROMPT_MS = 90_000;
const SHORT_PROMPT_MS = 12_000;
const SYNC_ASR_MAX_MS = 30_000;

// The fallback corpus, used only when no transcript of the reference is
// available. Register-spanning per the bench protocol in
// docs/gurukul/research/voice-stack.md §Bench: casual Hinglish, code-switch
// heavy, expressive, and one Hindi-dominant and one English-dominant line.
// NOT drawn from persona.ts — `recited-prompt` says lines in a prompt become a
// phrase bank, and a bench sharing text with the prompt contaminates both.
const FALLBACK_ITEMS = [
  { id: "f1", register: "casual-hinglish", text: "Arre yaar, kal ka session thoda late ho gaya tha, par attendance dekh ke maza aa gaya." },
  { id: "f2", register: "codeswitch-heavy", text: "Basically jo integration by parts hai na, usme first function choose karna hi poora game hai." },
  { id: "f3", register: "expressive", text: "Bohot badhiya! Yeh wala step tumne khud nikala hai, seriously, main impressed hoon." },
  { id: "f4", register: "hindi-dominant", text: "Aaj hum sabse pehle prashn ko dhyaan se padhenge, phir hi hal karne ki koshish karenge." },
  { id: "f5", register: "english-dominant", text: "The exam does not test how fast you write, it tests whether you noticed the constraint." },
  { id: "f6", register: "instructional", text: "Ek minute rukiye, is line ko dobara dekhiye, yahan sign galat le liya humne." },
  { id: "f7", register: "casual-hinglish", text: "Chalo ek quick recap karte hain, phir doubt session, phir main nikalta hoon." },
  { id: "f8", register: "codeswitch-heavy", text: "Toh limit tend karti hai zero ki taraf, but numerator bhi zero ho raha hai, so L'Hopital." },
];

// ── argv ──────────────────────────────────────────────────────────────────
const [, , command, ...rest] = process.argv;
const flags = new Map();
for (let i = 0; i < rest.length; i += 1) {
  if (!rest[i].startsWith("--")) continue;
  const key = rest[i].slice(2);
  const next = rest[i + 1];
  if (next === undefined || next.startsWith("--")) flags.set(key, true);
  else { flags.set(key, next); i += 1; }
}
const flag = (name, fallback = null) => (flags.has(name) ? flags.get(name) : fallback);
const num = (name, fallback) => (flags.has(name) ? Number(flags.get(name)) : fallback);

function usage(code = 2) {
  // Lines 2-9 of this file: the banner and the five commands, and nothing
  // past them — usage that spills into the rationale stops being usage.
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 9).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  console.log("full instructions: docs/gurukul/EARBENCH.md");
  process.exit(code);
}

// ── run directories ───────────────────────────────────────────────────────
// The key NEVER lives under the directory the listening page is served from.
// Not in a subfolder, not with a scary name: a different tree entirely, so that
// serving the bench directory cannot serve the answers even by mistake.
function runPaths(runId) {
  return {
    runId,
    served: join(BENCH_ROOT, "runs", runId),
    stimuli: join(BENCH_ROOT, "runs", runId, "stimuli"),
    answers: join(BENCH_ROOT, "answers", runId),
    key: join(BENCH_ROOT, "keys", `${runId}.key.json`),
    trimCheck: join(BENCH_ROOT, "keys", `${runId}.trim-check.wav`),
  };
}

function latestRun() {
  const dir = join(BENCH_ROOT, "runs");
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir).filter((name) => existsSync(join(dir, name, "trials.json"))).sort();
  return runs.length ? runs[runs.length - 1] : null;
}

function requireRun(explicit) {
  const runId = explicit || latestRun();
  if (!runId) {
    console.error("no bench run found — build one first:\n  node scripts/earbench.mjs stimuli");
    process.exit(2);
  }
  return runPaths(runId);
}

// ── reference audio ───────────────────────────────────────────────────────
async function loadReference() {
  const local = flag("reference");
  if (local && local !== true) {
    const bytes = readFileSync(resolve(String(local)));
    return { bytes, origin: `file:${local}` };
  }
  const objectPath = String(flag("object", DEFAULT_REFERENCE_OBJECT));
  const { readPrivateReplicaObject, REPLICA_STORAGE_BUCKET } = await import("../api/_replica-storage.js");
  const object = await readPrivateReplicaObject(objectPath, { maxBytes: 64 * 1024 * 1024 });
  return { bytes: Buffer.from(object.body), origin: `supabase:${REPLICA_STORAGE_BUCKET}/${objectPath}` };
}

// ── items ─────────────────────────────────────────────────────────────────
// Matched content is not a nicety. If the clone says scripted lines and the real
// speaker says whatever they happened to say, "which of these is the clone" can
// be answered off the WORDS, and the bench measures nothing about the voice. So
// the default is: transcribe the consented reference, and make the clone say
// back the speaker's own sentences over the speaker's own recordings of them.
async function matchedItems(reference, probe, wanted) {
  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) return null;
  const { createSarvamSaarasProvider } = await import("../api/_asr/providers/sarvam-saaras.js");
  const provider = createSarvamSaarasProvider({
    apiKey,
    readAudio: async () => ({ body: reference, byteSize: reference.length }),
  });
  const result = await provider.transcribe(
    { storagePath: "earbench/reference.wav", sha256: sha256(reference), mime: "audio/wav", byteSize: reference.length },
    String(flag("language-code", "hi-IN")),
  );
  const usable = (result.turns || [])
    .filter((turn) => turn.t1 > turn.t0)
    .map((turn) => ({ ...turn, ms: turn.t1 - turn.t0, words: String(turn.text || "").trim().split(/\s+/).filter(Boolean).length }))
    .filter((turn) => turn.ms >= 3_000 && turn.ms <= 16_000 && turn.words >= 6 && turn.t1 <= probe.durationMs)
    .slice(0, wanted);
  if (usable.length < 4) return null;
  return usable.map((turn, index) => ({
    id: `m${index + 1}`,
    register: "reference-transcript",
    text: turn.text.trim(),
    realFrom: { t0: turn.t0, t1: turn.t1 },
  }));
}

function fallbackItems(probe, wanted) {
  // Real clips are consecutive excerpts of the reference. They are NOT what the
  // clone says, and that is a real limitation of this mode, stamped into the
  // manifest and printed by the scorer on every report that uses it.
  const items = FALLBACK_ITEMS.slice(0, wanted);
  const span = Math.min(7_000, Math.floor((probe.durationMs - 2_000) / items.length));
  return items.map((item, index) => ({
    ...item,
    realFrom: { t0: 1_000 + index * span, t1: 1_000 + index * span + span },
  }));
}

// ── synthesis arms ────────────────────────────────────────────────────────
// Two synthetic arms, because a bench that can only pass or fail one system
// cannot tell "this clone is weak" from "this whole approach is weak". The
// second arm is free: it is the SAME deployed runtime with a shorter
// conditioning reference, which is the cheapest real question the lane can
// answer — how much reference audio does fidelity actually need.
function armPlan() {
  const raw = String(flag("arms", "real,clone-full,clone-short")).split(",").map((s) => s.trim()).filter(Boolean);
  for (const arm of raw) {
    if (!["real", "clone-full", "clone-short"].includes(arm)) {
      console.error(`unknown arm "${arm}" — known: real, clone-full, clone-short`);
      process.exit(2);
    }
  }
  if (!raw.includes("real")) {
    console.error("the real speaker arm is not optional: without it there is no ground truth to be blind about");
    process.exit(2);
  }
  return raw;
}

async function drain(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function cutPcm(pcm, t0, t1) {
  const start = Math.max(0, Math.floor((t0 / 1000) * SAMPLE_RATE)) * 2;
  const end = Math.min(pcm.length, Math.floor((t1 / 1000) * SAMPLE_RATE) * 2);
  return pcm.subarray(start, end - (end - start) % 2);
}

// ── the local synthesiser, for `selftest` only ────────────────────────────
// Two "speakers" that differ in fundamental frequency and formant shape, and a
// spoken-disclosure stand-in: a distinct tone burst followed by the same pause
// the real runtime leaves. It is not a voice and it is not pretending to be
// one. It exists so that every mechanism — trim, treat, blind, pad, design,
// serve, score — can be driven end to end with zero credentials and zero spend.
function synthTone({ seconds, f0, formant, seed, leading = false }) {
  const total = Math.floor(seconds * SAMPLE_RATE);
  const random = rng(seed);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3.1 * t);
    out[i] = envelope * (
      0.5 * Math.sin(2 * Math.PI * f0 * t) +
      0.3 * Math.sin(2 * Math.PI * formant * t) +
      0.05 * (random() * 2 - 1)
    ) * 0.5;
  }
  if (!leading) return out;
  return out;
}

function selfTestClip({ arm, item, seed }) {
  const voice = arm === "real"
    ? { f0: 196, formant: 1_180 }
    : arm === "clone-full"
      ? { f0: 193, formant: 1_205 }
      : { f0: 172, formant: 1_460 };
  const seconds = 2.6 + (item.text.length % 7) * 0.25;
  const body = synthTone({ seconds, ...voice, seed });
  if (arm === "real") return toPcm(body);
  // The clone arms get a spoken-disclosure stand-in plus the pause the trimmer
  // is supposed to find: ~1.9 s of "announcement", 260 ms of silence, then the
  // content. If the trimmer cannot find that, the self-test fails, which is
  // exactly what it is for.
  const disclosure = synthTone({ seconds: 1.9, f0: 240, formant: 900, seed: seed + 1 });
  const gap = new Float32Array(Math.floor(0.26 * SAMPLE_RATE));
  const joined = new Float32Array(disclosure.length + gap.length + body.length);
  joined.set(disclosure, 0);
  joined.set(gap, disclosure.length);
  joined.set(body, disclosure.length + gap.length);
  return toPcm(joined);
}

// ═══════════════════════════════════════════════════════════════════════════
// stimuli
// ═══════════════════════════════════════════════════════════════════════════
async function buildStimuli({ selfTest = false } = {}) {
  const runId = String(flag("run", `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex")}`));
  const paths = runPaths(runId);
  const arms = armPlan();
  const wanted = Math.max(4, Math.min(20, num("items", 6)));
  const runSecret = randomBytes(32).toString("hex");
  const started = Date.now();

  let referenceBytes = null;
  let referenceOrigin = "selftest:generated";
  let probe = { durationMs: 71_000, sampleRate: SAMPLE_RATE, rms: 0.05, peak: 0.5, activeRatio: 1 };
  let referencePcm = null;

  if (selfTest) {
    referencePcm = toPcm(synthTone({ seconds: 40, f0: 196, formant: 1_180, seed: 7 }));
    referenceBytes = wrapWav(referencePcm);
    probe = { ...probe, durationMs: 40_000 };
  } else {
    const { probeEnrollmentWav } = await import("../api/_audio/wav.js");
    const loaded = await loadReference();
    referenceBytes = loaded.bytes;
    referenceOrigin = loaded.origin;
    probe = probeEnrollmentWav(referenceBytes);
    referencePcm = wavPcm(referenceBytes);
  }
  console.log(`reference   ${referenceOrigin}`);
  console.log(`            ${(probe.durationMs / 1000).toFixed(1)} s, ${probe.sampleRate} Hz mono, sha256 ${sha256(referenceBytes).slice(0, 16)}…`);

  // items
  let items = null;
  let contentMatched = false;
  if (!selfTest && !flags.has("unmatched")) {
    try {
      items = await matchedItems(referenceBytes, probe, wanted);
      contentMatched = Boolean(items);
    } catch (error) {
      console.log(`            transcript unavailable (${error?.code || error?.message}) — falling back to the scripted corpus`);
    }
  }
  if (!items) items = fallbackItems(probe, wanted);
  console.log(`items       ${items.length}, content-matched arms: ${contentMatched ? "yes" : "NO (scripted corpus — content is a cue, see the manifest)"}`);

  // Synthesis goes through the REAL deployed runtime — the same provider
  // `scripts/first-clone.mjs` drives, HMAC and watermark verification included.
  // There is no mock arm and no offline fallback: a bench whose "clone" was
  // produced by something other than the thing that ships is a bench about
  // nothing. A missing credential is therefore a named refusal, in the shape
  // first-clone.mjs settled on (`gates-that-live-nowhere`: a stage that quietly
  // does nothing reports a pass on a tree it never read).
  const needsRuntime = !selfTest && arms.some((arm) => arm !== "real");
  let chatterbox = null;
  if (needsRuntime) {
    const missing = ["AZURE_OPEN_VOICE_ORIGIN", "OPEN_VOICE_HMAC_SECRET"].filter((name) => !String(process.env[name] || "").trim());
    if (missing.length) {
      console.error(`\ncannot synthesise: set ${missing.join(", ")} (see docs/gurukul/AZURE-DEPLOY-STATE.md).`);
      console.error("Nothing was written. The clone arms come from the deployed runtime or they do not exist.");
      process.exit(2);
    }
    chatterbox = await import("../api/_voice/providers/open-chatterbox-preview.js")
      .then((mod) => mod.createOpenChatterboxPreviewProvider());
  }
  const fullPrompt = wrapWav(referencePcm.subarray(0, Math.floor((MAX_PROMPT_MS / 1000) * SAMPLE_RATE) * 2));
  const shortPrompt = wrapWav(referencePcm.subarray(0, Math.floor((SHORT_PROMPT_MS / 1000) * SAMPLE_RATE) * 2));

  mkdirSync(paths.stimuli, { recursive: true });
  mkdirSync(dirname(paths.key), { recursive: true });

  const raw = [];
  const receipts = [];
  for (const arm of arms) {
    for (const [index, item] of items.entries()) {
      let pcm;
      let receipt = null;
      if (selfTest) {
        pcm = selfTestClip({ arm, item, seed: 900 + index * 7 + arm.length });
      } else if (arm === "real") {
        pcm = Buffer.from(cutPcm(referencePcm, item.realFrom.t0, item.realFrom.t1));
      } else {
        const prompt = arm === "clone-short" ? shortPrompt : fullPrompt;
        // Same seed and same style across the two clone arms: the ONLY thing
        // that differs between them is how much reference audio conditioned
        // them, which is the question the second arm exists to ask.
        let result;
        try {
          result = await synthesizeWithRetry(chatterbox, {
            requestId: randomUUID(),
            text: item.text,
            languageId: String(flag("language", "hi")),
            seed: 41_000 + index,
            reference: { bytes: prompt },
            style: { exaggeration: 0.45, cfgWeight: 0.5, temperature: 0.8 },
          });
        } catch (error) {
          console.error(`\nsynthesis failed on ${arm}/${item.id}: ${`${error?.code || ""} ${error?.message || error}`.trim()}`);
          console.error("Nothing was written. A partial stimulus set is worse than none: it would be");
          console.error("unbalanced by exactly the clips the runtime happened to refuse.");
          process.exit(1);
        }
        pcm = await drain(result.stream);
        receipt = { arm, item: item.id, ...result.receipt };
        receipts.push(receipt);
        process.stdout.write(`\rsynthesis   ${receipts.length} clip(s), rtf ${receipt.realTimeFactor.toFixed(2)}   `);
      }
      raw.push({ arm, item, pcm, receipt });
    }
  }
  if (receipts.length) console.log("");

  // treatment — identical path for every arm, disclosure trim on the clone arms
  const window = { minMs: num("disclosure-min-ms", 1_100), maxMs: num("disclosure-max-ms", 6_000) };
  const treated = [];
  const failures = [];
  for (const entry of raw) {
    const isClone = entry.arm !== "real";
    const result = treat(entry.pcm, { trim: isClone, text: entry.item.text, window });
    if (!result.ok) {
      failures.push(`${entry.arm}/${entry.item.id}: ${result.reason || "trim failed"}`);
      continue;
    }
    treated.push({ ...entry, treated: result });
  }
  if (failures.length) {
    // FAIL CLOSED. A clip whose disclosure could not be removed with confidence
    // is a clip that either announces itself or has lost its first word, and
    // both corrupt the bench. There is no flag to force it through.
    console.error(`\ndisclosure trim failed on ${failures.length} clip(s) — refusing to write a bench:\n  ${failures.join("\n  ")}`);
    console.error("\nThis is the check working, not the check breaking: every clone clip begins with the spoken");
    console.error('sentence "This is an AI-generated voice replica." (api/_voice/contracts.js), and a bench that');
    console.error("ships it is unblinded before the first trial.");
    process.exit(1);
  }

  // ASR verification of the trim, when the lane is available.
  let blindingVerified = false;
  const verification = [];
  if (!selfTest && process.env.SARVAM_API_KEY && !flags.has("skip-asr-verify")) {
    for (const entry of treated.filter((e) => e.arm !== "real")) {
      const durationMs = entry.treated.durationMs;
      if (durationMs > SYNC_ASR_MAX_MS) continue;
      const transcript = await syncTranscribe(wrapWav(entry.treated.pcm));
      const carries = transcriptCarriesDisclosure(transcript);
      verification.push({ arm: entry.arm, item: entry.item.id, carriesDisclosure: carries, chars: transcript.length });
      if (carries) {
        console.error(`\nASR still hears the disclosure in ${entry.arm}/${entry.item.id} after trimming — refusing to write a bench.`);
        process.exit(1);
      }
    }
    blindingVerified = verification.length > 0;
    console.log(`blinding    ASR-verified on ${verification.length} clone clip(s): no disclosure survives the trim`);
  } else if (!treated.some((e) => e.arm !== "real")) {
    console.log("blinding    nothing synthetic in this run — no disclosure to trim, and no ABX pair to be blind about");
  } else {
    console.log("blinding    arithmetic only (no SARVAM_API_KEY) — the removed prefix is a plausible disclosure length");
    console.log("            and what remains is a plausible length for the text. Confirm by ear with `verify-trim`,");
    console.log("            which plays ONLY the removed prefixes and so cannot unblind you.");
  }

  // Blinding on disk: opaque ids, one identical DURATION and one identical byte
  // length for every file. Clip length is an arm cue — a synthetic arm renders
  // the same sentence at its own pace — and both `ls -l` and an audio player's
  // scrubber show it without the listener even trying. Trailing digital silence
  // equalises both; what remains is when the speech stops, which is a property
  // of the speech and not of the file.
  const longest = Math.max(...treated.map((e) => e.treated.pcm.length));
  const padTo = longest + 44 + 8;
  const padPcm = (pcm) => (pcm.length >= longest ? pcm : Buffer.concat([pcm, Buffer.alloc(longest - pcm.length)]));
  const stimuli = [];
  for (const entry of treated) {
    const id = blindId(runSecret, entry.arm, entry.item.id);
    const bytes = wrapWav(padPcm(entry.treated.pcm), { padToBytes: padTo });
    writeFileSync(join(paths.stimuli, `${id}.wav`), bytes);
    stimuli.push({
      id,
      arm: entry.arm,
      itemId: entry.item.id,
      register: entry.item.register,
      text: entry.item.text,
      durationMs: Math.round(entry.treated.durationMs),
      bytes: bytes.length,
      sha256: sha256(bytes),
      gain: entry.treated.gain,
      peakLimited: entry.treated.peakLimited,
      trimmedMs: entry.treated.cut ? Math.round(entry.treated.cut.cutMs) : null,
      receipt: entry.receipt,
    });
  }

  // the similarity anchor: a REAL clip, labelled as the reference, taken from a
  // stretch of the recording no item uses, so "does this sound like them" has
  // something to be measured against.
  const anchorStart = Math.max(0, probe.durationMs - 9_000);
  const anchorTreated = treat(Buffer.from(cutPcm(referencePcm, anchorStart, anchorStart + 8_000)), { trim: false });
  const anchorId = blindId(runSecret, "reference-anchor", "anchor");
  writeFileSync(join(paths.stimuli, `${anchorId}.wav`), wrapWav(padPcm(anchorTreated.pcm.subarray(0, longest)), { padToBytes: padTo }));

  // design
  const seed = seedFrom(runSecret, "design");
  const abx = buildAbxTrials({ stimuli, arms, items: items.map((i) => i.id), runSecret, seed });
  const ratings = buildRatingTrials({ stimuli, runSecret, seed: seed + 1, referenceId: anchorId });
  const balance = counterbalanceReport(abx);

  const key = {
    version: EARBENCH_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    selfTest,
    contentMatched,
    blindingVerified,
    referenceOrigin,
    referenceSha256: sha256(referenceBytes),
    referenceAnchorId: anchorId,
    runSecret,
    policy: DEFAULT_POLICY,
    arms,
    items,
    stimuli,
    trials: abx,
    ratings,
    verification,
    balance,
  };
  writeFileSync(paths.key, JSON.stringify(key, null, 2));

  writeFileSync(join(paths.served, "trials.json"), JSON.stringify(
    listenerView({ runId, createdAt: key.createdAt, abx, ratings, notes: flag("notes", "") || "" }), null, 2));
  writeFileSync(join(paths.served, "manifest.json"), JSON.stringify({
    version: EARBENCH_VERSION,
    runId,
    createdAt: key.createdAt,
    selfTest,
    contentMatched,
    blindingVerified,
    stimulusCount: stimuli.length + 1,
    stimulusBytes: padTo,
    abxTrials: balance.trials,
    catchTrials: balance.catchTrials,
    referenceAnchorId: anchorId,
    axes: RATING_AXES.map((a) => a.id),
  }, null, 2));
  writeFileSync(join(paths.served, "page.html"), readFileSync(join(ROOT, "evals/earbench/page.html")));

  // The removed prefixes, shuffled and unlabelled, for `verify-trim`.
  const prefixes = treated.filter((e) => e.treated.prefixPcm);
  if (prefixes.length) {
    const order = shuffle(prefixes, rng(seed + 2));
    const silence = Buffer.alloc(Math.floor(0.4 * SAMPLE_RATE) * 2);
    writeFileSync(paths.trimCheck, wrapWav(Buffer.concat(order.flatMap((e) => [e.treated.prefixPcm, silence]))));
  }

  console.log("");
  console.log(`run         ${runId}`);
  console.log(`stimuli     ${stimuli.length} + 1 reference anchor, every file exactly ${padTo} bytes`);
  console.log(`design      ${balance.trials} ABX trials + ${balance.catchTrials} catch, position balanced ${balance.positionBalanced}, X-arm balanced ${balance.xArmBalanced}`);
  if (!balance.trials) console.log("            NO ABX PAIRS — one arm cannot be told apart from itself. This run can only produce ratings.");
  console.log(`            ${ratings.length} rating screens x ${RATING_AXES.length} axes (accent is its own axis)`);
  console.log(`served      ${paths.served}`);
  console.log(`key         ${paths.key}   <- NOT under the served directory. Do not open it.`);
  console.log(`wall        ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log("");
  console.log("next        node scripts/earbench.mjs listen");
  return { paths, key };
}

async function synthesizeWithRetry(provider, request) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await provider.synthesizePreview(request);
    } catch (error) {
      // A GPU app at zero replicas takes ~161 s to become ready and the request
      // that wakes it dies first (AZURE-DEPLOY-STATE.md §8). Only retrying can
      // tell a cold start from a failure.
      if (attempt >= 3) throw error;
      console.log(`\n            ${error?.code || error} — retrying (cold start ~161 s), attempt ${attempt + 2}/4`);
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

async function syncTranscribe(wavBytes) {
  const form = new FormData();
  form.append("file", new Blob([wavBytes], { type: "audio/wav" }), "clip.wav");
  form.append("model", process.env.SARVAM_SYNC_ASR_MODEL || "saarika:v2.5");
  form.append("language_code", String(flag("language-code", "hi-IN")));
  const response = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": process.env.SARVAM_API_KEY },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body?.error?.message || `asr ${response.status}`), { code: "asr_failed" });
  return String(body.transcript || "");
}


// ═══════════════════════════════════════════════════════════════════════════
// score
// ═══════════════════════════════════════════════════════════════════════════
function scoreRun(paths) {
  if (!existsSync(paths.key)) {
    console.error(`no key at ${paths.key} — this run cannot be scored`);
    process.exit(2);
  }
  const key = JSON.parse(readFileSync(paths.key, "utf8"));
  // Answer sheets only. A report written INTO the answers directory would be
  // read back as a sheet on the next run and would appear in its own output as
  // a phantom listener — which is what happened the first time this ran, so
  // reports live in their own tree.
  const sheets = existsSync(paths.answers)
    ? readdirSync(paths.answers).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(paths.answers, f), "utf8")))
      .filter((sheet) => sheet && (sheet.abx || sheet.ratings) && !sheet.listeners)
    : [];
  const report = scoreBench({ key, sheets, policy: key.policy || DEFAULT_POLICY });
  console.log(renderReport(report));
  const out = join(BENCH_ROOT, "reports", `${paths.runId}.report.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nreport      ${out}`);
  return report;
}

// ═══════════════════════════════════════════════════════════════════════════
// selftest — every mechanism, end to end, no credentials, no spend
// ═══════════════════════════════════════════════════════════════════════════
async function selfTest() {
  const runId = `selftest-${randomBytes(3).toString("hex")}`;
  flags.set("run", runId);
  flags.set("items", String(num("items", 6)));
  const { paths, key } = await buildStimuli({ selfTest: true });

  // Two simulated listeners against the SAME key: one who can always tell the
  // arms apart, and one who is guessing. The scorer must say two different
  // things about them, and if it cannot, the instrument does not work.
  const answerSheet = (listener, oracle, random) => {
    const abx = {};
    for (const trial of key.trials) {
      const right = trial.correct;
      const wrong = right === "A" ? "B" : "A";
      abx[trial.trialId] = { choice: oracle(trial, random) ? right : wrong, confidence: 3, ms: 4_000 };
    }
    const ratings = {};
    for (const rating of key.ratings) {
      const real = rating.arm === "real";
      ratings[rating.ratingId] = {
        similarity: real ? 5 : rating.arm === "clone-full" ? 4 : 2,
        naturalness: real ? 5 : rating.arm === "clone-full" ? 3 : 2,
        accent: real ? 5 : rating.arm === "clone-full" ? 3 : 1,
      };
    }
    return { runId, listener, abx, ratings, startedAt: new Date().toISOString() };
  };
  mkdirSync(paths.answers, { recursive: true });
  const perfect = answerSheet("oracle", () => true);
  // The guesser still passes the catch trials — they are trivially answerable
  // and a sheet that fails them is discarded by the scorer, which would leave
  // the chance path untested by this self-test.
  const coin = answerSheet("coinflip", (trial, random) => (trial.isCatch ? true : random() < 0.5), rng(11));

  console.log("\n── scorer with NO answers at all ───────────────────────────────────────");
  const empty = scoreRun(paths);
  if (empty.listened) throw new Error("selftest: an empty run reported that somebody listened");

  console.log("\n── scorer with a listener who can always tell them apart ───────────────");
  writeFileSync(join(paths.answers, "oracle.json"), JSON.stringify(perfect, null, 2));
  const strong = scoreRun(paths);
  const strongVerdicts = strong.abx.map((a) => a.verdict);
  if (!strongVerdicts.length || strongVerdicts.some((v) => v !== "distinguishable")) {
    throw new Error(`selftest: a perfect discriminator was not reported as distinguishable (${strongVerdicts.join(",")})`);
  }

  console.log("\n── scorer with a listener who is guessing ──────────────────────────────");
  rmSync(join(paths.answers, "oracle.json"));
  writeFileSync(join(paths.answers, "coinflip.json"), JSON.stringify(coin, null, 2));
  const weak = scoreRun(paths);
  const weakVerdicts = weak.abx.map((a) => a.verdict);
  if (!weakVerdicts.length) throw new Error("selftest: the guessing listener's sheet was discarded, so the chance path went untested");
  if (weakVerdicts.some((v) => v === "distinguishable")) {
    throw new Error(`selftest: a coin-flipping listener was reported as distinguishable (${weakVerdicts.join(",")})`);
  }
  if (weak.listeners.some((l) => l.valid === false)) throw new Error("selftest: the guessing listener failed the catch trials");

  console.log("\n── blinding, checked on the files that were actually written ───────────");
  const written = readdirSync(paths.stimuli);
  const sizes = new Set(written.map((f) => readFileSync(join(paths.stimuli, f)).length));
  if (sizes.size !== 1) throw new Error(`selftest: ${sizes.size} distinct file sizes on disk — file size leaks the arm`);
  const names = new Set(written.map((f) => f.replace(".wav", "")));
  for (const stimulus of key.stimuli) {
    if (!names.has(stimulus.id)) throw new Error(`selftest: stimulus ${stimulus.id} was never written`);
    if (stimulus.id.includes(stimulus.arm)) throw new Error("selftest: a stimulus id names its arm");
  }
  const servedTree = readdirSync(paths.served);
  if (servedTree.some((f) => f.includes("key"))) throw new Error("selftest: something key-shaped is inside the served directory");
  const servedText = servedTree.filter((f) => f.endsWith(".json")).map((f) => readFileSync(join(paths.served, f), "utf8")).join("\n");
  for (const arm of key.arms) {
    if (servedText.includes(`"${arm}"`)) throw new Error(`selftest: the served files name the arm "${arm}"`);
  }
  if (servedText.includes(key.runSecret)) throw new Error("selftest: the run secret is inside a served file");
  for (const item of key.items) {
    if (servedText.includes(item.text.slice(0, 24))) throw new Error("selftest: the served files carry the item text");
  }
  console.log(`ok — ${written.length} stimuli, one byte length (${[...sizes][0]}), no arm/secret/text in anything served`);

  console.log("\n── the disclosure trim, on clips that carry a disclosure stand-in ──────");
  const trimmed = key.stimuli.filter((s) => s.arm !== "real");
  if (!trimmed.length || trimmed.some((s) => !s.trimmedMs)) throw new Error("selftest: a clone clip was not trimmed");
  console.log(`ok — ${trimmed.length} clone clips trimmed at ${Math.min(...trimmed.map((s) => s.trimmedMs))}-${Math.max(...trimmed.map((s) => s.trimmedMs))} ms`);

  console.log("\nSELF-TEST PASSED. This proves the INSTRUMENT works on synthetic tones.");
  console.log("It is not a bench result and no human has listened to anything.");
}

// ═══════════════════════════════════════════════════════════════════════════
switch (command) {
  case "stimuli": {
    await buildStimuli({ selfTest: false });
    break;
  }
  case "listen": {
    const paths = requireRun(flag("run"));
    const port = num("port", 8787);
    await serveBench(paths, port, { onSaved: (file) => console.log(`saved ${file}`) });
    const manifest = JSON.parse(readFileSync(join(paths.served, "manifest.json"), "utf8"));
    console.log(`earbench run ${paths.runId} — ${manifest.abxTrials} ABX + ${manifest.catchTrials} catch + ${manifest.stimulusCount - 1} rating screens`);
    if (manifest.selfTest) console.log("*** SELF-TEST RUN — synthetic tones, not a voice ***");
    console.log(`\n  open  http://127.0.0.1:${port}/\n`);
    console.log("answers are written to", paths.answers);
    console.log("stop the server with ctrl-c, then: node scripts/earbench.mjs score");
    break;
  }
  case "score": {
    scoreRun(requireRun(flag("run")));
    break;
  }
  case "verify-trim": {
    const paths = requireRun(flag("run"));
    if (!existsSync(paths.trimCheck)) {
      console.error(`no trim check for ${paths.runId} — this run trimmed nothing`);
      process.exit(2);
    }
    console.log(`Play this file: ${paths.trimCheck}`);
    console.log("It contains ONLY the audio removed from the front of the clone clips, shuffled and unlabelled.");
    console.log('Every segment should be the sentence "This is an AI-generated voice replica." and nothing else.');
    console.log("If you hear any of the bench sentences in it, the trim cut too late and the run is void.");
    console.log("Listening to this does NOT unblind you: it names no file and contains no stimulus.");
    break;
  }
  case "selftest": {
    await selfTest();
    break;
  }
  default:
    usage(command ? 2 : 0);
}
