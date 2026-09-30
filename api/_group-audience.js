// Current-audience verification for the legacy multiparty surface, not private
// follower Rooms. Inputs below are server-owned room/member SQL projections.
// They must never be populated from a webhook's claimed recipients or handles.
//
// Telegram has no transactional audience/send API. Matching counts around
// individually verified identities is a bounded witness, NOT an atomic snapshot
// or a guarantee that nobody joins immediately afterwards. The caller must
// revalidate the witness before provider egress, after generation and around
// delivery. An observed mismatch stops the turn; no remembered witness is a
// reusable authorization. Unsupported transports have no fallback here.
//
// Primary contracts checked 2026-09-29:
// https://core.telegram.org/bots/api#getme
// https://core.telegram.org/bots/api#getchatmembercount
// https://core.telegram.org/bots/api#getchatmember
// https://core.telegram.org/bots/api#getchat / #chatfullinfo
// getChatMember is only guaranteed for other users when this bot is an admin.
// Public groups may be read without membership (https://telegram.org/faq), so
// counts alone cannot establish the audience. Only private, unlinked chats
// without visible history are admitted. Changing platform history policy after
// delivery or a participant forwarding/copying a message is not revocable here.
import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HUMAN_CAP = 6;
const unavailable = () => Object.assign(new Error("group_audience_unverified"), {
  code: "group_audience_unverified", status: 403,
});
const need = (condition) => { if (!condition) throw unavailable(); };
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function decimal(value, negative = false) {
  need(typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value)));
  const text = String(value);
  need((negative ? /^-[1-9][0-9]{0,15}$/ : /^[1-9][0-9]{0,15}$/).test(text));
  need(Number.isSafeInteger(Number(text)));
  return text;
}

function uuid(value) {
  need(typeof value === "string" && UUID.test(value));
  return value;
}

function timestamp(value) {
  need(typeof value === "string" || value instanceof Date);
  const ms = new Date(value).getTime();
  need(Number.isFinite(ms));
  return new Date(ms).toISOString();
}

function roomScope({ room, roomId, agentId }, boundAgentId) {
  need(room && typeof room === "object");
  const id = decimal(roomId);
  const agent = uuid(agentId);
  need(decimal(room.id) === id && (!boundAgentId || agent === boundAgentId));
  need(room.agent_id === agent && room.surface === "telegram");
  const chatKey = decimal(room.surface_chat_id, true);
  need(room.read_consent_at != null);
  const readConsentAt = timestamp(room.read_consent_at);
  const cap = Number(room.member_cap);
  need(Number.isSafeInteger(cap) && cap >= 1 && cap <= HUMAN_CAP);
  return { roomId: id, agentId: agent, chatKey, readConsentAt, cap };
}

function memberBindings(rows, scope) {
  need(Array.isArray(rows) && rows.length >= 1 && rows.length <= scope.cap);
  const people = new Set();
  const users = new Set();
  const bindings = [];
  for (let i = 0; i < rows.length; i++) {
    need(Object.hasOwn(rows, i));
    const row = rows[i];
    need(row && typeof row === "object" && row.surface === "telegram");
    need(row.left_at === null && row.linked_at != null);
    const personId = uuid(row.person_id);
    const userId = decimal(row.surface_user_id);
    need(!people.has(personId) && !users.has(userId));
    people.add(personId);
    users.add(userId);
    // Copy primitives before the first asynchronous request. Mutation of a
    // caller's in-memory SQL rows must not rewrite a witness mid-flight.
    bindings.push({ personId, userId, linkedAt: timestamp(row.linked_at) });
  }
  return bindings.sort((a, b) => a.personId.localeCompare(b.personId));
}

async function resultOf(client, method, ...args) {
  try {
    need(typeof client?.[method] === "function");
    const response = await client[method](...args);
    need(response?.ok === true && Object.hasOwn(response, "result"));
    return response.result;
  } catch {
    // Never retain provider error descriptions or transport URLs with tokens.
    throw unavailable();
  }
}

async function selfIdentity(client, expectedBotId) {
  const me = await resultOf(client, "getMe");
  need(me?.is_bot === true);
  const botId = decimal(me.id);
  need(!expectedBotId || botId === expectedBotId);
  return botId;
}

