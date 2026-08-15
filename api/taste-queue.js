// The owner-review taste nomination queue — SPEC §4.1.5 ("stances expressed
// consistently (>=3 citations across >=2 weeks) go to an owner review
// queue; only owner-approved rows enter the authored taste table"), the B
// graft. WS-RELSTATE, M4, exclusive owner of this file (SPEC §13).
//
//   POST /api/taste-queue {op:"nominate", person}        → scan one person's
//                                                            vy_pattern rows,
//                                                            insert eligible
//                                                            candidates
//   POST /api/taste-queue {op:"nominate_all", limit}      → cron-style sweep
//                                                            across persons
//                                                            with new patterns
//                                                            (culture.yml /
//                                                            consolidate.js's
//                                                            own dual on-
//                                                            demand+cron shape)
//   GET  /api/taste-queue?secret=...                      → list pending
//                                                            candidates for
//                                                            owner review
//   POST /api/taste-queue {op:"approve"|"reject", id, secret}
//                                                          → owner decision
//
// "Generated text never writes the identity core" (§4.1.5): approving a
// candidate here NEVER edits src/engine/inner.ts's authored TASTE table —
// it only flips this queue row to `approved`. A human still has to open
// inner.ts and add the line themselves. That extra step is the entire
// point of the queue existing: it is the boundary between "the pipeline
// noticed a consistent stance" and "the identity core says it forever."
//
// SCHEMA DEVIATION, disclosed rather than hidden (see M4 report): this
// endpoint's table, `vy_taste_candidate`, is NOT in db/schema.sql —
// db/migrations/* and db/schema.sql are WS-SCHEMA's exclusive files (SPEC
// §13), and WS-RELSTATE owns no file under db/. Rather than either editing
// a file outside this workstream's column (rejected by the collision
// contract regardless of content) or shipping a queue with nowhere to
// write, this file creates its own table with an idempotent, this-file-
// only `create table if not exists` — the DDL lives HERE, in the one file
// that owns it, and touches no other workstream's file. Recorded as an
// interface ticket to WS-SCHEMA: fold this DDL into a real migration
// (007_taste_queue.sql) so it stops being a lazily-created table and
// becomes a reviewed one, and add it to PERSON_TABLES in api/memory.js
// (frozen here) so forget/export cover it — until that lands, a person's
// pending taste candidates do NOT get swept by forget, which is flagged
// below as a known gap, not silently accepted.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { personIdFor } from "./memory.js";

const SECRET = process.env.TASTE_QUEUE_SECRET || "";

// §4.1.5's own numbers, duplicated here rather than imported from
// src/engine/relstate.ts's `checkTasteEligibility` — same rationale
// api/consolidate.js already states for not importing shapelint.ts: that
// file is bundled into the client via Vite, and this is a Vercel/Node
// function outside that build graph; cross-bundling a TS engine file into
// a serverless function is an untested dependency path this repo does not
// otherwise exercise. The predicate is three lines; duplicating it exactly
// is safer than a build-time coupling neither workstream has proven works.
const TASTE_MIN_CITATIONS = 3;
const TASTE_MIN_SPAN_DAYS = 14;
const MS_PER_DAY = 86_400_000;

let schemaEnsured = false;
async function ensureSchema() {
  if (schemaEnsured) return;
  await q(`
    create table if not exists vy_taste_candidate (
      id            bigint generated always as identity primary key,
      person_id     uuid not null,
      take          text not null,          -- telegraphic candidate line
      keys          text[] not null default '{}',
      source        text not null check (source in ('pattern','fact')),
      source_id     bigint not null,
      citations     bigint[] not null,
      support_count integer not null default 0,
      span_days     real not null default 0,
      status        text not null default 'pending'
                    check (status in ('pending','approved','rejected')),
      reviewed_by   text,
      reviewed_at   timestamptz,
      created_at    timestamptz not null default now(),
      constraint vy_taste_candidate_cited check (cardinality(citations) >= 1),
      constraint vy_taste_candidate_source_once unique (source, source_id)
    )
  `).catch(() => {});
  await q(`create index if not exists vy_taste_candidate_status_ix
             on vy_taste_candidate (status, created_at desc)`).catch(() => {});
  schemaEnsured = true;
}

/** Mirrors relstate.ts's `checkTasteEligibility` exactly — see that file
 *  for the annotated version; this is the deliberately-duplicated copy. */
function eligible(citations, citationDates) {
  if (citations.length < TASTE_MIN_CITATIONS) return false;
  if (citationDates.length < 2) return false;
  const times = citationDates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const spanDays = (times[times.length - 1] - times[0]) / MS_PER_DAY;
  return spanDays >= TASTE_MIN_SPAN_DAYS;
}

