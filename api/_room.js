// The room data layer — WS-TGBOT, generalized to every surface by WS-SURFACE.
// Everything api/_surface.js needs to READ or WRITE about a room and about who
// a person is, and nothing about any particular wire (that is the adapter's
// job) and nothing about how a block is rendered (that is src/engine/room.ts's).
//
// ── what WS-SURFACE changed here, and what it did not ─────────────────────
//
// Identity and the synthetic device ids gained a `surface` parameter, and the
// Telegram spellings (personForTgUser, linkTgPerson, roomDeviceId, dmDeviceId,
// roomByChat, ensureRoom) are now thin wrappers over the general ones rather
// than separate implementations. The Telegram device SEED is frozen at `tg:`
// because every device id already written depends on it.
//
// What did NOT change: every retrieval below still goes through
// api/_disclosure.js, and there is still not one hand-written disclosure
// condition in this file. A surface may not widen what she is allowed to know.
//
// ── the one law this file exists to keep ──────────────────────────────────
//
// RETRIEVAL FOR ANY ROOM GOES THROUGH api/_disclosure.js. Not "mostly", not
// "plus a filter": every SELECT below that can return content a person might
// hear concatenates disclosurePredicate() into its WHERE clause, before any
// ranking. There is not one hand-written disclosure condition in this file,
// and there must never be one — a second, hand-rolled copy of the rule is how
// the rule ends up with two different meanings, and the measured basis for
// distrusting the alternative is in that module's header (a model asked to
// decline while holding the answer leaks at 9-90%).
//
// ── the `t` resolver ──────────────────────────────────────────────────────
//
// Every function takes an optional table-name resolver, defaulting to
// identity, exactly like api/memory.js's withdrawSharedRows. Production never
// passes it; evals/mp/tgbot.mjs passes the fixture-namespace prefixer, so the
// suite drives THIS code rather than a re-implementation of it. A cascade
// tested through a copy is a copy that was tested.
import { createHash, randomUUID } from "node:crypto";
import { q } from "./_db.js";
import {
  disclosurePredicate,
  bridgeEligibilityClause,
  NEGATIVE_AFFECT_TAGS,
  RECIPIENT_SET_SQL,
} from "./_disclosure.js";

const ident = (n) => n;

/** §6.3 free trial is per-room and time-boxed, so the paying decision arrives
 *  after the room has its own memory — the thing being bought is legible. */
export const TRIAL_DAYS = 14;
/** §6.3 step 4: she begins ingesting the room at >= 2 linked members. Below
 *  quorum she is present, polite, and remembers nothing. */
export const QUORUM = 2;

/** Per-surface seed prefix for the synthetic device ids below. Telegram's is
 *  `tg` and may NEVER change: every room device already written is uuid-v5 of
 *  `tg:<chat id>`, and a changed seed silently orphans them. */
const DEVICE_SEED = { telegram: "tg", discord: "dc", whatsapp: "wa", web: "web" };

/** Synthetic device id — uuid v5 (RFC 4122 §4.3) in the standard DNS
 *  namespace, over a surface-qualified key. Deterministic on purpose: a room
 *  that is removed and re-added maps to the SAME synthetic device rather than
 *  accumulating orphans, and two surfaces can never collide on one. */
