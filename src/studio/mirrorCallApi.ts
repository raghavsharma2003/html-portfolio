// mirrorCallApi.ts — THE ONE FILE the Mirror Call backend has to satisfy.
//
// `docs/gurukul/MIRROR-CALL-SPEC.md` §Build shape names `api/mirror-call.js`
// (WS-X) as the server half and this UI (WS-Y) as the client half. The two
// were built in parallel, so this file is deliberately the ONLY place the
// wire format appears: every request path, every field name, every response
// shape. Reconciling with WS-X's real contract is a single-file change, and
// nothing above it (MirrorCallStudio.tsx, mirrorCallMachine.ts) knows a route
// or a JSON key.
//
// ── WHAT THIS FILE REFUSES TO DO ──────────────────────────────────────────
// It does not mock. There is no local fallback that answers a call when the
// server is missing, because a UI that keeps talking with no backend is
// indistinguishable from a working one and would be the `silent-truncation`
// failure with a face on it. When `/api/mirror-call` is not deployed, the
// handshake below throws `MirrorCallBackendAbsent` and the UI says exactly
// that.
//
// ── THE HANDSHAKE ─────────────────────────────────────────────────────────
// `GET /api/mirror-call?op=contract` must return `{ contract: "mirror-call/v1",
// ops: [...] }` with NO auth requirement beyond the bearer token. It exists so
// "the route is not deployed" (404 on the handshake) is distinguishable from
// "your session expired" (401) and from "that session id is gone" (404 on a
// real op) — three states that all arrive as 404 if you only ever call the
// real ops. If WS-X versions the contract past v1, `assertContract` fails
// loudly rather than half-working.
import { ReplicaApiError } from "./replicaApi";

export const MIRROR_CALL_ROUTE = "/api/mirror-call";
export const MIRROR_CALL_CONTRACT = "mirror-call/v1";
export const FIDELITY_FAMILY = "speechbrain-ecapa-voxceleb";

/** The hard client-side window cap. The spec says ≤30s windows → Sarvam sync
 *  lane; the server may ask for something SHORTER via `window_ms_max` and the
 *  client takes the minimum. It may never ask for something longer. */
export const MAX_WINDOW_MS = 30_000;

export type MirrorCallOp =
  | "contract"
  | "create"
  | "end"
  | "ingest_window"
  | "deltas"
  | "delta_action"
  | "turn_voice"
  | "turn_feedback"
  | "status";

/** Every op this UI calls, in the order a call uses them. WS-X's `contract`
 *  response is checked against this list, so an op quietly missing from the
 *  deployment is a visible error and not a mysterious 400 mid-call. */
export const REQUIRED_OPS: readonly MirrorCallOp[] = [
  "create",
  "end",
  "ingest_window",
  "deltas",
  "delta_action",
  "turn_feedback",
];

/** `turn_voice` is deliberately NOT in REQUIRED_OPS. WS-W owns synthesis; if
 *  WS-X has not yet proxied it, the call still runs with captions only and
 *  says so, which is more useful than refusing to connect.
 *
 *  `status` is optional for a different reason: without it the studio can only
 *  show the GPU's own ESTIMATE of when it will be warm, and an estimate shown
 *  as a fact is the fake-progress-bar failure the spec forbids. With it, the
 *  studio waits on a real answer. Absent, the copy says it is an estimate. */
export const OPTIONAL_OPS: readonly MirrorCallOp[] = ["turn_voice", "status"];

/**
 * The clone's voice runtime is booting. NOT an error and NOT an absent seam.
 *
 * `api/_voice/warmup.js` measured the two facts behind this: the GPU replica is
 * ready 161 s after a wake, and the request that woke it dies at 242 s on a
 * platform timeout. So the server dispatches the wake, stops WAITING at 12 s,
 * and answers 202 with the honest band. That is a third outcome beside "audio"
 * and "broken", and collapsing it into either is the fake-progress-bar failure
 * (into an error: the owner is told their clone failed when it is starting;
 * into a spinner: the owner watches a bar over a number nobody measured).
 */
