// WS-X. The Mirror Call's offline gate.
//
// Contract: docs/gurukul/MIRROR-CALL-SPEC.md ("Everything gated: offline eval
// for the session state machine, delta proposal/approval (with a negative
// control proving an unapproved delta never lands), consent refusal, and the
// reference-set growth arithmetic"), plus the WS-Z redirect
// `mirror-learning-is-selection-not-accumulation` and its adoption deltas, plus
// the `mirror-call/v1` wire WS-Y's `src/studio/mirrorCallApi.ts` is the client
// half of.
//
// ── what this suite can and cannot see ───────────────────────────────────
// It drives the REAL store functions (api/_mirrorcall-store.js) against a fake
// database, the REAL mine (api/_mirrorcall.js) against real transcripts, and
// the REAL wire adapter (api/_mirrorcall-wire.js) against real rows. So it can
// see control flow, predicates, arithmetic, the shape of every proposal, and
// whether the payload the studio parses would survive its own normalizer.
//
// It CANNOT see SQL types or referential integrity —
// `offline-mocks-cannot-type-check-sql`, and a mock cannot even tell you the
// statement PARSES. Those are covered from the other side: every statement in
// this lane is on `evals/sqlcast`'s STRICT surface, and `scripts/relcheck.mjs`
// asks the live database the erasure-reach question §8 below can only ask of
// the checked-in DDL. NEITHER HAS RUN AGAINST A REAL DATABASE FOR THESE TABLES
// — said out loud here rather than implied by a green line.
//
// ── the fake database routes on STATEMENT SHAPE, never on a table name ────
// `router-matched-a-table-instead-of-a-statement`: a mock branch keyed on a
// table name will one day answer a different query than it was written for, and
// one that OVER-RETURNS hides real defects while every assertion stays green.
// So each branch matches a phrase unique to ONE statement, and an unmatched
// statement THROWS rather than returning [] — an empty answer from a mock is
// indistinguishable from a correct empty answer from Postgres.
//
// ── and it reads its predicates off the SQL TEXT ──────────────────────────
// `evals/clonechannel.mjs`'s technique. The fake honours
// `d.state in ('proposed','deferred')` by looking for it in the shipping
// string, so §5e can strike it out and the fake will let the struck copy do
// the damage it should.
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const load = (rel) => import(pathToFileURL(join(REPO, rel)).href);

const pure = await load("api/_mirrorcall.js");
const store = await load("api/_mirrorcall-store.js");
const wire = await load("api/_mirrorcall-wire.js");