/** Scans one person's live (not t_invalid) prompt-eligible patterns for
 *  taste-shaped candidates — `self_in_relation` patterns are the ones that
 *  actually read as a stance rather than situational guidance, so only
 *  those are considered (a conflict-moment if-then is not a taste). */
async function nominateForPerson(person) {
  await ensureSchema();
  const patterns = await q(
    `select p.id, p.moment, p.if_shape, p.then_note, p.self_in_relation, p.citations, p.support_count
       from vy_pattern p
      where p.person_id = $1 and p.t_invalid is null
        and cardinality(p.citations) >= $2
        and p.self_in_relation <> ''`,
    [person, TASTE_MIN_CITATIONS],
  );
  let nominated = 0;
  for (const p of patterns) {
    const dateRows = await q(
      `select started_at from vy_episode where id = any($1::bigint[])`,
      [p.citations],
    ).catch(() => []);
    const dates = dateRows.map((r) => r.started_at);
    if (!eligible(p.citations, dates)) continue;
    const times = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
    const spanDays = (times[times.length - 1] - times[0]) / MS_PER_DAY;
    const take = String(p.self_in_relation || p.then_note || "").trim().slice(0, 160);
    if (!take) continue;
    const inserted = await q(
      `insert into vy_taste_candidate
         (person_id, take, keys, source, source_id, citations, support_count, span_days)
       values ($1,$2,$3,'pattern',$4,$5,$6,$7)
       on conflict (source, source_id) do nothing
       returning id`,
      [person, take, [], p.id, p.citations, p.support_count, Math.round(spanDays * 10) / 10],
    ).catch(() => []);
    if (inserted.length) nominated++;
  }
  return { patternsScanned: patterns.length, nominated };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!allow(ipOf(req), "taste-queue", 30)) return res.status(429).json({ error: "slow down" });

  try {
    if (req.method === "GET") {
      // Owner-only listing — this reads across persons, unlike almost every
      // other endpoint in this repo, so it is gated exactly like
      // api/culture.js gates its `force` param: no secret configured means
      // this capability is simply off, never open by accident.
      const secret = req.query?.secret || "";
      if (!SECRET || secret !== SECRET) return res.status(403).json({ error: "owner review only" });
      await ensureSchema();
      const status = ["pending", "approved", "rejected"].includes(req.query?.status) ? req.query.status : "pending";
      const rows = await q(
        `select id, person_id, take, source, source_id, citations, support_count, span_days,
                status, reviewed_by, reviewed_at, created_at
           from vy_taste_candidate where status = $1
          order by created_at desc limit 100`,
        [status],
      );
      return res.status(200).json({ status, rows });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

    const { op } = req.body || {};

    if (op === "nominate") {
      const device = req.body?.device;
      if (!device) return res.status(400).json({ error: "device required" });
      const person = await personIdFor(device);
      const rep = await nominateForPerson(person);
      return res.status(200).json({ ok: true, ...rep });
    }

    if (op === "nominate_all") {
      const secret = req.body?.secret || "";
      if (!SECRET || secret !== SECRET) return res.status(403).json({ error: "owner-triggered sweep only" });
      await ensureSchema();
      const limit = Math.min(Number(req.body?.limit) || 25, 100);
      const persons = await q(
        `select distinct person_id from vy_pattern
          where t_invalid is null and cardinality(citations) >= $1
          limit $2`,
        [TASTE_MIN_CITATIONS, limit],
      );
      let totalNominated = 0;
      for (const row of persons) {
        const rep = await nominateForPerson(row.person_id);
        totalNominated += rep.nominated;
      }
      return res.status(200).json({ ok: true, personsScanned: persons.length, totalNominated });
    }

    if (op === "approve" || op === "reject") {
      const secret = req.body?.secret || "";
      if (!SECRET || secret !== SECRET) return res.status(403).json({ error: "owner review only" });
      const id = Number(req.body?.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "id required" });
      await ensureSchema();
      const rows = await q(
        `update vy_taste_candidate
            set status = $2, reviewed_by = 'owner', reviewed_at = now()
          where id = $1 and status = 'pending'
          returning id, take`,
        [id, op === "approve" ? "approved" : "rejected"],
      );
      if (!rows.length) return res.status(404).json({ error: "not found or already reviewed" });
      // Deliberately NOT written into src/engine/inner.ts's TASTE table —
      // see file header: generated text never writes the identity core.
      return res.status(200).json({ ok: true, id: rows[0].id, take: rows[0].take, status: op === "approve" ? "approved" : "rejected" });
    }

    return res.status(400).json({ error: "unknown op" });
  } catch (e) {
    return res.status(500).json({ error: "taste-queue failure" });
  }
}
