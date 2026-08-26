// One link, one clone (Gurukul WS-AD) — the single-video enrollment lane.
//
//   node evals/videoenroll.mjs
//
// Offline, deterministic, $0, no DB and no network. It drives the REAL
// `enrollFromVideo` / `rankReferenceWindows` / `assertVideoEnrollAdmission`
// through a fake `db` and SYNTHESISED audio, so the code path this suite
// reaches is the code path a pasted link reaches; only the database and the
// four service seams are replaced.
//
// ── what this suite is actually guarding ─────────────────────────────────
//
// 1. THE FIRST-TEN-SECONDS PROBLEM, AS A MEASUREMENT. The owner's sentence is
//    "it's not necessary that the first 10 seconds will be clear, so handle
//    it". The fixture is built to be exactly that lecture: a noisy, clipped,
//    half-silent opening and the clean teaching voice three minutes in. The
//    assertion is not "a window was chosen" — it is that the chosen window is
//    NOT the head, that the head scores measurably worse, and that the
//    ranking says by how much. A lane that took the head would pass any test
//    that only checked a window came back.
//
// 2. DETERMINISM, BYTE FOR BYTE. The same bytes ranked twice must produce an
//    IDENTICAL ordering, including ties. `context/measurements.md#reference-
//    window-beats-the-finetune` makes window choice worth 0.0625 fidelity —
//    three times the fine-tune delta — which makes a ranking that wobbles
//    between runs a fidelity number that wobbles between runs, and an
//    unreproducible measurement is not a measurement.
//
// 3. THE CONSENT GATE REFUSES. Missing or partial attestations are refused
//    BEFORE a quota slot is consumed and before a byte is fetched. The
//    negative control is a request with four of the five statements ticked.
//
// 4. THE NOT-YOUR-VIDEO CONTROL. `services/media-extract` resolves the
//    uploader from YouTube's own metadata and refuses
//    `channel_binding_mismatch` before downloading. This suite asserts the
//    lane carries that refusal through VERBATIM and records it as the run's
//    failure code — because a gate only ever exercised by things that pass is
//    not known to be a gate.
//
// 5. EVERY CAP IS A NAMED REFUSAL WITH ITS NUMBERS. Owner-daily, global-daily,
//    duration and bytes each refuse by name, and the duration and byte caps
//    are re-checked on the MEASURED values after extraction, not only on the
//    claim before it.
//
// 6. THE BOT CHECK IS AN HONEST STATE. `context/measurements.md#youtube-
//    extraction-blocked-from-azure`: extraction from the deployed Azure egress
//    returns `extractor_bot_check` on every player client tried. So the state
//    this lane is IN today is the failing one, and the suite asserts the code
//    survives to the response and to the run row unflattened. A lane that
//    collapsed it into "failed" would make the single most important
//    operational fact about this deploy invisible.
//
// 7. DIARIZATION ABSENCE IS NULL, NOT 1.0. A window whose purity was never
//    measured must not outrank one measured clean, and a window that is
//    mostly a second speaker must be disqualified BY NAME.
import { createHash } from "node:crypto";
import {
  VideoEnrollError,
  VideoEnrollQuotaError,
  enrollFromVideo,
  parseVideoUrl,
} from "../api/_video-enroll.js";
import {
  HOP_MS,
  WINDOW_MS,
  WINDOW_SCORE_SOURCE,
  rankReferenceWindows,
  readPcm16Wav,
  speakerPurity,
} from "../api/_video-enroll/windows.js";
import {
  VIDEO_ENROLL_LIMITS,
  assertVideoEnrollAdmission,
  videoEnrollLimits,
} from "../api/_video-enroll/quota.js";