export function surfaceDeviceId(surface, key) {
  const NS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8".replace(/-/g, "");
  const seed = `${DEVICE_SEED[surface] || surface}:${key}`;
  const h = createHash("sha1")
    .update(Buffer.concat([Buffer.from(NS, "hex"), Buffer.from(seed, "utf8")]))
    .digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** A room's synthetic device. It is in nobody's vy_person_device mapping by
 *  design (008b) — attribution of a room turn runs through speaker_person_id,
 *  never through this column. */
export const surfaceRoomDeviceId = (surface, chatKey) => surfaceDeviceId(surface, chatKey);

/** The Telegram spelling, kept because every device id already in the database
 *  came out of it and because it is the identity `tg:` seed above. */
export const roomDeviceId = (tgChatId) => surfaceDeviceId("telegram", tgChatId);

// ── identity ──────────────────────────────────────────────────────────────
//
// AGENT-INDEPENDENT BY DESIGN (SPEC-AGENT-LAYER §4). vy_surface_identity has
// no agent_id column and must never gain one: the same human on Telegram and
// on the web is the same relationship, and the agent enters at RETRIEVAL, not
// at IDENTIFICATION.
//
// Both vy_surface_identity and vy_tg_person exist during the transition (009
// backfilled the first from the second and did NOT drop it). The read below
// prefers the general table, falls back to the Telegram one, and BACKFILLS the
// general one on the way past — so the legacy table drains itself under
// ordinary traffic and the day it is dropped is a delete rather than a
// migration. A missing vy_surface_identity relation (an older namespace, a
// fixture schema built from 008 only) is not an error: `q` throws, the catch
// yields null, and the legacy path answers.

/** The surface -> person binding. Returns `{person_id, username, via}` or
 *  null. Never creates anything. */
export async function personForSurfaceUser(surface, surfaceUserId, t = ident) {
  const key = String(surfaceUserId);
  const rows = await q(
    `select person_id, handle from ${t("vy_surface_identity")}
      where surface = $1 and surface_user_id = $2`,
    [surface, key],
  ).catch(() => null);
  if (rows && rows[0])
    return { person_id: rows[0].person_id, username: rows[0].handle || "", via: "vy_surface_identity" };
  // Only Telegram has a legacy table to fall back to. Every other surface
  // resolves through vy_surface_identity or not at all.
  if (surface !== "telegram") return null;
  const legacy = await q(
    `select person_id, username from ${t("vy_tg_person")} where tg_user_id = $1`,
    [key],
  ).catch(() => []);
  if (!legacy[0]) return null;
  await q(
    `insert into ${t("vy_surface_identity")} (surface, surface_user_id, person_id, handle)
     values ('telegram',$1,$2,$3) on conflict do nothing`,
    [key, legacy[0].person_id, legacy[0].username || ""],
  ).catch(() => {});
  return { person_id: legacy[0].person_id, username: legacy[0].username || "", via: "vy_tg_person" };
}

/** The single Telegram -> person binding (008c). A person in three rooms is
 *  one vy_person row, three vy_group_member rows and one DM channel. */
export const personForTgUser = (tgUserId, t = ident) =>
  personForSurfaceUser("telegram", tgUserId, t);

/**
 * The deep-link tap (§6.3 step 3). It is load-bearing rather than cosmetic: a
 * Telegram bot cannot initiate a conversation with a user who has never
 * started one, so this one tap simultaneously opens the 1:1 channel, binds the
 * identity, runs the adult gate and sets vy_group_member.linked_at.
 *
 * The adult gate is STRUCTURAL, not a policy check: `vy_person.age_tier`
 * defaults to 'unverified', and a person row is what makes persistence legal
 * at all (§6.4). Nothing here verifies age — it creates the row the rest of
 * the stack already gates on, and a 'minor' row is refused outright.
 */
export async function linkSurfacePerson(
  surface,
  surfaceUserId,
  { handle = "", personId = null } = {},
  t = ident,
) {
  const key = String(surfaceUserId);
  const existing = await personForSurfaceUser(surface, key, t);
  if (existing) return { personId: existing.person_id, created: false };
  let pid = personId;
  if (!pid) {
    const made = await q(
      `insert into ${t("vy_person")} (person_id) values ($1) returning person_id`,
      [randomUUID()],
    ).catch(() => []);
    pid = made[0]?.person_id || null;
  }
  if (!pid) return null;
  const tier = await q(`select age_tier from ${t("vy_person")} where person_id = $1`, [pid]).catch(
    () => [],
  );
  // adult-default: a known minor never gets a binding, so nothing they say in
  // any room can ever be written (§6.4 is enforced by the absence of this row)
  if (tier[0]?.age_tier === "minor") return null;
  const name = String(handle || "").slice(0, 64);
  // The legacy Telegram row is written FIRST and un-caught: it is still what
  // roster() and the shipped forget cascade read for Telegram, so a failure
  // there must surface rather than leave a half-bound person.
  if (surface === "telegram")
    await q(
      `insert into ${t("vy_tg_person")} (tg_user_id, person_id, username)
       values ($1,$2,$3) on conflict (tg_user_id) do nothing`,
      [key, pid, name],
    );
  await q(
    `insert into ${t("vy_surface_identity")} (surface, surface_user_id, person_id, handle)
     values ($1,$2,$3,$4) on conflict do nothing`,
    [surface, key, pid, name],
  ).catch(() => {});
  return { personId: pid, created: true };
}

export const linkTgPerson = (tgUserId, { username = "", personId = null } = {}, t = ident) =>
  linkSurfacePerson("telegram", tgUserId, { handle: username, personId }, t);

// ── room lifecycle ────────────────────────────────────────────────────────

export async function roomByChat(tgChatId, t = ident) {
  const r = await q(
    `select id, name, tg_chat_id, room_device_id, read_consent_at, quiet_level, member_cap, created_at
       from ${t("vy_group")} where tg_chat_id = $1`,
    [String(tgChatId)],
  ).catch(() => []);
  return r[0] || null;
}

export async function ensureRoom(
  tgChatId,
  { name = "", kind = "friend_group", surface = "telegram" } = {},
  t = ident,
) {
  const have = await roomByChat(tgChatId, t);
  if (have) return have;
  await q(
    `insert into ${t("vy_group")} (name, kind, room_device_id, tg_chat_id)
     values ($1,$2,$3,$4) on conflict do nothing`,
    [
      String(name || "").slice(0, 120),
      kind,
      surfaceDeviceId(surface, tgChatId),
      String(tgChatId),
    ],
  );
  return await roomByChat(tgChatId, t);
}

/**
 * THE ROOM BINDING IS STILL TELEGRAM-SHAPED, AND THAT IS A NAMED DEBT.
 *
 * `vy_group.tg_chat_id` is a `bigint` with a unique index. A Discord snowflake
 * and a WhatsApp group id are numeric and fit; anything non-numeric does not,
 * and two surfaces whose numeric ranges overlap would collide on a column
 * whose name says Telegram. The honest generalization is
 * `(surface, surface_chat_id)`, which is a migration, and migrations belong to
 * WS-AGENT-SCHEMA — so this returns null for a chat key the column cannot
 * hold, and the surface refuses the room lane FAIL-CLOSED with a named reason
 * rather than writing a row that means something else.
 *
 * Filed: migration 010 replaces tg_chat_id with (surface, surface_chat_id),
 * the same way vy_tg_person is being replaced by vy_surface_identity.
 */
export function chatKeyToChatId(chatKey) {
  const s = String(chatKey ?? "");
  return /^-?\d{1,19}$/.test(s) ? s : null;
}

export async function roomByChatKey(surface, chatKey, t = ident) {
  const id = chatKeyToChatId(chatKey);
  if (id === null) return null;
  return await roomByChat(id, t);
}

export async function ensureRoomForChat(surface, chatKey, { name = "", kind = "friend_group" } = {}, t = ident) {
  const id = chatKeyToChatId(chatKey);
  if (id === null) return null;
  return await ensureRoom(id, { name, kind, surface }, t);
}

/**
 * §6.2 — THE ADMIN BIT IS THE ROOM'S READ CONSENT. Privacy mode stays ON
 * globally and she is promoted per room, so full traffic requires a
 * deliberate, visible act by a room admin: a consent artifact Telegram gives
 * us for free, whose revocation (demotion) is instant, total and involves no
 * code path of ours. Ingestion is gated on read_consent_at being non-null.
 */
export async function setReadConsent(groupId, on, t = ident) {
  await q(
    `update ${t("vy_group")} set read_consent_at = ${on ? "now()" : "null"} where id = $1`,
    [groupId],
  );
}

export async function setQuiet(groupId, level, t = ident) {
  await q(`update ${t("vy_group")} set quiet_level = $2 where id = $1`, [groupId, level]);
}

/**
 * §7 — v1 caps a room at `vy_group.member_cap` (6). The cap is not a licence
 * limit: mp.roster's 900 chars at ~150/member IS the cap, and a member with no
 * row in the address strip is a member she would address in the wrong register
 * in front of everyone (M9). So the cap is enforced where a member is ADDED
 * rather than where the strip is RENDERED — a truncated strip would fail
 * silently and look like it worked, which is the failure shape this repo has
 * already paid for twice.
 *
 * Returns false when the room is full. Existing members and returning members
 * (left_at set) are never refused — only genuinely new ones.
 */
export async function roomHasSpaceFor(groupId, personId, t = ident) {
  const r = await q(
    `select g.member_cap,
            (select count(*) from ${t("vy_group")}_member m
              where m.group_id = g.id and m.left_at is null) as active,
            (select count(*) from ${t("vy_group")}_member m
              where m.group_id = g.id and m.person_id = $2) as mine
       from ${t("vy_group")} g where g.id = $1`,
    [groupId, personId],
  ).catch(() => []);
  if (!r[0]) return false;
  if (Number(r[0].mine) > 0) return true;
  return Number(r[0].active) < Number(r[0].member_cap);
}

export async function upsertMember(groupId, { personId, tgUserId = null }, t = ident) {
  await q(
    `insert into ${t("vy_group")}_member (group_id, person_id, tg_user_id, joined_at)
     values ($1,$2,$3, now())
     on conflict (group_id, person_id) do update set left_at = null, tg_user_id = coalesce(excluded.tg_user_id, ${t("vy_group")}_member.tg_user_id)`,
    [groupId, personId, tgUserId == null ? null : String(tgUserId)],
  );
}

/** Leaving never deletes the room for the others (§3.1). left_at is the whole
 *  mechanism: the recipient set reads `left_at is null`, so the very next
 *  retrieval stops disclosing to them — no cascade, nothing to chase. */
export async function markMemberLeft(groupId, personId, t = ident) {
  await q(
    `update ${t("vy_group")}_member set left_at = now() where group_id = $1 and person_id = $2 and left_at is null`,
    [groupId, personId],
  );
}

export async function linkMember(groupId, personId, t = ident) {
  await q(
    `update ${t("vy_group")}_member set linked_at = coalesce(linked_at, now())
      where group_id = $1 and person_id = $2`,
    [groupId, personId],
  );
}

/** THE ONLY PLACE MEMBERSHIP IS READ, and it is read from api/_disclosure.js's
 *  own constant — the resolver is applied by substitution rather than by
 *  restating the SQL here, so there is still exactly one copy of it in the
 *  repo. Membership governs the LIVE CHANNEL; the ACL is read from
 *  vy_episode_participant, which is why a member who joins today does not
 *  become a participant of last month's episodes (M10). */
export async function recipientSet(groupId, t = ident) {
  const sql = RECIPIENT_SET_SQL.replace(/vy_group_member/g, t("vy_group_member"));
  const r = await q(sql, [groupId]).catch(() => []);
  return r[0]?.recipients || [];
}

/** §6.6: entitlement gates ROOM ingestion and ROOM replies, never anyone's
 *  1:1 relationship. If the room lapses she goes quiet in the room; nobody
 *  loses their own companion. A downgrade that reads as hostage-taking is
 *  NEVER MANIPULATE applied to the business model. */
export async function roomEntitled(room, t = ident) {
  const paid = await q(
    `select 1 from ${t("vy_group")}_entitlement where group_id = $1 and period_end > now() limit 1`,
    [room.id],
  ).catch(() => []);
  if (paid.length) return { entitled: true, reason: "paid" };
  const age = Date.now() - new Date(room.created_at).getTime();
  if (Number.isFinite(age) && age <= TRIAL_DAYS * 86_400_000)
    return { entitled: true, reason: "trial" };
  return { entitled: false, reason: "lapsed" };
}

// ── the roster (mp.roster's input) ────────────────────────────────────────

/**
 * §5.2's address strip, resolved. `honorific` is per-person state
 * (vy_rel_state, SPEC §6.2) and is the R6 bet: Hindi kin address encodes rank
 * grammatically, and there is no documented multi-render mechanism, so the
 * strip renders each member's own band side by side and lets the model hold
 * several registers in one turn. That is a bet and it is logged as one
 * (proposal §10 item 3).
 *
 * `rank` is derived from the band rather than invented: aap => elder, tu =>
 * younger-or-intimate, tum => peer, and NO relational row at all => 'unknown',
 * rendered as unknown instead of guessed. Guessing rank is precisely the
 * failure M9 describes (correcting or mis-addressing an elder in public).
 *
 * The display name is vy_tg_person.username — the only human-readable handle
 * migration 008 gives us. Deliberately not a new column: 008 is applied and
 * live, and a new column is a new migration, which is another workstream's
 * ticket, not a thing to smuggle in here.
 */
export async function roster(groupId, t = ident) {
  // The handle now comes from vy_surface_identity when that table exists, and
  // from vy_tg_person when it does not — the same transition fallback
  // personForSurfaceUser runs, for the same reason. `distinct on` is required
  // because a person may hold an identity on several surfaces and the address
  // strip renders one name per member, not one per wire.
  const wide = await q(
    `select m.person_id, m.quiet_level, m.linked_at,
            coalesce((select si.handle from ${t("vy_surface_identity")} si
                       where si.person_id = m.person_id
                       order by si.linked_at asc limit 1), '') as username,
            r.honorific
       from ${t("vy_group")}_member m
       left join ${t("vy_rel_state")} r on r.person_id = m.person_id
      where m.group_id = $1 and m.left_at is null
      order by m.joined_at asc, m.person_id asc
      limit 6`,
    [groupId],
  ).catch(() => null);
  const rows =
    wide ??
    (await q(
      `select m.person_id, m.quiet_level, m.linked_at,
              coalesce(p.username,'') as username,
              r.honorific
         from ${t("vy_group")}_member m
         left join ${t("vy_tg_person")} p on p.person_id = m.person_id
         left join ${t("vy_rel_state")} r on r.person_id = m.person_id
        where m.group_id = $1 and m.left_at is null
        order by m.joined_at asc, m.person_id asc
        limit 6`,
      [groupId],
    ).catch(() => []));
  return rows.map((r) => {
    const h = r.honorific === "aap" || r.honorific === "tu" || r.honorific === "tum" ? r.honorific : null;
    return {
      name: r.username || String(r.person_id).slice(0, 8),
      honorific: h || "tum",
      rank: h === "aap" ? "elder" : h === "tu" ? "younger" : h === "tum" ? "peer" : "unknown",
      quiet: r.quiet_level || "normal",
      linked: r.linked_at != null,
    };
  });
}

// ── retrieval (mp.bridge's and T5's input) ────────────────────────────────

const BIND = { recipients: "$1", isGroup: "$2", roomId: "$3", negTags: "$4" };

/**
 * BASE retrieval for a room turn — the §2.3 predicate and nothing else, so a
 * direct question still finds the row. Feeds T5 `recall.facts`, which is the
 * block recall has always lived in; the room does not get a second, parallel
 * recall path.
 */
export async function roomRecall(groupId, recipients, { limit = 8 } = {}, t = ident) {
  if (!recipients.length) return [];
  const pred = applyResolver(disclosurePredicate("fact", BIND), t);
  return await q(
    `select f.id, f.body, f.name, f.created_at
       from ${t("vy_fact")} f
      where f.t_invalid is null and f.retracted_at is null ${pred}
      order by f.need_p desc, f.created_at desc
      limit ${Number(limit) | 0}`,
    [recipients, true, groupId, NEGATIVE_AFFECT_TAGS],
    20_000,
  ).catch(() => []);
}

/**
 * The SAME predicate, one recipient, no room — a person's own 1:1 channel.
 *
 * This function is M2, the moment the proposal calls "the highest-value,
 * zero-risk direction and where most of v1's felt value lives": you DM her
 * alone, and she has not amnesia'd the room you were both in. Nothing crossed
 * a wall to make that work — the room's rows pass the structural branch for
 * you because YOU WERE THERE, and another person's DM rows do not, because
 * you were not. It is the identical clause text with `isGroup` false and the
 * room binding null, which is exactly why §2.1 says the group channel "needs
 * no separate code path": a room's recipient set is strictly more restrictive
 * than any 1:1 evaluation of the same predicate.
 */
export async function dmRecall(personId, { limit = 8 } = {}, t = ident) {
  const pred = applyResolver(disclosurePredicate("fact", BIND), t);
  return await q(
    `select f.id, f.body, f.name, f.created_at
       from ${t("vy_fact")} f
      where f.t_invalid is null and f.retracted_at is null ${pred}
      order by f.need_p desc, f.created_at desc
      limit ${Number(limit) | 0}`,
    [[personId], false, null, NEGATIVE_AFFECT_TAGS],
    20_000,
  ).catch(() => []);
}

/** The synthetic device for a Telegram 1:1 channel — uuid v5 over the user id,
 *  and UNLIKE the room device it IS registered in vy_person_device, because a
 *  DM turn is exclusively that person's and must fall inside their own
 *  device-keyed whole-wipe (the legacy forget scopes are device-keyed; see
 *  008a's header on why the room device deliberately is not). */
export const surfaceDmDeviceId = (surface, surfaceUserId) =>
  surfaceDeviceId(surface, `dm:${surfaceUserId}`);

export function dmDeviceId(tgUserId) {
  return surfaceDmDeviceId("telegram", tgUserId);
}

export async function bindSurfaceDmDevice(surface, surfaceUserId, personId, t = ident) {
  const dev = surfaceDmDeviceId(surface, surfaceUserId);
  await q(
    `insert into ${t("vy_person")}_device (device_id, person_id) values ($1,$2)
     on conflict (device_id) do nothing`,
    [dev, personId],
  ).catch(() => {});
  return dev;
}

export const bindDmDevice = (tgUserId, personId, t = ident) =>
  bindSurfaceDmDevice("telegram", tgUserId, personId, t);

/**
 * PROACTIVE retrieval — the same predicate PLUS §3.2 ruling A
 * (bridgeEligibilityClause): a departed member's co-participants keep recall
 * of what they were both there for (she answers if asked), but she will not
 * RAISE it herself when the person is no longer in the room to be asked.
 * That distinction is exactly why the clause is a separate export and is
 * concatenated only here.
 *
 * Returns rows in src/engine/room.ts's BridgeRow shape. It selects; the
 * renderer renders; neither decides.
 */
export async function roomBridge(groupId, recipients, t = ident) {
  if (!recipients.length) return [];
  const out = [];
  const factPred =
    applyResolver(disclosurePredicate("fact", BIND), t) +
    applyResolver(bridgeEligibilityClause("fact", BIND), t);
  const facts = await q(
    `select f.id, f.body, f.kind, f.created_at
       from ${t("vy_fact")} f
      where f.t_invalid is null and f.retracted_at is null and f.group_id = $3 ${factPred}
      order by f.need_p desc, f.created_at desc limit 6`,
    [recipients, true, groupId, NEGATIVE_AFFECT_TAGS],
    20_000,
  ).catch(() => []);
  for (const f of facts) {
    out.push({
      kind: f.kind === "world" ? "open" : "shared",
      gist: f.body,
      age: ageShort(f.created_at),
    });
  }
  const phrasePred =
    applyResolver(disclosurePredicate("phrase", BIND), t) +
    applyResolver(bridgeEligibilityClause("phrase", BIND), t);
  const phrases = await q(
    `select f.id, f.phrase, f.coined_at
       from ${t("vy_phrase")} f
      where f.group_id = $3 ${phrasePred}
      order by f.uses desc, f.coined_at desc limit 4`,
    [recipients, true, groupId, NEGATIVE_AFFECT_TAGS],
    20_000,
  ).catch(() => []);
  for (const p of phrases) out.push({ kind: "word", gist: p.phrase, age: ageShort(p.coined_at) });
  return out;
}

/** The room's phrase ledger, for the react tier's relevance signal ONLY. Same
 *  predicate — a room word she may not know about is not a word she may react
 *  to. */
export async function roomWords(groupId, recipients, t = ident) {
  if (!recipients.length) return [];
  const pred = applyResolver(disclosurePredicate("phrase", BIND), t);
  const rows = await q(
    `select f.phrase from ${t("vy_phrase")} f where f.group_id = $3 ${pred} limit 40`,
    [recipients, true, groupId, NEGATIVE_AFFECT_TAGS],
    20_000,
  ).catch(() => []);
  return rows.map((r) => r.phrase);
}

/** The predicate text names production relations (vy_episode,
 *  vy_disclosure_grant, vy_group_member). One mechanical rewrite, applied to
 *  the SHIPPING clause text rather than to a copy of it — the same property
 *  evals/mp/harness.mjs's `ns` has, and the reason disclosurePredicate takes a
 *  bind map at all. */
function applyResolver(sql, t) {
  if (t === ident) return sql;
  return sql.replace(/\b(vy_episode_participant|vy_episode|vy_disclosure_grant|vy_group_member)\b/g, (m) =>
    t(m),
  );
}

function ageShort(at) {
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const d = Math.floor(ms / 86_400_000);
  if (d < 1) return "today";
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.floor(d / 7)}w`;
  return `${Math.floor(d / 30)}mo`;
}

// ── writes ────────────────────────────────────────────────────────────────

/**
 * The group analogue of api/episodes.js's openOrExtendEpisode, and it is a
 * separate function rather than a parameter on that one for a structural
 * reason: that function is keyed `where person_id = $1`, and a room episode
 * carries person_id NULL (008a) precisely so a member's whole-wipe cannot
 * hard-delete it out from under their co-participants. The boundary RULE is
 * the shared one (GAP_MS, imported), the KEY is not.
 */
export async function openOrExtendGroupEpisode(
  groupId,
  { gapMs = 45 * 60_000, roomDevice = null } = {},
  t = ident,
) {
  const open = await q(
    `select id, ended_at, started_at from ${t("vy_episode")}
      where group_id = $1 and provisional = true and superseded_by is null
      order by started_at desc limit 1`,
    [groupId],
  ).catch(() => []);
  const now = Date.now();
  if (open[0]) {
    const last = new Date(open[0].ended_at ?? open[0].started_at).getTime();
    if (Number.isFinite(last) && now - last <= gapMs) return { id: open[0].id, extended: true };
  }
  const ins = await q(
    `insert into ${t("vy_episode")}
       (person_id, group_id, device_id, channel, participation, disclosure_scope,
        started_at, ended_at, boundary_reason, summary, provisional)
     values (null, $1, $2, 'chat', 'group', 'participants', now(), now(), $3, '', true)
     returning id`,
    // device_id on a room episode is PROVENANCE only (the legacy forget
    // scopes read it) and it is the room's synthetic device, which is in
    // nobody's vy_person_device mapping — so it can never make a room episode
    // fall into a person's device-keyed wipe. Attribution runs through
    // vy_episode_participant and meera_log.speaker_person_id, never here.
    [groupId, roomDevice, open[0] ? "channel" : "gap"],
  ).catch(() => []);
  return ins[0] ? { id: ins[0].id, extended: false } : null;
}

/** THE ACL ITSELF. A participant row is what makes the structural branch true
 *  for this person, and dropping it later is what makes withdrawal a delete
 *  rather than an array rewrite (§3.1.2). */
export async function addEpisodeParticipant(episodeId, personId, role = "participant", t = ident) {
  await q(
    `insert into ${t("vy_episode")}_participant (episode_id, person_id, role)
     values ($1,$2,$3) on conflict do nothing`,
    [episodeId, personId, role],
  );
}

/**
 * A room turn in meera_log, keyed on BOTH the synthetic room device and the
 * speaker's person id. 008a's speaker_person_id is what makes "delete my
 * turns, leave theirs and hers" implementable at row level — it is
 * UNBACKFILLABLE, so a row written without it is permanently unattributable.
 * This function refuses to write a turn it cannot attribute rather than
 * writing an orphan (§6.4: no person row, no persistence).
 */
export async function logRoomTurn(
  { groupId, roomDevice, speakerPersonId, role, content, kind = "text" },
  t = ident,
) {
  if (role === "me" && !speakerPersonId) return null;
  const r = await q(
    `insert into ${t("meera_log")} (device_id, role, channel, kind, content, at, speaker_person_id, group_id)
     values ($1,$2,'chat',$3,$4, now(), $5, $6) returning id`,
    [
      roomDevice,
      role === "her" ? "her" : "me",
      String(kind).slice(0, 20),
      String(content || "").slice(0, 4000),
      speakerPersonId || null,
      groupId,
    ],
  ).catch(() => []);
  return r[0]?.id ?? null;
}

/** Silence is an EVENT, not an absence (M5). Every evaluation writes a row,
 *  including the lurks — that is what makes the Stage-1 bet measurable rather
 *  than believed (§0.3). */
export async function recordTurnAction(
  { groupId, episodeId = null, logId = null, action, addressed = false, reason = "" },
  t = ident,
) {
  const r = await q(
    `insert into ${t("vy_group")}_turn (group_id, episode_id, log_id, action, addressed, reason)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [groupId, episodeId, logId, action, addressed === true, String(reason).slice(0, 160)],
  ).catch(() => []);
  return r[0]?.id ?? null;
}

