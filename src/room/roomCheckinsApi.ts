// Check-ins — the follower's side. `roomApi.ts`'s own pattern one file over:
// owns no decision, every rule lives in api/_checkins.js.
export class RoomCheckinsApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export interface RoomCheckinDesign {
  design_id: string;
  title: string;
  cadence_hint: string;
}

export interface RoomCheckin {
  checkin_id: string;
  design_id: string;
  title: string;
  days_of_week: number[];
  local_time: string;
  timezone: string;
  quiet_from: string | null;
  quiet_to: string | null;
  next_due_at: string | null;
  state: "active" | "stopped";
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/checkins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RoomCheckinsApiError(String(data?.error || `checkins_request_failed_${response.status}`), response.status);
  return data as T;
}

/** `push_public_key` rides along on the SAME `designs` round trip
 *  (api/checkins.js, WS-R22) rather than a second request — null when
 *  `ROOM_PUSH_VAPID_PUBLIC` is unset on this deployment, which is what makes
 *  `CheckinsPanel`'s push control absent by default rather than shown-and-
 *  broken. */
export const listCheckinDesignsAndPushKey = (session: string) =>
  post<{ designs: RoomCheckinDesign[]; push_public_key: string | null }>({ op: "designs", session });

export const listCheckinDesigns = (session: string) =>
  listCheckinDesignsAndPushKey(session).then((r) => r.designs);

export const optInToCheckin = (
  session: string,
  designId: string,
  schedule: {
    daysOfWeek: number[];
    localTime: string;
    timezone: string;
    quietFrom?: string | null;
    quietTo?: string | null;
  },
) =>
  post<RoomCheckin>({
    op: "opt_in",
    session,
    design_id: designId,
    days_of_week: schedule.daysOfWeek,
    local_time: schedule.localTime,
    timezone: schedule.timezone,
    quiet_from: schedule.quietFrom ?? null,
    quiet_to: schedule.quietTo ?? null,
  });

export const stopCheckin = (session: string, checkinId: string) =>
  post<{ checkin_id: string; state: string }>({ op: "stop", session, checkin_id: checkinId });

export const listMyCheckins = (session: string) =>
  post<{ checkins: RoomCheckin[] }>({ op: "list_mine", session }).then((r) => r.checkins);

/** The IANA zone the browser itself is in — offered as the default so a
 *  follower is not asked to know their own timezone's name. */
export const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const WEEKDAY_LABELS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];
