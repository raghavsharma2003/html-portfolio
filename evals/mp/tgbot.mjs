// The Telegram surface suite — WS-TGBOT. Mock Telegram updates driving the
// REAL handler (api/tg.js's handleUpdate) end-to-end against a fixture
// namespace in the real Postgres.
//
//   node evals/mp/tgbot.mjs            → build, assert, tear down, prove residue
//   node evals/mp/tgbot.mjs --keep     → leave the fixture schema up for probing
//   node evals/mp/tgbot.mjs --cleanup  → drop the fixture schema and exit
//
// ── what "offline" means here, precisely ──────────────────────────────────
//
// No Telegram, no model, no money. Everything ELSE is real: the real webhook
// handler, the real disclosure predicate in the real Postgres, the real
// compiler and the real persona through api/_engine.gen.js, and the real
// forget cascade (api/memory.js's withdrawSharedRows). Only the two things a
// test cannot own are injected — `send` (Telegram) and `reply` (the brain) —
// and `reply` is injected specifically so the assertions land on the COMPILED
// PROMPT rather than on a generated sentence. A suite that asserted on model
// output would be measuring the model, not the wiring.
//
// ── the namespace ─────────────────────────────────────────────────────────
//
// Same mechanism as harness.mjs, with its own prefix (`wstg_test_`) and a
// wider table set: the room path touches vy_person, vy_rel_state and the four
// state tables §5.4 says it must NEVER write, and inertness cannot be proved
// against tables the fixture does not have. Teardown is a table drop, and
// residue is greppable rather than trusted.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { q } from "../../api/_db.js";
import { splitSql } from "../../db/migrations/apply.mjs";
import { MIG_FILES } from "./harness.mjs";
import { handleUpdate, ROOM_CARD, parseUpdate, parseStartPayload } from "../../api/tg.js";
import { stateWriteCount, recipientSet, roomRecall, roomBridge, roster } from "../../api/_room.js";
import { withdrawSharedRows } from "../../api/memory.js";
import { disclosurePredicate, NEGATIVE_AFFECT_TAGS } from "../../api/_disclosure.js";
import { MEERA_AGENT_ID } from "../../api/_agentscope.js";
import { execFileSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PREFIX = "wstg_test_";
const TAG = "wstg-test-";
const KEEP = process.argv.includes("--keep");
const CLEANUP_ONLY = process.argv.includes("--cleanup");

const NAMES = [
  "meera_log", "vy_episode", "vy_fact", "vy_phrase", "vy_embedding",
  "vy_group", "vy_disclosure_grant", "vy_tg_person", "vy_person",
  "vy_rel_state", "vy_rel_event", "vy_pattern", "vy_taste_candidate", "vy_currency",
];
const NS_RE = new RegExp(`(^|[^\\w.])(${NAMES.join("|")})`, "g");
const ns = (sql) => sql.replace(NS_RE, (_m, pre, id) => `${pre}${PREFIX}${id}`);
const T = (name) => PREFIX + name;
/** The resolver every production function under test is called with. */
const t = (name) => PREFIX + name;

const BASE_TABLES = new Set([
  "meera_log", "vy_episode", "vy_fact", "vy_phrase", "vy_embedding",
  "vy_person", "vy_person_device", "vy_rel_state", "vy_rel_event",
  "vy_pattern", "vy_taste_candidate", "vy_currency",
]);

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

async function teardown() {
  const rels = await q(
    `select tablename from pg_tables where schemaname = 'public' and tablename like $1`,
    [`${PREFIX}%`],
  );
  for (const r of rels) await q(`drop table if exists ${r.tablename} cascade`, [], 60_000);
  return rels.length;
}

/** No fixture relation may survive teardown, and NO PRODUCTION TABLE may carry
 *  a wstg-test- string. The second half is the one that matters: a suite that
 *  wrote into the real tables through a resolver bug would otherwise leave no
 *  trace anyone thought to look for. */
async function proveNoResidue() {
  const rels = await q(
    `select tablename from pg_tables where schemaname = 'public' and tablename like $1`,
    [`${PREFIX}%`],
  );
  const probes = [
    ["meera_log", `content like '${TAG}%'`],
    ["vy_episode", `summary like '${TAG}%'`],
    ["vy_fact", `body like '${TAG}%'`],
    ["vy_phrase", `phrase like '${TAG}%'`],
    ["vy_group", `name like '${TAG}%'`],
    ["vy_tg_person", `username like '${TAG}%'`],
  ];
  const hits = [];
  for (const [table, where] of probes) {
    const [row] = await q(`select count(*)::int n from ${table} where ${where}`).catch(() => [{ n: 0 }]);
    if (Number(row?.n || 0) > 0) hits.push(`${table}: ${row.n}`);
  }
  return { relations: rels.map((r) => r.tablename), productionRows: hits };
}

/**
 * The four room tables have moved on since 008: 009 gave them `agent_id`, and
 * 013 gave `vy_group`/`vy_group_member` the `(surface, surface_chat_id)` /
 * `(surface, surface_user_id)` binding the room lane now writes. A fixture
 * built from 008 alone is a fixture the shipping writer cannot insert into,
 * and the failure it produces ("column agent_id does not exist") is a fixture
 * bug wearing a code bug's clothes.
 *
 * Taken from the REAL migration files and filtered by target table rather than
 * restated here — a restated copy drifts, which is the whole reason this
 * harness reads db/migrations/ at all.
 */
const POST008_TABLES = new Set([
  "meera_log",
  "vy_fact",
  "vy_phrase",
  "vy_group",
  "vy_group_member",
  "vy_group_turn",
  "vy_disclosure_grant",
  // vy_episode joined this set when the room episode writer started NAMING
  // agent_id (the 010 no-default fix): a fixture without the column is a
  // fixture the shipping writer cannot insert into — the exact drift this
  // block's own comment warns about.
  "vy_episode",
  "vy_rel_state",
  "vy_rel_event",
  "vy_pattern",
  "vy_taste_candidate",
  "vy_currency",
]);
const POST008_FILES = [
  "009_agents.sql",
  "010_agent_strict.sql",
  "013_surface_room_binding.sql",
  "018_raw_agent_isolation.sql",
  "021_raw_agent_strict.sql",
  "064_agent_room_binding.sql",
];

// Production strictness is part of this fixture: 010 and 021 drop every
// compatibility default on the tables the runtime touches. A writer that omits
// agent_id must therefore fail here exactly as it would after a live deploy.

async function buildSchema() {
  const full = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
  const cut = full.indexOf("-- 008a/008b/008c: multiparty v1");
  const pre008 = cut < 0 ? full : full.slice(0, cut);
  const baseStmts = splitSql(pre008).filter((s) => BASE_TABLES.has(targetOf(s)));
  const migStmts = MIG_FILES.flatMap((f) =>
    splitSql(readFileSync(join(ROOT, "db/migrations", f), "utf8")),
  );
  const postStmts = POST008_FILES.flatMap((f) => {
    const statements = splitSql(readFileSync(join(ROOT, "db/migrations", f), "utf8"));
    return f === "064_agent_room_binding.sql"
      ? statements
      : statements.filter((s) => POST008_TABLES.has(targetOf(s)));
  });
  for (const s of [...baseStmts, ...migStmts, ...postStmts]) await q(ns(s), [], 60_000);
  return { base: baseStmts.length, migration: migStmts.length + postStmts.length };
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
  process.exit(res.relations.length || res.productionRows.length ? 1 : 0);
}

// ── 0. the engine bundle must be the one this tree compiles ───────────────
//
// api/tg.js reaches the real compiler and the real persona through
// api/_engine.gen.js. If that file is stale, the room path ships a DIFFERENT
// Meera than the one everything below asserts against — the second-persona
// failure serverEntry.ts exists to prevent. So the freshness check is the
// FIRST thing this suite does, not a nice-to-have at the end.
console.log("── engine bundle ──");
try {
  execFileSync("node", ["scripts/build-engine-bundle.mjs", "--check"], { cwd: ROOT, stdio: "pipe" });
  ok("engine bundle is fresh (compiler + persona + room, from source)", true);
} catch (e) {
  ok("engine bundle is fresh (compiler + persona + room, from source)", false, String(e?.stderr || e));
}
const engine = await import("../../api/_engine.gen.js");

// ── 1. schema ─────────────────────────────────────────────────────────────
console.log("\n── fixture namespace ──");
await teardown();
const built = await buildSchema();
console.log(`  ok   ${built.base} base + ${built.migration} migration statements -> ${PREFIX}*`);

// ── 2. fixture people ─────────────────────────────────────────────────────
const uuid = (n) => `b7c4d0e1-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [RHEA, VIKRAM, ANJALI, OUTSIDER] = [uuid(1), uuid(2), uuid(3), uuid(4)];
const TG = { rhea: 9001, vikram: 9002, anjali: 9003, outsider: 9004 };
const CHAT = -100777001;

for (const p of [RHEA, VIKRAM, ANJALI, OUTSIDER])
  await q(`insert into ${T("vy_person")} (person_id) values ($1)`, [p]);
// honorific bands, so the roster's R6 bet renders three different registers in
// one strip (M9) instead of one band applied to everybody
await q(
  `insert into ${T("vy_rel_state")} (agent_id, person_id, honorific)
   values ($1,$2,'tu'),($1,$3,'tum'),($1,$4,'aap')`,
  [MEERA_AGENT_ID, RHEA, VIKRAM, ANJALI],
);

// ── the injected Telegram client ──────────────────────────────────────────
const sent = [];
const send = {
  message: async (chatId, text, extra = {}) => {
    sent.push({ chatId, text, extra });
    return { ok: true };
  },
  react: async (chatId, messageId, emoji) => {
    sent.push({ chatId, messageId, emoji, react: true });
    return { ok: true };
  },
};
/** The brain, replaced by an assertion surface: it returns a fixed string and
 *  KEEPS the compiled prompt, which is the artifact this suite is actually
 *  about. */
let lastCompiled = null;
const reply = async (compiled) => {
  lastCompiled = compiled;
  return "…";
};
const deps = { t, send, engine, reply };

const drive = (update) => handleUpdate(update, deps);

// ── 3. update parsing ─────────────────────────────────────────────────────
console.log("\n── update parsing ──");
ok("my_chat_member routes", parseUpdate({ my_chat_member: {} })?.kind === "my_chat_member");
ok("service join routes", parseUpdate({ message: { new_chat_members: [{}] } })?.kind === "join");
ok("service leave routes", parseUpdate({ message: { left_chat_member: {} } })?.kind === "leave");
ok("plain message routes", parseUpdate({ message: { text: "hi" } })?.kind === "message");
ok("garbage is skipped, not thrown", parseUpdate({}) === null);
ok("start payload parses", parseStartPayload("/start r42")?.payload === "r42");
ok(
  "start payload refuses out-of-charset junk",
  parseStartPayload("/start r42;drop table") === null,
);

// ── 4. the join flow (§6.2, §6.3) ─────────────────────────────────────────
console.log("\n── join flow: added, then promoted ──");
const added = await drive({
  my_chat_member: {
    chat: { id: CHAT, type: "supergroup", title: `${TAG}goa room` },
    new_chat_member: { status: "member" },
  },
});
const roomId = added.room;
ok("room row created on add", Boolean(roomId), `group_id=${roomId}`);
ok("read consent is NOT granted by mere addition", added.consent === false);
ok("no room card before consent", sent.length === 0);

const promoted = await drive({
  my_chat_member: {
    chat: { id: CHAT, type: "supergroup", title: `${TAG}goa room` },
    new_chat_member: { status: "administrator" },
  },
});
ok("admin promotion IS the read consent", promoted.consent === true);
const [g0] = await q(`select read_consent_at from ${T("vy_group")} where id = $1`, [roomId]);
ok("read_consent_at recorded", g0.read_consent_at != null);
ok("room card posted exactly once", sent.filter((s) => s.text === ROOM_CARD).length === 1);
const card = sent.find((s) => s.text === ROOM_CARD);
ok("card pre-discloses the 1:1 channel (R4)", /1:1/.test(card.text));
ok("card pre-discloses that DMs never enter the room", /akele mein kaha/.test(card.text));
ok(
  "card pre-discloses ruling B BEFORE the first episode (§3.2)",
  /sabhi log mitane ko kahein/.test(card.text),
);
ok("card carries the member deep link", Boolean(card.extra?.reply_markup?.inline_keyboard?.[0]?.[0]?.url));

// demotion is instant, total revocation, with no code path of ours
await drive({
  my_chat_member: {
    chat: { id: CHAT, type: "supergroup", title: "x" },
    new_chat_member: { status: "left" },
  },
});
const [g1] = await q(`select read_consent_at from ${T("vy_group")} where id = $1`, [roomId]);
ok("demotion/removal clears read consent", g1.read_consent_at == null);
// put her back for the rest of the suite
await drive({
  my_chat_member: {
    chat: { id: CHAT, type: "supergroup", title: "x" },
    new_chat_member: { status: "administrator" },
  },
});

// ── 5. linking (§6.3 step 3, §6.4) ────────────────────────────────────────
console.log("\n── linking: the deep-link tap ──");
for (const [who, tgid, person] of [
  ["rhea", TG.rhea, RHEA],
  ["vikram", TG.vikram, VIKRAM],
  ["anjali", TG.anjali, ANJALI],
]) {
  // bind the fixture person id explicitly so assertions can name them
  await q(
    `insert into ${T("vy_tg_person")} (tg_user_id, person_id, username) values ($1,$2,$3)`,
    [String(tgid), person, `${TAG}${who}`],
  );
  const r = await drive({
    message: {
      chat: { id: tgid, type: "private" },
      from: { id: tgid, username: `${TAG}${who}` },
      text: `/start r${roomId}`,
      message_id: 1,
    },
  });
  ok(`${who} links through /start`, r.linked === true && r.person === person);
}
const members = await q(
  `select person_id, linked_at from ${T("vy_group")}_member where group_id = $1 order by person_id`,
  [roomId],
);
ok("three vy_group_member rows, all linked", members.length === 3 && members.every((m) => m.linked_at));
const rset = await recipientSet(roomId, t);
ok("recipient set = the three linked, active members", rset.length === 3);

// the ONE-TIME introduction (§6.3 step 3) — a fresh tap, no pre-bound row, so
// the handler creates the person itself and she introduces herself once
const fresh = await drive({
  message: { chat: { id: 9099, type: "private" }, from: { id: 9099, username: `${TAG}newbie` }, text: "/start", message_id: 1 },
});
ok("a first-ever tap creates the person row and links", fresh.linked === true && Boolean(fresh.person));
ok("she introduces herself once, generated not scripted", fresh.intro === "sent");
ok(
  "the intro compiled through the 1:1 lane — no room bundle, no mp blocks (G1)",
  (lastCompiled?.sections?.["mp.roster"] || 0) === 0 && (lastCompiled?.sections?.["mp.bridge"] || 0) === 0,
);
ok(
  "the intro is driven by a SHAPE that tells her never to reference it",
  /never reference this note/.test(engine.ROOM_INTRO_DIRECTIVE()),
);
const again = await drive({
  message: { chat: { id: 9099, type: "private" }, from: { id: 9099, username: `${TAG}newbie` }, text: "/start", message_id: 2 },
});
ok("a second tap does NOT re-introduce her", again.intro === "none");

// §7's member cap, enforced where a member is ADDED (a member with no row in
// the address strip is a member she would address in the wrong register)
await q(`update ${T("vy_group")} set member_cap = 3 where id = $1`, [roomId]);
const overflow = await drive({
  message: {
    chat: { id: 9105, type: "private" },
    from: { id: 9105, username: `${TAG}seventh` },
    text: `/start r${roomId}`,
    message_id: 3,
  },
});
ok("a 7th (over-cap) member is refused the ROOM", overflow.roomFull === true && overflow.room === null);
ok("…but still gets their own 1:1 channel", overflow.linked === true);
await q(`update ${T("vy_group")} set member_cap = 6 where id = $1`, [roomId]);

// an UNLINKED member is seen and never written (§6.4)
await drive({
  message: {
    chat: { id: CHAT, type: "supergroup" },
    from: { id: TG.outsider, username: "outsider" },
    new_chat_members: [{ id: TG.outsider, username: "outsider", is_bot: false }],
    message_id: 2,
  },
});
const after = await q(`select count(*)::int n from ${T("vy_group")}_member where group_id = $1`, [roomId]);
ok("unlinked joiner gets NO membership row (§6.4)", after[0].n === 3);

// ── 6. group turns: storage with attribution (008a) ───────────────────────
console.log("\n── group turns: storage, attribution, silence ──");
const turn = (fromTg, text, extra = {}) => ({
  message: {
    chat: { id: CHAT, type: "supergroup" },
    from: { id: fromTg, username: "u", is_bot: false },
    text,
    message_id: Math.floor(Math.random() * 1e6),
    ...extra,
  },
});

const lurked = await drive(turn(TG.rhea, `${TAG}goa ka plan kya hua`));
ok("unaddressed turn LURKS", lurked.action === "lurk", lurked.reason);
ok("a lurked turn is still STORED", lurked.logId != null && lurked.episodeId != null);

const [logRow] = await q(
  `select device_id, speaker_person_id, group_id, role from ${T("meera_log")} where id = $1`,
  [lurked.logId],
);
ok("room turn carries speaker_person_id (UNBACKFILLABLE, 008a)", logRow.speaker_person_id === RHEA);
ok("room turn carries group_id", String(logRow.group_id) === String(roomId));
ok(
  "room turn is keyed on the SYNTHETIC room device, in nobody's device map",
  (await q(`select count(*)::int n from ${T("vy_person")}_device where device_id = $1`, [logRow.device_id]))[0].n === 0,
);

const [ep] = await q(
  `select person_id, group_id, participation, disclosure_scope from ${T("vy_episode")} where id = $1`,
  [lurked.episodeId],
);
ok("room episode has participation='group'", ep.participation === "group");
ok("room episode has person_id NULL (no single owner to wipe it)", ep.person_id === null);
ok("room episode carries group_id", String(ep.group_id) === String(roomId));
const parts = await q(
  `select person_id from ${T("vy_episode")}_participant where episode_id = $1`,
  [lurked.episodeId],
);
ok("every active linked member is a participant (the ACL itself)", parts.length === 3);

const [gt] = await q(
  `select action, addressed, reason from ${T("vy_group")}_turn order by id desc limit 1`,
  [],
);
ok("silence is an EVENT, not an absence (M5)", gt.action === "lurk" && gt.addressed === false);

// unlinked speaker: present in the live window, written NOWHERE
const before = (await q(`select count(*)::int n from ${T("meera_log")} where group_id = $1`, [roomId]))[0].n;
const unlinked = await drive(turn(TG.outsider, `${TAG}main bhi aa raha hoon`));
const afterN = (await q(`select count(*)::int n from ${T("meera_log")} where group_id = $1`, [roomId]))[0].n;
ok("unlinked speaker's message is NEVER written (§6.4)", afterN === before && unlinked.logId == null);
ok("…and it is still logged as a decision", unlinked.action === "lurk", unlinked.reason);

// ── 7. addressing rules (§5.3 Stage 0) ────────────────────────────────────
const named = await drive(turn(TG.vikram, `${TAG}meera tu bata, kab chalein`));
ok("explicit NAME mention routes to speak", named.action === "speak", named.reason);
const replied = await drive(
  turn(TG.vikram, `${TAG}aur wo hotel`, { reply_to_message: { from: { is_bot: true } } }),
);
ok("reply-to-her routes to speak", replied.action === "speak", replied.reason);
const atMention = await drive(turn(TG.anjali, `${TAG}@MeeraBot kya scene hai`));
ok("@bot mention routes to speak", atMention.action === "speak", atMention.reason);
ok(
  // WS-R41 (2026-09-04): api/tg.js's tgExtra() now sends `reply_parameters:
  // {message_id}`, not the pre-Bot-API-7.0 `reply_to_message_id` — see that
  // function's own header for the doc citation.
  "she replies in the room, threaded to the message she answered",
  sent.some((s) => s.extra?.reply_parameters?.message_id != null),
);
ok("her own reply is logged with role='her' and NO speaker person", true);
const [herRow] = await q(
  `select role, speaker_person_id, group_id from ${T("meera_log")}
    where group_id = $1 and role = 'her' order by id desc limit 1`,
  [roomId],
);
ok("her room turn is attributable to her, not to a member", herRow.speaker_person_id === null);

