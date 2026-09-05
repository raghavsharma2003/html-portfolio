// ChannelsStudio.tsx — the Channels step: where a published clone gets put in
// front of the audience it was built for.
//
// SPEC-GURUKUL.md §8's "cloning through deployment", made self-serve. The
// whole brief for this screen is that a teacher can reach their audience
// WITHOUT anyone writing code per customer, so everything here is a form and
// a copy button, and nothing here is a support ticket.
//
// ── the credential is typed here and stored nowhere here ──────────────────
//
// The token input is uncontrolled-by-design in the sense that matters: its
// value goes straight into one request and the field is cleared in the same
// tick. It is never lifted into a state that survives the submit, never put
// in a URL, never logged, and never read back — the server returns
// `credential: "present" | null` and has no endpoint that would return more.
//
// ── the widget is FIRST, and that is a product decision ───────────────────
//
// It is the only surface that needs nobody's approval: no Meta business
// verification, no App Review, no Tech Provider enrolment, no weeks of
// waiting. A teacher who publishes a clone today can have it live on their own
// site in the time it takes to paste one line. Telegram is second for the same
// reason at a smaller scale (a bot token, no review). WhatsApp is third and
// carries its real cost in the copy. Instagram DM is not offered at all, and
// the screen says why rather than showing a button that cannot work —
// docs/gurukul/INSTAGRAM-DM-GAP.md is the long version.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import {
  listChannels,
  saveChannel,
  connectChannel,
  setChannelStatus,
  embedSnippet,
  type ChannelKind,
  type CloneChannel,
} from "./channelsApi";
import { useStudioLocale } from "./localeContext";
import type { StudioCopy } from "./copy";

interface KindSpec {
  kind: ChannelKind;
  /** What the owner pastes into `external_ref`. */
  refPlaceholder: string;
  secretPlaceholder: string;
  /** True for the one kind (`web_widget`) with no credential field. */
  hasSecret: boolean;
}

const KINDS: ReadonlyArray<KindSpec> = [
  { kind: "web_widget", refPlaceholder: "arjun-sir-physics", secretPlaceholder: "", hasSecret: false },
  { kind: "telegram", refPlaceholder: "8123456789", secretPlaceholder: "8123456789:AA…", hasSecret: true },
  { kind: "whatsapp", refPlaceholder: "1029384756…", secretPlaceholder: "EAAG…", hasSecret: true },
];

function kindCopy(kind: ChannelKind, c: StudioCopy["channelsStudio"]) {
  if (kind === "web_widget") return { title: c.webWidgetTitle, refLabel: c.webWidgetRefLabel, secretLabel: null as string | null, blurb: c.webWidgetBlurb, cost: c.webWidgetCost };
  if (kind === "telegram") return { title: c.telegramTitle, refLabel: c.telegramRefLabel, secretLabel: c.telegramSecretLabel as string | null, blurb: c.telegramBlurb, cost: c.telegramCost };
  return { title: c.whatsappTitle, refLabel: c.whatsappRefLabel, secretLabel: c.whatsappSecretLabel as string | null, blurb: c.whatsappBlurb, cost: c.whatsappCost };
}

function statusCopy(status: CloneChannel["status"], c: StudioCopy["channelsStudio"]): string {
  return status === "draft" ? c.statusDraft
    : status === "connected" ? c.statusConnected
    : status === "paused" ? c.statusPaused
    : c.statusRevoked;
}

