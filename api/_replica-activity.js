// The activity read — one owner-scoped, replica-scoped answer to "what is
// happening to my stuff, and is it done?"  Gurukul WS-AF.
//
// The owner's ask, verbatim: "I should also see that have we received the YT
// video and that processing done or not, and all the other processing going on
// we should see, in a user view."
//
// Today this platform runs seven asynchronous lanes. Every one of them has its
// own table, its own state vocabulary, its own idea of a failure code, and its
// own cron. The person who started them can see NONE of it. That is the whole
// gap, and it is a reporting gap rather than a pipeline gap: the rows exist,
// nothing reads them together.
//
// ── THE ONE SHAPE ────────────────────────────────────────────────────────
// Every lane is normalised to the same job:
//
//   { job_id, lane, subject, state, state_reason, started_at, updated_at,
//     finished_at, progress, next_action, in_flight }
//
// `state` is one of seven values, the same seven migration 060 CHECKs and the
// same seven the UI renders. A surface that has to learn a lane's private
// vocabulary is a surface that will render the eighth lane wrong.
//
// ── NEVER A FAKE PERCENTAGE ──────────────────────────────────────────────
// `progress` is `null` unless a REAL fraction exists, and in this platform
// exactly one lane has one: the enrollment DAG, where completed processing jobs
// over the eight steps of AUDIO_PROCESSING_DAG is a count of finished work over
// a known total. Every other lane returns null and says what it is doing in
// words instead.
//
// This is not fastidiousness. `plausible-return-hides-a-dead-pipeline` is the
// most expensive law in this repo, and a progress bar is its purest form: a bar
// at 60% that is driven by a status ladder rather than by work tells the owner
// that something is happening at the exact moment nothing is. A transcription
// of a two-hour lecture is not "half done" when the row says `transcribed`,
// because `transcribed` is the END of the expensive part; a bar built on that
// ladder would crawl and then jump, which is worse than no bar because it is
// specific. Words that name the stage cannot lie about the remainder.
//
// ── A FAILURE REPORTS WHY, IN WORDS THE OWNER CAN ACT ON ─────────────────
// Every lane in this repo stores a failure CODE. A code is for us. `reasonFor`
// below turns the codes we actually emit into sentences, and its fallback is
// the code with its underscores opened out rather than a generic apology, so an
// unmapped code degrades to something a person can still search for and quote
// at us, never to "Something went wrong".
//
// ── OWNERSHIP IS A SQL PREDICATE ─────────────────────────────────────────
// Every statement below carries `owner_user_id = $2::uuid` in its own WHERE,
// including the seven that run after the ownership check has already passed.
// That is deliberate duplication: the check is a gate, the predicates are the
// guarantee, and a future refactor that drops the gate must not silently widen
// the reads. Nothing is ever filtered in JavaScript.
//
// ── the reads run in parallel ────────────────────────────────────────────
// This endpoint is polled. Eight sequential SQL-over-HTTP round trips would put
// the poll interval's worth of latency into every render, so the ownership
// check is one round trip and the seven lane reads are one more.

/** The seven states every lane is normalised to. */
export const ACTIVITY_STATES = Object.freeze([
  "queued", "running", "waiting_on_you", "done", "failed", "blocked", "cancelled",
]);

/** What moves a job forward, which is what decides whether polling is honest.
 *
 *  `worker`   a leased worker or an inline call moves this within seconds to
 *             minutes. A queued job here is genuinely in flight: poll.
 *  `schedule` a cron moves this on its own clock (the channel sweep). Queued
 *             here can mean "in an hour". Polling would spin for an hour and
 *             report nothing, so a queued schedule-lane job is NOT in flight.
 *  `nobody`   nothing in this repo runs it. Saying so is the whole point of
 *             the row. Never in flight, and the reason says why out loud.
 */
export const ACTIVITY_LANES = Object.freeze({
  upload_processing: Object.freeze({
    label: "Recordings you uploaded",
    advances_on: "worker",
    // The only lane with a real denominator.
    measurable: true,
  }),
  channel_video: Object.freeze({ label: "Videos from your channel", advances_on: "schedule", measurable: false }),
  channel_watch: Object.freeze({ label: "Your channel connection", advances_on: "schedule", measurable: false }),
  context_item: Object.freeze({ label: "Files and links you added", advances_on: "worker", measurable: false }),
  voice_model_build: Object.freeze({ label: "Building your voice", advances_on: "worker", measurable: false }),
  mirror_finetune: Object.freeze({ label: "Practice call training", advances_on: "nobody", measurable: false }),
  erasure: Object.freeze({ label: "Deleting your replica", advances_on: "worker", measurable: false }),
});

/** The eight steps of AUDIO_PROCESSING_DAG. Duplicated as a NUMBER rather than
 *  imported, because api/_replica-processing/pipeline.js is on the worker's
 *  import path and this module is on the request path; the eval asserts the two
 *  agree, which is the check that would catch a ninth step being added. */
export const AUDIO_DAG_STEPS = 8;

// The one import this module allows itself, and why it is not the thing the
// note above refuses. `capability-codes.js` is a leaf: two frozen constants and
// a predicate, no provider chain, no database, no pipeline. Importing it does
// not put the worker's import path on the request path, and duplicating five
// exact strings that decide whether the owner is told to re-upload a file would
// be the worse trade. WS-AH.
import { isCapabilityAbsence } from "./_replica-processing/capability-codes.js";