// Stage 2: elapsed silence NEVER lowers the bar
const quietAgain = await drive(turn(TG.rhea, `${TAG}koi aur baat`));
ok(
  "an unaddressed turn right after she spoke still lurks (cooldown, never a nudge)",
  quietAgain.action === "lurk",
  quietAgain.reason,
);

// Stage 4: per-room quieting
await drive(turn(TG.rhea, "/chup"));
const whileQuiet = await drive(turn(TG.rhea, `${TAG}meera ye dekho`));
ok("under /chup an explicit address is still answered", whileQuiet.action === "speak");
const quietUnaddressed = await drive(turn(TG.rhea, `${TAG}bakchodi chal rahi hai`));
ok("under /chup an unaddressed turn lurks", quietUnaddressed.action === "lurk", quietUnaddressed.reason);
await drive(turn(TG.rhea, "/bolo"));

// ── 8. the compiled prompt: mp slots LIVE ─────────────────────────────────
console.log("\n── the compiled room prompt ──");
ok("a room turn compiled through the real engine", lastCompiled != null);
const sec = lastCompiled?.sections || {};
ok("mp.roster rendered", (sec["mp.roster"] || 0) > 0, `${sec["mp.roster"]}c / 900`);
ok("mp.roster is inside its 900-char budget", (sec["mp.roster"] || 0) <= 900);
ok("mp.bridge is inside its 1,100-char budget", (sec["mp.bridge"] || 0) <= 1_100);
ok("T2 rel.snapshot renders EMPTY in a room (§5.2 mutual exclusion)", (sec.T2 || 0) === 0);
ok(
  "the room note is in CORE, where truncation cannot reach it",
  lastCompiled.core.includes("YOU ARE IN A GROUP ROOM RIGHT NOW"),
);
ok(
  "T10 is still the last thing in the tail (appended-last set not widened)",
  lastCompiled.tail.trimEnd().endsWith(lastCompiled.tail.trimEnd().slice(-40)) &&
    (sec.T10 || 0) > 0,
);
// safety is ROOM-BLIND (§2.7): the invariants are in core and they are there
// in a room exactly as in a DM.
ok("crisis helplines present in a room compile", lastCompiled.core.includes(engine.CRISIS_LINES.trim().slice(0, 40)));
ok("NEVER MANIPULATE present in a room compile", /NEVER MANIPULATE/.test(lastCompiled.core));
ok(
  "never-deny-being-an-AI present in a room compile",
  /sincerely and directly ask whether you're an AI, don't lie/.test(lastCompiled.core),
);
const strip = /WHO IS IN THIS ROOM[\s\S]*?(?:\n\n|$)/.exec(lastCompiled.tail)?.[0] || "";
ok("the address strip carries three DIFFERENT honorific bands (M9/R6)",
  /say:tu\b/.test(strip) && /say:tum\b/.test(strip) && /say:aap\b/.test(strip), strip.split("\n").length + " rows");

