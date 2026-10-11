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

interface KindSpec {
  kind: ChannelKind;
  title: string;
  /** What the owner pastes into `external_ref`. */
  refLabel: string;
  refPlaceholder: string;
  /** What the owner pastes as the credential, or null for a web kind. */
  secretLabel: string | null;
  secretPlaceholder: string;
  blurb: string;
  /** The honest cost of this surface, stated before the owner starts. */
  cost: string;
}

const KINDS: ReadonlyArray<KindSpec> = [
  {
    kind: "web_widget",
    title: "Your website",
    refLabel: "Public slug",
    refPlaceholder: "arjun-sir-physics",
    secretLabel: null,
    secretPlaceholder: "",
    blurb: "A chat bubble on any page you control. One line of HTML, no account anywhere else.",
    cost: "Nothing to apply for. Live the moment you paste the line.",
  },
  {
    kind: "telegram",
    title: "Telegram",
    refLabel: "Bot ID",
    refPlaceholder: "8123456789",
    secretLabel: "Bot token",
    secretPlaceholder: "8123456789:AA…",
    blurb: "Your own bot, created in @BotFather, answering as your clone.",
    cost: "No review process. You create the bot and register one webhook URL we give you.",
  },
  {
    kind: "whatsapp",
    title: "WhatsApp",
    refLabel: "Phone number ID",
    refPlaceholder: "1029384756…",
    secretLabel: "Access token",
    secretPlaceholder: "EAAG…",
    blurb: "A WhatsApp Business number answering as your clone.",
    cost:
      "Needs a Meta Business account, a verified business, and a number registered to the Cloud API. " +
      "Meta's review is measured in days to weeks, and it is theirs, not ours.",
  },
];

const STATUS_COPY: Record<CloneChannel["status"], string> = {
  draft: "Not live. Finish the details below.",
  connected: "Live",
  paused: "Paused. Nothing is answered here.",
  revoked: "Revoked. This address is retired for good.",
};

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
      setError(e instanceof Error ? e.message : "request failed");
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
        const channel = spec.secretLabel && secret
          ? await connectChannel(token, replicaId, spec.kind, externalRef, secret)
          : await saveChannel(token, replicaId, spec.kind, externalRef);
        // Cleared in the same tick as the response, before any re-render can
        // put it back on screen. See the header.
        setSecrets((current) => ({ ...current, [spec.kind]: "" }));
        setChannels((current) => {
          const rest = current.filter((c) => c.channel_id !== channel.channel_id);
          return [...rest, channel];
        });
        setNotice(
          channel.status === "connected"
            ? `${spec.title} is live.`
            : `${spec.title} saved as a draft. It needs the remaining detail before it can answer.`,
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
        setChannels((current) => current.map((c) => (c.channel_id === next.channel_id ? next : c)));
        setNotice(STATUS_COPY[next.status]);
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
          <p className="eyebrow">Channels</p>
          <h2 id="channels-title">Where your clone can be reached</h2>
          <p>
            Publishing makes the clone exist. This is where it meets people. Every channel below is one you
            own: your site, your bot, your business number. You can pause or retire any of them at any time
            without asking us.
          </p>
        </div>
      </div>

      <article className="teacher-sheet-card">
        <h3>Get embed code</h3>
        <p className="field-note">
          Paste this into any page you control. It works on a plain HTML site, a WordPress theme, a Squarespace
          code block, anywhere a script tag is allowed. It sets no cookie and asks nothing of your visitors.
        </p>
        <pre className="embed-snippet" aria-label="Embed snippet"><code>{snippet}</code></pre>
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
          {copied ? "Copied" : "Copy embed code"}
        </button>
        <p className="field-note">
          Every visitor sees the same disclosure card you approved, before their first message. It is sent by us
          with the reply, not rendered by the page. A site that removed it could not hold a conversation at all.
        </p>
      </article>

      {loading ? (
        <p className="field-note" role="status">Loading channels…</p>
      ) : (
        <div className="teacher-sheet-grid">
          {KINDS.map((spec) => {
            const channel = byKind.get(spec.kind);
            const live = channel?.status === "connected";
            const retired = channel?.status === "revoked";
            return (
              <article className="teacher-sheet-card" key={spec.kind}>
                <h3>{spec.title}</h3>
                <p className="field-note">{spec.blurb}</p>
                <div className="teacher-sheet-readonly">
                  <span className="claim-meta">Status</span>
                  <p>{channel ? STATUS_COPY[channel.status] : "Not set up"}</p>
                  <small>{spec.cost}</small>
                </div>

                {!retired && (
                  <>
                    <label className="field-label" htmlFor={`ref-${spec.kind}`}>{spec.refLabel}</label>
                    <input
                      id={`ref-${spec.kind}`}
                      className="field"
                      placeholder={spec.refPlaceholder}
                      value={refs[spec.kind] ?? channel?.external_ref ?? (spec.kind === "web_widget" ? slug : "")}
                      onChange={(event) => setRefs((c) => ({ ...c, [spec.kind]: event.target.value }))}
                    />

                    {spec.secretLabel && (
                      <>
                        <label className="field-label" htmlFor={`secret-${spec.kind}`}>{spec.secretLabel}</label>
                        <input
                          id={`secret-${spec.kind}`}
                          className="field"
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={channel?.credential === "present" ? "On file. Paste a new one to replace it." : spec.secretPlaceholder}
                          value={secrets[spec.kind] ?? ""}
                          onChange={(event) => setSecrets((c) => ({ ...c, [spec.kind]: event.target.value }))}
                        />
                        <p className="field-note">
                          Stored in our secret vault, never in the database and never shown again, not even to
                          you. Replace it here if it is ever rotated.
                        </p>
                      </>
                    )}

                    <div className="create-row">
                      <button
                        className="button primary-button"
                        type="button"
                        disabled={busy === spec.kind}
                        onClick={() => void submit(spec)}
                      >
                        {busy === spec.kind ? "Saving…" : live ? "Update" : "Connect"}
                      </button>
                      {channel && live && (
                        <button
                          className="button secondary-button"
                          type="button"
                          disabled={busy === spec.kind}
                          onClick={() => void changeStatus(channel, "paused")}
                        >
                          Pause
                        </button>
                      )}
                      {channel && channel.status === "paused" && (
                        <button
                          className="button secondary-button"
                          type="button"
                          disabled={busy === spec.kind}
                          onClick={() => void changeStatus(channel, "connected")}
                        >
                          Resume
                        </button>
                      )}
                      {channel && !retired && (
                        <button
                          className="text-button"
                          type="button"
                          disabled={busy === spec.kind}
                          onClick={() => void changeStatus(channel, "revoked")}
                        >
                          Retire
                        </button>
                      )}
                    </div>
                  </>
                )}

                {retired && (
                  <p className="field-note">
                    Retired for good. That address will never be reattached to this clone. Set up a new one
                    instead if you need this channel back.
                  </p>
                )}
              </article>
            );
          })}

          <article className="teacher-sheet-card">
            <h3>Instagram DM</h3>
            <p className="field-note">Not offered yet, and this is what stands in the way rather than a date.</p>
            <div className="teacher-sheet-readonly">
              <span className="claim-meta">What Meta requires</span>
              <p>
                Advanced Access to Instagram messaging, which needs a verified business, an app in Live mode, and
                a full App Review with a recorded demonstration of the integration. Meta grants it per app, not
                per teacher, and the wait is measured in weeks to months.
              </p>
              <small>We will not put a button here that quietly does nothing.</small>
            </div>
          </article>
        </div>
      )}

      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="field-note" role="status">{notice}</p>}
    </section>
  );
}