export class ActivityError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value, code) {
  const id = String(value || "").trim();
  if (!UUID.test(id)) throw new ActivityError(code, 400);
  return id;
}

const iso = (value) => (value ? new Date(value).toISOString() : null);

// ── failure codes, in words ───────────────────────────────────────────────
// Only codes this repo actually emits. Anything not here degrades through
// `openOut` rather than through a generic sentence, because a generic sentence
// is indistinguishable from a bug and cannot be searched for.
const REASONS = Object.freeze({
  channel_extract_extractor_bot_check:
    "YouTube asked our server to prove it is not a robot, so the audio could not be downloaded. This is a known limit of downloading from a datacentre and it is not caused by anything you did.",
  channel_extract_login_required:
    "YouTube would not release this video without a signed-in account.",
  storage_metadata_incomplete:
    "The uploaded file never finished landing in storage, so nothing could read it.",
  integrity_mismatch:
    "The file that arrived does not match the file that was sent. Nothing was processed from it.",
  malware_detected:
    "The scan found something harmful in this file, so it was quarantined and not processed.",
  processing_dependency_missing:
    "An earlier step in the pipeline has not finished, so this one cannot start.",
  transport_signature_invalid:
    "The voice service rejected our request signature. This usually means the service was asleep and took longer to wake than the signature stays valid for.",
  lost_processing_lease:
    "A worker was interrupted while holding this job. It will be picked up again.",
  replica_revoked: "You revoked this replica, so the job was stopped.",
  no_audio_stream: "This file has no audio track in it.",
  asr_unavailable: "The transcription service could not be reached.",

  // ── capability absences (WS-AH) ─────────────────────────────────────────
  // These five are not about the recording. They say that a piece of OUR
  // pipeline is not deployed or not configured in the runtime that picked the
  // job up. Each one names the missing piece, says the recording is fine, and
  // says what happens next without asking the owner to do anything, because
  // there is nothing they can do and a button that cannot help is worse than
  // no button. `isCapabilityAbsence` routes them to a wait action below.
  private_storage_not_configured:
    "Your recording is safe in storage, but the server that processes it is missing the key that lets it read private files, so it has not started. This is on us, not on your file. It will start on its own once the key is in place.",
  malware_scanner_unavailable:
    "Your recording passed the first check. The virus scanner is not running on the machine that picked this up, and we will not mark a file as clean without actually scanning it. This is on us, not on your file. It will carry on by itself once the scanner is running.",
  media_probe_tool_unavailable:
    "Your recording passed the first checks. The tool that reads the audio track is not installed on the machine that picked this up, so we cannot yet tell how long it is or how it was encoded. This is on us, not on your file. It will carry on by itself once the tool is installed.",
  reference_window_tool_unavailable:
    "Your recording passed diarization. The tool that trims your voice down to the short reference clip is not installed on the machine that picked this up. This is on us, not on your file. It will carry on by itself once the tool is installed.",
  voice_evidence_unconfigured:
    "Your recording got as far as the voice analysis, which runs on a separate service that is not switched on yet. This is on us, not on your file. It will carry on by itself once that service is connected.",
  asr_unconfigured:
    "Your recording got as far as the transcription step, and the transcription service is not connected yet. This is on us, not on your file. It will carry on by itself once that service is connected.",
  // ── extraction routes (WS-AI) ───────────────────────────────────────────
  //
  // These are the only failure codes in this file whose fix is not ours and is
  // not the owner re-uploading something. They are "somebody has to switch a
  // route on", and the whole reason the route table names them separately is
  // that "extraction failed" sends the owner looking in the wrong place. Every
  // one of them pairs with a next action in `ROUTE_NEXT_ACTIONS` below, because
  // a reason with no action is a reason a person cannot act on.
  channel_extract_no_route_configured:
    "No way of reaching YouTube is switched on for this deployment, so the audio was not downloaded.",
  channel_extract_route_unknown:
    "This deployment names a way of reaching YouTube that this build does not know about.",
  channel_extract_route_proxy_credential_missing:
    "This deployment is set to reach YouTube through a proxy, but no proxy address has been given to it.",
  channel_extract_route_proxy_url_invalid:
    "The proxy address given to this deployment is not a usable address.",
  channel_extract_route_cookies_credential_missing:
    "This deployment is set to reach YouTube with a signed-in session, but no session file has been given to it.",
  channel_extract_route_cookies_credential_invalid:
    "The signed-in session file given to this deployment could not be read.",
  channel_extract_route_provider_not_named:
    "This deployment is set to use an outside download service, but no service has been named.",
  channel_extract_route_provider_unknown:
    "This deployment names an outside download service that this build cannot speak to.",
  channel_extract_route_provider_credential_missing:
    "This deployment is set to use an outside download service, but no key for it has been given.",
  channel_extract_route_provider_adapter_unavailable:
    "An outside download service is configured, but no adapter for it is built yet, so nothing was downloaded.",
  channel_extract_route_pot_provider_missing:
    "This deployment is set to use a proof of origin helper, but the helper address is missing.",
  channel_extract_route_pot_provider_invalid:
    "The proof of origin helper address given to this deployment is not a usable address.",
  channel_extract_route_unreported:
    "The download service did not say which route it used, so we did not record where the audio came from and did not keep it.",
  channel_extract_route_mismatch:
    "The download service used a different route than it was asked to use, so the audio was not kept.",
  channel_extract_service_not_configured:
    "No download service is connected to this deployment, so audio cannot be taken from YouTube here.",
});

