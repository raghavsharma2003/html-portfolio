// The Check-ins card (WS-R16). Self-contained on purpose: it owns its own
// fetch/create/pause state rather than threading three more `useState`s
// through `RoomStudio.tsx`'s already-large hook graph, and it fails closed
// on its own — a creator who cannot see this card can still publish and run
// their Room.
//
// Rooms vocabulary and design-law tokens apply exactly as they do in the
// rest of the studio; no new class of control is introduced, only the
// existing `teacher-sheet-card` / `field` / `button` shapes `RoomStudio.tsx`
// already uses.
import { useCallback, useEffect, useState } from "react";
import {
  createCheckinDesign,
  listCheckinDesigns,
  setCheckinDesignState,
  CheckinsApiError,
  type CheckinDesign,
} from "./checkinsApi";

const PROMPT_SHAPE_MAX = 2000;
const TITLE_MAX = 120;

export default function CheckinsCard({ token, replicaId }: { token: string; replicaId: string }) {
  const [designs, setDesigns] = useState<CheckinDesign[] | null>(null);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [shape, setShape] = useState("");
  const [cadence, setCadence] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDesigns(await listCheckinDesigns(token, replicaId));
    } catch (e) {
      setError(e instanceof CheckinsApiError ? e.code.replaceAll("_", " ") : "could not load check-ins");
    }
  }, [token, replicaId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async () => {
    const t = title.trim();
    const s = shape.trim();
    if (!t || !s) return;
    setBusy("create");
    setError("");
    try {
      await createCheckinDesign(token, replicaId, { title: t, promptShape: s, cadenceHint: cadence.trim() });
      setTitle("");
      setShape("");
      setCadence("");
      await load();
    } catch (e) {
      setError(e instanceof CheckinsApiError ? e.code.replaceAll("_", " ") : "could not save this check-in");
    } finally {
      setBusy(null);
    }
  }, [token, replicaId, title, shape, cadence, load]);

  const toggle = useCallback(
    async (design: CheckinDesign) => {
      setBusy(design.design_id);
      setError("");
      try {
        await setCheckinDesignState(token, replicaId, design.design_id, design.state === "active" ? "paused" : "active");
        await load();
      } catch (e) {
        setError(e instanceof CheckinsApiError ? e.code.replaceAll("_", " ") : "could not change this check-in");
      } finally {
        setBusy(null);
      }
    },
    [token, replicaId, load],
  );

  return (
    <article className="teacher-sheet-card vy-room__checkins-card">
      <h3>Check-ins</h3>
      <p className="field-note">
        A paid follower opts in and picks their own schedule; your AI follows up on that schedule and never
        because they went quiet. Write what to check on as a note to your AI, not a line for it to read aloud;
        it will say it in its own words, every time.
      </p>

      {designs && designs.length > 0 && (
        <ul className="vy-room__checkins-list">
          {designs.map((d) => (
            <li key={d.design_id} className="vy-room__checkins-row">
              <div>
                <span className="vy-room__checkins-title">{d.title}</span>
                {d.cadence_hint && <span className="vy-room__checkins-cadence">, {d.cadence_hint}</span>}
              </div>
              <button
                className="button secondary-button"
                type="button"
                disabled={busy === d.design_id}
                onPointerDown={() => void toggle(d)}
              >
                {busy === d.design_id ? "Working..." : d.state === "active" ? "Pause" : "Resume"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {designs && designs.length === 0 && (
        <p className="field-note">No check-ins yet. The first one you add here becomes something a follower can opt into.</p>
      )}

      <label className="field-label" htmlFor="checkin-title">Title</label>
      <input
        id="checkin-title"
        className="field"
        value={title}
        maxLength={TITLE_MAX}
        placeholder="Evening walk"
        onChange={(event) => setTitle(event.target.value)}
      />

      <label className="field-label" htmlFor="checkin-shape">
        What to check on (a note to your AI: it will phrase this itself)
      </label>
      <textarea
        id="checkin-shape"
        className="field"
        rows={3}
        value={shape}
        maxLength={PROMPT_SHAPE_MAX}
        placeholder="ask if they went for their evening walk today; celebrate briefly if yes, no guilt if no"
        onChange={(event) => setShape(event.target.value)}
      />

      <label className="field-label" htmlFor="checkin-cadence">Cadence hint (shown to the follower, e.g. "daily")</label>
      <input
        id="checkin-cadence"
        className="field"
        value={cadence}
        maxLength={200}
        placeholder="daily"
        onChange={(event) => setCadence(event.target.value)}
      />

      <button
        className="button primary-button"
        type="button"
        disabled={busy === "create" || !title.trim() || !shape.trim()}
        onPointerDown={() => void create()}
      >
        {busy === "create" ? "Saving..." : "Add check-in"}
      </button>

      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
