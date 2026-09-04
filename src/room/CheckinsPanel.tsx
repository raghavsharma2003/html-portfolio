// The follower's check-ins panel (WS-R16). `DataMenu`'s own shape one file
// over (`role="dialog"`, `.room-menu`/`.room-btn`), so a reader who knows one
// dialog in this app knows this one. Owns no decision — every rule lives in
// api/_checkins.js; this file only turns a pick into a POST.
import { useCallback, useEffect, useState } from "react";
import type { RoomCopy } from "./copy";
import {
  listCheckinDesignsAndPushKey,
  listMyCheckins,
  optInToCheckin,
  stopCheckin,
  browserTimezone,
  WEEKDAY_LABELS,
  RoomCheckinsApiError,
  type RoomCheckinDesign,
  type RoomCheckin,
} from "./roomCheckinsApi";
import { pushSubscribe, pushUnsubscribe, pushStatus } from "./roomApi";

/** RFC 4648 base64url, both directions — the only encoding every field in a
 *  browser `PushSubscription` and the VAPID public key share. */
function b64uToUint8Array(b64u: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const base64 = (b64u + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bufToB64u(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function CheckinsPanel({
  session,
  copy,
  onClose,
}: {
  session: string;
  copy: RoomCopy;
  onClose: () => void;
}) {
  const [designs, setDesigns] = useState<RoomCheckinDesign[]>([]);
  const [mine, setMine] = useState<RoomCheckin[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [time, setTime] = useState("09:00");
  const [zone] = useState(browserTimezone());
  const [quietFrom, setQuietFrom] = useState("");
  const [quietTo, setQuietTo] = useState("");
  // WS-R22: the phone, without Meta. `pushKey` is null on a deployment that
  // has not configured `ROOM_PUSH_VAPID_PUBLIC` — the whole control below is
  // absent in that case (workstream law #3), never shown-and-disabled.
  const [pushKey, setPushKey] = useState<string | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");

  const load = useCallback(async () => {
    try {
      const [dp, m] = await Promise.all([listCheckinDesignsAndPushKey(session), listMyCheckins(session)]);
      setDesigns(dp.designs);
      setMine(m);
      setPushKey(dp.push_public_key);
      if (dp.push_public_key) {
        pushStatus(session)
          .then((s) => setPushOn(s.subscribed))
          .catch(() => {});
      }
    } catch {
      setError(copy.errors.generic);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const enablePush = useCallback(async () => {
    if (!pushKey) return;
    setPushBusy(true);
    setPushError("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("push_unsupported");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("push_denied");
      const registration = await navigator.serviceWorker.register("/room-sw.js");
      await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64uToUint8Array(pushKey),
        }));
      const endpoint = subscription.endpoint;
      const p256dh = bufToB64u(subscription.getKey("p256dh"));
      const auth = bufToB64u(subscription.getKey("auth"));
      await pushSubscribe(session, endpoint, p256dh, auth);
      setPushOn(true);
    } catch {
      setPushError(copy.checkins.pushError);
    } finally {
      setPushBusy(false);
    }
  }, [pushKey, session]);

  const disablePush = useCallback(async () => {
    setPushBusy(true);
    setPushError("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/room-sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await pushUnsubscribe(session, subscription.endpoint);
        await subscription.unsubscribe();
      }
      setPushOn(false);
    } catch {
      setPushError(copy.checkins.pushError);
    } finally {
      setPushBusy(false);
    }
  }, [session]);

  const activeCheckinsByDesign = new Set(mine.filter((c) => c.state === "active").map((c) => c.design_id));

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));

  const start = useCallback(
    async (designId: string) => {
      if (!days.length) return;
      setBusy(designId);
      setError("");
      try {
        await optInToCheckin(session, designId, {
          daysOfWeek: days,
          localTime: time,
          timezone: zone,
          quietFrom: quietFrom || null,
          quietTo: quietTo || null,
        });
        setPicking(null);
        await load();
      } catch (e) {
        setError(e instanceof RoomCheckinsApiError ? copy.errors.generic : copy.errors.generic);
      } finally {
        setBusy(null);
      }
    },
    [session, days, time, zone, quietFrom, quietTo, load],
  );

  const stop = useCallback(
    async (checkinId: string) => {
      setBusy(checkinId);
      setError("");
      try {
        await stopCheckin(session, checkinId);
        await load();
      } catch {
        setError(copy.errors.generic);
      } finally {
        setBusy(null);
      }
    },
    [session, load],
  );

  return (
    <section className="room-menu room-checkins" role="dialog" aria-label={copy.checkins.title}>
      <h2>{copy.checkins.title}</h2>
      <p className="room-fine">{copy.checkins.intro}</p>
      {error && <p className="room-error">{error}</p>}

      {mine.length > 0 && (
        <>
          <h3 className="room-checkins-subhead">{copy.checkins.mineTitle}</h3>
          <ul className="room-checkins-list">
            {mine.map((c) => (
              <li key={c.checkin_id} className="room-checkins-row">
                <span>{c.title}</span>
                {c.state === "active" ? (
                  <button type="button" className="room-btn" disabled={busy === c.checkin_id} onClick={() => void stop(c.checkin_id)}>
                    {busy === c.checkin_id ? "..." : copy.checkins.stop}
                  </button>
                ) : (
                  <span className="room-fine">{copy.checkins.stopped}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {designs.length === 0 ? (
        <p className="room-fine">{copy.checkins.empty}</p>
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
                    <div className="room-checkins-days" role="group" aria-label={copy.checkins.daysLabel}>
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
                      {copy.checkins.timeLabel}
                      <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                    </label>
                    <div className="room-checkins-quiet">
                      <span className="room-fine">{copy.checkins.quietLabel}</span>
                      <label className="room-fine">
                        {copy.checkins.quietFromLabel}
                        <input type="time" value={quietFrom} onChange={(e) => setQuietFrom(e.target.value)} />
                      </label>
                      <label className="room-fine">
                        {copy.checkins.quietToLabel}
                        <input type="time" value={quietTo} onChange={(e) => setQuietTo(e.target.value)} />
                      </label>
                    </div>
                    <button
                      type="button"
                      className="room-btn"
                      disabled={busy === d.design_id || !days.length}
                      onClick={() => void start(d.design_id)}
                    >
                      {busy === d.design_id ? "..." : copy.checkins.add}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="room-btn" onClick={() => setPicking(d.design_id)}>
                    {copy.checkins.add}
                  </button>
                )}
              </li>
            ))}
        </ul>
      )}

      {pushKey && (
        <div className="room-checkins-push">
          <p className="room-fine">{pushOn ? copy.checkins.pushOnCopy : copy.checkins.pushOffCopy}</p>
          {pushError && <p className="room-error">{pushError}</p>}
          <button
            type="button"
            className="room-btn"
            disabled={pushBusy}
            onClick={() => void (pushOn ? disablePush() : enablePush())}
          >
            {pushBusy ? "..." : pushOn ? copy.checkins.pushDisable : copy.checkins.pushEnable}
          </button>
        </div>
      )}

      <button type="button" className="room-btn" onClick={onClose}>
        {copy.checkins.close}
      </button>
    </section>
  );
}