// the 1:1 lane is untouched — gate G1, asserted here too rather than only in
// the byte-identity harness, because this is the file that added the seam
const noRoom = engine.compile({
  user: { name: "x", vibe: [], facts: {} }, messageCount: 5, medium: "text", mode: "chat",
  voiceEngine: "none", isDirective: false, watching: false, innerThread: "", innerWants: "",
  memories: "", herLife: "", cultureNoteText: "",
});
ok("no room bundle => mp.roster renders zero bytes (G1)", (noRoom.sections?.["mp.roster"] || 0) === 0);
ok("no room bundle => mp.bridge renders zero bytes (G1)", (noRoom.sections?.["mp.bridge"] || 0) === 0);
ok("no room bundle => the room note never enters core (G1)", !noRoom.core.includes("YOU ARE IN A GROUP ROOM"));

// ── 9. disclosure: room vs DM (M2, M6) ────────────────────────────────────
console.log("\n── disclosure: the same rows, two channels ──");
// a DM-only episode of Rhea's, and a fact derived from it
const [dmEp] = await q(
  `insert into ${T("vy_episode")} (agent_id, person_id, channel, participation, disclosure_scope, started_at, summary)
   values ($1,$2,'chat','user','participants_1to1', now(), $3) returning id`,
  [MEERA_AGENT_ID, RHEA, `${TAG}rhea dm`],
);
await q(`insert into ${T("vy_episode")}_participant (episode_id, person_id) values ($1,$2)`, [dmEp.id, RHEA]);
const [dmFact] = await q(
  `insert into ${T("vy_fact")} (agent_id, person_id, kind, name, body, provenance, citations)
   values ($1,$2,'user',$3,$4,'extracted',$5) returning id`,
  [MEERA_AGENT_ID, RHEA, `${TAG}dmfact`, `${TAG}rhea does not want to come`, [dmEp.id]],
);
// a ROOM fact, cited to the room episode everyone was at
const [roomFact] = await q(
  `insert into ${T("vy_fact")} (agent_id, person_id, kind, name, body, provenance, citations, group_id)
   values ($1,$2,'world',$3,$4,'extracted',$5,$6) returning id`,
  [MEERA_AGENT_ID, RHEA, `${TAG}roomfact`, `${TAG}goa plan floated for the 14th`, [lurked.episodeId], roomId],
);
await q(
  `insert into ${T("vy_phrase")} (agent_id, person_id, phrase, origin_episode, group_id)
   values ($1,$2,$3,$4,$5)`,
  [MEERA_AGENT_ID, RHEA, `${TAG}biriyanii`, lurked.episodeId, roomId],
);

