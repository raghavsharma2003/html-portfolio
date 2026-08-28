// The clone's reply inside a Mirror Call — WS-AC.
//
// Contract: docs/gurukul/MIRROR-CALL-SPEC.md §"Clone speech" ("cascade lane
// (ASR -> engine -> TTS), not full-duplex"). This file is the ENGINE half of
// that cascade; `api/_voice/preview-panel.js` is the TTS half and is reused
// unchanged.
//
// ═════════════════════════════════════════════════════════════════════════
// IT IS NOT A SECOND CHAT ENGINE, AND THAT IS THE WHOLE DESIGN
// ═════════════════════════════════════════════════════════════════════════
//
// The reply comes out of `api/_surface.js`'s `gatedReply()` — the same single
// door every other surface's bytes leave by — assembled from the owner's own
// TeacherSheet through the same `sheetToModule` the published clone runs on.
// `api/_clonechat.js` states the argument in full and it transfers verbatim: a
// lane with its own reply path is `age-tier-never-realtime` in a new costume,
// a second assembler that misses every rule added after the fork, silently,
// while returning 200.
//
// There is therefore NO fallback persona anywhere below. A replica with no
// sheet produces NO TURN and a named reason, never a generic assistant voice.
// That refusal is load-bearing in a way it is not on the widget: on a Mirror
// Call the owner is listening to a clone OF THEMSELVES in order to judge
// whether it sounds like them, and a generic chatbot wearing their cloned
// voice would corrupt the only judgement the call exists to collect. The
// closest failure already in the book is `plausible-return-hides-a-dead-
// pipeline`, and this one would come with a speaker attached.
//
// ═════════════════════════════════════════════════════════════════════════
// PUBLISHED SHEET PREFERRED, DRAFT SHEET ALLOWED, THE DIFFERENCE ANNOUNCED
// ═════════════════════════════════════════════════════════════════════════
//
// A calibration call is the thing an owner does BEFORE they publish, so
// refusing every unpublished replica would make the feature unreachable
// exactly when it is most useful. So the draft sheet answers — and every
// payload that carries the turn also carries `sheet_source`, because "the
// owner heard a plausible voice and could not tell which persona produced it"
// is the failure mode this repo has already paid for once.
//
// The consent gate is NOT relaxed by that. `loadTeacherAgent` refuses an
// unconsented published row and this lane never reaches it; the draft path
// here is owner-to-own-replica only, enforced by the SQL predicate in
// `mirrorReplyAgent` and by nothing in this file.
//
// ═════════════════════════════════════════════════════════════════════════
// THE CAPTION AND THE AUDIO ARE THE SAME STRING
// ═════════════════════════════════════════════════════════════════════════
//
// WS-W's panel caps synthesis text at 280 characters (`capPanelText`), and
// this lane synthesises through that function rather than around it. So the
// turn is capped HERE, at assembly, to the first fragment `splitForLimit`
// yields at that width — and the caption renders that same capped string.
//
// The alternative was tried on paper and rejected: caption the full reply and
// speak the first fragment. That produces a screen saying more than the voice
// said, which is `silent-truncation` with a speaker on it and is worse on a
// call than anywhere else, because the owner is grading the voice against the
// text in front of them. The trimming is NOT silent either — `assembled_chars`
// rides on the row and on the wire whenever it exceeds the spoken length.
import {
  gatedReply,
  loadEngine,
  makeCtx,
  splitForLimit,
  think,
} from "./_surface.js";
import { sheetToModule, validateTeacherSheet } from "./_engine.gen.js";

/** The synthesis cap, and therefore the caption cap. Equal to
 *  `api/_voice/warmup.js`'s `PANEL_TEXT_MAX` by intent and not by coincidence:
 *  if that number moves and this one does not, every long turn becomes a 413
 *  the owner reads as a broken clone. `evals/mirrorcallreply.mjs` asserts the
 *  two are equal so the drift is a failing check rather than a support ticket. */
export const MIRROR_REPLY_TEXT_MAX = 280;

/** How much of the call rides into the compile. The cascade lane is one window
 *  at a time, so twenty turns is roughly ten exchanges — long enough that the
 *  clone does not restart every window, short enough that a thirty-minute call
 *  does not grow an unbounded prompt under the budget checker. */
export const MIRROR_REPLY_HISTORY_TURNS = 20;

/** What one owner window may contribute. Sarvam's sync lane caps a window at
 *  30 s, which cannot reach this, so it is a guard against a malformed
 *  transcript rather than a product limit. */
export const MIRROR_REPLY_INPUT_MAX = 2_000;

/**
 * Every reason a window can fail to produce a turn, and nothing else.
 *
 * `turn_absent_reason` is the field WS-Y renders, so this set IS the vocabulary
 * of that field. Kept frozen and exported so the eval can assert that the
 * handler emits nothing outside it: a reason string invented at a call site is
 * a reason no client can render and no operator can grep for.
 *
 * `clone_reply_lane_not_wired` is deliberately still here. It is what WS-X's
 * build answered on every window, it is what a deployment running the previous
 * tree still answers, and deleting the value would make that deployment's
 * payloads unparseable rather than merely stale.
 */
