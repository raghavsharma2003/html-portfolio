// The room-binding round trip — task #78, migration 013.
//
//   node evals/mp/binding.mjs            → build, assert, tear down, prove residue
//   node evals/mp/binding.mjs --keep     → leave the fixture schema up for probing
//   node evals/mp/binding.mjs --cleanup  → drop the fixture schema and exit
//
// ── what this proves, and why it needed its own suite ─────────────────────
//
// Migration 013 replaced the room's Telegram-shaped address (`vy_group.
// tg_chat_id`, a bigint with a unique index) with `(surface, surface_chat_id)`
// — text, because a chat key is an OPAQUE ADDRESS the contract forbids
// parsing. The DDL is a third of the job. The other two thirds are that the
// SHIPPING read and write paths use the new key, and that every room created
// before 013 keeps working — and neither of those is a schema fact.
//
// So this drives the real `api/_surface.js` binding functions (`roomForChat`,
// `ensureRoomForSurfaceChat`, `upsertRoomMember`) against real Postgres, and
// asserts the four things that were previously impossible or wrong:
//
//   1. a NON-NUMERIC chat key can be a room at all (WhatsApp's `…@g.us`).
//      Before 013 `roomByChatKey()` returned null for one and the room lane
//      refused fail-closed — correct behaviour for a wrong schema.
//   2. Discord channel 9001 and Telegram chat 9001 are TWO rooms. Before 013
//      they were one, on a column whose name says Telegram.
//   3. a pre-013 row (tg_chat_id set, surface null) is still FOUND, is adopted
//      on the way past, and does NOT gain a second row under the new key.
//   4. every member now has a surface address. Before 013 a non-Telegram
//      member was written with a NULL `tg_user_id` and had none anywhere.
//
// ── the fixture is PRODUCTION'S SHAPE, and that is asserted, not assumed ──
//
// Same namespace discipline as evals/mp/gate0.mjs and evals/mp/tgbot.mjs: one
// mechanical identifier rewrite over the REAL DDL into a `wsbind_test_*`
// namespace, teardown is a table drop, and residue is greppable rather than
// trusted. NOTHING here writes a production row, and §"residue" below proves
// it from the other direction as well — by counting the production tables
// before and after.
//
// What is different here, and load-bearing: the fixture applies 008b, 009,
// 010 AND 013 — filtered to the two tables under test — so `agent_id` has NO
// DEFAULT, exactly as in production since 010. A fixture that kept 009's
// default would let a writer which never names `agent_id` pass here and raise
// a NOT NULL violation live, which is the precise shape of failure this repo
// keeps paying for. Test 0 compares the fixture's catalog against production's
// column for column, so the two cannot drift apart silently.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { q } from "../../api/_db.js";
import { splitSql } from "../../db/migrations/apply.mjs";
import {
  roomForChat,
  ensureRoomForSurfaceChat,
  upsertRoomMember,
  legacyChatId,
  legacyUserId,
} from "../../api/_surface.js";
import { MEERA_AGENT_ID } from "../../api/_agentscope.js";
import { surfaceRoomDeviceId } from "../../api/_room.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const PREFIX = "wsbind_test_";
const TAG = "wsbind-test-";
const KEEP = process.argv.includes("--keep");
const CLEANUP_ONLY = process.argv.includes("--cleanup");

// `vy_group` prefix-matches `vy_group_member` on purpose — the same property
// api/_room.js relies on when it writes `${t("vy_group")}_member`.
const NS_RE = new RegExp(`(^|[^\\w.])(vy_group)`, "g");
const ns = (sql) => sql.replace(NS_RE, (_m, pre, id) => `${pre}${PREFIX}${id}`);
const T = (name) => PREFIX + name;
/** The resolver every production function under test is called with. */
const t = (name) => PREFIX + name;

/** The two tables this suite owns. Everything else in these migration files
 *  belongs to another suite and is filtered out rather than half-applied. */
