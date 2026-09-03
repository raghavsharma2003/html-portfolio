// The clone↔surface binding — migration 055's read and write halves.
//
// THE ONE SENTENCE THIS FILE EXISTS FOR: on this wire, at this address, which
// published clone replies? Before it, `api/_surface.js` answered with a
// constant — `MEERA_AGENT_ID`, named in `ensureRoomForSurfaceChat` and
// `upsertRoomMember` — which is correct for a product with one agent and is
// the reason a second clone on Telegram was a code change.
//
// ── what this file is NOT allowed to become ───────────────────────────────
//
// A tenancy boundary. docs/SURFACES.md §0 states the law and it is unchanged
// by everything here: a surface is a TRANSPORT, it is not a tenant, and it
// scopes nothing. `vy_surface_identity` still has no `agent_id` and must never
// gain one — the same human is the same person on Telegram and on the web,
// whoever they are talking to. So the resolution below has exactly two
// independent halves that meet and do not mix:
//
//   WHO IS SPEAKING   `vy_surface_identity` — agent-independent, api/_room.js's
//                     `personForSurfaceUser`, untouched by this file.
//   WHO ANSWERS       `vy_clone_channel` — this file, and it yields an agent,
//                     never a person and never a scope.
//
// The agent then enters at RETRIEVAL, exactly as api/_agentscope.js says it
// must. A binding that also filtered identity would make "she remembers me
// from Telegram" false on the web for no reason a user could ever be told.
//
// ── FAIL CLOSED, with ONE indistinguishable error ─────────────────────────
//
// An unbound channel, a paused or revoked binding, an unpublished clone and a
// withdrawn consent artifact all produce `clone_unavailable`. That is WS-B's
// precedent, stated in api/_teachersheet.js and binding here for the same
// reason: a caller that could tell those cases apart could enumerate which
// teachers had revoked their consent, and "this teacher has revoked" is the
// teacher's business. Unreachable is unreachable.
//
// And never toward Meera. There is NO fallback branch in this file. A
// wrong-agent fallback is the disaster case for this product — the student
// asked their physics teacher and reached a companion persona built for
// consenting adults, with none of the minor defaults and none of the clone
// disclosure, and every log line would look healthy.
import { randomUUID } from "node:crypto";
import { loadTeacherAgent } from "./_teachersheet.js";
import { READINESS_OVERALL_FLOOR, READINESS_PART_FLOOR } from "./_readiness.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Migration 055's `kind` domain, mirrored so a studio can enumerate it
 *  rather than restate it. A list kept in sync by hand is a list that will
 *  not be — `evals/clonechannel.mjs` asserts this against the migration text. */
export const CLONE_CHANNEL_KINDS = Object.freeze([
  "web_widget",
  "web_embed",
  "telegram",
  "whatsapp",
  "instagram_dm",
]);

/** The kinds this deployment can actually connect today. `instagram_dm` is
 *  present in the schema and absent here on purpose: the adapter does not
 *  exist, the approval chain is months long, and the honest record of why is
 *  docs/gurukul/INSTAGRAM-DM-GAP.md. A kind that is storable but not
 *  connectable is a to-do the studio can render; a kind that pretends to
 *  connect is a teacher told their audience can reach them when it cannot. */
export const CONNECTABLE_KINDS = Object.freeze(["web_widget", "web_embed", "telegram", "whatsapp"]);

/** The kinds served by this deployment, which is why they need no credential
 *  (migration 055's connect gate exempts exactly these two). */
export const WEB_KINDS = Object.freeze(["web_widget", "web_embed"]);

export const CLONE_CHANNEL_STATUSES = Object.freeze(["draft", "connected", "paused", "revoked"]);

