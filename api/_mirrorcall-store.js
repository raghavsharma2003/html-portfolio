// The Mirror Call's database half. WS-X. Contract:
// docs/gurukul/MIRROR-CALL-SPEC.md; tables: db/migrations/059_mirror_call.sql.
//
// Every read and mutation carries `owner_user_id` IN SQL, bound from
// `requireUser()` and never from request JSON — api/_replica.js's rule, and
// the reason a Mirror Call cannot be run against a replica the caller does not
// own is a PREDICATE and not a branch. "Isolation is a SQL predicate, never a
// prompt instruction" (context/STATE.md).
//
// ═════════════════════════════════════════════════════════════════════════
// THE NEGATIVE CONTROL LIVES IN ONE CLAUSE
// ═════════════════════════════════════════════════════════════════════════
//
// `decideMirrorDelta` below is the ONLY function in this repo that can write a
// Mirror Call's mined value onto a TeacherSheet, and the only way its sheet
// write fires is:
//
//     candidate  ...  where d.delta_id = $4::uuid and d.state in ('proposed','deferred')
//     writable   ...  where target_field <> '' and $5 = 'accepted'
//     sheet_*    ...  where exists (select 1 from writable)
//
// Strike `d.state in ('proposed','deferred')` and an already-rejected chip lands on the
// sheet. That is exactly what `evals/mirrorcall.mjs` does, and the suite FAILS
// unless the struck copy writes — which is what proves the clause is doing the
// work rather than being decoration around a mine that was harmless anyway.
//
// The order of the CTEs is load-bearing in the other direction too. The sheet
// write is UPSTREAM of the state flip, not downstream, so a decision whose
// sheet write did not land leaves the delta STILL PROPOSED rather than
// "accepted but silently unapplied". A tap that did nothing must not look like
// a tap that worked (`never-silent-update`).
import { randomUUID } from "node:crypto";
import {
  MIRROR_OWNER_SIMILARITY_FLOOR,
  MIRROR_REFERENCE_SCOPE,
  MIRROR_SESSION_SCOPES,
  MirrorCallError,
  corpusConfidence,
  mirrorUuid,
  mergeDeltaIntoSheet,
  scrubPii,
} from "./_mirrorcall.js";

function fail(code, status = 409, details) {
  throw new MirrorCallError(code, status, details);
}

const SESSION_COLUMNS = `session_id, replica_id, owner_user_id, state, policy_version,
  consent_scopes, reference_consent, started_at, ended_at, updated_at`;

const WINDOW_COLUMNS = `window_id, session_id, replica_id, owner_user_id, seq, source_id,
  duration_ms, lane, asr_state, failure_code, transcript, asr_provider, asr_model,
  reference_admitted, admission_reason, conditioning_ms, own_voice_state,
  owner_similarity, quality_score, score_source, created_at, updated_at`;

const DELTA_COLUMNS = `delta_id, session_id, replica_id, owner_user_id, kind, fragment,
  target_field, origin, occurrences, corpus_tokens, evidence, citation, cited_windows, state,
  applied_at, decided_at, created_at, updated_at`;

/** The two UN-ACTIONED states. 'proposed' is on the live rail; 'deferred' is
 *  what the per-minute chip budget held back for the review queue. Both are
 *  "the owner has not decided", and both are decidable — the budget is a UX
 *  rate limit, never a decision made on the owner's behalf. */
export const MIRROR_UNACTIONED = Object.freeze(["proposed", "deferred"]);

const SELECTION_COLUMNS = `selection_id, replica_id, owner_user_id, window_id, session_id,
  score, conditioning_ms, score_source, selected_at, superseded_at`;

export function clientSession(row) {
  if (!row) return null;
  return {
    session_id: row.session_id,
    replica_id: row.replica_id,
    state: row.state,
    policy_version: row.policy_version,
    consent_scopes: Array.isArray(row.consent_scopes) ? row.consent_scopes : [],
    // Named on the wire so a studio cannot render a fidelity meter that grows
    // without knowing whether anything is allowed to grow it.
    reference_consent: Boolean(row.reference_consent),
    reference_scope: MIRROR_REFERENCE_SCOPE,
    started_at: row.started_at,
    ended_at: row.ended_at ?? null,
  };
}

export function clientWindow(row) {
  if (!row) return null;
  return {
    window_id: row.window_id,
    seq: Number(row.seq),
    duration_ms: Number(row.duration_ms),
    lane: row.lane,
    asr_state: row.asr_state,
    failure_code: row.failure_code || "",
    asr_provider: row.asr_provider || "",
    asr_model: row.asr_model || "",
    // Membership of the CANDIDATE POOL, not of a reference set that conditions
    // anything. Only the selected window conditions synthesis (WS-Z A1).
    reference_admitted: Boolean(row.reference_admitted),
    admission_reason: row.admission_reason,
    conditioning_ms: Number(row.conditioning_ms ?? 0),
    own_voice_state: row.own_voice_state,
    // null, never 0 — nobody measured it is not the same as it measured zero.
    owner_similarity: row.owner_similarity === null || row.owner_similarity === undefined
      ? null : Number(row.owner_similarity),
    quality_score: row.quality_score === null || row.quality_score === undefined
      ? null : Number(row.quality_score),
    score_source: row.score_source || "",
    // The transcript IS returned: it is the owner's own words, on their own
    // authenticated session, and the caption rail is the surface they are
    // reading it on.
    transcript: row.transcript || "",
  };
}

