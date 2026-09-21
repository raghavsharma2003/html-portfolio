// The Handoff card (WS-R20). Self-contained on purpose - `CheckinsCard.tsx`'s
// own reason one file over: it owns its own fetch/toggle/answer state rather
// than threading more `useState`s through `RoomStudio.tsx`'s already-large
// hook graph, and it fails closed on its own.
//
// One request at a time, by design (`api/_handoff.js`'s own law): this card
// never shows a list of pending asks, only counts and the single oldest one
// still waiting - there is no "browse the queue" affordance to build here,
// because there is no queue view in the product this card serves.
import { useCallback, useEffect, useState } from "react";
import {
  getHandoffConfig,
  setHandoffConfig,
  loadHandoffQueue,
  answerHandoff,
  HandoffApiError,
  type HandoffConfig,
  type HandoffQueue,
} from "./handoffApi";
import { useStudioLocale } from "./localeContext";

const REPLY_MAX = 4000;
const CAP_MIN = 0;
const CAP_MAX = 50;

export default function HandoffCard({ token, replicaId }: { token: string; replicaId: string }) {
  const { t } = useStudioLocale();
  const c = t.handoff;
  const [config, setConfig] = useState<HandoffConfig | null>(null);
  const [queue, setQueue] = useState<HandoffQueue | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, q] = await Promise.all([getHandoffConfig(token, replicaId), loadHandoffQueue(token, replicaId)]);
      setConfig(c);
      setQueue(q);
    } catch (e) {
      setError(e instanceof HandoffApiError ? e.code.replaceAll("_", " ") : "could not load handoff");
    }
  }, [token, replicaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async () => {
    if (!config) return;
    setBusy("toggle");
    setError("");
    try {
      setConfig(await setHandoffConfig(token, replicaId, !config.enabled, config.monthly_cap));
    } catch (e) {
      setError(e instanceof HandoffApiError ? e.code.replaceAll("_", " ") : "could not change this setting");
    } finally {
      setBusy(null);
    }
  }, [token, replicaId, config]);

  const changeCap = useCallback(
    async (next: number) => {
      if (!config || !Number.isInteger(next) || next < CAP_MIN || next > CAP_MAX) return;
      setBusy("cap");
      setError("");
      try {
        setConfig(await setHandoffConfig(token, replicaId, config.enabled, next));
      } catch (e) {
        setError(e instanceof HandoffApiError ? e.code.replaceAll("_", " ") : "could not change this setting");
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, config],
  );

  const send = useCallback(async () => {
    const text = reply.trim();
    if (!queue?.next || !text) return;
    setBusy("answer");
    setError("");
    try {
      await answerHandoff(token, replicaId, queue.next.handoff_id, text);
      setReply("");
      await load();
    } catch (e) {
      setError(e instanceof HandoffApiError ? e.code.replaceAll("_", " ") : "could not send this reply");
    } finally {
      setBusy(null);
    }
  }, [token, replicaId, reply, queue, load]);

  return (
    <article className="teacher-sheet-card vy-room__handoff-card">
      <h3>{c.title}</h3>
      <p className="field-note">
        {c.intro}
      </p>

      {config && (
        <>
          <div className="vy-room__cap-row" role="group" aria-label="Handoff switch">
            <span>{(config.enabled ? c.on : c.off)} {c.forThisRoom}</span>
            <button
              className="button secondary-button"
              type="button"
              disabled={busy === "toggle"}
              onPointerDown={() => void toggle()}
            >
              {busy === "toggle" ? c.working : config.enabled ? c.turnOff : c.turnOn}
            </button>
          </div>

          <label className="field-label" htmlFor="handoff-cap">
            {c.capLabel}
          </label>
          <input
            id="handoff-cap"
            className="field"
            type="number"
            min={CAP_MIN}
            max={CAP_MAX}
            value={config.monthly_cap}
            disabled={busy === "cap"}
            onChange={(event) => void changeCap(Number(event.target.value))}
          />
        </>
      )}

      {queue && (
        <>
          <ul className="vy-room__checkins-list" aria-label="Handoff counts">
            <li className="vy-room__checkins-row">
              <span>{c.waiting}</span>
              <span className="vy-room__checkins-cadence">{queue.counts.sent}</span>
            </li>
            <li className="vy-room__checkins-row">
              <span>{c.answered}</span>
              <span className="vy-room__checkins-cadence">{queue.counts.answered}</span>
            </li>
          </ul>

          {queue.next ? (
            <div className="vy-room__handoff-next">
              <p className="field-label">{c.whatTheySent}</p>
              <p className="vy-room__handoff-payload">{queue.next.payload_text}</p>
              <label className="field-label" htmlFor="handoff-reply">{c.yourReply}</label>
              <textarea
                id="handoff-reply"
                className="field"
                rows={4}
                value={reply}
                maxLength={REPLY_MAX}
                placeholder={c.replyPlaceholder}
                onChange={(event) => setReply(event.target.value)}
              />
              <button
                className="button primary-button"
                type="button"
                disabled={busy === "answer" || !reply.trim()}
                onPointerDown={() => void send()}
              >
                {busy === "answer" ? c.sending : c.sendReply}
              </button>
            </div>
          ) : (
            <p className="field-note">{c.nothingWaiting}</p>
          )}
        </>
      )}

      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
