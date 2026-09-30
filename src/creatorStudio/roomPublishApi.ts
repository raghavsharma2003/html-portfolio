// roomPublishApi.ts — fetch wrapper for `/api/room-publish`, the *Api.ts
// pattern (see channelsApi.ts, teacherSheetApi.ts).
import { replicaRequest } from "./replicaApi";

export interface OwnedRoom {
  room_id: string;
  slug: string;
  display_name: string;
  free_monthly_messages: number;
  paid_monthly_messages: number;
  paid_monthly_voice_seconds: number;
  // WS-R24: the Room's default CHROME language for a follower whose browser
  // reports nothing usable and who has no follower row yet - never the AI's
  // own reply language, which this file has no opinion about.
  default_locale: "en" | "hi";
  // WS-R45. The creator directory's own two fields: the one-line description
  // shown alongside the name, and whether this Room currently opts in to
  // being listed there at all.
  one_line_bio: string;
  // WS-R75 (migration 119). `null` means off - the default, kept forever
  // exactly as every Room already behaves. An integer >= 180 turns it on.
  dormancy_days: number | null;
  listed: boolean;
  listed_at: string | null;
  published: boolean;
  paused: boolean;
  published_at: string | null;
  paused_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  // WS-R18. `null` means no ROOM_TELEGRAM_BOT_USERNAME is configured on this
  // deployment — the server's own honest "not connected", never a guessed
  // URL the client assembles itself.
  telegram_deep_link: string | null;
}

export interface RoomBlocker {
  code: string;
  headline: string;
  next: string;
  anchor: string;
}

export interface RoomBlockers {
  waiting_on_you: RoomBlocker[];
  waiting_on_us: RoomBlocker[];
}

/** WS-R66. One Q&A slot on the creator's own public page (`/c/<slug>`,
 *  migration 115). `position` is 1..5 — the database's own ceiling, never a
 *  limit this client merely promises to respect. */
export interface RoomShowcaseItem {
  id: string;
  question: string;
  answer: string;
  position: number;
}

export interface RoomState {
  room: OwnedRoom | null;
  reason: string | null;
  can_publish?: boolean;
  blockers?: RoomBlockers;
  // WS-R66. Fed on the same GET this state already comes from — no second
  // round trip the Share tab has to remember to fire.
  showcase?: RoomShowcaseItem[];
}

export interface RoomStats {
  followers_total: number;
  followers_active_24h: number;
  messages_this_month: number;
  // WS-R86 (migration 123). `api/_funnel.js`'s own `friendsBroughtThisWeek`
  // shape, typed here unchanged - n>=5 floored, `OpsShareArrivals`'s own
  // shape (opsApi.ts) one surface over.
  friends_brought_this_week: { n: number | null; below_floor: boolean; note: string };
}

// WS-R85 (migration 122). `api/_share-kit.js`'s own `buildShareKit` shape,
// typed here unchanged — this file computes nothing, `opsApi.ts`'s own
// header rule restated for a second file.
export interface ShareKitRow {
  // "whatsapp_join" (WS-R126, migration 131) is a FIFTH, optional row — a
  // direct wa.me deep link that opens the business chat with `join <slug>`
  // already typed, present only when the server's own `whatsappJoinUrl`
  // resolved to something real (`api/_share-kit.js`'s own header on why it
  // is a distinct channel key from "whatsapp" above, never folded into it).
  channel: "whatsapp" | "instagram" | "youtube" | "telegram" | "whatsapp_join";
  text: string;
  url: string;
  picture: "story" | "og" | null;
}

export interface ShareKit {
  room_id: string;
  // `null` for a Room that has never published — `api/_share-kit.js`'s own
  // "nothing honest to share yet" rule.
  kit: ShareKitRow[] | null;
  // WS-R136: true only when the WhatsApp chat lane is ON, the Room HAS
  // published, and no dialable number could be resolved (unset, a failed
  // live read, or a value that failed the digits-only shape check) —
  // `api/_room-publish.js`'s own `ownerRoomShareKit` header states why this
  // is a separate signal from the `whatsapp_join` row's own absence, which
  // by itself cannot distinguish "the lane is off" from "the lane is on but
  // unverified". `ShareKitCard.tsx` shows an explanation only when this is
  // true.
  whatsapp_join_unavailable: boolean;
}

/** Thrown by every op below with the server's own code and, when the server
 *  sent one, its blocker detail — `ReplicaApiError`'s own shape, one file
 *  over, so a caller already handling that type handles this one the same
 *  way (401/403 -> re-auth, anything else -> a named reason on screen). */
export class RoomPublishApiError extends Error {
  status: number;
  code: string;
  blockers: RoomBlockers | null;

  constructor(code: string, status: number, blockers: RoomBlockers | null = null) {
    super(code);
    this.status = status;
    this.code = code;
    this.blockers = blockers;
  }
}