/** What the owner can actually DO about a route failure.
 *
 *  `normaliseChannelVideo`'s default for a failed video is "the next channel
 *  check will try this video again", which is true for a transient extractor
 *  failure and FALSE for every code above: nothing retries its way out of a
 *  missing credential, and telling somebody to wait for a retry that cannot
 *  succeed is worse than telling them nothing. So the route codes carry their
 *  own action and the default applies only where waiting is the honest answer.
 *
 *  `kind: "owner_setup"` rather than `retry` or `fix_input`: the fix is not in
 *  the studio and it is not a file the teacher can upload. It is a deployment
 *  setting, and the surface should say so rather than offering a button. */
const ROUTE_NEXT_ACTIONS = Object.freeze({
  channel_extract_no_route_configured: "Choose how this deployment reaches YouTube and set it up",
  channel_extract_route_unknown: "Correct the route name in the deployment settings",
  channel_extract_route_proxy_credential_missing: "Add the proxy address to the deployment settings",
  channel_extract_route_proxy_url_invalid: "Correct the proxy address in the deployment settings",
  channel_extract_route_cookies_credential_missing: "Add the signed-in session file to the deployment settings",
  channel_extract_route_cookies_credential_invalid: "Replace the signed-in session file in the deployment settings",
  channel_extract_route_provider_not_named: "Name the outside download service in the deployment settings",
  channel_extract_route_provider_unknown: "Correct the outside download service name in the deployment settings",
  channel_extract_route_provider_credential_missing: "Add the outside download service key to the deployment settings",
  channel_extract_route_provider_adapter_unavailable: "Pick a route this build supports, or wait for the adapter",
  channel_extract_route_pot_provider_missing: "Add the proof of origin helper address to the deployment settings",
  channel_extract_route_pot_provider_invalid: "Correct the proof of origin helper address in the deployment settings",
  channel_extract_route_unreported: "Update the download service to a build that reports its route",
  channel_extract_route_mismatch: "Check the download service settings against the route this deployment asked for",
  channel_extract_service_not_configured: "Connect a download service, or add captions by hand instead",
  // Not a credential, and retrying does not help either: WS-AD measured all ten
  // player clients refused from a datacenter egress, so the fix is a different
  // egress and that is a decision, not a wait.
  channel_extract_extractor_bot_check: "Switch this deployment to a proxy route, or add captions by hand instead",
});

/** The route action for a code, or null when waiting really is the answer. */
export function routeNextAction(code) {
  const label = ROUTE_NEXT_ACTIONS[String(code || "").trim()];
  return label ? Object.freeze({ kind: "owner_setup", label }) : null;
}

/** A code with its underscores opened out, first letter raised, full stop
 *  added. Deliberately NOT a friendly rewrite: the owner can quote this back at
 *  us and we can grep for it. */
function openOut(code) {
  const words = String(code || "").replaceAll("_", " ").trim();
  if (!words) return "";
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
}

export function reasonFor(code, fallback = "") {
  const key = String(code || "").trim();
  if (!key) return fallback;
  return REASONS[key] || openOut(key) || fallback;
}

// ── subjects ──────────────────────────────────────────────────────────────

/** What an uploaded recording is called on screen.
 *
 *  It is NOT the filename, and cannot be: api/_replica-source.js records
 *  `filename_retained: false` in the source's provenance on purpose, so the
 *  original name was never written down. Inventing one would be a fabricated
 *  record. What we honestly have is the kind, how long it runs and how big it
 *  is, and for a person who uploaded three recordings this morning the duration
 *  is in practice the thing that tells them apart.
 */