export function clientDelta(row) {
  if (!row) return null;
  return {
    delta_id: row.delta_id,
    kind: row.kind,
    fragment: row.fragment || "",
    target_field: row.target_field || "",
    // '' target means the chip records the owner's judgement and writes no
    // sheet field. Spelled out on the wire rather than left for a studio to
    // infer from an empty string.
    advisory: !row.target_field,
    // Separate columns, never averaged: 'mined' is what the owner DID, and
    // 'judgement' is what they SAID about it. The Mirror Call's sycophancy
    // hazard lives in the gap between them (WS-Z §4.4).
    origin: row.origin,
    query: row.origin === "judgement" ? "label" : "feature",
    // The n, on every chip. A studio that renders the claim without the count
    // is manufacturing confidence the corpus does not support.
    evidence_count: Number(row.occurrences ?? 0),
    corpus_tokens: Number(row.corpus_tokens ?? 0),
    confidence: corpusConfidence(row.corpus_tokens, row.occurrences),
    evidence: row.evidence ?? {},
    cited_windows: Array.isArray(row.cited_windows) ? row.cited_windows.map(Number) : [],
    state: row.state,
    applied: Boolean(row.applied_at),
    decided_at: row.decided_at ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// session lifecycle
// ─────────────────────────────────────────────────────────────────────────

/**
 * Open a Mirror Call, or return the one already open.
 *
 * Consent is read LIVE and frozen onto the row: `consent_scopes` is what was
 * granted at start and `reference_consent` is whether the voice loop may run at
 * all. Both are computed in the same statement that inserts, so there is no
 * window in which a scope could be revoked between the check and the row.
 *
 * Returns null when the replica is not this owner's, does not exist, is revoked,
 * or lacks one of the three session scopes — ONE answer for five situations, the
 * `teacher_sheet_unavailable` discipline: a caller that could tell them apart
 * could enumerate other people's replicas and their consent state.
 */
export async function openMirrorSession(db, ownerUserId, replicaIdValue, options = {}) {
  const rid = mirrorUuid(replicaIdValue, "mirror_replica_id_invalid");
  const sessionId = options.sessionId || randomUUID();
  const rows = await db(
    `with owned as (
       select r.replica_id, r.policy_version from vy_replica r
        where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
          and r.subject_mode = 'self' and r.lifecycle not in ('revoked','purging')
     ), live_scopes as (
       select coalesce(array_agg(distinct c.scope), '{}'::text[]) as scopes
         from vy_replica_consent c join owned o on o.replica_id = c.replica_id
        where c.owner_user_id = $2::uuid and c.policy_version = o.policy_version
          and c.revoked_at is null and (c.expires_at is null or c.expires_at > now())
     ), gate as (
       select o.replica_id, o.policy_version, s.scopes
         from owned o cross join live_scopes s
        where s.scopes @> $3::text[]
     ), inserted as (
       insert into vy_mirror_session
         (session_id, replica_id, owner_user_id, state, policy_version, consent_scopes, reference_consent)
       select $4::uuid, g.replica_id, $2::uuid, 'open', g.policy_version, g.scopes,
              g.scopes @> $5::text[]
         from gate g
       on conflict (replica_id) where state = 'open' do nothing
       returning ${SESSION_COLUMNS}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'mirror_call.start', 'mirror_session', session_id::text,
              policy_version, 'allowed',
              jsonb_build_object('reference_consent', reference_consent,
                                 'consent_scopes', to_jsonb(consent_scopes))
         from inserted
     )
     select * from inserted`,
    [rid, ownerUserId, MIRROR_SESSION_SCOPES, sessionId, [MIRROR_REFERENCE_SCOPE]],
  );
  if (rows[0]) return clientSession(rows[0]);
  // Either the gate refused, or a session is already open. Distinguished by
  // asking — the studio reconnecting after a dropped websocket must RESUME its
  // call, not be told its own replica is unavailable.
  const open = await getOpenMirrorSession(db, ownerUserId, rid);
  return open;
}

export async function getOpenMirrorSession(db, ownerUserId, replicaIdValue, sessionIdValue) {
  const rid = mirrorUuid(replicaIdValue, "mirror_replica_id_invalid");
  const sid = sessionIdValue ? mirrorUuid(sessionIdValue, "mirror_session_id_invalid") : null;
  const rows = await db(
    `select ${SESSION_COLUMNS} from vy_mirror_session s
      where s.replica_id = $1::uuid and s.owner_user_id = $2::uuid and s.state = 'open'
        and ($3::uuid is null or s.session_id = $3::uuid)
        and exists (
          select 1 from vy_replica r
           where r.replica_id = s.replica_id and r.owner_user_id = s.owner_user_id
             and r.lifecycle not in ('revoked','purging')
        )
      order by s.started_at desc limit 1`,
    [rid, ownerUserId, sid],
  );
  return clientSession(rows[0]);
}

export async function getMirrorSession(db, ownerUserId, replicaIdValue, sessionIdValue) {
  const rows = await db(
    `select ${SESSION_COLUMNS} from vy_mirror_session s
      where s.replica_id = $1::uuid and s.owner_user_id = $2::uuid and s.session_id = $3::uuid
      limit 1`,
    [
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
    ],
  );
  return clientSession(rows[0]);
}

// ─────────────────────────────────────────────────────────────────────────
// windows
// ─────────────────────────────────────────────────────────────────────────

/**
 * Record the window BEFORE the ASR call, in state 'pending'.
 *
 * This ordering is the whole honesty mechanism. If the row were written after a
 * successful transcription, a window whose ASR failed, timed out or was
 * abandoned by a dying serverless invocation would leave NO ROW — and a missing
 * row is indistinguishable from a window nobody sent. The chip stream could
 * then be perfectly quiet while the learning loop lost half its input, which is
 * the exact failure the spec names.
 *
 * `admission` is decided here, not at settle time, because it is a CONSENT
 * question and consent was frozen at session start.
 *
 * ── the own-voice predicate (WS-Z A3), and why it fails closed ────────────
 * Admission is `reference_consent AND a stored object AND own_voice_state =
 * 'owner_verified'`, and 'owner_verified' requires a MEASURED ECAPA cosine to
 * the owner's enrolled voice profile clearing `MIRROR_OWNER_SIMILARITY_FLOOR`.
 *
 * Nothing in this repo produces that measurement yet, so today every window is
 * 'unverified' and admission is refused with the scope or the state named. That
 * is the correct direction and not an oversight: the two failures it guards are
 * the clone's own output re-entering its own conditioning pool (recursive
 * training / model collapse) and a second person audible on the owner's side of
 * the call — someone who consented to nothing — entering a biometric pool.
 * Migration 058 states the same rule as a CHECK, so a future statement cannot
 * admit an unverified window even by accident.
 *
 * `cloneOverlap` is the one half of the predicate that IS decidable today: the
 * studio knows when the clone was speaking because it played the audio, and a
 * window it declares as overlapping is refused outright rather than measured.
 * A declaration is weaker than a measurement, so it can only ever REFUSE — it
 * is never what promotes a window to 'owner_verified'.
 */
export async function recordMirrorWindow(db, ownerUserId, replicaIdValue, sessionIdValue, input, options = {}) {
  const rid = mirrorUuid(replicaIdValue, "mirror_replica_id_invalid");
  const sid = mirrorUuid(sessionIdValue, "mirror_session_id_invalid");
  const windowId = options.windowId || randomUUID();
  // A similarity may only arrive from a server-side measurement (see
  // `scoreMirrorWindow`); it is never read off the request body, because a
  // client-supplied "this is me" is the assertion the predicate exists to
  // replace.
  const similarity = options.ownerSimilarity === undefined || options.ownerSimilarity === null
    ? null : Number(options.ownerSimilarity);
  const ownVoice = input.cloneOverlap ? "clone_overlap"
    : similarity === null ? "unverified"
    : similarity >= MIRROR_OWNER_SIMILARITY_FLOOR ? "owner_verified"
    : "foreign_speaker";
  const rows = await db(
    `with sess as (
       select s.session_id, s.replica_id, s.owner_user_id, s.reference_consent
         from vy_mirror_session s
        where s.session_id = $1::uuid and s.replica_id = $2::uuid
          and s.owner_user_id = $3::uuid and s.state = 'open'
     ), stored as (
       select src.source_id from vy_replica_source src
        where src.source_id = $5::uuid and src.replica_id = $2::uuid
          and src.owner_user_id = $3::uuid and src.state = 'quarantined'
     ), admission as (
       select sess.session_id, sess.replica_id, sess.owner_user_id,
              (sess.reference_consent and exists (select 1 from stored)
                 and $9 = 'owner_verified') as admitted,
              case
                when not sess.reference_consent then 'consent_scope_missing:' || $8
                when not exists (select 1 from stored) then 'no_stored_object'
                when $9 = 'clone_overlap' then 'own_voice_clone_overlap'
                when $9 = 'foreign_speaker' then 'own_voice_foreign_speaker'
                when $9 = 'unverified' then 'own_voice_unverified'
                else 'owner_verified_candidate_window'
              end as reason
         from sess
     ), inserted as (
       insert into vy_mirror_window
         (window_id, session_id, replica_id, owner_user_id, seq, source_id, duration_ms,
          lane, asr_state, reference_admitted, admission_reason, conditioning_ms,
          own_voice_state, owner_similarity)
       select $4::uuid, a.session_id, a.replica_id, a.owner_user_id, $6::int,
              (select source_id from stored), $7::int, 'sync', 'pending', a.admitted, a.reason,
              least($7::int, 10000), $9, $10::real
         from admission a
       on conflict (session_id, seq) do nothing
       returning ${WINDOW_COLUMNS}
     )
     select * from inserted`,
    [sid, rid, ownerUserId, windowId, input.sourceId, input.seq, input.durationMs,
      MIRROR_REFERENCE_SCOPE, ownVoice, similarity],
  );
  return rows[0] || null;
}

/**
 * Attach a CONDITIONING SCORE to a window, from a server-side measurement.
 *
 * Callers: `api/mirror-call.js`'s ingest path, which probes the stored WAV
 * bytes it already read for ASR (`score_source = 'wav_probe'`). A
 * voice-evidence-derived scorer would call the same function with
 * `'voice_evidence'` and its own scale — which is exactly why the source is a
 * column and not an assumption.
 *
 * A score never changes admission. Admission is consent plus identity; the
 * score only ranks what was already admitted.
 */
export async function scoreMirrorWindow(db, ownerUserId, replicaIdValue, windowIdValue, score, source) {
  if (source !== "wav_probe" && source !== "voice_evidence") fail("mirror_score_source_invalid", 400);
  const value = Number(score);
  if (!Number.isFinite(value) || value < 0 || value > 1) fail("mirror_score_invalid", 400);
  const rows = await db(
    `update vy_mirror_window w
        set quality_score = $4::real, score_source = $5, updated_at = now()
      where w.window_id = $1::uuid and w.replica_id = $2::uuid and w.owner_user_id = $3::uuid
     returning ${WINDOW_COLUMNS}`,
    [
      mirrorUuid(windowIdValue, "mirror_window_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId, value, source,
    ],
  );
  return rows[0] || null;
}

/**
 * THE VOICE LOOP'S ONE WRITE: install a new conditioning selection, superseding
 * the standing one. (WS-Z A1.)
 *
 * `where $4::real > coalesce(standing.score, -1)` is the whole policy: a
 * selection is replaced only by a STRICTLY better candidate. Equal scores keep
 * the incumbent, because swapping between two equally good ten-second windows
 * would change how the clone sounds for no measured reason — and a voice that
 * moves without a reason is worse than one that does not move.
 */
export async function selectConditioningWindow(db, ownerUserId, replicaIdValue, sessionIdValue, candidate, options = {}) {
  const selectionId = options.selectionId || randomUUID();
  const rows = await db(
    `with owned as (
       select r.replica_id from vy_replica r
        where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
          and r.lifecycle not in ('revoked','purging')
     ), standing as (
       select c.selection_id, c.score from vy_mirror_conditioning c join owned o on o.replica_id = c.replica_id
        where c.owner_user_id = $2::uuid and c.superseded_at is null
     ), better as (
       select o.replica_id from owned o
        where $4::real > coalesce((select score from standing), -1::real)
     ), superseded as (
       update vy_mirror_conditioning c set superseded_at = now()
        where c.selection_id = (select selection_id from standing)
          and exists (select 1 from better)
       returning c.selection_id
     ), inserted as (
       insert into vy_mirror_conditioning
         (selection_id, replica_id, owner_user_id, window_id, session_id, score,
          conditioning_ms, score_source)
       select $7::uuid, b.replica_id, $2::uuid, $3::uuid, $8::uuid, $4::real, $5::int, $6
         from better b
        where not exists (select 1 from standing) or exists (select 1 from superseded)
       returning ${SELECTION_COLUMNS}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'mirror_call.conditioning_select', 'mirror_conditioning',
              selection_id::text,
              (select policy_version from vy_mirror_session where session_id = $8::uuid),
              'allowed',
              jsonb_build_object('window_id', window_id, 'score', score,
                                 'score_source', score_source, 'conditioning_ms', conditioning_ms)
         from inserted
     )
     select * from inserted`,
    [
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
      mirrorUuid(candidate.window_id, "mirror_window_id_invalid"),
      Number(candidate.quality_score),
      Number(candidate.conditioning_ms),
      String(candidate.score_source),
      selectionId,
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
    ],
  );
  return rows[0] || null;
}

/** The standing conditioning selection — what the NEXT clone turn actually
 *  synthesises from. Null means nothing has ever been selected, which today is
 *  the answer for every replica. */
export async function standingConditioning(db, ownerUserId, replicaIdValue) {
  const rows = await db(
    `select ${SELECTION_COLUMNS} from vy_mirror_conditioning c
      where c.replica_id = $1::uuid and c.owner_user_id = $2::uuid and c.superseded_at is null
      limit 1`,
    [mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"), ownerUserId],
  );
  return rows[0] || null;
}

/**
 * The per-owner corpus counter (WS-Z A4).
 *
 * Confidence accumulates ACROSS calls, because one 30-minute Mirror Call yields
 * roughly 1,800–2,300 owner words and every published stylometric floor sits
 * above that. Counted from the transcripts rather than kept as a running total,
 * so a window erased by a DSAR request leaves the count without a second cursor
 * to remember to decrement.
 *
 * `regexp_count` over whitespace is a word count and not a tokenizer — it will
 * not equal `transcriptStats`'s token count exactly, and it is used only for
 * the confidence BAND, which is three named values wide. A number that
 * pretended to more precision than this would be inviting a percentage.
 */
export async function mirrorCorpusTokens(db, ownerUserId, replicaIdValue) {
  const rows = await db(
    `select coalesce(sum(array_length(regexp_split_to_array(trim(w.transcript), '\\s+'), 1)), 0)::int as tokens,
            count(*)::int as windows
       from vy_mirror_window w
      where w.replica_id = $1::uuid and w.owner_user_id = $2::uuid
        and w.asr_state = 'transcribed' and trim(w.transcript) <> ''`,
    [mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"), ownerUserId],
  );
  return { tokens: Number(rows[0]?.tokens ?? 0), windows: Number(rows[0]?.windows ?? 0) };
}

/**
 * Settle a window: transcribed, or dropped with a reason.
 *
 * There is no third call. A caller that reached `recordMirrorWindow` and did
 * not reach this leaves a 'pending' row, which `mirrorCoverage` counts as
 * pending milliseconds and reports as incomplete — so even a crashed
 * invocation degrades into a visible gap rather than an invisible one.
 */
export async function settleMirrorWindow(db, ownerUserId, replicaIdValue, windowIdValue, result) {
  const transcribed = Boolean(result?.transcript);
  const rows = await db(
    `update vy_mirror_window w
        set asr_state = $4, transcript = $5, asr_provider = $6, asr_model = $7,
            failure_code = $8, updated_at = now()
      where w.window_id = $1::uuid and w.replica_id = $2::uuid and w.owner_user_id = $3::uuid
        and w.asr_state = 'pending'
        and exists (select 1 from vy_mirror_session s
                     where s.session_id = w.session_id and s.state = 'open')
     returning ${WINDOW_COLUMNS}`,
    [
      mirrorUuid(windowIdValue, "mirror_window_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
      transcribed ? "transcribed" : "dropped",
      // THE SCRUB HAPPENS HERE, at the one seam every transcript passes
      // through on its way to a column (WS-Z A4). Not at the ASR provider,
      // which would put it in every provider; not at the mine, which would
      // store the unscrubbed string. A phone number said aloud never reaches
      // the database at all.
      transcribed ? scrubPii(String(result.transcript)) : "",
      transcribed ? String(result.provider || "") : "",
      transcribed ? String(result.model || "") : "",
      // Never '' on a drop — migration 058's CHECK refuses a reasonless drop,
      // so a caller that forgot the code gets a 23514 rather than a silent gap.
      transcribed ? "" : String(result?.failureCode || "asr_unavailable"),
    ],
  );
  return rows[0] || null;
}

export async function listMirrorWindows(db, ownerUserId, replicaIdValue, sessionIdValue) {
  return db(
    `select ${WINDOW_COLUMNS} from vy_mirror_window w
      where w.session_id = $1::uuid and w.replica_id = $2::uuid and w.owner_user_id = $3::uuid
      order by w.seq asc limit 2000`,
    [
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
    ],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// deltas
// ─────────────────────────────────────────────────────────────────────────

export async function listMirrorDeltas(db, ownerUserId, replicaIdValue, sessionIdValue) {
  return db(
    `select ${DELTA_COLUMNS} from vy_mirror_delta d
      where d.session_id = $1::uuid and d.replica_id = $2::uuid and d.owner_user_id = $3::uuid
      order by d.created_at asc, d.delta_id asc limit 500`,
    [
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
    ],
  );
}

/**
 * Propose one mined delta, or refresh a still-proposed one's evidence.
 *
 * `where vy_mirror_delta.state = 'proposed'` on the conflict path is the second
 * half of the never-silent-update law: re-mining must never resurrect a chip
 * the owner already rejected, and must never rewrite the evidence under a chip
 * they already accepted (the evidence is what they accepted ON).
 *
 * One row per call rather than a multi-row insert: the mine emits a handful of
 * deltas per window, the statement is small, and a per-row call means one
 * failing delta cannot take the rest of the chip stream down with it.
 */
export async function proposeMirrorDelta(db, ownerUserId, replicaIdValue, sessionIdValue, delta, options = {}) {
  const deltaId = options.deltaId || randomUUID();
  const rows = await db(
    `with sess as (
       select s.session_id, s.replica_id, s.owner_user_id from vy_mirror_session s
        where s.session_id = $1::uuid and s.replica_id = $2::uuid
          and s.owner_user_id = $3::uuid and s.state = 'open'
     ), upserted as (
       insert into vy_mirror_delta
         (delta_id, session_id, replica_id, owner_user_id, kind, fragment, target_field,
          origin, occurrences, corpus_tokens, evidence, citation, cited_windows, state)
       select $4::uuid, sess.session_id, sess.replica_id, sess.owner_user_id,
              $5, $6, $7, $10, $11::int, $12::int, $8::jsonb, $13::jsonb, $9::int[], $14
         from sess
       on conflict (session_id, kind, fragment) do update
          set evidence = excluded.evidence, cited_windows = excluded.cited_windows,
              citation = excluded.citation,
              occurrences = excluded.occurrences, corpus_tokens = excluded.corpus_tokens,
              updated_at = now()
        where vy_mirror_delta.state in ('proposed','deferred')
       returning ${DELTA_COLUMNS}
     )
     select * from upserted`,
    [
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
      deltaId,
      delta.kind,
      delta.fragment,
      delta.targetField,
      JSON.stringify(delta.evidence ?? {}),
      delta.citedWindows ?? [],
      delta.origin ?? "mined",
      Number(delta.occurrences ?? 0),
      // The CROSS-CALL corpus, when the caller supplies one. Confidence
      // accumulates across calls; a per-call count would make the tenth call's
      // chip look exactly as thin as the first call's.
      Number(delta.corpusTokens ?? 0),
      JSON.stringify(delta.citation ?? {}),
      // 'proposed' goes on the live rail; 'deferred' is a chip the per-minute
      // budget held back. Both are UN-ACTIONED and both are decidable — the
      // budget rate-limits the RAIL, it does not decide anything for the owner.
      delta.state === "deferred" ? "deferred" : "proposed",
    ],
  );
  return rows[0] || null;
}

/** The still-proposed delta a decision is about to act on. Read before the
 *  write because the merge needs its `target_field` and `fragment`, and read
 *  through the same `state = 'proposed'` predicate the write re-asserts — two
 *  copies of one clause, the `_teachersheet.js` discipline: the read catches a
 *  studio acting on a stale rail, the write catches a race. */
export async function getProposedMirrorDelta(db, ownerUserId, replicaIdValue, sessionIdValue, deltaIdValue) {
  const rows = await db(
    `select ${DELTA_COLUMNS} from vy_mirror_delta d
      where d.delta_id = $1::uuid and d.session_id = $2::uuid
        and d.replica_id = $3::uuid and d.owner_user_id = $4::uuid
        and d.state in ('proposed','deferred')
      limit 1`,
    [
      mirrorUuid(deltaIdValue, "mirror_delta_id_invalid"),
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
    ],
  );
  return rows[0] || null;
}

/**
 * The consented private object behind one window, as an `asrInput` ref.
 *
 * `state = 'quarantined'` is the finalized-and-verified state
 * (`finalizeOwnedSource`), so a source whose upload never completed cannot be
 * sent to a transcriber. The path is read from the COLUMN rather than rebuilt
 * from `privateObjectPath`, because the column is what storage actually holds
 * and a recomputed path that drifts would read someone else's object or none.
 */
export async function mirrorWindowAudioRef(db, ownerUserId, replicaIdValue, sourceIdValue) {
  const rows = await db(
    `select s.object_path, s.sha256, s.mime, s.byte_size from vy_replica_source s
      where s.source_id = $1::uuid and s.replica_id = $2::uuid and s.owner_user_id = $3::uuid
        and s.kind = 'audio' and s.state = 'quarantined' limit 1`,
    [
      mirrorUuid(sourceIdValue, "mirror_window_source_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
    ],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    storagePath: row.object_path,
    sha256: row.sha256,
    mime: row.mime,
    byteSize: Number(row.byte_size),
  };
}

/**
 * The standing fidelity row, for the live meter.
 *
 * Read, never computed here: `api/_fidelity.js` owns the math and
 * `services/voice-evidence` owns the embeddings. The meter shows a number that
 * was measured by that chain or it shows nothing — a meter that interpolated
 * between calls would be an animation, not a measurement.
 */
export async function standingMirrorFidelity(db, ownerUserId, replicaIdValue) {
  const rows = await db(
    `select f.status, f.score, f.policy_version, f.computed_at, f.superseded_at
       from vy_voice_fidelity f
      where f.replica_id = $1::uuid and f.owner_user_id = $2::uuid and f.superseded_at is null
      order by f.computed_at desc limit 1`,
    [mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"), ownerUserId],
  );
  return rows[0] || null;
}

/** The newest NON-PUBLISHED sheet row for this owner's replica — the same row
 *  the write below targets, read through the same predicate. Reading the
 *  newest row of ANY status (which is what `_teacher-sheet-draft.js`'s
 *  `currentRow` does, correctly, for its own screen) would hand this function a
 *  published body to merge into and a sheet_id the write would then refuse. */
export async function currentMirrorDraft(db, ownerUserId, replicaIdValue) {
  const rows = await db(
    `select s.sheet_id, s.agent_id, s.sheet, s.status, s.version
       from vy_teacher_sheet s
       join vy_replica r on r.agent_id = s.agent_id
      where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid and s.status <> 'published'
      order by s.created_at desc limit 1`,
    [mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"), ownerUserId],
  );
  const row = rows[0];
  if (!row) return { sheetId: null, sheet: {}, version: "" };
  const sheet = typeof row.sheet === "string" ? JSON.parse(row.sheet) : (row.sheet ?? {});
  return { sheetId: row.sheet_id, sheet, version: row.version ?? "" };
}

/**
 * THE ONE WRITE. See this file's header for the negative control.
 *
 * @param decision "accepted" | "rejected" — already normalised by
 *        `mirrorDecision`, so an arbitrary string cannot reach the column.
 */
export async function decideMirrorDelta(db, ownerUserId, replicaIdValue, sessionIdValue, deltaIdValue, decision, options = {}) {
  const rid = mirrorUuid(replicaIdValue, "mirror_replica_id_invalid");
  const sid = mirrorUuid(sessionIdValue, "mirror_session_id_invalid");
  const did = mirrorUuid(deltaIdValue, "mirror_delta_id_invalid");
  if (decision !== "accepted" && decision !== "rejected") fail("mirror_decision_invalid", 400);

  // The merged body is computed OUTSIDE the statement, from the draft read
  // immediately before it, and the read's sheet_id is passed back in as a
  // compare-and-set. If the draft moved between read and write the update
  // matches zero rows, the delta stays 'proposed', and the caller reports
  // `mirror_delta_apply_conflict` — a retryable, nameable state rather than a
  // clobbered sheet.
  const draft = await currentMirrorDraft(db, ownerUserId, rid);
  const pending = options.pendingDelta ?? null;
  let mergedJson = null;
  if (decision === "accepted" && pending?.target_field) {
    const merged = mergeDeltaIntoSheet(draft.sheet, pending);
    // `null` means the merge is a no-op — the fragment is already on the sheet,
    // or the field is at its ceiling. Writing an identical body and calling it
    // an update would report work that did not happen, so the write is skipped
    // and the response says `applied:false, reason:"no_change"`.
    mergedJson = merged ? JSON.stringify(merged) : null;
  }

  const rows = await db(
    `with owned as (
       select r.replica_id, r.agent_id from vy_replica r
        where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
          and r.lifecycle not in ('revoked','purging')
     ), sess as (
       select s.session_id from vy_mirror_session s join owned o on o.replica_id = s.replica_id
        where s.session_id = $3::uuid and s.owner_user_id = $2::uuid and s.state = 'open'
     ), candidate as (
       select d.delta_id, d.target_field from vy_mirror_delta d
        join sess on sess.session_id = d.session_id
        where d.delta_id = $4::uuid and d.state in ('proposed','deferred')
     ), writable as (
       select c.delta_id from candidate c
        where c.target_field <> '' and $5 = 'accepted' and $6::jsonb is not null
     ), existing_sheet as (
       select s.sheet_id from vy_teacher_sheet s join owned o on o.agent_id = s.agent_id
        where s.status <> 'published' order by s.created_at desc limit 1
     ), sheet_updated as (
       update vy_teacher_sheet s
          set sheet = $6::jsonb, status = 'draft', updated_at = now()
         from existing_sheet e
        where s.sheet_id = e.sheet_id and s.sheet_id = $7::uuid and s.status <> 'published'
          and exists (select 1 from writable)
       returning s.sheet_id
     ), sheet_inserted as (
       insert into vy_teacher_sheet (sheet_id, agent_id, version, sheet, status)
       select $8::uuid, o.agent_id, '', $6::jsonb, 'draft' from owned o
        where $7::uuid is null and not exists (select 1 from existing_sheet)
          and exists (select 1 from writable)
       returning sheet_id
     ), landed as (
       select sheet_id from sheet_updated union all select sheet_id from sheet_inserted
     ), decided as (
       update vy_mirror_delta d
          set state = $5, decided_at = now(), updated_at = now(),
              applied_at = case when exists (select 1 from landed) then now() else d.applied_at end
         from candidate c
        where d.delta_id = c.delta_id and d.state in ('proposed','deferred')
          and (not exists (select 1 from writable) or exists (select 1 from landed))
       returning ${DELTA_COLUMNS}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1::uuid, $2::uuid, 'mirror_call.delta_decide', 'mirror_delta', delta_id::text,
              (select policy_version from vy_mirror_session where session_id = $3::uuid),
              case when state = 'accepted' then 'allowed' else 'denied' end,
              jsonb_build_object('kind', kind, 'target_field', target_field,
                                 'applied', applied_at is not null,
                                 'cited_windows', to_jsonb(cited_windows))
         from decided
     )
     select * from decided`,
    [rid, ownerUserId, sid, did, decision, mergedJson, draft.sheetId, randomUUID()],
  );
  return { row: rows[0] || null, sheetMerged: mergedJson !== null, draftSheetId: draft.sheetId };
}

// ─────────────────────────────────────────────────────────────────────────
// feedback
// ─────────────────────────────────────────────────────────────────────────

/**
 * Record explicit owner feedback, bound to the clone turn it judged.
 *
 * The feedback row is EVIDENCE. It does not become a sheet edit here and it
 * never becomes one directly: a whole sentence the owner typed is the most
 * recitable thing that could enter a prompt (`recited-prompt`), so "I'd say it
 * like this" enters the sheet only by being spoken in a later window and mined
 * as a ≤3-word fragment like everything else. What it does produce immediately
 * is an ADVISORY chip, so the owner can see their own correction land in the
 * rail rather than disappear into a table.
 */
export async function recordMirrorFeedback(db, ownerUserId, replicaIdValue, sessionIdValue, input, options = {}) {
  const feedbackId = options.feedbackId || randomUUID();
  const rows = await db(
    `with sess as (
       select s.session_id, s.replica_id, s.owner_user_id from vy_mirror_session s
        where s.session_id = $1::uuid and s.replica_id = $2::uuid
          and s.owner_user_id = $3::uuid and s.state = 'open'
     ), inserted as (
       insert into vy_mirror_feedback
         (feedback_id, session_id, replica_id, owner_user_id, turn_ref, verdict, rephrase_text)
       select $4::uuid, sess.session_id, sess.replica_id, sess.owner_user_id, $5, $6, $7
         from sess
       on conflict (session_id, turn_ref) do update
          set verdict = excluded.verdict, rephrase_text = excluded.rephrase_text
       returning feedback_id, session_id, turn_ref, verdict, rephrase_text, created_at
     )
     select * from inserted`,
    [
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
      feedbackId,
      input.turnRef,
      input.verdict,
      input.rephraseText,
    ],
  );
  return rows[0] || null;
}

export async function listMirrorFeedback(db, ownerUserId, replicaIdValue, sessionIdValue) {
  return db(
    `select feedback_id, turn_ref, verdict, rephrase_text, created_at
       from vy_mirror_feedback f
      where f.session_id = $1::uuid and f.replica_id = $2::uuid and f.owner_user_id = $3::uuid
      order by f.created_at asc limit 500`,
    [
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
    ],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// end of call
// ─────────────────────────────────────────────────────────────────────────

/**
 * End the call: flip the session, trigger re-embedding, queue the fine-tune.
 *
 * Three things happen and each is honest about what it is:
 *
 *  1. RE-EMBEDDING is a real trigger against a real worker. It inserts
 *     `voice_quality` rows into `vy_replica_processing_job` — the queue
 *     `api/_replica-processing/worker.js` already leases and
 *     `providers/azure-voice-evidence.js` already serves. This is the pipeline
 *     that measured 71 s -> 4 windows -> 8 embeddings in 4 977 ms warm. It is
 *     inserted for ADMITTED windows only, which today is none of them.
 *
 *  2. THE FINE-TUNE IS A QUEUE ROW AND NOTHING RUNS IT. There is no lease, no
 *     attempt counter and no worker in this repo. The row means "the owner
 *     asked and nothing has happened yet"; anything else would be the fake
 *     progress bar the spec forbids by name.
 *
 *  3. UN-ACTIONED CHIPS ARE NOT APPLIED. They stay 'proposed' and are left for
 *     the ordinary review queue — the spec's own words. Nothing here sweeps
 *     them into the sheet, and that absence is the point.
 */
export async function endMirrorSession(db, ownerUserId, replicaIdValue, sessionIdValue, options = {}) {
  const jobId = options.jobId || randomUUID();
  const rows = await db(
    `with sess as (
       update vy_mirror_session s
          set state = 'ended', ended_at = now(), updated_at = now()
        where s.session_id = $1::uuid and s.replica_id = $2::uuid
          and s.owner_user_id = $3::uuid and s.state = 'open'
       returning s.session_id, s.replica_id, s.owner_user_id, s.policy_version
     ), admitted as (
       select w.source_id, w.duration_ms from vy_mirror_window w
        join sess on sess.session_id = w.session_id
        where w.reference_admitted and w.source_id is not null
     ), reembed as (
       insert into vy_replica_processing_job
         (replica_id, owner_user_id, source_id, step, state)
       select sess.replica_id, sess.owner_user_id, a.source_id, 'voice_quality', 'queued'
         from sess cross join admitted a
       on conflict (source_id, step, revision) do nothing
       returning job_id
     ), finetune as (
       insert into vy_mirror_finetune_job
         (job_id, session_id, replica_id, owner_user_id, state, reference_windows, reference_ms)
       select $4::uuid, sess.session_id, sess.replica_id, sess.owner_user_id, 'queued',
              (select count(*)::int from admitted),
              (select coalesce(sum(a.duration_ms), 0)::int from admitted a)
         from sess where exists (select 1 from admitted)
       on conflict (session_id) do nothing
       returning job_id, reference_windows, reference_ms
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $2::uuid, $3::uuid, 'mirror_call.end', 'mirror_session', sess.session_id::text,
              sess.policy_version, 'allowed',
              jsonb_build_object('reembedding_jobs', (select count(*) from reembed),
                                 'finetune_queued', exists (select 1 from finetune))
         from sess
     )
     select sess.session_id,
            (select count(*)::int from reembed) as reembedding_jobs,
            (select job_id from finetune) as finetune_job_id,
            (select reference_windows from finetune) as finetune_reference_windows,
            (select reference_ms from finetune) as finetune_reference_ms
       from sess`,
    [
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
      jobId,
    ],
  );
  return rows[0] || null;
}

/** The reference-set baseline this call grew from: every window any ENDED
 *  Mirror Call admitted for this replica. Counted rather than stored, so a row
 *  deleted by erasure disappears from the baseline without a second cursor to
 *  keep in step. */
export async function mirrorReferenceBaseline(db, ownerUserId, replicaIdValue, sessionIdValue) {
  const rows = await db(
    `select count(*)::int as windows, coalesce(sum(w.duration_ms), 0)::int as ms
       from vy_mirror_window w
      where w.replica_id = $1::uuid and w.owner_user_id = $2::uuid
        and w.reference_admitted and w.session_id <> $3::uuid`,
    [
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
    ],
  );
  return { windows: Number(rows[0]?.windows ?? 0), ms: Number(rows[0]?.ms ?? 0) };
}

// ─────────────────────────────────────────────────────────────────────────
// the wire's session-first addressing
// ─────────────────────────────────────────────────────────────────────────
//
// `mirror-call/v1` sends `replica_id` on `create` and NOTHING but `session_id`
// afterwards, which is the right shape for a client: a call is one thing and
// re-sending its replica on every window is one more field to get wrong.
//
// The server must therefore resolve the replica FROM the session — and it does
// it owner-scoped, in SQL. That is the whole security property: the session id
// is a handle in the client's hands, so it is never trusted to name a replica.
// `owner_user_id = $2::uuid` is what makes another owner's session id return
// zero rows instead of somebody else's clone.

/** Resolve a session the CALLER OWNS. Null for "no such session", "not yours"
 *  and "the replica is gone" alike — one answer, the `teacher_sheet_unavailable`
 *  discipline, so a session id cannot be used as an existence oracle. */
export async function resolveMirrorSession(db, ownerUserId, sessionIdValue) {
  const rows = await db(
    `select ${SESSION_COLUMNS} from vy_mirror_session s
      where s.session_id = $1::uuid and s.owner_user_id = $2::uuid
        and exists (
          select 1 from vy_replica r
           where r.replica_id = s.replica_id and r.owner_user_id = s.owner_user_id
             and r.lifecycle not in ('revoked','purging')
        )
      limit 1`,
    [mirrorUuid(sessionIdValue, "mirror_session_id_invalid"), ownerUserId],
  );
  return rows[0] || null;
}

/** How many times a better conditioning window has been chosen during this
 *  call. The studio renders it beside "unchanged means the clone's voice
 *  cannot have changed", which is only true if this counts SELECTIONS and not
 *  candidates. */
export async function mirrorSelectionCount(db, ownerUserId, replicaIdValue, sessionIdValue) {
  const rows = await db(
    `select count(*)::int as n from vy_mirror_conditioning c
      where c.replica_id = $1::uuid and c.owner_user_id = $2::uuid and c.session_id = $3::uuid`,
    [
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
    ],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Accepted / rejected / un-actioned tallies for the end-of-call summary.
 *  Counted in SQL rather than by filtering a page of deltas in JS: the list
 *  read is capped at 500 rows and a tally computed off a capped page would
 *  silently under-report a long call. */
export async function mirrorDeltaTally(db, ownerUserId, replicaIdValue, sessionIdValue) {
  const rows = await db(
    `select count(*) filter (where d.state = 'accepted')::int as accepted,
            count(*) filter (where d.state = 'rejected')::int as rejected,
            count(*) filter (where d.state in ('proposed','deferred'))::int as unactioned,
            count(*) filter (where d.applied_at is not null)::int as applied
       from vy_mirror_delta d
      where d.session_id = $1::uuid and d.replica_id = $2::uuid and d.owner_user_id = $3::uuid`,
    [
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
    ],
  );
  const row = rows[0] || {};
  return {
    accepted: Number(row.accepted ?? 0),
    rejected: Number(row.rejected ?? 0),
    unactioned: Number(row.unactioned ?? 0),
    applied: Number(row.applied ?? 0),
  };
}

/** Every chip the owner did not action, for the end-of-call handover to the
 *  ordinary review queue. The spec: "Un-actioned chips at call end go to the
 *  ordinary review queue, not onto the sheet." Nothing here writes anything —
 *  this is a READ, and that is the point. */
export async function listUnactionedMirrorDeltas(db, ownerUserId, replicaIdValue, sessionIdValue) {
  return db(
    `select ${DELTA_COLUMNS} from vy_mirror_delta d
      where d.session_id = $1::uuid and d.replica_id = $2::uuid and d.owner_user_id = $3::uuid
        and d.state in ('proposed','deferred')
      order by d.occurrences desc, d.created_at asc limit 200`,
    [
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
    ],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// turns — the clone's own half of the call (WS-AC, migration 060)
// ─────────────────────────────────────────────────────────────────────────
//
// Every statement below carries `owner_user_id` in the WHERE clause, bound
// from `requireUser()`. There is no read here a non-owner can reach and no
// write a non-owner can cause, and both are predicates rather than branches —
// the file header's rule, unchanged.

const TURN_COLUMNS = `turn_id, session_id, window_id, replica_id, owner_user_id, seq, text,
  assembled_chars, sheet_id, sheet_source, agent_slug, gate_applied, gate_findings,
  generation_id, voice_state, voice_failure_code, created_at, updated_at`;

export function clientTurn(row) {
  if (!row) return null;
  return {
    turn_id: row.turn_id,
    window_id: row.window_id,
    seq: Number(row.seq),
    text: String(row.text || ""),
    assembled_chars: Number(row.assembled_chars ?? 0),
    sheet_id: row.sheet_id ?? null,
    // WHICH PERSONA ANSWERED. Never omitted and never defaulted: an owner who
    // cannot tell a published clone from a draft one cannot judge either.
    sheet_source: row.sheet_source,
    agent_slug: row.agent_slug || "",
    gate_applied: Boolean(row.gate_applied),
    gate_findings: Number(row.gate_findings ?? 0),
    generation_id: row.generation_id ?? null,
    voice_state: row.voice_state,
    voice_failure_code: row.voice_failure_code || "",
    created_at: row.created_at,
  };
}

/**
 * The sheet the clone answers FROM.
 *
 * ONE read, owner-scoped in the predicate, that prefers a published+consented
 * row and otherwise takes the newest non-revoked draft. The ordering IS the
 * policy, and it is deliberately in SQL rather than in two queries with a
 * branch between them: two queries is two chances for the second to be run
 * without the first's owner clause.
 *
 * `s.status <> 'revoked'` is not decoration. A revoked sheet is a persona whose
 * subject withdrew consent, and `safety-floor-teacher.md` §2.2's rule is that
 * revocation DEREGISTERS the module. Falling back to it because it happened to
 * be the newest row would be the withdrawal quietly failing to take effect — on
 * the owner's own cloned voice, which is the one place nobody would notice.
 */
export async function mirrorReplyAgent(db, ownerUserId, replicaIdValue) {
  const rows = await db(
    `select s.sheet_id, s.agent_id, s.version, s.sheet, s.status, s.consent_artifact_id,
            s.published_at, s.created_at, a.slug
       from vy_teacher_sheet s
       join vy_replica r on r.agent_id = s.agent_id
       join vy_agent a on a.agent_id = s.agent_id
      where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
        and r.subject_mode = 'self' and r.lifecycle not in ('revoked','purging')
        and s.status <> 'revoked'
      order by (s.status = 'published' and s.consent_artifact_id is not null) desc,
               s.published_at desc nulls last, s.created_at desc
      limit 1`,
    [mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"), ownerUserId],
  );
  return rows[0] || null;
}

/**
 * The DRAFT voice genome version this replica's synthesis conditions on.
 *
 * `beginOwnedVoicePreview` takes `genome_version` as an argument and the studio
 * panel gets it from its own screen state; a Mirror Call has no such screen, so
 * it is resolved HERE and never accepted from the client. Same rule as the text
 * lane: a caller may not choose which version of the owner's voice speaks any
 * more than it may choose the words.
 *
 * Absent is a NAMED answer, never a default of 1 — a guessed version would
 * either authorize nothing or, worse, authorize the wrong thing.
 */
export async function mirrorDraftGenomeVersion(db, ownerUserId, replicaIdValue) {
  const rows = await db(
    `select vg.version from vy_replica_voice_genome vg
       join vy_replica r on r.replica_id = vg.replica_id and r.owner_user_id = $2::uuid
      where vg.replica_id = $1::uuid and vg.status = 'draft'
        and r.subject_mode = 'self' and r.lifecycle not in ('revoked','purging')
      order by vg.version desc
      limit 1`,
    [mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"), ownerUserId],
  );
  const version = Number(rows[0]?.version);
  return Number.isInteger(version) && version >= 1 ? version : null;
}

/**
 * Record the clone's turn for a window.
 *
 * `on conflict (window_id) do nothing` plus the re-read is the idempotency the
 * cascade needs: an ingest whose response never reached the browser is retried
 * with the same seq, and the second attempt must return the SAME turn_id rather
 * than a second clone turn for one thing the owner said. Returning the existing
 * row rather than a new one is what makes a retry a retry.
 *
 * The insert selects from an `allowed` CTE, so the window, the session and the
 * replica are all re-proven to belong to this owner IN SQL. A turn row whose
 * window belongs to somebody else is the shape that would let one owner's call
 * put words in another owner's clone.
 */
export async function recordMirrorTurn(db, ownerUserId, replicaIdValue, sessionIdValue, input) {
  const rid = mirrorUuid(replicaIdValue, "mirror_replica_id_invalid");
  const sid = mirrorUuid(sessionIdValue, "mirror_session_id_invalid");
  const wid = mirrorUuid(input?.windowId, "mirror_window_id_invalid");
  const text = String(input?.text || "").trim();
  if (!text) fail("mirror_turn_text_required", 400);
  const source = input?.sheetSource === "published" ? "published" : "draft";
  const rows = await db(
    `with allowed as (
       select w.window_id, w.seq, s.session_id
         from vy_mirror_window w
         join vy_mirror_session s on s.session_id = w.session_id
        where w.window_id = $3::uuid and w.session_id = $2::uuid
          and w.replica_id = $1::uuid and w.owner_user_id = $9::uuid
          and s.replica_id = $1::uuid and s.owner_user_id = $9::uuid
          and s.state = 'open'
          and w.asr_state = 'transcribed'
     ), inserted as (
       insert into vy_mirror_turn
         (session_id, window_id, replica_id, owner_user_id, seq, text, assembled_chars,
          sheet_id, sheet_source, agent_slug, gate_applied, gate_findings)
       select a.session_id, a.window_id, $1::uuid, $9::uuid, a.seq, $4::text, $5::int4,
              $6::uuid, $7::text, $8::text, $10::boolean, $11::int4
         from allowed a
       on conflict (window_id) do nothing
       returning ${TURN_COLUMNS}
     )
     select * from inserted`,
    [
      rid, sid, wid, text,
      Number(input?.assembledChars ?? text.length) || text.length,
      input?.sheetId ? mirrorUuid(input.sheetId, "mirror_sheet_id_invalid") : null,
      source,
      String(input?.agentSlug || "").slice(0, 64),
      ownerUserId,
      Boolean(input?.gateApplied),
      Number(input?.gateFindings ?? 0) || 0,
    ],
  );
  if (rows[0]) return clientTurn(rows[0]);
  // Either the window was not this owner's, or a turn already exists for it.
  // Distinguished by asking, and an existing turn is the RETRY case rather than
  // an error — the whole reason the conflict clause is `do nothing`.
  return getMirrorTurnByWindow(db, ownerUserId, rid, sid, wid);
}

export async function getMirrorTurnByWindow(db, ownerUserId, replicaIdValue, sessionIdValue, windowIdValue) {
  const rows = await db(
    `select ${TURN_COLUMNS} from vy_mirror_turn t
      where t.window_id = $3::uuid and t.session_id = $2::uuid
        and t.replica_id = $1::uuid and t.owner_user_id = $4::uuid
      limit 1`,
    [
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(windowIdValue, "mirror_window_id_invalid"),
      ownerUserId,
    ],
  );
  return clientTurn(rows[0]);
}

/**
 * THE SYNTHESIS BINDING READ.
 *
 * `api/mirror-call.js`'s `turn_voice` gets its TEXT from this row and from
 * nowhere else. The `turn_id` in the query string SELECTS a row; it never
 * supplies one. That is the invariant `src/studio/mirrorCallApi.ts` names —
 * "keeps the studio unable to make the clone say anything the server did not
 * author" — expressed as the absence of any other source for the string.
 */
export async function getMirrorTurn(db, ownerUserId, sessionIdValue, turnIdValue) {
  const rows = await db(
    `select ${TURN_COLUMNS} from vy_mirror_turn t
      where t.turn_id = $2::uuid and t.session_id = $1::uuid and t.owner_user_id = $3::uuid
        and exists (
          select 1 from vy_replica r
           where r.replica_id = t.replica_id and r.owner_user_id = t.owner_user_id
             and r.lifecycle not in ('revoked','purging')
        )
      limit 1`,
    [
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(turnIdValue, "mirror_turn_id_invalid"),
      ownerUserId,
    ],
  );
  return clientTurn(rows[0]);
}

/**
 * What happened when the clone tried to speak.
 *
 * Written for EVERY outcome including the warming one, so "the owner clicked
 * and heard nothing" is a row an operator can read rather than a report nobody
 * can reproduce. `voice_state='spoken'` cannot be written without a generation
 * id — migration 060's CHECK, not this function's `and` — so a claim that a
 * protected clip was delivered is always backed by the ledger row that carries
 * its watermark token hash.
 */
export async function noteMirrorTurnVoice(db, ownerUserId, sessionIdValue, turnIdValue, outcome) {
  const state = ["unspoken", "warming", "spoken", "refused"].includes(outcome?.state)
    ? outcome.state
    : "refused";
  const rows = await db(
    `update vy_mirror_turn t
        set voice_state = $4::text,
            voice_failure_code = $5::text,
            generation_id = coalesce($6::uuid, t.generation_id),
            updated_at = now()
      where t.turn_id = $2::uuid and t.session_id = $1::uuid and t.owner_user_id = $3::uuid
      returning ${TURN_COLUMNS}`,
    [
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(turnIdValue, "mirror_turn_id_invalid"),
      ownerUserId,
      state,
      String(outcome?.failureCode || "").slice(0, 64),
      outcome?.generationId ? mirrorUuid(outcome.generationId, "mirror_generation_id_invalid") : null,
    ],
  );
  return clientTurn(rows[0]);
}

/** Every clone turn in this call, for the rolling history the next reply
 *  compiles against. Bounded like `listMirrorWindows` and for the same reason:
 *  an unbounded read inside a live call is an unbounded latency. */
export async function listMirrorTurns(db, ownerUserId, replicaIdValue, sessionIdValue) {
  const rows = await db(
    `select ${TURN_COLUMNS} from vy_mirror_turn t
      where t.session_id = $1::uuid and t.replica_id = $2::uuid and t.owner_user_id = $3::uuid
      order by t.seq asc limit 2000`,
    [
      mirrorUuid(sessionIdValue, "mirror_session_id_invalid"),
      mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"),
      ownerUserId,
    ],
  );
  return rows.map(clientTurn);
}
