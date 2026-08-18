// The multi-owner forget suite — PROPOSAL-MULTIPARTY-V1 §3, build gate G3.
//
//   node evals/mp/withdraw.mjs           → build, assert, tear down, prove residue
//   node evals/mp/withdraw.mjs --keep    → leave the fixture schema up for probing
//
// Proves the three claims §3 makes, against the REAL Postgres and through the
// SHIPPING cascade (api/memory.js's withdrawSharedRows, called with the
// fixture-namespace resolver — not a copy of it):
//
//   1. WITHDRAW, NOT DELETE. A participant leaving stops the room's content
//      surfacing TO them on the very next retrieval, and leaves it standing for
//      everyone who stayed. There is no derived-row cascade at all, because
//      disclosure is a live join — that is the payoff of §2.1's primitive, and
//      it is asserted here by re-running the disclosure predicate rather than
//      by counting rows.
//   2. LAST ONE OUT CLOSES THE DOOR. When the person leaving was the last
//      participant, the episode and its full derived closure hard-delete
//      exactly as today, with no dangling citation at any intermediate point
//      (there are no transactions across q() calls).
//   3. THE ROOM-ROWS-OUTLIVE-AUTHOR HOLE IS CLOSED. A room turn is written
//      under the room's SYNTHETIC device uuid, which is in nobody's
//      vy_person_device mapping. Under the single-key manifest a person's own
//      room turns would survive their own full wipe. This suite runs both the
//      old statement and the new one and shows the difference, so the fix is
//      demonstrated rather than asserted.
import { q } from "../../api/_db.js";
import { withdrawSharedRows, PERSON_TABLES, keysOf } from "../../api/memory.js";
import { disclosurePredicate, NEGATIVE_AFFECT_TAGS } from "../../api/_disclosure.js";
import { P1, P2, P3, P7, ROOMS, TAG } from "./fixtures.mjs";
import { PREFIX, ns, T, teardown, proveNoResidue, buildSchema, seed } from "./harness.mjs";

const KEEP = process.argv.includes("--keep");
const say = (s) => console.log(s);
let failed = 0;
const ok = (cond, label) => {
  if (cond) say(`  ok  ${label}`);
  else {
    failed++;
    say(`FAIL  ${label}`);
  }
};

const one = async (sql, params = []) => Number((await q(sql, params, 30_000))[0]?.n ?? -1);
const countIn = (table, where, params = []) => one(`select count(*)::int n from ${T(table)} ${where}`, params);

say("── building the fixture schema ──");
await teardown();
const built = await buildSchema();
const { roomId, epId, factId, phId } = await seed();
say(`  ok  ${built.base} base + ${built.migration} migration statements, corpus seeded`);

// Room turns, written the way ingestion will write them: the room's synthetic
// device uuid in device_id (so the NOT NULL holds) and the real speaker in
// speaker_person_id (so row-level forget is possible at all).
const [{ room_device_id: roomDev }] = await q(
  `select room_device_id from ${T("vy_group")} where id = $1`,
  [roomId.R1],
);
const [{ dev: p3Device }] = await q(`select gen_random_uuid() as dev`);
for (const [speaker, content] of [
  [P1, `${TAG}p1 room turn`],
  [P2, `${TAG}p2 room turn`],
  [P3, `${TAG}p3 room turn one`],
  [P3, `${TAG}p3 room turn two`],
  [null, `${TAG}her reply to the room`],
]) {
  await q(
    `insert into ${T("meera_log")} (device_id, role, content, speaker_person_id, group_id)
     values ($1, $2, $3, $4, $5)`,
    [roomDev, speaker ? "user" : "assistant", content, speaker, roomId.R1],
  );
}
// and one ordinary 1:1 turn of P3's, under P3's own device
await q(
  `insert into ${T("meera_log")} (device_id, role, content, speaker_person_id)
   values ($1, 'user', $2, $3)`,
  [p3Device, `${TAG}p3 dm turn`, P3],
);

// ──────────────────────────────────────────────────────────────────────────
// 1. WITHDRAW, NOT DELETE
// ──────────────────────────────────────────────────────────────────────────
say("\n── 1. withdraw: P3 leaves R1's ACL; the room keeps its memory ──");

