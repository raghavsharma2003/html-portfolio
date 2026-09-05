// The "Show on your page" card (WS-R66, migration 115). `InviteCreatorCard.tsx`'s
// own precedent: self-contained, owns its own fetch/write state rather than
// threading more `useState`s through `RoomStudio.tsx`'s already-large hook
// graph, and fails closed on its own - a creator who cannot see this card
// can still publish and run their Room.
//
// Five slots, one at a time. This v0 supports typed or edited text ONLY -
// the server (`api/_room-publish.js`'s `setRoomShowcase`) can also accept a
// `sourceCardId` pointing at a "Sounds right" review card and copy ITS
// question/answer instead, but no screen in this repo lets an owner browse
// their own decided review cards to pick one from (the review queue only
// ever lists OPEN cards, `api/_review-queue.js`'s `readReviewQueue`). Wiring
// a picker needs a new read this workstream's own file list did not name
// (`src/studio/ReviewQueue.tsx` is not in it); logged as a deliberate scope
// cut with its reversal condition in context/decisions.md rather than guessed
// at here. The capability exists end to end on the server and is proven in
// `evals/creator-page/run.mjs` and the door battery; only the picker UI is
// not built yet.
//
// CREATOR MATERIAL ONLY, never a follower's words: every string a stranger
// reads on `/c/<slug>` is either typed here by the owner or (server-side)
// copied from a card that was never a follower's own question in the first
// place - this card never reads or renders anything from a follower table.
import { useCallback, useEffect, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import {
  readOwnedRoom,
  setOwnedRoomShowcase,
  removeOwnedRoomShowcase,
  RoomPublishApiError,
  type RoomShowcaseItem,
} from "./roomPublishApi";
import { useStudioLocale } from "./localeContext";

const SLOTS = [1, 2, 3, 4, 5] as const;
const QUESTION_MAX = 200;
const ANSWER_MAX = 1200;

type Draft = { question: string; answer: string };

export default function ShowcaseCard({
  token,
  replicaId,
  roomPublished,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  roomPublished: boolean;
  onAuthError?: (error: ReplicaApiError | RoomPublishApiError) => void;
}) {
  const { t } = useStudioLocale();
  const c = t.showcase;
  const [items, setItems] = useState<RoomShowcaseItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const fail = useCallback(
    (e: unknown) => {
      if (
        (e instanceof ReplicaApiError || e instanceof RoomPublishApiError) &&
        (e.status === 401 || e.status === 403)
      ) {
        onAuthError?.(e);
        return;
      }
      if (e instanceof RoomPublishApiError && e.code === "room_showcase_copy_violation") {
        setError(c.copyViolation);
        return;
      }
      setError(e instanceof Error ? e.message.replaceAll("_", " ") : "request failed");
    },
    [onAuthError, c.copyViolation],
  );

  const applyShowcase = useCallback((showcase: RoomShowcaseItem[]) => {
    setItems(showcase);
    setDrafts((prev) => {
      const next: Record<number, Draft> = { ...prev };
      for (const slot of SLOTS) {
        const found = showcase.find((s) => s.position === slot);
        if (found) next[slot] = { question: found.question, answer: found.answer };
      }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const state = await readOwnedRoom(token, replicaId);
      const showcase = state?.showcase ?? [];
      const seeded: Record<number, Draft> = {};
      for (const slot of SLOTS) {
        const found = showcase.find((s) => s.position === slot);
        seeded[slot] = { question: found?.question ?? "", answer: found?.answer ?? "" };
      }
      setItems(showcase);
      setDrafts(seeded);
      setError("");
    } catch (e) {
      fail(e);
    }
  }, [token, replicaId, fail]);

  useEffect(() => {
    void load();
  }, [load]);

  const setDraft = useCallback((position: number, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [position]: { ...(prev[position] ?? { question: "", answer: "" }), ...patch } }));
  }, []);

  const save = useCallback(
    async (position: number) => {
      const draft = drafts[position];
      const question = draft?.question.trim() ?? "";
      const answer = draft?.answer.trim() ?? "";
      if (!question || !answer) return;
      setBusy(position);
      setError("");
      setNotice("");
      try {
        const showcase = await setOwnedRoomShowcase(token, replicaId, { position, question, answer });
        applyShowcase(showcase);
        setNotice(c.saved);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, drafts, fail, applyShowcase, c.saved],
  );

  const remove = useCallback(
    async (position: number) => {
      const existing = items.find((s) => s.position === position);
      if (!existing) return;
      setBusy(position);
      setError("");
      setNotice("");
      try {
        const showcase = await removeOwnedRoomShowcase(token, replicaId, existing.id);
        applyShowcase(showcase);
        setDraft(position, { question: "", answer: "" });
        setNotice(c.removed);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, items, fail, applyShowcase, setDraft, c.removed],
  );

  return (
    <article className="teacher-sheet-card vy-room__showcase-card">
      <h3>{c.title}</h3>
      <p className="field-note">{c.intro}</p>
      {!roomPublished && <p className="field-note">{c.publishFirst}</p>}

      {SLOTS.map((position) => {
        const existing = items.find((s) => s.position === position);
        const draft = drafts[position] ?? { question: "", answer: "" };
        const dirty = draft.question !== (existing?.question ?? "") || draft.answer !== (existing?.answer ?? "");
        return (
          <div className="vy-room__showcase-slot" key={position}>
            <label className="field-label" htmlFor={`vy-showcase-q-${position}`}>
              {c.slotLabel.split("{n}").join(String(position))}
            </label>
            <input
              id={`vy-showcase-q-${position}`}
              className="field"
              value={draft.question}
              maxLength={QUESTION_MAX}
              placeholder={c.questionPlaceholder}
              disabled={!roomPublished}
              onChange={(event) => setDraft(position, { question: event.target.value })}
            />
            <textarea
              className="field"
              value={draft.answer}
              maxLength={ANSWER_MAX}
              rows={3}
              placeholder={c.answerPlaceholder}
              disabled={!roomPublished}
              onChange={(event) => setDraft(position, { answer: event.target.value })}
            />
            <div className="vy-room__slug-row">
              <button
                className="button secondary-button"
                type="button"
                disabled={busy === position || !roomPublished || !draft.question.trim() || !draft.answer.trim() || !dirty}
                onPointerDown={() => void save(position)}
              >
                {busy === position ? c.saving : c.save}
              </button>
              {existing && (
                <button
                  className="button secondary-button"
                  type="button"
                  disabled={busy === position}
                  onPointerDown={() => void remove(position)}
                >
                  {busy === position ? c.removing : c.remove}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {notice && <p className="field-note">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
