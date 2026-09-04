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
  /** `rate_limited` (WS-R26, api/_rate-limit.js) carries this one: how many
   *  seconds until the same connection is admitted again. */
  retryAfterSeconds?: number;

  constructor(
    code: string,
    status: number,
    messagesIncluded?: number,
    voiceSecondsIncluded?: number,
    retryAfterSeconds?: number,
  ) {
    super(code);
    this.code = code;
    this.status = status;
    if (typeof messagesIncluded === "number") this.messagesIncluded = messagesIncluded;
    if (typeof voiceSecondsIncluded === "number") this.voiceSecondsIncluded = voiceSecondsIncluded;
    if (typeof retryAfterSeconds === "number") this.retryAfterSeconds = retryAfterSeconds;
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
  // WS-R39 (migration 101). `null` for a follower who has never opened
  // their own settings page.
  settings_reviewed_at: string | null;
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
  room: { slug: string; display_name: string; name: string; handoff_enabled: boolean };
  disclosure: string;
  joined: boolean;
  follower: RoomFollower | null;
  threads?: RoomThread[];
  session: string | null;
  /** WS-R24. The follower's own stored locale once joined; the browser hint
   *  behind the creator's own `default_locale` before that. `roomDisclosureCard`
   *  above is rendered in exactly this locale - never re-picked client side. */
  locale: "en" | "hi";
}

/** WS-R30 (migration 093). `cap_reached` is written to the ledger but never
 *  rendered as its own card client-side - the capped card (below) already
 *  covers that moment; this type exists so `session_worked` has somewhere to
 *  land. `price_inr`/`currency` are null when the creator has not set a
 *  price yet, the honest `pay.priceNotSet` state one screen over. */
export interface RoomOffer {
  reason: "session_worked" | "cap_reached";
  price_inr: number | null;
  currency: string | null;
}

