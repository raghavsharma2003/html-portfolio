// Admission against KNOWN current consent/link boundaries, not historical
// membership, event authentication, deduplication or an atomic send guarantee.
// The authenticated transport adapter supplies copied primitive event metadata;
// callers must separately establish current group authority and recipients.
const unavailable = () => Object.assign(new Error("group_source_event_unavailable"), {
  code: "group_source_event_unavailable", status: 503,
});
const need = (condition) => { if (!condition) throw unavailable(); };

/** Unix seconds without coercion or a fabricated local-clock fallback. The
 * four-digit-year bound keeps the canonical result a normal SQL/ISO timestamp. */
export function normalizeGroupSourceSentAtSeconds(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    && value <= 253402300799 ? value : null;
}

function own(value, key) {
  need(value !== null && typeof value === "object");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  need(descriptor && "value" in descriptor);
  return descriptor.value;
}

function list(value) {
  need(Array.isArray(value));
  const length = own(value, "length");
  need(Number.isSafeInteger(length) && length >= 1 && length <= 160);
  return Array.from({ length }, (_, index) => own(value, String(index)));
}

function identifier(value) {
  need(typeof value === "string" && value.length > 0 && value.trim() === value);
  return value;
}

// PostgreSQL text and JSON timestamps may retain six fractional digits, with
// Z, a short offset (+00), a compact offset (+0530), or a colon offset (+05:30).
// Compare exact microseconds: rounding a boundary down must not admit equality.
function timestampMicros(value) {
  need(typeof value === "string");
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  need(match);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  need(year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= 31
    && hour <= 23 && minute <= 59 && second <= 59);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  need(calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day);
  const zone = match[8];
  const zoneHour = zone === "Z" ? 0 : Number(zone.slice(1, 3));
  const zoneMinute = zone === "Z" || zone.length === 3 ? 0 : Number(zone.slice(-2));
  need(zoneHour <= 23 && zoneMinute <= 59);
  const offset = (zoneHour * 60 + zoneMinute) * (zone[0] === "-" ? -1 : 1);
  return BigInt(calendar.getTime() - offset * 60_000) * 1000n
    + BigInt((match[7] || "").padEnd(6, "0"));
}

/** Return an immutable primitive canonical source timestamp. A message must be
 * strictly after current group consent AND every recipient's current link,
 * including recipients other than its sender. Equality is deliberately denied
 * because Telegram dates have only second precision. No event-age or retention
 * policy is selected here, and future timestamps are not authenticated here. */
export function assertGroupSourceEvent(ev, authority, recipients) {
  try {
    need(own(ev, "kind") === "message" && own(ev, "isGroup") === true
      && own(ev, "sourceEventKind") === "ordinary_message");
    const seconds = normalizeGroupSourceSentAtSeconds(own(ev, "sourceSentAtSeconds"));
    need(seconds !== null);
    const eventMicros = BigInt(seconds) * 1_000_000n;
    const surface = identifier(own(ev, "surface"));
    const chatKey = identifier(own(ev, "chatKey"));
    const speakerUser = identifier(own(ev, "surfaceUserId"));
    need(surface === own(authority, "surface") && chatKey === own(authority, "surface_chat_id"));
    need(eventMicros > timestampMicros(own(authority, "read_consent_at")));
    const audience = list(recipients).map(identifier);
    const declared = list(own(authority, "recipients")).map(identifier);
    const members = list(own(authority, "linked_members"));
    const audienceSet = new Set(audience);
    need(audienceSet.size === audience.length && declared.length === audience.length
      && new Set(declared).size === declared.length && declared.every((id) => audienceSet.has(id))
      && members.length === audience.length);
    const people = new Set(), transportUsers = new Set();
    for (const member of members) {
      const person = identifier(own(member, "person_id"));
      const transportUser = identifier(own(member, "surface_user_id"));
      need(audienceSet.has(person) && !people.has(person) && !transportUsers.has(transportUser)
        && own(member, "surface") === surface && own(member, "left_at") === null);
      need(eventMicros > timestampMicros(own(member, "linked_at")));
      people.add(person);
      transportUsers.add(transportUser);
    }
    need(transportUsers.has(speakerUser));
    return new Date(seconds * 1000).toISOString();
  } catch {
    // Do not leak payloads, member details, thrown proxy bodies or raw causes.
    throw unavailable();
  }
}