const TABLES = new Set(["vy_group", "vy_group_member"]);
const FILES = [
  "008b_rooms_grants_turns.sql",
  "009_agents.sql",
  "010_agent_strict.sql",
  "013_surface_room_binding.sql",
];

const targetOf = (stmt) => {
  const s = stmt.replace(/--[^\n]*\n/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  let m = /^create table if not exists ([a-z_0-9]+)/.exec(s);
  if (m) return m[1];
  m = /^create (?:unique )?index if not exists [a-z_0-9]+ on ([a-z_0-9]+)/.exec(s);
  if (m) return m[1];
  m = /^alter table ([a-z_0-9]+)/.exec(s);
  if (m) return m[1];
  m = /^(?:insert into|update) ([a-z_0-9]+)/.exec(s);
  if (m) return m[1];
  return null;
};

const stmtsFor = (file) =>
  splitSql(readFileSync(join(ROOT, "db/migrations", file), "utf8")).filter((s) =>
    TABLES.has(targetOf(s)),
  );

async function teardown() {
  const rels = await q(
    `select tablename from pg_tables where schemaname = 'public' and tablename like $1`,
    [`${PREFIX}%`],
  );
  for (const r of rels) await q(`drop table if exists ${r.tablename} cascade`, [], 60_000);
  return rels.length;
}

/** No fixture relation may survive teardown, and NO PRODUCTION ROW may carry a
 *  wsbind-test- string. The second half is the one that matters: a suite that
 *  wrote into the real tables through a resolver bug would otherwise leave no
 *  trace anyone thought to look for. */
async function proveNoResidue() {
  const rels = await q(
    `select tablename from pg_tables where schemaname = 'public' and tablename like $1`,
    [`${PREFIX}%`],
  );
  const [row] = await q(
    `select (select count(*)::int from vy_group where name like '${TAG}%') as tagged_groups,
            (select count(*)::int from vy_group where surface_chat_id like '${TAG}%') as tagged_keys`,
  ).catch(() => [{ tagged_groups: -1, tagged_keys: -1 }]);
  return { relations: rels.map((r) => r.tablename), production: row };
}

/** The production row counts, so "this suite wrote nothing live" is measured
 *  from the other side too — a name-tag probe only catches rows we would have
 *  thought to tag. */
async function productionCounts() {
  const [row] = await q(
    `select (select count(*)::int from vy_group) as groups,
            (select count(*)::int from vy_group_member) as members`,
  );
  return row;
}

async function buildSchema() {
  const stmts = FILES.flatMap(stmtsFor);
  for (const s of stmts) await q(ns(s), [], 60_000);
  // The house law: every statement in every migration file is independently
  // idempotent, because an interrupted apply is recovered by running the same
  // file again (db/migrations/apply.mjs). 013 is the new one, so 013 is the
  // one re-applied here — if any of its eight statements were not re-runnable,
  // this second pass throws and the suite dies loudly at build time.
  for (const s of stmtsFor("013_surface_room_binding.sql")) await q(ns(s), [], 60_000);
  return stmts.length;
}

// ── assertions ────────────────────────────────────────────────────────────
let pass = 0;
const failures = [];
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}  ${detail}`);
  }
};

if (CLEANUP_ONLY) {
  const n = await teardown();
  const res = await proveNoResidue();
  console.log(`dropped ${n} fixture relation(s); residue: ${JSON.stringify(res)}`);
  process.exit(res.relations.length ? 1 : 0);
}

const before = await productionCounts();

console.log("\n── fixture namespace ──");
await teardown();
const built = await buildSchema();
ok(`${built} statements -> ${PREFIX}*, then 013 re-applied (idempotence)`, built > 0);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 0. the fixture IS production's shape ──");
//
// A round trip against a shape production does not have proves nothing about
// production. This is the check that keeps the two honest, and it is why the
// fixture applies 010 (agent_id loses its default) rather than stopping at 009.
{
  const cols = async (table, prefix) =>
    await q(
      `select column_name, data_type, is_nullable, coalesce(column_default,'') as column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = $1
        order by column_name`,
      [prefix + table],
    );
  for (const table of ["vy_group", "vy_group_member"]) {
    const live = await cols(table, "");
    const fix = await cols(table, PREFIX);
    ok(
      `${table}: the fixture has production's columns, types, nullability and defaults`,
      JSON.stringify(live) === JSON.stringify(fix),
      `live ${live.length} cols / fixture ${fix.length} cols`,
    );
  }
  const [agent] = await q(
    `select coalesce(column_default,'(none)') as d from information_schema.columns
      where table_schema='public' and table_name=$1 and column_name='agent_id'`,
    [T("vy_group")],
  );
  ok(
    "agent_id has NO default (migration 010), so a writer that omits it fails loudly",
    agent?.d === "(none)",
    agent?.d,
  );
  const idx = await q(
    `select indexname from pg_indexes where schemaname='public' and tablename = any($1::text[])
      order by indexname`,
    [[T("vy_group"), T("vy_group_member")]],
  );
  const names = idx.map((r) => r.indexname.replace(PREFIX, ""));
  ok("013's unique index on (surface, surface_chat_id) exists", names.includes("vy_group_surface_chat_ix"), names.join(","));
  ok("013's lookup index on (surface, surface_user_id) exists", names.includes("vy_group_member_surface_ix"));
  ok("008b's old unique index STILL exists (nothing was dropped)", names.includes("vy_group_tg_chat_ix"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 1. the key discriminator: a chat key is opaque text ──");
{
  ok("a Telegram numeric key still has a legacy spelling", legacyChatId("telegram", "-1001234567890") === "-1001234567890");
  ok("a DISCORD numeric key has NONE — this is the 9001 collision, closed", legacyChatId("discord", "9001") === null);
  ok("a WhatsApp group key has none either", legacyChatId("whatsapp", "120363042@g.us") === null);
  ok("a Telegram key too long for a bigint has none", legacyChatId("telegram", "1".repeat(25)) === null);
  ok("legacyUserId follows the same rule", legacyUserId("telegram", "77") === "77" && legacyUserId("discord", "77") === null);
  ok("…and a null member id stays null", legacyUserId("telegram", null) === null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 2. new-write: every surface gets a room, on its own key ──");
let tgRoom, dcRoom, waRoom;
{
  tgRoom = await ensureRoomForSurfaceChat("telegram", "9001", { name: `${TAG}tg` }, t);
  dcRoom = await ensureRoomForSurfaceChat("discord", "9001", { name: `${TAG}dc` }, t);
  waRoom = await ensureRoomForSurfaceChat("whatsapp", "120363042@g.us", { name: `${TAG}wa` }, t);

  ok("a Telegram room is created", Boolean(tgRoom?.id));
  ok("…with the new key set", tgRoom?.surface === "telegram" && tgRoom?.surface_chat_id === "9001");
  ok("…and the legacy column MIRRORED while the old index lives", String(tgRoom?.tg_chat_id) === "9001");

  ok("a Discord room is created", Boolean(dcRoom?.id));
  ok("…on its OWN key", dcRoom?.surface === "discord" && dcRoom?.surface_chat_id === "9001");
  ok("…and writes NOTHING into the Telegram column", dcRoom?.tg_chat_id == null, String(dcRoom?.tg_chat_id));

  // The whole point of 013, stated as one assertion.
  ok("Discord 9001 and Telegram 9001 are TWO rooms (pre-013 they were one)",
    tgRoom.id !== dcRoom.id, `${tgRoom?.id} vs ${dcRoom?.id}`);
  ok("…with two different synthetic devices, as surfaceDeviceId already guaranteed",
    tgRoom.room_device_id !== dcRoom.room_device_id);
  ok("…and each device is the one api/_room.js derives",
    tgRoom.room_device_id === surfaceRoomDeviceId("telegram", "9001") &&
      dcRoom.room_device_id === surfaceRoomDeviceId("discord", "9001"));

  // Previously IMPOSSIBLE: a non-numeric chat key could not be stored at all.
  ok("a NON-NUMERIC chat key is a room now", Boolean(waRoom?.id) && waRoom.surface_chat_id === "120363042@g.us");
  ok("…and it too leaves the Telegram column alone", waRoom?.tg_chat_id == null);

  ok("every room names its agent explicitly (010 dropped the default)",
    (await q(`select count(*)::int n from ${T("vy_group")} where agent_id = $1`, [MEERA_AGENT_ID]))[0].n === 3);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 3. ensure is idempotent, and the unique index bites ──");
{
  const again = await ensureRoomForSurfaceChat("discord", "9001", { name: `${TAG}dc-again` }, t);
  ok("ensure twice yields the SAME room", again?.id === dcRoom.id, `${again?.id} vs ${dcRoom.id}`);
  const [{ n }] = await q(`select count(*)::int n from ${T("vy_group")}`);
  ok("…and no second row was created", n === 3, String(n));

  // The index is the thing that makes a duplicate unrepresentable rather than
  // merely unlikely — a guard nothing can violate beats a guard nobody violates.
  let raised = "";
  await q(
    `insert into ${T("vy_group")} (agent_id, name, kind, room_device_id, surface, surface_chat_id)
     values ($1,$2,'friend_group',$3,'discord','9001')`,
    [MEERA_AGENT_ID, `${TAG}dupe`, surfaceRoomDeviceId("discord", "dupe")],
  ).catch((e) => {
    raised = e.message;
  });
  ok("a duplicate (surface, surface_chat_id) is REFUSED by the database", Boolean(raised), raised);
  const [{ n: n2 }] = await q(`select count(*)::int n from ${T("vy_group")}`);
  ok("…and the table is unchanged", n2 === 3, String(n2));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 4. dual-read: every room created before 013 keeps working ──");
//
// The pre-013 row shape, written by hand exactly as api/_room.js's ensureRoom
// wrote it: tg_chat_id set, surface and surface_chat_id null. This is the row
// the retirement condition in docs/SURFACES.md §4 is waiting to stop existing.
let legacyId;
{
  const key = "-1001234567890";
  const [row] = await q(
    `insert into ${T("vy_group")} (agent_id, name, kind, room_device_id, tg_chat_id)
     values ($1,$2,'friend_group',$3,$4) returning id`,
    [MEERA_AGENT_ID, `${TAG}legacy`, surfaceRoomDeviceId("telegram", key), key],
  );
  legacyId = row.id;

  const [pre] = await q(`select surface, surface_chat_id from ${T("vy_group")} where id = $1`, [legacyId]);
  ok("the legacy row starts with NO new key at all", pre.surface === null && pre.surface_chat_id === null);

  const found = await roomForChat("telegram", key, t);
  ok("the compatibility read FINDS it", found?.id === legacyId, `${found?.id} vs ${legacyId}`);
  ok("…and answers with the new key filled in", found?.surface === "telegram" && found?.surface_chat_id === key);

  const [after] = await q(`select surface, surface_chat_id from ${T("vy_group")} where id = $1`, [legacyId]);
  ok("…and ADOPTED the row on the way past (the legacy read drains itself)",
    after.surface === "telegram" && after.surface_chat_id === key,
    JSON.stringify(after));

  const second = await roomForChat("telegram", key, t);
  ok("the second read comes off the NEW key and is the same room", second?.id === legacyId);

  const ensured = await ensureRoomForSurfaceChat("telegram", key, { name: `${TAG}legacy` }, t);
  ok("ensure over an adopted room does not create a second one", ensured?.id === legacyId);
  const [{ n }] = await q(`select count(*)::int n from ${T("vy_group")}`);
  ok("…and the room count is still four", n === 4, String(n));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 5. the compatibility read is TELEGRAM-ONLY ──");
//
// The old `chatKeyToChatId()` tested only "does this look like a bigint", so a
// Discord snowflake was looked up in a column named for Telegram. That is how
// two rooms became one; the surface test is what closes it.
{
  const key = "-9009009009";
  await q(
    `insert into ${T("vy_group")} (agent_id, name, kind, room_device_id, tg_chat_id)
     values ($1,$2,'friend_group',$3,$4)`,
    [MEERA_AGENT_ID, `${TAG}tg-only`, surfaceRoomDeviceId("telegram", key), key],
  );
  const asDiscord = await roomForChat("discord", key, t);
  ok("a numeric key on ANOTHER surface does not find the Telegram row", asDiscord === null,
    JSON.stringify(asDiscord?.id));
  const asWhatsapp = await roomForChat("whatsapp", key, t);
  ok("…nor on WhatsApp", asWhatsapp === null);
  const asTelegram = await roomForChat("telegram", key, t);
  ok("…and Telegram still finds its own", asTelegram?.tg_chat_id != null && String(asTelegram.tg_chat_id) === key);

  ok("an empty chat key is refused rather than matching something", (await roomForChat("telegram", "", t)) === null);
  ok("a missing surface is refused too", (await roomForChat("", "9001", t)) === null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 6. members: every member has a surface address now ──");
{
  const rhea = "11111111-1111-4111-8111-111111111111";
  const vik = "22222222-2222-4222-8222-222222222222";

  await upsertRoomMember(tgRoom.id, { personId: rhea, surface: "telegram", surfaceUserId: "77" }, t);
  await upsertRoomMember(dcRoom.id, { personId: vik, surface: "discord", surfaceUserId: "88" }, t);
  await upsertRoomMember(waRoom.id, { personId: vik, surface: "whatsapp", surfaceUserId: "9198…@c.us" }, t);

  const row = async (g, p) =>
    (
      await q(
        `select surface, surface_user_id, tg_user_id, left_at, agent_id
           from ${T("vy_group")}_member where group_id = $1 and person_id = $2`,
        [g, p],
      )
    )[0];

  const a = await row(tgRoom.id, rhea);
  ok("a Telegram member carries its surface address", a?.surface === "telegram" && a?.surface_user_id === "77");
  ok("…and mirrors the legacy column while it lives", String(a?.tg_user_id) === "77");
  ok("…and names the agent (010 again)", a?.agent_id === MEERA_AGENT_ID);

  const b = await row(dcRoom.id, vik);
  ok("a DISCORD member carries one too — before 013 it had none anywhere",
    b?.surface === "discord" && b?.surface_user_id === "88");
  ok("…and writes NOTHING into the Telegram column", b?.tg_user_id == null, String(b?.tg_user_id));

  const c = await row(waRoom.id, vik);
  ok("a non-numeric member id is stored verbatim", c?.surface_user_id === "9198…@c.us");

  // Re-arrival must not blank what the first arrival recorded, and must undo a
  // leave — the two things `on conflict do update` is actually for here.
  await q(`update ${T("vy_group")}_member set left_at = now() where group_id = $1 and person_id = $2`, [
    tgRoom.id,
    rhea,
  ]);
  await upsertRoomMember(tgRoom.id, { personId: rhea, surface: null, surfaceUserId: null }, t);
  const d = await row(tgRoom.id, rhea);
  ok("re-upsert with no address does NOT blank the one on file",
    d?.surface === "telegram" && d?.surface_user_id === "77" && String(d?.tg_user_id) === "77",
    JSON.stringify(d));
  ok("…and a returning member is active again", d?.left_at === null);

  const [{ n }] = await q(
    `select count(*)::int n from ${T("vy_group")}_member where surface is null`,
  );
  ok("NO member row is left without a surface address", n === 0, String(n));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 7. 013's backfill repairs a legacy row and never misfires ──");
//
// The backfill matched zero rows on the production apply (both tables were
// empty). Zero rows is not evidence that it does the right thing to a row, so
// it is exercised here on the shape it was written for.
{
  const key = "-55500011122";
  await q(
    `insert into ${T("vy_group")} (agent_id, name, kind, room_device_id, tg_chat_id)
     values ($1,$2,'friend_group',$3,$4)`,
    [MEERA_AGENT_ID, `${TAG}backfill`, surfaceRoomDeviceId("telegram", key), key],
  );
  await q(
    `insert into ${T("vy_group")}_member (agent_id, group_id, person_id, tg_user_id)
       select $1, id, $2, 4242 from ${T("vy_group")} where tg_chat_id = $3`,
    [MEERA_AGENT_ID, "33333333-3333-4333-8333-333333333333", key],
  );

  const backfill = stmtsFor("013_surface_room_binding.sql").filter((s) => /^\s*update/im.test(s.replace(/--[^\n]*\n/g, "")));
  ok("013 carries exactly two backfill statements", backfill.length === 2, String(backfill.length));
  for (const s of backfill) await q(ns(s), [], 60_000);

  const [g] = await q(`select surface, surface_chat_id from ${T("vy_group")} where tg_chat_id = $1`, [key]);
  ok("the backfill adopts an unadopted legacy room", g?.surface === "telegram" && g?.surface_chat_id === key,
    JSON.stringify(g));
  const [m] = await q(
    `select surface, surface_user_id from ${T("vy_group")}_member where tg_user_id = 4242`,
  );
  ok("…and an unadopted legacy member", m?.surface === "telegram" && m?.surface_user_id === "4242", JSON.stringify(m));

  // The `and surface is null` guard is what makes it impossible for a replay to
  // re-address a room the new writer owns. Discord 9001 is the row that would
  // be destroyed if that guard were ever dropped.
  for (const s of backfill) await q(ns(s), [], 60_000);
  const [dc] = await q(`select surface, surface_chat_id, tg_chat_id from ${T("vy_group")} where id = $1`, [dcRoom.id]);
  ok("re-running the backfill leaves a NON-Telegram room untouched",
    dc?.surface === "discord" && dc?.surface_chat_id === "9001" && dc?.tg_chat_id == null,
    JSON.stringify(dc));
  const [wa] = await q(`select surface from ${T("vy_group")} where id = $1`, [waRoom.id]);
  ok("…and a WhatsApp room untouched", wa?.surface === "whatsapp");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── teardown ──");
if (KEEP) {
  console.log(`  (--keep) fixture left up under ${PREFIX}*`);
} else {
  const dropped = await teardown();
  console.log(`  dropped ${dropped} fixture relation(s)`);
}
const residue = await proveNoResidue();
const after = await productionCounts();
ok(
  "zero residue: no fixture relation survives, no production row carries the tag",
  KEEP || (residue.relations.length === 0 && residue.production.tagged_groups === 0 && residue.production.tagged_keys === 0),
  JSON.stringify(residue),
);
ok(
  "the PRODUCTION tables are exactly as they were before this suite ran",
  before.groups === after.groups && before.members === after.members,
  `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`,
);

console.log(
  failures.length
    ? `\n${failures.length} of ${pass + failures.length} BINDING CHECKS FAILED:\n` +
        failures.map((f) => `  - ${f}`).join("\n")
    : `\nALL ${pass} BINDING CHECKS PASS`,
);
console.log(
  "\nNOT PROVEN HERE (named, so nobody reads more into a green run):\n" +
    "  - that a real Telegram chat id round-trips through a real webhook. That needs\n" +
    "    TELEGRAM_BOT_TOKEN and a real group; evals/mp/tgbot.mjs drives the handler\n" +
    "    with mock updates, which is as far as offline goes.\n" +
    "  - the OTHER agent-scoped writers. api/_room.js's episode, turn and grant\n" +
    "    inserts still do not name agent_id, and production has had 010's default\n" +
    "    dropped since it was applied. That is a live break in a file this suite\n" +
    "    does not own — see docs/SURFACES.md §4.",
);
process.exitCode = failures.length ? 1 : 0;
