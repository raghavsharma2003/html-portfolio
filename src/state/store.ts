// Lightweight app state persisted to localStorage — no external state library needed.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { UserProfile } from "../engine/persona";
import type { Inner } from "../engine/inner";
// TYPE ONLY — erased at compile time, so the state layer still imports no
// engine runtime (memory.ts reaches Capacitor and the network; this does not
// drag either into the store's bundle).
import type { ActivityRecord } from "../engine/memory";
// TYPE ONLY, and from the LEAF rather than from `src/notify/index.ts` — that
// module reaches `engine/persona.ts` for her name, and a type imported through
// it would be a runtime edge the moment someone forgot the `type` keyword.
// `src/notify/prefs.ts` imports nothing at all, which makes the edge safe by
// construction rather than by discipline.
import type { NotifyPrefs } from "../notify/prefs";
import { tel } from "../engine/telemetry";

export interface Message {
  id: string;
  from: "her" | "me";
  // "callmark" renders as a centered "📞 Voice call · m:ss" record;
  // "voice" is a voice-note bubble; "gif" is a meme gif bubble
  kind: "text" | "photo" | "callmark" | "voice" | "gif";
  text: string; // for photos this is the caption
  photoSeed?: string; // deterministic seed for the generated photo card
  at: number;
  // my messages only: ✓ sent → ✓✓ delivered → blue ✓✓ read (when she reads).
  // absent on old messages = read.
  status?: "sent" | "delivered" | "read";
  // WhatsApp-style quote: set when this message replies to a specific one
  // `photo` is set when the quoted thing IS a picture (a story reply). The
  // owner's screenshot showed why text alone is wrong: replying to a mirror
  // selfie rendered as the words "mirror selfie…", which reads as her having
  // SAID that. Instagram quotes the image. So do we.
  replyTo?: { from: "her" | "me"; text: string; photo?: string };
  // "call" turns are spoken words: hidden from the chat UI, but fed to the
  // brain so she remembers call conversations perfectly
  channel?: "chat" | "call";
  // Said while their SCREEN was shared. A separate flag rather than a third
  // `channel` value, deliberately: nine readers across six files switch on
  // `channel !== "call"` (the chat UI's own visibility filter among them), so
  // a third value would have leaked share-derived speech into the thread, the
  // chat tail, the repeat window and the burst grouper all at once. Absent
  // means "not a share turn" — `SelfFactKind`'s precedent, and for its reason:
  // every message already on a device predates this field.
  //
  // It is what useCallEngine.ts's `watchTurnIds` ref could not be. That ref is
  // trimmed to the newest 200 ids on a long session, so the OLDEST share turns
  // of a long call silently stop being recognised as share turns — on exactly
  // the call this matters for. A flag on the message cannot be trimmed, and it
  // is what `logTurns` maps to `channel: "watch"` on the wire.
  watched?: true;
  dur?: number; // voice notes: length in seconds
  spoken?: string; // her voice notes: raw expressive text (with audio tags)
  gifUrl?: string; // gif bubbles: resolved CDN url (cached after first fetch)
  // A single emoji sitting on this bubble, WhatsApp-style. On HER messages it
  // is his; on HIS it is hers, arriving as a [react: X] marker she emits. One
  // per message on purpose — a reaction is a glance, and a stack of them is a
  // thread, which is what the quote-reply already is.
  reaction?: string;
  photoUrl?: string; // photos the USER sent (public storage url)
  // MORE THAN ONE PICTURE ON ONE MESSAGE (WS-COMPOSER, owner ask: WhatsApp's
  // multi-select, capped at 5). Present ONLY when the message carries more than
  // one, and `photoUrl` always holds the first of them.
  //
  // That redundancy is the compatibility story and it is deliberate. Every
  // existing reader of a picture message — brain.ts's vision window, the
  // upload swap, an older build on the user's other phone reading the same
  // synced blob — knows `photoUrl` and nothing else. Writing both means the
  // worst an old reader can do is show one picture out of five, instead of
  // showing an empty bubble where a message used to be. `imagesOf()` in
  // components/attachments.ts is the one reader that prefers the new field, so
  // the precedence rule lives in exactly one place.
  //
  // The caption is `text`, unchanged: a photo message has always kept its
  // caption there, and a second caption field would be two places to look.
  photoUrls?: string[];
  desc?: string; // user photos: one-line vision description (context + memory)
  // DOCUMENTS HE SENT (WS-COMPOSER, up to 3). METADATA ONLY, and the absence of
  // the bytes is the whole design rather than an omission.
  //
  // A document's TEXT reaches her exactly once, in the turn it was attached to,
  // through `think`'s `attachments` parameter. Nothing uploads it and nothing
  // stores it, so this is what the thread keeps: the name, the format and the
  // size. That is also what a person keeps — you remember someone sent you a
  // PDF called `rent-agreement`, not its third paragraph.
  //
  // WHY NOT THE BYTES. A 2 MB PDF in AppState is `saveState`'s entire
  // degradation ladder fired by one attachment, and unlike a stuck photo data:
  // URL there is no upload that would ever come along and replace it, so it
  // would sit in localStorage for the life of the install. `persistable`'s
  // stuck-data-URL guard cannot help with a field that is SUPPOSED to hold
  // bytes; the fix is for the field never to hold them.
  //
  // Absent on every message that predates this and on every message with no
  // attachment, which is the same rule `photoUrls` and `watched` follow: a
  // stored shape is not rewritten under a running install.
  docs?: Array<{ name: string; mime: string; size: number }>;
}

