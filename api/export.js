// Meera data export — the DPDP portability op (SPEC §9.2).
// POST { device } → one JSON document: everything this device's identity
// spans, keyed by real table name so it is round-trippable (a re-import is
// `insert into <table> select ...` per section, no renaming layer).
//
// THE TABLE LIST IS NOT WRITTEN HERE. It is PERSON_TABLES in api/memory.js —
// the same manifest opForget's whole-wipe iterates — because SPEC §9.2
// requires export and forget to enumerate from ONE source of truth: two
// hand-kept lists drift, and "we exported everything except the table we
// forgot to list" is a privacy defect with a regulator attached.
//
// What export shows that recall never does, deliberately:
//   - invalidated facts, with their validity intervals (t_valid/t_invalid,
//     superseded_by): belief history is relationship content, and an export
//     that hides the history is not export
//   - derivation records (vy_derivation): the audit trail of what was
//     machine-derived from what
//   - the device→person mapping (vy_person_device), so a user can SEE which
//     devices are linked under their person (§2.1)
//   - affect_tags on episodes: enumerated as derived-affect data (§9.5)
// Sensitive sections (vy_india_profile with opt-in religion; vy_fact rows
// carry their own `sensitive` flag) are named in meta.sensitive_tables.
//
// Auth posture matches api/memory.js exactly: possession of the device uuid
// is the identity, the same credential that can read every memory via
// op:recall and delete them all via op:forget. Rate limit is deliberately
// tight — an export is the single most complete document this API can emit.
//
// Streamed table by table (res.write), so memory stays bounded by the
// largest single table, not the whole account.

import { allow, ipOf } from "./_ratelimit.js";
import { q } from "./_db.js";
import { activePersonTables, keysOf, personIdFor } from "./memory.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// halfvec serializes as a 1536-number text blob; cast explicitly so the row
// survives a JSON round trip instead of arriving in a driver-shaped form
const SELECT_OVERRIDE = {
  vy_embedding: "owner_kind, owner_id, person_id, v::text as v, at",
};

// NEON ARRAY TRAP (measured 2026-08-13, this database): the SQL-HTTP driver
// deserializes an EMPTY Postgres array as [""] — one empty-string element —
// because it splits the '{}' literal naively. Left alone, an authored fact
// (citations = {}) exports as citations:[""] — a document that claims a
// citation that does not exist and that fails the bigint cast on re-import.
// A bigint[]/text[] can never legitimately hold a single empty string, so
// normalizing exactly that shape back to [] is lossless. jsonb columns are
// unaffected (they arrive as real JSON).
function fixRow(row) {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (Array.isArray(v) && v.length === 1 && v[0] === "") row[k] = [];
  }
  return row;
}

// stable per-table ordering makes two exports of the same data byte-comparable
const ORDER = {
  meera_log: "id",
  meera_nodes: "id",
  meera_edges: "id",
  meera_forget: "id",
  meera_tel: "id",
  meera_tel_session: "session_id",
  // P2-1: both joined PERSON_TABLES in the same change that made forget able
  // to reach them. Export gets them for free and must — meera_state is the
  // most complete single document about a person this system holds (the raw
  // transcript plus the profile), and a DSAR that omitted it because the table
  // name did not start with `vy_` would be the wrong answer, not a kind one.
  meera_state: "user_id",
  meera_events: "id",
  meera_diag: "id",
  vy_episode: "id",
  vy_visual_assertion: "id",
  vy_shared_moment: "id",
  vy_fact: "id",
  vy_rel_event: "id",
  vy_rel_state: "person_id",
  vy_pattern: "id",
  vy_phrase: "id",
  vy_kin: "id",
  vy_ritual: "key",
  vy_currency: "topic",
  vy_india_profile: "person_id",
  vy_embedding: "owner_kind, owner_id",
  vy_derivation: "id",
  vy_session: "agent_id, session_id",
  // multiparty v1 (migration 008)
  vy_episode_participant: "episode_id, person_id",
  vy_group_member: "group_id, person_id",
  vy_disclosure_grant: "id",
  vy_tg_person: "tg_user_id",
  vy_person_device: "device_id",
  vy_person: "person_id",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "export", 3)) return res.status(429).json({ error: "slow down" });

  const device = String(req.body?.device || "");
  if (!UUID.test(device)) return res.status(400).json({ error: "device uuid required" });

  try {
    const person = await personIdFor(device);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="meera-export-${device}.json"`);
    res.statusCode = 200;

    res.write(
      JSON.stringify({
        format: "vyakti-export/1",
        exported_at: new Date().toISOString(),
        device,
        person_id: person,
        sensitive_tables: ["vy_india_profile"],
        note:
          "tables are keyed by their real database table name and hold raw rows; " +
          "vy_fact includes invalidated beliefs with their validity intervals; " +
          "vy_person_device is the device-to-person mapping this export spans",
      }).slice(0, -1) + ',"tables":{',
    );

    // activePersonTables(), not PERSON_TABLES: the manifest names tables
    // migration 008 introduces, and an export must not 500 on a database where
    // they do not exist yet. It is the same one probe forget uses, so the two
    // consumers still enumerate the same list — which is the whole reason the
    // manifest is a single source (SPEC §9.2).
    let firstTable = true;
    for (const t of await activePersonTables()) {
      // multi-owner tables (PROPOSAL-MULTIPARTY-V1 §3.3 `keys`): a room turn
      // is owned by its SPEAKER, not by the room's synthetic device uuid, so
      // an export keyed on device_id alone would silently omit a person's own
      // room turns. Reading keysOf() rather than t.key is what keeps export
      // and forget enumerating the same rows — the single-source property
      // this manifest exists for (SPEC §9.2).
      //
      // `wipeWhere` is deliberately NOT applied here: a row held together is
      // still A's to receive, it is just not A's to destroy. What A may
      // receive is settled the same way disclosure is settled everywhere else
      // — this query is itself a disclosure-filtered read with R = {A}.
      const cols = SELECT_OVERRIDE[t.table] || "*";
      const owners = keysOf(t);
      const where = owners.map((k, i) => `${k} = $${i + 1}`).join(" or ");
      const params = owners.map((k) => (k === "device_id" ? device : person));
      const rows = await q(
        `select ${cols} from ${t.table} where ${where} order by ${ORDER[t.table] || "1"}`,
        params,
        30_000,
      );
      res.write(`${firstTable ? "" : ","}${JSON.stringify(t.table)}:${JSON.stringify(rows.map(fixRow))}`);
      firstTable = false;
    }
    res.write("}}");
    return res.end();
  } catch (e) {
    // if headers are already out the stream is torn, and a truncated export
    // must not parse as a complete one — ending mid-document guarantees that
    if (res.headersSent) return res.end();
    return res.status(500).json({ error: "export failure" });
  }
}
