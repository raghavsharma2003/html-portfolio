// The "one link" step (Gurukul WS-AD).
//
// Paste a link to one of your own videos and get a clone from it. That is the
// whole screen, and everything on it exists to make one of three things true
// and legible: what we are about to do, what we actually did, or exactly why
// we could not.
//
// ── the screen never says "failed" ───────────────────────────────────────
// `REASON_COPY` maps every server code this lane can produce into a sentence
// that names a next action. The one that matters most today is
// `channel_extract_extractor_bot_check`: per
// `context/measurements.md#youtube-extraction-blocked-from-azure`, YouTube
// refuses our server's IP on every player client we tried, so this is the
// state most owners will see first. Rendering it as "something went wrong"
// would make the single most important operational fact about this deploy
// invisible, and would send the owner to support instead of to the upload box
// that works. A code this map does not know renders the CODE, never a
// swallowed blank — ContextLockerPanel.tsx's rule, for the same reason.
//
// ── the first ten seconds, shown rather than claimed ─────────────────────
// The owner asked for the first-10-seconds problem to be handled. So the
// result panel does not say "handled" — it shows WHERE in their video the
// reference came from, what it scored, and how much better it was than the
// opening. `context/measurements.md#reference-window-beats-the-finetune` is
// why that number deserves the space: window choice moved fidelity three
// times as much as a fine-tune did.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import {
  VIDEO_ATTESTATIONS,
  type VideoAttestation,
  type VideoEnrollResult,
  type VideoEnrollView,
  enrollFromVideoLink,
  loadVideoEnrollments,
} from "./videoEnrollApi";

const ATTESTATION_COPY: Record<VideoAttestation, string> = {
  owns_or_controls_channel: "This is my channel. I own or control it.",
  is_rights_holder_of_uploads: "I am the rights holder of what I upload to it.",
  authorizes_audio_extraction_for_own_replica:
    "I authorise Vyakti to take the audio from this video to build MY replica.",
  understands_tos_exposure_is_not_copyright_permission:
    "I understand you can give us copyright permission for your own lecture, and that this is separate from YouTube's own terms about downloading, which nobody but YouTube can grant.",
  understands_revocation_stops_extraction:
    "I understand that withdrawing this permission stops extraction and deletes what it produced.",
};

const REASON_COPY: Record<string, string> = {
  // The state this deploy is in today. Named, with the path that works.
  channel_extract_extractor_bot_check:
    "YouTube would not serve our server. It asked it to sign in and prove it is not a bot. This happens to requests from datacentres, and it is not about your video or your permission. Until we route around it, use the file upload step instead: download your own video from YouTube Studio and hand us the file.",
  channel_extract_extractor_po_token_required:
    "YouTube asked for a proof-of-origin token our extractor does not have yet. Nothing is wrong with your video; use the file upload step for now.",
  channel_extract_extractor_signature_failed:
    "Our extractor is out of date against YouTube's player. This is ours to fix: it needs a version bump, not anything from you.",
  channel_extract_video_unavailable:
    "YouTube says this video is private, members-only or removed. Check the link is public, then try again.",
  channel_binding_mismatch:
    "That video does not belong to the channel you attested. We only take audio from a channel you have told us is yours. Paste a video from that channel, or attest the channel this video is actually on.",
  channel_extraction_unavailable:
    "Extraction is not configured on this deployment yet. The file upload step works today.",
  video_enroll_owner_daily_cap:
    "You have used your videos for today. This cap exists so open testing cannot exhaust the shared compute budget; it resets at midnight UTC.",
  video_enroll_global_daily_cap:
    "The platform has hit its shared daily limit for video enrollments. Nothing is wrong with your account. Try again after midnight UTC.",
  video_enroll_duration_over_cap: "That video is longer than this lane accepts.",
  video_enroll_bytes_over_cap: "That video's audio is larger than this lane accepts.",
  video_enroll_no_usable_window:
    "We could not find ten continuous seconds of clear single-speaker audio anywhere in this video. That usually means heavy background music, two people talking throughout, or a very noisy recording.",
  video_url_not_a_video: "That looks like a channel or playlist link. Paste a link to one video.",
  video_url_not_youtube: "We can only take YouTube links here today.",
  video_enroll_attestation_not_live:
    "The permission for that channel has been withdrawn or has expired. Attest it again to continue.",
  asr_unavailable:
    "We got your voice reference, but the transcription service was unavailable, so there is no lecture text yet.",
  replica_not_found: "We could not find that replica under your account.",
  slow_down: "Too many requests in a row. Wait a moment and try again.",
};

function reasonFor(code: string): string {
  // A code we do not recognise renders as the CODE. A list that quietly drops
  // the one row it did not understand is how a person learns nothing from the
  // screen that exists to tell them.
  return REASON_COPY[code] || code;
}

function clock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "?";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

interface Props {
  token: string;
  replicaId: string;
}