/**
 * ONE screen share, as it is kept ON THE DEVICE — WS-SHARENOW's local mirror
 * of the `vy_shared_moment` rows `api/episodes.js` writes.
 *
 * It exists because of a timing the server copy structurally cannot win. The
 * owner shared his screen, hung up, and called back ONE MINUTE later to ask
 * what they had watched. The server write is fire-and-forget from
 * `postWatchMoment`, it is gated to the FIRST line she speaks inside a 12s
 * SHOW-wake window, and the read that would fetch it back races
 * `RING_FETCH_DEADLINE_MS` on the next ring. A record that has to survive a
 * hangup, a network round trip and a 1,200ms deadline to be remembered is a
 * record that is sometimes not remembered, and "sometimes" on the one question
 * he actually asked is the whole defect.
 *
 * So this is written SYNCHRONOUSLY at share end, off `AppState.messages`,
 * which is already in memory. No round trip, no embedding, works signed out.
 * The server row still gets written — this is a mirror, not a replacement, and
 * `warm-count-unscoped`'s rule holds: `said` is EXACTLY the text
 * `postWatchMoment` sends as `reaction`, never a second derivation of it.
 *
 * `said` is what SHE said and nothing else. Not one word about what was on the
 * screen: the watch-content contract (`Message.watched` above, and
 * `useCallEngine.ts`'s share-turn rule) is that screen-derived talk is
 * conversation and never durable memory about his life. Her own reactions are
 * hers to remember; the screen's contents beyond them are not re-derived here
 * or anywhere.
 *
 * DEVICE-LOCAL, like `recentMoment` and for its stated reason: this is
 * present-moment flavour with a 45-minute shelf life, and the durable
 * cross-device copy is `vy_shared_moment` on the server. It is absent from
 * `syncableState` and from `mergeStates` for that reason, and present in
 * `crossTabSig` so two tabs of the same device agree.
 */
export interface ShareRecord {
  startedAt: number;
  endedAt: number;
  lane: "web" | "native";
  /** her own lines while the share was up, oldest first, verbatim and clipped
   *  — the same strings `postWatchMoment` sends. Empty is a real answer: a
   *  share where she said nothing is a share she has nothing to report from,
   *  and the brief says so rather than letting her fill it in. */
  said: string[];
}

/** How many finished shares the device keeps. The block that reads them looks
 *  back 45 minutes, so this is generous by an order of magnitude and still
 *  costs under a kilobyte in a localStorage blob measured in tens of KB. */
export const SHARE_LEDGER_MAX = 8;

/** Lines kept per share. Three is the whole of the block's row budget
 *  (`JUST_HAPPENED_ROWS`); a fourth could never render and storing it would be
 *  a second, longer answer to "what did she say" that nothing reads. */
export const SHARE_SAID_MAX = 3;

/** Per-line clip at STORE time. Twice the render cap, so the renderer still
 *  owns the visible clipping and the store never becomes the thing that
 *  silently shortened her sentence. */
export const SHARE_SAID_MAX_CHARS = 160;

/** Add a finished share to the ledger, newest first, deduped on `startedAt`.
 *  Deduped rather than appended because the teardown paths overlap by design —
 *  `endCall` → `stopWatchMode` → the web lane's own `cleanup()` all end the
 *  same share — and a share recorded twice would put her commentary in the
 *  brief twice. Pure; the caller owns the state. */
export function withShareRecord(
  ledger: readonly ShareRecord[] | undefined,
  rec: ShareRecord | null,
): ShareRecord[] {
  const cur = Array.isArray(ledger) ? ledger : [];
  if (!rec || !Number.isFinite(rec.startedAt) || !Number.isFinite(rec.endedAt)) {
    return cur as ShareRecord[];
  }
  const clean: ShareRecord = {
    startedAt: rec.startedAt,
    endedAt: rec.endedAt,
    lane: rec.lane === "native" ? "native" : "web",
    said: (Array.isArray(rec.said) ? rec.said : [])
      .filter((t) => typeof t === "string" && t.trim())
      .map((t) => t.replace(/\s+/g, " ").trim().slice(0, SHARE_SAID_MAX_CHARS))
      .slice(-SHARE_SAID_MAX),
  };
  const kept = cur.filter((r) => r && r.startedAt !== clean.startedAt);
  return [clean, ...kept]
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
    .slice(0, SHARE_LEDGER_MAX);
}

