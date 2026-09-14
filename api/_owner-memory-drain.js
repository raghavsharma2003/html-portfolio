import { createHash } from "node:crypto";
import { strictRoomConsolidationConfig } from "./_consolidation-config.js";
import { foundryBudgetConfig } from "./_provider-budget.js";
import {
  ROOM_MEMORY_CLAIM_SQL,
  ROOM_MEMORY_RELEASE_SQL,
  roomMemorySweepEnabled,
  runMeteredOwnerMemoryConsolidation,
} from "./_room-memory-consolidation.js";
import { ownerMemoryDrainCandidate } from "./_replica-dialogue.js";

const REQUEST_ID = /^[A-Za-z0-9_-]{8,96}$/;

function fail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status });
}

export function ownerMemoryDrainRunId(ownerUserId, replicaId, requestId) {
  if (!REQUEST_ID.test(String(requestId || ""))) fail("owner_memory_request_id_invalid", 400);
  const binding = `${ownerUserId}:${replicaId}:${requestId}`;
  return `owner-post-turn:${createHash("sha256").update(binding, "utf8").digest("hex")}`;
}

export function assertOwnerMemoryDrainConfigured(env = process.env) {
  if (!roomMemorySweepEnabled(env) || ["1", "true", "yes"].includes(String(env.CONSOLIDATE_KILL || "").toLowerCase())) {
    fail("owner_memory_drain_unavailable");
  }
  strictRoomConsolidationConfig(env);
  foundryBudgetConfig(env);
}

// One authenticated owner request can touch one requested replica and one
// agent/person dyad. The provider await happens inside this function; callers
// may leave it off the visible reply's critical path, but the HTTP response is
// never returned before commit, a truthful skip, or a named failure.
export async function drainOwnerMemory({
  db,
  ownerUserId,
  input,
  model,
  env = process.env,
  fetchImpl = globalThis.fetch,
  resolveCandidate = ownerMemoryDrainCandidate,
  runConsolidation = runMeteredOwnerMemoryConsolidation,
} = {}) {
  if (typeof db !== "function" || typeof model !== "function" || typeof resolveCandidate !== "function") {
    fail("owner_memory_drain_binding_required");
  }
  assertOwnerMemoryDrainConfigured(env);
  const requestId = String(input?.request_id || "");
  if (!REQUEST_ID.test(requestId)) fail("owner_memory_request_id_invalid", 400);
  const candidate = await resolveCandidate(db, ownerUserId, input);
  if (!candidate) return { state: "off", facts_written: 0, sources_consumed: 0 };
  const runId = ownerMemoryDrainRunId(ownerUserId, candidate.replica_id, requestId);
  const claimed = await db(ROOM_MEMORY_CLAIM_SQL, [candidate.agent_id, candidate.person_id, runId]);
  if (claimed.length !== 1) return { state: "pending", facts_written: 0, sources_consumed: 0 };
  try {
    const result = await runConsolidation(candidate, { queryFn: db, llm: model, runId, env, fetchImpl });
    if (result?.skipped) {
      return { state: "idle", reason: String(result.skipped), facts_written: 0, sources_consumed: 0 };
    }
    return {
      state: "updated",
      facts_written: Number(result?.facts_written || 0),
      sources_consumed: Number(result?.sources_consumed || 0),
    };
  } catch (error) {
    // A lost response or commit race must not replay a settled paid request.
    // The hourly sweep can use a fresh run id for any source still pending.
    if (["provider_spend_already_settled", "provider_spend_reconciliation_required"].includes(String(error?.code || error?.message))) {
      return { state: "pending", facts_written: 0, sources_consumed: 0 };
    }
    throw error;
  } finally {
    await db(ROOM_MEMORY_RELEASE_SQL, [candidate.agent_id, candidate.person_id, runId]).catch(() => []);
  }
}