let failed = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (cond) return true;
  failed++;
  console.log(`  FAIL ${what}`);
  return false;
};
const eq = (a, b, what) => ok(Object.is(a, b), `${what} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPLICA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AGENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SOURCE = "11111111-1111-4111-8111-111111111111";
const SHEET = "22222222-2222-4222-8222-222222222222";

const NOW = () => new Date().toISOString();

// ═════════════════════════════════════════════════════════════════════════
// the fake database
// ═════════════════════════════════════════════════════════════════════════

function fakeDb(seed = {}) {
  const state = {
    replicas: [{
      replica_id: REPLICA, owner_user_id: OWNER, agent_id: AGENT,
      subject_mode: "self", lifecycle: "enrolling", policy_version: "replica-self-v1",
    }],
    // The three account-attestable scopes. `training` is deliberately absent —
    // it needs a live biometric challenge nobody has passed, which is why the
    // voice loop is withheld and says so.
    consents: (seed.scopes ?? ["capture", "storage", "transcription"]).map((scope) => ({
      replica_id: REPLICA, owner_user_id: OWNER, scope,
      policy_version: "replica-self-v1", revoked_at: null, expires_at: null,
    })),
    sources: [{
      source_id: SOURCE, replica_id: REPLICA, owner_user_id: OWNER, kind: "audio",
      state: "quarantined", object_path: `${OWNER}/${REPLICA}/${SOURCE}/original`,
      sha256: "a".repeat(64), mime: "audio/wav", byte_size: 48_044,
    }],
    sheets: seed.sheet === null ? [] : [{
      sheet_id: SHEET, agent_id: AGENT, version: "", status: "draft",
      sheet: seed.sheet ?? { name: "Owner", boardVerbalisms: [], exSlangRepeat: "" },
      created_at: 1, updated_at: 1,
    }],
    sessions: [], windows: [], deltas: [], feedback: [], finetune: [],
    processing: [], fidelity: [], conditioning: [], audit: [], unmatched: [],
  };

  const scopesFor = (replicaId, ownerId, policy) => state.consents
    .filter((c) => c.replica_id === replicaId && c.owner_user_id === ownerId &&
      c.policy_version === policy && !c.revoked_at)
    .map((c) => c.scope).sort();

  const draftSheet = (agentId) => state.sheets
    .filter((s) => s.agent_id === agentId && s.status !== "published")
    .sort((a, b) => b.created_at - a.created_at)[0] || null;

  const ownedReplica = (rid, owner) => state.replicas.find((x) =>
    x.replica_id === rid && x.owner_user_id === owner && !["revoked", "purging"].includes(x.lifecycle));

  const db = async (sql, params) => {
    const has = (fragment) => sql.includes(fragment);

    // THE ONE WRITE, matched FIRST. Statement-shape routing means the most
    // SPECIFIC phrase has to be tested before any phrase a bigger statement
    // also happens to contain: the decide statement joins vy_mirror_session
    // and carries a `limit 1`, so a session branch placed above it would
    // answer it — and would answer it with a plausible row, which is
    // `router-matched-a-table-instead-of-a-statement` exactly.
    if (has("candidate as (")) {
      // THE ONE WRITE. Every predicate below is read off the SQL text so §5e's
      // strike is honoured by this fake.
      const requireUnactioned = has("d.state in ('proposed','deferred')");
      const requireOpen = has("s.state = 'open'");
      const [rid, owner, sid, did, decision, mergedJson, expectedSheetId, newSheetId] = params;
      const r = ownedReplica(rid, owner);
      if (!r) return [];
      const sess = state.sessions.find((s) => s.session_id === sid && s.replica_id === r.replica_id &&
        s.owner_user_id === owner && (!requireOpen || s.state === "open"));
      if (!sess) return [];
      const unactioned = (d) => !requireUnactioned || ["proposed", "deferred"].includes(d.state);
      const cand = state.deltas.find((d) => d.delta_id === did && d.session_id === sess.session_id && unactioned(d));
      if (!cand) return [];
      const writable = cand.target_field !== "" && decision === "accepted" && mergedJson != null;
      let landed = null;
      if (writable) {
        const existing = draftSheet(r.agent_id);
        if (existing && existing.sheet_id === expectedSheetId) {
          existing.sheet = JSON.parse(mergedJson);
          existing.status = "draft";
          landed = existing.sheet_id;
        } else if (!existing && expectedSheetId === null) {
          const row = { sheet_id: newSheetId, agent_id: r.agent_id, version: "", status: "draft", sheet: JSON.parse(mergedJson), created_at: state.sheets.length + 2 };
          state.sheets.push(row);
          landed = row.sheet_id;
        }
      }
      if (writable && landed === null) return [];
      const target = state.deltas.find((d) => d.delta_id === cand.delta_id && unactioned(d));
      if (!target) return [];
      target.state = decision;
      target.decided_at = NOW();
      if (landed) target.applied_at = NOW();
      if (target.applied_at && target.state !== "accepted") throw new Error("23514 vy_mirror_delta_applied_gate");
      state.audit.push({ action: "mirror_call.delta_decide", object_id: target.delta_id });
      return [{ ...target }];
    }

    // ── sessions ──
    if (has("insert into vy_mirror_session")) {
      const [rid, owner, sessionScopes, sessionId, refScopes] = params;
      const r = state.replicas.find((x) => x.replica_id === rid && x.owner_user_id === owner &&
        x.subject_mode === "self" && !["revoked", "purging"].includes(x.lifecycle));
      if (!r) return [];
      const scopes = scopesFor(r.replica_id, owner, r.policy_version);
      if (!sessionScopes.every((s) => scopes.includes(s))) return [];
      // The partial unique index on (replica_id) where state='open'.
      if (state.sessions.some((s) => s.replica_id === r.replica_id && s.state === "open")) return [];
      const row = {
        session_id: sessionId, replica_id: r.replica_id, owner_user_id: owner, state: "open",
        policy_version: r.policy_version, consent_scopes: scopes,
        reference_consent: refScopes.every((s) => scopes.includes(s)),
        started_at: NOW(), ended_at: null, updated_at: NOW(),
      };
      state.sessions.push(row);
      state.audit.push({ action: "mirror_call.start", object_id: row.session_id });
      return [{ ...row }];
    }
    if (has("order by s.started_at desc")) {
      const [rid, owner, sid] = params;
      const row = state.sessions.filter((s) => s.replica_id === rid && s.owner_user_id === owner &&
        s.state === "open" && (!sid || s.session_id === sid) &&
        state.replicas.some((r) => r.replica_id === s.replica_id && r.owner_user_id === s.owner_user_id &&
          !["revoked", "purging"].includes(r.lifecycle)))[0];
      return row ? [{ ...row }] : [];
    }
    if (has("from vy_mirror_session s") && has("s.session_id = $1::uuid") && has("s.owner_user_id = $2::uuid")) {
      // resolveMirrorSession — session-first addressing, owner-scoped.
      const [sid, owner] = params;
      const row = state.sessions.find((s) => s.session_id === sid && s.owner_user_id === owner &&
        state.replicas.some((r) => r.replica_id === s.replica_id && r.owner_user_id === s.owner_user_id &&
          !["revoked", "purging"].includes(r.lifecycle)));
      return row ? [{ ...row }] : [];
    }
    if (has("from vy_mirror_session s") && has("s.session_id = $3::uuid") && has("limit 1")) {
      const [rid, owner, sid] = params;
      const row = state.sessions.find((s) => s.replica_id === rid && s.owner_user_id === owner && s.session_id === sid);
      return row ? [{ ...row }] : [];
    }
    if (has("update vy_mirror_session") && has("state = 'ended'")) {
      const [sid, rid, owner, jobId] = params;
      const sess = state.sessions.find((s) => s.session_id === sid && s.replica_id === rid &&
        s.owner_user_id === owner && s.state === "open");
      if (!sess) return [];
      sess.state = "ended";
      sess.ended_at = NOW();
      const admitted = state.windows.filter((w) => w.session_id === sess.session_id &&
        w.reference_admitted && w.source_id);
      for (const w of admitted) {
        if (!state.processing.some((p) => p.source_id === w.source_id && p.step === "voice_quality")) {
          state.processing.push({ job_id: `p-${state.processing.length}`, source_id: w.source_id, step: "voice_quality", state: "queued" });
        }
      }
      let ft = null;
      if (admitted.length && !state.finetune.some((f) => f.session_id === sess.session_id)) {
        ft = {
          job_id: jobId, session_id: sess.session_id, state: "queued", lane: "per_expert_adapter",
          reference_windows: admitted.length,
          reference_ms: admitted.reduce((n, w) => n + w.duration_ms, 0),
        };
        state.finetune.push(ft);
      }
      state.audit.push({ action: "mirror_call.end", object_id: sess.session_id });
      return [{
        session_id: sess.session_id,
        reembedding_jobs: state.processing.filter((p) => p.step === "voice_quality").length,
        finetune_job_id: ft?.job_id ?? null,
        finetune_reference_windows: ft?.reference_windows ?? null,
        finetune_reference_ms: ft?.reference_ms ?? null,
      }];
    }

    // ── windows ──
    if (has("insert into vy_mirror_window")) {
      const [sid, rid, owner, windowId, sourceId, seq, durationMs, refScope, ownVoice, similarity] = params;
      const sess = state.sessions.find((s) => s.session_id === sid && s.replica_id === rid &&
        s.owner_user_id === owner && s.state === "open");
      if (!sess) return [];
      if (state.windows.some((w) => w.session_id === sid && w.seq === seq)) return [];
      const stored = state.sources.find((x) => x.source_id === sourceId && x.replica_id === rid &&
        x.owner_user_id === owner && x.state === "quarantined") || null;
      const admitted = Boolean(sess.reference_consent && stored && ownVoice === "owner_verified");
      const reason = !sess.reference_consent ? `consent_scope_missing:${refScope}`
        : !stored ? "no_stored_object"
        : ownVoice === "clone_overlap" ? "own_voice_clone_overlap"
        : ownVoice === "foreign_speaker" ? "own_voice_foreign_speaker"
        : ownVoice === "unverified" ? "own_voice_unverified"
        : "owner_verified_candidate_window";
      const row = {
        window_id: windowId, session_id: sid, replica_id: rid, owner_user_id: owner, seq,
        source_id: stored?.source_id ?? null, duration_ms: durationMs, lane: "sync",
        asr_state: "pending", failure_code: "", transcript: "", asr_provider: "", asr_model: "",
        reference_admitted: admitted, admission_reason: reason,
        conditioning_ms: Math.min(durationMs, 10_000),
        own_voice_state: ownVoice, owner_similarity: similarity,
        quality_score: null, score_source: "",
        created_at: NOW(), updated_at: NOW(),
      };
      // Migration 058's CHECKs, honoured rather than assumed.
      if (durationMs <= 0 || durationMs > 30_000) throw new Error("23514 vy_mirror_window duration");
      if (!reason) throw new Error("23514 vy_mirror_window_admission_reason");
      if (admitted && ownVoice !== "owner_verified") throw new Error("23514 vy_mirror_window_own_voice_gate");
      state.windows.push(row);
      return [{ ...row }];
    }
    if (has("update vy_mirror_window w") && has("set asr_state")) {
      const [wid, rid, owner, asrState, transcript, provider, model, failureCode] = params;
      const w = state.windows.find((x) => x.window_id === wid && x.replica_id === rid &&
        x.owner_user_id === owner && x.asr_state === "pending" &&
        state.sessions.some((s) => s.session_id === x.session_id && s.state === "open"));
      if (!w) return [];
      if (asrState === "dropped" && !failureCode) throw new Error("23514 vy_mirror_window_dropped_reason");
      Object.assign(w, { asr_state: asrState, transcript, asr_provider: provider, asr_model: model, failure_code: failureCode, updated_at: NOW() });
      return [{ ...w }];
    }
    if (has("update vy_mirror_window w") && has("set quality_score")) {
      const [wid, rid, owner, score, source] = params;
      const w = state.windows.find((x) => x.window_id === wid && x.replica_id === rid && x.owner_user_id === owner);
      if (!w) return [];
      if ((score === null) !== (source === "")) throw new Error("23514 vy_mirror_window_score_source");
      Object.assign(w, { quality_score: score, score_source: source, updated_at: NOW() });
      return [{ ...w }];
    }
    if (has("order by w.seq asc")) {
      const [sid, rid, owner] = params;
      return state.windows
        .filter((w) => w.session_id === sid && w.replica_id === rid && w.owner_user_id === owner)
        .sort((a, b) => a.seq - b.seq).map((w) => ({ ...w }));
    }
    if (has("regexp_split_to_array")) {
      const [rid, owner] = params;
      const rows = state.windows.filter((w) => w.replica_id === rid && w.owner_user_id === owner &&
        w.asr_state === "transcribed" && String(w.transcript).trim());
      return [{
        tokens: rows.reduce((n, w) => n + String(w.transcript).trim().split(/\s+/).length, 0),
        windows: rows.length,
      }];
    }
    if (has("count(*)::int as windows")) {
      const [rid, owner, sid] = params;
      const rows = state.windows.filter((w) => w.replica_id === rid && w.owner_user_id === owner &&
        w.reference_admitted && w.session_id !== sid);
      return [{ windows: rows.length, ms: rows.reduce((n, w) => n + w.duration_ms, 0) }];
    }

    // ── conditioning ──
    if (has("insert into vy_mirror_conditioning")) {
      const [rid, owner, windowId, score, condMs, source, selectionId, sessionId] = params;
      if (!ownedReplica(rid, owner)) return [];
      const standing = state.conditioning.find((c) => c.replica_id === rid &&
        c.owner_user_id === owner && !c.superseded_at) || null;
      // `where $4::real > coalesce(standing.score, -1)` — STRICTLY better only.
      if (!(Number(score) > (standing ? Number(standing.score) : -1))) return [];
      if (standing) standing.superseded_at = NOW();
      const row = {
        selection_id: selectionId, replica_id: rid, owner_user_id: owner, window_id: windowId,
        session_id: sessionId, score, conditioning_ms: condMs, score_source: source,
        selected_at: NOW(), superseded_at: null,
      };
      state.conditioning.push(row);
      state.audit.push({ action: "mirror_call.conditioning_select", object_id: selectionId });
      return [{ ...row }];
    }
    if (has("from vy_mirror_conditioning c") && has("superseded_at is null") && has("limit 1")) {
      const [rid, owner] = params;
      const row = state.conditioning.find((c) => c.replica_id === rid && c.owner_user_id === owner && !c.superseded_at);
      return row ? [{ ...row }] : [];
    }
    if (has("count(*)::int as n from vy_mirror_conditioning")) {
      const [rid, owner, sid] = params;
      return [{ n: state.conditioning.filter((c) => c.replica_id === rid && c.owner_user_id === owner && c.session_id === sid).length }];
    }

    // ── deltas ──
    if (has("insert into vy_mirror_delta")) {
      const [sid, rid, owner, deltaId, kind, fragment, targetField, evidence, cited, origin, occurrences, corpusTokens, citation, deltaState] = params;
      const sess = state.sessions.find((s) => s.session_id === sid && s.replica_id === rid &&
        s.owner_user_id === owner && s.state === "open");
      if (!sess) return [];
      // The migration's CHECKs, honoured rather than assumed.
      if (targetField && (!fragment || /[.!?]/.test(fragment) || fragment.length > 64)) {
        throw new Error("23514 vy_mirror_delta_fragment_shape");
      }
      if (targetField && !(cited || []).length) throw new Error("23514 vy_mirror_delta_cited");
      if (origin === "mined" && !(occurrences >= 1 && corpusTokens >= 1)) {
        throw new Error("23514 vy_mirror_delta_origin_evidence");
      }
      if (origin === "judgement" && targetField) throw new Error("23514 vy_mirror_delta_judgement_advisory");
      const existing = state.deltas.find((d) => d.session_id === sid && d.kind === kind && d.fragment === fragment);
      if (existing) {
        const guarded = has("where vy_mirror_delta.state in ('proposed','deferred')");
        if (guarded && !["proposed", "deferred"].includes(existing.state)) return [];
        existing.evidence = JSON.parse(evidence);
        existing.citation = JSON.parse(citation);
        existing.cited_windows = cited;
        existing.occurrences = occurrences;
        existing.corpus_tokens = corpusTokens;
        existing.updated_at = NOW();
        return [{ ...existing }];
      }
      const row = {
        delta_id: deltaId, session_id: sid, replica_id: rid, owner_user_id: owner, kind,
        fragment, target_field: targetField, origin, occurrences, corpus_tokens: corpusTokens,
        evidence: JSON.parse(evidence), citation: JSON.parse(citation), cited_windows: cited,
        state: deltaState, applied_at: null, decided_at: null,
        created_at: state.deltas.length, updated_at: NOW(),
      };
      state.deltas.push(row);
      return [{ ...row }];
    }
    if (has("order by d.created_at asc")) {
      const [sid, rid, owner] = params;
      return state.deltas
        .filter((d) => d.session_id === sid && d.replica_id === rid && d.owner_user_id === owner)
        .sort((a, b) => a.created_at - b.created_at).map((d) => ({ ...d }));
    }
    if (has("order by d.occurrences desc")) {
      const [sid, rid, owner] = params;
      return state.deltas
        .filter((d) => d.session_id === sid && d.replica_id === rid && d.owner_user_id === owner &&
          ["proposed", "deferred"].includes(d.state))
        .map((d) => ({ ...d }));
    }
    if (has("count(*) filter (where d.state = 'accepted')")) {
      const [sid, rid, owner] = params;
      const rows = state.deltas.filter((d) => d.session_id === sid && d.replica_id === rid && d.owner_user_id === owner);
      return [{
        accepted: rows.filter((d) => d.state === "accepted").length,
        rejected: rows.filter((d) => d.state === "rejected").length,
        unactioned: rows.filter((d) => ["proposed", "deferred"].includes(d.state)).length,
        applied: rows.filter((d) => d.applied_at).length,
      }];
    }
    if (has("from vy_mirror_delta d") && has("d.delta_id = $1::uuid") && has("limit 1")) {
      const requireUnactioned = has("d.state in ('proposed','deferred')");
      const [did, sid, rid, owner] = params;
      const row = state.deltas.find((d) => d.delta_id === did && d.session_id === sid &&
        d.replica_id === rid && d.owner_user_id === owner &&
        (!requireUnactioned || ["proposed", "deferred"].includes(d.state)));
      return row ? [{ ...row }] : [];
    }

    // ── sheet, sources, fidelity, feedback ──
    if (has("from vy_teacher_sheet s") && has("join vy_replica r")) {
      const [rid, owner] = params;
      const r = state.replicas.find((x) => x.replica_id === rid && x.owner_user_id === owner);
      if (!r) return [];
      const row = draftSheet(r.agent_id);
      return row ? [{ ...row }] : [];
    }
    if (has("from vy_replica_source s")) {
      const [sourceId, rid, owner] = params;
      const row = state.sources.find((x) => x.source_id === sourceId && x.replica_id === rid &&
        x.owner_user_id === owner && x.kind === "audio" && x.state === "quarantined");
      return row ? [{ ...row }] : [];
    }
    if (has("from vy_voice_fidelity f")) {
      const [rid, owner] = params;
      return state.fidelity.filter((f) => f.replica_id === rid && f.owner_user_id === owner && !f.superseded_at);
    }
    if (has("insert into vy_mirror_feedback")) {
      const [sid, rid, owner, feedbackId, turnRef, verdict, rephrase] = params;
      const sess = state.sessions.find((s) => s.session_id === sid && s.replica_id === rid &&
        s.owner_user_id === owner && s.state === "open");
      if (!sess) return [];
      if (verdict === "rephrase" && !rephrase) throw new Error("23514 vy_mirror_feedback_rephrase_present");
      const existing = state.feedback.find((f) => f.session_id === sid && f.turn_ref === turnRef);
      if (existing) {
        Object.assign(existing, { verdict, rephrase_text: rephrase });
        return [{ ...existing }];
      }
      const row = { feedback_id: feedbackId, session_id: sid, replica_id: rid, owner_user_id: owner, turn_ref: turnRef, verdict, rephrase_text: rephrase, created_at: state.feedback.length };
      state.feedback.push(row);
      return [{ ...row }];
    }
    if (has("from vy_mirror_feedback f")) {
      const [sid, rid, owner] = params;
      return state.feedback.filter((f) => f.session_id === sid && f.replica_id === rid && f.owner_user_id === owner);
    }

    // An unmatched statement is a DEFECT in this fake, never an empty answer.
    state.unmatched.push(sql.slice(0, 160));
    throw new Error(`fake db has no branch for: ${sql.slice(0, 160)}`);
  };
  db.state = state;
  return db;
}

// ═════════════════════════════════════════════════════════════════════════
// 1. THE MINE — shapes, never lines; counts, never prose
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 1. the mine ──");

// Ten windows rather than three, because `MIRROR_MIN_ADVISORY_TOKENS` is 60 and
// a fixture under it would exercise only the phrase-bank half of the mine while
// looking like it covered both. The habits are authored so the counts are
// hand-checkable: "dekho beta" x5, "basically" x5, "matlab" x4, "haha" x3.
const WINDOWS = [
  { seq: 1, transcript: "dekho beta yeh basically ek simple concept hai" },
  { seq: 2, transcript: "dekho beta agar basics clear hain toh basically sab easy" },
  { seq: 3, transcript: "matlab dekho beta basically derivation pehle samajhna zaroori" },
  { seq: 4, transcript: "matlab basically har exam mein yahi poocha jaata hai" },
  { seq: 5, transcript: "matlab dekho beta ab hum numericals karte hain" },
  { seq: 6, transcript: "haha nahi yaar wo wala question bahut aasan tha" },
  { seq: 7, transcript: "haha dekho beta phir se ek baar dhyaan se suno" },
  { seq: 8, transcript: "matlab yeh formula har baar kaam nahi karta samjhe" },
  { seq: 9, transcript: "haha bilkul sahi jawab diya tumne is baar" },
  { seq: 10, transcript: "basically pehle diagram banao phir equation likho theek hai" },
];

const mined = pure.mineMirrorDeltas(WINDOWS);
const byKind = (k) => mined.deltas.filter((d) => d.kind === k);

ok(mined.deltas.length > 0, "the mine proposes something off a real transcript");

for (const delta of mined.deltas.filter((d) => d.targetField)) {
  ok(!/[.!?]/.test(delta.fragment), `writable delta "${delta.fragment}" carries no terminal punctuation`);
  ok(delta.fragment.split(" ").length <= 3, `writable delta "${delta.fragment}" is at most 3 words`);
  ok(delta.citedWindows.length >= 1, `writable delta "${delta.fragment}" cites at least one window`);
  eq(delta.citedWindows.length, delta.evidence.count,
    `"${delta.fragment}" cites exactly as many windows as it was counted in`);
  for (const seq of delta.citedWindows) {
    const w = WINDOWS.find((x) => x.seq === seq);
    ok(Boolean(w) && w.transcript.includes(delta.fragment),
      `citation ${seq} for "${delta.fragment}" points at a window that actually contains it`);
  }
}

for (const delta of mined.deltas.filter((d) => d.kind.endsWith("_advisory"))) {
  eq(delta.targetField, "", `${delta.kind} "${delta.fragment}" is advisory and targets no field`);
}

// WS-Z A4: mined-from-behaviour is its own origin, and every mined chip carries
// its n. A chip without a count is a claim a studio cannot weigh.
for (const delta of mined.deltas) {
  eq(delta.origin, "mined", `${delta.kind} "${delta.fragment}" is origin=mined`);
  ok(delta.occurrences >= 1, `${delta.kind} "${delta.fragment}" carries an occurrence count`);
  ok(delta.corpusTokens >= 1, `${delta.kind} "${delta.fragment}" carries the corpus it was measured against`);
  eq(pure.MIRROR_DELTA_KINDS[delta.kind].query, delta.query, `${delta.kind} declares its query type`);
}

ok(byKind("phrase_habit").some((d) => d.fragment === "dekho beta"),
  'the repeated multi-word habit "dekho beta" is proposed to boardVerbalisms');
eq(byKind("phrase_habit").find((d) => d.fragment === "dekho beta")?.targetField, "boardVerbalisms",
  "a multi-word habit targets boardVerbalisms");
// "basically" clears the catchphrase floor as a SINGLE word, so it is mined as
// short repeated slang and targets `exSlangRepeat` — the other of the two
// writable phrase-bank fields. That is the mine's own rule (one fragment, one
// writable chip) and asserting it here is what stops a later edit offering the
// same habit twice.
eq(byKind("slang_habit").find((d) => d.fragment === "basically")?.targetField, "exSlangRepeat",
  "a repeated single word targets exSlangRepeat, not boardVerbalisms");
ok(!byKind("phrase_habit").some((d) => d.fragment === "basically"),
  "and it is NOT also offered to boardVerbalisms — one habit is confirmed once");
// The ADVISORY half only fires above the corpus floor, which this fixture clears.
ok(mined.stats.tokens >= pure.MIRROR_MIN_ADVISORY_TOKENS,
  `the fixture clears the advisory corpus floor (${mined.stats.tokens} tokens)`);
ok(mined.deltas.some((d) => d.kind.endsWith("_advisory")),
  "advisory chips are proposed above the corpus floor");
for (const d of mined.deltas.filter((x) => x.kind.endsWith("_advisory"))) {
  eq(d.targetField, "",
    `${d.kind} is advisory — the prose register bullets are not written by a mine`);
}

const known = new Set(mined.deltas.map((d) => `${d.kind} ${d.fragment}`));
eq(pure.mineMirrorDeltas(WINDOWS, known).deltas.length, 0,
  "re-mining the same transcript with every chip known proposes nothing new");
eq(JSON.stringify(pure.mineMirrorDeltas(WINDOWS).deltas), JSON.stringify(mined.deltas),
  "the mine is deterministic");
eq(pure.mineMirrorDeltas([]).deltas.length, 0, "an empty transcript mines nothing and does not throw");

// Confidence bands — one call is under every published stylometric floor, and
// the band has to say so rather than rendering a percentage.
eq(pure.corpusConfidence(400, 1).band, "below-every-published-floor",
  "n=1 in 400 words is below every published floor");
eq(pure.corpusConfidence(9_000, 9).band, "supported", "n=9 across 9,000 words is supported");
eq(pure.corpusConfidence(9_000, 1).band, "weak", "a big corpus with n=1 is weak, not supported");
ok(pure.corpusConfidence(400, 1).band !== pure.corpusConfidence(9_000, 9).band,
  "an n=1/400-word chip is DISTINGUISHABLE from an n=9/9,000-word one");

// ═════════════════════════════════════════════════════════════════════════
// 2. THE RECITED-PROMPT GUARD, AND THE PII SCRUB
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 2. guards ──");

for (const [fragment, reason] of [
  ["dekho beta samajh gaye na.", "sentence-shaped"],
  ["chaliye aaj hum yeh concept", "over-3-words"],
  ["", "empty"],
]) {
  eq(pure.fragmentRejection(fragment), reason, `"${fragment}" is refused as ${reason}`);
}
eq(pure.fragmentRejection("dekho beta"), "", "a two-word habit is allowed");

let threw = "";
try {
  pure.mergeDeltaIntoSheet({ boardVerbalisms: [] },
    { target_field: "boardVerbalisms", fragment: "yeh poora sentence hai bhai." });
} catch (error) { threw = error.code; }
eq(threw, "mirror_delta_fragment_unsafe", "a sentence-shaped fragment cannot be merged into a sheet");

threw = "";
try {
  pure.mergeDeltaIntoSheet({ voiceFillers: "" }, { target_field: "voiceFillers", fragment: "basically" });
} catch (error) { threw = error.code; }
eq(threw, "mirror_delta_not_writable", "a prose register bullet is not a writable target");

eq(JSON.stringify(pure.mergeDeltaIntoSheet({ boardVerbalisms: ["socho zara"] },
  { target_field: "boardVerbalisms", fragment: "dekho beta" }).boardVerbalisms),
  JSON.stringify(["socho zara", "dekho beta"]), "boardVerbalisms appends");
eq(pure.mergeDeltaIntoSheet({ exSlangRepeat: '("arre")' },
  { target_field: "exSlangRepeat", fragment: "matlab" }).exSlangRepeat,
  '("arre", "matlab")', "exSlangRepeat re-renders as a parenthesised quoted list");
eq(pure.mergeDeltaIntoSheet({ boardVerbalisms: ["dekho beta"] },
  { target_field: "boardVerbalisms", fragment: "dekho beta" }), null,
  "merging a fragment already on the sheet is a no-op, not a duplicate");
eq(pure.mergeDeltaIntoSheet({ boardVerbalisms: Array.from({ length: 12 }, (_, i) => `x${i}`) },
  { target_field: "boardVerbalisms", fragment: "dekho beta" }), null,
  "the phrase-bank ceiling refuses a 13th entry rather than truncating silently");

// WS-Z A4: the PII scrub, and the property that makes it safe to run before
// the mine — it must not change the token count.
for (const [raw, what, sameTokens] of [
  ["mera number 9876543210 hai", "a 10-digit mobile", true],
  ["mail me at owner@example.com please", "an email", true],
  ["card 4111 1111 1111 1111 likho", "a card number", false],
  ["server 192.168.10.44 par hai", "an IPv4", true],
  ["account 123456789012 note karo", "a long digit run", true],
]) {
  const scrubbed = pure.scrubPii(raw);
  ok(!/\d{6,}|@example\.com/.test(scrubbed), `${what} is scrubbed`);
  ok(scrubbed.includes(pure.PII_TOKEN), `${what} leaves a visible redaction token`);
  // The property the mine depends on: a scrub NEVER SPLITS a token and never
  // grows the text, so it cannot inflate a per-1000 ratio. A GROUPED match
  // collapses several tokens into one and therefore under-counts — stated in
  // `scrubPii`'s header and asserted here rather than quietly assumed away.
  const before = raw.split(/\s+/).length;
  const after = scrubbed.split(/\s+/).length;
  ok(after <= before, `${what} scrub never grows the token count`);
  if (sameTokens) {
    eq(after, before, `${what} is a single token before and after`);
  } else {
    ok(after < before, `${what} is grouped, so the scrub UNDER-counts — a known, bounded distortion`);
  }
}
eq(pure.scrubPii("dekho beta basically simple hai"), "dekho beta basically simple hai",
  "ordinary speech is untouched by the scrub");

// ═════════════════════════════════════════════════════════════════════════
// 3. THE SESSION STATE MACHINE, AND OWNERSHIP
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 3. the state machine and ownership ──");

{
  const db = fakeDb();
  const session = await store.openMirrorSession(db, OWNER, REPLICA);
  ok(Boolean(session), "the owner can open a Mirror Call on their own replica");
  eq(session.state, "open", "a new session is open");
  eq(session.reference_consent, false,
    "reference consent is FALSE — `training` needs a live biometric challenge nobody has passed");
  eq(JSON.stringify(session.consent_scopes), JSON.stringify(["capture", "storage", "transcription"]),
    "the scopes live at start are frozen onto the row");

  eq(await store.openMirrorSession(db, STRANGER, REPLICA), null,
    "a non-owner cannot open a Mirror Call on someone else's replica");
  eq(await store.getOpenMirrorSession(db, STRANGER, REPLICA), null,
    "a non-owner cannot read someone else's open session");
  // Session-first addressing: a session id in a stranger's hands is inert.
  eq(await store.resolveMirrorSession(db, STRANGER, session.session_id), null,
    "a non-owner holding a valid session id resolves nothing");
  ok(Boolean(await store.resolveMirrorSession(db, OWNER, session.session_id)),
    "the owner resolves their own session by id alone");

  const resumed = await store.openMirrorSession(db, OWNER, REPLICA);
  eq(resumed.session_id, session.session_id, "starting again resumes the open call, never forks it");
  eq(db.state.sessions.length, 1, "at most one session row exists for one replica");

  const ended = await store.endMirrorSession(db, OWNER, REPLICA, session.session_id);
  ok(Boolean(ended), "the owner can end their own call");
  eq(db.state.sessions[0].state, "ended", "the session is ended");
  eq(await store.endMirrorSession(db, OWNER, REPLICA, session.session_id), null,
    "ending an already-ended call is refused, not repeated");
  eq(await store.recordMirrorWindow(db, OWNER, REPLICA, session.session_id, { seq: 9, durationMs: 5000, sourceId: SOURCE }), null,
    "a window cannot be ingested into an ended call");
  eq(await store.recordMirrorFeedback(db, OWNER, REPLICA, session.session_id, { turnRef: "t1", verdict: "down", rephraseText: "" }), null,
    "feedback cannot be recorded on an ended call");

  eq(ended.finetune_job_id, null, "an ended call with no admitted candidate audio queues no fine-tune");
  eq(db.state.finetune.length, 0, "and writes no queue row");
  eq(db.state.processing.length, 0, "and triggers no re-embedding");
}

for (const scopes of [["capture", "storage"], ["capture", "transcription"], []]) {
  const db = fakeDb({ scopes });
  eq(await store.openMirrorSession(db, OWNER, REPLICA), null,
    `a Mirror Call is refused without every session scope (had ${JSON.stringify(scopes)})`);
}

{
  const db = fakeDb({ scopes: ["capture", "storage", "transcription", "training"] });
  const session = await store.openMirrorSession(db, OWNER, REPLICA);
  eq(session.reference_consent, true, "with `training` live, the candidate lane is open");
}

// ═════════════════════════════════════════════════════════════════════════
// 4. CHIP-STREAM HONESTY ON A DROPPED WINDOW
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 4. chip-stream honesty ──");

{
  const db = fakeDb();
  const session = await store.openMirrorSession(db, OWNER, REPLICA);
  const sid = session.session_id;

  const plan = [
    { seq: 1, durationMs: 10_000, text: "dekho beta yeh basically simple hai" },
    { seq: 2, durationMs: 20_000, text: null, code: "asr_sync_http_429" },
    { seq: 3, durationMs: 10_000, text: "dekho beta basically matlab samjhe" },
  ];
  for (const step of plan) {
    const input = pure.mirrorWindowInput({ seq: step.seq, duration_ms: step.durationMs, source_id: SOURCE });
    const pending = await store.recordMirrorWindow(db, OWNER, REPLICA, sid, input);
    ok(Boolean(pending), `window ${step.seq} is recorded BEFORE ASR is attempted`);
    eq(pending.asr_state, "pending", `window ${step.seq} starts pending`);
    await store.settleMirrorWindow(db, OWNER, REPLICA, pending.window_id,
      step.text ? { transcript: step.text, provider: "sarvam-sync", model: "saarika:v2.5" }
        : { failureCode: step.code });
  }

  const windows = await store.listMirrorWindows(db, OWNER, REPLICA, sid);
  const coverage = pure.mirrorCoverage(windows);
  eq(coverage.windows, 3, "every ingested window is counted, dropped ones included");
  eq(coverage.ingested_ms, 40_000, "ingested milliseconds are the sum of every window");
  eq(coverage.transcribed_ms, 20_000, "transcribed milliseconds exclude the drop");
  eq(coverage.dropped_ms, 20_000, "dropped milliseconds are named");
  eq(coverage.coverage, 0.5, "coverage is a ratio of AUDIO, and it is 0.5 here");
  eq(coverage.complete, false, "a call that dropped a window does not report itself complete");
  eq(coverage.dropped_windows.length, 1, "the drop is enumerated");
  eq(coverage.dropped_windows[0].seq, 2, "by sequence number, so a caption rail can scroll to it");
  eq(coverage.dropped_windows[0].failure_code, "asr_sync_http_429",
    "and it names WHY — a reasonless drop is what the CHECK constraint refuses");

  // The wire's drop reason: the studio's enum, with the RAW code beside it.
  eq(wire.dropReason("asr_sync_http_429"), "rate_limited", "a 429 maps to rate_limited");
  eq(wire.dropReason("asr_sync_transcript_empty"), "asr_empty", "an empty transcript maps to asr_empty");
  eq(wire.dropReason("asr_sync_unreachable"), "asr_timeout", "an unreachable provider maps to asr_timeout");
  eq(wire.dropReason("no_audio_reference"), "audio_unusable", "a missing object maps to audio_unusable");
  eq(wire.dropReason("something_nobody_mapped"), "audio_unusable",
    "an UNMAPPED code falls to audio_unusable, never to asr_empty — we did not measure silence");

  const clean = fakeDb();
  const s2 = await store.openMirrorSession(clean, OWNER, REPLICA);
  const p = await store.recordMirrorWindow(clean, OWNER, REPLICA, s2.session_id,
    pure.mirrorWindowInput({ seq: 1, duration_ms: 10_000, source_id: SOURCE }));
  await store.settleMirrorWindow(clean, OWNER, REPLICA, p.window_id,
    { transcript: "dekho beta", provider: "sarvam-sync", model: "saarika:v2.5" });
  const cleanCoverage = pure.mirrorCoverage(await store.listMirrorWindows(clean, OWNER, REPLICA, s2.session_id));
  eq(cleanCoverage.coverage, 1, "a call that lost nothing reports coverage 1");
  eq(cleanCoverage.complete, true, "and reports itself complete");

  await store.recordMirrorWindow(clean, OWNER, REPLICA, s2.session_id,
    pure.mirrorWindowInput({ seq: 2, duration_ms: 5_000, source_id: SOURCE }));
  const stranded = pure.mirrorCoverage(await store.listMirrorWindows(clean, OWNER, REPLICA, s2.session_id));
  eq(stranded.pending_ms, 5_000, "an unsettled window is reported as pending milliseconds");
  eq(stranded.complete, false, "and the call is not complete while it is stranded");

  // The PII scrub runs at the STORE seam, not at the mine or the provider.
  const scrubbed = fakeDb();
  const s3 = await store.openMirrorSession(scrubbed, OWNER, REPLICA);
  const p3 = await store.recordMirrorWindow(scrubbed, OWNER, REPLICA, s3.session_id,
    pure.mirrorWindowInput({ seq: 1, duration_ms: 8_000, source_id: SOURCE }));
  await store.settleMirrorWindow(scrubbed, OWNER, REPLICA, p3.window_id,
    { transcript: "mera number 9876543210 hai dekho beta", provider: "sarvam-sync", model: "saarika:v2.5" });
  const stored = scrubbed.state.windows[0].transcript;
  ok(!stored.includes("9876543210"),
    "A PHONE NUMBER SPOKEN ALOUD NEVER REACHES THE DATABASE — the scrub is at the store seam");
  ok(stored.includes("dekho beta"), "and the rest of the sentence survives");
}

threw = "";
try { pure.mirrorWindowInput({ seq: 1, duration_ms: 45_000, source_id: SOURCE }); }
catch (error) { threw = error.code; }
eq(threw, "mirror_window_too_long", "a window over the sync lane's 30 s cap is refused loudly");
eq(pure.mirrorWindowInput({ seq: 1, duration_ms: 30_000 }).sourceId, null,
  "a window with no consented object is legal, and carries no source");

// ═════════════════════════════════════════════════════════════════════════
// 5. THE NEGATIVE CONTROL: AN UNAPPROVED DELTA NEVER TOUCHES THE SHEET
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 5. the negative control ──");

async function seeded(db) {
  const session = await store.openMirrorSession(db, OWNER, REPLICA);
  const sid = session.session_id;
  for (const w of WINDOWS) {
    const pending = await store.recordMirrorWindow(db, OWNER, REPLICA, sid,
      pure.mirrorWindowInput({ seq: w.seq, duration_ms: 6_000, source_id: SOURCE }));
    await store.settleMirrorWindow(db, OWNER, REPLICA, pending.window_id,
      { transcript: w.transcript, provider: "sarvam-sync", model: "saarika:v2.5" });
  }
  const rows = await store.listMirrorWindows(db, OWNER, REPLICA, sid);
  const transcribed = rows.filter((w) => w.asr_state === "transcribed")
    .map((w) => ({ seq: w.seq, transcript: w.transcript }));
  const corpus = await store.mirrorCorpusTokens(db, OWNER, REPLICA);
  for (const delta of pure.mineMirrorDeltas(transcribed).deltas) {
    const first = rows.find((w) => w.seq === delta.citedWindows[0]) || rows[0];
    await store.proposeMirrorDelta(db, OWNER, REPLICA, sid, {
      ...delta,
      corpusTokens: corpus.tokens,
      citation: { turn_id: first.window_id, quote: first.transcript, occurrences: delta.occurrences },
    });
  }
  const proposed = (await store.listMirrorDeltas(db, OWNER, REPLICA, sid))
    .find((d) => d.target_field === "boardVerbalisms");
  return { sid, proposed };
}

const sheetOf = (db) => JSON.stringify(db.state.sheets.find((s) => s.sheet_id === SHEET)?.sheet ?? null);

// 5a — mining alone, no taps at all.
{
  const db = fakeDb();
  const before = sheetOf(db);
  const { sid, proposed } = await seeded(db);
  ok(Boolean(proposed), "a writable delta was proposed (so the control below is not vacuous)");
  ok(db.state.deltas.length >= 3, `the mine wrote ${db.state.deltas.length} chips`);
  eq(sheetOf(db), before, "MINING ALONE MOVES NO SHEET BYTE");
  eq(db.state.deltas.every((d) => ["proposed", "deferred"].includes(d.state)), true,
    "and every chip is still merely un-actioned");
  eq(db.state.deltas.every((d) => d.applied_at === null), true, "and none is applied");

  await store.endMirrorSession(db, OWNER, REPLICA, sid);
  eq(sheetOf(db), before, "ENDING THE CALL DOES NOT APPLY UN-ACTIONED CHIPS");
  const tally = await store.mirrorDeltaTally(db, OWNER, REPLICA, sid);
  eq(tally.applied, 0, "the end-of-call tally reports zero applied");
  eq(tally.unactioned, db.state.deltas.length,
    "every chip is left un-actioned for the ordinary review queue, exactly as the spec says");
}

// 5c — an explicit REJECT leaves the sheet alone.
{
  const db = fakeDb();
  const before = sheetOf(db);
  const { sid, proposed } = await seeded(db);
  const result = await store.decideMirrorDelta(db, OWNER, REPLICA, sid, proposed.delta_id, "rejected",
    { pendingDelta: proposed });
  eq(result.row.state, "rejected", "the reject is recorded");
  eq(result.row.applied_at, null, "a rejected delta is never applied");
  eq(sheetOf(db), before, "A REJECTED DELTA MOVES NO SHEET BYTE");

  const rows = await store.listMirrorWindows(db, OWNER, REPLICA, sid);
  const knownNow = new Set((await store.listMirrorDeltas(db, OWNER, REPLICA, sid))
    .map((d) => `${d.kind} ${d.fragment}`));
  const again = pure.mineMirrorDeltas(
    rows.filter((w) => w.asr_state === "transcribed").map((w) => ({ seq: w.seq, transcript: w.transcript })),
    knownNow,
  );
  eq(again.deltas.length, 0, "re-mining does not re-propose a chip the owner rejected");
  eq(db.state.deltas.find((d) => d.delta_id === proposed.delta_id).state, "rejected",
    "and the rejected row stays rejected");
}

// 5d — THE POSITIVE CONTROL. If accepting did nothing either, every assertion
// above would be true of a pipeline that simply never writes.
{
  const db = fakeDb();
  const before = sheetOf(db);
  const { sid, proposed } = await seeded(db);
  const result = await store.decideMirrorDelta(db, OWNER, REPLICA, sid, proposed.delta_id, "accepted",
    { pendingDelta: proposed });
  eq(result.row.state, "accepted", "the accept is recorded");
  ok(result.row.applied_at !== null, "an accepted writable delta IS applied");
  ok(sheetOf(db) !== before, "AN ACCEPTED DELTA DOES MOVE THE SHEET — the control can fail");
  ok(db.state.sheets[0].sheet.boardVerbalisms.includes(proposed.fragment),
    `the accepted fragment "${proposed.fragment}" is on the sheet`);
  eq(db.state.sheets[0].status, "draft", "and it lands as a DRAFT, never on a published row");
}

// 5e — THE STRIKE.
{
  const real = fakeDb();
  const struck = async (sql, params) =>
    real(sql.split("d.state in ('proposed','deferred')").join("true"), params);
  struck.state = real.state;

  const before = sheetOf(real);
  const { sid, proposed } = await seeded(real);
  await store.decideMirrorDelta(real, OWNER, REPLICA, sid, proposed.delta_id, "rejected",
    { pendingDelta: proposed });
  eq(sheetOf(real), before, "the chip is rejected and the sheet is untouched");

  const result = await store.decideMirrorDelta(struck, OWNER, REPLICA, sid, proposed.delta_id, "accepted",
    { pendingDelta: proposed });
  ok(Boolean(result.row), "with the un-actioned clause struck, an already-rejected chip is decided again");
  ok(sheetOf(real) !== before,
    "with `d.state in ('proposed','deferred')` struck, the REJECTED chip lands on the sheet — the clause is load-bearing");
}

// 5f — the session-open clause is load-bearing too.
{
  const db = fakeDb();
  const { sid, proposed } = await seeded(db);
  const before = sheetOf(db);
  await store.endMirrorSession(db, OWNER, REPLICA, sid);
  const result = await store.decideMirrorDelta(db, OWNER, REPLICA, sid, proposed.delta_id, "accepted",
    { pendingDelta: proposed });
  eq(result.row, null, "a delta cannot be decided after the call has ended");
  eq(sheetOf(db), before, "and the sheet is untouched");
}

// 5g — a non-owner cannot decide, and cannot read the chip to decide it with.
{
  const db = fakeDb();
  const { sid, proposed } = await seeded(db);
  const before = sheetOf(db);
  eq(await store.getProposedMirrorDelta(db, STRANGER, REPLICA, sid, proposed.delta_id), null,
    "a non-owner cannot read someone else's un-actioned chip");
  const result = await store.decideMirrorDelta(db, STRANGER, REPLICA, sid, proposed.delta_id, "accepted",
    { pendingDelta: proposed });
  eq(result.row, null, "a non-owner cannot accept a chip on someone else's clone");
  eq(sheetOf(db), before, "and the sheet is untouched");
}

// 5h — an ADVISORY chip is accept-able and writes nothing.
{
  const db = fakeDb();
  const { sid } = await seeded(db);
  const advisory = (await store.listMirrorDeltas(db, OWNER, REPLICA, sid))
    .find((d) => d.kind === "filler_advisory");
  ok(Boolean(advisory), "an advisory chip was proposed");
  const before = sheetOf(db);
  const result = await store.decideMirrorDelta(db, OWNER, REPLICA, sid, advisory.delta_id, "accepted",
    { pendingDelta: advisory });
  eq(result.row.state, "accepted", "the owner's judgement on an advisory chip is recorded");
  eq(result.row.applied_at, null, "and it is not applied");
  eq(sheetOf(db), before, "ACCEPTING AN ADVISORY CHIP MOVES NO SHEET BYTE");
}

// ═════════════════════════════════════════════════════════════════════════
// 6. THE VOICE LOOP: SELECTION, NOT ACCUMULATION (WS-Z A1/A2/A3)
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 6. selection, not accumulation ──");

// A1 — the truncation constants are the shipped model's, and the scorer refuses
// to rank anything the T3 slice cannot fill.
eq(pure.CONDITIONING_S3GEN_MS, 10_000, "the S3Gen conditioning slice is 10 s");
eq(pure.CONDITIONING_T3_MS, 6_000, "the T3 speech-prompt slice is 6 s");
eq(pure.conditioningMs(30_000), 10_000, "a 30 s window conditions on 10 s and no more");
eq(pure.conditioningMs(7_000), 7_000, "a 7 s window conditions on all of itself");

const goodProbe = { activeRatio: 0.9, rms: 0.12, clippedRatio: 0 };
const quietProbe = { activeRatio: 0.35, rms: 0.02, clippedRatio: 0 };
const clippedProbe = { activeRatio: 0.9, rms: 0.30, clippedRatio: 0.15 };
eq(pure.conditioningScore(goodProbe, 3_000), null,
  "a window shorter than the T3 slice is REFUSED a rank, not given a low one");
ok(pure.conditioningScore(goodProbe, 10_000) > pure.conditioningScore(quietProbe, 10_000),
  "clean loud speech outranks a mostly-silent window");
ok(pure.conditioningScore(goodProbe, 10_000) > pure.conditioningScore(clippedProbe, 10_000),
  "clipping is penalised — a hot window is not a good conditioning window");
ok(pure.conditioningScore({ activeRatio: 0.9, rms: 0.30, clippedRatio: 0 }, 10_000)
   <= pure.conditioningScore({ activeRatio: 0.9, rms: 0.09, clippedRatio: 0 }, 10_000) + 0.001,
  "level is a plateau, not a ramp — the scorer does not select for shouting");

// A3 — OWNER-ONLY ADMISSION, with the negative controls the redirect asked for.
{
  const db = fakeDb({ scopes: ["capture", "storage", "transcription", "training"] });
  const session = await store.openMirrorSession(db, OWNER, REPLICA);
  const sid = session.session_id;
  eq(session.reference_consent, true, "consent is live, so admission is decided by the own-voice predicate alone");

  const cases = [
    { seq: 1, similarity: null, overlap: false, state: "unverified", admitted: false,
      what: "an UNMEASURED window fails closed" },
    { seq: 2, similarity: 0.91, overlap: true, state: "clone_overlap", admitted: false,
      what: "A CLONE-OVERLAPPING WINDOW IS REFUSED even at a high similarity (recursive training)" },
    { seq: 3, similarity: 0.21, overlap: false, state: "foreign_speaker", admitted: false,
      what: "A THIRD SPEAKER IS REFUSED — they consented to nothing" },
    { seq: 4, similarity: 0.88, overlap: false, state: "owner_verified", admitted: true,
      what: "the measured owner IS admitted (so the refusals above are not vacuous)" },
  ];
  for (const c of cases) {
    const row = await store.recordMirrorWindow(db, OWNER, REPLICA, sid,
      { seq: c.seq, durationMs: 9_000, sourceId: SOURCE, cloneOverlap: c.overlap },
      { ownerSimilarity: c.similarity });
    eq(row.own_voice_state, c.state, `seq ${c.seq}: own_voice_state is ${c.state}`);
    eq(row.reference_admitted, c.admitted, c.what);
    ok(row.admission_reason !== "", `seq ${c.seq}: the admission verdict names its reason`);
  }
  eq(pure.MIRROR_OWNER_SIMILARITY_FLOOR, 0.62, "the similarity floor is a named constant, not a literal");

  // A1 — selection: only SCORED, long-enough, ADMITTED candidates are eligible.
  const windows = await store.listMirrorWindows(db, OWNER, REPLICA, sid);
  eq(pure.bestConditioningCandidate(windows), null,
    "nothing is selectable while every candidate is unscored");
  const admitted = windows.find((w) => w.reference_admitted);
  await store.scoreMirrorWindow(db, OWNER, REPLICA, admitted.window_id, 0.55, "wav_probe");
  const scored = await store.listMirrorWindows(db, OWNER, REPLICA, sid);
  const best = pure.bestConditioningCandidate(scored);
  eq(best?.window_id, admitted.window_id, "the one scored admitted candidate is the best candidate");

  const first = await store.selectConditioningWindow(db, OWNER, REPLICA, sid, best);
  ok(Boolean(first), "a first selection installs");
  eq(db.state.conditioning.filter((c) => !c.superseded_at).length, 1,
    "and there is exactly ONE standing selection");

  // Strictly-better-only: an equal score keeps the incumbent.
  const equal = await store.selectConditioningWindow(db, OWNER, REPLICA, sid,
    { ...best, quality_score: 0.55 });
  eq(equal, null, "an EQUAL score does not replace the selection — the voice does not move for no reason");
  eq(db.state.conditioning.filter((c) => !c.superseded_at)[0].selection_id, first.selection_id,
    "the incumbent stands");

  const better = await store.selectConditioningWindow(db, OWNER, REPLICA, sid,
    { ...best, quality_score: 0.81 });
  ok(Boolean(better), "a STRICTLY better candidate does replace it");
  eq(db.state.conditioning.filter((c) => !c.superseded_at).length, 1,
    "and there is still exactly one standing selection");
  eq(db.state.conditioning.filter((c) => c.superseded_at).length, 1,
    "the superseded row is KEPT — the history of which ten seconds was chosen is the evidence");

  // A2 — TWO numbers, and they are allowed to disagree.
  const standing = await store.standingConditioning(db, OWNER, REPLICA);
  const fidelity = wire.wireFidelity({
    fidelityRow: null, pooledMs: 120_000, pooledWindows: 12,
    selection: standing, selections: 2, ceiling: 0.8869,
  });
  eq(fidelity.measurement_score, null,
    "measurement_score is NULL with no fidelity row — never 0, which renders as a terrible clone");
  eq(fidelity.pooled_seconds, 120, "pooled seconds grow with the pool");
  eq(fidelity.conditioning_window_score, 0.81, "conditioning score is the SELECTED window's");
  eq(fidelity.conditioning_seconds, 9, "conditioning seconds are the selected window's slice");
  eq(fidelity.window_selections, 2, "the selection count is reported");
  eq(fidelity.conditioning_score_source, "wav_probe",
    "and the payload says which SCALE that number is on — it is not ECAPA today");
  ok(!("overall" in fidelity) && !("score" in fidelity),
    "there is NO combined figure for a UI to reach for");
  eq(fidelity.ceiling, 0.8869, "the printed self-vs-self ceiling rides with both meters");
  eq(fidelity.family, "speechbrain-ecapa-voxceleb", "the family is named, so the scale is legible");
}

// The candidate-pool arithmetic, and the number that actually matters.
{
  const db = fakeDb();
  const session = await store.openMirrorSession(db, OWNER, REPLICA);
  for (const seq of [1, 2, 3]) {
    const p = await store.recordMirrorWindow(db, OWNER, REPLICA, session.session_id,
      pure.mirrorWindowInput({ seq, duration_ms: 8_000, source_id: SOURCE }));
    await store.settleMirrorWindow(db, OWNER, REPLICA, p.window_id,
      { transcript: "dekho beta basically", provider: "sarvam-sync", model: "saarika:v2.5" });
  }
  const windows = await store.listMirrorWindows(db, OWNER, REPLICA, session.session_id);
  const baseline = await store.mirrorReferenceBaseline(db, OWNER, REPLICA, session.session_id);
  const growth = pure.mirrorReferenceGrowth(windows, baseline);
  eq(growth.added_windows, 0, "with no modelling consent, NOTHING joins the candidate pool");
  eq(growth.total_windows, 0, "so the total does not move");
  eq(growth.selectable_candidates, 0, "and nothing is selectable");
  eq(growth.withheld_windows.length, 1, "the withholding is reported as one reason");
  eq(growth.withheld_windows[0].reason, "consent_scope_missing:training",
    "which names the exact scope that is missing");
  eq(growth.withheld_windows[0].count, 3, "for every window it applied to");
  eq(windows.every((w) => w.asr_state === "transcribed"), true,
    "the windows still transcribed — the voice loop is gated, the personality loop is not");
  ok(String(growth.pool_growth_is_not_improvement).includes("10 s"),
    "and the payload states that pool growth is not improvement");
}

{
  const db = fakeDb({ scopes: ["capture", "storage", "transcription", "training"] });
  const session = await store.openMirrorSession(db, OWNER, REPLICA);
  const sid = session.session_id;
  for (const [seq, ms] of [[1, 8_000], [2, 12_000], [3, 5_000]]) {
    const p = await store.recordMirrorWindow(db, OWNER, REPLICA, sid,
      { seq, durationMs: ms, sourceId: SOURCE, cloneOverlap: false }, { ownerSimilarity: 0.9 });
    await store.settleMirrorWindow(db, OWNER, REPLICA, p.window_id,
      { transcript: "dekho beta basically", provider: "sarvam-sync", model: "saarika:v2.5" });
    // Only the two long enough to fill the T3 slice can ever be selected.
    if (ms >= 6_000) await store.scoreMirrorWindow(db, OWNER, REPLICA, p.window_id, 0.5, "wav_probe");
  }
  const p4 = await store.recordMirrorWindow(db, OWNER, REPLICA, sid,
    { seq: 4, durationMs: 9_000, sourceId: null, cloneOverlap: false }, { ownerSimilarity: 0.9 });
  await store.settleMirrorWindow(db, OWNER, REPLICA, p4.window_id, { failureCode: "no_audio_reference" });

  const windows = await store.listMirrorWindows(db, OWNER, REPLICA, sid);
  const growth = pure.mirrorReferenceGrowth(windows, { windows: 4, ms: 71_000 });
  eq(growth.baseline_windows, 4, "the baseline is carried, not recomputed");
  eq(growth.added_windows, 3, "three consented owner-verified windows joined the pool");
  eq(growth.added_ms, 25_000, "8000 + 12000 + 5000 = 25000 ms added");
  eq(growth.total_windows, 7, "4 + 3 = 7 pooled windows");
  eq(growth.total_ms, 96_000, "71000 + 25000 = 96000 ms of pooled audio");
  eq(growth.selectable_candidates, 2,
    "but only TWO are SELECTABLE — the 5 s window cannot fill the T3 slice, and pool size is not the number that matters");
  eq(growth.unscored_candidates, 1, "the unscored one is counted, not silently ignored");
  eq(growth.withheld_windows.length, 1, "the objectless window is withheld");
  eq(growth.withheld_windows[0].reason, "no_stored_object", "and says why");

  const ended = await store.endMirrorSession(db, OWNER, REPLICA, sid);
  eq(ended.reembedding_jobs, 1,
    "re-embedding is triggered — one voice_quality job per distinct consented source");
  eq(db.state.processing[0].step, "voice_quality",
    "against the queue api/_replica-processing/worker.js already leases");
  eq(ended.finetune_reference_windows, 3, "the fine-tune row records how much reference it was queued on");
  eq(ended.finetune_reference_ms, 25_000, "in milliseconds");
  eq(db.state.finetune[0].state, "queued",
    "and its state is queued — nothing in this repo runs it, which is the honest answer");
  eq(db.state.finetune[0].lane, "per_expert_adapter",
    "on the per-expert-adapter lane — never a sequence of fine-tunes on a shared base");
  eq(db.state.finetune.length, 1, "exactly one fine-tune row per session");
}

// ═════════════════════════════════════════════════════════════════════════
// 7. FEEDBACK IS EVIDENCE, NOT A SHEET EDIT
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 7. feedback ──");

{
  const db = fakeDb();
  const session = await store.openMirrorSession(db, OWNER, REPLICA);
  const before = sheetOf(db);
  const input = pure.mirrorFeedbackInput({
    turn_ref: "turn-7", verdict: "rephrase",
    rephrase_text: "Main aisa kabhi nahi bolta, main kehta hoon dekho beta.",
  });
  const row = await store.recordMirrorFeedback(db, OWNER, REPLICA, session.session_id, input);
  ok(Boolean(row), "feedback is recorded against the turn it judged");
  eq(row.turn_ref, "turn-7", "bound to that turn");
  eq(sheetOf(db), before,
    "THE OWNER'S OWN SENTENCE DOES NOT REACH THE SHEET — it is the most recitable thing there is");

  // WS-Z §4.4 — judgement is its own origin and can never write a field.
  const chip = await store.proposeMirrorDelta(db, OWNER, REPLICA, session.session_id, {
    kind: "feedback_note", fragment: "rephrase:turn-7", targetField: "",
    origin: "judgement", occurrences: 0, corpusTokens: 0,
    evidence: { verdict: "rephrase" }, citation: { turn_id: "turn-7", quote: "", occurrences: 0 },
    citedWindows: [],
  });
  eq(chip.origin, "judgement", "a feedback chip is origin=judgement, in its own column");
  eq(chip.target_field, "", "and writes no sheet field, ever");

  // The CHECK that makes that structural, exercised.
  let raised = "";
  try {
    await store.proposeMirrorDelta(db, OWNER, REPLICA, session.session_id, {
      kind: "feedback_note", fragment: "sneaky", targetField: "boardVerbalisms",
      origin: "judgement", occurrences: 1, corpusTokens: 1,
      evidence: {}, citation: { turn_id: "t", quote: "", occurrences: 1 }, citedWindows: [1],
    });
  } catch (error) { raised = String(error.message); }
  ok(raised.includes("judgement_advisory"),
    "A JUDGEMENT CHIP WITH A SHEET TARGET IS UNREPRESENTABLE — the sycophancy loop cannot close");

  threw = "";
  try { pure.mirrorFeedbackInput({ turn_ref: "t", verdict: "rephrase" }); }
  catch (error) { threw = error.code; }
  eq(threw, "mirror_feedback_rephrase_required", "a rephrase with no rephrasing is refused");

  eq(await store.recordMirrorFeedback(db, STRANGER, REPLICA, session.session_id, input), null,
    "a non-owner cannot leave feedback on someone else's call");
}

// ═════════════════════════════════════════════════════════════════════════
// 8. THE WIRE: WOULD THE STUDIO'S OWN NORMALIZER ACCEPT THIS?
// ═════════════════════════════════════════════════════════════════════════
//
// `src/studio/mirrorCallApi.ts::normalizeDelta` REFUSES a chip with no citation
// at the door and forces `applied` false unless the status is 'accepted'. Those
// rules are re-implemented here against the REAL wire adapter's output, so a
// payload the studio would throw on fails this suite instead of failing a call.
console.log("\n── 8. the wire ──");

{
  const db = fakeDb();
  const { sid } = await seeded(db);
  const rows = await store.listMirrorDeltas(db, OWNER, REPLICA, sid);
  const payload = wire.wireDeltas(rows);
  ok(payload.length > 0, "the wire renders the chips");
  for (const chip of payload) {
    ok(typeof chip.delta_id === "string" && chip.delta_id, "every chip has an id");
    ok(["phrase_habit", "register", "boundary", "fact", "delivery"].includes(chip.kind),
      `chip kind "${chip.kind}" is one the studio's union admits`);
    ok(["proposed", "deferred", "accepted", "rejected"].includes(chip.status),
      `chip status "${chip.status}" is one the studio's union admits`);
    ok(typeof chip.citation?.turn_id === "string" && chip.citation.turn_id,
      "EVERY CHIP CARRIES A CITATION — the studio refuses one without at the door");
    ok(typeof chip.citation?.quote === "string", "with a quote field");
    ok(Number.isFinite(chip.evidence.occurrences_this_call), "and an occurrences_this_call");
    ok(Number.isFinite(chip.evidence.occurrences_total), "and an occurrences_total");
    ok(Number.isFinite(chip.evidence.calls), "and a call count");
    ok(Number.isFinite(chip.evidence.corpus_words), "and a corpus word count");
    ok(chip.applied === false, "an un-actioned chip is never reported applied");
    ok(!/[.!?]$/.test(chip.proposal), "a proposal is a described shape, not a sentence to recite");
  }
  const writable = payload.find((c) => c.field === "boardVerbalisms");
  ok(Boolean(writable), "a writable chip is on the wire");
  ok(writable.proposal.includes("boardVerbalisms"), "and its proposal names the field it would change");
  const advisory = payload.find((c) => c.field === "");
  ok(Boolean(advisory), "an advisory chip is on the wire");
  ok(advisory.proposal.includes("changes no sheet field"),
    "and it SAYS it changes no sheet field, so a studio cannot imply it did");

  // The applied flag after a real accept.
  const target = rows.find((d) => d.target_field === "boardVerbalisms");
  const { row } = await store.decideMirrorDelta(db, OWNER, REPLICA, sid, target.delta_id, "accepted",
    { pendingDelta: target });
  const acceptedChip = wire.wireDelta(row);
  eq(acceptedChip.status, "accepted", "an accepted chip reports accepted");
  eq(acceptedChip.applied, true, "and applied, because the sheet actually moved");

  // The handshake's own promises.
  eq(wire.MIRROR_CALL_CONTRACT, "mirror-call/v1", "the contract version matches the client's");
  for (const op of ["create", "end", "ingest_window", "deltas", "delta_action", "turn_feedback"]) {
    ok(wire.MIRROR_CALL_OPS.includes(op), `the handshake serves REQUIRED op ${op}`);
  }
  ok(wire.MIRROR_CALL_UNSERVED_OPS.includes("turn_voice"),
    "turn_voice is declared UNSERVED rather than advertised and silent");
  ok(!wire.MIRROR_CALL_OPS.includes("turn_voice"),
    "and it is absent from the served list, so the studio falls back to captions and says so");
  eq(wire.MIRROR_CALL_TRANSPORT.ingest_window, "source_handle",
    "the transport deviation is DECLARED on the handshake, not discovered mid-call");
}