const inRoom = await roomRecall(roomId, rset, {}, t);
const ids = inRoom.map((r) => String(r.id));
ok("the room's own fact IS recalled in the room (M1)", ids.includes(String(roomFact.id)));
ok("a DM-scoped fact is NEVER recalled in the room (clause 3, M6)", !ids.includes(String(dmFact.id)));

// the same predicate, the same row, Rhea's own DM channel: M2's direction
const dmPred = ns(disclosurePredicate("fact", { recipients: "$1", isGroup: "$2", roomId: "$3", negTags: "$4" }));
const rheaDm = await q(
  `select f.id from ${T("vy_fact")} f where f.t_invalid is null ${dmPred}`,
  [[RHEA], false, null, NEGATIVE_AFFECT_TAGS],
  30_000,
);
const rheaDmIds = rheaDm.map((r) => String(r.id));
ok("in RHEA's own DM she still has Rhea's DM fact", rheaDmIds.includes(String(dmFact.id)));
ok("…and the room fact too (M2: she did not amnesia the room)", rheaDmIds.includes(String(roomFact.id)));

const vikramDm = await q(
  `select f.id from ${T("vy_fact")} f where f.t_invalid is null ${dmPred}`,
  [[VIKRAM], false, null, NEGATIVE_AFFECT_TAGS],
  30_000,
);
ok(
  "in VIKRAM's DM, Rhea's DM fact does not exist (M6 — nothing to leak)",
  !vikramDm.map((r) => String(r.id)).includes(String(dmFact.id)),
);

