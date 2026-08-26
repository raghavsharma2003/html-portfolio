// The ingest-channel surface (Gurukul WS-S) — where a teacher points the
// platform at their own YouTube channel and, crucially, says on the record
// that it is theirs.
//
// This is NOT `ChannelsStudio.tsx`. That one is about where the finished clone
// can be REACHED (Telegram, a web widget); this one is about where the clone's
// material COMES FROM. Two surfaces that both say "channel" and mean opposite
// directions, so they are kept apart rather than merged into a tabbed thing
// whose two halves would be confused forever.
//
// ── the order on screen is the order in the database ──────────────────────
// Attest, then watch. The button that starts the loop is disabled until a live
// attestation exists — but that is the CHEAP half. The real gate is the SQL
// predicate in `api/_channel-watch.js`, which selects the inserted row from a
// live attestation, so a client with this button forced enabled still inserts
// nothing. The disabled state is courtesy; the predicate is the rule.
//
// ── the statements are rendered, not summarized ───────────────────────────
// Every statement the server requires is shown, with its own checkbox, and the
// list comes down from the server. The one about YouTube's Terms is the one a
// friendlier UI would fold into "I agree", and it is exactly the one a teacher
// needs to have read: they can license us their copyright and they cannot
// license us YouTube's permission, and nobody should learn that afterwards.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import {
  attestChannel,
  loadChannelWatchView,
  revokeAttestation,
  setBackfill,
  setWatchStatus,
  startChannelWatch,
} from "./channelWatchApi";
import type { ChannelAttestation, ChannelWatch, ChannelWatchView } from "./channelWatchApi";

/** Plain-language renderings of the server's statement keys. If the server
 *  ever sends a key this map does not know, the KEY is shown rather than the
 *  statement being silently dropped — a consent list that quietly renders
 *  four of five items is the failure this guards against. */
const STATEMENT_COPY: Record<string, string> = {
  owns_or_controls_channel:
    "This YouTube channel is mine. I own it or I control it.",
  is_rights_holder_of_uploads:
    "I hold the rights to the videos on it, so I can license their use for my own clone.",
  authorizes_audio_extraction_for_own_replica:
    "I authorise this platform to take the AUDIO from those videos and use it to build my own clone.",
  understands_tos_exposure_is_not_copyright_permission:
    "I understand that my permission covers copyright, and that downloading from YouTube is separately restricted by YouTube's own Terms, which are a matter between YouTube and the account used and are not something my permission removes.",
  understands_revocation_stops_extraction:
    "I understand that withdrawing this permission stops all further extraction immediately.",
};

const STATUS_COPY: Record<string, string> = {
  active: "Watching. New uploads will be picked up on the next sweep.",
  paused: "Paused. Nothing will be read until you resume.",
  revoked: "Stopped. This watch will not be used again.",
};

