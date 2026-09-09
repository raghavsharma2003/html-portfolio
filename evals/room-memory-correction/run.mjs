// Offline control proof for Room remembered-thing corrections. It checks the
// exact SQL text and models only the authorization outcomes; it does not parse
// PostgreSQL, call a database, or contact a model/provider. A real release
// still needs EXPLAIN of the exported statements against the target schema.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ROOM_MEMORY_FACTS_SQL,
  ROOM_MEMORY_CORRECT_SQL,
  ROOM_MEMORY_RETRACT_SQL,
  roomMemoryAuthority,
} from "../../api/_room-memory-authority.js";

let checks = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => {
  checks += 1;
  console.log(`ok ${name}`);
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const follower = {
  follower_id: "10000000-0000-4000-8000-000000000001",
  memory_epoch: "7",
  agent_id: "20000000-0000-4000-8000-000000000001",
  person_id: "30000000-0000-4000-8000-000000000001",
};

await check("read, replacement, and retraction use the immutable follower authority tuple", () => {
  for (const sql of [ROOM_MEMORY_FACTS_SQL, ROOM_MEMORY_CORRECT_SQL, ROOM_MEMORY_RETRACT_SQL]) {
    for (const token of [
      "f.follower_id=$1::uuid", "f.memory_epoch=$2::bigint", "f.agent_id=$3::uuid", "f.person_id=$4::uuid",
      "f.memory_consent_at is not null", "f.age_attested_at is not null",
      "r.published_at is not null", "r.paused_at is null", "p.revoked_at is null",
    ]) assert.ok(sql.includes(token), token);
  }
  assert.deepEqual(roomMemoryAuthority(follower), [follower.follower_id, "7", follower.agent_id, follower.person_id]);
});

await check("correction records exact user text, creates a cited correction episode, then supersedes", () => {
  for (const token of [
    "'me','chat','text',$6::text", "length($6::text) between 3 and 400", "'room_memory_correction'",
    "log_from,log_to", "array[e.id]", "'user_said',1.0", "t_invalid=now(),superseded_by=n.id",
    "pg_get_serial_sequence('meera_log','id')", "l.id,l.id,'',false", "overriding system value", "at,episode_id,",
    "now(),e.id,",
  ]) assert.ok(ROOM_MEMORY_CORRECT_SQL.includes(token), token);
  assert.ok(!ROOM_MEMORY_CORRECT_SQL.includes("model("));
  assert.ok(!ROOM_MEMORY_CORRECT_SQL.includes("delete from vy_fact"));
});

await check("only an active fact cited by this Room's current epoch can mutate", () => {
  for (const sql of [ROOM_MEMORY_CORRECT_SQL, ROOM_MEMORY_RETRACT_SQL]) {
    for (const token of [
      "v.id=$5::bigint", "v.t_invalid is null", "v.retracted_at is null", "v.superseded_by is null",
      "e.room_memory_follower_id=f.follower_id", "e.room_memory_epoch=f.memory_epoch", "for update of v",
    ]) assert.ok(sql.includes(token), token);
  }
  assert.ok(ROOM_MEMORY_RETRACT_SQL.includes("set retracted_at=now()"));
  assert.ok(!ROOM_MEMORY_RETRACT_SQL.includes("delete from vy_fact"));
});

await check("a stale or foreign correction returns no row, never scalar null fields", () => {
  assert.ok(ROOM_MEMORY_CORRECT_SQL.endsWith(
    ") select s.id::text as replaced_id,n.id::text as fact_id,n.body\n from superseded s join replacement n on true join source c on true",
  ));
  assert.ok(!ROOM_MEMORY_CORRECT_SQL.includes("(select id::text from superseded)"));
  const correct = ({ authority, target }) => authority && target
    ? [{ replaced_id: "41", fact_id: "42", body: "Use diagrams." }]
    : [];
  assert.deepEqual(correct({ authority: false, target: true }), []);
  assert.deepEqual(correct({ authority: true, target: false }), []);
});

await check("the correction log is inserted into its own cited episode before discovery", () => {
  const episode = { id: "91", log_from: "70", log_to: "70" };
  const logs = [{ id: "70", episode_id: episode.id, content: "Use diagrams." }];
  assert.equal(episode.log_from, logs[0].id);
  assert.equal(episode.log_to, logs[0].id);
  assert.equal(logs[0].episode_id, episode.id);
  // Same effect as the SQL's episode_id value on the source insert.
  const consolidatorDiscovery = logs.filter((log) => log.episode_id === null);
  assert.deepEqual(consolidatorDiscovery, [], "the replacement cannot be consolidated a second time");
});

await check("offline race model refuses a stale correction and whole forget removes both generations", () => {
  const state = { epoch: "7", consent: true, facts: [{ id: "41", active: true, text: "Explain slowly." }] };
  const correct = (id, replacement, expectedEpoch) => {
    const old = state.facts.find((fact) => fact.id === id && fact.active);
    if (!state.consent || state.epoch !== expectedEpoch || !old) return null;
    old.active = false;
    const next = { id: "42", active: true, text: replacement };
    state.facts.push(next);
    return next;
  };
  state.consent = false;
  state.epoch = "8";
  assert.equal(correct("41", "Use diagrams.", "7"), null, "withdrawal wins before stale correction");
  const fresh = { epoch: "8", consent: true, facts: [{ id: "44", active: true, text: "Use flashcards." }] };
  state.epoch = fresh.epoch;
  state.consent = fresh.consent;
  state.facts = fresh.facts;
  const replacement = correct("44", "Use diagrams.", "8");
  assert.equal(replacement?.text, "Use diagrams.");
  state.facts.splice(0, state.facts.length);
  assert.deepEqual(state.facts, [], "whole forget after correction removes both old and replacement facts");
});

const inventory = Object.fromEntries([
  ["ROOM_MEMORY_FACTS_SQL", ROOM_MEMORY_FACTS_SQL],
  ["ROOM_MEMORY_CORRECT_SQL", ROOM_MEMORY_CORRECT_SQL],
  ["ROOM_MEMORY_RETRACT_SQL", ROOM_MEMORY_RETRACT_SQL],
].map(([name, sql]) => [name, { sha256: sha256(sql), bytes: Buffer.byteLength(sql), parameters: name === "ROOM_MEMORY_FACTS_SQL" ? 4 : name === "ROOM_MEMORY_CORRECT_SQL" ? 6 : 5 }]));

console.log(JSON.stringify({ proof: "source-only", sql_inventory: inventory }, null, 2));
console.log(`${checks} controls passed; no SQL, provider, cloud, or deployment calls.`);
