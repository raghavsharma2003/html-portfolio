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
import { useStudioLocale } from "./localeContext";

const PROMPT_SHAPE_MAX = 2000;
const TITLE_MAX = 120;

export default function CheckinsCard({ token, replicaId }: { token: string; replicaId: string }) {
  const { t } = useStudioLocale();
  const c = t.checkins;
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
      <h3>{c.title}</h3>
      <p className="field-note">
        {c.intro}
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
                {busy === d.design_id ? c.working : d.state === "active" ? c.pause : c.resume}
              </button>
            </li>
          ))}
        </ul>
      )}
      {designs && designs.length === 0 && (
        <p className="field-note">{c.emptyList}</p>
      )}

      <label className="field-label" htmlFor="checkin-title">{c.titleLabel}</label>
      <input
        id="checkin-title"
        className="field"
        value={title}
        maxLength={TITLE_MAX}
        placeholder={c.titlePlaceholder}
        onChange={(event) => setTitle(event.target.value)}
      />

      <label className="field-label" htmlFor="checkin-shape">
        {c.shapeLabel}
      </label>
      <textarea
        id="checkin-shape"
        className="field"
        rows={3}
        value={shape}
        maxLength={PROMPT_SHAPE_MAX}
        placeholder={c.shapePlaceholder}
        onChange={(event) => setShape(event.target.value)}
      />

      <label className="field-label" htmlFor="checkin-cadence">{c.cadenceLabel}</label>
      <input
        id="checkin-cadence"
        className="field"
        value={cadence}
        maxLength={200}
        placeholder={c.cadencePlaceholder}
        onChange={(event) => setCadence(event.target.value)}
      />

      <button
        className="button primary-button"
        type="button"
        disabled={busy === "create" || !title.trim() || !shape.trim()}
        onPointerDown={() => void create()}
      >
        {busy === "create" ? c.saving : c.addCheckin}
      </button>

      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