export default function IngestChannelStudio({
  token,
  replicaId,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  onAuthError?: (error: ReplicaApiError) => void;
}) {
  const [view, setView] = useState<ChannelWatchView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ReplicaApiError && (e.status === 401 || e.status === 403)) {
        onAuthError?.(e);
        return;
      }
      // The named code, as-is. `channel_attestation_required`,
      // `channel_watch_already_active` and `channel_url_not_a_channel` are all
      // things a teacher can act on in the next click, and flattening them
      // into "something went wrong" removes the only actionable part.
      setError(e instanceof Error ? e.message : "request failed");
    },
    [onAuthError],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setView(await loadChannelWatchView(token, replicaId));
      setError("");
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [token, replicaId, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const statements = view?.statements ?? [];
  const allTicked = statements.length > 0 && statements.every((key) => ticked[key]);

  const liveFor = useCallback(
    (url: string): ChannelAttestation | undefined =>
      view?.attestations.find((a) => a.live && a.channel_url === url.trim().replace(/\/+$/, "")),
    [view],
  );

  const attest = useCallback(async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await attestChannel(token, replicaId, channelUrl.trim(), statements);
      setTicked({});
      setNotice("Recorded. You can start the import now, and you can withdraw this at any time.");
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [token, replicaId, channelUrl, statements, load, fail]);

  const start = useCallback(async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await startChannelWatch(token, replicaId, channelUrl.trim());
      setNotice("Watching. New uploads will be picked up automatically.");
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [token, replicaId, channelUrl, load, fail]);

  const act = useCallback(
    async (run: () => Promise<ChannelWatch | ChannelAttestation>, message: string) => {
      setBusy(true);
      setError("");
      try {
        await run();
        setNotice(message);
        await load();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [load, fail],
  );

  const attested = useMemo(() => liveFor(channelUrl), [liveFor, channelUrl]);

  return (
    <section className="stage-section" aria-labelledby="ingest-channel-title">
      <header className="section-heading">
        <div>
          <h2 id="ingest-channel-title">Learn from your own channel</h2>
          <p className="field-note">
            Your own lectures are the best material there is for your clone: your explanations, your
            examples, your phrasing. Point us at your channel and we will keep learning from it as you
            upload. Nothing is published from it without your review.
          </p>
        </div>
      </header>

      {loading ? (
        <p className="field-note" role="status">Loading…</p>
      ) : (
        <>
          <label className="field">
            <span>Your channel</span>
            <input
              type="url"
              inputMode="url"
              value={channelUrl}
              placeholder="https://www.youtube.com/@your-handle"
              onChange={(event) => setChannelUrl(event.target.value)}
            />
          </label>

          {!attested && (
            <fieldset className="model-consent-statements">
              <legend>Confirm this channel is yours</legend>
              <p className="field-note">
                We only ever build a clone of the person who asked for it. Before we read a single video
                we need you to confirm, on the record, that this channel is yours. All five apply.
              </p>
              {statements.map((key) => (
                <label key={key} className="model-consent-check">
                  <input
                    type="checkbox"
                    checked={Boolean(ticked[key])}
                    onChange={(event) =>
                      setTicked((current) => ({ ...current, [key]: event.target.checked }))
                    }
                  />
                  <span>{STATEMENT_COPY[key] ?? key}</span>
                </label>
              ))}
              <button
                type="button"
                className="button primary-button"
                disabled={busy || !allTicked || !channelUrl.trim()}
                onClick={() => void attest()}
              >
                Record this
              </button>
            </fieldset>
          )}

          {attested && (
            <div className="field-note" role="status">
              <p>
                Recorded {new Date(attested.granted_at).toLocaleDateString()}, valid until{" "}
                {new Date(attested.expires_at).toLocaleDateString()}.
              </p>
              <button
                type="button"
                className="button destructive-button"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => revokeAttestation(token, replicaId, attested.attestation_id),
                    "Withdrawn. Nothing further will be read from this channel.",
                  )
                }
              >
                Withdraw this permission
              </button>
            </div>
          )}

          <button
            type="button"
            className="button primary-button"
            disabled={busy || !attested || !channelUrl.trim()}
            onClick={() => void start()}
          >
            Start watching this channel
          </button>

          <ul className="model-consent-active">
            {(view?.watches ?? []).map((watch) => (
              <li key={watch.watch_id}>
                <p>
                  <strong>{watch.channel_url}</strong>: {STATUS_COPY[watch.status] ?? watch.status}
                </p>
                {!watch.attested && (
                  // A watch predating migration 057. It reads as unattested
                  // everywhere, including here, and it will extract nothing.
                  <p className="field-note">
                    This watch has no ownership record attached, so nothing will be read from it.
                    Confirm the channel above to re-enable it.
                  </p>
                )}
                <div className="voice-row-actions">
                  {watch.status !== "revoked" && (
                    <button
                      type="button"
                      className="button secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          () =>
                            setWatchStatus(
                              token,
                              replicaId,
                              watch.watch_id,
                              watch.status === "active" ? "paused" : "active",
                            ),
                          watch.status === "active" ? "Paused." : "Resumed.",
                        )
                      }
                    >
                      {watch.status === "active" ? "Pause" : "Resume"}
                    </button>
                  )}
                  {view?.extraction_available && watch.attested && watch.status === "active" && (
                    <button
                      type="button"
                      className="button secondary-button"
                      disabled={busy || watch.backfill_state === "done"}
                      onClick={() =>
                        void act(
                          () =>
                            setBackfill(
                              token,
                              replicaId,
                              watch.watch_id,
                              watch.backfill_state === "running" ? "idle" : "running",
                            ),
                          watch.backfill_state === "running"
                            ? "Stopped importing older videos. New uploads are still being watched."
                            : "Importing your older videos, oldest first. This runs a few at a time and picks up where it left off.",
                        )
                      }
                    >
                      {watch.backfill_state === "done"
                        ? "Older videos imported"
                        : watch.backfill_state === "running"
                          ? "Stop importing older videos"
                          : "Also import my older videos"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {view && !view.extraction_available && (
            // Honest rather than hidden: the deploy has no extraction service,
            // so only videos with your own uploaded captions can be read.
            <p className="field-note">
              On this deployment we can read videos that already have your own uploaded subtitles.
              Importing audio from the rest is not switched on here yet.
            </p>
          )}
        </>
      )}

      {notice && <p className="field-note" role="status">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
  );
}