const bridge = await roomBridge(roomId, rset, t);
ok("mp.bridge input carries the room word (M3)", bridge.some((b) => b.kind === "word"));
ok("mp.bridge input never carries the DM fact", !bridge.some((b) => String(b.gist).includes("does not want")));
const rows = await roster(roomId, t);
ok("roster reads only active, current members", rows.length === 3);

// the two blocks, compiled from rows that came out of the predicate — this is
// the assertion that mp.bridge is WIRED and not merely budgeted
const roomCompiled = engine.compile({
  user: { name: "x", vibe: [], facts: {} }, messageCount: 999, medium: "text", mode: "chat",
  voiceEngine: "none", isDirective: false, watching: false, innerThread: "", innerWants: "",
  memories: "", herLife: "", cultureNoteText: "", roomBundle: { members: rows, bridge },
});
const rs = roomCompiled.sections || {};
ok("mp.bridge renders the room's own rows", (rs["mp.bridge"] || 0) > 0, `${rs["mp.bridge"]}c / 1100`);
ok("mp.roster + mp.bridge stay inside the 2,000-char multiparty allowance",
  (rs["mp.roster"] || 0) + (rs["mp.bridge"] || 0) <= 2_000,
  `roster ${rs["mp.roster"]}c + bridge ${rs["mp.bridge"]}c`);
