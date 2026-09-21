// The caps that make "enable this for all accounts" survivable (WS-AD).
//
// The owner's ask is "enable this for all accounts so my friends can also
// test it". That sentence has a cost attached: every video is Azure CPU for
// extraction, Sarvam batch ASR for the transcript, and — once the fidelity
// lane is wired — GPU seconds for a preview. An open lane with no ceiling is
// how a grant-credit subscription is spent overnight by six enthusiastic
// friends, and the failure mode is not a big bill, it is a DEAD PLATFORM at
// 3am with no named reason on any screen.
//
// So there are three ceilings and each one refuses BY NAME with its numbers
// attached (`silent-truncation`'s rule applied to admission rather than to
// text): the owner is told which cap they hit, what it is, and when it
// resets. A refusal a person cannot act on is an outage with better manners.
//
// ── why the global cap exists as well as the per-account one ─────────────
// A per-account cap bounds one enthusiastic friend. It does not bound twenty
// accounts, and "all accounts" is exactly the condition under which the
// per-account cap stops being the binding constraint. The global cap is the
// one that protects the grant; the per-account cap is the one that keeps any
// single tester from eating the global one alone.
//
// These are DEFAULTS, overridable by env, and deliberately low. Raising a cap
// is one variable; recovering a spent Azure grant is not a thing that can be
// done at all.

export const VIDEO_ENROLL_LIMITS = Object.freeze({
  // Two a day is enough to try, iterate once, and sleep on it. It is not
  // enough to batch-process a back catalogue, which is the OTHER lane
  // (`listCatalogue`) and has its own sweep discipline.
  perOwnerPerDay: 2,
  // 20 minutes covers the owner's own 15-minute lecture with headroom. A
  // three-hour livestream is a different product decision, not a bigger
  // number: it changes extraction time, ASR cost and window count by an order
  // of magnitude each.
  maxDurationMs: 20 * 60 * 1000,
  // ~20 min of 16 kHz mono PCM16 is ~38 MB. 64 MB leaves room for a longer
  // container without admitting a file that could not be the declared length.
  maxAudioBytes: 64 * 1024 * 1024,
  // The grant protector. Ten videos a day across every account on the
  // platform is a testing lane, which is what this is.
  globalPerDay: 10,
});

export function videoEnrollLimits(env = process.env) {
  const positive = (value, fallback, ceiling) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= ceiling ? parsed : fallback;
  };
  return Object.freeze({
    perOwnerPerDay: positive(env.VIDEO_ENROLL_PER_OWNER_PER_DAY, VIDEO_ENROLL_LIMITS.perOwnerPerDay, 50),
    maxDurationMs: positive(env.VIDEO_ENROLL_MAX_DURATION_MS, VIDEO_ENROLL_LIMITS.maxDurationMs, 3 * 60 * 60 * 1000),
    maxAudioBytes: positive(env.VIDEO_ENROLL_MAX_AUDIO_BYTES, VIDEO_ENROLL_LIMITS.maxAudioBytes, 512 * 1024 * 1024),
    globalPerDay: positive(env.VIDEO_ENROLL_GLOBAL_PER_DAY, VIDEO_ENROLL_LIMITS.globalPerDay, 500),
  });
}

export class VideoEnrollQuotaError extends Error {
  constructor(code, status, details) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Both counters in ONE statement.
 *
 * Two statements would be two snapshots, and between them a second request
 * from the same owner can pass a cap that the first request has already
 * consumed. One statement counting both scopes over the same snapshot is the
 * cheapest correct thing; the row itself is inserted afterwards under a
 * unique key on (owner, video, day) so a double-click is a no-op rather than
 * a second charge.
 *
 * Counts only rows that COST something: a run refused at admission, or one
 * that died at the bot check before a byte moved, must not consume the
 * owner's two-a-day. `states` is therefore explicit rather than "everything
 * that is not failed" — an enumeration this lane can widen deliberately
 * (`coverage-lists-that-enumerate-a-subset`).
 */
export async function videoEnrollUsage(db, ownerUserId) {
  const rows = await db(
    `select
       count(*) filter (where owner_user_id = ($1)::uuid) as owner_today,
       count(*) as global_today
       from vy_video_enrollment
      where created_at >= date_trunc('day', now())
        and state in ('extracting','scoring','transcribing','ready')`,
    [ownerUserId],
  );
  const row = rows?.[0] || {};
  return Object.freeze({
    ownerToday: Number(row.owner_today || 0),
    globalToday: Number(row.global_today || 0),
  });
}

/** The predicate. Pure, so the eval drives it directly with numbers rather
 *  than having to stand up a database to find out what a cap does. */
export function assertVideoEnrollAdmission({ usage, limits, durationMs = null, byteSize = null }) {
  if (usage.globalToday >= limits.globalPerDay) {
    throw new VideoEnrollQuotaError("video_enroll_global_daily_cap", 429, {
      cap: limits.globalPerDay, used: usage.globalToday, scope: "platform", resets: "daily_utc",
    });
  }
  if (usage.ownerToday >= limits.perOwnerPerDay) {
    throw new VideoEnrollQuotaError("video_enroll_owner_daily_cap", 429, {
      cap: limits.perOwnerPerDay, used: usage.ownerToday, scope: "account", resets: "daily_utc",
    });
  }
  if (durationMs !== null && Number(durationMs) > limits.maxDurationMs) {
    throw new VideoEnrollQuotaError("video_enroll_duration_over_cap", 413, {
      cap_ms: limits.maxDurationMs, video_ms: Math.round(Number(durationMs)),
    });
  }
  if (byteSize !== null && Number(byteSize) > limits.maxAudioBytes) {
    throw new VideoEnrollQuotaError("video_enroll_bytes_over_cap", 413, {
      cap_bytes: limits.maxAudioBytes, audio_bytes: Math.round(Number(byteSize)),
    });
  }
  return true;
}