// ── DPDP MEMORY CONSENT (task #148) ────────────────────────────────────────
//
// India's DPDP Act reaches full effect on 2027-05-14, and the part of it this
// product cannot answer with a terms-of-service checkbox is the one about
// STORING CROSS-SESSION PERSONAL AND EMOTIONAL MEMORY: that needs its own
// specific, informed, unbundled consent, and the penalty ceiling for getting
// it wrong is Rs 250 Cr. Bundling it into "by continuing you agree" would be
// the same shape of wrong as bundling it into an 18+ confirmation.
//
// So it is one dedicated question, asked once, in its own step, with a real
// alternative that is not a dead end (see src/components/MemoryConsent.tsx).
//
// THE RECORD IS THREE FIELDS AND NOTHING ELSE. `granted` is the answer, `at`
// is when it was given as an ISO string (a legal record is a date a human can
// read, not an epoch integer), and `version` is which ASK it answers — the
// moment the card's copy changes materially, the version goes up and consent
// to the old text stops standing in for consent to the new one. No free text,
// no name, no device fingerprint: this object is evidence about an answer, not
// another record about a person.
export interface MemoryConsent {
  granted: boolean;
  /** ISO-8601, e.g. "2026-08-25T09:12:44.000Z" */
  at: string;
  version: 1;
}

/** Which ask the current card's copy IS. Bump it when the copy changes what a
 *  person is agreeing to, never for a typo. */
export const MEMORY_CONSENT_VERSION = 1 as const;

/**
 * May this device write cross-session memory?
 *
 * ABSENT MEANS YES, and that default is deliberate rather than lax. Every
 * install that predates this field is an install whose person was never asked,
 * and the answer to "never asked" is to ASK (App.tsx renders a one-time card
 * for exactly them), never to silently switch her memory off underneath a
 * relationship that already exists. The same rule `theme`, `soundOn` and
 * `SelfFactKind` follow one field at a time: a stored shape is not rewritten
 * under a running install.
 *
 * Only an explicit `granted: false` closes the gate. New installs always carry
 * one value or the other, because the onboarding step cannot be skipped past.
 */
export function memoryWritesAllowed(s: Pick<AppState, "memoryConsent">): boolean {
  return s.memoryConsent?.granted !== false;
}

