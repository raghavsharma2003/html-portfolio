// A NON-TELEGRAM surface, end to end — WS-SURFACE, SPEC-AGENT-LAYER §4.
//
//   node evals/surface/pipeline.mjs
//   node evals/surface/pipeline.mjs --cleanup
//
// evals/surface/contract.mjs asserts that three adapters have the right SHAPE.
// This one asserts the thing that actually matters and that a shape check
// cannot reach: **a surface nobody wrote the engine for can drive the whole
// pipeline without the engine learning anything about it.**
//
// So a Discord webhook payload — a real one's shape, not an InboundEvent typed
// by hand — goes in at api/discord.js's `parse()`, and what comes out the far
// end is a person resolved through vy_surface_identity, a DM device bound, a
// turn logged with both keys, a recall that went through the disclosure
// predicate, a prompt compiled by the REAL compiler and the REAL persona, and
// bytes handed to `send()` split to Discord's 2,000. Not one line of
// api/_surface.js mentions Discord.
//
// If this suite ever needs a `if (surface === ...)` in the engine half to pass,
// §10's E3 reversal condition has fired and the contract is wrong.
//
// Offline: no Discord, no model, no money. `send` and `reply` are injected —
// `reply` specifically so the assertions land on the COMPILED PROMPT rather
// than on a generated sentence.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { q } from "../../api/_db.js";
import { splitSql } from "../../db/migrations/apply.mjs";
import { MIG_FILES } from "../mp/harness.mjs";
import { dispatch, makeCtx } from "../../api/_surface.js";
import * as discord from "../../api/discord.js";
import { linkSurfacePerson, surfaceDmDeviceId } from "../../api/_room.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const PREFIX = "wssp_test_";
const TAG = "wssp-test-";
const T = (n) => PREFIX + n;
const t = (n) => PREFIX + n;
const CLEANUP_ONLY = process.argv.includes("--cleanup");

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

const NAMES = [
  "meera_log", "vy_episode", "vy_fact", "vy_phrase", "vy_embedding",
  "vy_group", "vy_disclosure_grant", "vy_tg_person", "vy_person",
  "vy_rel_state", "vy_surface_identity",
];
const NS_RE = new RegExp(`(^|[^\\w.])(${NAMES.join("|")})`, "g");
const ns = (sql) => sql.replace(NS_RE, (_m, pre, id) => `${pre}${PREFIX}${id}`);

