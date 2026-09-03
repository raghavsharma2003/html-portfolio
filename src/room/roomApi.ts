// The Room's one fetch wrapper. Follows the existing *Api.ts pattern
// (src/studio/channelsApi.ts, teacherSheetApi.ts) so a reader who knows one
// knows this one.
//
// It owns NO decision. Every rule about who may say what lives in
// api/_room-surface.js, where the offline suite can reach it; this file turns
// an op into a POST and an error code into a typed error, and nothing else.

export class RoomApiError extends Error {
  code: string;
  status: number;
  /** `room_free_cap_reached`/`room_paid_cap_reached` carry one: the message
   *  allowance that was hit. */
  messagesIncluded?: number;
  /** `room_voice_cap_reached` carries this one instead (WS-R19): the voice
   *  seconds allowance that was hit. */
  voiceSecondsIncluded?: number;

  constructor(code: string, status: number, messagesIncluded?: number, voiceSecondsIncluded?: number) {
    super(code);
    this.code = code;
    this.status = status;
    if (typeof messagesIncluded === "number") this.messagesIncluded = messagesIncluded;
    if (typeof voiceSecondsIncluded === "number") this.voiceSecondsIncluded = voiceSecondsIncluded;
  }
}

export interface RoomQuota {
  tier: "free" | "paid";
  messages_used: number;
  messages_included: number;
  messages_left: number | null;
}

export interface RoomFollower {
  joined_at: string | null;
  tier: "free" | "paid";
  remembers: boolean;
  messages_used: number;
  messages_included: number;
  messages_left: number | null;
  // WS-R19: real only for a paid follower — see api/_room-surface.js's
  // `clientFollower` for why a free follower's own copy of these is always 0.
  voice_seconds_used: number;
  voice_seconds_included: number;
  voice_seconds_left: number;
}

export interface RoomSpoken {
  audio: string;
  format: { sampleRate: number; channels: number };
  generation_id: string;
  watermark_algorithm: string;
  disclosure_scheme: string;
  voice: { seconds_used: number; seconds_included: number; seconds_left: number };
  session: string;
}

export interface RoomThread {
  thread_id: string;
  title: string;
  last_message_at: string | null;
}

export interface RoomOpen {
  room: { slug: string; display_name: string; name: string };
  disclosure: string;
  joined: boolean;
  follower: RoomFollower | null;
  threads?: RoomThread[];
  session: string | null;
}

export interface RoomTurn {
  bubbles: string[];
  reply: string;
  remembers: boolean;
  thread_id: string | null;
  quota: RoomQuota;
  upgrade_prompt: boolean;
  session: string;
}

export interface RoomHistory {
  remembers: boolean;
  thread_id?: string | null;
  turns: { role: "user" | "assistant"; content: string }[];
}

export interface RoomCitations {
  name: string;
  sources: string[];
  exact: boolean;
}

async function post<T>(body: Record<string, unknown>, accessToken?: string | null): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch("/api/room", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new RoomApiError(
      String(data?.error || `room_request_failed_${response.status}`),
      response.status,
      typeof data?.messages_included === "number" ? data.messages_included : undefined,
      typeof data?.voice_seconds_included === "number" ? data.voice_seconds_included : undefined,
    );
  }
  return data as T;
}

/** The slug is the URL and the URL is the slug. Read from the path rather than
 *  from a query so the address a creator prints on a card is the address that
 *  works, and clamped to the same shape the server accepts so a junk path is a
 *  local "not found" rather than a round trip. */
export function slugFromPath(pathname = window.location.pathname): string {
  const match = /^\/r\/([a-z0-9][a-z0-9-]{0,62})\/?$/i.exec(pathname);
  return match ? match[1].toLowerCase() : "";
}

export const openRoom = (slug: string, accessToken?: string | null) =>
  post<RoomOpen>({ op: "open", room: slug }, accessToken);

export const joinRoom = (
  slug: string,
  accessToken: string,
  answers: { age18: boolean; remember: boolean },
) => post<RoomOpen & { session: string }>(
  { op: "join", room: slug, age_18: answers.age18, remember: answers.remember },
  accessToken,
);

export const sayInRoom = (
  session: string,
  message: string,
  options: { thread?: string | null; transcript?: { role: string; content: string }[] } = {},
) =>
  post<RoomTurn>({
    op: "say",
    session,
    message,
    thread: options.thread ?? null,
    transcript: options.transcript ?? [],
  });

/** WS-R19, behind `VITE_ROOM_VOICE`. `text` must be the EXACT reply text the
 *  session just returned from `sayInRoom` — the server binds a clip to the
 *  reply that produced it and refuses anything else, `room_voice_reply_
 *  mismatch`. */
export const speakInRoom = (session: string, text: string) =>
  post<RoomSpoken>({ op: "speak", session, text });

export const roomHistory = (session: string, thread?: string | null) =>
  post<RoomHistory>({ op: "history", session, thread: thread ?? null });

export const newRoomThread = (session: string, title: string) =>
  post<RoomThread>({ op: "thread", session, title });

export const roomCitations = (session: string) =>
  post<RoomCitations>({ op: "citations", session });

export const roomStats = (slug: string) =>
  post<{ talked_today: number | null }>({ op: "stats", room: slug });

export const exportRoomData = (session: string, accessToken: string) =>
  post<Record<string, unknown>>({ op: "export", session }, accessToken);

export const forgetRoomData = (session: string, accessToken: string) =>
  post<{ forgotten: boolean; deleted: Record<string, number> }>({ op: "forget", session }, accessToken);