export function uploadSubject(row) {
  const kind = String(row?.kind || "file");
  const noun = kind === "audio" ? "Audio recording" : kind === "video" ? "Video recording" : `${openOut(kind).replace(/\.$/, "")} file`;
  const ms = Number(row?.duration_ms || 0);
  if (ms > 0) {
    const seconds = Math.round(ms / 1000);
    const shown = seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
    return `${noun}, ${shown}`;
  }
  const bytes = Number(row?.byte_size || 0);
  if (bytes > 0) {
    const mb = bytes / (1024 * 1024);
    return `${noun}, ${mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`}`;
  }
  return noun;
}

// ── the normalisers, one per lane, all pure ───────────────────────────────
//
// Pure on purpose: `dead-writers`, and the fact that this environment has no
// database. A normaliser that only runs inside a SQL callback is a normaliser
// no eval can drive with the awkward row.

const job = (fields) => Object.freeze({
  progress: null,
  state_reason: "",
  finished_at: null,
  next_action: Object.freeze({ kind: "none", label: "" }),
  ...fields,
  // The lane's OWN primary key, unprefixed. `job_id` is namespaced so two lanes
  // cannot collide in a React key; `ref` is what an action has to send back to
  // the endpoint that owns the row. Derived here rather than repeated in seven
  // normalisers, so the two can never disagree.
  ref: String(fields.job_id).slice(String(fields.job_id).indexOf(":") + 1),
  in_flight: fields.state === "running" ||
    (fields.state === "queued" && ACTIVITY_LANES[fields.lane]?.advances_on === "worker"),
});

const action = (kind, label) => Object.freeze({ kind, label });

/** An uploaded recording, plus the rollup of its processing jobs.
 *
 *  The blocked case here is the one worth reading twice. `initialProcessingSteps`
 *  in api/_replica-processing/pipeline.js returns [] for every kind that is not
 *  audio or video, by design ("other source kinds stay quarantined until their
 *  own reviewed DAG exists"). So a document uploaded through this lane sits at
 *  `quarantined` for ever and looks, on every existing screen, exactly like one
 *  that is being worked on. It is reported here as blocked with the reason
 *  stated, because a lane that is not built is a thing to say, not to animate.
 */
export function normaliseUpload(row) {
  const base = {
    job_id: `upload_processing:${row.source_id}`,
    lane: "upload_processing",
    subject: uploadSubject(row),
    started_at: iso(row.created_at),
    updated_at: iso(row.last_job_at || row.updated_at),
  };
  const stepsDone = Number(row.steps_done || 0);
  const dagKind = row.kind === "audio" || row.kind === "video";
  const progress = dagKind && stepsDone > 0
    ? Object.freeze({ done: Math.min(stepsDone, AUDIO_DAG_STEPS), total: AUDIO_DAG_STEPS, unit: "steps" })
    : null;

  if (row.state === "rejected") {
    return job({ ...base, state: "failed", finished_at: iso(row.updated_at),
      state_reason: reasonFor(row.rejection_code, "This recording was rejected and no reason was recorded."),
      // NOT `retry`. Nothing on the server can re-run this: the bytes were
      // rejected and only the owner can supply different ones. A one-click
      // button here would call an endpoint that cannot help, which is a worse
      // failure than no button.
      next_action: action("fix_input", "Upload this recording again") });
  }
  if (row.state === "deleting") {
    return job({ ...base, state: "cancelled", finished_at: iso(row.updated_at),
      state_reason: "You asked for this recording to be deleted." });
  }
  if (row.state === "pending_upload") {
    // THE ONE SAFE ONE-CLICK RETRY IN THIS PLATFORM, and it is safe for a
    // specific reason. `replicaObjectInfo` parsed a HEAD-style storage route as
    // JSON, so EVERY finalize failed closed and every upload in this product's
    // history is sitting here (`plausible-return-hides-a-dead-pipeline`, defect
    // 1). The bytes ARE in storage; only the finalize hop failed. Re-running
    // finalize needs nothing from the owner's disk, changes nothing if the
    // source has since moved on (it answers 409 `source_state_changed`), and is
    // the difference between an owner losing a recording and getting it back.
    return job({ ...base, state: "queued",
      state_reason: "The file has not been confirmed as received yet. If you already uploaded it, the last step can be run again.",
      next_action: action("retry", "Finish this upload") });
  }
  if (row.failure_code || row.failure_state) {
    const blocked = row.failure_state === "blocked";
    // A capability absence is NOT a failed recording, and must not be dressed
    // as one. The bytes are fine; a piece of our own pipeline is missing, and
    // the sweep puts the job back by itself the moment that piece arrives
    // (`requeueRecoveredProcessingJobs`). So it reports as still waiting, with
    // a wait action, and never as "upload this again", which would send the
    // owner to re-upload a 32.9 MB file to fix a problem on our side.
    //
    // The state is `blocked` rather than `queued` for the reason the non-audio
    // case above gives: `queued` in this lane means in_flight, and nothing is
    // in flight here. A stopped job that spins a progress indicator is the
    // animated lie this whole surface exists to stop telling.
    if (isCapabilityAbsence(row.failure_code)) {
      return job({ ...base, state: "blocked", progress,
        updated_at: iso(row.last_job_at || row.updated_at),
        state_reason: reasonFor(row.failure_code),
        next_action: action("wait", "It will carry on by itself once that part is running") });
    }
    return job({ ...base, state: blocked ? "blocked" : "failed", progress,
      finished_at: iso(row.last_job_at || row.updated_at),
      state_reason: reasonFor(row.failure_code, `The ${String(row.failed_step || "processing").replaceAll("_", " ")} step stopped and no reason was recorded.`),
      next_action: blocked ? action("none", "") : action("fix_input", "Upload this recording again") });
  }
  if (row.state === "ready") {
    return job({ ...base, state: "done", progress, finished_at: iso(row.updated_at),
      state_reason: "Processed. This recording is ready to use." });
  }
  if (!dagKind) {
    return job({ ...base, state: "blocked",
      state_reason: "Only audio and video are processed today, so nothing has read this file yet.",
      next_action: action("none", "") });
  }
  if (row.state === "uploaded") {
    return job({ ...base, state: "queued", state_reason: "Received. Waiting for a worker to pick it up." });
  }
  const step = String(row.active_step || "").replaceAll("_", " ");
  return job({ ...base, state: "running", progress,
    state_reason: step ? `Working on it: ${step}.` : "Working on it." });
}

/** One video from a watched channel. This is the row the owner's question is
 *  literally about, so it is the one place a missing title is worth a sentence
 *  rather than a blank: a run opened before migration 060 has no title, and the
 *  surface says the id is all we kept rather than pretending the id is a name. */
export function normaliseChannelVideo(row) {
  const titled = String(row.video_title || "").trim();
  const base = {
    job_id: `channel_video:${row.run_id}`,
    lane: "channel_video",
    subject: titled || `Video ${row.video_ref}`,
    started_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
  const count = Number(row.proposed_delta_count || 0);
  if (row.status === "failed") {
    return job({ ...base, state: "failed", finished_at: iso(row.updated_at),
      state_reason: reasonFor(row.failure_code, "This video stopped part way through and no reason was recorded."),
      // There is no per-video retry op in this repo. The next channel check
      // re-opens a failed run (api/_channel-ingest.js openRun's `on conflict
      // ... where status = 'failed'`), so the honest affordance is the truth
      // about what happens next, not a button that calls nothing.
      //
      // EXCEPT when the code says the retry cannot succeed. A missing proxy
      // credential does not resolve itself on the next sweep, and "we will try
      // again" is then a promise the system cannot keep. `routeNextAction`
      // returns null for every code where waiting IS the answer, so the
      // default below is unchanged for everything it does not name.
      next_action: routeNextAction(row.failure_code) ||
        action("wait", "The next channel check will try this video again") });
  }
  if (row.status === "applied") {
    return job({ ...base, state: "done", finished_at: iso(row.decided_at || row.updated_at),
      state_reason: "You accepted what we learned from this video." });
  }
  if (row.status === "rejected") {
    return job({ ...base, state: "cancelled", finished_at: iso(row.decided_at || row.updated_at),
      state_reason: "You turned down what we learned from this video. Nothing was changed." });
  }
  if (row.status === "proposed") {
    return job({ ...base, state: "waiting_on_you",
      state_reason: count === 1
        ? "Watched and transcribed. One suggestion is waiting for you."
        : `Watched and transcribed. ${count} suggestions are waiting for you.`,
      next_action: action("review", "Review the suggestions") });
  }
  if (row.status === "transcribed") {
    return job({ ...base, state: "running", state_reason: "Transcribed. Reading it for the way you speak." });
  }
  return job({ ...base, state: "running", state_reason: "Received. Getting the words out of it." });
}

