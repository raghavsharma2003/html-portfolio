// WS-R127 (migration 132). The Suite admin's weekly note:
// `api/_org-weekly-note.js` (the floor, the payload builder, the sweep, the
// admin test op) and `api/_email-seam.js` (the inert email channel), driven
// through a small self-contained fake db - this feature's own tables
// (`vy_org`, `vy_org_member`, `vy_room`, `vy_org_weekly_note`) are simple
// enough that a dedicated fixture is cheaper and clearer than threading
// `evals/room/fixtures.mjs`'s much larger follower-content world through a
// feature that touches none of it.
//
//   node evals/org-weekly-note/run.mjs
//
// Offline, deterministic, $0, no network, no real Postgres, no model call,
// no GPU.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};
const threwAsync = async (fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
};
// A crude but sufficient comment stripper for THIS file's own static
// controls - blanks `//` line comments and `/* */` block comments (never
// touching string contents byte-for-byte otherwise) so a scan for a code
// PATTERN is not tripped by this file's own prose describing that pattern,
// `scripts/check-copy.mjs`'s own "comments are house prose" distinction
// restated for a narrower purpose.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const {
  OrgWeeklyNoteError,
  orgWeeklyNoteRoomLine,
  buildOrgWeeklyNote,
  orgWeeklyNotePushPayload,
  sendOrgWeeklyNotes,
  sendTestOrgWeeklyNote,
  lastOrgWeeklyNote,
  orgsForWeeklyNote,
  orgAdminUserIds,
  ORG_WEEKLY_NOTE_FOLLOWER_CONTENT_NAMES_EXPORT,
} = await import(pathToFileURL(join(REPO, "api/_org-weekly-note.js")).href);
const { emailSeamConfigured, recordWouldSendOrgWeeklyNoteEmail } = await import(pathToFileURL(join(REPO, "api/_email-seam.js")).href);

const ORG_A = "d1000000-0000-4000-8000-000000000001";
const ADMIN = "d2000000-0000-4000-8000-000000000002";
const ADMIN_B = "d2000000-0000-4000-8000-000000000003"; // a stranger, not on ORG_A's roster
const ROOM_1 = "d3000000-0000-4000-8000-000000000001";
const ROOM_2 = "d3000000-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-09-08T04:00:00.000Z"); // a Tuesday; isoWeekStartDate normalizes to 2026-09-07
const WEEK_START = "2026-09-07";

const ENV = { ROOM_PUSH_VAPID_PUBLIC: "pub", ROOM_PUSH_VAPID_PRIVATE: "priv", ROOM_PUSH_VAPID_SUBJECT: "mailto:x@example.test" };

function freshState() {
  return {
    orgs: [{ org_id: ORG_A, name: "North Coaching" }],
    orgMembers: [{ org_id: ORG_A, owner_user_id: ADMIN, role: "admin" }],
    rooms: [
      { room_id: ROOM_1, org_id: ORG_A, display_name: "Anjali", published_at: "2026-08-01T00:00:00.000Z", paused_at: null, created_at: "2026-08-01T00:00:00.000Z" },
      { room_id: ROOM_2, org_id: ORG_A, display_name: "Rahul", published_at: "2026-08-01T00:00:00.000Z", paused_at: null, created_at: "2026-08-02T00:00:00.000Z" },
    ],
    followers: [], // { room_id, joined_at }
    followerDays: [], // { room_id, day, turns }
    weeklyNotes: [], // { note_id, org_id, week_start, channel }
  };
}

