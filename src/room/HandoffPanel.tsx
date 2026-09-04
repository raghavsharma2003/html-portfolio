// "Ask <Name> directly" (WS-R20). `CheckinsPanel.tsx`'s own shape one file
// over (`role="dialog"`, `.room-menu`/`.room-btn`), so a reader who knows one
// dialog in this app knows this one. Owns no decision - every rule lives in
// api/_handoff.js; this file only turns a pick into a POST and renders the
// verbatim payload screen law 1 requires.
//
// THE PAYLOAD SCREEN IS NOT OPTIONAL AND NOT SUMMARIZED. What `draftHandoff`
// returns is rendered byte for byte, in a `<pre>`-shaped block, before the
// only button that sends anything - a follower must see the EXACT bytes
// that will reach the creator, never a paraphrase this component invented.
import { useCallback, useEffect, useState } from "react";
import { withName, type RoomCopy } from "./copy";
import {
  draftHandoff,
  sendHandoff,
  withdrawHandoff,
  myHandoffs,
  RoomHandoffApiError,
  type HandoffMine,
} from "./roomHandoffApi";

type Turn = { role: "user" | "assistant"; content: string };
type Stage = "mine" | "pick" | "confirm" | "sent";

function statusLine(h: HandoffMine, name: string, copy: RoomCopy): string {
  if (h.state === "answered") return `${withName(copy.handoff.answeredFrom, name)}`;
  if (h.state === "withdrawn") return copy.handoff.withdrawnStatus;
  return copy.handoff.sentStatus;
}

export default function HandoffPanel({
  session,
  turns,
  threadId,
  creatorName,
  copy,
  onClose,
}: {
  session: string;
  turns: Turn[];
  threadId: string | null;
  creatorName: string;
  copy: RoomCopy;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>("mine");
  const [mine, setMine] = useState<HandoffMine[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<{ payload_text: string; payload_sha256: string; thread_id: string | null } | null>(null);

  const ownTurns = turns.filter((t) => t.role === "user");

  const load = useCallback(async () => {
    try {
      setMine(await myHandoffs(session));
    } catch {
      setError(copy.errors.generic);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePick = (i: number) =>
    setPicked((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i].sort((a, b) => a - b)));

  const goDraft = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const d = await draftHandoff(session, {
        threadId,
        messageIndexes: picked.length ? picked : undefined,
        note: picked.length ? undefined : note,
      });
      setDraft(d);
      setStage("confirm");
    } catch (e) {
      setError(e instanceof RoomHandoffApiError ? e.code.replaceAll("_", " ") : copy.errors.generic);
    } finally {
      setBusy(false);
    }
  }, [session, threadId, picked, note]);

  const send = useCallback(async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await sendHandoff(session, draft.payload_text, draft.payload_sha256, draft.thread_id);
      setPicked([]);
      setNote("");
      setDraft(null);
      setStage("sent");
      await load();
    } catch (e) {
      setError(e instanceof RoomHandoffApiError ? e.code.replaceAll("_", " ") : copy.errors.generic);
    } finally {
      setBusy(false);
    }
  }, [session, draft, load]);

  const withdraw = useCallback(
    async (handoffId: string) => {
      setBusy(true);
      setError("");
      try {
        await withdrawHandoff(session, handoffId);
        await load();
      } catch {
        setError(copy.errors.generic);
      } finally {
        setBusy(false);
      }
    },
    [session, load],
  );

  return (
    <section className="room-menu room-handoff" role="dialog" aria-label={withName(copy.handoff.title, creatorName)}>
      <h2>{withName(copy.handoff.title, creatorName)}</h2>
      {error && <p className="room-error">{error}</p>}

      {stage === "mine" && (
        <>
          <p className="room-fine">{copy.handoff.intro}</p>
          {mine.length > 0 && (
            <ul className="room-checkins-list">
              {mine.map((h) => (
                <li key={h.handoff_id} className="room-checkins-row">
                  <div>
                    <span>{h.payload_text.slice(0, 60)}</span>
                    <p className="room-fine">{statusLine(h, creatorName, copy)}</p>
                    {h.state === "answered" && h.reply_text && <p className="room-handoff-reply">{h.reply_text}</p>}
                  </div>
                  {h.state === "sent" && (
                    <button type="button" className="room-btn" disabled={busy} onClick={() => void withdraw(h.handoff_id)}>
                      {copy.handoff.withdraw}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="room-btn" onClick={() => setStage("pick")}>
            {withName(copy.handoff.title, creatorName)}
          </button>
          <button type="button" className="room-btn" onClick={onClose}>
            {copy.checkins.close}
          </button>
        </>
      )}

      {stage === "pick" && (
        <>
          <p className="room-fine">{copy.handoff.pickIntro}</p>
          {ownTurns.length > 0 && (
            <ul className="room-checkins-list">
              {ownTurns.map((t, i) => (
                <li key={i} className="room-checkins-row">
                  <label>
                    <input type="checkbox" checked={picked.includes(i)} onChange={() => togglePick(i)} />
                    {" "}{t.content.slice(0, 80)}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <label className="room-fine">
            {copy.handoff.noteLabel}
            <textarea
              rows={3}
              value={note}
              disabled={picked.length > 0}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="room-btn"
            disabled={busy || (!picked.length && !note.trim())}
            onClick={() => void goDraft()}
          >
            {busy ? "..." : copy.handoff.next}
          </button>
          <button type="button" className="room-btn" onClick={() => setStage("mine")}>
            {copy.checkins.close}
          </button>
        </>
      )}

      {stage === "confirm" && draft && (
        <>
          <p className="room-fine">{copy.handoff.confirmIntro}</p>
          <pre className="room-handoff-payload">{draft.payload_text}</pre>
          <p className="room-fine">{withName(copy.handoff.confirmExplain, creatorName)}</p>
          <button type="button" className="room-btn" disabled={busy} onClick={() => void send()}>
            {busy ? "..." : copy.handoff.send}
          </button>
          <button type="button" className="room-btn" disabled={busy} onClick={() => setStage("pick")}>
            {copy.handoff.back}
          </button>
        </>
      )}

      {stage === "sent" && (
        <>
          <p className="room-fine">{copy.handoff.sentConfirm}</p>
          <button type="button" className="room-btn" onClick={() => setStage("mine")}>
            {copy.checkins.close}
          </button>
        </>
      )}
    </section>
  );
}