export const MIRROR_TURN_ABSENT_REASONS = Object.freeze([
  "clone_reply_lane_not_wired",
  "owner_window_dropped",
  "clone_sheet_absent",
  "clone_sheet_invalid",
  "clone_engine_unavailable",
  "clone_reply_empty",
  "clone_reply_failed",
]);

/** Why a turn that EXISTS still cannot be spoken. Distinct from the absent
 *  reasons above on purpose: "there is no turn" and "there is a turn and the
 *  voice route will not carry it" are different things for a studio to say,
 *  and collapsing them would make the captions-only state indistinguishable
 *  from a clone with nothing to say. */
export const MIRROR_VOICE_ABSENT_REASONS = Object.freeze([
  "voice_route_unconfigured",
  "voice_genome_absent",
]);

export function mirrorReplyError(code, status = 409, details) {
  const error = Object.assign(new Error(code), { code, status });
  if (details) error.details = details;
  return error;
}

/**
 * Trim an assembled reply to what can actually be spoken.
 *
 * Returns `{ text, assembledChars, truncated }`. `text` is what is captioned
 * AND synthesised — one string, never two.
 */
export function capMirrorReply(value, max = MIRROR_REPLY_TEXT_MAX) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  const assembledChars = raw.length;
  if (!raw) return { text: "", assembledChars: 0, truncated: false };
  if (assembledChars <= max) return { text: raw, assembledChars, truncated: false };
  // `splitForLimit` is the same fragmenter every surface renders through, so
  // the cut lands where a burst would have split rather than mid-word.
  const first = splitForLimit(raw, max)[0]?.text ?? raw.slice(0, max);
  return { text: first.trim(), assembledChars, truncated: true };
}

/**
 * The rolling call, as the engine's turn list.
 *
 * Owner windows that DROPPED contribute nothing — they have no words, and
 * inventing a placeholder for them would put something in the clone's context
 * that the owner never said. Turns are interleaved by `seq`, which is the only
 * ordering either side agrees on.
 */
export function mirrorReplyHistory(windows, turns, limit = MIRROR_REPLY_HISTORY_TURNS) {
  const bySeq = new Map();
  for (const w of Array.isArray(windows) ? windows : []) {
    if (String(w?.asr_state) !== "transcribed") continue;
    const text = String(w.transcript || "").trim();
    if (!text) continue;
    const seq = Number(w.seq);
    if (!bySeq.has(seq)) bySeq.set(seq, {});
    bySeq.get(seq).user = text.slice(0, MIRROR_REPLY_INPUT_MAX);
  }
  for (const t of Array.isArray(turns) ? turns : []) {
    const text = String(t?.text || "").trim();
    if (!text) continue;
    const seq = Number(t.seq);
    if (!bySeq.has(seq)) bySeq.set(seq, {});
    bySeq.get(seq).assistant = text;
  }
  const out = [];
  for (const seq of [...bySeq.keys()].sort((a, b) => a - b)) {
    const pair = bySeq.get(seq);
    if (pair.user) out.push({ role: "user", content: pair.user });
    if (pair.assistant) out.push({ role: "assistant", content: pair.assistant });
  }
  return out.slice(-limit);
}

/**
 * Build the AgentModule for the owner's own replica from the sheet row the
 * store returned.
 *
 * Throws — every failure path, with a code. Returns `{ module, sheetSource }`.
 * There is no branch that returns a default module, for the reason the header
 * gives at length.
 */
export function mirrorReplyModule(sheetRow) {
  if (!sheetRow) throw mirrorReplyError("clone_sheet_absent", 409);
  const sheet = sheetRow.sheet && typeof sheetRow.sheet === "object"
    ? sheetRow.sheet
    : (() => { try { return JSON.parse(String(sheetRow.sheet || "")); } catch { return null; } })();
  if (!sheet || typeof sheet !== "object") throw mirrorReplyError("clone_sheet_invalid", 409);

  // Re-validated at LOAD, exactly as `loadTeacherAgent` does and for the same
  // reason: a sheet that was valid when it was saved and is not valid now must
  // fail closed rather than quietly serve the version that predates the rule.
  // The draft path needs this MORE than the published one, because a draft has
  // never been through the publish gate at all.
  const validation = validateTeacherSheet(sheet);
  if (!validation.ok) {
    throw mirrorReplyError("clone_sheet_invalid", 409, { errors: validation.errors });
  }
  const module = sheetToModule(sheet);

  // The wrong-agent guard, transferred from `loadTeacherAgent`. Here the
  // disaster it prevents is narrower and stranger: an owner calibrating their
  // clone against SOMEBODY ELSE'S persona, in their own cloned voice, and
  // accepting phrase-habit chips mined from the mismatch. One mis-joined row
  // reaches it.
  const slug = String(sheetRow.slug || "");
  if (slug && module.slug !== slug) {
    throw mirrorReplyError("clone_sheet_invalid", 500, { row_slug: slug, sheet_slug: module.slug });
  }
  return {
    module,
    sheetSource: sheetRow.status === "published" && sheetRow.consent_artifact_id ? "published" : "draft",
    sheetId: sheetRow.sheet_id || null,
    agentId: sheetRow.agent_id || null,
    slug: module.slug || slug,
  };
}

