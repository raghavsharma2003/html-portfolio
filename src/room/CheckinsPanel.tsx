// The follower's check-ins panel (WS-R16). `DataMenu`'s own shape one file
// over (`role="dialog"`, `.room-menu`/`.room-btn`), so a reader who knows one
// dialog in this app knows this one. Owns no decision — every rule lives in
// api/_checkins.js; this file only turns a pick into a POST.
import { useCallback, useEffect, useState } from "react";
import { ROOM_COPY } from "./copy";
import {
  listCheckinDesigns,
  listMyCheckins,
  optInToCheckin,
  stopCheckin,
  browserTimezone,
  WEEKDAY_LABELS,
  RoomCheckinsApiError,
  type RoomCheckinDesign,
  type RoomCheckin,
} from "./roomCheckinsApi";

export default function CheckinsPanel({ session, onClose }: { session: string; onClose: () => void }) {
  const [designs, setDesigns] = useState<RoomCheckinDesign[]>([]);
  const [mine, setMine] = useState<RoomCheckin[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [time, setTime] = useState("09:00");
  const [zone] = useState(browserTimezone());

  const load = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([listCheckinDesigns(session), listMyCheckins(session)]);
      setDesigns(d);
      setMine(m);
    } catch {
      setError(ROOM_COPY.errors.generic);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCheckinsByDesign = new Set(mine.filter((c) => c.state === "active").map((c) => c.design_id));

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));

  const start = useCallback(
    async (designId: string) => {
      if (!days.length) return;
      setBusy(designId);
      setError("");
      try {
        await optInToCheckin(session, designId, { daysOfWeek: days, localTime: time, timezone: zone });
        setPicking(null);
        await load();
      } catch (e) {
        setError(e instanceof RoomCheckinsApiError ? ROOM_COPY.errors.generic : ROOM_COPY.errors.generic);
      } finally {
        setBusy(null);
      }
    },
    [session, days, time, zone, load],
  );

  const stop = useCallback(
    async (checkinId: string) => {
      setBusy(checkinId);
      setError("");
      try {
        await stopCheckin(session, checkinId);
        await load();
      } catch {
        setError(ROOM_COPY.errors.generic);
      } finally {
        setBusy(null);
      }
    },
    [session, load],
  );

  return (
    <section className="room-menu room-checkins" role="dialog" aria-label={ROOM_COPY.checkins.title}>
      <h2>{ROOM_COPY.checkins.title}</h2>
      <p className="room-fine">{ROOM_COPY.checkins.intro}</p>
      {error && <p className="room-error">{error}</p>}

      {mine.length > 0 && (
        <>
          <h3 className="room-checkins-subhead">{ROOM_COPY.checkins.mineTitle}</h3>
          <ul className="room-checkins-list">
            {mine.map((c) => (
              <li key={c.checkin_id} className="room-checkins-row">
                <span>{c.title}</span>
                {c.state === "active" ? (
                  <button type="button" className="room-btn" disabled={busy === c.checkin_id} onClick={() => void stop(c.checkin_id)}>
                    {busy === c.checkin_id ? "..." : ROOM_COPY.checkins.stop}
                  </button>
                ) : (
                  <span className="room-fine">{ROOM_COPY.checkins.stopped}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {designs.length === 0 ? (
        <p className="room-fine">{ROOM_COPY.checkins.empty}</p>
      ) : (
        <ul className="room-checkins-list">
          {designs
            .filter((d) => !activeCheckinsByDesign.has(d.design_id))
            .map((d) => (
              <li key={d.design_id} className="room-checkins-row room-checkins-row--pickable">
                <div>
                  <span>{d.title}</span>
                  {d.cadence_hint && <span className="room-fine">, {d.cadence_hint}</span>}
                </div>
                {picking === d.design_id ? (
                  <div className="room-checkins-schedule">
                    <div className="room-checkins-days" role="group" aria-label={ROOM_COPY.checkins.daysLabel}>
                      {WEEKDAY_LABELS.map((w) => (
                        <button
                          type="button"
                          key={w.value}
                          className={`room-checkins-day${days.includes(w.value) ? " on" : ""}`}
                          onClick={() => toggleDay(w.value)}
                        >
                          {w.label}
                        </button>
                      ))}
                    </div>
                    <label className="room-fine">
                      {ROOM_COPY.checkins.timeLabel}
                      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                    </label>
                    <button
                      type="button"
                      className="room-btn"
                      disabled={busy === d.design_id || !days.length}
                      onClick={() => void start(d.design_id)}
                    >
                      {busy === d.design_id ? "..." : ROOM_COPY.checkins.add}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="room-btn" onClick={() => setPicking(d.design_id)}>
                    {ROOM_COPY.checkins.add}
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}

      <button type="button" className="room-btn" onClick={onClose}>
        {ROOM_COPY.checkins.close}
      </button>
    </section>
  );
}
