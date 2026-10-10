import { useCallback, useEffect, useMemo, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import {
  VIDEO_ATTESTATIONS,
  type VideoAttestation,
  type VideoEnrollResult,
  type VideoEnrollView,
  type YouTubeVideoMetadata,
  enrollFromVideoLink,
  inspectYouTubeVideo,
  loadVideoEnrollments,
} from "./videoEnrollApi";
import "./video-enroll.css";

const ATTESTATION_COPY: Record<VideoAttestation, string> = {
  owns_or_controls_channel: "I own or control this channel.",
  is_rights_holder_of_uploads: "I hold the rights to this video.",
  authorizes_audio_extraction_for_own_replica:
    "I allow Vyakti to extract this video's audio for my own clone.",
  understands_tos_exposure_is_not_copyright_permission:
    "I understand that owning this content does not change YouTube's service terms.",
  understands_revocation_stops_extraction:
    "I understand that withdrawing permission stops extraction and deletes what it produced.",
};

const REASON_COPY: Record<string, string> = {
  channel_extract_extractor_bot_check:
    "YouTube asked our server to sign in and prove it is not a bot. Your video is not the problem. Download your own video from YouTube Studio and upload the file instead.",
  channel_extract_extractor_po_token_required:
    "YouTube asked for a proof token that this importer does not have yet. Upload your own video file instead.",
  channel_extract_extractor_signature_failed:
    "Our YouTube importer needs an update. Upload your own video file while we fix it.",
  channel_extract_video_unavailable:
    "YouTube says this video is private, restricted, or unavailable. Check its visibility, then try again.",
  channel_binding_mismatch:
    "This video does not belong to the channel you approved. Check the link and try again.",
  channel_extraction_unavailable:
    "YouTube import is not connected on this deployment. Upload your own video file instead.",
  video_metadata_unreachable: "We could not reach YouTube to check that link. Try again in a moment.",
  video_metadata_not_found: "YouTube could not find that video. Check the link and its visibility.",
  video_metadata_unavailable: "YouTube could not return details for that video right now.",
  video_metadata_response_invalid: "YouTube returned video details we could not read.",
  video_metadata_channel_invalid: "We found the video but could not verify its channel.",
  video_enroll_owner_daily_cap:
    "You have reached today's video-import limit. It resets at midnight UTC.",
  video_enroll_global_daily_cap:
    "The shared video-import limit has been reached. Try again after midnight UTC.",
  video_enroll_duration_over_cap: "This video is longer than the current import limit.",
  video_enroll_bytes_over_cap: "This video's audio is larger than the current import limit.",
  video_enroll_no_usable_window:
    "We could not find ten continuous seconds of clear, single-speaker audio. Try a video with less music, overlap, or background noise.",
  video_url_not_a_video: "That looks like a channel or playlist. Paste a link to one video.",
  video_url_not_youtube: "This importer accepts YouTube video links today.",
  video_enroll_attestation_not_live:
    "Permission for this channel has expired or been withdrawn. Approve it again to continue.",
  asr_unavailable:
    "We prepared the voice section, but transcription was unavailable, so no text context was added.",
  replica_not_found: "We could not find this clone under your account.",
  slow_down: "Too many requests arrived together. Wait a moment, then try again.",
};

function reasonFor(code: string): string {
  return REASON_COPY[code] || code;
}

function clock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "Unknown";
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

interface Props {
  token: string;
  replicaId: string;
  testEnvironment?: boolean;
  onUseFileUpload?: () => void;
}

export default function VideoEnrollPanel({
  token,
  replicaId,
  testEnvironment = false,
  onUseFileUpload,
}: Props) {
  const [view, setView] = useState<VideoEnrollView | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VideoEnrollResult | null>(null);
  const [metadata, setMetadata] = useState<YouTubeVideoMetadata | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const nextView = await loadVideoEnrollments(token, replicaId);
      if (!nextView
        || !Array.isArray(nextView.enrollments)
        || !nextView.limits
        || !Number.isFinite(nextView.limits.perOwnerPerDay)
        || !Number.isFinite(nextView.limits.maxDurationMs)
        || typeof nextView.extraction_configured !== "boolean") {
        throw new Error("video_enroll_response_invalid");
      }
      setView(nextView);
    } catch (loadError) {
      setError(loadError instanceof ReplicaApiError ? reasonFor(loadError.message) : "Could not load video import.");
    }
  }, [token, replicaId]);

  useEffect(() => {
    setVideoUrl("");
    setChannelUrl("");
    setTicked({});
    setResult(null);
    setMetadata(null);
    setError("");
    void refresh();
  }, [refresh]);

  const allTicked = useMemo(
    () => testEnvironment || VIDEO_ATTESTATIONS.every((key) => ticked[key] === true),
    [testEnvironment, ticked],
  );

  const inspect = useCallback(async () => {
    setChecking(true);
    setError("");
    setMetadata(null);
    setChannelUrl("");
    try {
      const found = await inspectYouTubeVideo(token, videoUrl.trim());
      setMetadata(found);
      setChannelUrl(found.channel_url);
    } catch (inspectError) {
      setError(
        inspectError instanceof ReplicaApiError
          ? reasonFor(inspectError.message)
          : "We could not check that video. Try again.",
      );
    } finally {
      setChecking(false);
    }
  }, [token, videoUrl]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const attestations = Object.fromEntries(
        VIDEO_ATTESTATIONS.map((key) => [key, true]),
      ) as Record<VideoAttestation, boolean>;
      const outcome = await enrollFromVideoLink(token, replicaId, {
        videoUrl: videoUrl.trim(),
        channelUrl,
        attestations,
      });
      setResult(outcome);
      await refresh();
    } catch (submitError) {
      setError(
        submitError instanceof ReplicaApiError
          ? reasonFor(submitError.message)
          : "We could not import that video. Try the file upload instead.",
      );
    } finally {
      setBusy(false);
    }
  }, [token, replicaId, videoUrl, channelUrl, refresh]);

  const window = result?.enrollment.reference_window;
  const extractionUnavailable = view?.extraction_configured === false;
  const canSubmit = Boolean(
    view?.extraction_configured && metadata && channelUrl && allTicked && !busy,
  );

  return (
    <section className="studio-panel video-enroll-panel" aria-labelledby="video-enroll-heading" aria-busy={busy || checking}>
      <header className="video-enroll-intro">
        <p className="video-enroll-kicker">Add context</p>
        <h2 id="video-enroll-heading">Use one YouTube video</h2>
        <p>Choose a video you own and speak in. We verify it before any audio is taken.</p>
      </header>

      {view === null && !error && (
        <p className="video-enroll-availability" role="status">Checking YouTube import availability.</p>
      )}

      {extractionUnavailable && (
        <div className="video-enroll-fallback" role="status">
          <span className="video-enroll-fallback-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <strong>Link import is not connected yet</strong>
            <p>Download your own video, then add the file. This path is available now.</p>
          </div>
          {onUseFileUpload && (
            <button className="button primary-button" type="button" onClick={onUseFileUpload}>
              Upload the file instead
            </button>
          )}
        </div>
      )}

      {view && (
        <p className="video-enroll-limit" id="video-enroll-limit">
          {view.limits.perOwnerPerDay} per day, up to {Math.round(view.limits.maxDurationMs / 60000)} minutes each.
        </p>
      )}

      <form
        className="video-enroll-check"
        onSubmit={(event) => {
          event.preventDefault();
          void inspect();
        }}
      >
        <label htmlFor="video-enroll-url">YouTube video link</label>
        <div className="video-enroll-input-row">
          <input
            id="video-enroll-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://www.youtube.com/watch?v=..."
            value={videoUrl}
            aria-describedby="video-enroll-link-help video-enroll-limit"
            onChange={(event) => {
              setVideoUrl(event.target.value);
              setMetadata(null);
              setChannelUrl("");
              setTicked({});
              setError("");
            }}
          />
          <button className="button secondary-button" type="submit" disabled={checking || !videoUrl.trim()}>
            {checking ? "Checking video" : metadata ? "Check again" : "Check video"}
          </button>
        </div>
        <small id="video-enroll-link-help">We read the title and channel before asking for permission.</small>
      </form>

      {metadata && (
        <article className="video-enroll-match" aria-live="polite">
          <span className="video-enroll-match-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="m6.5 12.5 3.4 3.4 7.6-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <span>Video found</span>
            <strong>{metadata.title}</strong>
            <small>{metadata.channel_name}</small>
            <p>Continue only if this is your video and you are the speaker.</p>
          </div>
        </article>
      )}

      {!testEnvironment && metadata && view?.extraction_configured && (
        <fieldset className="video-enroll-consent">
          <legend>Confirm before import</legend>
          {VIDEO_ATTESTATIONS.map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={ticked[key] === true}
                onChange={(event) => setTicked((prior) => ({ ...prior, [key]: event.target.checked }))}
              />
              <span>{ATTESTATION_COPY[key]}</span>
            </label>
          ))}
        </fieldset>
      )}

      {metadata && view?.extraction_configured && (
        <div className="video-enroll-actions">
          <button className="button primary-button" type="button" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? "Importing video" : "Use this video"}
          </button>
          {!testEnvironment && !allTicked && <small>Confirm every statement to continue.</small>}
        </div>
      )}

      {error && (
        <div className="video-enroll-error" role="alert">
          <span aria-hidden="true">!</span>
          <p>{error}</p>
          {onUseFileUpload && (
            <button className="button secondary-button" type="button" onClick={onUseFileUpload}>
              Upload a video file
            </button>
          )}
        </div>
      )}

      {result && window && (
        <section className="video-enroll-result" aria-labelledby="video-enroll-result-heading">
          <div>
            <span>Voice section ready</span>
            <h3 id="video-enroll-result-heading">{clock(window.start_ms)} to {clock(window.end_ms)}</h3>
          </div>
          <p>
            This section had the strongest usable speech signal in the video. The score checks recording quality, not how similar the clone sounds.
          </p>
          {!result.reference_promoted && (
            <p role="status">The section is stored, but it is not the active voice source yet.</p>
          )}
          {result.enrollment.transcript_chars ? (
            <p>We also transcribed {result.enrollment.transcript_chars.toLocaleString()} characters from the full video.</p>
          ) : (
            <p>No text transcript was added from this video.</p>
          )}
          {result.enrollment.windows && result.enrollment.windows.length > 1 && (
            <details>
              <summary>See {result.enrollment.windows.length} ranked voice sections</summary>
              <ul>
                {result.enrollment.windows.map((candidate) => (
                  <li key={candidate.start_ms}>
                    <strong>#{candidate.rank}: {clock(candidate.start_ms)} to {clock(candidate.end_ms)}</strong>
                    <span>{Math.round(candidate.voiced_fraction * 100)}% speech, {candidate.snr_db.toFixed(1)} dB signal</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {view && view.enrollments.length > 0 && (
        <details className="video-enroll-history">
          <summary>Previous video imports ({view.enrollments.length})</summary>
          <ul>
            {view.enrollments.map((enrollment) => (
              <li key={enrollment.enrollment_id}>
                <span>{enrollment.video_id}</span>
                <strong>{enrollment.state}</strong>
                {enrollment.reference_window && <small>Voice section starts at {clock(enrollment.reference_window.start_ms)}</small>}
                {enrollment.failure_code && <small>{reasonFor(enrollment.failure_code)}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