/**
 * §5.4 — GROUP EPISODES ARE RECALL-ELIGIBLE BUT STATE-INERT IN V1.
 *
 * Room turns write vy_episode, vy_fact (non-sensitive) and vy_phrase. They
 * write NO vy_rel_event, NO vy_rel_state movement, NO vy_pattern, NO
 * vy_taste_candidate, NO vy_currency, NO vy_india_profile field. Trust,
 * honorific and code-switch ratio are DYADIC dimensions calibrated on 1:1
 * evidence, and whether a person's group register even predicts their 1:1
 * register is an open question with no literature (MULTIPARTY.md open
 * question 12). Letting an unmeasured channel move the state layer the
 * shipped 1:1 product depends on risks damaging the thing that already works.
 *
 * VERIFIED, NOT ASSUMED (WS-TGBOT, 2026-08-18). The proposal says "`where
 * group_id is null` on the rel-event writer is the entire implementation".
 * That clause does NOT exist in the tree: neither api/consolidate.js's
 * deriveRelEventsForPerson nor src/engine/relstate.ts's writeRelEvent /
 * writePattern carries it. State-inertness holds today for a DIFFERENT and
 * weaker reason — every state writer is person-keyed (`where person_id = $1`)
 * and a room episode carries person_id NULL (008a), so consolidate's
 * `select distinct person_id from vy_episode` yields NULL for room rows and
 * every downstream lookup on it matches nothing. It is inert by three-valued
 * logic rather than by an explicit clause.
 *
 * That is load-bearing and fragile: it would break the day anyone gives room
 * episodes a reporting person_id. api/consolidate.js belongs to
 * WS-CONSOLIDATE and is not this workstream's to edit, so the guard is filed
 * as an interface ticket and asserted from the outside instead — this
 * function is what evals/mp/tgbot.mjs calls to PROVE inertness against real
 * rows after a real room turn.
 */
export async function stateWriteCount(personIds, t = ident) {
  const out = {};
  const tables = [
    ["vy_rel_event", "person_id"],
    ["vy_pattern", "person_id"],
    ["vy_taste_candidate", "person_id"],
    ["vy_currency", "person_id"],
  ];
  for (const [table, col] of tables) {
    const r = await q(
      `select count(*)::int n from ${t(table)} where ${col} = any($1::uuid[])`,
      [personIds],
    ).catch(() => [{ n: -1 }]);
    out[table] = Number(r[0]?.n ?? -1);
  }
  return out;
}