function orgDb(state) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);

    if (has("select room_id, display_name, published_at, paused_at") && has("from vy_room") && has("where org_id = ($1)::uuid")) {
      const [orgId] = params.map(String);
      return state.rooms.filter((r) => r.org_id === orgId).map((r) => ({ ...r }));
    }
    if (has("count(*)::int as n") && has("from vy_room_follower") && has("joined_at >=")) {
      const [roomId, nowIso] = params.map(String);
      const now = new Date(nowIso).getTime();
      const weekAgo = now - 7 * 86_400_000;
      const n = state.followers.filter((f) => f.room_id === roomId
        && new Date(f.joined_at).getTime() >= weekAgo && new Date(f.joined_at).getTime() < now).length;
      return [{ n }];
    }
    if (has("sum(turns)") && has("from vy_room_follower_day")) {
      const [roomId] = params.map(String);
      const n = state.followerDays.filter((d) => d.room_id === roomId).reduce((s, d) => s + Number(d.turns || 0), 0);
      return [{ n }];
    }
    if (has("select org_id, name from vy_org order by created_at asc limit")) {
      const [cap] = params;
      return state.orgs.slice(0, Number(cap)).map((o) => ({ ...o }));
    }
    if (has("select org_id, name from vy_org where org_id = ($1)::uuid limit 1")) {
      const [orgId] = params.map(String);
      const org = state.orgs.find((o) => o.org_id === orgId);
      return org ? [{ ...org }] : [];
    }
    if (has("select owner_user_id from vy_org_member where org_id = ($1)::uuid and role = 'admin'") && !has("limit 1")) {
      const [orgId] = params.map(String);
      return state.orgMembers.filter((m) => m.org_id === orgId && m.role === "admin").map((m) => ({ owner_user_id: m.owner_user_id }));
    }
    if (has("select 1 from vy_org_member where org_id = ($1)::uuid and owner_user_id = ($2)::uuid and role = 'admin' limit 1")) {
      const [orgId, ownerId] = params.map(String);
      const hit = state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === ownerId && m.role === "admin");
      return hit ? [{ "?column?": 1 }] : [];
    }
    if (has("insert into vy_org_weekly_note")) {
      const [noteId, orgId, weekStart, channel] = params;
      const dup = state.weeklyNotes.find((n) => n.org_id === orgId && n.week_start === weekStart && n.channel === channel);
      if (dup) return [];
      state.weeklyNotes.push({ note_id: noteId, org_id: orgId, week_start: weekStart, channel });
      return [{ note_id: noteId }];
    }
    if (has("select max(sent_at) as sent_at from vy_org_weekly_note where org_id = ($1)::uuid")) {
      const [orgId] = params.map(String);
      const rows = state.weeklyNotes.filter((n) => n.org_id === orgId);
      return [{ sent_at: rows.length ? "2026-09-07T00:05:00.000Z" : null }];
    }
    throw new Error(`org-weekly-note fake db: unmatched SQL: ${sql}`);
  };
}

// ═════════════════════════════════════════════════════════════════════════
// §1 — orgWeeklyNoteRoomLine / buildOrgWeeklyNote: the floor, applied at
// construction (workstream law 1).
// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: the per-Room floor ──");
{
  const room = { room_id: ROOM_1, display_name: "Anjali", published_at: "2026-08-01T00:00:00.000Z", paused_at: null };
  const atFloor = orgWeeklyNoteRoomLine(room, 5, 40); // exactly the floor - never floored
  ok("orgWeeklyNoteRoomLine: exactly 5 followers is NOT below the floor (097's own >= 5 boundary, restated)",
    atFloor.followers_joined_below_floor === false && atFloor.followers_joined_7d === 5);

  const belowFloor = orgWeeklyNoteRoomLine(room, 4, 40);
  ok("orgWeeklyNoteRoomLine: 4 followers IS below the floor", belowFloor.followers_joined_below_floor === true);
  ok("NEGATIVE CONTROL: below the floor, followers_joined_7d is null - the raw number never travels, not even inside this object",
    belowFloor.followers_joined_7d === null);
  ok("orgWeeklyNoteRoomLine: messages are never floored (a message count alone names nobody)",
    belowFloor.messages_last_7d === 40);
}
{
  const state = freshState();
  const db = orgDb(state);
  state.followers.push({ room_id: ROOM_1, joined_at: "2026-09-05T00:00:00.000Z" });
  for (let i = 0; i < 6; i++) state.followers.push({ room_id: ROOM_1, joined_at: "2026-09-04T00:00:00.000Z" });
  // ROOM_2 gets zero followers this week - stays below the floor.
  state.followerDays.push({ room_id: ROOM_1, day: "2026-09-05", turns: 12 });
  state.followerDays.push({ room_id: ROOM_2, day: "2026-09-05", turns: 3 });

  const note = await buildOrgWeeklyNote(db, { org_id: ORG_A, name: "North Coaching" }, NOW);
  ok("buildOrgWeeklyNote: both attached Rooms are named", note.rooms.length === 2 && note.rooms_total === 2);
  ok("buildOrgWeeklyNote: rooms_published counts both (both published)", note.rooms_published === 2);
  const r1 = note.rooms.find((r) => r.room_id === ROOM_1);
  const r2 = note.rooms.find((r) => r.room_id === ROOM_2);
  ok("buildOrgWeeklyNote: Room 1 (7 joins) clears the floor, real number carried", r1.followers_joined_below_floor === false && r1.followers_joined_7d === 7);
  ok("buildOrgWeeklyNote: Room 2 (0 joins) is below the floor, null carried, never 0", r2.followers_joined_below_floor === true && r2.followers_joined_7d === null);
}