export default function VideoEnrollPanel({ token, replicaId }: Props) {
  const [view, setView] = useState<VideoEnrollView | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VideoEnrollResult | null>(null);
  const [error, setError] = useState<string>("");

  const refresh = useCallback(async () => {
    try {
      setView(await loadVideoEnrollments(token, replicaId));
    } catch (loadError) {
      // `ReplicaApiError` carries the server's code in `.message` (see
      // replicaApi.ts's constructor), not on a `.code` field. Reading a field
      // that does not exist would render `undefined` through `reasonFor` and
      // produce a blank explanation — the exact silent state this panel exists
      // to make impossible.
      setError(loadError instanceof ReplicaApiError ? reasonFor(loadError.message) : "Could not load this step.");
    }
  }, [token, replicaId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // All five, or the server refuses — so the button says so rather than
  // letting the owner discover it as an error after a round trip.
  const allTicked = useMemo(
    () => VIDEO_ATTESTATIONS.every((key) => ticked[key] === true),
    [ticked],
  );

  const submit = useCallback(async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const attestations = Object.fromEntries(
        VIDEO_ATTESTATIONS.map((key) => [key, true]),
      ) as Record<VideoAttestation, boolean>;
      const outcome = await enrollFromVideoLink(token, replicaId, { videoUrl, channelUrl, attestations });
      setResult(outcome);
      await refresh();
    } catch (submitError) {
      setError(submitError instanceof ReplicaApiError ? reasonFor(submitError.message) : "That did not go through.");
    } finally {
      setBusy(false);
    }
  }, [token, replicaId, videoUrl, channelUrl, refresh]);

  const window = result?.enrollment.reference_window;

  return (
    <section className="studio-panel" aria-labelledby="video-enroll-heading">
      <h2 id="video-enroll-heading">Make a clone from one video</h2>
      <p>
        Paste a link to one of your own videos: a lecture, a talk, anything
        where you are the one speaking. We take the audio, find the clearest ten
        seconds of your voice <em>anywhere</em> in it, and use that as the
        reference. The opening does not have to be clean.
      </p>

      {view && !view.extraction_configured && (
        <p role="status" className="studio-note">
          Extraction is not switched on for this deployment yet, so this step
          cannot run today. The file upload step works now.
        </p>
      )}

      {view && (
        <p className="studio-note">
          Up to {view.limits.perOwnerPerDay} videos a day, each up to{" "}
          {Math.round(view.limits.maxDurationMs / 60000)} minutes.
        </p>
      )}

      <label htmlFor="video-enroll-url">Link to your video</label>
      <input
        id="video-enroll-url"
        type="url"
        inputMode="url"
        placeholder="https://www.youtube.com/watch?v=…"
        value={videoUrl}
        onChange={(event) => setVideoUrl(event.target.value)}
      />

      <label htmlFor="video-enroll-channel">Your channel</label>
      <input
        id="video-enroll-channel"
        type="url"
        inputMode="url"
        placeholder="https://www.youtube.com/@yourhandle"
        value={channelUrl}
        onChange={(event) => setChannelUrl(event.target.value)}
      />
      <p className="studio-note">
        We check the video really was uploaded by this channel before we
        download anything. If it was not, we stop.
      </p>

      <fieldset>
        <legend>Before we take the audio</legend>
        {VIDEO_ATTESTATIONS.map((key) => (
          <label key={key} className="studio-check">
            <input
              type="checkbox"
              checked={ticked[key] === true}
              onChange={(event) => setTicked((prior) => ({ ...prior, [key]: event.target.checked }))}
            />
            <span>{ATTESTATION_COPY[key]}</span>
          </label>
        ))}
      </fieldset>

      <button type="button" disabled={busy || !allTicked || !videoUrl || !channelUrl} onClick={() => void submit()}>
        {busy ? "Working. This takes a few minutes." : "Make the clone from this video"}
      </button>
      {!allTicked && (
        <p className="studio-note">All five need to be true before we can start.</p>
      )}

      {error && <p role="alert" className="studio-error">{error}</p>}

      {result && window && (
        <div className="studio-result">
          <h3>Your voice reference</h3>
          <p>
            We used <strong>{clock(window.start_ms)} to {clock(window.end_ms)}</strong> of your video.
            {result.stats?.head_window_rank === null
              ? " The opening ten seconds were not usable at all, which is exactly the case this step exists for."
              : result.stats?.selected_over_head_delta
                ? ` That window scored ${result.stats.selected_over_head_delta.toFixed(3)} higher than the opening ten seconds.`
                : ""}
          </p>
          <p className="studio-note">
            Scored by {window.score_source}, a signal-quality measure of the
            recording, not a measurement of how much the clone sounds like you.
            That one needs a listening test.
          </p>
          {/* `reference_promoted` false is shown, not hidden. An owner whose
              window was ranked but never became the active reference would
              otherwise press "Preview my voice" and hear the wrong thing with
              no explanation. */}
          {!result.reference_promoted && (
            <p role="status" className="studio-note">
              This window has been chosen and stored, but it is not yet wired up
              as the voice this replica previews from.
            </p>
          )}
          {result.enrollment.transcript_chars ? (
            <p>We also transcribed the whole lecture: {result.enrollment.transcript_chars.toLocaleString()} characters, waiting for you in your sheet draft.</p>
          ) : (
            <p className="studio-note">No transcript came back for this one.</p>
          )}
          {result.enrollment.windows && result.enrollment.windows.length > 1 && (
            <details>
              <summary>The other candidates we ranked ({result.enrollment.windows.length})</summary>
              <ul>
                {result.enrollment.windows.map((candidate) => (
                  <li key={candidate.start_ms}>
                    #{candidate.rank} {clock(candidate.start_ms)} to {clock(candidate.end_ms)} · score {candidate.score?.toFixed(3)} · {Math.round(candidate.voiced_fraction * 100)}% voiced · {candidate.snr_db.toFixed(1)} dB
                    {candidate.speaker_purity === null ? " · one-speaker check did not run" : ` · ${Math.round(candidate.speaker_purity * 100)}% one speaker`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {view && view.enrollments.length > 0 && (
        <div>
          <h3>Videos you have used</h3>
          <ul>
            {view.enrollments.map((enrollment) => (
              <li key={enrollment.enrollment_id}>
                {enrollment.video_id} · {enrollment.state}
                {enrollment.reference_window
                  ? ` · reference at ${clock(enrollment.reference_window.start_ms)}`
                  : ""}
                {enrollment.failure_code ? ` · ${reasonFor(enrollment.failure_code)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