const BASE_TABLES = new Set([
  "meera_log", "vy_episode", "vy_fact", "vy_phrase", "vy_embedding",
  "vy_person", "vy_person_device", "vy_rel_state",
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

async function proveNoResidue() {
  const rels = await q(
    `select tablename from pg_tables where schemaname = 'public' and tablename like $1`,
    [`${PREFIX}%`],
  );
  const hits = [];
  for (const [table, where] of [
    ["meera_log", `content like '${TAG}%'`],
    ["vy_fact", `body like '${TAG}%'`],
    ["vy_surface_identity", `handle like '${TAG}%'`],
  ]) {
    const [row] = await q(`select count(*)::int n from ${table} where ${where}`).catch(() => [{ n: 0 }]);
    if (Number(row?.n || 0) > 0) hits.push(`${table}: ${row.n}`);
  }
  return { relations: rels.map((r) => r.tablename), productionRows: hits };
}

if (CLEANUP_ONLY) {
  const n = await teardown();
  const res = await proveNoResidue();
  console.log(`dropped ${n} fixture relation(s); residue: ${JSON.stringify(res)}`);
  process.exit(res.relations.length || res.productionRows.length ? 1 : 0);
}

// ── schema ────────────────────────────────────────────────────────────────
console.log("── fixture namespace ──");
await teardown();
const full = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const cut = full.indexOf("-- 008a/008b/008c: multiparty v1");
const baseStmts = splitSql(cut < 0 ? full : full.slice(0, cut)).filter((s) => BASE_TABLES.has(targetOf(s)));
const migStmts = MIG_FILES.flatMap((f) => splitSql(readFileSync(join(ROOT, "db/migrations", f), "utf8")));
const idStmts = splitSql(readFileSync(join(ROOT, "db/migrations/009_agents.sql"), "utf8")).filter(
  (s) => targetOf(s) === "vy_surface_identity",
);
for (const s of [...baseStmts, ...migStmts, ...idStmts]) await q(ns(s), [], 60_000);
console.log(`  ok   ${baseStmts.length + migStmts.length + idStmts.length} statements -> ${PREFIX}*`);

const engine = await import("../../api/_engine.gen.js");

// ── the injected wire ─────────────────────────────────────────────────────
const sent = [];
let lastCompiled = null;
const deps = {
  t,
  engine,
  // The CONTRACT-shaped send: (chatKey, OutboundMessage). No Telegram-flavoured
  // {message, react} object anywhere — this is the shape a new surface writes.
  send: async (chatKey, msg) => {
    sent.push({ chatKey, ...msg });
    return { ok: true };
  },
  reply: async (compiled) => {
    lastCompiled = compiled;
    return `${TAG}` + "haan bol na, ".repeat(400); // deliberately over 2,000 chars
  },
  botHandle: "Meera",
};
const ctx = makeCtx(discord.adapter, deps);

// ── a person who exists on Discord and nowhere else ───────────────────────
console.log("\n── a Discord human, resolved through vy_surface_identity ──");
const DC_USER = "418000000000000001";
const CHANNEL = "998000000000000002";
const bound = await linkSurfacePerson("discord", DC_USER, { handle: `${TAG}rhea` }, t);
ok("linking a Discord user creates a person", Boolean(bound?.personId) && bound.created === true);
const legacy = await q(`select count(*)::int n from ${T("vy_tg_person")}`);
ok("…and writes NOTHING to the Telegram legacy table", legacy[0].n === 0);

// something she knows about this person, cited to their own 1:1 episode, so
// the recall below has to come through the disclosure predicate to be found
const [ep] = await q(
  `insert into ${T("vy_episode")} (person_id, channel, participation, disclosure_scope, started_at, summary)
   values ($1,'chat','user','participants_1to1', now(), $2) returning id`,
  [bound.personId, `${TAG}dc ep`],
);
await q(`insert into ${T("vy_episode")}_participant (episode_id, person_id) values ($1,$2)`, [ep.id, bound.personId]);
await q(
  `insert into ${T("vy_fact")} (person_id, kind, name, body, provenance, citations)
   values ($1,'user',$2,$3,'extracted',$4)`,
  [bound.personId, `${TAG}f1`, `${TAG}she is learning bass guitar`, [ep.id]],
);

// ── the whole pipeline, from a raw Discord payload ────────────────────────
console.log("\n── one Discord webhook payload, all the way through ──");
const payload = {
  d: {
    id: "777000000000000003",
    channel_id: CHANNEL,
    content: `${TAG}kya kar rahi hai`,
    author: { id: DC_USER, username: `${TAG}rhea` },
  },
};
const [ev] = discord.parse(payload);
ok("discord.parse produced a 1:1 message event", ev.kind === "message" && ev.isGroup === false);
const out = await dispatch(ev, ctx);
ok("the shared pipeline answered", out.ok === true && out.dm === true, JSON.stringify({ ...out, person: "…" }));
ok("it resolved the SAME person the link created", out.person === bound.personId);
ok("she recalled through the disclosure predicate", out.recalled === 1, `${out.recalled} row(s)`);
ok("she spoke", out.said === true);

// storage: both keys, no group
const rows = await q(
  `select role, device_id, speaker_person_id, group_id, content from ${T("meera_log")}
    where speaker_person_id = $1 order by id`,
  [bound.personId],
);
ok("the user's turn and hers are both logged", rows.length === 2, `${rows.length} rows`);
ok("both carry the speaker person (008a)", rows.every((r) => r.speaker_person_id === bound.personId));
ok("neither carries a group_id — a DM is not a room", rows.every((r) => r.group_id == null));
ok("the device is the DISCORD synthetic DM device, not a Telegram one",
  rows.every((r) => r.device_id === surfaceDmDeviceId("discord", DC_USER)));
ok("…and it differs from the Telegram device for the same user number",
  surfaceDmDeviceId("discord", DC_USER) !== surfaceDmDeviceId("telegram", DC_USER));
const mapped = await q(`select person_id from ${T("vy_person")}_device where device_id = $1`, [
  surfaceDmDeviceId("discord", DC_USER),
]);
ok("the DM device IS in vy_person_device (a DM turn is exclusively theirs)",
  mapped[0]?.person_id === bound.personId);

// ── the prompt: the REAL compiler, the 1:1 lane, no mp blocks ─────────────
console.log("\n── the compiled prompt is the real one (G1) ──");
ok("a prompt was compiled", lastCompiled != null);
ok("the recalled fact reached the prompt", lastCompiled.tail.includes(`${TAG}she is learning bass`));
ok("no room bundle => mp.roster renders zero bytes (G1)",
  (lastCompiled.sections?.["mp.roster"] || 0) === 0);
ok("no room bundle => mp.bridge renders zero bytes (G1)",
  (lastCompiled.sections?.["mp.bridge"] || 0) === 0);
ok("the room note never entered core", !lastCompiled.core.includes("YOU ARE IN A GROUP ROOM"));
// the safety floor is SURFACE-BLIND: a new transport does not get a softer Meera
ok("crisis helplines present on a brand-new surface",
  lastCompiled.core.includes(engine.CRISIS_LINES.trim().slice(0, 40)));
ok("NEVER MANIPULATE present on a brand-new surface", /NEVER MANIPULATE/.test(lastCompiled.core));
ok("never-deny-being-an-AI present on a brand-new surface",
  /sincerely and directly ask whether you're an AI, don't lie/.test(lastCompiled.core));

// ── delivery: the ADAPTER's limit, applied by the adapter ─────────────────
console.log("\n── delivery split at Discord's 2,000, by Discord's render() ──");
ok("something was sent", sent.length > 0, `${sent.length} fragment(s)`);
ok("her reply was split into several fragments", sent.length > 1, `${sent.length}`);
ok("every fragment is within Discord's 2,000", sent.every((s) => s.text.length <= 2000),
  `max ${Math.max(...sent.map((s) => s.text.length))}`);
ok("every fragment went to the channel the event named", sent.every((s) => s.chatKey === CHANNEL));
ok("the engine handed the adapter an OutboundMessage, not a Discord body",
  sent.every((s) => s.kind === "text" && "replyTo" in s && "buttons" in s));
// what was logged is the WHOLE reply, not the first fragment: the split is a
// wire concern and memory must not inherit it
const herRow = rows.find((r) => r.role === "her");
ok("the LOGGED reply is the whole message, not one fragment",
  herRow.content.length > 2000 || herRow.content.length === sent.map((s) => s.text).join(" ").length,
  `${herRow.content.length}c logged vs ${sent[0].text.length}c first fragment`);

// ── an unlinked Discord user is answered by nothing, stored as nothing ────
console.log("\n── §6.4 holds on a surface it was never written for ──");
const before = (await q(`select count(*)::int n from ${T("meera_log")}`))[0].n;
const [stranger] = discord.parse({
  d: { id: "1", channel_id: "2", content: "hello", author: { id: "999000000000000009", username: "x" } },
});
const strangerOut = await dispatch(stranger, ctx);
const after = (await q(`select count(*)::int n from ${T("meera_log")}`))[0].n;
ok("an unlinked speaker is skipped", strangerOut.skipped === "unlinked" && strangerOut.person === null);
ok("…and NOTHING was written for them", after === before, `${before} -> ${after}`);

// ── teardown ──────────────────────────────────────────────────────────────
console.log("\n── teardown ──");
const dropped = await teardown();
console.log(`  dropped ${dropped} fixture relation(s)`);
const residue = await proveNoResidue();
ok("zero residue", residue.relations.length === 0 && residue.productionRows.length === 0,
  JSON.stringify(residue));

console.log(
  failures.length
    ? `\n${failures.length} of ${pass + failures.length} checks FAILED:\n` +
        failures.map((f) => `  - ${f}`).join("\n")
    : `\nall ${pass} checks passed`,
);
process.exit(failures.length ? 1 : 0);
