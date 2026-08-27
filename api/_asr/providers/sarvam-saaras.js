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
// 2. THE ENDPOINT PATHS HAVE NOW BEEN RUN (WS-T, 2026-08-26) against the live
//    API with a real consented 71 s Hinglish sample, and three of them were
//    wrong. The shape §3 described — init, upload, start, poll, fetch — was
//    right; three of the five addresses were not, and each failed in a way
//    code review could not see:
//      * upload PUT to `input_storage_path` -> 409. It is a DIRECTORY SAS.
//      * poll GET `/job/{id}` -> 404 forever, read as "still running", so a
//        job that completed in 126 s died at the 10-minute timeout.
//      * collect GET `output_storage_path` -> a directory, not JSON. The
//        result blob is named by input index (`0.json`).
//    All three are fixed below and the whole chain was then run end to end.
//    `SARVAM_API_ORIGIN` still exists so a future path change needs no code
//    change.
//
// Pricing (1) is still unresolved, and that alone is why this lane stays
// env-gated and out of `api/_provider-budget.js`.
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
const MAX_AUDIO_BYTES = 1_073_741_824;

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

/** Both storage paths Sarvam hands back are Azure DIRECTORY SAS URLs — the
 *  query string is the credential and the path is a directory, so a blob under
 *  it is addressed by appending a name to the PATH while keeping the query
 *  intact. Verified against the live API 2026-08-26: PUT to the bare directory
 *  answers 409, PUT to `<dir>/<name>?<sas>` answers 201. */
function inDirectory(directoryUrl, name) {
  let url;
  try { url = new URL(String(directoryUrl)); }
  catch { fail("asr_sarvam_storage_path_invalid"); }
  if (url.protocol !== "https:") fail("asr_sarvam_storage_path_invalid");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(name)}`;
  return url.toString();
}

/** Names of the blobs under a directory SAS, via the Blob container listing
 *  (`restype=container&comp=list&prefix=`), which the `sp=...l` list permission
 *  on that SAS covers. Returned relative to the directory. */
async function listDirectory(fetchImpl, directoryUrl) {
  let url;
  try { url = new URL(String(directoryUrl)); }
  catch { fail("asr_sarvam_storage_path_invalid"); }
  const [, container, ...rest] = url.pathname.split("/");
  const prefix = rest.join("/");
  const listing = new URL(`${url.origin}/${container}${url.search}`);
  listing.searchParams.set("restype", "container");
  listing.searchParams.set("comp", "list");
  listing.searchParams.set("prefix", `${prefix}/`);
  let response;
  try { response = await fetchImpl(listing.toString(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }); }
  catch { fail("asr_sarvam_output_unreachable", 503); }
  if (!response.ok) fail(`asr_sarvam_output_list_http_${response.status}`);
  const xml = await response.text();
  const names = [];
  // The listing is a small, fixed-shape XML document from Azure Storage; a
  // <Name> scan is the whole of what is needed and pulls in no parser.
  for (const match of xml.matchAll(/<Name>([^<]+)<\/Name>/g)) {
    const name = match[1].startsWith(`${prefix}/`) ? match[1].slice(prefix.length + 1) : match[1];
    if (name && !name.includes("/")) names.push(name);
  }
  return names;
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

function languageEvidence(payload, requestedLanguage) {
  if (requestedLanguage !== "auto") {
    return { languageCode: requestedLanguage, languageProbability: null, languageSource: "requested_hint" };
  }
  const rawCode = payload?.language_code;
  const code = typeof rawCode === "string" && rawCode.trim() ? rawCode.trim() : null;
  const rawProbability = payload?.language_probability;
  const probability = rawProbability == null ? null : Number(rawProbability);
  return {
    languageCode: code,
    languageProbability: Number.isFinite(probability) ? probability : null,
    languageSource: code ? "provider_detected" : "unavailable",
  };
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
  const readAudio = options.readAudio || ((ref) => readPrivateReplicaObject({
    storageBucket: ref.storageBucket,
    objectPath: ref.storagePath,
  }, {
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

    async transcribe(rawRef, hint = "auto") {
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
      //    `input_storage_path` is a DIRECTORY SAS (`sr=d`, `sp=wl`), not a
      //    blob URL: PUTting the directory itself answers 409. The file name
      //    inside it is ours to choose and never reaches the output, which is
      //    indexed by position (see step 5).
      const object = await readAudio(ref);
      const body = object?.body;
      const byteSize = Number(object?.byteSize ?? ref.byteSize ?? body?.length);
      const streamBody = body && !Buffer.isBuffer(body) && !ArrayBuffer.isView(body)
        && (typeof body.pipe === "function" || typeof body[Symbol.asyncIterator] === "function");
      if (!body || (!streamBody && !body.length) || !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_AUDIO_BYTES) {
        fail("asr_audio_unreadable", 502);
      }
      let upload;
      try {
        upload = await fetchImpl(inDirectory(inputPath, "input-0.wav"), {
          method: "PUT",
          headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": ref.mime || "audio/wav" },
          body,
          ...(streamBody ? { duplex: "half" } : {}),
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

      // 4. poll — the status resource is `/job/{id}/status`. `/job/{id}` is a
      //    404 forever, which the old code read as "not finished yet" and rode
      //    all the way to a ten-minute `asr_sarvam_job_timeout` on a job that
      //    had in fact completed in two minutes.
      let state = "";
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        const status = await json(fetchImpl, `${origin}/speech-to-text/job/${encodeURIComponent(jobId)}/status`, {
          headers: { ...auth, Accept: "application/json" },
        }, "asr_sarvam_status");
        state = String(status?.job_state || status?.status || "");
        if (state === "Completed") break;
        if (state === "Failed") fail("asr_sarvam_job_failed", 502, { jobId, error: String(status?.error_message || "") });
        await sleep(POLL_INTERVAL_MS);
      }
      if (state !== "Completed") fail("asr_sarvam_job_timeout", 504, { jobId });

      // 5. collect — `output_storage_path` is a directory SAS too, and the
      //    result blob is named by INPUT INDEX (`0.json`), never by the name we
      //    uploaded. The directory is listed rather than guessed so a change to
      //    that convention surfaces as "no output" and not as a wrong file.
      const outputs = await listDirectory(fetchImpl, outputPath);
      const first = outputs.find((name) => name.toLowerCase().endsWith(".json"));
      if (!first) fail("asr_sarvam_output_missing", 502, { jobId });
      const payload = await json(fetchImpl, inDirectory(outputPath, first), { headers: { Accept: "application/json" } }, "asr_sarvam_output");
      return asrResult({
        turns: turnsFrom(payload), provider: NAME, model,
        ...languageEvidence(payload, language),
      }, { name: NAME, model });
    },
  });
}