const PRED = ns(disclosurePredicate("fact"));
const visibleTo = async (recipients, isGroup, room) => {
  const rows = await q(
    `select f.name from ${T("vy_fact")} f where true ${PRED}`,
    [recipients, isGroup, room, NEGATIVE_AFFECT_TAGS],
    30_000,
  );
  return new Set(rows.map((r) => r.name));
};

const activeR1 = ROOMS.R1.members.filter((p) => !ROOMS.R1.departed.includes(p));
const beforeAll = await visibleTo(activeR1, true, roomId.R1);
const beforeP3Dm = await visibleTo([P3], false, null);
ok(beforeAll.has("f_r1_full"), `before: the room fact is visible to the room's active members [${activeR1.length}]`);
ok(beforeP3Dm.has("f_r1_full"), "before: the room fact reaches P3's own DM (§1 M2 — she was in the room with you)");

const epsBefore = await countIn("vy_episode", "where group_id = $1", [roomId.R1]);
const w = await withdrawSharedRows(P3, { t: T });
say(
  `  ·   withdrawSharedRows(P3): ${w.participant_rows} participant row(s), ${w.room_turns} authored room turn(s), ` +
    `${w.grants} grant(s), ${w.memberships} membership(s); closed ${w.episodes_closed} episode(s) / ` +
    `${w.facts_closed} fact(s) / ${w.phrases_closed} phrase(s)`,
);

const afterAll = await visibleTo(
  activeR1.filter((p) => p !== P3),
  true,
  roomId.R1,
);
const afterP3Dm = await visibleTo([P3], false, null);
const afterWithP3 = await visibleTo(activeR1, true, roomId.R1);

ok(afterAll.has("f_r1_full"), "after: the room fact is STILL visible to the members who stayed");
ok(!afterP3Dm.has("f_r1_full"), "after: the room fact no longer reaches P3 — the live join did it, with no cascade");
ok(!afterWithP3.has("f_r1_full"), "after: any recipient set containing P3 is refused the room fact");
ok(
  (await countIn("vy_episode", "where group_id = $1", [roomId.R1])) === epsBefore,
  "after: no R1 episode was deleted — forget withdraws what we hold together",
);
ok(
  (await countIn("vy_episode_participant", "where person_id = $1", [P3])) === 0,
  "after: P3 holds no participant row anywhere",
);
ok(
  (await countIn("meera_log", "where speaker_person_id = $1 and group_id is not null", [P3])) === 0,
  "after: P3's own authored room turns are gone",
);
ok(
  (await countIn("meera_log", "where speaker_person_id = $1 and group_id is not null", [P1])) === 1 &&
    (await countIn("meera_log", "where speaker_person_id is null and group_id is not null")) === 1,
  "after: another member's turns and her own replies to the room are untouched",
);
ok(
  (await countIn("vy_group_member", "where person_id = $1 and left_at is not null", [P3])) === 1,
  "after: P3's membership is marked left, not deleted — leaving never deletes the room for the others",
);

// ──────────────────────────────────────────────────────────────────────────
// 2. LAST ONE OUT
// ──────────────────────────────────────────────────────────────────────────
say("\n── 2. last one out closes the door (room R3: P2, then P7) ──");
const r3Ep = Number(epId.e_r3_full);
const r3Fact = Number(factId.f_r3_full);
const r3Phrase = Number(phId[`${TAG}r3-joke`]);

const w2 = await withdrawSharedRows(P2, { t: T });
ok(
  (await countIn("vy_episode", "where id = $1", [r3Ep])) === 1 && w2.episodes_closed === 0,
  "P2 (not the last) leaves: R3's episode survives for P7",
);
ok((await countIn("vy_fact", "where id = $1", [r3Fact])) === 1, "P2 leaves: the derived fact survives");

const w3 = await withdrawSharedRows(P7, { t: T });
ok(w3.episodes_closed >= 1, `P7 (the last) leaves: ${w3.episodes_closed} episode(s) hard-deleted`);
ok((await countIn("vy_episode", "where id = $1", [r3Ep])) === 0, "last one out: the episode is gone");
ok((await countIn("vy_fact", "where id = $1", [r3Fact])) === 0, "last one out: the derived fact is gone with it");
ok((await countIn("vy_phrase", "where id = $1", [r3Phrase])) === 0, "last one out: the room's phrase is gone with it");