export class MirrorCallVoiceWarming extends Error {
  stage: string;

  etaSecondsLow: number;

  etaSecondsHigh: number;

  retryAfterMs: number;

  constructor(body: any) {
    super(
      typeof body?.message === "string" && body.message
        ? body.message
        : "Your voice runtime is starting on a GPU. From a cold start this takes about 2 to 3 minutes.",
    );
    this.name = "MirrorCallVoiceWarming";
    this.stage = String(body?.stage || "runtime_cold");
    this.etaSecondsLow = Number.isFinite(body?.eta_seconds_low) ? Number(body.eta_seconds_low) : 120;
    this.etaSecondsHigh = Number.isFinite(body?.eta_seconds_high) ? Number(body.eta_seconds_high) : 180;
    this.retryAfterMs = Number.isFinite(body?.retry_after_ms) ? Number(body.retry_after_ms) : 30_000;
  }
}

export class MirrorCallBackendAbsent extends Error {
  detail: string;

  constructor(detail: string) {
    super("The Mirror Call backend is not deployed on this environment.");
    this.name = "MirrorCallBackendAbsent";
    this.detail = detail;
  }
}

// ── response shapes ────────────────────────────────────────────────────────

/**
 * TWO numbers, not one — adoption delta A2 of
 * `docs/gurukul/research/mirror-learning.md`.
 *
 * The sweep read Chatterbox's own source: `prepare_conditionals` truncates the
 * reference to 10 s (s3gen) and 6 s (T3), so pooled call audio past that is
 * mechanically inert for synthesis. But `voice-evidence`'s ECAPA embedding
 * consumes the whole grown pool, so a single meter would climb steadily beside
 * a clone that cannot have changed. That is the same honesty defect class as
 * `disclosure-announces-the-clone`: a display that moves for a reason the
 * viewer will read as a different reason.
 *
 * So the wire carries both, and the UI labels them apart:
 *  - MEASUREMENT: how well we can measure this speaker. Improves as call audio
 *    pools. Says nothing about the clone.
 *  - CONDITIONING: the score of the ~10 s window the NEXT reply is actually
 *    built from. Moves only when a better window is selected — the voice
 *    loop's real lever is selection, not accumulation (adoption delta A1).
 */
export interface MirrorCallFidelity {
  /** Always the ECAPA family — these numbers are speaker-embedding similarity
   *  and the UI is required to label them as such (spec §Fidelity honesty). */
  family: string;
  policy_version: string;
  /** The PRINTED self-vs-self ceiling for this speaker. `null` when no ceiling
   *  has been printed, in which case neither meter has a top and both say so
   *  rather than borrowing another speaker's number. */
  ceiling: number | null;
  /** Mean cosine over every scored window in the pooled call audio. `null`
   *  before the first scored window — NOT 0, which would render as a terrible
   *  clone. */
  measurement_score: number | null;
  /** 0..1 confidence in that estimate, which is what genuinely improves as
   *  audio accumulates. `null` when the server does not compute one. */
  measurement_confidence: number | null;
  p10: number | null;
  /** How many windows the estimate is over. A score over one window is an
   *  anecdote (`api/_fidelity.js` says so in its own words). */
  windows: number;
  /** Seconds of owner audio pooled so far. */
  pooled_seconds: number;
  /** ECAPA score of the conditioning window currently selected for synthesis.
   *  This is the only one of the two that describes the next reply. */
  conditioning_window_score: number | null;
  /** Length of that window in seconds — expected ~10 under Chatterbox. */
  conditioning_seconds: number | null;
  /** When that window was last re-selected. Unchanged ⇒ the clone's voice
   *  cannot have changed, and the UI says exactly that. */
  window_selected_at: string | null;
  /** How many times a better window has been chosen this call. */
  window_selections: number;
}

export type MirrorCallDeltaKind =
  | "phrase_habit"
  | "register"
  | "boundary"
  | "fact"
  | "delivery";

export type MirrorCallDeltaStatus = "proposed" | "accepted" | "rejected" | "deferred";

