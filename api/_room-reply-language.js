// Server opt-in only. Locale remains a chrome/disclosure choice, not a model
// language instruction. No user text, source text or credentials are read here.
export function roomReplyLanguagePolicy(env = process.env) {
  const value = env.ROOM_REPLY_LANGUAGE_POLICY;
  if (value === undefined) return undefined;
  if (value !== "follow_current_user") {
    throw Object.assign(new Error("room_reply_language_policy_invalid"), {
      code: "room_reply_language_policy_invalid", status: 503,
    });
  }
  return value;
}
