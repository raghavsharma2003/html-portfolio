// Operator-only repair for historical Mirror windows whose source_id was lost
// before source erasure learned to delete the window. Dry-run is the default.
// No query selects transcript, provider, model, evidence or sheet content.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { q } from "../api/_db.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const valueAfter = (args, name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] || null;
};

export const orphanMirrorWindowEligibleSql = `select w.window_id
  from vy_mirror_window w
 where w.owner_user_id=$1::uuid
   and ($2::uuid is null or w.replica_id=$2::uuid)
   and w.source_id is null
   and (w.transcript<>'' or w.asr_provider<>'' or w.asr_model<>'')
   and not exists (select 1 from vy_mirror_turn t
     where t.window_id=w.window_id and t.session_id=w.session_id
       and t.replica_id=w.replica_id and t.owner_user_id=w.owner_user_id)
   and not exists (select 1 from vy_mirror_conditioning c
     where c.window_id=w.window_id and c.session_id=w.session_id
       and c.replica_id=w.replica_id and c.owner_user_id=w.owner_user_id)
   and not exists (select 1 from vy_replica_expression_observation o
     where o.window_id=w.window_id and o.session_id=w.session_id
       and o.replica_id=w.replica_id and o.owner_user_id=w.owner_user_id)
   and not exists (select 1 from vy_mirror_delta d
     where d.session_id=w.session_id and d.replica_id=w.replica_id
       and d.owner_user_id=w.owner_user_id and w.seq=any(d.cited_windows))
 order by w.created_at,w.window_id
 limit $3::integer`;

export const orphanMirrorWindowTargetsSql = `with eligible as materialized (
  select w.window_id,w.owner_user_id,w.replica_id
    from vy_mirror_window w
   where w.source_id is null
     and (w.transcript<>'' or w.asr_provider<>'' or w.asr_model<>'')
     and not exists (select 1 from vy_mirror_turn t
       where t.window_id=w.window_id and t.session_id=w.session_id
         and t.replica_id=w.replica_id and t.owner_user_id=w.owner_user_id)
     and not exists (select 1 from vy_mirror_conditioning c
       where c.window_id=w.window_id and c.session_id=w.session_id
         and c.replica_id=w.replica_id and c.owner_user_id=w.owner_user_id)
     and not exists (select 1 from vy_replica_expression_observation o
       where o.window_id=w.window_id and o.session_id=w.session_id
         and o.replica_id=w.replica_id and o.owner_user_id=w.owner_user_id)
     and not exists (select 1 from vy_mirror_delta d
       where d.session_id=w.session_id and d.replica_id=w.replica_id
         and d.owner_user_id=w.owner_user_id and w.seq=any(d.cited_windows))
   order by w.created_at,w.window_id
   limit $1::integer
)
select owner_user_id,replica_id,count(*)::integer eligible_windows
  from eligible group by owner_user_id,replica_id
 order by owner_user_id,replica_id`;

export async function cleanupOrphanMirrorWindows(db, args = []) {
  if (typeof db !== "function") throw new Error("cleanup database required");
  const ownerUserId = valueAfter(args, "--owner-user-id");
  const replicaId = valueAfter(args, "--replica-id");
  const requestedLimit = Number(valueAfter(args, "--limit") || 25);
  const limit = Math.max(1, Math.min(25, Number.isSafeInteger(requestedLimit) ? requestedLimit : 25));
  const apply = args.includes("--apply");
  const listTargets = args.includes("--list-targets");

  if (listTargets) {
    if (apply) throw new Error("--list-targets cannot be combined with --apply");
    const rows = await db(orphanMirrorWindowTargetsSql, [limit]);
    return Object.freeze({ mode: "targets", count: rows.length,
      targets: Object.freeze(rows.map((row) => Object.freeze({
        owner_user_id: row.owner_user_id,
        replica_id: row.replica_id,
        eligible_windows: Number(row.eligible_windows || 0),
      }))) });
  }

  if (!UUID.test(String(ownerUserId || ""))) throw new Error("valid --owner-user-id is required");
  if (replicaId !== null && !UUID.test(replicaId)) throw new Error("--replica-id must be a UUID");

  if (!apply) {
    const rows = await db(orphanMirrorWindowEligibleSql, [ownerUserId, replicaId, limit]);
    return Object.freeze({ mode: "dry-run", count: rows.length,
      window_ids: Object.freeze(rows.map((row) => row.window_id)) });
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const cleanupSql = readFileSync(join(here, "../evals/source-erasure/orphan-cleanup.sql"), "utf8");
  const rows = await db(cleanupSql, [ownerUserId, replicaId, limit]);
  return Object.freeze({ mode: "applied", count: Number(rows[0]?.removed || 0) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await cleanupOrphanMirrorWindows(q, process.argv.slice(2));
  console.log(JSON.stringify(result));
}