// ═════════════════════════════════════════════════════════════════════════
// §2 — orgWeeklyNotePushPayload: pure, parameter-list-bounded, and a static
// scan proving its own source names none of this repo's follower-facing
// content columns (workstream law 3's own negative control).
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: orgWeeklyNotePushPayload ──");
{
  const note = {
    org_id: ORG_A, org_name: "North Coaching", week_start: WEEK_START,
    rooms_total: 2, rooms_published: 2,
    rooms: [
      { room_id: ROOM_1, display_name: "Anjali", published: true, followers_joined_7d: 7, followers_joined_below_floor: false, messages_last_7d: 12 },
      { room_id: ROOM_2, display_name: "Rahul", published: true, followers_joined_7d: null, followers_joined_below_floor: true, messages_last_7d: 3 },
    ],
  };
  const p = orgWeeklyNotePushPayload(note);
  ok("orgWeeklyNotePushPayload: shape matches room-sw.js's own {t, title, body, url} contract",
    p.t === "org_week" && typeof p.title === "string" && typeof p.body === "string" && typeof p.url === "string");
  ok("orgWeeklyNotePushPayload: the Suite's own name appears in the title", p.title.includes("North Coaching"));
  ok("orgWeeklyNotePushPayload: the real published/total counts appear", p.body.includes("2 of 2 Room"));
  ok("orgWeeklyNotePushPayload: a Room that cleared the floor names its real number", p.body.includes("7 follower"));
  ok("orgWeeklyNotePushPayload: a Room BELOW the floor is named \"fewer than five\", never a number",
    p.body.includes("fewer than five followers") && !p.body.includes("Rahul: 0"));

  ok("ORG_WEEKLY_NOTE_FOLLOWER_CONTENT_NAMES_EXPORT is not vacuously empty",
    ORG_WEEKLY_NOTE_FOLLOWER_CONTENT_NAMES_EXPORT.length >= 5);
  const src = fs.readFileSync(join(REPO, "api/_org-weekly-note.js"), "utf8");
  const fnMatch = src.match(/export function orgWeeklyNotePushPayload\([\s\S]*?\n}\n/);
  ok("orgWeeklyNotePushPayload is found in api/_org-weekly-note.js (not moved/renamed)", Boolean(fnMatch));
  const fnBody = fnMatch ? fnMatch[0] : "";
  const hits = ORG_WEEKLY_NOTE_FOLLOWER_CONTENT_NAMES_EXPORT.filter((n) => fnBody.includes(n));
  ok("NEGATIVE CONTROL: orgWeeklyNotePushPayload's own source names none of this repo's follower-facing content columns",
    hits.length === 0, hits.join(","));
}