export interface AuthInfo {
  userId: string;
  email?: string;
  phone?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// One thing she has claimed about her own life, and when she claimed it. Her
// day is hers to improvise, but once it's been said it's shared history — this
// is what survives the context window so she can't reinvent it three turns later.
export interface SelfFact {
  text: string;
  at: number;
  // docs/HONESTY.md T-H2. What KIND of claim this is, decided once when the
  // fact enters the ledger and never revisited.
  //
  //   "fact"     durable. "my flatmate is named sneha", "i hate karela".
  //              True tomorrow, true next month; renders until superseded.
  //   "activity" momentary. "khana bana rahi hu", "just heading out".
  //              It was true when she said it and it ENDS. `formatHerLife`
  //              drops it once it can no longer plausibly be running.
  //
  // Optional, and the absence is load-bearing rather than lazy: every
  // SelfFact already on a device was written before this field existed, and
  // `age-tier-never-realtime` is this repo's standing rule that a stored
  // shape is not rewritten under a running install. Absent therefore means
  // "fact" — byte-identical rendering for every ledger that predates this —
  // and only facts ENTERING the ledger from here on carry a kind.
  kind?: SelfFactKind;
}

export type SelfFactKind = "activity" | "fact";

// ── the write-time classifier (docs/HONESTY.md T-H2) ───────────────────────
//
// It lives HERE, beside the type it stamps, for one reason: the state layer
// must not import the engine. A predicate that decides a stored field's value
// is part of that field's contract, and putting it in `engine/` would either
// drag `memory.ts` (and Capacitor, and the network) into `store.ts`, or leave
// the store writing a field whose meaning is defined somewhere it cannot see.
// It is pure, dependency-free and total, which is also what lets an eval drive
// it with plain strings.
//
// WHY LEXICAL AND NOT A PROMPT: the extraction pass that produces these lines
// is already a model call, and adding "and label each one" to it makes the
// label a thing that can be re-negotiated per turn — the same failure mode
// `vision-fab` names. A shape predicate is wrong in a fixed, enumerable way
// that an eval pins; a prompt is wrong differently every time.
//
// The order below matters. DURABLE first: Hindi's present-progressive is also
// how you state where you live ("bangalore me reh rahi hu"), so a bare
// progressive marker cannot be trusted on its own. The veto list is
// deliberately about the PREDICATE (living, being named, working somewhere,
// getting married) and never about a noun, because "cooking for my flatmate
// rn" must stay an activity.
const DURABLE_SHAPE: RegExp[] = [
  /\breh\s*rah[ai]\b/i, // reh rahi hu — living somewhere, not doing something
  /\brehti\s*(hu|hun|hoon)\b/i,
  /\blives?\s+in\b/i,
  /\bgrew\s+up\b/i,
  /\b(naam|name)\s+(hai|is)\b/i,
  /\bis\s+named\b/i,
  /\bgetting\s+married\b|\bshaadi\b/i,
  /\bbirthday\b|\bjanamdin\b/i,
  /\bworks?\s+(at|in|for)\b/i,
  /\bjob\s+(is|at|in)\b/i,
  /\b(hate|hates|love|loves|likes?|pasand)\b/i,
];

// NOWNESS: present-progressive and imminence. Every one of these is a claim
// about a clock, which is what makes it expire.
const ACTIVITY_SHAPE: RegExp[] = [
  /\b(rah[ai]|rh[ai])\s*(hu|hun|hoon|hoo)\b/i, // bana rahi hu, dekh rha hu
  /\bja\s*rah[ai]\b/i, // ja rahi (hu) — on her way
  /\babhi\b/i, // right now
  /\brn\b/i,
  /\bright\s+now\b/i,
  /\bcurrently\b/i,
  /\bat\s+the\s+moment\b/i,
  /\b(just\s+)?about\s+to\b/i,
  /\bheading\b/i,
  /\bon\s+(my|her)\s+way\b/i,
  /\bbrb\b/i,
  /\bin\s+the\s+middle\s+of\b/i,
  /\bjust\s+(got|woke|reached|finished|landed|came|stepped)\b/i,
  /\bgoing\s+to\s+(sleep|bed|shower|nap)\b/i,
  /\b\w+ing\s+(now|rn)\b/i,
];

/**
 * Which kind a self-line is, from its shape alone. Total: anything that is not
 * demonstrably about right-now is durable, because a durable fact rendered a
 * day late is merely old, while an activity rendered a day late is a lie about
 * what she is doing.
 */
export function classifySelfFact(text: string): SelfFactKind {
  const t = (text || "").trim();
  if (!t) return "fact";
  if (DURABLE_SHAPE.some((re) => re.test(t))) return "fact";
  return ACTIVITY_SHAPE.some((re) => re.test(t)) ? "activity" : "fact";
}

/**
 * Stamp a kind on self-facts that are ENTERING the ledger, and only those.
 *
 * Both lanes write `herLife` from their own copy of the same absorb rule
 * (Chat.tsx and useCallEngine.ts), and a classifier bolted onto one of them is
 * a classifier that disagrees with the other within a month. This is the one
 * seam both writes pass through — `useAppState`'s setState — so there is one
 * classification, applied once, wherever a fact came from.
 *
 * A fact already present in `prev` (same text, same stamp) is returned
 * untouched, kind or no kind. That is what keeps the legacy default honest: a
 * ledger loaded from a device that predates this field is not silently
 * rewritten by the next unrelated setState.
 */
export function stampSelfFacts(prev: AppState, next: AppState): AppState {
  const facts = next.herLife;
  if (!facts?.length || facts === prev.herLife) return next;
  let changed = false;
  const stamped = facts.map((f) => {
    if (!f || typeof f.text !== "string" || f.kind) return f;
    if (prev.herLife?.some((p) => p && p.text === f.text && p.at === f.at)) return f;
    changed = true;
    return { ...f, kind: classifySelfFact(f.text) };
  });
  return changed ? { ...next, herLife: stamped } : next;
}

import type { GameSession } from "./game";
import { isGameSession } from "./game";
// merge.ts imports only TYPES from this file, so this is a one-way runtime
// edge (store → merge), not a cycle. The cross-tab adopt below is the same
// problem the account sync solves — two copies of one relationship — and
// solving it twice is how the two answers drift apart.
import { mergeStates, safeUser } from "./merge";
import type { ThemeChoice } from "../engine/theme";
// TYPE-ONLY, so this import erases entirely and store.ts gains no runtime
// edge — herNow.ts's only import is storyCatalog.ts, a documented leaf.
import type { HerNowEntry } from "../engine/herNow";

export interface AppState {
  onboarded: boolean;
  auth?: AuthInfo | null; // signed-in account (null/undefined = anonymous)
  deviceId: string; // anonymous identity for the memory backend
  user: UserProfile;
  messages: Message[];
  openrouterKey: string; // OpenRouter key — her primary brain (open models)
  openrouterModel: string; // OpenRouter model slug; sensible default provided
  apiKey: string; // Claude API key — optional alternative brain
  elevenKey: string; // ElevenLabs key — expressive voice (laughs, whispers)
  elevenVoiceId: string; // ElevenLabs voice id (default: Monika Sogam, Hindi)
  sarvamKey: string; // Sarvam AI key — best Hinglish voice (bulbul:v3)
  deviceVoice: string; // preferred on-device TTS voice (fallback tier)
  lastSeen: number;
  // her self-scheduled follow-up ("back in 20 min" → she texts first)
  followup?: { at: number; why: string } | null;
  // She is calling BACK. Set only when a call ended while she was mid-sentence,
  // which is a drop rather than a goodbye — and calling back after one is what
  // a person does. REASON-CONTINGENT like every other unprompted move she
  // makes (decisions.md#proactive-reason-contingent): the trigger is the drop,
  // never a timer and never his silence.
  callback?: { at: number; secs: number } | null;
  // what she has told them about her own life, newest first (bounded)
  herLife?: SelfFact[];
  // WHAT SHE IS DOING RIGHT NOW — one activity, with the instant it started
  // and how long that class of thing runs (src/engine/herNow.ts).
  //
  // This is a LEDGER, not a roll, and the difference is the whole reason the
  // field exists: he called, she said she was reading; he called again one
  // minute later and she said she was setting fairy lights, because her
  // present moment was being improvised fresh at every pickup. One row, read
  // by every lane, means the second call gets the same answer with the clock
  // moved on — and past the activity's natural span it means she has MOVED
  // ON, which is the same mechanism seen from the other side.
  //
  // It SYNCS, like the rest of the relationship: her evening is the same
  // evening on the phone and on the laptop. It is also deterministic from the
  // clock (`deriveHerNow`), so a device that has never received this row
  // computes the same present moment anyway — the stored copy is the record
  // of what she actually said, not the only source of it.
  //
  // The seam with `herLife` above, stated where both are declared: herNow is
  // THE MINUTE (going on now, never yet told), herLife is what she has TOLD
  // him and is fixed between them. See src/engine/herNow.ts's header.
  herNow?: HerNowEntry | null;
  // her carried interior: ONE feeling in her own words, and what she wants.
  // ~600 bytes, deliberately tiny — a ledger she re-reads, not a simulation
  // she runs. Rides this state's existing local + account sync; no new table.
  inner?: Inner;
  // clear-chat tombstone: synced so a wiped chat can never be resurrected
  // by another device's stale copy
  clearedAt?: number;
  // the account this local state last belonged to — guards against a second
  // account on the same browser inheriting the first account's conversation
  lastAccountId?: string;
  // WHAT THEY ARE DOING TOGETHER. A game in progress lives here rather than in
  // the component that draws the board, and that placement is the whole point:
  // a board held in component state is a board the CALL lane cannot see, so she
  // would be unable to talk about a game she is visibly playing. See
  // state/game.ts for the reasoning and for `activityOf`, the single derivation
  // both lanes read. Undefined is the normal case and renders nothing.
  game?: GameSession | null;
  // Light, dark, or follow the phone. Undefined means "system", which is both
  // the default and the state every existing install is already in — so this
  // field arriving changes nothing for anyone until they touch the setting.
  theme?: ThemeChoice;
  // WS-SOUND. The one switch the sound layer has. `false` is the ONLY value
  // that means off: absent means on, which is both the default and the state
  // every install that predates this field is already in, so the field
  // arriving changes nothing for anyone until they touch the setting. Same
  // rule `theme` above follows and the same one `SelfFactKind` documents at
  // length — a stored shape is not rewritten under a running install.
  //
  // A boolean and not a level, deliberately. A volume slider in a companion
  // app is a control nobody moves and a support question everybody asks; the
  // mix is decided once, in src/sound/index.ts, low, and the only thing a
  // person needs from this screen is a way to make it stop.
  soundOn?: boolean;
  // ── the milestones seam (engine/milestones.ts) ─────────────────────────
  // Fired-ledger: milestone ids that already celebrated, so a moment can
  // never fire twice — across devices too, since this syncs with the rest.
  momentsFired?: string[];
  // A milestone that JUST crossed, as one telegraphic fact — written by the
  // detector at fire time, read by the lanes' key builders, rendered for a
  // few hours so she can bring it up herself (#117), then ignored. Device-
  // local on purpose: this is present-moment flavour; the fired-LEDGER
  // above is what carries the permanent truth and it does sync.
  recentMoment?: { id: string; fact: string; at: number } | null;
  // WS-SHECALLS residual: the moment a her-initiated ring was declined or
  // rang out. Local-only like recentMoment (a moment, not memory); read once
  // by Chat's declined-ring effect, then cleared. FATE: exempt-with-reason
  // (it expires in minutes by its own consumer; wiping it early only
  // suppresses one small line).
  declinedRing?: number | null;
  // WHAT THEY HAVE ACTUALLY PLAYED — the local half of #113's episode write.
  // `game` is the ONE current session and is replaced the moment a second one
  // starts; before this field the games behind it existed only in the server
  // graph, reachable only through a semantic embedding that may never have
  // been written. So the first external tester played two games of chess and
  // then tic tac toe, asked about the chess, and she answered about the tic
  // tac toe — the only game left in state — and then invented the chess.
  // Bounded (ACTIVITY_LEDGER_MAX), newest first, deduped on kind:startedAt,
  // and syncs with the rest of the relationship. See engine/memory.ts's
  // `formatActivityLedger` for what reads it.
  activities?: ActivityRecord[];
  // WHAT THEY JUST WATCHED TOGETHER — WS-SHARENOW's local mirror of the
  // `vy_shared_moment` rows, written synchronously at share end so a call
  // placed sixty seconds later cannot lose to a slow server write. See
  // `ShareRecord` above for why the server copy is not enough on its own, and
  // `formatJustHappened` in src/voice/callHistory.ts for what reads it.
  // Device-local, like `recentMoment`: 45 minutes of shelf life, and the
  // durable copy is the server's.
  shares?: ShareRecord[];
  // ── the notification permission's memory (src/notify/) ─────────────────
  // Four timestamps and a switch, and every one of them exists to make the
  // ONE ask this product is allowed unrepeatable: `felt` is the moment a
  // notification would have been useful and there was no permission to send
  // it (so the ask can never land at onboarding), `asked` is the single
  // Android 13+ runtime prompt being spent, `declined` is terminal by
  // promise, and `enabled` is his own switch afterwards.
  //
  // DEVICE-LOCAL, exactly like `theme`: it is absent from `syncableState` and
  // from `mergeStates`, because a permission is a property of a phone. "He
  // said no on the laptop" arriving on a phone that never asked would be the
  // app answering a question on the user's behalf, on the one question it is
  // allowed to ask. See evals/teardown.mjs's FATE verdict for why the
  // teardown leaves it standing and where reachability itself is torn down
  // instead (it is deliberately NOT a field here — a push token in synced
  // state is another device's reachability).
  notifyPrefs?: NotifyPrefs;
  // ── the memory consent (task #148, DPDP) ───────────────────────────────
  // The answer to the one question this product has to ask before it stores
  // anything about a person's life across sessions. See `MemoryConsent` above
  // for the shape and `memoryWritesAllowed` for what absent means.
  //
  // DEVICE-LOCAL, exactly like `notifyPrefs` and for a sharper version of its
  // reason: it is absent from `syncableState` and from `mergeStates` because
  // a decline STOPS the state push, so the one channel that could carry it to
  // another device is the channel it switches off. Inferring an answer for a
  // device that never asked would also be the app answering a consent
  // question on the person's behalf, which is the single thing consent may
  // not be. A second device asks its own question, once, and the server
  // consent ledger (api/account.js `consent`) is what makes the two answers
  // reconcilable after the fact.
  memoryConsent?: MemoryConsent;
  // Lifetime activity tallies, written at game close. The RECORD is the
  // progression system; these are the running totals the detector reads.
  tally?: {
    chessGames?: number;
    chessWinsHim?: number;
    chessWinsHer?: number;
    tttGames?: number;
    wyrCards?: number;
  } | null;
}

const KEY = "meera.state.v1";
const DEVICE_KEY = "meera.device.v1";

// every install gets its own valid v4 UUID — memory/log/state are all keyed
// by it server-side, so no two users can ever share or mix data
function freshDeviceId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) =>
    c === "x" ? hex() : ((Math.floor(Math.random() * 4) + 8).toString(16)),
  );
}