// ═════════════════════════════════════════════════════════════════════════
// 9. THE CHIP BUDGET (WS-Z A5)
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 9. the chip budget ──");

{
  const deltas = [
    { kind: "feedback_note", fragment: "a", evidence: { count: 99 }, occurrences: 99 },
    { kind: "filler_advisory", fragment: "b", evidence: { count: 3 }, occurrences: 3 },
    { kind: "phrase_habit", fragment: "c", evidence: { count: 9 }, occurrences: 9 },
    { kind: "phrase_habit", fragment: "d", evidence: { count: 4 }, occurrences: 4 },
    { kind: "slang_habit", fragment: "e", evidence: { count: 7 }, occurrences: 7 },
  ];
  const { propose, deferred, allowance } = pure.budgetChips(deltas, 60_000, 0);
  eq(allowance, pure.MIRROR_CHIP_BUDGET_PER_MIN, "one minute of call buys one minute of budget");
  eq(propose.length, 3, "and exactly that many chips reach the rail");
  eq(deferred.length, 2, "the surplus is DEFERRED, never dropped");
  eq(propose[0].fragment, "c", "the highest-evidence FEATURE chip goes first");
  ok(!propose.some((d) => d.kind === "feedback_note"),
    "a LABEL query does not outrank a feature query, whatever its count — feature queries were the preferred kind");
  eq(deferred.some((d) => d.kind === "feedback_note"), true, "the label chip is the one that waits");

  const later = pure.budgetChips(deltas, 600_000, 0);
  eq(later.allowance, 30, "ten minutes of call buys ten minutes of budget");
  eq(later.deferred.length, 0, "and nothing needs deferring");

  const spent = pure.budgetChips(deltas, 60_000, 3);
  eq(spent.allowance, 0, "a budget already spent proposes nothing more this minute");
  eq(spent.deferred.length, 5, "and everything waits for the review queue");
}

