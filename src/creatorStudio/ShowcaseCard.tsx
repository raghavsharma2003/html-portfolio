// The "Show on your page" card (WS-R66, migration 115). `InviteCreatorCard.tsx`'s
// own precedent: self-contained, owns its own fetch/write state rather than
// threading more `useState`s through `RoomStudio.tsx`'s already-large hook
// graph, and fails closed on its own - a creator who cannot see this card
// can still publish and run their Room.
//
// Five slots, one at a time. Typed or edited text, OR (WS-R72) a "Sounds
// right" review card picked from the list `readEligibleShowcaseCards` reads
// (`api/_review-queue.js`) - the server (`api/_room-publish.js`'s
// `setRoomShowcase`) has accepted a `sourceCardId` since WS-R66 and enforces
// the SAME eligibility predicate on its own write; this card just adds the
// screen that lets an owner browse before they pick
// (`context/decisions.md#ws-r66-showcase-card-picker-ui-not-built-v0`, the
// open item this closes).
//
// CREATOR MATERIAL ONLY, never a follower's words: every string a stranger
// reads on `/c/<slug>` is either typed here by the owner or (server-side)
// copied from a card that was never a follower's own question in the first
// place - this card never reads or renders anything from a follower table,
// and the picker below lists only what `readEligibleShowcaseCards`'s own
// WHERE clause already excluded a follower-sourced card from, never a list
// this component filters itself.
import { useCallback, useEffect, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import {
  readOwnedRoom,
  setOwnedRoomShowcase,
  removeOwnedRoomShowcase,
  RoomPublishApiError,
  type RoomShowcaseItem,
} from "./roomPublishApi";
import { eligibleShowcaseCards } from "./reviewQueueApi";
import type { ShowcaseEligibleCard } from "./types";
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
  const p = t.showcasePicker;
  const [items, setItems] = useState<RoomShowcaseItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  // WS-R72. `pickerFor` names the slot whose picker is open (never two at
  // once - `composing` in ReviewQueue.tsx's own single-flight shape).
  // `pickerCards === null` means "not fetched yet this mount", not "fetched,
  // zero eligible" - the same undefined-means-not-checked convention
  // `studioShellModel.ts` uses, so a slow first load never flashes the
  // EMPTY state before the real list arrives.
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const [pickerCards, setPickerCards] = useState<ShowcaseEligibleCard[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);

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

  // WS-R72. Fetched ONCE per mount, on the first open - every slot's picker
  // shares the same decided-cards list, so a second slot's "Pick from your
  // reviews" reuses `pickerCards` rather than a second round trip.
  const openPicker = useCallback(
    async (position: number) => {
      setPickerFor(position);
      setError("");
      if (pickerCards !== null) return;
      setPickerLoading(true);
      try {
        setPickerCards(await eligibleShowcaseCards(token, replicaId));
      } catch (e) {
        if ((e instanceof ReplicaApiError || e instanceof RoomPublishApiError) && (e.status === 401 || e.status === 403)) {
          onAuthError?.(e);
        } else {
          setError(p.pickError);
        }
        setPickerFor(null);
      } finally {
        setPickerLoading(false);
      }
    },
    [token, replicaId, pickerCards, onAuthError, p.pickError],
  );

  const closePicker = useCallback(() => setPickerFor(null), []);

  const useCard = useCallback(
    async (position: number, cardId: string) => {
      setBusy(position);
      setError("");
      setNotice("");
      try {
        const showcase = await setOwnedRoomShowcase(token, replicaId, { position, sourceCardId: cardId });
        applyShowcase(showcase);
        setPickerFor(null);
        setNotice(c.saved);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, fail, applyShowcase, c.saved],
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
              <button
                className="text-button"
                type="button"
                disabled={busy === position || !roomPublished}
                // Locale-independent, `room-layout-fixture.html`'s
                // `[data-dialog-open="..."]` precedent: the layout and
                // accessibility gates open this with a REAL click rather
                // than a fixture prop pre-opening it
                // (`context/rejected.md`'s own "never a fixture prop
                // pre-opening it" law, WS-R43).
                data-picker-open={position}
                onPointerDown={() => void openPicker(position)}
              >
                {p.pickButton}
              </button>
            </div>

            {pickerFor === position && (
              <div className="vy-room__showcase-picker" role="group" aria-labelledby={`vy-showcase-picker-title-${position}`}>
                <p className="field-label" id={`vy-showcase-picker-title-${position}`}>{p.pickTitle}</p>
                {pickerLoading ? (
                  <p className="field-note" role="status">{p.pickLoading}</p>
                ) : !pickerCards?.length ? (
                  <p className="field-note">{p.pickEmpty}</p>
                ) : (
                  <ul className="vy-room__showcase-picker-list">
                    {pickerCards.map((pcard) => (
                      <li key={pcard.card_id} className="vy-room__showcase-picker-item">
                        <p className="vy-room__showcase-picker-q">{pcard.prompt_text}</p>
                        <p className="vy-room__showcase-picker-a">{pcard.answer_text}</p>
                        <button
                          className="button secondary-button"
                          type="button"
                          disabled={busy === position}
                          onPointerDown={() => void useCard(position, pcard.card_id)}
                        >
                          {p.pickUse}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button className="text-button" type="button" onPointerDown={closePicker}>
                  {p.pickCancel}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {notice && <p className="field-note">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
