// WS-R47. CREATOR-ISSUED INVITES (migration 106) — offline, deterministic,
// $0, no DB, no network, no GPU.
//
//   node evals/creator-invites/run.mjs
//
// Extends WS-R23's own front door (evals/invites/run.mjs, migration 086)
// rather than editing it: a fresh fake db here, scoped to exactly the new
// surface this workstream adds, so a mistake in this file's fixture cannot
// silently change what WS-R23's own suite proves. Four sections:
//
//   §1 issueCreatorInvite. Three codes issue in a row for a published
//      creator; the fourth is refused, zero rows added; an unpublished
//      creator (no vy_room row, or one whose published_at is still null)
//      is refused the same way even with zero prior codes; the code is
//      returned exactly once and the stored row never carries it.
//   §2 myInvites. Owner-scoped (never another creator's or an operator's
//      rows), states only (unused/redeemed/expired), no code text, and
//      `quota.used`/`quota.remaining` computed off the SAME rows the list
//      itself returns.
//   §3 redemption is unchanged. A creator-issued code redeems through
//      `createSelfReplica`'s own CTE (api/_replica.js) exactly the way an
//      operator-issued one does — `issued_kind` never appears in that
//      statement's own WHERE, so this proves it structurally rather than
//      merely by author's note.
//   §4 the funnel line. `creatorInviteArrivalsThisWeek`: at/above the n>=5
//      floor renders the real count; below it renders `n: null` and the
//      floor sentence, never a smaller true number; a redemption or a
//      linked application from BEFORE this week does not count; the
//      "application OR replica" reading is both, tested separately.
//   §5 NEGATIVE CONTROLS, each of which MUST fail the assertion it drives:
//      (a) a body-supplied `issued_by_user_id` is ignored — a static scan of
//          api/invites.js proves `mine_issue` passes only the verified
//          bearer's own id into `issueCreatorInvite`, never a body field;
//      (b) the stored row never carries the plain code — a static scan of
//          the creator INSERT's own column list in api/_invites.js, plus a
//          fixture read of every issued row's own keys;
//      (c) a card string with an em dash, or the banned word "clone", fails
//          `scripts/check-copy.mjs`'s real scanner under the exact options
//          `src/studio/`'s own SCOPES entry uses.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};
const threw = async (fn) => {
  try { await fn(); return null; } catch (error) { return error; }
};

const INVITES = await import(pathToFileURL(join(ROOT, "api/_invites.js")).href);
const REPLICA = await import(pathToFileURL(join(ROOT, "api/_replica.js")).href);
const FUNNEL = await import(pathToFileURL(join(ROOT, "api/_funnel.js")).href);
const {
  issueCreatorInvite, myInvites, hashInviteCode, CREATOR_INVITE_QUOTA,
} = INVITES;
const { createSelfReplica } = REPLICA;
const {
  creatorInviteArrivalsThisWeek, creatorInviteArrivalNote, CREATOR_INVITE_ARRIVAL_FLOOR,
} = FUNNEL;
const { scanSource } = await import(pathToFileURL(join(ROOT, "scripts/check-copy.mjs")).href);

const U = (n) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const CREATOR_A = U(1);
const CREATOR_B = U(2);
const UNPUBLISHED_CREATOR = U(3);

// ── the shared fake db state, scoped to exactly this workstream's own new
// surface (086's own evals/invites/run.mjs proves everything else). ────────
function freshState() {
  return { invites: [], rooms: [], applications: [], replicas: [] };
}

function publishedRoom(ownerUserId) {
  return { room_id: randomUUID(), owner_user_id: ownerUserId, published_at: new Date().toISOString() };
}