// deviceId lives under its OWN key: a corrupt/overflowing state blob must
// never orphan the server-side memory graph it keys
function stableDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const fresh = freshDeviceId();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return freshDeviceId();
  }
}

export function rotateDeviceId(): string {
  const fresh = freshDeviceId();
  try {
    localStorage.setItem(DEVICE_KEY, fresh);
  } catch {
    /* in-memory only */
  }
  return fresh;
}

export const defaultState: AppState = {
  onboarded: false,
  deviceId: stableDeviceId(),
  user: { name: "", vibe: [], facts: {} },
  messages: [],
  openrouterKey: "",
  openrouterModel: "",
  apiKey: "",
  elevenKey: "",
  elevenVoiceId: "",
  sarvamKey: "",
  deviceVoice: "",
  lastSeen: Date.now(),
};

// repair messages stored by older builds: annotation text that should have
// been a real gif, and leaked clock stamps — they live in localStorage
// forever unless fixed here
function migrateMessages(messages: Message[]): Message[] {
  // internal-vocabulary leak (mirror of brain.ts META_LEAK): her stored
  // bubbles that slipped through older builds get erased from history
  const leak =
    /\b(base model|minimal text|text mode|chat mode|call mode|system prompt|language model|ai model|reasoning effort|max.?_?tokens|persona (prompt|instruction)|default model|llm|assistant mode|output format)\b/i;
  return messages
    .map((m) => {
      if (m.kind !== "text" || m.from !== "her") return m;
      if (leak.test(m.text)) return { ...m, text: "" }; // filtered out below
      // marker shrapnel from older builds ("ide eye cat]") — erase
      if (/\]\s*$/.test(m.text) && !m.text.includes("[") && m.text.length < 60)
        return { ...m, text: "" };
      const gm = m.text.match(/^\[sent a meme gif:\s*([^\]]+)\]$/i);
      if (gm) return { ...m, kind: "gif" as const, text: gm[1].trim(), gifUrl: undefined };
      const stripped = m.text
        .replace(/\[\d{1,2}:\d{2}\s*(?:am|pm)?\]/gi, "")
        .replace(/\[\s*(?:tone|followup|sent a meme gif|shared a photo)\s*:[^\]]*\]?/gi, "")
        .trim();
      return stripped !== m.text ? { ...m, text: stripped } : m;
    })
    .filter((m) => m.kind !== "text" || m.text);
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultState };
    const parsed = { ...defaultState, ...JSON.parse(raw) };
    // a bad MESSAGES field must cost the messages, never the whole state:
    // the outer catch returns defaultState and useAppState then PERSISTS it,
    // so one malformed row used to overwrite the entire relationship
    try {
      parsed.messages = migrateMessages(
        (Array.isArray(parsed.messages) ? parsed.messages : []).filter(
          (m: unknown): m is Message => Boolean(m) && typeof m === "object" && typeof (m as Message).id === "string",
        ),
      );
    } catch {
      parsed.messages = [];
    }
    // `game` is the one field dereferenced deeply inside setState updaters
    // with no error boundary above them — a malformed session (a bad sync,
    // a hand-edited blob, a schema from a future build rolled back) is a
    // blank screen that SURVIVES reload, because the crash happens after
    // every successful load. Guard the boundary; drop only the game.
    if (parsed.game != null && !isGameSession(parsed.game)) parsed.game = null;
    // Same boundary, same reason, one field over: `activities` arrives from a
    // parsed blob, an older build, or a synced server row, and `mergeStates`
    // SPREADS it — spreading a number throws, and a throw on this path is the
    // white screen that survives every reload. Every reader downstream already
    // filters malformed ROWS; this guards the container.
    if (!Array.isArray(parsed.activities)) parsed.activities = undefined;
    // …and once more for the share mirror, which arrives from exactly the same
    // three places (a parsed blob, an older build, a rolled-back schema) and is
    // spread by the same code. Every reader filters malformed ROWS; this is the
    // container guard, and it is here rather than trusted for the reason the
    // line above it states.
    if (!Array.isArray(parsed.shares)) parsed.shares = undefined;
    // `{ ...defaultState, ...JSON.parse(raw) }` is a SHALLOW spread: a stored
    // `user` of `{ name: "Rohan" }` (an older build's write, a half-finished
    // onboarding, a restored backup) replaces the default wholesale and
    // arrives at `Object.entries(user.facts)` with no `facts` — after which
    // she never replies again on this device, on every send, forever, because
    // the throw is on the reply path and the blob is persisted.
    parsed.user = safeUser(parsed.user);
    return parsed;
  } catch {
    return { ...defaultState };
  }
}