// ═════════════════════════════════════════════════════════════════════════
// 10. ERASURE REACH, WALKED ON THE CHECKED-IN DDL
// ═════════════════════════════════════════════════════════════════════════
//
// scripts/relcheck.mjs asks this of the LIVE database and is the better place
// to ask it — but it needs NEON_URL and skips without one, and NOTHING in this
// environment has a database. So the same walk runs here over db/schema.sql:
// every Mirror Call table carries owner_user_id, so it is on the owner lane and
// deliberately outside PERSON_TABLES, and the owner lane's whole exemption
// rests on the erasure chain reaching it.
console.log("\n── 10. erasure reach ──");

{
  const ddl = readFileSync(join(REPO, "db/schema.sql"), "utf8");
  const erasure = readFileSync(join(REPO, "api/_replica-full-erasure.js"), "utf8");
  const MIRROR_TABLES = [
    "vy_mirror_session", "vy_mirror_window", "vy_mirror_delta",
    "vy_mirror_feedback", "vy_mirror_finetune_job", "vy_mirror_conditioning",
  ];
  for (const table of MIRROR_TABLES) {
    const body = ddl.split(`create table if not exists ${table} (`)[1]?.split("\n);")[0] ?? "";
    ok(body.includes("owner_user_id"), `${table} carries owner_user_id (it is on the owner lane)`);
    ok(/references vy_replica \(replica_id, owner_user_id\) on delete cascade/.test(body),
      `${table} cascades from vy_replica — relcheck's owner-lane reach walk is satisfied`);
  }
  for (const table of MIRROR_TABLES) {
    ok(new RegExp(`delete from ${table}\\b`).test(erasure),
      `${table} is ALSO deleted by name in api/_replica-full-erasure.js (two layers, not one)`);
  }
  ok(erasure.includes("mirror_call_sessions"),
    "the deletion receipt names a mirror_call class, so it answers the question that was asked");

  ok(ddl.includes("duration_ms integer not null check (duration_ms > 0 and duration_ms <= 30000)"),
    "the 30 s sync cap is a CHECK constraint, not only a JS guard");
  ok(ddl.includes("check (applied_at is null or state = 'accepted')"),
    "applied-implies-accepted is a CHECK — a row that touched the sheet without a tap cannot exist");
  ok(ddl.includes("check (asr_state <> 'dropped' or failure_code <> '')"),
    "a reasonless drop is unrepresentable");
  ok(ddl.includes("check (not reference_admitted or own_voice_state = 'owner_verified')"),
    "own-voice admission is a CHECK — an unverified speaker cannot enter the pool by any statement");
  ok(ddl.includes("check (origin <> 'judgement' or target_field = '')"),
    "a judgement chip with a sheet target is unrepresentable");
  ok(ddl.includes("check (lane in ('per_expert_adapter'))"),
    "the fine-tune queue cannot describe a shared-base sequential job");
  ok(ddl.includes("create unique index if not exists vy_mirror_conditioning_standing_ix"),
    "at most one standing conditioning selection per replica");
}

// ═════════════════════════════════════════════════════════════════════════
// 11. THE HARNESS ITSELF
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 11. the harness ──");
{
  const db = fakeDb();
  eq(db.state.unmatched.length, 0, "a fresh fake has no unmatched statements");
  let raised = "";
  try { await db("select 1 from somewhere_unknown", []); }
  catch (error) { raised = String(error.message).slice(0, 25); }
  eq(raised, "fake db has no branch for", "an unrecognised statement THROWS rather than answering []");
}

console.log(
  failed
    ? `\nmirrorcall: ${failed} of ${checks} checks FAILED`
    : `\nmirrorcall: ok (${checks} checks)`,
);
process.exit(failed ? 1 : 0);