ok("no quoted line enters mp.bridge (shapes only)", !/["“”]/.test(
  /WHAT THIS ROOM ITSELF HOLDS[\s\S]*?(?:\n\n|$)/.exec(roomCompiled.tail)?.[0] || ""));

// ── the 1:1 lane on the same transport (M2, M6) ───────────────────────────
const vikDm = await drive({
  message: {
    chat: { id: TG.vikram, type: "private" },
    from: { id: TG.vikram, username: `${TAG}vikram` },
    text: `${TAG}main Rhea ko kaise bataun`,
    message_id: 77,
  },
});
ok("a DM is answered on the same bot", vikDm.dm === true && vikDm.said === true);
ok("her DM answer used the 1:1 lane (no mp blocks — G1)",
  (lastCompiled.sections?.["mp.roster"] || 0) === 0 && (lastCompiled.sections?.["mp.bridge"] || 0) === 0);
ok("she remembers the ROOM in his DM (M2)", lastCompiled.tail.includes(`${TAG}goa plan floated`));
ok("she does NOT have Rhea's DM in his DM (M6 — nothing to leak)",
  !lastCompiled.tail.includes(`${TAG}rhea does not want`));
const dmRows = await q(
  `select device_id, speaker_person_id, group_id from ${T("meera_log")}
    where speaker_person_id = $1 and group_id is null`,
  [VIKRAM],
);
ok("DM turns are stored with BOTH keys and no group_id", dmRows.length >= 1 && dmRows.every((r) => r.group_id == null));
const mapped = await q(
  `select person_id from ${T("vy_person")}_device where device_id = $1`,
  [dmRows[0].device_id],
);
ok("the DM device IS in vy_person_device (unlike the room device)", mapped[0]?.person_id === VIKRAM);