// data: URLs (photos whose upload failed) are huge — never let them brick
// persistence. Strip them from the stored copy; the desc/caption survives.
//
// `photoUrls` (WS-COMPOSER) is stripped by the same rule and had to be, or the
// rung would have got quieter exactly as the blobs got five times bigger: a
// message that carries five stuck data: URLs is the single largest thing this
// store can hold, and the guard that exists for precisely that case would have
// walked straight past it while congratulating itself on the one field it knew.
const stuck = (u: string | undefined) =>
  Boolean(u && u.startsWith("data:") && u.length > 60_000);

function persistable(s: AppState, keep: number): string {
  return JSON.stringify({
    ...s,
    messages: s.messages.slice(-keep).map((m) => {
      if (!stuck(m.photoUrl) && !m.photoUrls?.some(stuck)) return m;
      const kept = m.photoUrls?.filter((u) => !stuck(u));
      return {
        ...m,
        photoUrl: stuck(m.photoUrl) ? undefined : m.photoUrl,
        photoUrls: kept?.length ? kept : undefined,
      };
    }),
  });
}

export function saveState(s: AppState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return;
  } catch {
    /* storage full — degrade below, least-destructive first */
  }
  // Strip stuck data: URLs at FULL message length before any truncation.
  // Measured (audit): 2,000 real messages are ~10.6% of a 5MB quota, so the
  // only realistic way to land here is one failed photo upload leaving a
  // multi-hundred-KB data: URL — and the old ladder answered that by
  // deleting everything older than the last 400 messages on its first rung,
  // silently, in a product whose own Settings promise is "Nothing on it
  // resets, expires, or can be lost." Losing a broken image byte-blob is
  // nothing; losing a year of history to it is everything.
  // Every rung is telemetered: an invisible degradation path is how this
  // shipped wrong the first time.
  const rung = (name: string) => {
    try {
      tel("storage_degraded", { rung: name, messages: s.messages.length });
    } catch {
      /* telemetry must never take persistence down with it */
    }
  };
  try {
    localStorage.setItem(KEY, persistable(s, s.messages.length));
    rung("strip_data_urls");
    return;
  } catch {
    /* genuinely over quota even clean — now, and only now, truncate */
  }
  for (const keep of [400, 200, 100, 50]) {
    try {
      localStorage.setItem(KEY, persistable(s, keep));
      rung(`truncate_${keep}`);
      return;
    } catch {
      /* still too big — halve again */
    }
  }
  rung("gave_up");
}