/** The channel connection itself. A standing subscription rather than a job,
 *  which is why it never reports `running`: nothing about a watch is executing
 *  between sweeps, and a row that pulsed for ever would keep the poller awake
 *  for ever. */
export function normaliseChannelWatch(row) {
  const base = {
    job_id: `channel_watch:${row.watch_id}`,
    lane: "channel_watch",
    subject: row.channel_url || "Your channel",
    started_at: iso(row.created_at),
    updated_at: iso(row.last_checked_at || row.created_at),
  };
  if (row.status === "revoked") {
    return job({ ...base, state: "cancelled", finished_at: iso(row.last_checked_at || row.created_at),
      state_reason: "You disconnected this channel." });
  }
  if (row.status === "paused") {
    return job({ ...base, state: "cancelled", state_reason: "This channel is paused, so it is not being checked." });
  }
  if (row.last_sweep_state === "failed") {
    return job({ ...base, state: "failed", finished_at: iso(row.last_checked_at),
      state_reason: reasonFor(row.last_sweep_reason, "The last check of this channel failed and no reason was recorded."),
      // There is no "check now" op in this repo. The sweep is a cron and it
      // retries on its own clock, so the honest affordance is to say so. A
      // button labelled "check again" that called nothing would be the
      // interface equivalent of a fake progress bar.
      // Same exception as the per-video lane: a route with no credential is
      // not something the next cron tick fixes.
      next_action: routeNextAction(row.last_sweep_reason) ||
        action("wait", "The next scheduled check will try again") });
  }
  if (!row.last_checked_at) {
    return job({ ...base, state: "queued",
      state_reason: "Connected. The first check has not run yet.",
      next_action: action("wait", "The channel check runs on a schedule and has not reached this one yet") });
  }
  const found = Number(row.last_sweep_videos || 0);
  return job({ ...base, state: "done", finished_at: iso(row.last_checked_at),
    state_reason: found > 0
      ? `Checked. ${found} new ${found === 1 ? "video" : "videos"} picked up.`
      : "Checked. No new videos since the last look." });
}

/** A file or link from the Context Locker (WS-AB). Its own table already names
 *  its refusals and its skip reasons, which makes it the best-reported lane in
 *  the platform and the model the other six are being pulled toward. */