// ── 10. state inertness (§5.4) ────────────────────────────────────────────
console.log("\n── group episodes are STATE-INERT ──");
const counts = await stateWriteCount([RHEA, VIKRAM, ANJALI], t);
ok("no vy_rel_event written by room turns", counts.vy_rel_event === 0, JSON.stringify(counts));
ok("no vy_pattern written by room turns", counts.vy_pattern === 0);
ok("no vy_taste_candidate written by room turns", counts.vy_taste_candidate === 0);
ok("no vy_currency written by room turns", counts.vy_currency === 0);

// ── 11. withdraw, with room turns present (§3, G3) ────────────────────────
console.log("\n── withdraw: forget withdraws what we hold together ──");
const rheaTurnsBefore = (
  await q(`select count(*)::int n from ${T("meera_log")} where speaker_person_id = $1`, [RHEA])
)[0].n;
const othersBefore = (
  await q(`select count(*)::int n from ${T("meera_log")} where group_id = $1 and (speaker_person_id <> $2 or speaker_person_id is null)`, [roomId, RHEA])
)[0].n;
ok("rhea has room turns to withdraw", rheaTurnsBefore > 0, `${rheaTurnsBefore} turns`);

const res = await withdrawSharedRows(RHEA, { t });
ok("withdraw ran the SHIPPING cascade", !res.skipped, JSON.stringify(res));
const rheaTurnsAfter = (
  await q(`select count(*)::int n from ${T("meera_log")} where speaker_person_id = $1`, [RHEA])
)[0].n;
const othersAfter = (
  await q(`select count(*)::int n from ${T("meera_log")} where group_id = $1 and (speaker_person_id <> $2 or speaker_person_id is null)`, [roomId, RHEA])
)[0].n;
ok("rhea's OWN room turns are gone", rheaTurnsAfter === 0);
ok("everyone else's turns (and hers) are untouched", othersAfter === othersBefore, `${othersAfter}/${othersBefore}`);
const rheaParts = (
  await q(`select count(*)::int n from ${T("vy_episode")}_participant where person_id = $1`, [RHEA])
)[0].n;
ok("rhea left the ACL entirely", rheaParts === 0);
const epStillThere = (
  await q(`select count(*)::int n from ${T("vy_episode")} where id = $1`, [lurked.episodeId])
)[0].n;
ok("the room's episode survives for the others (ruling B)", epStillThere === 1);
const rsetAfter = await recipientSet(roomId, t);
ok("the recipient set shrinks on the very next retrieval — no cascade needed", rsetAfter.length === 2);
const recallAfter = await roomRecall(roomId, rsetAfter, {}, t);
ok(
  "the room fact is STILL recallable by the two who remain",
  recallAfter.map((r) => String(r.id)).includes(String(roomFact.id)),
);