/**
 * What a cross-tab compare can actually change, in a STABLE order.
 *
 * Used for two decisions below, and the array form matters: `JSON.stringify`
 * of an object follows insertion order, so two states holding identical values
 * built by different spreads would compare unequal and the two tabs would
 * write at each other forever.
 *
 * Messages are summarised by count + last id rather than compared in full, and
 * that is faithful rather than lazy: `mergeStates` unions by id with the LOCAL
 * copy winning, so an edit to a message this tab already holds is not
 * something the merge can adopt anyway.
 */
function crossTabSig(s: AppState): string {
  return JSON.stringify([
    s.onboarded,
    s.deviceId,
    s.lastAccountId ?? "",
    s.auth?.userId ?? "",
    s.user,
    s.messages.length,
    s.messages[s.messages.length - 1]?.id ?? "",
    s.clearedAt ?? 0,
    s.herLife ?? null,
    s.herNow ?? null,
    s.inner ?? null,
    s.game ?? null,
    s.activities ?? null,
    // device-local like `recentMoment` below, and here for its reason: two TABS
    // of one device are one device, and a share that ended in the other tab is
    // a share this tab must be able to answer for.
    s.shares ?? null,
    s.tally ?? null,
    [...(s.momentsFired ?? [])].sort(),
    s.followup ?? null,
    s.callback ?? null,
    s.recentMoment ?? null,
    // Device-scope like the settings above it, and IN here rather than out for
    // the reason `shares` is: two tabs are one device, and one tab must not go
    // on writing memory a second tab has just switched off.
    s.memoryConsent ?? null,
  ]);
}

