// The embeddable-widget lane — Gurukul WS-N item 3.
//
// The easiest surface a published clone has, and the only one that needs
// nobody's approval: a teacher pastes one `<script>` tag onto their own site
// and their audience can talk to their clone. Everything below is the server
// half of that; `api/embed.js` is the ~6KB of vanilla JS that renders it.
//
// ── it is a SURFACE, so it obeys the surface contract ─────────────────────
//
// Not a second chat engine. The reply comes out of `api/_surface.js`'s
// `gatedReply()` — the same single door every other surface's bytes leave by —
// so this lane inherits protocol-marker extraction, the texting-dash
// predicate, honesty families 1-4 and the presupposition detector, and it
// inherits every family added after today for free. A widget with its own
// reply path would be `age-tier-never-realtime` in a new costume: a second
// assembler that misses every rule added after the fork, silently, while
// returning 200.
//
// ── ANONYMOUS, and therefore REMEMBERS NOTHING ────────────────────────────
//
// A visitor on a teacher's website has no `vy_person` row and gets none. That
// is §6.4's rule ("no person row, no persistence") applied where it bites
// hardest: the visitor is very likely a minor, has consented to nothing, and
// arrived from a page that is not ours. So this lane writes NO memory, opens
// NO episode, and reaches NO retrieval — the compile below passes empty
// `memories`, and there is no code path here that could pass anything else.
//
// The consequence is deliberate and it is a product fact, not a gap: the
// widget is a taste of the clone, and continuity is what the student app is
// for. A widget that quietly built a profile of an unidentified child would be
// the exact betrayal this repo's disclosure work exists to prevent.
//
// ── the disclosure is STRUCTURAL, not a thing the widget is asked to do ───
//
// safety-floor-teacher.md §1, predicate P1: the session-open card fires at
// n=0 of every session, in the APP's voice, before the first turn. The widget
// script runs on somebody else's website, where we control nothing — so
// "the widget renders the card" cannot be the mechanism. A page that stripped
// the render would still chat.
//
// So the card is bound into the SESSION TOKEN. `openSession` computes the
// card, hashes it, and mints a token carrying that digest; `chatTurn` recomputes
// the card for the resolved clone and REFUSES a token whose digest does not
// match. A session that never received the current card cannot produce a turn.
// That is the same move `clock.ts` makes for the statutory session clock and
// the same reason: instruction ≠ emission is measured, so a disclosure that
// rides on anyone's good behaviour is a preference, not a guarantee.
//
// ── the transcript is the CLIENT's, and it is signed ──────────────────────
//
// There is no server-side widget session table, because an anonymous,
// memory-free lane should not create durable rows keyed to a visitor — that is
// the profile this file just refused to build. So the transcript lives in the
// browser and rides on each request, and every reply mints a NEW token whose
// digest covers the transcript so far. A client that edits history — or
// invents an `assistant` turn that puts words in a real teacher's clone's
// mouth — presents a digest that does not match and is refused.
import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { gatedReply, makeCtx, splitForLimit, loadEngine, think, deliver } from "./_surface.js";
import { compileNeverRules } from "./_never-rules.js";
import { loadNeverRules } from "./_review-queue.js";
import { resolveInboundClone, cloneDisclosureCard, disclosureNameFor } from "./_clonechannel.js";

/** Web bubbles have no hard platform limit; this is a product one. Long enough
 *  for a worked step, short enough that a wall of text is a bug and not a
 *  style. */
export const WIDGET_TEXT_LIMIT = 4000;
/** What a visitor may send in one turn. */
export const WIDGET_INBOUND_LIMIT = 2000;
/** How much history rides on a request. Older turns fall off the front — the
 *  same window `dmHistory` uses, enforced here because there is no database to
 *  enforce it for us. */
export const WIDGET_HISTORY_TURNS = 30;
/** A session is short. Not a security boundary on its own (the digest is), but
 *  a token minted on a page that has been open since last Tuesday should not
 *  still buy turns. */
export const WIDGET_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

export class CloneChatError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

/** The signing key. UNSET MEANS THE WIDGET IS OFF, everywhere, immediately —
 *  and that is the correct posture rather than an inconvenience: without it
 *  the disclosure binding and the transcript binding are both unforgeable by
 *  nobody, which is to say the lane has no guarantees left to offer. */
