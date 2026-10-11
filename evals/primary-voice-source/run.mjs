import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const Source = await import(pathToFileURL(join(ROOT, "api/_replica-source.js")));
const { splitSql } = await import(pathToFileURL(join(ROOT, "db/migrations/apply.mjs")));
const read = (path) => readFileSync(join(ROOT, path), "utf8");
let failed = 0;
const ok = (name, condition) => {
  if (condition) console.log(`  ok  ${name}`);
  else { failed += 1; console.log(`FAIL  ${name}`); }
};

const migration = readReconciledMigration("db/migrations/066_replica_primary_voice_source.sql");
const schema = read("db/schema.sql");
const sourceApi = read("api/replica-source.js");
const sourceStore = read("api/_replica-source.js");
const selfTest = read("api/_replica-processing/self-test.js");
const preview = read("api/_replica-voice-preview.js");
const enrollment = read("src/studio/EnrollmentWorkspace.tsx");
const studio = read("src/studio/StudioApp.tsx");

ok("migration is three independently repeatable Neon statements",
  splitSql(migration).length === 3
  && /create unique index if not exists vy_replica_source_owner_locator_ix/.test(migration)
  && /create table if not exists vy_replica_voice_reference/.test(migration)
  && /on conflict \(replica_id\) do nothing/.test(migration));
ok("database enforces one primary source per replica and exact owner-scoped source lineage",
  /replica_id\s+uuid primary key/.test(migration)
  && /source_id\s+uuid not null unique/.test(migration)
  && /foreign key \(source_id, replica_id, owner_user_id\)/.test(migration));
ok("existing clones backfill only from their newest selected ready self-only voice artifact",
  /distinct on \(s\.replica_id\)/.test(migration)
  && /d\.decision='selected'/.test(migration)
  && /s\.state='ready'/.test(migration)
  && /s\.contains_third_parties=false/.test(migration));
ok("canonical schema mirrors migration 066",
  /Migration 066[\s\S]*vy_replica_voice_reference/.test(schema));

const calls = [];
const row = {
  source_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  replica_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  owner_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  kind: "audio", capture_mode: "upload", storage_bucket: "private", object_path: "opaque",
  mime: "audio/wav", byte_size: "4000", sha256: "d".repeat(64), state: "processing",
  contains_third_parties: false, voice_role: "primary", rejection_code: "",
  created_at: "now", updated_at: "now",
};
const selected = await Source.setOwnedPrimaryVoiceSource(async (sql, params) => {
  calls.push({ sql, params });
  return [row];
}, row.owner_user_id, row.replica_id, row.source_id);
ok("primary selection is owner-scoped, restricted to usable self-only media, and atomically replaceable",
  selected?.voice_role === "primary"
  && /owner_user_id=\$2::uuid/.test(calls[0].sql)
  && /kind in \('audio','video'\)/.test(calls[0].sql)
  && /contains_third_parties=false/.test(calls[0].sql)
  && /on conflict \(replica_id\) do update/.test(calls[0].sql));
ok("client projection exposes the role but never private storage coordinates",
  Source.clientSource(row).voice_role === "primary"
  && !Source.clientSource(row).storage_bucket
  && !Source.clientSource(row).object_path);
ok("source erasure removes the primary pointer in the same durable request",
  /delete from vy_replica_voice_reference/.test(sourceStore)
  && /exists \(select 1 from target\)/.test(sourceStore));
ok("replacement-source deletion records a stable request fence and invalidates only cited models",
  /'erasure_requested_at',coalesce\(provenance->'erasure_requested_at',to_jsonb\(now\(\)\)\)/.test(sourceStore)
  && /affected_genomes as materialized/.test(sourceStore)
  && /definition#>'\{references,source_ids\}'/.test(sourceStore)
  && /affected_profiles as materialized/.test(sourceStore)
  && /jsonb_path_exists/.test(sourceStore)
  && /g\.version\s*=\s*affected\.version/.test(sourceStore)
  && /p\.version\s*=\s*affected\.version/.test(sourceStore));
ok("deleting an old recording cannot revoke a concurrent replacement runtime",
  /affected\.version=c\.genome_version/.test(sourceStore)
  && /affected\.version=c\.profile_version/.test(sourceStore)
  && /runtime_capabilities affected where affected\.capability_id=s\.capability_id/.test(sourceStore)
  && !/runtime_capability c[\s\S]{0,240}exists \(select 1 from target\)/.test(sourceStore));
ok("same-account concurrent upload admission is serialized while distinct sources remain independent",
  /pg_advisory_xact_lock\(hashtextextended\(\$2::text\|\|':replica_pending_upload',0\)\)/.test(sourceStore)
  && /s\.owner_user_id=\$2::uuid and s\.state='pending_upload'/.test(sourceStore)
  && /count\(\*\)[\s\S]*<8/.test(sourceStore));
ok("duplicate finalize delivery can enqueue one processing root only",
  /and state = 'pending_upload'/.test(sourceStore)
  && /on conflict \(source_id, step, revision\) do nothing/.test(sourceStore)
  && /select replica_id, owner_user_id, source_id, 'integrity', 'queued'/.test(sourceStore));
ok("the authenticated endpoint owns selection and reruns the guarded ready-source build path",
  /body\.op === "set_primary_voice"/.test(sourceApi)
  && /setOwnedPrimaryVoiceSource\(q, user\.id/.test(sourceApi)
  && /applySelfTestAutoGrant/.test(sourceApi));
ok("self-test selection prefers the starred source before artifact variant ranking",
  /left join vy_replica_voice_reference vr/.test(selfTest)
  && /order by case when vr\.source_id is not null then 0 else 1 end/.test(selfTest));
ok("preview conditioning prefers the primary source while retaining supporting fallback",
  /end voice_role/.test(preview)
  && /order by case when voice_role='primary' then 0 else 1 end/.test(preview));
ok("a browser recording is auto-starred only after stored-file finalization",
  /selectFiles\(\[recording\], language, true\)/.test(enrollment)
  && /await onFinalizeUpload\(result\.source\.source_id\);[\s\S]{0,180}await onSetPrimaryVoice/.test(enrollment));
ok("existing processed audio and video can be explicitly chosen in the source ledger",
  /Use for voice/.test(enrollment)
  && /Primary voice/.test(enrollment)
  && /One starred recording drives the voice/.test(enrollment));
ok("Studio updates exactly one visible primary source from the server result",
  /setPrimaryVoiceSource\(fresh\.accessToken/.test(studio)
  && /item\.source_id === result\.source\.source_id \? "primary" : "supporting"/.test(studio));

console.log(failed ? `\n${failed} FAILURES` : "\nALL PASS");
process.exit(failed ? 1 : 0);