// ═════════════════════════════════════════════════════════════════════════
// §3 — sendOrgWeeklyNotes: the ledger's own per-channel idempotency, config
// gating, and 404 revocation.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: sendOrgWeeklyNotes ──");

// (a) unset config on both channels: nothing runs, honestly.
{
  const state = freshState();
  const db = orgDb(state);
  const summary = await sendOrgWeeklyNotes(db, { now: NOW, env: {} });
  ok("sendOrgWeeklyNotes: unset push config and unconfigured email seam send nothing, checks nothing",
    summary.checked === 0 && summary.sent_ledger_push === 0 && summary.sent_ledger_email === 0);
}

// (b) push configured, real send, then a same-week resend refused.
{
  const state = freshState();
  const db = orgDb(state);
  state.followers.push({ room_id: ROOM_1, joined_at: "2026-09-05T00:00:00.000Z" });
  for (let i = 0; i < 6; i++) state.followers.push({ room_id: ROOM_1, joined_at: "2026-09-04T00:00:00.000Z" });
  const SUB = { id: "sub-1", endpoint: "https://push.example.test/admin-1", p256dh: "x", auth: "y" };
  const sent = [];
  const summary1 = await sendOrgWeeklyNotes(db, {
    now: NOW, env: ENV,
    sendPush: async (sub, payload) => { sent.push({ sub, payload }); return { ok: true, status: 201 }; },
    creatorPushSubscriptionsFor: async (ownerId) => (ownerId === ADMIN ? [SUB] : []),
    revokeCreatorPushSubscription: async () => {},
  });
  ok("sendOrgWeeklyNotes: the real sweep sent exactly one push ledger row and one push (the fixture is sound)",
    summary1.sent_ledger_push === 1 && summary1.pushed === 1 && sent.length === 1);
  ok("sendOrgWeeklyNotes: the email channel was never claimed (unconfigured)", summary1.sent_ledger_email === 0);

  const summary2 = await sendOrgWeeklyNotes(db, {
    now: NOW + 3_600_000, env: ENV,
    sendPush: async (sub, payload) => { sent.push({ sub, payload }); return { ok: true, status: 201 }; },
    creatorPushSubscriptionsFor: async () => [SUB],
    revokeCreatorPushSubscription: async () => {},
  });
  ok("NEGATIVE CONTROL: a second sweep tick the SAME week sends ZERO further pushes, refused by the ledger's own unique (org_id, week_start, channel) WHERE",
    summary2.sent_ledger_push === 0 && summary2.pushed === 0 && sent.length === 1);

  const last = await lastOrgWeeklyNote(db, ORG_A);
  ok("lastOrgWeeklyNote: reports a real timestamp once a send has landed", typeof last.last_sent_at === "string");
}