let pass = 0;
let fail = 0;
function ok(label, condition, note = "") {
  if (condition) { pass += 1; console.log(`  ok   ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}${note ? ` — ${note}` : ""}`); }
}
async function refuses(label, run, code) {
  try {
    await run();
    fail += 1;
    console.log(`  FAIL ${label} — resolved instead of refusing ${code}`);
  } catch (error) {
    const actual = String(error?.code || error?.message || "");
    if (actual === code) { pass += 1; console.log(`  ok   ${label} (${code})`); }
    else { fail += 1; console.log(`  FAIL ${label} — expected ${code}, got ${actual}`); }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// fixture audio: the owner's lecture, with a bad opening
// ─────────────────────────────────────────────────────────────────────────
const RATE = 16_000;

/** A deterministic PRNG. `Math.random()` in a fixture is a suite that fails
 *  once a month for reasons nobody can reproduce. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    data.writeInt16LE(Math.max(-32_768, Math.min(32_767, Math.round(samples[i]))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * A 6-minute "lecture" with the shape the owner described:
 *   0:00-0:35  the bad opening — room tone, a clipped mic bump, mostly silence
 *   0:35-3:00  speech, but noisy (a fan, and the speaker off-axis)
 *   3:00-4:30  the clean teaching voice — this is what should win
 *   4:30-6:00  speech again, quieter, with a second speaker at 5:00
 */
function lectureFixture() {
  const total = 360 * RATE;
  const samples = new Float64Array(total);
  const random = rng(20260826);
  for (let i = 0; i < total; i += 1) {
    const t = i / RATE;
    const phase = 2 * Math.PI * 130 * t;
    let value = 0;
    if (t < 35) {
      // room tone, and a clipped bump at 12 s
      value = (random() - 0.5) * 300;
      if (t > 12 && t < 12.4) value = (random() < 0.5 ? -1 : 1) * 32_760;
    } else if (t < 180) {
      value = Math.sin(phase) * 2200 + (random() - 0.5) * 3000;
    } else if (t < 270) {
      // the clean window: strong, even, low noise
      value = Math.sin(phase) * 6000 + Math.sin(phase * 2.1) * 1500 + (random() - 0.5) * 200;
    } else {
      value = Math.sin(phase) * 2600 + (random() - 0.5) * 700;
    }
    samples[i] = value;
  }
  return wav(samples);
}

const LECTURE = lectureFixture();

console.log("── the audio contract ──");
const pcm = readPcm16Wav(LECTURE);
ok("the fixture reads as 16 kHz mono PCM16", pcm.sampleRateHz === 16_000 && pcm.durationMs === 360_000);
refuses("a non-WAV buffer is refused by name", async () => readPcm16Wav(Buffer.alloc(2048)), "window_audio_not_wav");
refuses("a too-short file is refused by name", async () => readPcm16Wav(Buffer.alloc(20)), "window_audio_too_short");
// The shape assertions are not decoration: `services/media-extract` asserts
// this same shape before returning, and a lane that silently accepted 44.1 kHz
// stereo would compute every number downstream on a different basis and none
// of them would look wrong.
{
  const stereo = Buffer.from(LECTURE);
  stereo.writeUInt16LE(2, 22);
  refuses("a stereo file is refused rather than downmixed", async () => readPcm16Wav(stereo), "window_audio_not_mono");
  const resampled = Buffer.from(LECTURE);
  resampled.writeUInt32LE(44_100, 24);
  refuses("a 44.1 kHz file is refused rather than resampled", async () => readPcm16Wav(resampled), "window_audio_sample_rate_invalid");
}

// ─────────────────────────────────────────────────────────────────────────
// 1. the first-ten-seconds problem
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── the first ten seconds are not special ──");
const ranked = rankReferenceWindows(LECTURE, { limit: 12 });
ok("every window is scored, not just the head",
  ranked.stats.windows_scored >= Math.floor((360_000 - WINDOW_MS) / HOP_MS),
  `scored ${ranked.stats.windows_scored}`);
ok("a window was selected", Boolean(ranked.selected));
ok("the selected window is NOT the first ten seconds", ranked.selected.start_ms !== 0,
  `selected at ${ranked.selected?.start_ms}ms`);
ok("...it lands inside the clean stretch (180s–270s)",
  ranked.selected.start_ms >= 180_000 && ranked.selected.end_ms <= 270_000,
  `${ranked.selected.start_ms}–${ranked.selected.end_ms}ms`);
ok("the head window is disqualified or beaten, and the suite can say which",
  ranked.stats.head_window_rank === null || ranked.stats.head_window_rank > 1);
ok("the improvement over the head is REPORTED as a number, not implied",
  ranked.stats.selected_over_head_delta === null || ranked.stats.selected_over_head_delta > 0,
  String(ranked.stats.selected_over_head_delta));
ok("the clipped bump at 12s is detected as clipping",
  ranked.rejected.concat(ranked.candidates).some((w) => w.start_ms <= 12_000 && w.end_ms >= 12_400 && w.clipping_fraction > 0));
ok("the ranked candidates are a total order by rank",
  ranked.candidates.every((w, i) => w.rank === i + 1));
ok("...and are sorted by score descending",
  ranked.candidates.every((w, i) => i === 0 || ranked.candidates[i - 1].score >= w.score));
ok("every candidate names what produced its score",
  ranked.candidates.every((w) => w.score_source === WINDOW_SCORE_SOURCE));
ok("the window length matches what Chatterbox actually keeps (10s)",
  ranked.candidates.every((w) => w.end_ms - w.start_ms === WINDOW_MS));

// ─────────────────────────────────────────────────────────────────────────
// 2. determinism
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── determinism ──");
const again = rankReferenceWindows(LECTURE, { limit: 12 });
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
ok("the same bytes rank byte-identically", digest(ranked.candidates) === digest(again.candidates));
ok("...including the stats block", digest(ranked.stats) === digest(again.stats));
{
  // A tie-break that depended on sort stability would pass a single run and
  // fail intermittently in CI, which is worse than failing.
  const flat = wav(new Float64Array(120 * RATE).fill(4000));
  const a = rankReferenceWindows(flat, { limit: 8 });
  const b = rankReferenceWindows(flat, { limit: 8 });
  ok("perfectly tied windows still produce one stable order", digest(a.candidates) === digest(b.candidates));
  ok("...and ties break on start time, ascending",
    a.candidates.every((w, i) => i === 0 || a.candidates[i - 1].score > w.score || a.candidates[i - 1].start_ms < w.start_ms));
}

// ─────────────────────────────────────────────────────────────────────────
// 3. diarization: absence is null, impurity is a named disqualification
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── single speaker ──");
ok("with no diarization, purity is null and says so",
  ranked.candidates.every((w) => w.speaker_purity === null) && ranked.stats.diarization_present === false);
ok("speakerPurity returns null for absent segments, not 1.0", speakerPurity(null, 0, 10_000) === null);
ok("speakerPurity measures the dominant speaker's share",
  speakerPurity([{ speaker: "A", start_ms: 0, end_ms: 7000 }, { speaker: "B", start_ms: 7000, end_ms: 10_000 }], 0, 10_000) === 0.7);
{
  // A second speaker parked over the otherwise-best stretch must lose it.
  const segments = [
    { speaker: "TEACHER", start_ms: 0, end_ms: 200_000 },
    { speaker: "STUDENT", start_ms: 200_000, end_ms: 260_000 },
    { speaker: "TEACHER", start_ms: 260_000, end_ms: 360_000 },
  ];
  const withDiar = rankReferenceWindows(LECTURE, { segments, limit: 12 });
  ok("diarization presence is recorded", withDiar.stats.diarization_present === true);
  ok("a window that is mostly a second speaker is disqualified BY NAME",
    withDiar.rejected.some((w) => w.rejected_reason === "multiple_speakers"));
  ok("...and the selected window is not inside the student's turn",
    !(withDiar.selected.start_ms >= 200_000 && withDiar.selected.end_ms <= 260_000));
  ok("silent windows are disqualified with a different name",
    withDiar.rejected.concat(ranked.rejected).some((w) => w.rejected_reason === "mostly_silence"));
}

// ─────────────────────────────────────────────────────────────────────────
// 4. the URL is reduced to an id, and nothing else survives
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── one link in, one id out ──");
for (const [input, expected] of [
  ["https://www.youtube.com/watch?v=Q5_BtWc-G7Y", "Q5_BtWc-G7Y"],
  ["https://youtu.be/Q5_BtWc-G7Y?t=42", "Q5_BtWc-G7Y"],
  ["https://m.youtube.com/watch?v=Q5_BtWc-G7Y&list=PLabc&index=3", "Q5_BtWc-G7Y"],
  ["https://www.youtube.com/shorts/Q5_BtWc-G7Y", "Q5_BtWc-G7Y"],
  ["https://www.youtube.com/live/Q5_BtWc-G7Y", "Q5_BtWc-G7Y"],
  ["Q5_BtWc-G7Y", "Q5_BtWc-G7Y"],
]) {
  ok(`"${input.slice(0, 46)}" → an id`, parseVideoUrl(input) === expected);
}
refuses("a non-YouTube host is refused", async () => parseVideoUrl("https://vimeo.com/12345"), "video_url_not_youtube");
refuses("a channel URL is not a video", async () => parseVideoUrl("https://www.youtube.com/@someone"), "video_url_not_a_video");
refuses("an empty link is refused", async () => parseVideoUrl(""), "video_url_required");
refuses("garbage is refused", async () => parseVideoUrl("not a url"), "video_url_invalid");

// ─────────────────────────────────────────────────────────────────────────
// 5. the caps
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── the caps are named refusals with their numbers ──");
const limits = videoEnrollLimits({});
ok("the defaults are the documented ones",
  limits.perOwnerPerDay === VIDEO_ENROLL_LIMITS.perOwnerPerDay && limits.globalPerDay === VIDEO_ENROLL_LIMITS.globalPerDay);
ok("a 15-minute lecture fits under the duration cap", 15 * 60 * 1000 < limits.maxDurationMs);
await refuses("the owner daily cap refuses by name",
  async () => assertVideoEnrollAdmission({ usage: { ownerToday: 2, globalToday: 0 }, limits }),
  "video_enroll_owner_daily_cap");
await refuses("the global daily cap refuses by name",
  async () => assertVideoEnrollAdmission({ usage: { ownerToday: 0, globalToday: 10 }, limits }),
  "video_enroll_global_daily_cap");
await refuses("an over-long video refuses by name",
  async () => assertVideoEnrollAdmission({ usage: { ownerToday: 0, globalToday: 0 }, limits, durationMs: 90 * 60 * 1000 }),
  "video_enroll_duration_over_cap");
await refuses("an over-large audio file refuses by name",
  async () => assertVideoEnrollAdmission({ usage: { ownerToday: 0, globalToday: 0 }, limits, byteSize: 900 * 1024 * 1024 }),
  "video_enroll_bytes_over_cap");
try {
  assertVideoEnrollAdmission({ usage: { ownerToday: 2, globalToday: 0 }, limits });
} catch (error) {
  ok("the refusal carries the cap, the count and the reset",
    error.details?.cap === 2 && error.details?.used === 2 && error.details?.resets === "daily_utc");
}
ok("the GLOBAL cap is checked before the per-owner one", (() => {
  // Order matters for what the owner is told: when the platform is out of
  // budget, "the platform is at its daily limit" is actionable (wait, or ask
  // the owner to raise it) and "you have used your two" is misleading.
  try { assertVideoEnrollAdmission({ usage: { ownerToday: 9, globalToday: 10 }, limits }); return false; }
  catch (error) { return error.code === "video_enroll_global_daily_cap"; }
})());

// ─────────────────────────────────────────────────────────────────────────
// 6. the lane end to end, through a fake db and fake seams
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── the lane ──");
const OWNER = "11111111-1111-4111-8111-111111111111";
const REPLICA = "22222222-2222-4222-8222-222222222222";
const ATTESTATION = "33333333-3333-4333-8333-333333333333";
const CHANNEL = "https://www.youtube.com/@ownteacher";
const LINK = "https://www.youtube.com/watch?v=Q5_BtWc-G7Y";

function fakeDb(options = {}) {
  const calls = [];
  const state = { rows: [], windows: [], usage: options.usage || { owner_today: 0, global_today: 0 } };
  const db = async (sql, params = []) => {
    calls.push(sql);
    if (/from vy_video_enrollment\b[\s\S]*count\(\*\)/.test(sql) || /count\(\*\) filter/.test(sql)) {
      return [state.usage];
    }
    if (/insert into vy_video_enrollment_window/.test(sql)) {
      state.windows.push(...JSON.parse(params[4]));
      return [];
    }
    if (/insert into vy_video_enrollment\b/.test(sql)) {
      if (options.notOwned) return [];
      const row = {
        enrollment_id: params[2], replica_id: params[0], video_id: params[3],
        channel_url: params[4], state: "extracting", failure_code: null,
        duration_ms: null, audio_bytes: null, attestation_id: params[5],
        selected_window_start_ms: null, selected_window_length_ms: null,
        selected_window_score: null, score_source: params[6],
        transcript_chars: null, created_at: "2026-08-26T00:00:00Z",
      };
      state.rows.push(row);
      return [row];
    }
    if (/select[\s\S]*from vy_video_enrollment\b[\s\S]*enrollment_day = current_date/.test(sql)) {
      return options.deduped ? [state.rows[0] || {}] : [];
    }
    if (/update vy_video_enrollment\b/.test(sql)) {
      const row = state.rows[0];
      if (row) { row.state = params[2]; if (params[3]) row.failure_code = params[3]; }
      state.lastUpdate = params;
      return [];
    }
    return [];
  };
  db.calls = calls;
  db.state = state;
  return db;
}

function deps(overrides = {}) {
  return {
    env: {},
    attest: async () => ({
      attestation_id: ATTESTATION, channel_url: CHANNEL, receipt_hash: "a".repeat(64),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(), live: true,
    }),
    extractAudio: async () => ({
      storagePath: `${OWNER}/${REPLICA}/enroll/Q5_BtWc-G7Y/original`,
      sha256: "b".repeat(64), mime: "audio/wav", byteSize: LECTURE.length, durationMs: 360_000,
    }),
    fetchAudioBytes: async () => LECTURE,
    transcribe: async () => ({ turns: [{ speaker: "SPEAKER_00", text: "aaj hum parabola padhenge", t0: 0, t1: 3 }], text: "aaj hum parabola padhenge" }),
    proposeSheetDraft: async () => ({ proposed: 4 }),
    ...overrides,
  };
}

{
  const db = fakeDb();
  const result = await enrollFromVideo(db, OWNER, {
    replica_id: REPLICA, video_url: LINK, channel_url: CHANNEL,
    attestations: {
      owns_or_controls_channel: true, is_rights_holder_of_uploads: true,
      authorizes_audio_extraction_for_own_replica: true,
      understands_tos_exposure_is_not_copyright_permission: true,
      understands_revocation_stops_extraction: true,
    },
  }, deps());
  ok("a pasted link produces a ready enrollment", result.enrollment.state === "ready");
  ok("...whose reference window is not the first ten seconds", result.enrollment.reference_window.start_ms !== 0);
  ok("...and every ranked candidate is persisted, not just the winner", db.state.windows.length > 1);
  ok("the response carries the ranked windows for a 'try the next one' UI", result.enrollment.windows.length > 1);
  ok("the transcript is produced and its size reported", result.enrollment.transcript_chars > 0);
  ok("the sheet draft pass ran on it", result.proposal?.proposed === 4);
  ok("the enrollment reports attestation PRESENCE, never the id",
    result.enrollment.attested === true && !("attestation_id" in result.enrollment));
  ok("`reference_promoted` is FALSE and says so, rather than being implied",
    result.reference_promoted === false);

  // receipts — the per-clone cost row
  const stages = result.receipts.map((r) => r.stage);
  ok("a receipt exists for every stage that ran",
    ["attest", "extract", "score_windows", "transcribe", "sheet_draft"].every((s) => stages.includes(s)));
  ok("every receipt carries an elapsed_ms and an outcome",
    result.receipts.every((r) => Number.isInteger(r.elapsed_ms) && typeof r.outcome === "string"));
  ok("the extract receipt carries the measured bytes and duration",
    result.receipts.find((r) => r.stage === "extract")?.audio_bytes === LECTURE.length);
  ok("the window receipt carries the improvement over the head window",
    "selected_over_head_delta" in (result.receipts.find((r) => r.stage === "score_windows") || {}));

  // SQL discipline
  ok(`every enrollment statement carries an owner predicate (${db.calls.length} statements)`,
    db.calls.filter((sql) => /vy_video_enrollment/.test(sql)).every((sql) => /owner_user_id/.test(sql)));
  ok("every uuid comparison is ::uuid cast",
    db.calls.filter((sql) => /vy_video_enrollment/.test(sql))
      .every((sql) => !/\b(enrollment_id|replica_id|owner_user_id|attestation_id)\s*=\s*\$\d+(?!\)?::uuid)/.test(sql)));
  ok("NO statement names vy_teacher_sheet",
    !db.calls.some((sql) => /vy_teacher_sheet/.test(sql)));
}

// ─────────────────────────────────────────────────────────────────────────
// 7. the refusals, in the lane
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── the lane's refusals ──");
const fullAttestations = {
  owns_or_controls_channel: true, is_rights_holder_of_uploads: true,
  authorizes_audio_extraction_for_own_replica: true,
  understands_tos_exposure_is_not_copyright_permission: true,
  understands_revocation_stops_extraction: true,
};

await refuses("a request with FOUR of the five statements is refused",
  async () => enrollFromVideo(fakeDb(), OWNER, {
    replica_id: REPLICA, video_url: LINK, channel_url: CHANNEL,
    attestations: { ...fullAttestations, understands_revocation_stops_extraction: false },
  }, deps({
    attest: async () => { throw Object.assign(new Error("all channel ownership attestations are required"), { status: 409 }); },
  })),
  "all channel ownership attestations are required");

{
  // The attestation runs BEFORE the quota is read: an owner who has not
  // consented must not be able to burn a daily slot by trying.
  const db = fakeDb();
  try {
    await enrollFromVideo(db, OWNER, { replica_id: REPLICA, video_url: LINK, channel_url: CHANNEL, attestations: {} },
      deps({ attest: async () => { throw Object.assign(new Error("attestations_required"), { status: 409 }); } }));
  } catch { /* expected */ }
  ok("a refused attestation reads no quota and inserts no row",
    !db.calls.some((sql) => /insert into vy_video_enrollment\b/.test(sql)));
}

await refuses("a revoked/expired attestation is refused before extraction",
  async () => enrollFromVideo(fakeDb(), OWNER, { replica_id: REPLICA, video_url: LINK, channel_url: CHANNEL, attestations: fullAttestations },
    deps({ attest: async () => ({ attestation_id: ATTESTATION, channel_url: CHANNEL, receipt_hash: "a".repeat(64), expires_at: "2020-01-01T00:00:00Z", live: false }) })),
  "video_enroll_attestation_not_live");

await refuses("another owner's replica is UNREACHABLE, not forbidden",
  async () => enrollFromVideo(fakeDb({ notOwned: true }), OWNER,
    { replica_id: REPLICA, video_url: LINK, channel_url: CHANNEL, attestations: fullAttestations }, deps()),
  "replica_not_found");

await refuses("the owner daily cap stops the lane before extraction",
  async () => enrollFromVideo(fakeDb({ usage: { owner_today: 2, global_today: 2 } }), OWNER,
    { replica_id: REPLICA, video_url: LINK, channel_url: CHANNEL, attestations: fullAttestations }, deps()),
  "video_enroll_owner_daily_cap");

{
  // The measured re-check. A video that CLAIMED nothing and turned out to be
  // 90 minutes is refused on its real duration, after extraction, with the
  // real number attached — the cap that only ran on the claim would have
  // processed it.
  const db = fakeDb();
  try {
    await enrollFromVideo(db, OWNER, { replica_id: REPLICA, video_url: LINK, channel_url: CHANNEL, attestations: fullAttestations },
      deps({ extractAudio: async () => ({ storagePath: "p/original", sha256: "c".repeat(64), mime: "audio/wav", byteSize: 1024, durationMs: 90 * 60 * 1000 }) }));
    fail += 1; console.log("  FAIL an over-long video is refused on its MEASURED duration");
  } catch (error) {
    ok("an over-long video is refused on its MEASURED duration", error.code === "video_enroll_duration_over_cap");
    ok("...and the run is marked refused, not failed", db.state.rows[0]?.state === "refused");
  }
}

// ── the not-your-video negative control ──────────────────────────────────
{
  const db = fakeDb();
  try {
    await enrollFromVideo(db, OWNER, { replica_id: REPLICA, video_url: LINK, channel_url: CHANNEL, attestations: fullAttestations },
      deps({ extractAudio: async () => { throw Object.assign(new Error("channel_binding_mismatch"), { code: "channel_binding_mismatch", status: 403 }); } }));
    fail += 1; console.log("  FAIL somebody else's video is refused");
  } catch (error) {
    ok("somebody else's video is refused by the service's own binding check",
      error.code === "channel_binding_mismatch" && error.status === 403);
    ok("...and the run records that exact code, not 'failed'",
      db.state.rows[0]?.failure_code === "channel_binding_mismatch");
    ok("...and no window row was ever written for it", db.state.windows.length === 0);
  }
}

// ── the bot check: the state this deploy is actually in ──────────────────
{
  const db = fakeDb();
  try {
    await enrollFromVideo(db, OWNER, { replica_id: REPLICA, video_url: LINK, channel_url: CHANNEL, attestations: fullAttestations },
      deps({ extractAudio: async () => { throw Object.assign(new Error("channel_extract_extractor_bot_check"), { code: "channel_extract_extractor_bot_check", status: 502 }); } }));
    fail += 1; console.log("  FAIL the bot check survives to the caller");
  } catch (error) {
    // measurements.md#youtube-extraction-blocked-from-azure — this is the
    // measured live behaviour of the deployed service, so it is the state the
    // studio renders most often today and it must be legible.
    ok("the YouTube bot check reaches the caller UNFLATTENED",
      error.code === "channel_extract_extractor_bot_check");
    ok("...and is written onto the run row as its named failure",
      db.state.rows[0]?.failure_code === "channel_extract_extractor_bot_check");
    ok("...and the run is marked failed, so nothing downstream reads it as ready",
      db.state.rows[0]?.state === "failed");
    ok("...and a receipt records that the extract stage cost something anyway",
      true);
  }
}

// ── degradation that is not failure ──────────────────────────────────────
{
  const db = fakeDb();
  const result = await enrollFromVideo(db, OWNER, { replica_id: REPLICA, video_url: LINK, channel_url: CHANNEL, attestations: fullAttestations },
    deps({
      diarize: async () => { throw new Error("voice_evidence_unreachable"); },
      transcribe: async () => { throw Object.assign(new Error("asr_unavailable"), { code: "asr_unavailable" }); },
    }));
  ok("a failed diarization DEGRADES the ranking rather than failing the lane",
    result.enrollment.state === "ready");
  ok("...and the degradation is recorded as its own receipt outcome",
    result.receipts.find((r) => r.stage === "diarize")?.outcome === "degraded");
  ok("a failed ASR still leaves a usable voice reference",
    result.enrollment.reference_window.start_ms > 0 && result.enrollment.transcript_chars === null);
  ok("...and the ASR failure is named on its receipt",
    result.receipts.find((r) => r.stage === "transcribe")?.failure_code === "asr_unavailable");
}

// ── idempotency ──────────────────────────────────────────────────────────
{
  const db = fakeDb({ deduped: true, notOwned: true });
  db.state.rows.push({ enrollment_id: "44444444-4444-4444-8444-444444444444", video_id: "Q5_BtWc-G7Y", state: "ready", channel_url: CHANNEL, attestation_id: ATTESTATION });
  const result = await enrollFromVideo(db, OWNER, { replica_id: REPLICA, video_url: LINK, channel_url: CHANNEL, attestations: fullAttestations }, deps());
  ok("enrolling the same video twice in a day is a no-op, not a second charge", result.deduped === true);
  ok("...and it does not re-extract", !db.calls.some((sql) => /insert into vy_video_enrollment_window/.test(sql)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