export function useAppState() {
  const [state, rawSetState] = useState<AppState>(loadState);
  // Every herLife write in the app arrives here (App.tsx owns the only
  // useAppState() and hands this dispatcher to both lanes), so this is where a
  // self-fact is classified — see `stampSelfFacts`. The updater stays PURE, as
  // the multi-tab note below requires: stamping is deterministic, idempotent,
  // and returns `next` by reference when nothing entered the ledger, so a
  // setState that does not touch herLife costs one identity compare.
  const setState = useCallback<Dispatch<SetStateAction<AppState>>>(
    (update) =>
      rawSetState((prev) =>
        stampSelfFacts(prev, typeof update === "function" ? (update as (p: AppState) => AppState)(prev) : update),
      ),
    [],
  );
  useEffect(() => saveState(state), [state]);
  // the listener below is registered once and must read the CURRENT state
  // without re-registering (a listener torn down and rebuilt on every
  // keystroke drops events written mid-render)
  const latest = useRef(state);
  latest.current = state;
  // ── MULTI-TAB ───────────────────────────────────────────────────────────
  // Two tabs are two devices that happen to share a disk, and the old answer
  // here treated them as neither. It adopted the other tab's blob WHOLESALE
  // when that blob's last message was newer, and otherwise ignored it — so a
  // chess game played in tab 1 was erased by tab 2's next write (tab 2 never
  // adopted the game, tab 2's blob had no game, and tab 2's blob won on
  // message recency), and the fired-ledger and tallies went with it. The audit
  // reproduced exactly that.
  //
  // Both halves of the old rule were wrong:
  //   - RECENCY OF ONE FIELD cannot decide the fate of all the others. A game,
  //     a tally and a ledger advance without a single message being sent.
  //   - WHOLESALE ADOPTION of the winner discards the loser's half. Two
  //     devices already have an answer for this and it is `mergeStates`:
  //     messages union, ledgers union, tallies take the max, the game merges
  //     wholesale by progress. One merge, one set of semantics, one eval.
  //
  // What is left over is the WRITE-BACK: localStorage now holds the other
  // tab's blob, so if our merge is richer than what is on disk, the disk is
  // missing something and a reload of either tab would lose it. Persisting the
  // merged copy is what actually repairs it — the `setState` alone would not,
  // since a merge that changes nothing HERE must not re-render (that is the
  // ping-pong the old code's `return cur` was guarding against, and it is
  // still a real hazard: every write wakes the other tab).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY || !e.newValue) return;
      let incoming: AppState;
      try {
        incoming = { ...defaultState, ...(JSON.parse(e.newValue) as AppState) };
      } catch {
        return; /* corrupt cross-tab write — ignore */
      }
      // the spread above is shallow, so a blob whose `messages` is null still
      // arrives null — and every line below assumes an array
      if (!Array.isArray(incoming.messages)) incoming.messages = [];
      // same boundary, same coercion loadState applies to its own parse: this
      // blob was written by another tab, which may be running older code
      incoming.user = safeUser(incoming.user);
      const cur = latest.current;
      // IDENTITY CHANGE in the other tab — a sign-out (which rotates the
      // device id and clears lastAccountId), a sign-in, an account switch.
      // Adopt wholesale and merge nothing: merging across two identities is
      // the cross-account bleed `lastAccountId` exists to prevent, and a
      // sign-out on a shared browser that leaves the conversation alive in a
      // second tab is that same promise broken in the same room.
      if (
        (incoming.deviceId ?? "") !== cur.deviceId ||
        (incoming.lastAccountId ?? "") !== (cur.lastAccountId ?? "")
      ) {
        setState(incoming);
        return;
      }
      const merged: AppState = {
        // device-scope settings and keys first: the other tab's copies are as
        // good as ours, and last-write-wins is the right rule for a setting a
        // person just changed by hand in that tab.
        ...incoming,
        // then the relational fields, merged rather than taken.
        ...mergeStates(cur, incoming),
        // ...except the two present-moment fields `mergeStates` does not own.
        // Both are armed by something that JUST happened in ONE tab (a call
        // that dropped, a milestone that crossed) and neither is relational
        // history, so the tab holding one keeps it rather than having it
        // cleared by a tab that never saw the event.
        callback: cur.callback ?? incoming.callback ?? null,
        recentMoment: cur.recentMoment ?? incoming.recentMoment ?? null,
      };
      if (merged.game != null && !isGameSession(merged.game)) merged.game = null;
      const inSig = crossTabSig(incoming);
      const mSig = crossTabSig(merged);
      // the disk is behind our merge — put the union back, or the game/ledger
      // we just rescued dies on the next reload
      if (mSig !== inSig) saveState(merged);
      if (mSig !== crossTabSig(cur)) setState(merged);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [state, setState] as const;
}

export const uid = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