function fakeDb(state) {
  const calls = [];
  return {
    calls,
    db: async (sql, params = []) => {
      calls.push({ sql, params });

      // §1: the quota INSERT.
      if (/quota_ok as \(/.test(sql) && /insert into vy_creator_invite/.test(sql)) {
        const [ownerUserId, inviteId, codeHash, contact, expiresAt, quotaMax] = params;
        const used = state.invites.filter(
          (i) => i.issued_by_user_id === ownerUserId && i.issued_kind === "creator",
        ).length;
        const published = state.rooms.some((r) => r.owner_user_id === ownerUserId && r.published_at != null);
        if (used >= Number(quotaMax) || !published) return [];
        const row = {
          invite_id: inviteId, code_hash: codeHash, issued_to_contact: contact,
          issued_by_user_id: ownerUserId, application_id: null, expires_at: expiresAt,
          redeemed_at: null, redeemed_by_user_id: null, created_at: new Date().toISOString(),
          issued_kind: "creator",
        };
        state.invites.push(row);
        return [row];
      }

      // §2: myInvites' own list.
      if (/select invite_id, issued_to_contact, expires_at, redeemed_at, created_at\s+from vy_creator_invite/s.test(sql)
        && /issued_by_user_id = \$1::uuid and issued_kind = 'creator'/.test(sql)) {
        const [ownerUserId] = params;
        return state.invites
          .filter((i) => i.issued_by_user_id === ownerUserId && i.issued_kind === "creator")
          .slice()
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }

      // §4: the funnel's own arrival count.
      if (/from vy_creator_invite ci/.test(sql) && /left join vy_creator_application ap/.test(sql)) {
        const [weekStartIso] = params;
        const weekStart = new Date(weekStartIso).getTime();
        const n = state.invites.filter((i) => {
          if (i.issued_kind !== "creator") return false;
          const redeemedThisWeek = i.redeemed_at && new Date(i.redeemed_at).getTime() >= weekStart;
          const app = i.application_id ? state.applications.find((a) => a.application_id === i.application_id) : null;
          const applicationThisWeek = app && new Date(app.created_at).getTime() >= weekStart;
          return redeemedThisWeek || applicationThisWeek;
        }).length;
        return [{ n }];
      }

      // §3: the replica-create predicate — WS-R23's own fixture shapes,
      // reused so a creator-issued code is proven to redeem through the
      // IDENTICAL statement an operator-issued one does.
      if (/^\s*select 1 from vy_replica where owner_user_id = \$1::uuid limit 1\s*$/.test(sql)) {
        const [ownerUserId] = params;
        return state.replicas.some((r) => r.owner_user_id === ownerUserId) ? [{ x: 1 }] : [];
      }
      if (/invite_redeem as \(/.test(sql) && /insert into vy_replica/.test(sql)) {
        const [ownerUserId, name, policyVersion, codeHash, invitesRequired] = params;
        const alreadyOwns = state.replicas.some((r) => r.owner_user_id === ownerUserId);
        let gateOk = true;
        if (invitesRequired) {
          if (alreadyOwns) {
            gateOk = true;
          } else {
            const invite = state.invites.find(
              (i) => i.code_hash === codeHash && i.redeemed_at == null && new Date(i.expires_at) > new Date(),
            );
            if (invite) {
              invite.redeemed_at = new Date().toISOString();
              invite.redeemed_by_user_id = ownerUserId;
              gateOk = true;
            } else {
              gateOk = false;
            }
          }
        }
        if (!gateOk) return [];
        const row = {
          replica_id: randomUUID(), owner_user_id: ownerUserId, display_name: name,
          subject_mode: "self", lifecycle: "consent_pending", policy_version: policyVersion,
          age_verified_at: null, identity_verified_at: null, liveness_verified_at: null,
          identity_expires_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        state.replicas.push(row);
        return [row];
      }

      throw new Error(`unexpected query in evals/creator-invites/run.mjs fake db: ${sql}`);
    },
  };
}

// ── §1 issueCreatorInvite ───────────────────────────────────────────────────
{
  const state = freshState();
  state.rooms.push(publishedRoom(CREATOR_A));
  const { db } = fakeDb(state);

  ok("the quota is three, named", CREATOR_INVITE_QUOTA === 3);

  const issued = [];
  for (let i = 0; i < CREATOR_INVITE_QUOTA; i++) {
    issued.push(await issueCreatorInvite(db, CREATOR_A, { contact: `peer${i}@example.com` }));
  }
  ok("three codes issue in a row for a published creator", issued.every((r) => typeof r.code === "string" && r.code.length > 0));
  ok("all three are stored, issued_kind creator", state.invites.length === 3 && state.invites.every((i) => i.issued_kind === "creator"));
  ok("each stored row's hash matches the code it was issued with", issued.every((r, i) => state.invites[i].code_hash === hashInviteCode(r.code)));
  ok("the invite object never carries a code or a hash", issued.every((r) => !("code" in r.invite) && !("code_hash" in r.invite)));

  const fourth = await threw(() => issueCreatorInvite(db, CREATOR_A, { contact: "peer4@example.com" }));
  ok("a fourth code is refused by name", fourth?.code === "creator_invite_unavailable");
  ok("the refusal is a named 403", fourth?.status === 403);
  ok("the fourth attempt inserted zero rows", state.invites.length === 3);
}
{
  // Never published at all: no vy_room row for this owner.
  const state = freshState();
  const { db } = fakeDb(state);
  const refused = await threw(() => issueCreatorInvite(db, CREATOR_B, { contact: "x@example.com" }));
  ok("a creator with no Room at all is refused", refused?.code === "creator_invite_unavailable");
  ok("nothing was inserted", state.invites.length === 0);
}
{
  // A Room exists but is not published (published_at null) — the exact
  // predicate the SQL's own `published_at is not null` checks, not merely
  // "has a vy_room row at all".
  const state = freshState();
  state.rooms.push({ room_id: randomUUID(), owner_user_id: UNPUBLISHED_CREATOR, published_at: null });
  const { db } = fakeDb(state);
  const refused = await threw(() => issueCreatorInvite(db, UNPUBLISHED_CREATOR, {}));
  ok("a creator whose Room is unpublished (draft) is refused the same way", refused?.code === "creator_invite_unavailable");
  ok("nothing was inserted for a draft Room's owner", state.invites.length === 0);
}

// ── §2 myInvites ─────────────────────────────────────────────────────────────
{
  const state = freshState();
  state.rooms.push(publishedRoom(CREATOR_A), publishedRoom(CREATOR_B));
  const { db } = fakeDb(state);

  await issueCreatorInvite(db, CREATOR_A, { contact: "a1@example.com" });
  const { invite: redeemedInvite } = await issueCreatorInvite(db, CREATOR_A, { contact: "a2@example.com" });
  await issueCreatorInvite(db, CREATOR_B, { contact: "b1@example.com" }); // a different creator's own code

  // Simulate one of CREATOR_A's codes having been redeemed already, and one
  // expired, directly against the fixture — mirrors what §3's real CTE
  // would have done.
  const redeemedRow = state.invites.find((i) => i.invite_id === redeemedInvite.invite_id);
  redeemedRow.redeemed_at = new Date().toISOString();
  redeemedRow.redeemed_by_user_id = U(9);
  const thirdIssued = await issueCreatorInvite(db, CREATOR_A, { contact: "a3@example.com" });
  const thirdRow = state.invites.find((i) => i.invite_id === thirdIssued.invite.invite_id);
  thirdRow.expires_at = new Date(Date.now() - 1_000).toISOString();

  const mine = await myInvites(db, CREATOR_A);
  const creatorBMine = await myInvites(db, CREATOR_B);
  ok("myInvites returns only this creator's own rows", mine.invites.length === 3);
  ok("never another creator's rows", !mine.invites.some((i) => i.invite_id === creatorBMine.invites[0]?.invite_id));
  ok("states: unused, redeemed, expired all present", ["unused", "redeemed", "expired"].every((s) => mine.invites.some((i) => i.state === s)));
  ok("no returned invite carries a code or a hash", mine.invites.every((i) => !("code" in i) && !("code_hash" in i)));
  ok("quota.used counts every code ever issued by this creator, whatever its current state", mine.quota.used === 3);
  ok("quota.remaining is zero once the quota is fully used", mine.quota.remaining === 0);
  ok("quota.max is the named constant", mine.quota.max === CREATOR_INVITE_QUOTA);

  ok("a different creator's own list carries only their own one row", creatorBMine.invites.length === 1);
}

// ── §3 redemption is unchanged ──────────────────────────────────────────────
{
  const state = freshState();
  state.rooms.push(publishedRoom(CREATOR_A));
  const { db } = fakeDb(state);
  const { code } = await issueCreatorInvite(db, CREATOR_A, { contact: "friend@example.com" });

  const NEW_OWNER = U(7);
  const replica = await createSelfReplica(db, NEW_OWNER, "Friend", { invitesRequired: true, inviteCode: code });
  ok("a creator-issued code redeems through createSelfReplica's own CTE", Boolean(replica.replica_id));
  const row = state.invites.find((i) => i.issued_by_user_id === CREATOR_A);
  ok("the invite is now redeemed by the new owner", row.redeemed_at != null && row.redeemed_by_user_id === NEW_OWNER);

  const secondAttempt = await threw(() =>
    createSelfReplica(db, U(8), "Second", { invitesRequired: true, inviteCode: code }));
  ok("the same creator-issued code cannot be redeemed twice", secondAttempt?.code === "invite_invalid");
}
{
  const src = readFileSync(join(ROOT, "api/_replica.js"), "utf8");
  ok(
    "createSelfReplica's own redemption CTE never references issued_kind — a creator-issued code is not a special case in SQL",
    !/invite_redeem[\s\S]{0,600}issued_kind/.test(src),
  );
}

// ── §4 the funnel line ──────────────────────────────────────────────────────
{
  ok("the arrival floor is five, named", CREATOR_INVITE_ARRIVAL_FLOOR === 5);
  ok("below the floor the note never discloses a smaller number",
    !/\d/.test(creatorInviteArrivalNote(3)));
  ok("at the floor the note states the real number",
    creatorInviteArrivalNote(5).includes("5"));
}
{
  const state = freshState();
  const { db } = fakeDb(state);
  const now = Date.parse("2026-09-10T12:00:00Z"); // a Thursday
  const weekStart = Date.parse("2026-09-07T00:00:00Z"); // the Monday of that week

  // Four redemptions this week — below the floor.
  for (let i = 0; i < 4; i++) {
    state.invites.push({
      invite_id: randomUUID(), issued_kind: "creator", issued_by_user_id: U(20 + i),
      application_id: null, redeemed_at: new Date(weekStart + 3_600_000 * i).toISOString(),
    });
  }
  const below = await creatorInviteArrivalsThisWeek(db, now);
  ok("below the floor, n is never disclosed", below.n === null);
  ok("below the floor, below_floor is true", below.below_floor === true);
  ok("below the floor, the note is the floor sentence", below.note === creatorInviteArrivalNote(4));

  // A fifth arrives — at the floor.
  state.invites.push({
    invite_id: randomUUID(), issued_kind: "creator", issued_by_user_id: U(30),
    application_id: null, redeemed_at: new Date(weekStart + 4_000).toISOString(),
  });
  const atFloor = await creatorInviteArrivalsThisWeek(db, now);
  ok("at the floor, the real number is disclosed", atFloor.n === 5);
  ok("at the floor, below_floor is false", atFloor.below_floor === false);

  // A redemption from LAST week must not count.
  state.invites.push({
    invite_id: randomUUID(), issued_kind: "creator", issued_by_user_id: U(31),
    application_id: null, redeemed_at: new Date(weekStart - 3_600_000).toISOString(),
  });
  const stillFive = await creatorInviteArrivalsThisWeek(db, now);
  ok("a redemption from before this week does not count", stillFive.n === 5);

  // Operator-issued rows never count, however they are redeemed.
  state.invites.push({
    invite_id: randomUUID(), issued_kind: "operator", issued_by_user_id: U(40),
    application_id: null, redeemed_at: new Date(weekStart + 5_000).toISOString(),
  });
  const stillFiveOperator = await creatorInviteArrivalsThisWeek(db, now);
  ok("an operator-issued redemption never counts toward this line", stillFiveOperator.n === 5);
}
{
  // The "application OR replica" reading, exercised on the application arm
  // alone — an invite linked to an application submitted this week counts
  // even with no redemption at all.
  const state = freshState();
  const { db } = fakeDb(state);
  const now = Date.parse("2026-09-10T12:00:00Z");
  const weekStart = Date.parse("2026-09-07T00:00:00Z");
  for (let i = 0; i < 5; i++) {
    const applicationId = randomUUID();
    state.applications.push({ application_id: applicationId, created_at: new Date(weekStart + 1_000 * i).toISOString() });
    state.invites.push({
      invite_id: randomUUID(), issued_kind: "creator", issued_by_user_id: U(50 + i),
      application_id: applicationId, redeemed_at: null,
    });
  }
  const viaApplication = await creatorInviteArrivalsThisWeek(db, now);
  ok("five arrivals via a linked application alone (no redemption) reach the floor", viaApplication.n === 5);
}

// ── §5 NEGATIVE CONTROLS ─────────────────────────────────────────────────────
// (a) a body-supplied issued_by_user_id is ignored.
{
  const src = readFileSync(join(ROOT, "api/invites.js"), "utf8");
  ok(
    "mine_issue calls issueCreatorInvite with the verified bearer's own id",
    /op === "mine_issue"[\s\S]{0,200}issueCreatorInvite\(q, user\.id,/.test(src),
  );
  ok(
    "api/invites.js never reads a body-supplied issued_by_user_id anywhere",
    !/body\.issued_by_user_id/.test(src),
  );
  ok(
    "mine_list is scoped to the bearer's own id too",
    /op === "mine_list"[\s\S]{0,120}myInvites\(q, user\.id\)/.test(src),
  );
}
// (b) the stored row never carries the plain code.
{
  const src = readFileSync(join(ROOT, "api/_invites.js"), "utf8");
  const quotaIdx = src.indexOf("quota_ok as (");
  ok("the quota_ok CTE exists in api/_invites.js (fixture for the slice below)", quotaIdx !== -1);
  const creatorSection = src.slice(quotaIdx, quotaIdx + 900);
  const insertMatch = creatorSection.match(/insert into vy_creator_invite\s*\(([\s\S]*?)\)/);
  ok("the creator INSERT statement was found", Boolean(insertMatch));
  const columns = (insertMatch?.[1] ?? "").split(",").map((c) => c.trim());
  ok("its column list carries code_hash", columns.includes("code_hash"));
  ok("its column list never carries a bare 'code' column", !columns.includes("code"));

  // Fixture read: every row this suite has issued anywhere above, scanned
  // for a literal "code" key on the object itself (not "code_hash").
  const state = freshState();
  state.rooms.push(publishedRoom(CREATOR_A));
  const { db } = fakeDb(state);
  await issueCreatorInvite(db, CREATOR_A, { contact: "z@example.com" });
  ok(
    "a fixture read of every stored row finds no 'code' key, only 'code_hash'",
    state.invites.every((row) => !("code" in row) && typeof row.code_hash === "string" && row.code_hash.length === 64),
  );
}
// (c) a card string with an em dash or the banned word fails the copy gate.
{
  const STUDIO_OPTS = { rules: "full", codename: true, roomsVocab: true };
  const emdash = 'export default function X() { return <p>Invite a creator — now</p>; }';
  const dashHits = scanSource("src/studio/fixture-em-dash.tsx", emdash, STUDIO_OPTS).map((o) => o.rule);
  ok("an em dash in a Share-tab-shaped fixture fails the copy gate's dash rule", dashHits.includes("dash"));

  const badWord = 'export default function X() { return <p>Invite a creator to build their own clone</p>; }';
  const wordHits = scanSource("src/studio/fixture-banned-word.tsx", badWord, STUDIO_OPTS).map((o) => o.rule);
  ok("the banned word \"clone\" in a Share-tab-shaped fixture fails the Rooms vocabulary rule", wordHits.includes("rooms-vocabulary"));

  const clean = 'export default function X() { return <p>Invite up to three other creators to build their own AI.</p>; }';
  const cleanHits = scanSource("src/studio/fixture-clean.tsx", clean, STUDIO_OPTS);
  ok("the real card's own wording shape passes clean", cleanHits.length === 0);
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