async function memberStatus(client, chatKey, userId, bot) {
  const member = await resultOf(client, "getChatMember", chatKey, userId);
  need(member?.user && decimal(member.user.id) === userId && member.user.is_bot === bot);
  if (bot) {
    need(member.status === "administrator" || member.status === "creator");
  } else {
    need(["creator", "administrator", "member"].includes(member.status)
      || (member.status === "restricted" && member.is_member === true));
  }
  return member.status;
}

async function memberCount(client, chatKey) {
  const count = await resultOf(client, "getChatMemberCount", chatKey);
  need(Number.isSafeInteger(count) && count >= 2 && count <= HUMAN_CAP + 1);
  return count;
}

async function privateChat(client, chatKey) {
  const chat = await resultOf(client, "getChat", chatKey);
  need(chat && decimal(chat.id, true) === chatKey && ["group", "supergroup"].includes(chat.type));
  need(chat.username === undefined || chat.username === "");
  need(chat.active_usernames === undefined || (Array.isArray(chat.active_usernames) && chat.active_usernames.length === 0));
  // These fields either expose nonmember readers or have no reviewed complete-
  // audience contract. Their absence is checked only between bot-admin reads.
  for (const key of ["linked_chat_id", "location", "community", "parent_chat"])
    need(chat[key] === undefined);
  for (const key of ["has_visible_history", "is_direct_messages"])
    need(chat[key] === undefined || chat[key] === false);
  return { type: chat.type, visibility: "private-unlinked-hidden-history/v1" };
}

/** Bind once to the same immutable client/token that sends this bot's replies.
 * No API call occurs until a group hook is actually invoked; ordinary DMs are
 * unaffected. A missing client method fails closed when invoked. */
export function createTelegramGroupAuthority(client, { agentId, botId = null } = {}) {
  const boundAgentId = uuid(agentId);
  const expectedBotId = botId == null ? null : decimal(botId);
  return {
    async groupAudienceWitness(ev, args) {
      const scope = roomScope(args, boundAgentId);
      need(ev?.surface === "telegram" && ev.isGroup === true && String(ev.chatKey) === scope.chatKey);
      const bindings = memberBindings(args.linkedMembers, scope);
      const ownId = await selfIdentity(client, expectedBotId);
      need(bindings.every((binding) => binding.userId !== ownId));
      const before = await memberCount(client, scope.chatKey);
      need(before === bindings.length + 1);
      const ownBefore = await memberStatus(client, scope.chatKey, ownId, true);
      const chatBefore = await privateChat(client, scope.chatKey);
      const states = await Promise.all(bindings.map((binding) => memberStatus(client, scope.chatKey, binding.userId, false)));
      const chatAfter = await privateChat(client, scope.chatKey);
      const ownAfter = await memberStatus(client, scope.chatKey, ownId, true);
      const after = await memberCount(client, scope.chatKey);
      need(after === before && ownAfter === ownBefore && digest(chatBefore) === digest(chatAfter));
      return Object.freeze({
        complete: true,
        recipients: Object.freeze(bindings.map((binding) => binding.personId)),
        revision: digest({ version: "telegram-audience/v1", ...scope, botId: ownId,
          botStatus: ownAfter, chat: chatAfter, count: after, bindings: bindings.map((binding, i) => ({ ...binding, status: states[i] })) }),
      });
    },

    async verifyGroupMembership(args) {
      const scope = roomScope(args, boundAgentId);
      const userId = decimal(args.surfaceUserId);
      const ownId = await selfIdentity(client, expectedBotId);
      need(userId !== ownId);
      const ownBefore = await memberStatus(client, scope.chatKey, ownId, true);
      const chatBefore = await privateChat(client, scope.chatKey);
      const status = await memberStatus(client, scope.chatKey, userId, false);
      const chatAfter = await privateChat(client, scope.chatKey);
      const ownAfter = await memberStatus(client, scope.chatKey, ownId, true);
      need(ownBefore === ownAfter && digest(chatBefore) === digest(chatAfter));
      return Object.freeze({ verified: true, surfaceUserId: userId,
        revision: digest({ version: "telegram-member/v1", ...scope, botId: ownId, botStatus: ownAfter, chat: chatAfter, userId, status }) });
    },
  };
}