function sessionSecret(env = process.env) {
  const secret = String(env.CLONE_WIDGET_SESSION_SECRET || "");
  if (secret.length < 32) throw new CloneChatError("clone_widget_unconfigured", 503);
  return secret;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sha = (s) => createHash("sha256").update(String(s)).digest("base64url").slice(0, 32);

/** The transcript digest: role and text, in order, and nothing else. Roles are
 *  normalized first so `Assistant` and `assistant` cannot be two transcripts
 *  with one meaning. */
export function transcriptDigest(turns) {
  const canon = (turns || [])
    .map((t) => {
      const text = String(t?.content ?? "");
      // LENGTH-PREFIXED, not delimiter-joined. A separator — any separator —
      // is a character a visitor can type, and two transcripts that differ
      // only in where the separators fall would then share one digest, which
      // is exactly the forgery this digest exists to refuse.
      return `${t?.role === "assistant" ? "a" : "u"}:${text.length}:${text}`;
    })
    .join("\n");
  return sha(canon);
}

/** Constant-time over equal-length digests. `timingSafeEqual` throws on a
 *  length mismatch, so both sides are hashed to a fixed width first — the same
 *  shape api/tg.js's `secretOk` uses and for the same reason. */
function sameSignature(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function mintSession(payload, env = process.env) {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", sessionSecret(env)).update(body).digest("base64url");
  return `v1.${body}.${sig}`;
}

export function readSession(token, env = process.env) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new CloneChatError("clone_session_invalid", 401);
  const expected = createHmac("sha256", sessionSecret(env)).update(parts[1]).digest("base64url");
  if (!sameSignature(parts[2], expected)) throw new CloneChatError("clone_session_invalid", 401);
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new CloneChatError("clone_session_invalid", 401);
  }
  if (!payload || typeof payload !== "object") throw new CloneChatError("clone_session_invalid", 401);
  return payload;
}

// ─────────────────────────────────────────────────────────────────────────
// the widget's surface adapter — the four functions, and nothing else
// ─────────────────────────────────────────────────────────────────────────
//
// `send` COLLECTS rather than transmits, because on this wire the reply IS the
// HTTP response. That is the honest implementation of `send()` for a
// request/response surface and it keeps `deliver()`'s fragmentation, threading
// and button rules identical to every other surface's.