export interface MirrorCallDelta {
  delta_id: string;
  kind: MirrorCallDeltaKind;
  /** The TeacherSheet field this would change. */
  field: string;
  /** What the mining pass proposes. Shapes and notes — never a quotable line
   *  (`recited-prompt`); the server is the enforcement point, this is the
   *  reminder that it is. */
  proposal: string;
  /** What the owner said that produced it. A chip with no citation is a chip
   *  nobody can judge, so this is required. */
  citation: { turn_id: string; quote: string; occurrences: number };
  /**
   * The evidence behind the claim, shown on the chip — adoption delta A4.
   * A 30-minute call yields ~1,800–2,300 owner words, which is BELOW every
   * stylometric floor in the sweep (2,000–5,000 words; under 3,000 gives >60%
   * false attribution). So a chip mined from one call is a hypothesis, and the
   * UI has to make an n=1 chip visibly weaker than an n=9-across-three-calls
   * chip or the loop is manufacturing confidence it does not have.
   */
  evidence: {
    occurrences_this_call: number;
    /** Across the owner's whole corpus, when the server keeps one. */
    occurrences_total: number;
    calls: number;
    corpus_words: number;
  };
  status: MirrorCallDeltaStatus;
  /** SERVER TRUTH: is this on the sheet. The UI never infers this from a tap.
   *  See `normalizeDelta` — an `applied: true` that is not also `accepted` is
   *  treated as a server bug and forced to false. */
  applied: boolean;
  created_at: string;
}

export interface MirrorCallTurn {
  turn_id: string;
  /** The clone's reply text, for the live caption. */
  text: string;
  /** Whether `op=turn_voice` can synthesise this turn. */
  can_voice: boolean;
}

export type MirrorCallDropReason =
  | "asr_timeout"
  | "asr_empty"
  | "too_short"
  | "too_long"
  | "audio_unusable"
  | "rate_limited";

export interface MirrorCallWindowResult {
  window_id: string;
  seq: number;
  /** Non-null when the window did NOT become a turn. The spec's no-silent-
   *  truncation clause: a learning loop that dropped its input must not look
   *  identical to a clone with nothing to learn. */
  dropped: { reason: MirrorCallDropReason } | null;
  /** "" when dropped. */
  owner_transcript: string;
  /** `null` when dropped — the clone does not answer nothing
   *  (`clone-initiative-record-has-no-absence`). */
  turn: MirrorCallTurn | null;
  deltas: MirrorCallDelta[];
  fidelity: MirrorCallFidelity | null;
  /** How the consented reference set grew from this window, or null when the
   *  window was not admitted to it. */
  reference: { consented_windows: number; total_seconds: number } | null;
}

export interface MirrorCallSession {
  session_id: string;
  replica_id: string;
  contract: string;
  /** "warming" = the GPU is cold. The studio shows the ~2–3 min honest wait;
   *  it does not show a progress bar over a number nobody measured. */
  state: "warming" | "live";
  gpu: { warm: boolean; estimated_ready_seconds: number | null };
  /** Server's own window cap in ms; clamped against MAX_WINDOW_MS. */
  window_ms_max: number;
  fidelity: MirrorCallFidelity | null;
  /** Ops this deployment actually serves (echoes the handshake). */
  ops: MirrorCallOp[];
}

export interface MirrorCallEnd {
  session_id: string;
  ended_at: string;
  /** Chips nobody actioned. They go to the ordinary review queue — never onto
   *  the sheet (spec §laws, first bullet). */
  deferred: MirrorCallDelta[];
  accepted_count: number;
  rejected_count: number;
  /** The fine-tune is QUEUED at end, never run mid-call. `queued: false` with
   *  a reason is an honest answer; a fake progress bar is not. */
  finetune: { queued: boolean; job_id: string | null; reason: string | null };
  fidelity: MirrorCallFidelity | null;
}

// ── plumbing ───────────────────────────────────────────────────────────────

function url(op: MirrorCallOp, params?: Record<string, string>) {
  const query = new URLSearchParams({ op, ...(params || {}) });
  return `${MIRROR_CALL_ROUTE}?${query}`;
}