// ─────────────────────────────────────────────────────────────────────────
// THE PUBLISH LOCK, AT CONNECT TIME (Vyakti Rooms v1, WS-R3)
// ─────────────────────────────────────────────────────────────────────────
//
// Connecting a channel is the moment a clone stops being private, so it is the
// moment readiness has to hold: 70 overall, 55 on every part, nothing
// unmeasured, read off the LATEST snapshot.
//
// It is a SQL fragment rather than a branch above the write for migration
// 051's reason, quoted in its own header: "prompt instructions leaked 57-98%;
// the SQL predicate leaked 0 of 31,122 ... A sentence in a brief is a
// preference; a predicate on the output is a guarantee." A JS check would be a
// preference, and it would be the third place in this file where a status is
// decided. So `status` is decided by a CASE that cannot be reached around, and
// a request to connect that the CASE refuses lands as `draft` — the fail-closed
// direction — with the owner told why by name afterwards.
//
// `computed_at = max(computed_at)` is the same load-bearing clause the runtime
// activation join carries: without it, a clone that passed once and has since
// regressed would connect off its own best day.
// Parameterised by placeholder NUMBER rather than pasted verbatim, because the
// two writers below bind their arguments in different orders and a fragment
// that hardcoded `$7` would silently compare a floor against a channel kind in
// one of them. The first four arguments are always (owner, replica, overall
// floor, part floor).
const readinessPasses = (owner, replica, overallFloor, partFloor) => `exists (
      select 1 from vy_replica_readiness x
       where x.replica_id = (${replica})::uuid and x.owner_user_id = (${owner})::uuid
         and x.unmeasured_count = 0
         and x.overall >= (${overallFloor})::int4 and x.min_part >= (${partFloor})::int4
         and x.computed_at = (select max(y.computed_at) from vy_replica_readiness y
                               where y.replica_id = (${replica})::uuid
                                 and y.owner_user_id = (${owner})::uuid)
    )`;

/** The named refusal. Distinct from `clone_unavailable` on purpose: that code
 *  is the INBOUND one, where telling a stranger apart from a revoked teacher
 *  would let them enumerate revocations. This one is returned to the OWNER,
 *  about their own clone, and an owner who is refused deserves the reason. */
export const CHANNEL_READINESS_BLOCKER = "clone_channel_readiness_locked";