/**
 * Assemble one clone turn.
 *
 * Everything with an edge is injected so `evals/mirrorcallreply.mjs` can drive
 * the whole assembly offline with no engine bundle, no database and no
 * credential — the discipline `api/_voice/preview-panel.js` established.
 *
 * @param deps `{ sheetRow, history, latestText, engine?, reply?, now? }`
 * @returns `{ ok: true, ... }` or `{ ok: false, reason }` where `reason` is a
 *   member of MIRROR_TURN_ABSENT_REASONS. It does NOT throw for an expected
 *   refusal: a window whose clone could not answer is still a window that must
 *   return its transcript, its chips and its fidelity, and a throw here would
 *   lose all three to a lane failure that is not one.
 */
export async function assembleMirrorReply(deps = {}) {
  const latest = String(deps.latestText ?? "").trim().slice(0, MIRROR_REPLY_INPUT_MAX);
  if (!latest) return { ok: false, reason: "owner_window_dropped" };

  let built;
  try {
    built = mirrorReplyModule(deps.sheetRow);
  } catch (error) {
    const code = String(error?.code || "clone_sheet_invalid");
    return {
      ok: false,
      reason: code === "clone_sheet_absent" ? "clone_sheet_absent" : "clone_sheet_invalid",
      details: error?.details ?? null,
    };
  }

  const engine = deps.engine !== undefined ? deps.engine : await loadEngine();
  // No engine, no answer, and the failure is NAMED. A hand-rolled fallback
  // prompt here would be a second clone of a real, named, living person that
  // nobody validated and nobody consented to — and on this surface that person
  // is the one listening.
  if (!engine) return { ok: false, reason: "clone_engine_unavailable" };

  const history = Array.isArray(deps.history) ? deps.history : [];
  // A REQUEST/RESPONSE surface: the reply IS the response, so `send` has
  // nothing to transmit to. It is present because `makeCtx` requires an
  // adapter and because a `send` that threw would turn a future `deliver()`
  // call added by someone else into a lane failure rather than a no-op.
  const adapter = {
    surface: "web",
    verify: async () => ({ ok: true, reason: "" }),
    parse: () => [],
    send: async () => ({ ok: true }),
    render: (text) => splitForLimit(text, MIRROR_REPLY_TEXT_MAX),
  };
  const ctx = makeCtx(adapter, {
    engine,
    agent: built.module,
    agentId: built.agentId || undefined,
    reply: deps.reply || ((compiled, turns) => think(engine, compiled, turns)),
  });

  const compiled = engine.compile({
    agent: built.module,
    // The owner is the person on the call and the person the clone is OF. No
    // vibe and no facts are passed: this lane reads no memory and writes none,
    // and passing a half-populated profile would make the clone's familiarity
    // depend on which fields a studio happened to fill.
    user: { name: "", vibe: [], facts: {} },
    messageCount: history.length,
    // SPOKEN, not texted. The engine's spoken-register rules are the ones
    // `evals/persona-invariants.mjs` protects, and a Mirror Call reply that
    // compiled as text would be graded by the owner as a voice.
    medium: "voice",
    mode: "call",
    // Not "live". The live branch of `buildSpeechStyle` tells her that nothing
    // she says is written down anywhere, which is FALSE here — a Mirror Call
    // turn is captioned on screen and stored as a row so the owner can rate it
    // and the synthesis path can bind to it. "device" is the truthful value
    // for a cascade lane driven by our own runtime, and the `[tone: …]` marker
    // its branch asks for never reaches an ear: `parseBubbles` extracts it
    // inside `gatedReply` before this function ever sees the text.
    voiceEngine: "device",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    // EMPTY, structurally. The Mirror Call has no retrieval lane: the owner is
    // calibrating a persona, not resuming a relationship, and a clone that
    // claimed a shared past here would be claiming it with the one person who
    // can tell it is false.
    memories: "",
    herLife: "",
    cultureNoteText: "",
    latestUserText: latest,
  });

  const turns = [...history, { role: "user", content: latest }];
  let gated;
  try {
    // THE ONE DOOR. `record` and `nameable` are empty, which makes honesty
    // family 4 as strict as it ever is.
    gated = await gatedReply(ctx, compiled, turns, { label: "studio/mirror-call" });
  } catch (error) {
    return { ok: false, reason: "clone_reply_failed", details: { code: String(error?.code || "") } };
  }

  const capped = capMirrorReply(gated?.text);
  if (!capped.text) return { ok: false, reason: "clone_reply_empty" };

  return {
    ok: true,
    text: capped.text,
    assembledChars: capped.assembledChars,
    truncated: capped.truncated,
    sheetSource: built.sheetSource,
    sheetId: built.sheetId,
    agentSlug: built.slug,
    // Counts only, never the strings — `gateReply`'s rule.
    gate: { applied: Boolean(gated?.gated), findings: Array.isArray(gated?.findings) ? gated.findings.length : 0 },
  };
}
