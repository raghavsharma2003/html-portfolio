// Client side of the Supabase-backed memory: everything goes through our
// serverless proxy (/api/memory) — the app never holds a database key.
// log/remember are fire-and-forget; recall races a short timeout so her
// reply is never held hostage by the network.

import { Capacitor } from "@capacitor/core";
import type { Message } from "../state/store";
import type { InnerPatch } from "./inner";
import { diagTimer } from "./diag";
import { traceServer, traceTurnId, tracePatch, type TraceChannel } from "./trace";

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

function post(body: unknown): Promise<Response> {
  return fetch(`${BASE}/api/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function logTurns(device: string, msgs: Message[]) {
  const turns = msgs
    .filter((m) => m.kind !== "callmark")
    .map((m) => ({
      role: m.from === "me" ? "me" : "her",
      channel: m.channel === "call" ? "call" : "chat",
      kind: m.kind,
      content: m.text,
      at: m.at,
    }));
  if (!turns.length) return;
  // WS-TRACE (docs/TRACE.md L2): op:"log" now returns the meera_log row ids it
  // wrote, and the trace records them instead of the words. That is the whole
  // content story — "what did she actually say on turn X" is a join, and it
  // resolves to nothing once the person asks to be forgotten, which a copy
  // stored here never would.
  post({ op: "log", device, turns })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const ids: number[] = Array.isArray(d?.ids) ? d.ids : [];
      if (!ids.length) return;
      const roles = turns.map((t) => t.role);
      const mine = ids.filter((_, i) => roles[i] === "me");
      const hers = ids.filter((_, i) => roles[i] === "her");
      const channel: TraceChannel = turns[0].channel === "call" ? "call" : "chat";
      if (!traceTurnId(channel)) return;
      tracePatch(channel, {
        ...(mine.length ? { in_log_id: mine[0] } : {}),
        ...(hers.length ? { out_log_ids: hers } : {}),
      });
    })
    .catch(() => {});
}

// Distils the recent conversation into her graph memory AND hands back the
// things she claimed about her OWN life plus her carried interior, so the
// caller can keep them. ONE model call, already off the critical path — the
// interior rides its JSON, it never gets a call of its own.
//
// What goes UP is conversation text only: no timestamps, no gap markers, no
// counts. That starvation is what makes it structurally impossible for the
// appraiser to turn his reply speed or his silence into her mood (inner.ts G1).
export interface RememberResult {
  self: string[];
  inner: InnerPatch | null;
}

export async function rememberFrom(
  device: string,
  msgs: Message[],
  wants: string[] = [],
): Promise<RememberResult> {
  const recent = msgs
    .filter((m) => m.kind === "text")
    .slice(-16)
    // `channel` rides along for ONE reason and it is not telemetry: the live
    // call lane logs her spoken turns with no post-generation gate
    // (useCallEngine's onHerText → log(), no guardReply), so a shared memory
    // she invents ALOUD used to be extracted as a graph node and thereafter
    // supported the same claim on the chat lane, where honesty.ts's family 4
    // would otherwise have caught it. `allowedFrom`/`hisVocabulary` both
    // refuse her own past output for exactly this reason — "the provenance
    // chain has to terminate at something that is not her" — and until now
    // the extraction window did not. The server needs the channel to tell an
    // ungated spoken turn from a gated typed one; it cannot be re-derived
    // there (meera_log's last row is one turn, not sixteen). See
    // docs/audit/2026-08-22-honesty.md, "her live-lane turns are logged
    // ungated and feed sharedVocab", and api/memory.js's `nonLaunderedNodes`.
    //
    // NOT a filter on this side. Her call turns still go up: `self` and her
    // carried interior are DERIVED from what she said about her own life, and
    // dropping her spoken turns here would starve them on every call. The
    // laundering predicate is on the server, over the node list only.
    .map((m) => ({
      role: m.from === "me" ? "me" : "her",
      channel: m.channel === "call" ? "call" : "chat",
      content: m.text,
    }));
  if (recent.length < 2) return { self: [], inner: null };
  const done = diagTimer("chat", "remember_pass", { turns: recent.length, wants: wants.length });
  try {
    const r = await post({ op: "remember", device, recent, wants });
    const d = r.ok ? await r.json() : null;
    const self = Array.isArray(d?.self)
      ? d.self.filter((s: unknown): s is string => typeof s === "string" && Boolean(s.trim())).slice(0, 4)
      : [];
    const inner: InnerPatch | null =
      d && (d.now !== undefined || d.wants !== undefined || d.owed !== undefined || d.told !== undefined)
        ? {
            now: d.now ?? null,
            wants: Array.isArray(d.wants) ? d.wants : null,
            // [] is a real answer here ("she settled up"), so it must not be
            // collapsed to null the way an absent key is
            owed: Array.isArray(d.owed) ? d.owed : null,
            told: d.told === true,
          }
        : null;
    done({ ok: Boolean(d), self: self.length, thread: Boolean(inner?.now) });
    return { self, inner };
  } catch {
    done({ ok: false });
    return { self: [], inner: null };
  }
}

// ── T-H3: the chat tail that rides the call's ONE assembly ─────────────────
//
// docs/HONESTY.md §T-H3, the owner's two-minute scenario stated as a defect:
// chat, then call ninety seconds later, and she picks up not knowing what the
// two of you just typed. The cause is a race between two clocks. `herLife` is
// written by `rememberFrom` above, which Chat.tsx runs on every THIRD send and
// which is a model round trip; the live call's system prompt is compiled ONCE,
// at connect, from whatever `herLife` happens to hold. So at pickup the ledger
// is behind by up to two sends plus one appraisal, every time.
//
// WHY THE TAIL AND NOT A FLUSH (§T-H3 option (a) vs (b), and the reason (b)
// wins on this codebase rather than merely being "cheaper"):
//
//   (a) awaiting an extraction pass at pickup puts a MODEL CALL in front of
//       the ring — the single most latency-sensitive moment the product has,
//       and the one place the standing "speed and quality are never traded
//       away" instruction bites hardest. Time-boxing it (Promise.race, ~400ms)
//       does not rescue it: `rememberFrom` is an appraisal round trip, an
//       order of magnitude slower than the ~165ms-warm/~900ms-cold recall this
//       lane already races, so the box would expire on nearly every call and
//       degrade to exactly today's behaviour. Cost with no effect.
//   (b) the tail costs ZERO added latency — it is a pure function of state the
//       component already holds — it enriches the ONE assembly rather than
//       adding a second (liveAssemblies stays 1), and it also covers the case
//       (a) cannot: a chat stretch with no extractable fact in it at all still
//       reaches her, because a person remembers the last five minutes without
//       needing them written down first.
//
// WHY IT RIDES `memories` (T5) rather than a new compiler slot. compile()'s
// standing contract is that the CALLER resolves strings and the compiler stays
// pure and db-free; brain.ts already hands it a resolved recall string the same
// way. T5's heading is also already the right frame — "what you remember about
// them, from your earlier conversations, each tagged with when it last came
// up" — and it carries the two guardrails this block needs and would otherwise
// have to restate: "something being listed here is not a reason to say it" and
// "never with any mention of remembering". A second heading with its own copy
// of the recall law is a second place for that law to drift.
//
// SHAPES, NEVER LINES — and the ONE place this repo already says otherwise.
// `recited-prompt` is the expensive law here, and this is the block most
// exposed to it, because it is the only tail content made of things a person
// actually said. Three defences, all structural rather than hopeful:
//
//   1. Every row opens with a speaker token, so shapelint's
//      FIRST_PERSON_LINE_INITIAL_RE can never match and SENTENCE_SHAPED_RE
//      (capital start + terminal punctuation) can never match either. No row
//      here can read as a line lifted straight from her own mouth.
//   2. HER rows are capped at shapelint's own MAX_WORDS (14, prefix included).
//      A line she said IS a line she could say again, which is the literal
//      definition of a phrase bank, so her half gets the strict cap.
//   3. HIS rows are capped looser. This is not an oversight: `lintBlock` takes
//      an explicit allowlist and its doc names exactly this class — "THEIR
//      line, not a line written for her ... verbatim storage is the point" (the
//      vy_phrase ledger). What he just told her is the informative half of a
//      pickup, and clipping it at twelve words turns "cousin ke ghar ja raha hu
//      dinner ke liye" into a sentence that has lost where he is going. His
//      words are also the one thing in this prompt whose provenance chain
//      terminates at something that is not her, which is the same property
//      `hisVocabulary`/`allowedFrom` in honesty.ts are built on.
//
// `evals/chattail/run.mjs` runs the REAL `lintBlock` over the REAL output —
// her rows under the full rule set, his under the allowlist the doc sanctions.

/** Most rows the tail ever carries. Six is a minute or two of real Hinglish
 *  back-and-forth; more than that is a transcript, and a transcript in a
 *  system prompt is a script. */
export const CHAT_TAIL_ROWS = 6;

/** Older than this and it is not "what you two just typed" any more. T9
 *  session.clock already tells her about a gap, and a stale stretch presented
 *  as the present moment is the same species of lie §T-H2 is about. */
export const CHAT_TAIL_WINDOW_MS = 30 * 60 * 1000;

/** Hard ceiling on the rendered block, heading included. Sized against the
 *  measured worst case in `scripts/check-prompt-budget.mjs`: the live+watch
 *  lane's bounded tail is 22,243 of an operational 24,000, so 900 fits inside
 *  the remaining 1,757 with room left over. `evals/chattail/run.mjs` asserts
 *  that arithmetic against the real bound rather than leaving it as a claim. */
export const CHAT_TAIL_BUDGET = 900;

/** HER rows: shapelint.ts's MAX_WORDS, per row, INCLUDING the two tokens of
 *  the speaker prefix. Restated rather than imported because shapelint.ts
 *  imports persona.ts and memory.ts is on the call path — it must not drag
 *  ~45k of persona into a bundle to read one integer. The eval pins the two
 *  together so the restatement cannot drift. */
export const CHAT_TAIL_MAX_WORDS = 14;

/** HIS rows: looser, per defence 3 above. 24 words is a long text message and
 *  a short paragraph — enough that an ordinary Hinglish line arrives whole,
 *  short enough that a wall of text still cannot become a script. */
export const CHAT_TAIL_MAX_WORDS_THEM = 24;

const CHAT_TAIL_HEAD =
  "JUST BEFORE THIS CALL — the last of what you two typed to each other, oldest first. You were both there for it, so it is not news, it never gets read back to them, and being listed here is not a reason to raise it. A plan or a mood in it may already have moved on.";

/** One row: `- them: …` / `- you: …`, capped so the WHOLE row (prefix
 *  included) stays under shapelint's word cap. Clipping is at a word boundary
 *  with a visible ellipsis — a clipped row says so, rather than presenting a
 *  half-sentence as the whole thing they said. */
function chatTailRow(who: "them" | "you", text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const cap = who === "them" ? CHAT_TAIL_MAX_WORDS_THEM : CHAT_TAIL_MAX_WORDS;
  const body = cap - 2; // the two tokens of "- who:"
  const words = flat.split(" ");
  if (words.length <= body) return `- ${who}: ${flat}`;
  return `- ${who}: ${words.slice(0, body - 1).join(" ")} …`;
}

/**
 * The last stretch of TYPED conversation, as tail-ready rows. Pure — the clock
 * is passed in, for the same reason compile() takes `nowMs`: a `Date.now()` in
 * here would make a byte-identity comparison flap on a minute rollover.
 *
 * Call turns are excluded. What was said on the last CALL is not "what you two
 * typed", it reaches her through the callmark and CALL_OPEN_DIRECTIVE's
 * follow-up register, and folding it in would double-count one exchange across
 * two media — the same call filter `repeat.ts` applies for the same reason.
 *
 * Returns "" when there is nothing recent, which is compile()'s render-nothing
 * default for `memories` and therefore byte-identical to today.
 */
export function formatChatTail(msgs: readonly Message[], nowMs: number): string {
  const rows: string[] = [];
  for (let i = msgs.length - 1; i >= 0 && rows.length < CHAT_TAIL_ROWS; i--) {
    const m = msgs[i];
    if (!m || m.kind !== "text" || m.channel === "call") continue;
    if (!m.text || !m.text.trim()) continue;
    // walking backwards, the first message outside the window ends the stretch
    // — everything before it is older still
    if (!m.at || nowMs - m.at > CHAT_TAIL_WINDOW_MS) break;
    rows.unshift(chatTailRow(m.from === "me" ? "them" : "you", m.text));
  }
  if (!rows.length) return "";
  // over budget, drop WHOLE rows from the oldest. Never a slice: "a sliced
  // block is a lie" is this repo's drop rule and it does not stop applying
  // inside a block (`activity-block-sliced-mid-word`).
  let kept = rows;
  while (kept.length && CHAT_TAIL_HEAD.length + 1 + kept.join("\n").length > CHAT_TAIL_BUDGET)
    kept = kept.slice(1);
  if (!kept.length) return "";
  return `${CHAT_TAIL_HEAD}\n${kept.join("\n")}`;
}

/**
 * What every call-lane compile site passes as `memories`. The freshest thing
 * first: `api/chat.js` keeps the FIRST n chars of the tail and cuts the end,
 * so of the two the graph rows are the ones that may be dropped, never the
 * stretch that happened ninety seconds ago.
 *
 * One function rather than each lane composing two strings itself, because
 * lanes each doing their own concatenation is exactly the shape
 * `age-tier-never-realtime` records: the rule added later lands in one copy.
 *
 * Takes the ALREADY-RENDERED tail rather than the message store, so the caller
 * can hand the same bytes to its telemetry — a diag field that re-derives what
 * it reports on is a field that can start lying the moment either side moves.
 */
export function callMemories(memories: string, chatTail: string): string {
  if (!chatTail) return memories;
  return memories ? `${chatTail}\n\n${memories}` : chatTail;
}

export async function uploadPhoto(device: string, dataB64: string, mime: string): Promise<string | null> {
  try {
    const r = await post({ op: "upload_photo", device, data: dataB64, mime });
    const d = await (r.ok ? r.json() : null);
    return d?.url || null;
  } catch {
    return null;
  }
}

export async function describePhoto(device: string, url: string): Promise<string> {
  try {
    const r = await post({ op: "describe", device, url });
    const d = await (r.ok ? r.json() : null);
    return d?.desc || "";
  } catch {
    return "";
  }
}

// ── forgetting ─────────────────────────────────────────────────────────────
// The inverse of everything above, and the thing that makes the rest of it
// consensual. The server hard-deletes rows (api/memory.js opForget); what
// lives here is the seam that decides WHAT gets asked for, because the two
// dangerous decisions — how wide a scope is, and whether a whole-memory wipe
// can be triggered by a generated marker — belong in code, not in a brief.

export type ForgetTarget =
  | { scope: "item"; name: string }
  | { scope: "session"; from: number; to: number; channel?: "chat" | "call" }
  | { scope: "day"; day: string; tzMin: number }
  | { scope: "all" };

export interface ForgetResult {
  scope: ForgetTarget["scope"];
  deleted: { log: number; nodes: number; edges: number };
}

export async function forgetMemories(
  device: string,
  target: ForgetTarget,
): Promise<ForgetResult | null> {
  if (!device) return null;
  const done = diagTimer("chat", "forget", { scope: target.scope });
  try {
    const r = await post({ op: "forget", device, ...target });
    const d = r.ok ? await r.json() : null;
    if (!d?.ok) {
      done({ ok: false });
      return null;
    }
    const deleted = {
      log: Number(d.deleted?.log) || 0,
      nodes: Number(d.deleted?.nodes) || 0,
      edges: Number(d.deleted?.edges) || 0,
    };
    // the SCOPE is telemetry; the name of the thing they asked her to drop
    // never is — a diag row naming it would outlive the memory it deleted
    done({ ok: true, ...deleted });
    return { scope: d.scope, deleted };
  } catch {
    done({ ok: false });
    return null;
  }
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// "the call" = the run of spoken turns at the end of the history. Spoken
// turns never render in the chat, and meera_log has no session column, so a
// time window is the only handle either side has on one.
function lastCallWindow(history: Message[]): { from: number; to: number } | null {
  let end = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].channel === "call") {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  let start = end;
  while (start > 0) {
    const prev = history[start - 1];
    if (prev.channel === "call" || prev.kind === "callmark") start -= 1;
    else break;
  }
  const from = history[start].at || 0;
  const to = (history[end].at || 0) + 1000;
  return to > from ? { from, to } : null;
}

/**
 * Turn a `[forget: …]` marker into a scope, or refuse it.
 *
 * A WHOLE-MEMORY WIPE IS DELIBERATELY NOT IN THIS VOCABULARY. Every other
 * scope here is bounded and re-learnable — they can just tell her again.
 * "everything" is neither, and routing it through a generated marker would
 * put the single irreversible action in the product one stray token away
 * from happening. It lives in the settings sheet instead: named in words,
 * with ten seconds to take it back. The refusal is structural rather than a
 * line in her brief precisely so that a wording regression cannot reach it.
 */
export function resolveForget(
  marker: string,
  history: Message[],
  now = Date.now(),
): ForgetTarget | null {
  const t = marker.trim().toLowerCase().replace(/[.!?,]+$/, "");
  if (!t) return null;
  if (/^(all|everything|sab|sab ?kuch|sabhi|puri|poora|whole|us)\b/.test(t)) return null;
  if (/\b(call|phone|video)\b/.test(t)) {
    const win = lastCallWindow(history);
    return win ? { scope: "session", from: win.from, to: win.to, channel: "call" } : null;
  }
  const tzMin = -new Date(now).getTimezoneOffset();
  if (/^(today|aaj)\b/.test(t)) return { scope: "day", day: localDay(new Date(now)), tzMin };
  // "kal" is both yesterday and tomorrow in Hinglish; in a forget it can only
  // ever be the one that has already happened
  if (/^(yesterday|kal)\b/.test(t))
    return { scope: "day", day: localDay(new Date(now - 86_400_000)), tzMin };
  const name = t.slice(0, 60);
  return name.length >= 3 ? { scope: "item", name } : null;
}

/**
 * The other half of a forget, and the half that is easy to miss: the turns
 * still sitting in the local store are the context window she thinks with.
 * Deleting them server-side and leaving them here means she has "forgotten"
 * something she can still read three lines above.
 *
 * Only window scopes prune. Forgetting one FACT does not delete the chat they
 * said it in — that would shred their own history as a side effect of asking
 * her to drop a detail, which is not what anyone means by "bhool ja".
 */
export function messagesAfterForget(messages: Message[], target: ForgetTarget): Message[] {
  if (target.scope === "all") return [];
  if (target.scope === "item") return messages;
  let from: number;
  let to: number;
  let channel: "chat" | "call" | undefined;
  if (target.scope === "session") {
    ({ from, to, channel } = target);
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(target.day);
    if (!m) return messages;
    from = Date.UTC(+m[1], +m[2] - 1, +m[3]) - target.tzMin * 60_000;
    to = from + 86_400_000;
  }
  return messages.filter((msg) => {
    const at = msg.at || 0;
    if (at < from || at >= to) return true;
    if (channel && (msg.channel || "chat") !== channel) return true;
    return false;
  });
}

// WS-INTEGRATE seam 1: opRecall's response now also carries a server-
// assembled relstate bundle (api/memory.js's fetchRelBundle — field names
// mirror compiler.ts's RelBundleInput exactly). This file is unowned by any
// §13 workstream, and its ONE existing network call to op:"recall" is the
// only client-side carrier for that field — duplicating the request in
// brain.ts to also read it would double a round trip Chat.tsx's
// prefetchRecall() already races against a 2s timeout, a latency regression
// the owner's standing "speed and quality are never traded away" instruction
// forbids. So the same response is read twice, additively: `recallMemories`
// keeps its exact existing signature and return value (a string) for every
// existing caller (brain.ts's mode==="call" prefetch in useCallEngine.ts
// included), and the bundle rides a tiny last-value cache a caller can pull
// right after `recallMemories`/`prefetchRecall`'s promise resolves — see
// `takeRelBundle` below. A caller that never calls it simply never reads the
// field; nothing about `recallMemories`'s own behavior changes.
//
// T-H1 (`selfbundle-never-set`): the SELF bundle rides the identical seam.
// op:"recall" now also carries `self` (api/memory.js's fetchSelfBundle —
// field names mirror compiler.ts's SelfBundleInput exactly), for the reason
// stated at that function: the self-layer tables are read server-side through
// an injected QueryFn the browser does not have, and the alternative to
// reusing this response is a second round trip in front of a reply, which the
// standing "speed and quality are never traded away" instruction forbids.
// Everything below is additive: `recallMemories`'s signature and return value
// are untouched, and a caller that never pulls the self bundle simply never
// reads the field.
import type { RelBundleInput, SelfBundleInput } from "./compiler";

let lastBundle: { device: string; query: string; bundle: RelBundleInput | null } | null = null;
let lastSelf: { device: string; query: string; bundle: SelfBundleInput | null } | null = null;

function runRecall(device: string, query: string): Promise<string> {
  try {
    // measured: ~165ms warm, ~900ms cold. 2s is generous headroom and still
    // can't park a reply behind a slow lookup.
    const timeout = new Promise<string>((r) => setTimeout(() => r(""), 2000));
    // WS-TRACE (docs/TRACE.md §3.2): the open turn's id goes UP so the server
    // can name it, and the retrieval leg comes back DOWN on the response this
    // call was already making. Zero extra round trips, and no write anywhere on
    // this path — which is what makes tracing free here rather than a lookup
    // sitting in front of a reply.
    //
    // `traceTurnId()` is "" when no turn is open (a background refresh, a
    // pre-warm), and the server simply omits the leg rather than inventing a
    // turn for it. `dead-writers` in reverse: no id, no record, no pretence.
    const turnId = traceTurnId("chat");
    const fetchIt = post({ op: "recall", device, query, ...(turnId ? { turn_id: turnId } : {}) })
      .then((r) => (r.ok ? r.json() : { memories: "" }))
      .then((d) => {
        lastBundle = { device, query, bundle: (d?.relstate as RelBundleInput | null | undefined) ?? null };
        lastSelf = { device, query, bundle: (d?.self as SelfBundleInput | null | undefined) ?? null };
        if (d?.trace) traceServer("chat", "retrieval", d.trace);
        return typeof d?.memories === "string" ? d.memories : "";
      })
      .catch(() => "");
    return Promise.race([fetchIt, timeout]);
  } catch {
    return Promise.resolve("");
  }
}

// The chat starts the lookup the instant they hit send, so its round trip is
// spent inside the burst-wait instead of sitting in front of the model call.
let pending: { device: string; query: string; p: Promise<string> } | null = null;

export function prefetchRecall(device: string, query: string) {
  if (!device) return;
  pending = { device, query, p: runRecall(device, query) };
}

export async function recallMemories(device: string, query: string): Promise<string> {
  if (pending && pending.device === device && pending.query === query) {
    const { p } = pending;
    pending = null;
    return p;
  }
  return runRecall(device, query);
}

/**
 * Pulls whatever relstate bundle rode the LAST resolved recall for this
 * device (consumed once, so a stale bundle from an unrelated earlier query
 * can never leak into a later turn — call it immediately after awaiting
 * `recallMemories`/a `prefetchRecall`'d promise for the same device). `null`
 * covers three cases identically, on purpose: no bundle has landed yet, the
 * server found no vy_rel_state row for this person (no consolidation has
 * run), or the request timed out — every one of them means "render nothing,"
 * which is exactly the T2/T3/T4/T6 byte-identity default.
 */
export function takeRelBundle(device: string): RelBundleInput | null {
  if (!lastBundle || lastBundle.device !== device) return null;
  const b = lastBundle.bundle;
  lastBundle = null;
  return b;
}

/**
 * T-H1 — `takeRelBundle`'s twin for the self layer (T11 rel.texture, T12
 * self.arc, T13 life.untold). Same consume-once contract and the same three
 * collapsed-to-null cases: no bundle has landed, the server found no self rows
 * for this person, or the request timed out. Every one of them means "render
 * nothing", which is the T11/T12/T13 byte-identity default.
 *
 * Separate from `takeRelBundle` rather than folded into it, deliberately: the
 * two are gated independently inside compile() ("Gated on selfBundle ALONE,
 * deliberately OUTSIDE the relBundle branch"), and one cache consumed by two
 * callers would hand the second one null.
 *
 * `sheInitiated` is NOT set here. It is a property of the turn, not of the
 * database, and the caller that knows whether SHE started this turn sets it —
 * brain.ts threads inner.ts's own flag through rather than deriving a second
 * notion of it.
 */
export function takeSelfBundle(device: string): SelfBundleInput | null {
  if (!lastSelf || lastSelf.device !== device) return null;
  const b = lastSelf.bundle;
  lastSelf = null;
  return b;
}

// ── the call lane's self bundle ────────────────────────────────────────────
// The call lane cannot use the consume-once cache the way chat does. It
// fetches ONCE during the ring and then compiles from that same bundle for
// every turn of the call — the realtime lane compiles at connect, the cascade
// lane compiles per spoken turn, and the native watch lane compiles when a
// share starts. Three readers, one fetch, and a consume-once cache would give
// the first reader the bundle and the other two null.
//
// So `recallForCall` moves it out of the consume-once cache into this holder,
// in the SAME continuation the fetch resolves in — which is the ordering
// `takeRelBundle`'s doc says is easy to lose and the reason `recallForCall`
// exists at all. Device-keyed, and written UNCONDITIONALLY on every ring
// fetch (including a failed one, which writes null) so a bundle from an
// earlier call can never outlive the fetch that replaced it. That is strictly
// tighter than the ref it sits alongside.
let callSelf: { device: string; bundle: SelfBundleInput | null } | null = null;

/**
 * What the ring fetch found, for this device. Null when no ring fetch has
 * landed for this device, or when it landed and found nothing — both mean
 * "render nothing", which is compile()'s default for an absent bundle.
 *
 * Read at compile time rather than captured at call start, for the reason
 * every ref in useCallEngine.ts is: a value captured at call start freezes
 * her. It is NOT a ref read in the tick its promise was created in —
 * `rejected.md#realtime-recall-never` — because tryStartLive() awaits the ring
 * fetch (awaitRingFetch) before it compiles.
 */
export function callSelfBundle(device: string): SelfBundleInput | null {
  return callSelf && callSelf.device === device ? callSelf.bundle : null;
}

/**
 * WS-CONTINUITY seam 1 (docs/SPEC-CONTINUITY.md §1). The call lane's ONE
 * memory lookup, fetched during the ring.
 *
 * It exists because `takeRelBundle` is a consume-once cache tied to the
 * resolution of the recall it rode in on: a caller that forgets to pull it in
 * the same continuation gets `null` and never finds out. The chat lane gets
 * that ordering for free (brain.ts awaits `recallMemories` and pulls the
 * bundle on the next line); the call lane fires its recall during the ring and
 * reads it hundreds of ms later, which is exactly the shape that silently
 * loses the bundle. So the ordering is written down ONCE, here, rather than
 * trusted to a second call site.
 *
 * One round trip, the same one `recallMemories` already makes — no new network
 * call, no new latency. Both halves fail to their existing "render nothing"
 * defaults ("" and null) independently.
 */
export async function recallForCall(
  device: string,
  query: string,
): Promise<{ memories: string; relBundle: RelBundleInput | null }> {
  if (!device) {
    callSelf = null;
    return { memories: "", relBundle: null };
  }
  const memories = await recallMemories(device, query);
  // T-H1: both bundles are pulled here, in the one continuation that is
  // guaranteed to be the right one. The self half moves into the call-lane
  // holder rather than out through the return value because the three call-
  // lane compile sites do not share one call frame — see `callSelfBundle`.
  const relBundle = takeRelBundle(device);
  callSelf = { device, bundle: takeSelfBundle(device) };
  return { memories, relBundle };
}

// GAP 2 (WS-FELT) — day-1 seed. Telemetry-style, fire-and-forget ONLY,
// same discipline as useCallEngine.ts's postEpisodeCallEnd (its own
// comment: "never awaited by anything ... its promise is always caught").
// Called once, right after onboarding, so the relational engine has
// something to render before the first 03:30 IST cron ever runs — the
// cron remains the backstop regardless of whether this call lands.
export function seedDayOneConsolidation(device: string) {
  if (!device) return;
  try {
    void fetch(`${BASE}/api/consolidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device }),
      keepalive: true, // survives onboarding's own screen transition right after
    }).catch(() => {});
  } catch {
    /* never let a seed attempt throw into onboarding */
  }
}

// GAP 3 (WS-FELT) — vibe chips → vy_currency. Telemetry-style, fire-and-
// forget, same discipline as seedDayOneConsolidation above — the chips are
// a nicety, never a blocker, and a failed write here costs nothing but the
// chip going unused (exactly what happens today).
export function seedCurrencyChips(device: string, chips: string[]) {
  if (!device || !chips.length) return;
  post({ op: "seed_currency", device, chips }).catch(() => {});
}

// ── #113: a finished activity becomes a graph episode ──────────────────────
//
// THE GAP. `activityOf` keeps a closed session in the present moment for
// RECENT_END_MS (two hours), and after that it returns null and the game is
// gone — not demoted to a memory, gone. "we played chess yesterday and you
// lost" is a thing a person remembers, and `state/game.ts` says so at the
// `closedAt` field ("the played list is what the memory layer will read"),
// but nothing ever read it. Meanwhile the ONLY route into the graph is
// `rememberFrom`, whose window is `kind === "text"` chat turns — a game
// generates no turns at all, so a session they spent forty minutes on left
// literally no trace once the afterglow expired.
//
// RELATIONALOS BOUNDARY (docs/RELATIONALOS.md's test: would a different
// personality on a different surface need this unchanged?). The EPISODE SHAPE
// is OS and lives here: it is built from `ActivityState` + the session's own
// timestamps and knows nothing about chess, cards or boards, so the next
// activity is an adapter and zero lines in this file. The FIRING POINT is the
// surface's — App.tsx's reconciler, the one component always mounted, which
// is already where `closedAt` is written.
//
// The shape is deliberately a SUMMARY, not a replay: "a game of chess
// together on 22 aug — she won, by checkmate" is what a person carries a week
// later. A move list is not a memory, it is a scoresheet.

/** What the surface hands over when a session closes. Kind-agnostic on
 *  purpose — `kind`/`facts` come straight off `ActivityState`, the two
 *  timestamps straight off the session row. */
export interface FinishedActivity {
  kind: string;
  /** `ActivityState.facts` as they stood at the close. */
  facts: readonly string[];
  /** `ActivityState.record` — the half that is still true next week. See that
   *  field's doc in `activity.ts`; it is the reason this whole seam was
   *  rebuilt in Aug 2026. Optional, and an episode without one renders exactly
   *  what it rendered before this field existed. */
  record?: readonly string[];
  /** the session's OWN start — the idempotence key, never the close time */
  startedAt: number;
  closedAt: number;
}

/**
 * Rows that are true about the MOMENT and false about the memory.
 *
 * Shape-matched, not kind-matched, which is what keeps this OS: any adapter
 * that emits a whose-turn-is-it row, a live check warning, a card currently on
 * screen or a not-started marker gets it dropped from its episode for free.
 * The alternative — a per-kind list of which facts count as outcome facts — is
 * the fork `activity.ts` exists to prevent, and it would leave "it is her
 * move" in the permanent record of a game that ended three weeks ago.
 */
export const MOMENT_ROW_RE =
  /^(it is (her|his) move|(she|he) is in check|the question: |just started|the game has just started)/i;

/** Longest an episode summary may be. Whole facts are dropped from the END to
 *  fit — never sliced. `silent-truncation` is a law in this repo for the
 *  reason `renderActivity` states: truncation eats the end, and a sliced
 *  block is a lie.
 *
 *  180 → 420 (Aug 2026). 180 was sized for `facts` alone, and `facts` alone is
 *  what made a finished chess game unanswerable: at 180 the four durable rows
 *  a person actually carries — how it opened, which colour she had, how it
 *  ended, what was taken — do not fit beside the momentary ones, and the drop
 *  policy takes them from the END, which is exactly where they sit. 420 is
 *  measured against the real worst case: a six-ply opening with a book name,
 *  a colour, an ending with a move number and two capture rows is ~240 with
 *  the label and date, and a six-round wyr session is ~400. It is bounded by
 *  the same law it always was — whole rows drop, nothing is ever sliced.
 *
 *  MIRRORED SERVER-SIDE in `api/memory.js`'s `ACTIVITY_SUMMARY_MAX`. The two
 *  are one number and `evals/gamemem.mjs` asserts they agree: a writer that
 *  composes 420 characters and a reader that stores 200 is `warm-count-
 *  unscoped` again — reader and writer disagreeing about the same record,
 *  silently, with the disagreement landing on the END of the memory. */
export const EPISODE_SUMMARY_MAX = 420;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Lowercase, local, no year: "22 aug". Telegraphic like every other row in
 *  the record — a capital-start, terminal-punctuation sentence is a line she
 *  recites (`recited-prompt`). Hand-rolled rather than toLocaleDateString so
 *  the string is byte-identical in a browser, in Node and in an eval. */
export function episodeDateLabel(atMs: number): string {
  const d = new Date(atMs);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * The episode line for a finished session. Pure — no clock, no network — so
 * the shape is testable and identical on every surface.
 *
 * "together" is not decoration. `api/consolidate.js`'s WE_TOKEN_RE is what
 * classifies an episode as `participation = 'we'`, which is what makes it
 * reachable as a we-callback and what makes it legitimate support for a
 * shared-past claim. An activity is shared BY CONSTRUCTION — that is the
 * definition of the layer — so the summary says so in the vocabulary the
 * classifier already reads, instead of asserting the classification
 * separately and hoping the two never drift.
 */
export function activityEpisodeSummary(a: FinishedActivity, label: string): string {
  const stem = `${label} together${a.closedAt ? ` on ${episodeDateLabel(a.closedAt)}` : ""}`;
  // THE RECORD WINS OUTRIGHT WHEN THERE IS ONE.
  //
  // `record` is the adapter's answer to "what is still true about this next
  // week" and `facts` is its answer to "where does this stand right now" —
  // and at the close those two overlap almost completely, in the worst
  // possible way: they say the SAME things in different tenses. Concatenating
  // them produced "…he left it unfinished on move 6, no result; she had
  // black; … he ended the game early, no result; she is playing black; the
  // opening is the catalan opening; 6 moves in" — one memory, every fact in
  // it twice, and the second copy in the present tense about a game that had
  // ended. A prompt that contradicts its own tense is resolved by the model,
  // not by us.
  //
  // So an adapter that has said what is durable has said it, and the momentary
  // rows are dropped. An adapter with no `record` — a kind that has not been
  // taught this yet, or a stored payload from before the field existed — falls
  // back to `facts` and renders byte-for-byte what it rendered before.
  const source = a.record?.length ? a.record : a.facts;
  const seen = new Set<string>();
  const rows = source
    .map((f) => String(f || "").trim())
    .filter((f) => {
      // MOMENT_ROW_RE applies to both halves. It is shape-matched, not
      // kind-matched, so an adapter that puts a present-moment row in its
      // record by mistake gets it dropped for free — one defence, once.
      if (!f || MOMENT_ROW_RE.test(f)) return false;
      const k = f.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  let out = stem;
  for (const row of rows) {
    const next = out === stem ? `${stem} — ${row}` : `${out}; ${row}`;
    if (next.length > EPISODE_SUMMARY_MAX) break;
    out = next;
  }
  return out;
}

/**
 * Fire-and-forget. A failed POST must never touch game state, which is why
 * nothing here returns anything, nothing here throws, and the caller does not
 * await: the reconciler's job is to close the session correctly, and a memory
 * write that could fail that would be a worse bug than the one it fixes.
 *
 * Idempotence is SERVER-SIDE, keyed on the session's `startedAt` — see
 * api/memory.js's `opActivity`. It has to be: two synced devices both run the
 * reconciler over the same synced session, and a client-side guard gives each
 * of them a private opinion about whether the write already happened.
 */
export function logFinishedActivity(
  device: string,
  a: FinishedActivity,
  label: string,
): ActivityRecord | null {
  if (!a || !a.kind || !label) return null;
  if (!Number.isFinite(a.startedAt) || !Number.isFinite(a.closedAt)) return null;
  const summary = activityEpisodeSummary(a, label);
  if (!summary) return null;
  // THE RETURN VALUE IS THE LOCAL HALF, and it is returned rather than written
  // here for the reason every writer in this file is fire-and-forget: this
  // module may not touch app state. The caller (the reconciler) puts it in the
  // ledger. `device` is no longer required to reach that half — a signed-out
  // person with a dead network still gets the memory, which is the entire
  // point of the ledger existing. See `formatActivityLedger`.
  const rec: ActivityRecord = { kind: a.kind, startedAt: a.startedAt, closedAt: a.closedAt, summary };
  if (!device) return rec;
  try {
    post({
      op: "activity",
      device,
      kind: a.kind,
      startedAt: a.startedAt,
      closedAt: a.closedAt,
      summary,
    }).catch(() => {});
  } catch {
    /* never let a memory write reach the reconciler */
  }
  return rec;
}

// ── the LOCAL activity ledger — the half that needs no network ─────────────
//
// #113 put a finished activity in the graph and stopped there, and the graph
// turned out to be reachable by exactly one route: `opRecall`'s semantic leg
// over `vy_fact`. The keyword leg reads `meera_nodes`, which activities are
// never written to; the `weEpisodes` leg needs a `vy_rel_state` row, which
// only exists after a consolidation pass has run. So for a person on their
// FIRST DAY — which is every new person, and was the first external tester —
// the record of a game they had just played was retrievable only if an
// embedding call had succeeded at write time and the same query embedded close
// enough at read time. `api/_embed.js` says in its own doc that "an embedding
// is an enhancement, never the only path to a memory". For activities it was
// the only path.
//
// The fix has two halves and this is the one that cannot fail: the same
// summary the server is sent is ALSO kept on the device, in `AppState`, and
// rendered into the prompt from there. No round trip, no embedding, no person
// row, no consolidation, and it works signed out exactly as it works signed
// in. The server copy stays — it is what survives a reinstall and what the
// relational layer builds on — but it is no longer the only copy.
//
// This is deliberately the SAME string in both stores rather than two
// renderings of one session. `warm-count-unscoped`: when a reader and a writer
// each derive the same record, they eventually disagree, and the disagreement
// is invisible.

/** One finished activity, as it is kept on the device. Small on purpose:
 *  `AppState` is serialised to localStorage on every write. */
export interface ActivityRecord {
  kind: string;
  startedAt: number;
  closedAt: number;
  /** exactly the string sent to the server — one rendering, two stores */
  summary: string;
}

/** How many finished activities the device keeps. Twenty is months of real
 *  play at this product's cadence, and ~8KB against a message history already
 *  measured in tens of KB. Oldest are dropped first: the graph copy is what
 *  carries the deep past, this is what carries the recent past reliably. */
export const ACTIVITY_LEDGER_MAX = 20;

/** How many rows of it reach a single prompt. She does not need every game
 *  she has ever played in front of her; she needs the ones recent enough to
 *  come up. */
export const ACTIVITY_LEDGER_ROWS = 6;

/** Hard ceiling on the rendered block, heading included — sized like
 *  `CHAT_TAIL_BUDGET` and against the same measured worst case. */
export const ACTIVITY_LEDGER_BUDGET = 1200;

/**
 * The heading's first words, and the ONE string both sides of this feature
 * agree on. `api/memory.js`'s own activity block opens with it too, and
 * `evals/gamemem.mjs` asserts the two agree.
 *
 * It is a sentinel because there are now two producers of this block and they
 * must never both render. The server leg exists for the surfaces that have no
 * `AppState` at all — the realtime call lane, Telegram, WhatsApp, Discord —
 * and would otherwise have no route to a finished game. A client that HAS the
 * ledger has the better copy of the same thing (complete, no round trip, no
 * embedding, works signed out), so it drops the server's and renders its own.
 * Rendering both would put every game in the prompt twice, under two headings,
 * which is how a person starts sounding like she is reading a file.
 */
export const ACTIVITY_BLOCK_SENTINEL = "GAMES AND THINGS YOU TWO ACTUALLY DID";

const ACTIVITY_LEDGER_HEAD =
  `${ACTIVITY_BLOCK_SENTINEL}, newest first. This is the whole record of them: never add a move, an opening, a question or a score that is not written here — if they ask for one this list does not carry, say you do not remember it rather than filling it in. Being listed here is not a reason to bring it up.`;

/**
 * `recalled` with any server-rendered activity block taken out.
 *
 * Blocks in a recall string are separated by a single newline and each opens
 * with an ALL-CAPS heading ending in a colon, so a block runs from its heading
 * to the next heading or the end — which is what this walks. Nothing else in
 * the string is touched: a recall with no activity block is returned by
 * reference, so the byte-identity default for everyone who has never finished
 * a game is exact rather than approximate.
 */
export function withoutServerActivityBlock(recalled: string): string {
  const at = recalled.indexOf(ACTIVITY_BLOCK_SENTINEL);
  if (at < 0) return recalled;
  // back up to the start of the heading's own line, then forward to the next
  // line that looks like a heading (a row starts with "- ", a heading does not)
  const from = recalled.lastIndexOf("\n", at) + 1;
  const lines = recalled.slice(from).split("\n");
  let i = 1;
  while (i < lines.length && (lines[i].startsWith("- ") || !lines[i].trim())) i++;
  const rest = lines.slice(i).join("\n");
  return `${recalled.slice(0, from)}${rest}`.replace(/\n{3,}/g, "\n\n").trim();
}

/** Add a finished activity to the ledger, newest first, deduped on the
 *  session's own identity — the same `kind:startedAt` key the server dedupes
 *  on, so a reconciler that runs twice (a remount, a synced close, StrictMode)
 *  cannot produce two memories of one game. Pure; the caller owns the state. */
export function withActivityRecord(
  ledger: readonly ActivityRecord[] | undefined,
  rec: ActivityRecord | null,
): ActivityRecord[] {
  const cur = Array.isArray(ledger) ? ledger : [];
  if (!rec || !rec.summary) return cur as ActivityRecord[];
  const key = `${rec.kind}:${rec.startedAt}`;
  const kept = cur.filter((r) => r && `${r.kind}:${r.startedAt}` !== key);
  return [rec, ...kept]
    .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
    .slice(0, ACTIVITY_LEDGER_MAX);
}

/**
 * The ledger as a prompt block. Pure — the clock is passed in, same contract
 * as `formatChatTail` and for the same reason.
 *
 * The heading is the load-bearing part and it is written as a FENCE, not as
 * flavour: the failure this whole seam exists to fix is her supplying a detail
 * the record does not have, and the record is the only place that boundary can
 * be stated with the record in front of her. It is not a substitute for the
 * gate in `honesty.ts` — `gate0-structural` measured prompt instructions
 * leaking 57–98% where a predicate leaked 0 of 31,122 — it is the half that
 * makes the gate's job possible, because a fence with nothing behind it just
 * produces a refusal where an answer should be.
 *
 * Returns "" when the ledger is empty, which is `memories`' render-nothing
 * default and therefore byte-identical to today for anyone who has never
 * finished a game.
 */
export function formatActivityLedger(
  ledger: readonly ActivityRecord[] | undefined,
  nowMs: number = Date.now(),
): string {
  if (!ledger?.length) return "";
  const rows = [...ledger]
    .filter((r) => r && r.summary && Number.isFinite(r.closedAt))
    .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
    .slice(0, ACTIVITY_LEDGER_ROWS)
    .map((r) => `- ${r.summary} (${agoDaysLabel(r.closedAt, nowMs)})`);
  if (!rows.length) return "";
  // over budget, whole rows go from the OLDEST end. Never a slice: "a sliced
  // block is a lie" and it does not stop applying inside a block.
  let kept = rows;
  while (kept.length && ACTIVITY_LEDGER_HEAD.length + 1 + kept.join("\n").length > ACTIVITY_LEDGER_BUDGET)
    kept = kept.slice(0, -1);
  if (!kept.length) return "";
  return `${ACTIVITY_LEDGER_HEAD}\n${kept.join("\n")}`;
}

/** "today" / "yesterday" / "3 days ago" — how a person places a game they
 *  played. Hand-rolled and lowercase for the same reason `episodeDateLabel`
 *  is: byte-identical in a browser, in Node and in an eval. */
function agoDaysLabel(atMs: number, nowMs: number): string {
  const days = Math.floor((nowMs - atMs) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "just now";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months <= 1 ? "about a month ago" : `${months} months ago`;
}

// ── the holder, so BOTH lanes read one ledger ──────────────────────────────
//
// `callSelfBundle`'s idiom, for its stated reason: the call lane's compile
// sites do not share a call frame with the component that holds `AppState`,
// and the realtime lane does not call `think()` at all. One publisher — the
// reconciler in App.tsx, the one component always mounted, which is already
// where a close is written — and any number of readers.
//
// Not a second source of truth: `AppState.activities` is the store, this is a
// pointer at it, republished whenever it changes. A reader that gets an empty
// array before the first publish renders nothing, which is the same
// render-nothing default an empty ledger has.
let ledgerHolder: readonly ActivityRecord[] = [];

export function publishActivityLedger(ledger: readonly ActivityRecord[] | undefined): void {
  ledgerHolder = Array.isArray(ledger) ? ledger : [];
}

export function activityLedger(): readonly ActivityRecord[] {
  return ledgerHolder;
}

// GAP 4 (WS-FELT) — closeness card. A dedicated read of the same relstate
// bundle op:"recall" already carries (api/memory.js's fetchRelBundle), so
// MoreSheet gets a fresh read on its own schedule instead of depending on
// `takeRelBundle`'s consume-once cache, which is tied to the chat lane's
// own recall timing and may be stale or already consumed by the time
// someone opens Settings. Same 2s-timeout discipline as runRecall — a slow
// network must not hang a settings sheet. `null` on any failure, same as
// every other "no data yet" case in this file.
export async function fetchRelState(device: string): Promise<RelBundleInput | null> {
  if (!device) return null;
  try {
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
    const fetchIt = post({ op: "recall", device, query: "" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.relstate as RelBundleInput | null | undefined) ?? null)
      .catch(() => null);
    return await Promise.race([fetchIt, timeout]);
  } catch {
    return null;
  }
}