export class CloneChannelError extends Error {
  constructor(code, status = 500, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

/** THE indistinguishable one. Every reason a clone cannot answer collapses
 *  here — see the header for why that is a property and not laziness. */
export const cloneUnavailable = () => new CloneChannelError("clone_unavailable", 404);

// ─────────────────────────────────────────────────────────────────────────
// THE APP-VOICED DISCLOSURE (safety-floor-teacher.md §1, predicate P1)
// ─────────────────────────────────────────────────────────────────────────
//
// THIS TEXT IS NOT PROMPT TEXT AND NEVER REACHES THE MODEL. It is sent by the
// app, deterministically, in the app's voice — `api/_surface.js`'s ROOM_CARD
// rail, and `clock.ts`'s law before it: "the timer speaks as the APP, never as
// her (§0.3 adjudication — instruction ≠ emission is measured, so a statutory
// disclosure can never ride on a persona rule)."
//
// It is byte-identical to what `src/studio/DisclosurePreview.tsx` shows the
// teacher before they publish, because a disclosure the teacher consented to
// and a disclosure the student sees that differ by one word is a consent
// artifact that does not cover the product.
//
// P1's delta over the incumbent: fire at n=0 of EVERY session, not only at the
// 2h/3h boundary. Cheap, and the only disclosure guaranteed to be seen.
export function cloneDisclosureCard(teacherName) {
  const name = String(teacherName || "").trim() || "this teacher";
  return [
    `You're talking with an AI clone of ${name}.`,
    `Built from ${name}'s own recorded teaching, published by them. This is not ${name} — they are not reading these conversations, and nothing said here reaches them unless you're told plainly that it will.`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// RESOLUTION — the inbound half
// ─────────────────────────────────────────────────────────────────────────

/**
 * The binding row for one surface address, or null.
 *
 * `status = 'connected'` is IN THE PREDICATE, not applied after. That is
 * api/_disclosure.js's discipline transferred and the argument transfers with
 * it: a disqualified row that reaches JS can still be logged, partially
 * rendered, or escape through a branch added later. Here the disqualified row
 * is a channel a teacher PAUSED or REVOKED, and the branch added later is
 * whoever decides a paused clone should send a friendly "I'm away" message.
 *
 * `external_ref` is compared as text and never parsed — docs/SURFACES.md's
 * rule for a chatKey, and it holds for a channel address for the same reason:
 * the moment this file learns that a Telegram bot id is numeric, it is a file
 * that knows about Telegram.
 */
export async function resolveChannelBinding(db, kind, externalRef) {
  if (typeof db !== "function") throw new CloneChannelError("clone_channel_db_required", 500);
  const k = String(kind || "");
  const ref = String(externalRef || "");
  if (!CLONE_CHANNEL_KINDS.includes(k) || !ref) return null;
  const rows = await db(
    `select c.channel_id, c.agent_id, c.replica_id, c.owner_user_id,
            c.kind, c.external_ref, c.credentials_ref, c.status, a.slug
       from vy_clone_channel c
       join vy_agent a on a.agent_id = c.agent_id
      where c.kind = $1
        and c.external_ref = $2
        and c.status = 'connected'
      limit 1`,
    [k, ref],
  );
  return rows[0] || null;
}

/**
 * The whole inbound resolution: address → binding → PUBLISHED clone module.
 *
 * Returns `{ channel, agentId, slug, module, sheet }`. Throws
 * `clone_unavailable` on every failure, including the ones the loader would
 * have distinguished — `loadTeacherAgent` throws four different codes
 * (unavailable / consent_gate / invalid / slug_mismatch) and every one of them
 * means "this clone may not speak", so they are flattened here rather than at
 * the endpoint, where the next endpoint would have to remember to do it.
 *
 * The loader is injectable so an offline suite can drive the REAL resolution
 * without a database behind `api/_teachersheet.js` — the same seam
 * `api/_channel-ingest.js` uses for its providers, and for the same reason.
 */
export async function resolveInboundClone(db, kind, externalRef, { loadAgent = loadTeacherAgent } = {}) {
  const channel = await resolveChannelBinding(db, kind, externalRef);
  if (!channel) throw cloneUnavailable();
  let loaded;
  try {
    loaded = await loadAgent(channel.slug);
  } catch {
    // Deliberately swallowed and replaced. The loader's `details` carry a
    // sheet id and a blocker list, which is exactly what a studio needs and
    // exactly what a wire must never learn.
    throw cloneUnavailable();
  }
  if (!loaded?.module) throw cloneUnavailable();
  return {
    channel,
    agentId: channel.agent_id,
    slug: channel.slug,
    module: loaded.module,
    sheet: loaded.sheet,
  };
}

/** The display name the disclosure card names, taken from the SHEET rather
 *  than from the channel row or the agent's display name. `sheet.name` is the
 *  field the consent artifact must byte-match (safety-floor-teacher.md §2.1:
 *  "a clone published under a name the artifact does not cover is
 *  impersonation"), so it is the only name the card may carry. */
export const disclosureNameFor = (sheet) => String(sheet?.name || "").trim();

// ─────────────────────────────────────────────────────────────────────────
// OWNER OPS — the studio half
// ─────────────────────────────────────────────────────────────────────────
//
// Every statement below carries `owner_user_id = $n` INSIDE the WHERE clause,
// api/_teacher-sheet-draft.js's rule, and returns null rather than throwing a
// 403 for a row that is not this owner's: "not yours" and "does not exist"
// must be the same answer, because a 403 on someone else's uuid is an
// existence oracle and the uuid space is exactly what an enumerator has.
//
// Every uuid parameter is CAST. `offline-mocks-cannot-type-check-sql` is the
// standing law and api/_replica.js's committed casts are the shape: over
// Neon's SQL-over-HTTP endpoint a bare `$1` compared against a uuid column has
// no inferable type on some shapes and the statement fails at parse time —
// which a mocked db in an eval cannot see, ever.

function assertOwnerScope(ownerUserId, replicaId) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(replicaId || ""))) {
    throw new CloneChannelError("clone_channel_identity_invalid", 400);
  }
}

/** The owner-scoped handle, `api/_teacher-sheet-draft.js`'s `ownedReplica`
 *  one table over. A replica with no agent cannot carry a channel: there is
 *  nothing for a wire to route to. */
async function ownedReplica(db, ownerUserId, replicaId) {
  const rows = await db(
    `select r.replica_id, r.agent_id
       from vy_replica r
      where r.replica_id = ($1)::uuid and r.owner_user_id = ($2)::uuid
      limit 1`,
    [String(replicaId).toLowerCase(), String(ownerUserId).toLowerCase()],
  );
  return rows[0] || null;
}

/** The client shape. `credentials_ref` is reduced to a PRESENCE before it can
 *  leave — api/_teacher-sheet-draft.js's rule for `consent_artifact_id`, and
 *  the same reason: a studio needs "credential on file / not yet" to render a
 *  gate, and a uuid in a response body is a uuid in a browser's network log. */
export function clientChannel(row) {
  if (!row) return null;
  return {
    channel_id: row.channel_id,
    kind: row.kind,
    external_ref: row.external_ref || "",
    status: row.status,
    credential: row.credentials_ref ? "present" : null,
    connectable: CONNECTABLE_KINDS.includes(row.kind),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/** What the Channels screen reads. */
export async function listCloneChannels(db, ownerUserId, replicaId) {
  assertOwnerScope(ownerUserId, replicaId);
  const rows = await db(
    `select channel_id, kind, external_ref, credentials_ref, status, created_at, updated_at
       from vy_clone_channel
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      order by kind asc`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase()],
  );
  return rows.map(clientChannel);
}

/**
 * Create or update one binding, and CONNECT it in the same statement when the
 * gate allows.
 *
 * The status is derived here rather than accepted from the client, and that is
 * the point: a client that could post `status:'connected'` could connect a
 * channel whose credential was never written, and migration 055's CHECK would
 * then be the only thing standing between a teacher and a channel that looks
 * live and cannot send. Two layers, and this is the cheap one.
 */
export async function saveCloneChannel(db, ownerUserId, replicaId, { kind, externalRef, credentialsRef = null }) {
  assertOwnerScope(ownerUserId, replicaId);
  const k = String(kind || "");
  if (!CONNECTABLE_KINDS.includes(k)) throw new CloneChannelError("clone_channel_kind_unsupported", 400);
  const ref = String(externalRef || "").trim().slice(0, 200);
  if (credentialsRef != null && !UUID.test(String(credentialsRef))) {
    throw new CloneChannelError("clone_channel_identity_invalid", 400);
  }
  const owned = await ownedReplica(db, ownerUserId, replicaId);
  if (!owned) return null;
  if (!owned.agent_id) throw new CloneChannelError("replica_has_no_agent", 409);

  const web = WEB_KINDS.includes(k);
  const credential = credentialsRef ? String(credentialsRef).toLowerCase() : null;
  // The same gate migration 055 states as a CHECK, evaluated before the write
  // so the owner gets a named reason instead of a constraint violation.
  const status = ref && (web || credential) ? "connected" : "draft";

  // UPDATE-then-INSERT rather than ON CONFLICT, and the reason is migration
  // 055's index rather than taste: the uniqueness laws there are PARTIAL
  // (`where status = 'connected'`), so a draft row is outside the index and
  // `on conflict (agent_id, kind)` would never fire for one — every re-save of
  // an incomplete channel would insert another draft. Two statements also suit
  // apply.mjs's world, where there is no transaction to lean on.
  //
  // `status <> 'revoked'` on the update is what keeps revocation terminal for
  // a ROW while leaving the KIND reconnectable: a teacher who revokes a bot
  // and later connects a different one gets a new row, and the revoked row
  // stays as the record of the burned address.
  const updated = await db(
    `update vy_clone_channel
        set external_ref = $4,
            -- coalesce, never overwrite-with-null: re-saving an address must
            -- not silently drop the credential reference a previous save
            -- established, which would leave a row the CHECK forbids.
            credentials_ref = coalesce(($5)::uuid, credentials_ref),
            status = case when $6 = 'connected' and ${readinessPasses("$1", "$2", "$7", "$8")}
                          then 'connected' else 'draft' end,
            updated_at = now()
      where owner_user_id = ($1)::uuid
        and replica_id = ($2)::uuid
        and kind = $3
        and status <> 'revoked'
      returning channel_id, kind, external_ref, credentials_ref, status, created_at, updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase(), k, ref, credential, status,
     READINESS_OVERALL_FLOOR, READINESS_PART_FLOOR],
  );
  if (updated[0]) return connected(updated[0], status);

  const rows = await db(
    `insert into vy_clone_channel
       (channel_id, agent_id, replica_id, owner_user_id, kind, external_ref, credentials_ref, status)
     select ($3)::uuid, ($4)::uuid, ($2)::uuid, ($1)::uuid, $5, $6, ($9)::uuid,
            case when $10 = 'connected' and ${readinessPasses("$1", "$2", "$7", "$8")}
                 then 'connected' else 'draft' end
     returning channel_id, kind, external_ref, credentials_ref, status, created_at, updated_at`,
    [
      String(ownerUserId).toLowerCase(),
      String(replicaId).toLowerCase(),
      randomUUID(),
      String(owned.agent_id).toLowerCase(),
      k,
      ref,
      READINESS_OVERALL_FLOOR,
      READINESS_PART_FLOOR,
      credential,
      status,
    ],
  );
  if (!rows[0]) throw new CloneChannelError("clone_channel_route_taken", 409);
  return connected(rows[0], status);
}

/** The owner asked to connect and the lock refused. The row is already written
 *  in the fail-closed direction by the CASE above, so this only names the
 *  reason: the write is the guarantee, this is the courtesy. */
function connected(row, requested) {
  if (requested === "connected" && row.status !== "connected") {
    throw new CloneChannelError(CHANNEL_READINESS_BLOCKER, 409, {
      overall_floor: READINESS_OVERALL_FLOOR,
      part_floor: READINESS_PART_FLOOR,
    });
  }
  return clientChannel(row);
}

/**
 * Pause, resume, or revoke.
 *
 * REVOKE IS TERMINAL. `status <> 'revoked'` in the WHERE clause is what makes
 * it so, and it is a predicate rather than a branch for 051's reason one axis
 * over: a revoked binding is the record that this address was burned, and
 * un-revoking one would silently re-attach an audience to a clone whose owner
 * had already taken it down.
 */
export async function setCloneChannelStatus(db, ownerUserId, replicaId, channelId, next) {
  assertOwnerScope(ownerUserId, replicaId);
  if (!UUID.test(String(channelId || ""))) throw new CloneChannelError("clone_channel_identity_invalid", 400);
  if (!["connected", "paused", "revoked"].includes(String(next))) {
    throw new CloneChannelError("clone_channel_status_invalid", 400);
  }
  // Resume carries the same lock as first connect. A clone that was paused
  // while it was ready and has since regressed must not walk back through an
  // unlocked door, which is what a status setter with no predicate would be.
  // Pause and revoke are unconditional: taking a clone DOWN is never gated.
  const rows = await db(
    `update vy_clone_channel
        set status = case when $6 = 'connected' and not ${readinessPasses("$1", "$2", "$4", "$5")}
                          then 'paused' else $6 end,
            updated_at = now()
      where channel_id = ($3)::uuid
        and owner_user_id = ($1)::uuid
        and replica_id = ($2)::uuid
        and status <> 'revoked'
      returning channel_id, kind, external_ref, credentials_ref, status, created_at, updated_at`,
    [
      String(ownerUserId).toLowerCase(),
      String(replicaId).toLowerCase(),
      String(channelId).toLowerCase(),
      READINESS_OVERALL_FLOOR,
      READINESS_PART_FLOOR,
      String(next),
    ],
  );
  return rows[0] ? connected(rows[0], String(next)) : null;
}

/** The reference a credential will be written under. Minted here, server-side,
 *  and never accepted from a client: a client-chosen reference is a client
 *  that can point one teacher's channel at another teacher's secret. */
export const mintCredentialsRef = () => randomUUID();