// (c) the email seam claims its OWN channel row independently of push, and
// makes no network call - proven both dynamically (the injected recorder
// fires) and statically (the real file imports no transport).
{
  const state = freshState();
  const db = orgDb(state);
  const emailed = [];
  const summary = await sendOrgWeeklyNotes(db, {
    now: NOW, env: {}, // push stays unconfigured
    emailSeamConfigured: () => true,
    recordEmailSend: async (note) => { emailed.push(note); return { would_send: true }; },
  });
  ok("sendOrgWeeklyNotes: the email channel claims its OWN ledger row even though push is unconfigured",
    summary.sent_ledger_push === 0 && summary.sent_ledger_email === 1 && summary.email_would_send === 1);
  ok("sendOrgWeeklyNotes: the email seam received the real built note", emailed.length === 1 && emailed[0].org_id === ORG_A);

  const src = fs.readFileSync(join(REPO, "api/_email-seam.js"), "utf8");
  const imports = [...src.matchAll(/^import .* from ["']([^"']+)["'];?$/gm)].map((m) => m[1]);
  ok("STATIC CONTROL: api/_email-seam.js imports NOTHING at all - no fetch wrapper, no transport library, no db module",
    imports.length === 0, imports.join(","));
  const emailSeamCode = stripComments(src);
  ok("STATIC CONTROL: api/_email-seam.js's own CODE (comments stripped) contains no network primitive call",
    !/\bfetch\s*\(/.test(emailSeamCode) && !/\.sendMail\s*\(|createTransport\s*\(|nodemailer|sendgrid/i.test(emailSeamCode));
  ok("emailSeamConfigured: unconditionally false today (no address, no provider, no new env var)",
    emailSeamConfigured({ SOME_FUTURE_KEY: "x" }) === false);
  const direct = await recordWouldSendOrgWeeklyNoteEmail({ org_id: ORG_A, week_start: WEEK_START, rooms_published: 1, rooms_total: 2 });
  ok("recordWouldSendOrgWeeklyNoteEmail: the direct call reports would_send without sending", direct.would_send === true && direct.sent === false);
}

// (d) a 404 from the push service revokes THAT one admin subscription and
// never touches another.
{
  const state = freshState();
  state.orgMembers.push({ org_id: ORG_A, owner_user_id: ADMIN_B, role: "admin" });
  const db = orgDb(state);
  const revoked = [];
  const summary = await sendOrgWeeklyNotes(db, {
    now: NOW, env: ENV,
    sendPush: async (sub) => (sub.id === "dead" ? { ok: false, status: 404 } : { ok: true, status: 201 }),
    creatorPushSubscriptionsFor: async (ownerId) => (ownerId === ADMIN
      ? [{ id: "dead", endpoint: "https://push.example.test/dead", p256dh: "x", auth: "y" }]
      : [{ id: "alive", endpoint: "https://push.example.test/alive", p256dh: "x", auth: "y" }]),
    revokeCreatorPushSubscription: async (_db, id) => revoked.push(id),
  });
  ok("sendOrgWeeklyNotes: a 404 revokes ONLY the dead admin subscription", revoked.length === 1 && revoked[0] === "dead");
  ok("sendOrgWeeklyNotes: the other admin's alive subscription still received its push", summary.pushed === 1);
}

// (e) a Suite with zero Rooms attached still gets checked and notes "0 of 0".
{
  const state = freshState();
  state.rooms = [];
  const db = orgDb(state);
  const note = await buildOrgWeeklyNote(db, { org_id: ORG_A, name: "North Coaching" }, NOW);
  const payload = orgWeeklyNotePushPayload(note);
  ok("buildOrgWeeklyNote: a Suite with no Rooms attached yet is a real, honest zero, not skipped",
    note.rooms_total === 0 && note.rooms_published === 0 && payload.body.includes("0 of 0"));
}

// ═════════════════════════════════════════════════════════════════════════
// §4 — sendTestOrgWeeklyNote: admin-only, writes no ledger row.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: sendTestOrgWeeklyNote ──");
{
  const state = freshState();
  const db = orgDb(state);
  const SUB = { id: "sub-admin", endpoint: "https://push.example.test/admin-test", p256dh: "x", auth: "y" };
  const sent = [];
  const result = await sendTestOrgWeeklyNote(db, ADMIN, ORG_A, {
    now: NOW, env: ENV,
    sendPush: async (sub, payload) => { sent.push({ sub, payload }); return { ok: true, status: 201 }; },
    creatorPushSubscriptionsFor: async (ownerId) => (ownerId === ADMIN ? [SUB] : []),
    revokeCreatorPushSubscription: async () => {},
  });
  ok("sendTestOrgWeeklyNote: the real admin's own test send succeeds (the fixture is sound)", result.pushed === 1 && sent.length === 1);
  ok("sendTestOrgWeeklyNote: the title is marked TEST", JSON.parse(sent[0].payload).title.startsWith("TEST -"));
  ok("NEGATIVE CONTROL: a test send writes NO ledger row - the real weekly send is still available afterward",
    state.weeklyNotes.length === 0);

  // A real send AFTER the test still claims cleanly (proves the negative
  // control above is not vacuous: if the test HAD written a row, this would
  // now be refused).
  const real = await sendOrgWeeklyNotes(db, {
    now: NOW, env: ENV,
    sendPush: async () => ({ ok: true, status: 201 }),
    creatorPushSubscriptionsFor: async () => [SUB],
    revokeCreatorPushSubscription: async () => {},
  });
  ok("sendOrgWeeklyNotes: the real weekly send still claims cleanly after a test send (the test consumed nothing)",
    real.sent_ledger_push === 1 && real.pushed === 1);
}
{
  // NEGATIVE CONTROL (class e): a stranger who is NOT on this Suite's
  // roster calls sendTestOrgWeeklyNote directly - refused org_not_found
  // (404, never a 403 that would confirm the Suite exists), before any push
  // is attempted.
  const state = freshState();
  const db = orgDb(state);
  let pushAttempted = false;
  const stolen = await threwAsync(() => sendTestOrgWeeklyNote(db, ADMIN_B, ORG_A, {
    now: NOW, env: ENV,
    sendPush: async () => { pushAttempted = true; return { ok: true, status: 201 }; },
    creatorPushSubscriptionsFor: async () => [{ id: "x", endpoint: "https://push.example.test/x", p256dh: "x", auth: "y" }],
  }));
  ok("NEGATIVE CONTROL (class e): a non-admin's own call to sendTestOrgWeeklyNote is refused org_not_found, never a 403",
    stolen instanceof OrgWeeklyNoteError && stolen.code === "org_not_found");
  ok("NEGATIVE CONTROL: no push was even attempted for the non-admin's call", pushAttempted === false);
  ok("NEGATIVE CONTROL: the refusal wrote no ledger row either", state.weeklyNotes.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// §5 — the fetch functions themselves (orgsForWeeklyNote/orgAdminUserIds),
// proven directly rather than only through the sweep above.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: orgsForWeeklyNote / orgAdminUserIds ──");
{
  const state = freshState();
  const db = orgDb(state);
  const orgs = await orgsForWeeklyNote(db, 200);
  ok("orgsForWeeklyNote: the real Suite is returned", orgs.length === 1 && orgs[0].org_id === ORG_A);
  const admins = await orgAdminUserIds(db, ORG_A);
  ok("orgAdminUserIds: the real admin is returned, and only admins (never a creator-role member)", admins.length === 1 && admins[0] === ADMIN);
}

// ═════════════════════════════════════════════════════════════════════════
// §6 — STATIC CONTROL (workstream law 3, evals/room-leak/run.mjs's own
// layer 16 restates this as a leak-battery layer): api/_org-weekly-note.js
// imports no follower-lane module.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: static import scan (no follower-lane module) ──");
{
  const src = fs.readFileSync(join(REPO, "api/_org-weekly-note.js"), "utf8");
  const imports = [...src.matchAll(/^import\s+.*?\s+from\s+["'](\.\/[^"']+)["'];?$/gm)].map((m) => m[1]);
  const FOLLOWER_LANE_MODULES = [
    "./memory.js", "./_room-surface.js", "./_handoff.js", "./_room-push.js",
    "./_room-whatsapp.js", "./_room-whatsapp-chat.js", "./_checkins.js", "./_room-telegram.js",
  ];
  const hit = imports.filter((i) => FOLLOWER_LANE_MODULES.includes(i));
  ok("api/_org-weekly-note.js imports exactly the four modules its own header names (no more, no fewer)",
    imports.length === 3 && imports.includes("./_creator-push.js") && imports.includes("./_push/webpush.js") && imports.includes("./_email-seam.js"),
    imports.join(","));
  ok("NEGATIVE CONTROL: none of api/_org-weekly-note.js's imports is a follower-lane module",
    hit.length === 0, hit.join(","));
  const noteCode = stripComments(src);
  ok("api/_org-weekly-note.js's own CODE (comments stripped) runs no query against a follower/thread table beyond a bare count()/sum()",
    !/select\s+\*/.test(noteCode) && !/from vy_room_thread\b/.test(noteCode) && !/from vy_room_handoff\b/.test(noteCode));
}

console.log(`\norg-weekly-note: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