async function call<T>(token: string, body: Record<string, unknown>): Promise<T> {
  try {
    return await replicaRequest<T>(token, "/api/room-publish", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (e: any) {
    const code = typeof e?.data?.error === "string" ? e.data.error : (e?.message || "room_publish_failure");
    const blockers = e?.data?.details && e.data.details.waiting_on_you ? (e.data.details as RoomBlockers) : null;
    throw new RoomPublishApiError(code, Number(e?.status || 500), blockers);
  }
}

export async function readOwnedRoom(token: string, replicaId: string): Promise<RoomState | null> {
  try {
    return await replicaRequest<RoomState>(
      token,
      `/api/room-publish?replica_id=${encodeURIComponent(replicaId)}`,
    );
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

export async function createOwnedRoom(token: string, replicaId: string, slug?: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "create", replica_id: replicaId, slug });
  return data.room;
}

export async function renameOwnedRoom(token: string, replicaId: string, slug: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "rename", replica_id: replicaId, slug });
  return data.room;
}

export async function publishOwnedRoom(token: string, replicaId: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "publish", replica_id: replicaId });
  return data.room;
}

export async function pauseOwnedRoom(token: string, replicaId: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "pause", replica_id: replicaId });
  return data.room;
}

export async function resumeOwnedRoom(token: string, replicaId: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "resume", replica_id: replicaId });
  return data.room;
}

export async function setOwnedRoomFreeCap(token: string, replicaId: string, cap: number): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "set_free_cap", replica_id: replicaId, cap });
  return data.room;
}

/** Both paid ceilings in one call — `setOwnedRoomFreeCap`'s own shape. */
export async function setOwnedRoomPaidCeilings(
  token: string,
  replicaId: string,
  messages: number,
  voiceSeconds: number,
): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, {
    op: "set_paid_ceilings",
    replica_id: replicaId,
    messages,
    voice_seconds: voiceSeconds,
  });
  return data.room;
}

export async function setOwnedRoomDefaultLocale(
  token: string,
  replicaId: string,
  locale: "en" | "hi",
): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "set_default_locale", replica_id: replicaId, locale });
  return data.room;
}

/** The directory's one-line description of the creator, `setOwnedRoomFreeCap`'s
 *  own shape. */
export async function setOwnedRoomBio(token: string, replicaId: string, bio: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "set_bio", replica_id: replicaId, bio });
  return data.room;
}

/** The retention policy - `setOwnedRoomFreeCap`'s own shape. `days` is
 *  `null` (turn the policy off) or an integer >= the server's own floor
 *  (`room_dormancy_days_invalid` on a value below it, `RoomPublishApiError`'s
 *  own shape, `blockers: null`). */
export async function setOwnedRoomDormancyDays(
  token: string,
  replicaId: string,
  days: number | null,
): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "set_dormancy_days", replica_id: replicaId, days });
  return data.room;
}

/** Opt in to the creator directory. Refused (a named `room_list_requires_
 *  published` error, `RoomPublishApiError`'s own shape) unless the Room is
 *  already published — `api/_room-publish.js`'s own write predicate, never a
 *  client-side guess repeated here. */
export async function listOwnedRoom(token: string, replicaId: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "list", replica_id: replicaId });
  return data.room;
}

/** Opt out. Unconditional, `pauseOwnedRoom`'s own shape. */
export async function unlistOwnedRoom(token: string, replicaId: string): Promise<OwnedRoom> {
  const data = await call<{ room: OwnedRoom }>(token, { op: "unlist", replica_id: replicaId });
  return data.room;
}

export async function readOwnedRoomStats(token: string, replicaId: string): Promise<RoomStats> {
  const data = await call<{ stats: RoomStats }>(token, { op: "stats", replica_id: replicaId });
  return data.stats;
}

/** The Share tab's own share kit — `readOwnedRoomStats`'s own shape, one op
 *  over. Returns `kit: null` for a Room that has never published rather
 *  than throwing; `ShareKitCard.tsx` renders that as an honest empty state. */
export async function readOwnedRoomShareKit(token: string, replicaId: string): Promise<ShareKit> {
  return call<ShareKit>(token, { op: "share_kit", replica_id: replicaId });
}

/** Set one showcase slot (1..5): either typed/edited text (`question`/
 *  `answer`) or a source review card's own id (`sourceCardId`) — never both
 *  read as meaningful at once, `api/_room-publish.js`'s own precedence (a
 *  card id, when present, wins). A card that is not `state: 'sounds_right'`
 *  or whose `kind` is `'follower_declined'` is refused
 *  (`room_showcase_card_ineligible`), never silently copied. */