// ──────────────────────────────────────────────────────────────────────────
// 3. ZERO ORPHANS, the relcheck sweep against the fixture namespace
// ──────────────────────────────────────────────────────────────────────────
say("\n── 3. zero-orphan sweep after the cascade ──");
const sweeps = [
  ["no fact cites a missing episode",
    `select count(*)::int n from ${T("vy_fact")} r
      where cardinality(r.citations) > 0
        and exists (select 1 from unnest(r.citations) c(id)
                    where not exists (select 1 from ${T("vy_episode")} e where e.id = c.id))`],
  ["no phrase points at a missing coining episode",
    `select count(*)::int n from ${T("vy_phrase")} p
      where p.origin_episode is not null
        and not exists (select 1 from ${T("vy_episode")} e where e.id = p.origin_episode)`],
  ["no participant row without its episode",
    `select count(*)::int n from ${T("vy_episode_participant")} p
      where not exists (select 1 from ${T("vy_episode")} e where e.id = p.episode_id)`],
  ["no room episode without participants",
    `select count(*)::int n from ${T("vy_episode")} e
      where e.group_id is not null
        and not exists (select 1 from ${T("vy_episode_participant")} p where p.episode_id = e.id)`],
  ["no ownerless embedding",
    `select count(*)::int n from ${T("vy_embedding")} v
      where (v.owner_kind = 'episode' and not exists (select 1 from ${T("vy_episode")} e where e.id = v.owner_id))
         or (v.owner_kind = 'fact'    and not exists (select 1 from ${T("vy_fact")} f where f.id = v.owner_id))`],
  ["no grant left pointing at a departed party",
    `select count(*)::int n from ${T("vy_disclosure_grant")} g
      where g.granted_to = '${P3}'::uuid or g.granted_by = '${P3}'::uuid`],
];
for (const [label, sql] of sweeps) ok((await one(sql)) === 0, label);

// ──────────────────────────────────────────────────────────────────────────
// 4. THE ROOM-ROWS-OUTLIVE-AUTHOR HOLE
// ──────────────────────────────────────────────────────────────────────────
say("\n── 4. the manifest's `keys` extension, demonstrated ──");
// P1 still has a room turn under the room's synthetic device uuid. P1's own
// device is some other uuid entirely — the room device is in nobody's mapping.
const [{ dev: p1Device }] = await q(`select gen_random_uuid() as dev`);
const LOG = PERSON_TABLES.find((t) => t.table === "meera_log");
const cols = keysOf(LOG);
ok(cols.length === 2 && cols.includes("speaker_person_id"), `manifest keys for meera_log: [${cols.join(", ")}]`);

const oldWouldTake = await one(
  `select count(*)::int n from ${T("meera_log")} where device_id = $1`,
  [p1Device],
);
const newWillTake = await one(
  `select count(*)::int n from ${T("meera_log")} where ${cols.map((k, i) => `${k} = $${i + 1}`).join(" or ")}`,
  cols.map((k) => (k === "device_id" ? p1Device : P1)),
);
ok(
  oldWouldTake === 0 && newWillTake === 1,
  `single-key wipe would have taken ${oldWouldTake} of P1's room turns; the manifest's keys take ${newWillTake}`,
);
const gone = await q(
  `delete from ${T("meera_log")} where ${cols.map((k, i) => `${k} = $${i + 1}`).join(" or ")} returning id`,
  cols.map((k) => (k === "device_id" ? p1Device : P1)),
);
ok(
  gone.length === 1 &&
    (await countIn("meera_log", "where speaker_person_id = $1", [P1])) === 0,
  "P1's own room turn is deleted by their own whole-wipe — the hole is closed before rooms exist",
);

// ── teardown + residue ─────────────────────────────────────────────────────
let residue = { relations: [], productionRows: [] };
if (!KEEP) {
  const dropped = await teardown();
  residue = await proveNoResidue();
  say(`\n── teardown ──`);
  say(
    `  dropped ${dropped} fixture relation(s); residue: ${residue.relations.length} ${PREFIX}* relation(s), ` +
      `${residue.productionRows.length} production table(s) carrying a ${TAG} row`,
  );
  if (residue.relations.length || residue.productionRows.length) failed++;
} else {
  say(`\n(--keep: fixture schema left in place; run \`node evals/mp/gate0.mjs --cleanup\` to drop it)`);
}

say(failed ? `\n${failed} withdraw assertion(s) FAILED — G3 is not green` : `\nG3 green: multi-owner forget withdraws, closes the door last, and leaves zero orphans`);
process.exit(failed ? 1 : 0);