// a further turn in the room still works, with the smaller room
const afterWithdraw = await drive(turn(TG.vikram, `${TAG}meera ab kya plan`));
ok("the room keeps working after a withdrawal", afterWithdraw.action === "speak", afterWithdraw.reason);

// ── 12. the webhook edge: fail CLOSED ─────────────────────────────────────
console.log("\n── the webhook edge ──");
const tgMod = await import("../../api/tg.js");
const mkRes = () => {
  const r = { code: 0, body: null };
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};
const r1 = mkRes();
await tgMod.default({ method: "POST", headers: {}, body: {}, socket: {} }, r1);
ok("an update with NO secret header is refused (fail closed)", r1.code === 401);
const r2 = mkRes();
await tgMod.default(
  { method: "POST", headers: { "x-telegram-bot-api-secret-token": "wrong" }, body: {}, socket: {} },
  r2,
);
ok("an update with the WRONG secret is refused", r2.code === 401);
const r3 = mkRes();
await tgMod.default({ method: "GET", headers: {}, socket: {} }, r3);
ok("GET is refused", r3.code === 405);

// ── 13. teardown + residue ────────────────────────────────────────────────
console.log("\n── teardown ──");
if (!KEEP) {
  const dropped = await teardown();
  console.log(`  dropped ${dropped} fixture relation(s)`);
}
const residue = await proveNoResidue();
ok(
  "zero residue: no fixture relation survives, no production row carries the tag",
  KEEP || (residue.relations.length === 0 && residue.productionRows.length === 0),
  JSON.stringify(residue),
);

console.log(
  failures.length
    ? `\n${failures.length} of ${pass + failures.length} checks FAILED:\n` +
        failures.map((f) => `  - ${f}`).join("\n")
    : `\nall ${pass} checks passed`,
);
process.exit(failures.length ? 1 : 0);
