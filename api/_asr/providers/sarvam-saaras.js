// Sarvam Saaras — the first-candidate Hinglish ASR (Gurukul WS-I).
//
// docs/gurukul/ingestion-research.md §3's recommendation, in full: "use Sarvam
// Saaras (v3, with diarization) as primary ASR for ingestion, since it's (a)
// already cost-known, (b) specifically benchmarked as strong on Hinglish, (c)
// already an integrated vendor in this codebase" — against Whisper large-v3's
// measured 32.33%-51.62% CER on distinct-script code-switched pairs, which is
// what Hindi-English is.
//
// ── two gaps the research flagged, carried here rather than left behind ──
// 1. PRICING IS UNRESOLVED. §3 records ₹30/hr transcription-only / ₹45/hr
//    with diarization from one source and ₹1.5/min (= ₹90/hr) from another,
//    and marks them "[CONFLICTING, re-check Sarvam's own pricing page
//    directly before budgeting]". This provider is therefore NOT wired into
//    api/_provider-budget.js's spend fencing, because a fence built on a rate
//    that might be 3x wrong is a fence that reports a budget it is not
//    holding. Wiring it is a prerequisite for the first paid run, and it
//    needs the real number first.
// 2. THE ENDPOINT PATHS BELOW ARE CODED FROM §3's ACCOUNT OF THE BATCH API,
//    not from a request that has been made. They are protocol-complete in
//    SHAPE — init, upload, start, poll, fetch — which is the part that
//    determines this file's structure and its failure modes. The exact path
//    strings must be checked against Sarvam's live docs before the first
//    call, and `SARVAM_API_ORIGIN` exists so that check does not require a
//    code change.
//
// Both of those are the reason this lane is env-gated and unreachable from
// any eval: nothing here has been measured, and a provider whose numbers are
// unverified must not be able to run by accident.
//
// ── diarization is requested, and its absence is reported, never faked ───
// `with_diarization` is on because a lecture has a teacher and it has
// students, and `transcriptStats` measures ONE speaker. If Sarvam returns a
// single undiarized block, the turns carry one label for the file — which is
// the honest statement "this is all one speaker as far as we know" and lets
// `transcriptStats` measure the whole file. What this file must never do is
// split a monolithic transcript into invented speakers: that would halve a
// teacher's measured corpus without anything reporting a problem.
import { asrInput, asrResult, langHint } from "../contracts.js";
import { readPrivateReplicaObject } from "../../_replica-storage.js";

const NAME = "sarvam-saaras";
const DEFAULT_MODEL = "saaras:v3";
const DEFAULT_ORIGIN = "https://api.sarvam.ai";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 120;         // 10 minutes; a two-hour lecture transcribes well inside it
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 268_435_456;

function fail(code, status = 502, details) {
  throw Object.assign(new Error(code), { code, status, details });
}

async function json(fetchImpl, url, options, code) {
  let response;
  try { response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }); }
  catch { fail(`${code}_unreachable`, 503); }
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { fail(`${code}_response_invalid`); }
  if (!response.ok) fail(`${code}_http_${response.status}`, response.status === 429 ? 429 : 502);
  return body;
}

/** Sarvam's diarized output: one entry per utterance with a speaker id and
 *  second-resolution timings. Anything the shape does not match is a failure
 *  and not a silent empty transcript — `asrResult` would reject an empty
 *  turn list anyway, and this code names WHY it was empty. */
function turnsFrom(payload) {
  const entries = Array.isArray(payload?.diarized_transcript?.entries) ? payload.diarized_transcript.entries
    : Array.isArray(payload?.entries) ? payload.entries
    : null;
  if (entries) {
    return entries.map((entry) => ({
      speaker: String(entry?.speaker_id ?? entry?.speaker ?? "SPEAKER_00"),
      text: String(entry?.transcript ?? entry?.text ?? ""),
      t0: Math.round(Number(entry?.start_time_seconds ?? entry?.start ?? 0) * 1000),
      t1: Math.round(Number(entry?.end_time_seconds ?? entry?.end ?? 0) * 1000),
    }));
  }
  // The undiarized answer. ONE label for the file — see the header.
  const transcript = String(payload?.transcript ?? "");
  if (!transcript.trim()) fail("asr_sarvam_transcript_missing", 422);
  return [{ speaker: "SPEAKER_00", text: transcript, t0: 0, t1: 0 }];
}

export function createSarvamSaarasProvider(options = {}) {
  const apiKey = String(options.apiKey || "");
  if (!apiKey) fail("asr_provider_unavailable", 503);
  const model = String(options.model || DEFAULT_MODEL);
  const origin = String(options.origin || process.env.SARVAM_API_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl || fetch;
  // Injected so the transport and the storage read are independently
  // replaceable — and so this file never becomes the second place that knows
  // how replica storage is addressed.
  const readAudio = options.readAudio || ((ref) => readPrivateReplicaObject(ref.storagePath, {
    fetchImpl, maxBytes: MAX_AUDIO_BYTES, timeoutMs: 120_000,
  }));
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  // The subscription key travels in a header and appears in no other
  // expression in this file. It is never interpolated into a URL, never put
  // in an error, and never returned — CLAUDE.md's "never print a key", made
  // structural by there being exactly one place it is read.
  const auth = { "api-subscription-key": apiKey };

  return Object.freeze({
    name: NAME,
    model,

    async transcribe(rawRef, hint = "hi-IN") {
      const ref = asrInput(rawRef);
      const language = langHint(hint);

      // 1. init — Sarvam allocates the job and its input/output storage.
      const job = await json(fetchImpl, `${origin}/speech-to-text/job/init`, {
        method: "POST", headers: { ...auth, Accept: "application/json" },
      }, "asr_sarvam_init");
      const jobId = String(job?.job_id || "");
      const inputPath = String(job?.input_storage_path || "");
      const outputPath = String(job?.output_storage_path || "");
      if (!jobId || !inputPath || !outputPath) fail("asr_sarvam_init_incomplete");

      // 2. upload — the bytes leave our storage exactly once, for this job.
      const object = await readAudio(ref);
      const body = object?.body;
      if (!body || !body.length) fail("asr_audio_unreadable", 502);
      let upload;
      try {
        upload = await fetchImpl(`${inputPath}`, {
          method: "PUT",
          headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": ref.mime || "audio/wav" },
          body,
          signal: AbortSignal.timeout(300_000),
        });
      } catch { fail("asr_sarvam_upload_unreachable", 503); }
      if (!upload.ok) fail(`asr_sarvam_upload_http_${upload.status}`);

      // 3. start
      await json(fetchImpl, `${origin}/speech-to-text/job`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          job_parameters: {
            model,
            with_diarization: true,
            language_code: language === "auto" ? "unknown" : language,
          },
        }),
      }, "asr_sarvam_start");

      // 4. poll
      let state = "";
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        const status = await json(fetchImpl, `${origin}/speech-to-text/job/${encodeURIComponent(jobId)}`, {
          headers: { ...auth, Accept: "application/json" },
        }, "asr_sarvam_status");
        state = String(status?.job_state || status?.status || "");
        if (state === "Completed") break;
        if (state === "Failed") fail("asr_sarvam_job_failed", 502, { jobId });
        await sleep(POLL_INTERVAL_MS);
      }
      if (state !== "Completed") fail("asr_sarvam_job_timeout", 504, { jobId });

      // 5. collect
      const payload = await json(fetchImpl, outputPath, { headers: { Accept: "application/json" } }, "asr_sarvam_output");
      return asrResult({ turns: turnsFrom(payload), provider: NAME, model }, { name: NAME, model });
    },
  });
}
