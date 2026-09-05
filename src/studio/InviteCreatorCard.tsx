// The "Invite a creator" card (WS-R47, migration 106). `PayoutsCard.tsx`'s
// own precedent: self-contained, owns its own fetch/issue state rather than
// threading more `useState`s through `RoomStudio.tsx`'s already-large hook
// graph, and fails closed on its own - a creator who cannot see this card
// can still publish and run their Room.
//
// This is an ACCOUNT-level capability, not a per-Room one (the server's own
// quota is keyed on `issued_by_user_id`, not `replica_id`), so it only ever
// needs `token`. `roomPublished` is the ONE piece of Room-shaped context it
// takes, and only to give the disabled "create an invite" control a REASON
// before the server ever refuses it - `context/rejected.md`'s own law, a
// gray button with nothing next to it is a dead end that reads as a bug.
// The server's own predicate (any published Room, not necessarily this one)
// is the actual gate; this is a courtesy, not a duplicate of it.
import { useCallback, useEffect, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import {
  myCreatorInvites,
  issueMyCreatorInvite,
  type MyCreatorInvites,
  type IssuedCreatorInvite,
} from "./inviteApi";
import { useStudioLocale } from "./localeContext";

export default function InviteCreatorCard({
  token,
  roomPublished,
  onAuthError,
}: {
  token: string;
  roomPublished: boolean;
  onAuthError?: (error: ReplicaApiError) => void;
}) {
  const { t } = useStudioLocale();
  const c = t.inviteCreator;
  const [data, setData] = useState<MyCreatorInvites | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [justIssued, setJustIssued] = useState<IssuedCreatorInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const fail = useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof ReplicaApiError) {
        // `creator_invite_unavailable` is also a 403 - the server's own way
        // of not distinguishing an exhausted quota from an unpublished Room
        // (api/_invites.js's own comment names the reason: not disclosing
        // more than a front door should). It is a normal domain answer, not
        // a session failure, so it must NOT be routed to `onAuthError` the
        // way a real 401/403 is one line down.
        const code = typeof e.data?.error === "string" ? e.data.error : "";
        if (code === "creator_invite_unavailable") {
          setError(c.usedAll);
          return;
        }
        if (e.status === 401 || e.status === 403) {
          onAuthError?.(e);
          return;
        }
      }
      setError(e instanceof Error ? e.message.replaceAll("_", " ") : fallback);
    },
    [onAuthError, c.usedAll],
  );

  const load = useCallback(async () => {
    try {
      setData(await myCreatorInvites(token));
      setError("");
    } catch (e) {
      fail(e, "could not load your invites");
    }
  }, [token, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const issue = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await issueMyCreatorInvite(token);
      setJustIssued(result);
      setCopied(false);
      await load();
    } catch (e) {
      fail(e, "could not create an invite");
    } finally {
      setBusy(false);
    }
  }, [token, load, fail]);

  const copyCode = useCallback(() => {
    if (!justIssued) return;
    void navigator.clipboard?.writeText(justIssued.code).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }, [justIssued]);

  const remaining = data?.quota.remaining ?? null;
  const canIssue = roomPublished && (remaining === null || remaining > 0);

  return (
    <article className="teacher-sheet-card vy-room__invite-card">
      <h3>{c.title}</h3>
      <p className="field-note">
        {c.intro}
      </p>

      {!roomPublished && (
        <p className="field-note">{c.publishFirst}</p>
      )}

      {justIssued && (
        <>
          <div className="vy-room__link-row">
            <code className="vy-room__link">{justIssued.code}</code>
            <button className="button secondary-button" type="button" onPointerDown={copyCode}>
              {copied ? c.copied : c.copyCode}
            </button>
          </div>
          <p className="field-note">
            {c.sendNow}
          </p>
        </>
      )}

      <button
        className="button secondary-button"
        type="button"
        disabled={busy || !canIssue}
        onPointerDown={() => void issue()}
      >
        {busy ? c.creating : c.createCode}
      </button>
      {data && (
        <p className="field-note">
          {c.quota.split("{n}").join(String(data.quota.used)).split("{n2}").join(String(data.quota.max))}
          {data.quota.remaining <= 0 && roomPublished ? c.quotaExhausted : ""}
        </p>
      )}

      {data && data.invites.length > 0 && (
        <ul className="vy-room__suite-list">
          {data.invites.map((invite) => (
            <li key={invite.invite_id} className="vy-room__suite-row">
              <div className="vy-room__suite-row-head">
                <span className="vy-room__suite-name">{c.stateLabel[invite.state]}</span>
                <span className="vy-room__suite-seats">
                  {invite.state === "redeemed" && invite.redeemed_at
                    ? new Date(invite.redeemed_at).toLocaleDateString()
                    : new Date(invite.created_at).toLocaleDateString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