export interface RoomTurn {
  bubbles: string[];
  reply: string;
  remembers: boolean;
  thread_id: string | null;
  quota: RoomQuota;
  upgrade_prompt: boolean;
  offer: RoomOffer | null;
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
      typeof data?.retry_after_seconds === "number" ? data.retry_after_seconds : undefined,
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

/** `locale` is a HINT, read only when there is no follower row yet to answer
 *  the question instead - `api/_room-surface.js`'s `openRoom` ignores it the
 *  moment a follower already exists. Omit it and the server falls back to the
 *  creator's own `default_locale`. */
export const openRoom = (slug: string, accessToken?: string | null, locale?: string | null) =>
  post<RoomOpen>({ op: "open", room: slug, locale: locale || undefined }, accessToken);

export const joinRoom = (
  slug: string,
  accessToken: string,
  answers: { age18: boolean; remember: boolean },
  locale?: string | null,
) => post<RoomOpen & { session: string }>(
  { op: "join", room: slug, age_18: answers.age18, remember: answers.remember, locale: locale || undefined },
  accessToken,
);

/** WS-R24, the follower's own chrome language, changed from inside a Room
 *  they have already joined. Scoped off the SESSION, never a person id in the
 *  body - `api/_room-surface.js`'s `roomSetLocale` is the one predicate that
 *  enforces this, so a follower cannot name another follower's row here even
 *  by constructing the request by hand. Returns a fresh session, because the
 *  disclosure card's bytes (and therefore its bound digest) changed with the
 *  language. */
export const setRoomLocale = (session: string, locale: "en" | "hi") =>
  post<{ locale: "en" | "hi"; session: string }>({ op: "locale", session, locale });

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

export interface PulseOptIn {
  thread_id: string | null;
  active: boolean;
  granted_at?: string;
  revoked_at?: string | null;
  policy_version?: number;
}

/** "Let this count" - a follower's own toggle (WS-R17). `threadId` null
 *  means "this whole relationship", the shape used before the Room has any
 *  threads. Both are revocable and both answer with the row's own state,
 *  never a fake success. */
export const setPulseOptIn = (session: string, threadId: string | null) =>
  post<PulseOptIn>({ op: "pulse_optin", session, thread: threadId });

export const revokePulseOptIn = (session: string, threadId: string | null) =>
  post<PulseOptIn>({ op: "pulse_revoke", session, thread: threadId });

/** "Continue free" (WS-R30). No offer id in the request - scope comes off
 *  the session, `api/_room-surface.js`'s `roomDismissOffer` own header. */
export const dismissOffer = (session: string) =>
  post<{ dismissed: boolean }>({ op: "offer_dismiss", session });

export const roomCitations = (session: string) =>
  post<RoomCitations>({ op: "citations", session });

export const roomStats = (slug: string) =>
  post<{ talked_today: number | null }>({ op: "stats", room: slug });

export const exportRoomData = (session: string, accessToken: string) =>
  post<Record<string, unknown>>({ op: "export", session }, accessToken);

/** WS-R27 (migration 090): the one row that survives a follower's forget in
 *  this Room. Content-free by construction (`person_hash`, never a person id)
 *  - see api/memory.js's `roomForgetReceiptHash` for why. `null` only when the
 *  database has not yet applied migration 090, never because the write
 *  failed (a failed write fails the whole `forget` request). */
export interface RoomForgetReceipt {
  receipt_id: string;
  room: string;
  person_hash: string;
  policy_version: number;
  counts: Record<string, number>;
  issued_at: string;
}

export const forgetRoomData = (session: string, accessToken: string) =>
  post<{ forgotten: boolean; deleted: Record<string, number>; receipt: RoomForgetReceipt | null }>(
    { op: "forget", session },
    accessToken,
  );

// ── web push (WS-R22, migration 085) ───────────────────────────────────────
// The endpoint/keys are the browser's OWN `PushSubscription`, never
// constructed here - `CheckinsPanel.tsx`'s `enablePush` builds them via the
// real `PushManager` and hands the three fields straight through.
export const pushSubscribe = (session: string, endpoint: string, p256dh: string, auth: string) =>
  post<{ subscribed: boolean; subscription_id?: string }>({ op: "push_subscribe", session, endpoint, p256dh, auth });

export const pushUnsubscribe = (session: string, endpoint: string) =>
  post<{ subscribed: boolean; revoked: boolean }>({ op: "push_unsubscribe", session, endpoint });

export const pushStatus = (session: string) => post<{ subscribed: boolean }>({ op: "push_status", session });

// ── check-ins on WhatsApp (WS-R29, migration 092) ──────────────────────────
// `available` is server-driven, `pushKey`'s own shape one channel over: null/
// false means `ROOM_WHATSAPP_TEMPLATE_APPROVED` is unset on this deployment,
// and the whole control is absent, never shown-and-disabled (workstream law
// #3 - "structurally absent the way INVITES_REQUIRED was").
export interface RoomWhatsappStatus {
  available: boolean;
  subscribed: boolean;
  state: "active" | "stopped" | "failed" | null;
  phone_masked: string | null;
}

export const whatsappStatus = (session: string) =>
  post<RoomWhatsappStatus>({ op: "whatsapp_status", session });

export const whatsappOptIn = (session: string, phone: string) =>
  post<{ subscribed: boolean; state: string; phone_masked: string }>({ op: "whatsapp_optin", session, phone });

export const whatsappStop = (session: string) =>
  post<{ subscribed: boolean; state: string }>({ op: "whatsapp_stop", session });

// ── the follower's own page (WS-R39, migration 101) ────────────────────────
// One composed read for the account page: memory consent (via `follower`,
// already on this type), the three check-in channels' status, the room's
// price, any open cap-reached offer, and when this page was last reviewed.
// Subscription STATE is deliberately not part of this shape — the page reads
// it through the EXISTING `paymentStatus` op (roomPayApi.ts) instead, `api/
// _room-surface.js`'s own header explains why.
export interface RoomSettingsChannelPush {
  subscribed: boolean;
}
export interface RoomSettingsChannelWhatsapp {
  available: boolean;
  subscribed: boolean;
  state: "active" | "stopped" | "failed" | null;
  phone_masked: string | null;
}
export interface RoomSettingsChannelTelegram {
  connected: boolean;
  checkins_enabled: boolean;
  stopped: boolean;
}
export interface RoomSettingsOffer {
  reason: "cap_reached";
  shown_at: string;
}
export interface RoomSettingsPrice {
  price_inr: number;
  currency: string;
}
export interface RoomSettings {
  room: { slug: string; name: string; display_name: string };
  disclosure: string;
  locale: "en" | "hi";
  follower: RoomFollower;
  settings_reviewed_at: string | null;
  channels: {
    push: RoomSettingsChannelPush;
    whatsapp: RoomSettingsChannelWhatsapp;
    telegram: RoomSettingsChannelTelegram;
  };
  price: RoomSettingsPrice | null;
  /** The one OPEN `cap_reached` offer, if any — `null` otherwise. A
   *  `session_worked` offer never appears here; it already reached the
   *  client on the turn that earned it (`RoomTurn.offer`). */
  offer: RoomSettingsOffer | null;
}

export const roomSettings = (session: string) => post<RoomSettings>({ op: "settings", session });

export const markSettingsReviewed = (session: string) =>
  post<{ settings_reviewed_at: string | null }>({ op: "settings_reviewed", session });