export async function setOwnedRoomShowcase(
  token: string,
  replicaId: string,
  input: { position: number; question?: string; answer?: string; sourceCardId?: string },
): Promise<RoomShowcaseItem[]> {
  const data = await call<{ showcase: RoomShowcaseItem[] }>(token, {
    op: "showcase_set",
    replica_id: replicaId,
    position: input.position,
    question: input.question,
    answer: input.answer,
    source_card_id: input.sourceCardId,
  });
  return data.showcase;
}

/** Take one showcase item down. Unconditional, `unlistOwnedRoom`'s own
 *  shape. */
export async function removeOwnedRoomShowcase(token: string, replicaId: string, id: string): Promise<RoomShowcaseItem[]> {
  const data = await call<{ showcase: RoomShowcaseItem[] }>(token, { op: "showcase_remove", replica_id: replicaId, id });
  return data.showcase;
}

/** The follower-facing address. Built from the browser's own origin, so a
 *  preview deployment prints a link to itself rather than a hardcoded
 *  production one nobody previewing it can reach — `channelsApi.ts`'s
 *  `embedSnippet` reasoning, one surface over. */
export function roomLink(slug: string, origin = window.location.origin): string {
  return `${origin}/r/${slug}`;
}

/** WS-R66. The creator's own public page — never shown unless the Room is
 *  BOTH published and listed (`api/_creators.js`'s own predicate, restated
 *  here as a link rather than re-checked), so a card printing this before
 *  either is true would print a link that 404s as the platform's own name. */
export function creatorPageLink(slug: string, origin = window.location.origin): string {
  return `${origin}/c/${slug}`;
}

/** WS-R46. `channelsApi.ts`'s `embedSnippet` shape, one surface over: one
 *  script tag, `data-room` naming the address, `defer` so it never blocks
 *  the creator's own page. Built from the browser's own origin for the
 *  identical reason `roomLink` is — a preview deployment prints a snippet
 *  pointing at itself. */
export function roomEmbedSnippet(slug: string, origin = window.location.origin): string {
  return `<script src="${origin}/room-embed.js" data-room="${slug}" defer></script>`;
}

/** WS-R55. The story card the Share tab links to — `/r/<slug>/story.png`,
 *  `vercel.json`'s own rewrite to `api/room-card.js`. Built from the
 *  browser's own origin for the identical reason `roomLink` is — a preview
 *  deployment prints a link to itself. The endpoint behind it reads the
 *  SAME public row `roomLink`'s own page does (no follower data, no new
 *  auth), so this needs no token; it is scoped to "the creator's own Room"
 *  only by WHICH slug the Share tab already has in its own owner-scoped
 *  `room` state, never by a check this function performs. */
export function storyCardLink(slug: string, origin = window.location.origin): string {
  return `${origin}/r/${slug}/story.png`;
}

/** WS-R78. The printable poster the Share tab links to —
 *  `/r/<slug>/poster.png`, `vercel.json`'s own rewrite to
 *  `api/room-card.js`'s `poster` kind. `storyCardLink`'s own shape, one
 *  file size over — same public row, same no-token, same "the browser's
 *  own origin so a preview deployment prints a link to itself" reasoning.
 *  The poster's own QR encodes this SAME origin plus `?via=poster`
 *  (`api/_room-card.js`'s `cardInputFor`), so a creator previewing this
 *  link and a stranger scanning the printed sheet always land on the
 *  identical deployment. */
export function posterLink(slug: string, origin = window.location.origin): string {
  return `${origin}/r/${slug}/poster.png`;
}

/** WS-R85. The unfurl/og image the share kit's YouTube row links to —
 *  `/r/<slug>/og.png`, `api/_room-card.js`'s `og` kind — `storyCardLink`'s
 *  own shape, the landscape size instead of the portrait one. Already
 *  served (`evals/room-share/run.mjs`'s own `og:image` assertion), never
 *  linked from the studio directly until now. */
export function ogImageLink(slug: string, origin = window.location.origin): string {
  return `${origin}/r/${slug}/og.png`;
}

// WS-R31. The one derived fact `StudioShell.tsx`'s Share tab needs from a
// `RoomBlockers` read: the single next thing, waiting-on-you first, else
// waiting-on-us, matching `RoomStudio.tsx`'s own "name the top one" rule
// (`WizardRail.tsx`'s `StepBlockers`, one surface over). Lives here rather
// than in `RoomStudio.tsx` so it can be bundled by `evals/studio-shell/run.mjs`
// without pulling in React or a CSS import: this file already has neither.
export function firstRoomBlocker(blockers: RoomBlockers | null): { label: string; anchor: string; cls: "you" | "us" } | null {
  const you = blockers?.waiting_on_you?.[0];
  if (you) return { label: you.headline, anchor: you.anchor, cls: "you" };
  const us = blockers?.waiting_on_us?.[0];
  if (us) return { label: us.headline, anchor: us.anchor, cls: "us" };
  return null;
}