export function normaliseContextItem(row) {
  const base = {
    job_id: `context_item:${row.item_id}`,
    lane: "context_item",
    subject: row.source_name || row.source_url || "Untitled item",
    started_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
  if (row.status === "refused") {
    return job({ ...base, state: "blocked", finished_at: iso(row.updated_at),
      state_reason: reasonFor(row.refusal_reason, "This item was refused and no reason was recorded.") });
  }
  if (row.status === "routed") {
    // `routed_to` already carries its own "_lane" suffix (see
    // `routed_elsewhere` in `_context-locker.js`: `"channel_lane"`,
    // `"voice_evidence_lane"`), so appending the word "lane" again below
    // produced "Sent to the channel lane lane" in production. Strip a
    // trailing lane name before adding the one this sentence supplies, so the
    // fix holds regardless of whether a future route ever stops carrying it.
    const routedName = String(row.routed_to).replaceAll("_", " ").replace(/\s*lane$/i, "");
    return job({ ...base, state: "done", finished_at: iso(row.updated_at),
      state_reason: `Sent to the ${routedName} lane, which is where this kind of thing belongs.` });
  }
  if (row.status === "mined") {
    return row.run_id
      ? job({ ...base, state: "waiting_on_you",
          state_reason: "Read, and there are suggestions waiting for you.",
          next_action: action("review", "Review the suggestions") })
      : job({ ...base, state: "done", finished_at: iso(row.updated_at),
          state_reason: "Read. Nothing in it changed what we know about you." });
  }
  if (row.status === "extracted") {
    if (row.mine_skip_reason) {
      return job({ ...base, state: "blocked", finished_at: iso(row.updated_at),
        state_reason: reasonFor(row.mine_skip_reason, "We read this but could not use it, and no reason was recorded."),
        next_action: action("fix_input", "Tell us who you are in it") });
    }
    return job({ ...base, state: "running", state_reason: "Text pulled out. Reading it now." });
  }
  return job({ ...base, state: "queued", state_reason: "Received. Nothing has read it yet." });
}

export function normaliseModelBuild(row) {
  const base = {
    job_id: `voice_model_build:${row.build_id}`,
    lane: "voice_model_build",
    subject: row.build_kind === "voice_genome" ? "Your voice model" : "Your person model",
    started_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
  if (row.state === "failed") {
    return job({ ...base, state: "failed", finished_at: iso(row.updated_at),
      state_reason: reasonFor(row.failure_code, "The build stopped and no reason was recorded."),
      next_action: action("wait", "It will be tried again automatically") });
  }
  if (row.state === "retired") {
    return job({ ...base, state: "cancelled", finished_at: iso(row.updated_at),
      state_reason: "A newer build replaced this one." });
  }
  if (row.state === "approved") {
    return job({ ...base, state: "done", finished_at: iso(row.updated_at), state_reason: "Built and approved." });
  }
  if (row.state === "review") {
    return job({ ...base, state: "waiting_on_you", state_reason: "Built. It needs your go-ahead before it is used.",
      next_action: action("review", "Look at the build") });
  }
  if (row.state === "retry") {
    const attempt = Number(row.attempt || 0);
    return job({ ...base, state: "running",
      state_reason: row.failure_code
        ? `Trying again, attempt ${attempt + 1}. Last time: ${reasonFor(row.failure_code)}`
        : `Trying again, attempt ${attempt + 1}.` });
  }
  if (row.state === "queued") {
    return job({ ...base, state: "queued", state_reason: "Queued. Waiting for a machine with a spare graphics card." });
  }
  return job({ ...base, state: "running", state_reason: "Building. This takes graphics-card minutes and cannot be hurried." });
}

/** The fine-tune queued at the end of a practice call.
 *
 *  Migration 059 says it plainly: this table "has no lease columns, no attempt
 *  counter and no worker in this repo, and that absence is the honest
 *  statement". So the row means "you asked for this and nothing has run it",
 *  and that is exactly what it says here. Reporting it as `running` would be
 *  the single most convincing lie this surface could tell. */
export function normaliseFinetune(row) {
  const base = {
    job_id: `mirror_finetune:${row.job_id}`,
    lane: "mirror_finetune",
    subject: "Training from your practice call",
    started_at: iso(row.requested_at),
    updated_at: iso(row.requested_at),
  };
  if (row.state === "cancelled") {
    return job({ ...base, state: "cancelled", finished_at: iso(row.requested_at),
      state_reason: "This training request was cancelled." });
  }
  const windows = Number(row.reference_windows || 0);
  const seconds = Math.round(Number(row.reference_ms || 0) / 1000);
  return job({ ...base, state: "queued",
    state_reason: `Queued with ${windows} ${windows === 1 ? "clip" : "clips"} of your voice, about ${seconds} seconds in total. Nothing is running it yet: the training service is not connected to this platform.`,
    next_action: action("none", "") });
}

export function normaliseErasure(row) {
  const base = {
    job_id: `erasure:${row.job_id}`,
    lane: "erasure",
    subject: "Deleting everything in this replica",
    started_at: iso(row.started_at || row.requested_at),
    updated_at: iso(row.updated_at),
  };
  if (row.state === "complete") {
    return job({ ...base, state: "done", finished_at: iso(row.completed_at || row.updated_at),
      state_reason: "Everything has been deleted and a receipt was written." });
  }
  if (row.state === "blocked") {
    return job({ ...base, state: "blocked",
      state_reason: reasonFor(row.last_error_code, "Deletion is stuck and no reason was recorded.") });
  }
  if (row.state === "running") {
    return job({ ...base, state: "running", state_reason: `Deleting. Attempt ${Number(row.attempts || 0) + 1}.` });
  }
  return job({ ...base, state: "queued", state_reason: "Deletion has been asked for and is waiting to start." });
}

// ── deployment: what is honestly not connected yet ────────────────────────
//
// `honest states`, and the specific failure this closes: a lane whose worker or
// provider is absent returns zero rows, and zero rows renders as an empty list,
// and an empty list is indistinguishable from "nothing has happened yet" —
// which is a success shape for a lane that cannot work at all. So the response
// carries a per-lane deployment verdict alongside the jobs, computed from the
// same environment the workers read, and the surface renders "not connected
// yet" with the missing piece NAMED rather than an empty success.
const LANE_REQUIREMENTS = Object.freeze({
  channel_video: Object.freeze(["YOUTUBE_API_KEY|YOUTUBE_OAUTH_CLIENT_ID|MEDIA_EXTRACT_ORIGIN", "SARVAM_API_KEY", "CRON_SECRET"]),
  channel_watch: Object.freeze(["YOUTUBE_API_KEY|YOUTUBE_OAUTH_CLIENT_ID|MEDIA_EXTRACT_ORIGIN", "CRON_SECRET"]),
  voice_model_build: Object.freeze(["CRON_SECRET"]),
  // SUPABASE_SERVICE_ROLE_KEY, not SUPABASE_SERVICE_KEY. The short name exists
  // nowhere else in this repo, so this lane reported "not connected yet" while
  // it was demonstrably running: the owner's recording completed all eight
  // steps and the same screen still told them the lane was not set up. A
  // requirement list that names a variable nobody sets is worse than no list,
  // because it sends someone to configure something that is already correct.
  upload_processing: Object.freeze(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]),
  // Nothing in this repo runs a fine-tune. There is no env var that would make
  // it true, so the missing piece is named as a service rather than a variable.
  mirror_finetune: Object.freeze(["a fine-tune runner, which does not exist in this repo yet"]),
});

const PRESENT = (env, name) => name.split("|").some((key) => String(env?.[key] || "").trim().length > 0);

export function laneDeployment(env = {}) {
  return Object.keys(ACTIVITY_LANES).map((lane) => {
    const required = LANE_REQUIREMENTS[lane] || [];
    const missing = required.filter((name) => !name.includes(" ") && !PRESENT(env, name)).map((name) => name.split("|").join(" or "));
    const impossible = required.filter((name) => name.includes(" "));
    return Object.freeze({
      lane,
      label: ACTIVITY_LANES[lane].label,
      deployed: missing.length === 0 && impossible.length === 0,
      missing: Object.freeze([...missing, ...impossible]),
    });
  });
}

// ── polling ───────────────────────────────────────────────────────────────
//
// The client polls; the SERVER decides the next interval, because the server is
// the only side that knows whether anything is moving. Two rules:
//
//   1. Nothing in flight  ->  `next_poll_ms: null`, and the client STOPS. A
//      surface that keeps asking a question whose answer cannot change is a
//      surface that bills a serverless invocation every three seconds for ever.
//   2. Something in flight -> back off from 3 s toward 30 s as consecutive
//      polls come back unchanged, and reset to the floor the moment anything
//      does change. A fixed fast interval is wasteful; a fixed slow one makes
//      the surface feel dead.
//
// `POLL_FLOOR_MS` is 3 s rather than 1 s deliberately: no lane in this platform
// finishes a step in under a second, so a faster poll cannot show the owner
// anything they would not see three seconds later.
export const POLL_FLOOR_MS = 3_000;
export const POLL_CEILING_MS = 30_000;

export function nextPollMs(state = {}) {
  if (!state.inFlight) return null;
  const unchanged = Math.max(0, Number(state.unchangedPolls || 0));
  return Math.min(POLL_CEILING_MS, POLL_FLOOR_MS * 2 ** unchanged);
}

// ── the write ─────────────────────────────────────────────────────────────
//
// One insert, fail-soft, and fail-soft is the deliberate part: this table is a
// REPORT, and a report that can break the thing it reports on is worse than no
// report. api/diag.js's rule ("diagnostics must never break the product"),
// transferred. A caller therefore never awaits this for correctness, and the
// eval asserts a throwing db does not propagate.
//
// The cost of fail-soft is that a lost write is silent, which is exactly the
// failure this repo has a name for. It is accepted HERE and nowhere else in the
// lane, because the lane tables remain the source of truth for state: the
// activity row adds WHEN, never WHAT. A missing row degrades started_at and
// finished_at back to the lane table's own timestamps, which is what the read
// below already does for every row written before migration 060.
export async function recordActivity(db, entry) {
  try {
    if (typeof db !== "function") return false;
    const lane = String(entry?.lane || "");
    const state = String(entry?.state || "");
    if (!ACTIVITY_LANES[lane] || !ACTIVITY_STATES.includes(state)) return false;
    const reason = String(entry?.reason || "");
    // The CHECK in migration 060 would refuse this, and a 23514 raised inside a
    // best-effort write is a log line nobody reads. Refuse it here too, where a
    // test can see it.
    if ((state === "failed" || state === "blocked") && !reason) return false;
    await db(
      `insert into vy_replica_activity
         (replica_id, owner_user_id, lane, job_ref, subject, state, reason, dedupe_key)
       values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)
       on conflict (replica_id, dedupe_key) where dedupe_key <> '' do nothing`,
      [requireUuid(entry.replicaId, "replica_id_required"), requireUuid(entry.ownerUserId, "owner_required"),
        lane, String(entry.jobRef || "").slice(0, 200), String(entry.subject || "").slice(0, 300),
        state, reason.slice(0, 500), String(entry.dedupeKey || "").slice(0, 200)],
    );
    return true;
  } catch {
    return false;
  }
}

// ── the reads ─────────────────────────────────────────────────────────────

const LIMIT = 40;

/** Every job across every lane, for one owner's one replica.
 *
 *  Returns null when the replica is not the caller's, so the route answers 404
 *  and a stranger cannot tell an existing replica from a missing one. */
export async function readReplicaActivity(db, ownerUserId, id, options = {}) {
  const owner = requireUuid(ownerUserId, "owner_required");
  const rid = requireUuid(id, "replica_id_required");
  const env = options.env || {};

  const owned = await db(
    `select replica_id, display_name from vy_replica
      where replica_id = $1::uuid and owner_user_id = $2::uuid
        and lifecycle <> 'purging' limit 1`,
    [rid, owner],
  );
  if (!owned[0]) return null;

  const [sources, videos, watches, items, builds, finetunes, erasures, events] = await Promise.all([
    db(
      `select s.source_id, s.kind, s.mime, s.byte_size, s.duration_ms, s.state,
              s.rejection_code, s.created_at, s.updated_at,
              count(j.job_id) filter (where j.state = 'complete')::int as steps_done,
              max(j.updated_at) as last_job_at,
              (array_agg(j.step order by j.updated_at desc)
                 filter (where j.state in ('failed','blocked')))[1] as failed_step,
              (array_agg(j.failure_code order by j.updated_at desc)
                 filter (where j.state in ('failed','blocked')))[1] as failure_code,
              (array_agg(j.state order by j.updated_at desc)
                 filter (where j.state in ('failed','blocked')))[1] as failure_state,
              (array_agg(j.step order by j.updated_at desc)
                 filter (where j.state in ('leased','queued','retry')))[1] as active_step,
              max(j.attempt)::int as attempts
         from vy_replica_source s
         left join vy_replica_processing_job j
           on j.source_id = s.source_id and j.replica_id = s.replica_id
          and j.owner_user_id = s.owner_user_id
        where s.replica_id = $1::uuid and s.owner_user_id = $2::uuid
          and s.capture_mode <> 'derived'
        group by s.source_id
        order by s.created_at desc limit $3::int4`,
      [rid, owner, LIMIT],
    ),
    db(
      `select run_id, video_ref, video_title, status, failure_code, proposed_delta_count,
              decided_at, created_at, updated_at
         from vy_ingest_run
        where replica_id = $1::uuid and owner_user_id = $2::uuid
        order by created_at desc limit $3::int4`,
      [rid, owner, LIMIT],
    ),
    db(
      `select watch_id, channel_url, status, last_checked_at, last_sweep_state,
              last_sweep_reason, last_sweep_videos, created_at
         from vy_channel_watch
        where replica_id = $1::uuid and owner_user_id = $2::uuid
        order by created_at desc limit $3::int4`,
      [rid, owner, LIMIT],
    ),
    db(
      `select item_id, source_name, source_url, status, refusal_reason, routed_to,
              mine_skip_reason, run_id, created_at, updated_at
         from vy_context_item
        where replica_id = $1::uuid and owner_user_id = $2::uuid
        order by created_at desc limit $3::int4`,
      [rid, owner, LIMIT],
    ),
    db(
      `select build_id, build_kind, state, attempt, failure_code, created_at, updated_at
         from vy_replica_model_build
        where replica_id = $1::uuid and owner_user_id = $2::uuid
        order by created_at desc limit $3::int4`,
      [rid, owner, LIMIT],
    ),
    db(
      `select job_id, state, reference_windows, reference_ms, requested_at
         from vy_mirror_finetune_job
        where replica_id = $1::uuid and owner_user_id = $2::uuid
        order by requested_at desc limit $3::int4`,
      [rid, owner, LIMIT],
    ),
    db(
      `select job_id, state, attempts, last_error_code, requested_at, started_at,
              completed_at, updated_at
         from vy_replica_erasure_job
        where replica_id = $1::uuid and owner_user_id = $2::uuid
        order by requested_at desc limit $3::int4`,
      [rid, owner, LIMIT],
    ),
    // The transition log. Read as a rollup per job rather than as a feed: what
    // the shape needs from it is the two timestamps no lane table carries.
    db(
      `select lane, job_ref, min(at) as first_at, max(at) as last_at,
              max(at) filter (where state in ('done','failed','blocked','cancelled')) as ended_at
         from vy_replica_activity
        where replica_id = $1::uuid and owner_user_id = $2::uuid
        group by lane, job_ref
        order by max(at) desc limit $3::int4`,
      [rid, owner, LIMIT * 4],
    ),
  ]);

  const timeline = new Map();
  for (const row of events) timeline.set(`${row.lane}:${row.job_ref}`, row);

  // The transition log is AUTHORITATIVE for started_at and finished_at where it
  // has an entry, because a lane table's created_at is when the ROW was made
  // and its updated_at moves on every touch. Where it has none (every row that
  // predates migration 060, and every lane whose writer is not wired yet) the
  // lane table's own timestamps stand and are honestly approximate.
  const withTimeline = (entry) => {
    const seen = timeline.get(entry.job_id);
    if (!seen) return entry;
    return Object.freeze({
      ...entry,
      started_at: iso(seen.first_at) || entry.started_at,
      updated_at: iso(seen.last_at) || entry.updated_at,
      finished_at: entry.finished_at || iso(seen.ended_at),
    });
  };

  const jobs = [
    ...sources.map(normaliseUpload),
    ...videos.map(normaliseChannelVideo),
    ...watches.map(normaliseChannelWatch),
    ...items.map(normaliseContextItem),
    ...builds.map(normaliseModelBuild),
    ...finetunes.map(normaliseFinetune),
    ...erasures.map(normaliseErasure),
  ].map(withTimeline);

  // Newest activity first, and a job with no timestamp at all sorts last rather
  // than sorting as the epoch.
  jobs.sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));

  const inFlight = jobs.some((entry) => entry.in_flight);
  return {
    replica_id: rid,
    generated_at: new Date().toISOString(),
    jobs,
    lanes: laneDeployment(env),
    in_flight: inFlight,
    next_poll_ms: nextPollMs({ inFlight, unchangedPolls: Number(options.unchangedPolls || 0) }),
  };
}