async function readError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}) as any);
  const raw = typeof data?.error === "string" ? data.error : fallback;
  return new ReplicaApiError(raw.replaceAll("_", " "), response.status, data);
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Mirror Call ${field} was not a number`);
  }
  return value;
}

export function normalizeFidelity(raw: any, context: string): MirrorCallFidelity | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") throw new Error(`Mirror Call ${context} fidelity was malformed`);
  const windows = raw.windows;
  if (typeof windows !== "number" || !Number.isInteger(windows) || windows < 0) {
    throw new Error(`Mirror Call ${context} fidelity window count was malformed`);
  }
  return {
    family: String(raw.family || ""),
    policy_version: String(raw.policy_version || ""),
    ceiling: nullableNumber(raw.ceiling, "fidelity ceiling"),
    measurement_score: nullableNumber(raw.measurement_score, "measurement score"),
    measurement_confidence: nullableNumber(raw.measurement_confidence, "measurement confidence"),
    p10: nullableNumber(raw.p10, "fidelity p10"),
    windows,
    pooled_seconds: Number.isFinite(raw.pooled_seconds) ? Number(raw.pooled_seconds) : 0,
    conditioning_window_score: nullableNumber(raw.conditioning_window_score, "conditioning window score"),
    conditioning_seconds: nullableNumber(raw.conditioning_seconds, "conditioning seconds"),
    window_selected_at: typeof raw.window_selected_at === "string" ? raw.window_selected_at : null,
    window_selections: Number.isFinite(raw.window_selections) ? Number(raw.window_selections) : 0,
  };
}

/**
 * The client half of "an unaccepted chip is never applied".
 *
 * The server is the authority on what is on the sheet, and this does not
 * second-guess it in the permissive direction — it can only ever make
 * `applied` FALSER. A payload claiming `applied: true` while its own status is
 * anything but `accepted` is self-contradictory, and the safe reading of a
 * contradiction here is "not applied": showing an unapproved delta as landed
 * is the exact failure the spec's ambient-approval law exists to prevent.
 */
export function normalizeDelta(raw: any): MirrorCallDelta {
  const id = typeof raw?.delta_id === "string" ? raw.delta_id : "";
  const status = raw?.status;
  const citation = raw?.citation;
  if (!id) throw new Error("A proposed delta arrived with no id");
  if (status !== "proposed" && status !== "accepted" && status !== "rejected" && status !== "deferred") {
    throw new Error("A proposed delta arrived with an unknown status");
  }
  const evidence = raw?.evidence;
  if (!citation || typeof citation.turn_id !== "string" || typeof citation.quote !== "string") {
    // A chip the owner cannot trace back to something they said is a chip they
    // cannot judge, so it is rejected at the door rather than rendered blank.
    throw new Error("A proposed delta arrived with no citation");
  }
  return {
    delta_id: id,
    kind: (raw.kind || "phrase_habit") as MirrorCallDeltaKind,
    field: String(raw.field || ""),
    proposal: String(raw.proposal || ""),
    citation: {
      turn_id: citation.turn_id,
      quote: citation.quote,
      occurrences: Number.isFinite(citation.occurrences) ? Number(citation.occurrences) : 1,
    },
    evidence: {
      // Falls back to the citation's own count rather than to zero: a chip
      // whose evidence block is missing has been heard at least the number of
      // times its citation says, and rendering "heard 0x" would understate it
      // in the one direction that makes the UI look broken.
      occurrences_this_call: Number.isFinite(evidence?.occurrences_this_call)
        ? Number(evidence.occurrences_this_call)
        : Number.isFinite(citation.occurrences) ? Number(citation.occurrences) : 1,
      occurrences_total: Number.isFinite(evidence?.occurrences_total) ? Number(evidence.occurrences_total) : 0,
      calls: Number.isFinite(evidence?.calls) ? Number(evidence.calls) : 1,
      corpus_words: Number.isFinite(evidence?.corpus_words) ? Number(evidence.corpus_words) : 0,
    },
    status,
    applied: status === "accepted" && raw.applied === true,
    created_at: String(raw.created_at || ""),
  };
}

function normalizeDeltas(raw: any): MirrorCallDelta[] {
  return Array.isArray(raw) ? raw.map(normalizeDelta) : [];
}

// ── ops ────────────────────────────────────────────────────────────────────

/**
 * The deployment handshake. Throws `MirrorCallBackendAbsent` when the route is
 * not there at all, which is the state this UI renders honestly instead of
 * pretending to dial.
 */
export async function probeMirrorCallBackend(token: string): Promise<{ contract: string; ops: MirrorCallOp[] }> {
  let response: Response;
  try {
    response = await fetch(url("contract"), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (cause) {
    // A network-level failure is NOT "the backend is absent" — it is a
    // network failure, and calling it absent would be inventing a cause
    // (`errorCopy.ts`'s rule).
    throw cause;
  }
  if (response.status === 404 || response.status === 501) {
    throw new MirrorCallBackendAbsent(`${MIRROR_CALL_ROUTE} answered ${response.status}`);
  }
  if (!response.ok) throw await readError(response, `mirror call handshake failed (${response.status})`);
  const data = await response.json().catch(() => ({}) as any);
  const ops: MirrorCallOp[] = Array.isArray(data?.ops) ? data.ops : [];
  if (data?.contract !== MIRROR_CALL_CONTRACT) {
    throw new Error(
      `This studio speaks ${MIRROR_CALL_CONTRACT}; the server answered ${String(data?.contract || "nothing")}.`,
    );
  }
  const missing = REQUIRED_OPS.filter((op) => !ops.includes(op));
  if (missing.length) throw new Error(`The Mirror Call backend is missing: ${missing.join(", ")}`);
  return { contract: data.contract, ops };
}

export async function createMirrorCall(token: string, replicaId: string): Promise<MirrorCallSession> {
  const response = await fetch(url("create"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replica_id: replicaId, contract: MIRROR_CALL_CONTRACT }),
    signal: AbortSignal.timeout(45_000),
  });
  if (response.status === 404) throw new MirrorCallBackendAbsent("create answered 404");
  if (!response.ok) throw await readError(response, `mirror call could not start (${response.status})`);
  const data = await response.json().catch(() => ({}) as any);
  const session = data?.session;
  if (!session || typeof session.session_id !== "string" || !session.session_id) {
    throw new Error("The Mirror Call session did not come back with an id");
  }
  const windowMax = Number(session.window_ms_max);
  return {
    session_id: session.session_id,
    replica_id: String(session.replica_id || replicaId),
    contract: String(session.contract || MIRROR_CALL_CONTRACT),
    state: session.state === "live" ? "live" : "warming",
    gpu: {
      warm: session.gpu?.warm === true,
      estimated_ready_seconds: nullableNumber(session.gpu?.estimated_ready_seconds ?? null, "gpu estimate"),
    },
    window_ms_max: Number.isFinite(windowMax) && windowMax > 0 ? Math.min(windowMax, MAX_WINDOW_MS) : MAX_WINDOW_MS,
    fidelity: normalizeFidelity(session.fidelity ?? null, "session"),
    ops: Array.isArray(session.ops) ? session.ops : [...REQUIRED_OPS],
  };
}

/**
 * One ≤30s owner window. Multipart because the payload is audio; every other
 * op on this route is JSON. If WS-X would rather take a signed upload handle
 * (the `enrollmentApi` pattern), that is a change to THIS function and nothing
 * else in the UI.
 */
export async function ingestAudioWindow(token: string, input: {
  sessionId: string;
  seq: number;
  audio: Blob;
  durationMs: number;
  /** The owner's live partial transcript, when the browser produced one. The
   *  server's ASR is authoritative; this is a hint, never a substitute. */
  clientHint?: string;
}): Promise<MirrorCallWindowResult> {
  if (input.durationMs > MAX_WINDOW_MS) {
    // Refused here rather than at the server: a 31-second window is a client
    // bug, and sending it would spend a paid ASR call to be told so.
    throw new Error(`A ${Math.round(input.durationMs / 1000)}s window exceeds the ${MAX_WINDOW_MS / 1000}s cap`);
  }
  const form = new FormData();
  form.append("session_id", input.sessionId);
  form.append("seq", String(input.seq));
  form.append("duration_ms", String(Math.round(input.durationMs)));
  if (input.clientHint) form.append("client_hint", input.clientHint);
  form.append("audio", input.audio, `window-${input.seq}.wav`);
  const response = await fetch(url("ingest_window"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status === 404) throw new MirrorCallBackendAbsent("ingest_window answered 404");
  if (!response.ok) throw await readError(response, `the window could not be sent (${response.status})`);
  const data = await response.json().catch(() => ({}) as any);
  const result = data?.window;
  if (!result || typeof result.window_id !== "string") throw new Error("The window result was malformed");
  const dropped = result.dropped ? { reason: result.dropped.reason as MirrorCallDropReason } : null;
  const turn = result.turn && typeof result.turn.turn_id === "string"
    ? { turn_id: result.turn.turn_id, text: String(result.turn.text || ""), can_voice: result.turn.can_voice === true }
    : null;
  if (dropped && turn) {
    // A dropped window that also produced a reply means the reply was built on
    // something other than what the owner said. That is worse than a drop.
    throw new Error("The server reported a dropped window and a reply for it");
  }
  return {
    window_id: result.window_id,
    seq: Number.isFinite(result.seq) ? Number(result.seq) : input.seq,
    dropped,
    owner_transcript: String(result.owner_transcript || ""),
    turn,
    deltas: normalizeDeltas(result.deltas),
    fidelity: normalizeFidelity(result.fidelity ?? null, "window"),
    reference: result.reference
      ? {
        consented_windows: Number(result.reference.consented_windows) || 0,
        total_seconds: Number(result.reference.total_seconds) || 0,
      }
      : null,
  };
}

/** Is the GPU warm yet. Optional op — see OPTIONAL_OPS. */
export async function getMirrorCallStatus(token: string, sessionId: string): Promise<{
  state: "warming" | "live" | "ended";
  gpu: { warm: boolean; estimated_ready_seconds: number | null };
  fidelity: MirrorCallFidelity | null;
}> {
  const response = await fetch(url("status", { session_id: sessionId }), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404 || response.status === 405 || response.status === 501) {
    throw new MirrorCallBackendAbsent(`status answered ${response.status}`);
  }
  if (!response.ok) throw await readError(response, `the call status failed (${response.status})`);
  const data = await response.json().catch(() => ({}) as any);
  const raw = data?.session || data;
  const state = raw?.state === "live" ? "live" : raw?.state === "ended" ? "ended" : "warming";
  return {
    state,
    gpu: {
      warm: raw?.gpu?.warm === true,
      estimated_ready_seconds: nullableNumber(raw?.gpu?.estimated_ready_seconds ?? null, "gpu estimate"),
    },
    fidelity: normalizeFidelity(raw?.fidelity ?? null, "status"),
  };
}

export async function listMirrorCallDeltas(token: string, sessionId: string): Promise<MirrorCallDelta[]> {
  const response = await fetch(url("deltas", { session_id: sessionId }), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) throw new MirrorCallBackendAbsent("deltas answered 404");
  if (!response.ok) throw await readError(response, `the delta list failed (${response.status})`);
  const data = await response.json().catch(() => ({}) as any);
  return normalizeDeltas(data?.deltas);
}

export async function actionMirrorCallDelta(token: string, input: {
  sessionId: string;
  deltaId: string;
  action: "accept" | "reject";
}): Promise<MirrorCallDelta> {
  const response = await fetch(url("delta_action"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: input.sessionId, delta_id: input.deltaId, action: input.action }),
    signal: AbortSignal.timeout(25_000),
  });
  if (response.status === 404) throw new MirrorCallBackendAbsent("delta_action answered 404");
  if (!response.ok) throw await readError(response, `the delta could not be ${input.action}ed (${response.status})`);
  const data = await response.json().catch(() => ({}) as any);
  const delta = normalizeDelta(data?.delta);
  if (input.action === "reject" && delta.applied) {
    throw new Error("The server reported a rejected delta as applied");
  }
  return delta;
}

/** 👍 / 👎 on a clone turn, with an optional re-recorded "I'd say it like this". */
export async function saveMirrorCallTurnFeedback(token: string, input: {
  sessionId: string;
  turnId: string;
  rating: "up" | "down";
  note?: string;
  correctionAudio?: Blob | null;
  correctionMs?: number;
}): Promise<{ feedback_id: string; deltas: MirrorCallDelta[] }> {
  const form = new FormData();
  form.append("session_id", input.sessionId);
  form.append("turn_id", input.turnId);
  form.append("rating", input.rating);
  if (input.note) form.append("note", input.note);
  if (input.correctionAudio) {
    form.append("correction_audio", input.correctionAudio, `correction-${input.turnId}.wav`);
    form.append("correction_ms", String(Math.round(input.correctionMs || 0)));
  }
  const response = await fetch(url("turn_feedback"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 404) throw new MirrorCallBackendAbsent("turn_feedback answered 404");
  if (!response.ok) throw await readError(response, `the feedback could not be saved (${response.status})`);
  const data = await response.json().catch(() => ({}) as any);
  return { feedback_id: String(data?.feedback_id || ""), deltas: normalizeDeltas(data?.deltas) };
}

/**
 * Clone speech. WS-W owns synthesis (`api/voice-preview.js`); this asks WS-X
 * for the audio of an exact server-issued turn, which keeps the studio unable
 * to make the clone say anything the server did not author — the same rule
 * `dialogueApi.fetchProtectedTurnVoice` already enforces on the text lane.
 *
 * A 404/405 here means the synthesis seam is not wired yet: the caller falls
 * back to captions only and SAYS so. It does not fall back to another voice.
 */
export async function fetchMirrorCallTurnVoice(token: string, input: {
  sessionId: string;
  turnId: string;
}): Promise<Blob> {
  const response = await fetch(url("turn_voice", { session_id: input.sessionId, turn_id: input.turnId }), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(290_000),
  });
  if (response.status === 404 || response.status === 405 || response.status === 501) {
    throw new MirrorCallBackendAbsent(`turn_voice answered ${response.status}`);
  }
  // 202 IS `response.ok`, which is why it is tested BEFORE the ok check rather
  // than inside the error branch. Without this the warming JSON would fall
  // through to the blob check below and surface as "the clone's protected audio
  // was invalid" — an integrity error for a cold start, which is the same class
  // of mislabelling `hmac-skew-shorter-than-cold-start` already cost us once.
  if (response.status === 202) {
    throw new MirrorCallVoiceWarming(await response.json().catch(() => ({}) as any));
  }
  if (!response.ok) throw await readError(response, `the clone's voice could not be fetched (${response.status})`);
  const audio = await response.blob();
  if (audio.type !== "audio/wav" || audio.size < 45) throw new Error("The clone's protected audio was invalid");
  return audio;
}

export async function endMirrorCall(token: string, sessionId: string): Promise<MirrorCallEnd> {
  const response = await fetch(url("end"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 404) throw new MirrorCallBackendAbsent("end answered 404");
  if (!response.ok) throw await readError(response, `the call could not be ended cleanly (${response.status})`);
  const data = await response.json().catch(() => ({}) as any);
  const end = data?.call || data;
  return {
    session_id: String(end?.session_id || sessionId),
    ended_at: String(end?.ended_at || ""),
    deferred: normalizeDeltas(end?.deferred),
    accepted_count: Number(end?.accepted_count) || 0,
    rejected_count: Number(end?.rejected_count) || 0,
    finetune: {
      queued: end?.finetune?.queued === true,
      job_id: typeof end?.finetune?.job_id === "string" ? end.finetune.job_id : null,
      reason: typeof end?.finetune?.reason === "string" ? end.finetune.reason : null,
    },
    fidelity: normalizeFidelity(end?.fidelity ?? null, "end"),
  };
}