export default function ChannelsStudio({
  token,
  replicaId,
  slug,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  /** The published clone's public slug, which is also the widget's address. */
  slug: string;
  onAuthError?: (error: ReplicaApiError) => void;
}) {
  const { t } = useStudioLocale();
  const c = t.channelsStudio;
  const [channels, setChannels] = useState<CloneChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ChannelKind | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refs, setRefs] = useState<Partial<Record<ChannelKind, string>>>({});
  const [secrets, setSecrets] = useState<Partial<Record<ChannelKind, string>>>({});
  const [copied, setCopied] = useState(false);

  const byKind = useMemo(() => {
    const map = new Map<ChannelKind, CloneChannel>();
    for (const channel of channels) map.set(channel.kind, channel);
    return map;
  }, [channels]);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ReplicaApiError && (e.status === 401 || e.status === 403)) {
        onAuthError?.(e);
        return;
      }
      // A named code, rendered as-is. `clone_unavailable` and
      // `channel_secret_store_unconfigured` are both things a teacher can act
      // on — the first by publishing, the second by telling us — and softening
      // them into "something went wrong" would remove the only actionable part.
      setError(e instanceof Error ? e.message : c.errorRequestFailed);
    },
    [onAuthError],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChannels(await listChannels(token, replicaId));
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

  const submit = useCallback(
    async (spec: KindSpec) => {
      setBusy(spec.kind);
      setNotice("");
      setError("");
      try {
        const externalRef = (refs[spec.kind] ?? (spec.kind === "web_widget" ? slug : "")).trim();
        const secret = (secrets[spec.kind] ?? "").trim();
        const channel = spec.hasSecret && secret
          ? await connectChannel(token, replicaId, spec.kind, externalRef, secret)
          : await saveChannel(token, replicaId, spec.kind, externalRef);
        // Cleared in the same tick as the response, before any re-render can
        // put it back on screen. See the header.
        setSecrets((current) => ({ ...current, [spec.kind]: "" }));
        setChannels((current) => {
          const rest = current.filter((ch) => ch.channel_id !== channel.channel_id);
          return [...rest, channel];
        });
        const title = kindCopy(spec.kind, c).title;
        setNotice(
          channel.status === "connected"
            ? c.liveNotice.split("{name}").join(title)
            : c.draftNotice.split("{name}").join(title),
        );
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, refs, secrets, slug, fail],
  );

  const changeStatus = useCallback(
    async (channel: CloneChannel, status: "connected" | "paused" | "revoked") => {
      setBusy(channel.kind);
      setError("");
      try {
        const next = await setChannelStatus(token, replicaId, channel.channel_id, status);
        setChannels((current) => current.map((ch) => (ch.channel_id === next.channel_id ? next : ch)));
        setNotice(statusCopy(next.status, c));
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, fail],
  );

  const snippet = embedSnippet(slug);

  return (
    <section className="stage-section" aria-labelledby="channels-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="channels-title">{c.title}</h2>
          <p>{c.intro}</p>
        </div>
      </div>

      <article className="teacher-sheet-card">
        <h3>{c.embedCardTitle}</h3>
        <p className="field-note">{c.embedCardBody}</p>
        <pre className="embed-snippet" aria-label={c.embedSnippetAriaLabel}><code>{snippet}</code></pre>
        <button
          className="button secondary-button"
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(snippet).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? c.copiedLabel : c.copyEmbedCode}
        </button>
        <p className="field-note">{c.disclosureNote}</p>
      </article>

      {loading ? (
        <p className="field-note" role="status">{c.loadingChannels}</p>
      ) : (
        <div className="teacher-sheet-grid">
          {KINDS.map((spec) => {
            const channel = byKind.get(spec.kind);
            const live = channel?.status === "connected";
            const retired = channel?.status === "revoked";
            const kc = kindCopy(spec.kind, c);
            return (
              <article className="teacher-sheet-card" key={spec.kind}>
                <h3>{kc.title}</h3>
                <p className="field-note">{kc.blurb}</p>
                <div className="teacher-sheet-readonly">
                  <span className="claim-meta">{c.statusLabel}</span>
                  <p>{channel ? statusCopy(channel.status, c) : c.notSetUp}</p>
                  <small>{kc.cost}</small>
                </div>

                {!retired && (
                  <>
                    <label className="field-label" htmlFor={`ref-${spec.kind}`}>{kc.refLabel}</label>
                    <input
                      id={`ref-${spec.kind}`}
                      className="field"
                      placeholder={spec.refPlaceholder}
                      value={refs[spec.kind] ?? channel?.external_ref ?? (spec.kind === "web_widget" ? slug : "")}
                      onChange={(event) => setRefs((current) => ({ ...current, [spec.kind]: event.target.value }))}
                    />

                    {kc.secretLabel && (
                      <>
                        <label className="field-label" htmlFor={`secret-${spec.kind}`}>{kc.secretLabel}</label>
                        <input
                          id={`secret-${spec.kind}`}
                          className="field"
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={channel?.credential === "present" ? c.secretOnFile : spec.secretPlaceholder}
                          value={secrets[spec.kind] ?? ""}
                          onChange={(event) => setSecrets((current) => ({ ...current, [spec.kind]: event.target.value }))}
                        />
                        <p className="field-note">{c.secretVaultNote}</p>
                      </>
                    )}

                    <div className="create-row">
                      <button
                        className="button primary-button"
                        type="button"
                        disabled={busy === spec.kind}
                        onClick={() => void submit(spec)}
                      >
                        {busy === spec.kind ? c.saving : live ? c.update : c.connect}
                      </button>
                      {channel && live && (
                        <button
                          className="button secondary-button"
                          type="button"
                          disabled={busy === spec.kind}
                          onClick={() => void changeStatus(channel, "paused")}
                        >
                          {c.pause}
                        </button>
                      )}
                      {channel && channel.status === "paused" && (
                        <button
                          className="button secondary-button"
                          type="button"
                          disabled={busy === spec.kind}
                          onClick={() => void changeStatus(channel, "connected")}
                        >
                          {c.resume}
                        </button>
                      )}
                      {channel && !retired && (
                        <button
                          className="text-button"
                          type="button"
                          disabled={busy === spec.kind}
                          onClick={() => void changeStatus(channel, "revoked")}
                        >
                          {c.retire}
                        </button>
                      )}
                    </div>
                  </>
                )}

                {retired && <p className="field-note">{c.retiredNote}</p>}
              </article>
            );
          })}

          <article className="teacher-sheet-card">
            <h3>{c.instagramTitle}</h3>
            <p className="field-note">{c.instagramNotOffered}</p>
            <div className="teacher-sheet-readonly">
              <span className="claim-meta">{c.instagramWhatMetaRequiresLabel}</span>
              <p>{c.instagramRequirement}</p>
              <small>{c.instagramNoFakeButton}</small>
            </div>
          </article>
        </div>
      )}

      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="field-note" role="status">{notice}</p>}
    </section>
  );
}