export function collector() {
  const sent = [];
  return {
    sent,
    adapter: {
      surface: "web",
      verify: async () => ({ ok: true, reason: "" }),
      parse: () => [],
      send: async (_chatKey, msg) => {
        sent.push(String(msg.text ?? ""));
        return { ok: true };
      },
      render: (text) => splitForLimit(text, WIDGET_TEXT_LIMIT),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// the two operations
// ─────────────────────────────────────────────────────────────────────────

/** The widget's public address is a SLUG, and both web kinds resolve it — a
 *  full-page embed and a bubble are the same binding wearing two renderers. */
async function resolveWidget(db, slug, deps) {
  const s = String(slug || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(s)) throw new CloneChatError("clone_unavailable", 404);
  for (const kind of ["web_widget", "web_embed"]) {
    const resolved = await resolveInboundClone(db, kind, s, deps).catch(() => null);
    if (resolved) return resolved;
  }
  // ONE indistinguishable error, api/_clonechannel.js's rule: unbound, paused,
  // revoked, unpublished and consent-withdrawn are the same 404 here, because
  // a caller that could tell them apart could enumerate which teachers had
  // taken their clone down.
  throw new CloneChatError("clone_unavailable", 404);
}

/**
 * Open a session. Returns the disclosure card and a token that carries its
 * digest — see the header for why the card is bound rather than requested.
 */
export async function openCloneSession(db, { slug, visitorId }, deps = {}) {
  const resolved = await resolveWidget(db, slug, deps);
  const disclosure = cloneDisclosureCard(disclosureNameFor(resolved.sheet));
  const now = deps.now ?? Date.now();
  const token = mintSession(
    {
      s: resolved.slug,
      v: String(visitorId || "").slice(0, 64),
      iat: now,
      dd: sha(disclosure),
      td: transcriptDigest([]),
      n: 0,
    },
    deps.env,
  );
  return {
    session: token,
    // The card the widget MUST render, and the same bytes the teacher
    // approved in the studio's DisclosurePreview. Returned as data, in the
    // app's voice, never generated by the model.
    disclosure,
    display_name: disclosureNameFor(resolved.sheet),
  };
}

/**
 * One turn.
 *
 * The order below is the design: VERIFY the session, RESOLVE the clone,
 * RE-DERIVE the disclosure and refuse a stale one, CHECK the transcript
 * against its digest, compile, and only then reach the gate.
 */
export async function cloneChatTurn(db, { session, message, transcript = [] }, deps = {}) {
  const payload = readSession(session, deps.env);
  const now = deps.now ?? Date.now();
  if (!Number.isFinite(payload.iat) || now - payload.iat > WIDGET_SESSION_TTL_MS) {
    throw new CloneChatError("clone_session_expired", 401);
  }
  const text = String(message ?? "").trim();
  if (!text) throw new CloneChatError("clone_message_empty", 400);
  if (text.length > WIDGET_INBOUND_LIMIT) throw new CloneChatError("clone_message_too_long", 413);

  const resolved = await resolveWidget(db, payload.s, deps);

  // THE DISCLOSURE PREDICATE. The card is recomputed from the clone that is
  // answering NOW, so a session opened against an older card — a teacher
  // renamed, a sheet republished — is refused rather than continued under a
  // disclosure the visitor never saw. Fail closed, and the widget's response
  // to this code is to re-open (and therefore to re-render the card).
  const disclosure = cloneDisclosureCard(disclosureNameFor(resolved.sheet));
  if (payload.dd !== sha(disclosure)) throw new CloneChatError("clone_disclosure_stale", 409);

  const history = (Array.isArray(transcript) ? transcript : [])
    .slice(-WIDGET_HISTORY_TURNS)
    .map((t) => ({
      role: t?.role === "assistant" ? "assistant" : "user",
      content: String(t?.content ?? "").slice(0, WIDGET_TEXT_LIMIT),
    }));
  // The transcript binding. A client that edited history — or invented an
  // assistant turn putting words in a real teacher's clone's mouth — presents
  // a digest that does not match.
  if (payload.td !== transcriptDigest(history)) throw new CloneChatError("clone_transcript_mismatch", 409);

  const engine = deps.engine !== undefined ? deps.engine : await loadEngine();
  // No engine, no answer, and the failure is LOUD. A hand-rolled fallback
  // prompt here would be a second clone of a real, named, living person that
  // nobody validated and nobody consented to.
  if (!engine) throw new CloneChatError("clone_engine_unavailable", 503);

  const { sent, adapter } = collector();
  const ctx = makeCtx(adapter, {
    engine,
    agent: resolved.module,
    agentId: resolved.agentId,
    reply: deps.reply || ((compiled, turns) => think(engine, compiled, turns)),
  });

  const compiled = engine.compile({
    agent: resolved.module,
    user: { name: "", vibe: [], facts: {} },
    messageCount: history.length,
    medium: "text",
    mode: "chat",
    voiceEngine: "none",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    // EMPTY, structurally. See the header: this lane is anonymous, so there is
    // nothing to recall and no code path here that could pass anything else.
    memories: "",
    herLife: "",
    cultureNoteText: "",
    latestUserText: text,
  });

  const turns = [...history, { role: "user", content: text }];
  // WS-R4. The owner's "Never say this" rules, read per turn from the table the
  // review queue writes and handed to the one door as a PREDICATE. Not a prompt
  // line: `gate0-structural` measured prompt instructions leaking 57-98% and the
  // predicate leaking 0 of 31,122, and a list of forbidden sentences in a brief
  // is also a phrase bank pointed at exactly the strings it forbids
  // (`recited-prompt`). Read here rather than cached because a rule the owner
  // added a minute ago has to bind on the next turn, not on the next deploy.
  const neverRules = compileNeverRules(
    deps.neverRules ?? (resolved.channel?.replica_id && resolved.channel?.owner_user_id
      ? await loadNeverRules(db, resolved.channel.replica_id, resolved.channel.owner_user_id)
      : []),
  );
  // The one door. `record` and `nameable` are EMPTY, which makes honesty
  // family 4 as strict as it ever is: with no retrieved record, a clone that
  // claims a shared past with this visitor is caught, and on an anonymous
  // widget every such claim is false by construction.
  const gatedOut = await gatedReply(ctx, compiled, turns, { label: "web/widget", neverRules });
  const said = gatedOut.text;
  if (said) {
    await deliver(ctx, "widget", { kind: "text", text: said, replyTo: null, buttons: [] });
  }

  const nextTurns = said ? [...turns, { role: "assistant", content: said }] : turns;
  return {
    // Fragments, as `render()` split them — the widget renders one bubble per
    // fragment, which is how her burst structure survives onto this wire.
    bubbles: sent,
    // The EXACT text the next digest covers. Returned separately from the
    // fragments on purpose: `render()` trims at the split points, so rejoining
    // bubbles is not guaranteed to reproduce this string, and a client that
    // recorded the rejoin would fail its own next request the first time a
    // reply crossed the split threshold. Fragments are a rendering decision;
    // the record is not.
    reply: said,
    session: mintSession(
      { ...payload, td: transcriptDigest(nextTurns), n: (payload.n | 0) + 1 },
      deps.env,
    ),
    // Counts only, never the strings — `gateReply`'s rule, and the whole point
    // of the event is that what it caught must not travel.
    // Counts and a boolean, never the rule's text and never the suppressed
    // string. `never_rule_applied` is on the wire because a widget that went
    // silent has to be able to say it was the owner's rule rather than a
    // failure, and a visitor who is told "there is nothing here" about a
    // deliberate refusal is being misled about which way the product broke.
    gate: {
      applied: gatedOut.gated,
      findings: gatedOut.findings.length,
      never_rule_applied: Boolean(gatedOut.neverRule),
    },
  };
}
