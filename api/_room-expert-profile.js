// Pure server selection and request budgets. No I/O or user-controlled flags.
export function roomExpertTextProfile(env = process.env) {
  const value = env.ROOM_EXPERT_TEXT_PROFILE;
  if (value === undefined) return undefined;
  if (value !== "lean_v1") {
    throw Object.assign(new Error("room_expert_text_profile_invalid"), { code: "room_expert_text_profile_invalid", status: 503 });
  }
  if ((env.ROOM_REPLY_LANGUAGE_POLICY !== undefined && env.ROOM_REPLY_LANGUAGE_POLICY !== "follow_current_user")
      || (env.ROOM_REPLY_TEXT_PROFILE !== undefined && env.ROOM_REPLY_TEXT_PROFILE !== "expert_answer")) {
    throw Object.assign(new Error("room_expert_text_profile_conflict"), { code: "room_expert_text_profile_conflict", status: 503 });
  }
  return value;
}

// UTF-16 content units, including the latest user message. Reject, never slice.
// The transport retains at most 40 turns. Normal Room windows are 30 + current.
export const ROOM_EXPERT_CONVERSATION_LIMIT = 20_000;
export function assertExpertConversation(turns) {
  if (!Array.isArray(turns) || !turns.length || turns.length > 40) {
    throw Object.assign(new Error("room_expert_conversation_invalid"), { code: "room_expert_conversation_invalid", status: 400 });
  }
  let units = 0;
  for (const turn of turns) {
    if (!turn || !["user", "assistant"].includes(turn.role) || typeof turn.content !== "string"
        || turn.content.length > 4000 || /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(turn.content)) {
      throw Object.assign(new Error("room_expert_conversation_invalid"), { code: "room_expert_conversation_invalid", status: 400 });
    }
    units += turn.content.length;
  }
  if (units > ROOM_EXPERT_CONVERSATION_LIMIT) {
    throw Object.assign(new Error("room_expert_conversation_budget_exceeded"), { code: "room_expert_conversation_budget_exceeded", status: 413 });
  }
  return units;
}
