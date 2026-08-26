// The stays-current loop (Gurukul WS-I) — the re-ingestion worker end to end.
//
//   node evals/channel.mjs
//
// Offline, deterministic, $0, no DB and no network. It drives the REAL
// `runChannelIngestSweep` through a fake `db` and the fixture channel/ASR
// providers, so the code path this suite reaches is the code path a cron tick
// reaches; only the two seams are replaced. `api/replica-claims.js` over
// `api/_replica-claims.js` is the split that makes that possible and
// `api/_channel-ingest.js` follows it.
//
// ── what this suite is actually guarding ──────────────────────────────────
//
// 1. THE LOOP RUNS AT ALL. A new video appears on a watched channel and a run
//    row walks fetched → transcribed → proposed carrying real stats and a
//    real delta count. Everything else here is a way for that to be true and
//    still be wrong.
//
// 2. IDEMPOTENCE, ASSERTED TWICE OVER. The same video must never be ingested
//    twice, and the two mechanisms that guarantee it are checked separately:
//    the cursor (`last_seen_video_id`, which must advance ONLY on success)
//    and the unique index (which must swallow a re-open even when the cursor
//    is wrong). The second assertion is the one that matters — a cursor is a
//    hint an implementation can lose, and reaching the index means an ASR
//    bill was already paid, so the suite drives the worker with a
//    deliberately RESET cursor and asserts no second transcription happens.
//
// 3. THE NEVER-SILENT-UPDATE LAW, WITH ITS NEGATIVE CONTROL. SPEC-GURUKUL.md
//    §8 item 3: "never silent self-update of a live persona." The positive
//    case is `applyIngestRunDelta`, which names an approver. The negative
//    control is a deliberately dishonest twin — the same UPDATE with the
//    approver and the decision time struck out — and the suite asserts it is
//    REFUSED. The fake db enforces migration 053's
//    `vy_ingest_run_approval_gate` exactly as the database does, because a
//    fake that ignored the constraint would let this suite report an approval
//    the database would have rejected (evals/ingest.mjs's fake honours the
//    consent predicate for the same reason and says so).
//
//    And the stronger half of the same law: NO statement the sweep issues may
//    name `vy_teacher_sheet`. Not a write, not a read. Asserted over every
//    SQL string the worker sent.
//
// 4. A REVOKED WATCH IS UNREACHABLE. Not "filtered" — unreachable. The
//    provider's call counters must all be zero, which is the only honest way
//    to assert an absence, and a revoked watch is a teacher who withdrew
//    permission for their channel to be read.
import { LECTURE_TURNS } from "./fixtures/lecture-hinglish.mjs";
import { createFakeChannelProvider, createFakeAudioStore } from "../api/_channel/providers/fake.js";
import { createFakeAsrProvider } from "../api/_asr/providers/fake.js";
import {
  runChannelIngestSweep,
  applyIngestRunDelta,
  rejectIngestRun,
  listIngestRunsForReview,
} from "../api/_channel-ingest.js";
import { channelRef, videoListing } from "../api/_channel/contracts.js";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WATCH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CHANNEL = "https://www.youtube.com/@arjun-sir-physics";

const VIDEOS = [
  { videoId: "vid0000001A", publishedAt: "2026-08-01T00:00:00Z", title: "Rotational motion, part 1", durationMs: 2_400_000, turns: LECTURE_TURNS },
  { videoId: "vid0000002B", publishedAt: "2026-08-08T00:00:00Z", title: "Rotational motion, part 2", durationMs: 2_400_000, turns: LECTURE_TURNS },
  { videoId: "vid0000003C", publishedAt: "2026-08-15T00:00:00Z", title: "Doubt session", durationMs: 1_800_000, turns: LECTURE_TURNS },
];

// ── the fake db ───────────────────────────────────────────────────────────
// It honours the two constraints migration 053 declares, because those are
// the two rules this suite exists to check and a fake that ignored them would
// be checking itself:
//   - the unique index on (replica_id, video_ref);
//   - `vy_ingest_run_approval_gate`, which makes status='applied' unreachable
//     without an approver and a decision time.
function fakeDb(state) {
  const calls = [];
  const gate = (row) => {
    if (row.status === "applied" && (!row.approved_by_user_id || !row.decided_at)) {
      throw Object.assign(new Error("vy_ingest_run_approval_gate"), { code: "23514" });
    }
    return row;
  };
  const db = async (sql, params) => {
    calls.push(sql);

    if (sql.includes("from vy_channel_watch")) {
      return state.watches.filter((w) => w.status === "active").slice(0, params[0]);
    }

    if (sql.includes("update vy_channel_watch")) {
      const watch = state.watches.find((w) => w.watch_id === params[0] && w.owner_user_id === params[1] && w.status === "active");
      if (!watch) return [];
      watch.last_checked_at = "2026-08-26T00:00:00Z";
      if (params[2]) watch.last_seen_video_id = params[2];
      return [];
    }

    if (sql.includes("insert into vy_ingest_run")) {
      const [runId, replicaId, ownerUserId, watchId, videoRef, transcriptSource] = params;
      const existing = state.runs.find((r) => r.replica_id === replicaId && r.video_ref === videoRef);
      if (existing) {
        // `on conflict do update ... where status='failed'`: anything further
        // along returns NO ROW, which is what makes a re-open a no-op rather
        // than a reset of a proposal mid-review.
        if (existing.status !== "failed" || existing.owner_user_id !== ownerUserId) return [];
        Object.assign(existing, { status: "fetched", failure_code: "", transcript_source: transcriptSource });
        return [{ ...existing }];
      }
      const row = gate({
        run_id: runId, replica_id: replicaId, owner_user_id: ownerUserId, watch_id: watchId,
        video_ref: videoRef, transcript_source: transcriptSource, status: "fetched",
        stats: {}, proposed_delta: {}, proposed_delta_count: 0, failure_code: "",
        approved_by_user_id: null, decided_at: null,
        created_at: `2026-08-26T00:00:0${state.runs.length}Z`, updated_at: "2026-08-26T00:00:00Z",
      });
      state.runs.push(row);
      return [{ ...row }];
    }

    if (sql.includes("update vy_ingest_run") && sql.includes("set status = $3")) {
      const row = state.runs.find((r) => r.run_id === params[0] && r.owner_user_id === params[1]);
      if (!row || row.status === "applied" || row.status === "rejected") return [];
      gate({ ...row, status: params[2] });
      row.status = params[2];
      if (params[3]) row.transcript_source = params[3];
      if (params[4]) row.stats = JSON.parse(params[4]);
      if (params[5]) row.proposed_delta = JSON.parse(params[5]);
      if (params[6] != null) row.proposed_delta_count = params[6];
      row.failure_code = params[7];
      return [{ ...row }];
    }

    if (sql.includes("set status = 'applied'") || sql.includes("set status = 'rejected'")) {
      const row = state.runs.find((r) => r.run_id === params[0] && r.owner_user_id === params[1] && r.status === "proposed");
      if (!row) return [];
      const applied = sql.includes("'applied'");
      // The dishonest twin's UPDATE carries no approver columns. The gate is
      // applied to what the statement would WRITE, which is how the database
      // sees it too — a CHECK does not care which code path reached it.
      const next = {
        ...row,
        status: applied ? "applied" : "rejected",
        approved_by_user_id: sql.includes("approved_by_user_id = $3") ? params[2] : row.approved_by_user_id,
        decided_at: sql.includes("decided_at = now()") ? "2026-08-26T03:00:00Z" : row.decided_at,
      };
      gate(next);
      Object.assign(row, next);
      return [{ ...row }];
    }

    if (sql.includes("from vy_ingest_run")) {
      return state.runs
        .filter((r) => r.replica_id === params[0] && r.owner_user_id === params[1])
        .slice(0, params[2])
        .map((r) => ({ ...r }));
    }
    return [];
  };
  db.calls = calls;
  return db;
}

function freshState(overrides = {}) {
  return {
    watches: [{
      watch_id: WATCH, replica_id: REPLICA, owner_user_id: OWNER, channel_url: CHANNEL,
      provider: "youtube", oauth_grant_ref: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      last_seen_video_id: "", last_checked_at: null, status: "active", ...overrides,
    }],
    runs: [],
  };
}

function harness(channelOptions = {}) {
  const audioStore = createFakeAudioStore();
  const channelProvider = createFakeChannelProvider({ videos: VIDEOS, audioStore, ...channelOptions });
  const asr = createFakeAsrProvider({ audioStore });
  return { channelProvider, asr, audioStore };
}

// ── the contract's own edges, before the loop that rests on them ─────────
{
  ok("a channel handle parses", channelRef(CHANNEL).key === "@arjun-sir-physics");
  ok("a channel id parses", channelRef("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv").kind === "channel_id");
  let rejected = false;
  try { channelRef("https://www.youtube.com/watch?v=vid0000001A"); } catch (error) { rejected = error.code === "channel_url_not_a_channel"; }
  ok("a WATCH url is refused rather than treated as a channel", rejected);
  // The off-by-one that costs money: a provider that includes the cursor in
  // its own answer. Caught at the contract, before an audio fetch.
  let cursorCaught = false;
  try { videoListing([{ videoId: "vid0000001A", publishedAt: "2026-08-01T00:00:00Z" }], "vid0000001A"); }
  catch (error) { cursorCaught = error.code === "channel_listing_includes_cursor"; }
  ok("a listing that includes its own cursor is refused", cursorCaught);
  let unordered = false;
  try {
    videoListing([
      { videoId: "vid0000002B", publishedAt: "2026-08-08T00:00:00Z" },
      { videoId: "vid0000001A", publishedAt: "2026-08-01T00:00:00Z" },
    ]);
  } catch (error) { unordered = error.code === "channel_listing_unordered"; }
  ok("a newest-first listing is refused — the cursor rests on the order", unordered);
}

// ── 1. the loop: new videos become PROPOSED deltas ───────────────────────
let firstSweepState;
{
  const state = freshState();
  firstSweepState = state;
  const db = fakeDb(state);
  const { channelProvider, asr } = harness();
  const summary = await runChannelIngestSweep({ db, channelProvider, asr });

  ok("all three new videos were ingested", summary.ingested === 3 && summary.failed === 0,
    JSON.stringify({ ingested: summary.ingested, failed: summary.failed }));
  ok("every run row reached status='proposed'", state.runs.length === 3 && state.runs.every((r) => r.status === "proposed"),
    state.runs.map((r) => `${r.video_ref}:${r.status}`).join(" "));
  ok("...through the ASR lane, and the row records which lane",
    state.runs.every((r) => r.transcript_source === "asr"));
  ok("every run carries a non-zero proposed_delta_count",
    state.runs.every((r) => r.proposed_delta_count > 0),
    state.runs.map((r) => r.proposed_delta_count).join(","));
  ok("...and the delta is ADDITIONS only, never a retirement",
    state.runs.every((r) => r.proposed_delta.kind === "sheet-candidates/v1" &&
      Array.isArray(r.proposed_delta.additions) && !("retirements" in r.proposed_delta)));

  const stats = state.runs[0].stats;
  ok("the stats are the real transcriptStats numbers, not placeholders",
    stats.corpus.tokens > 0 && stats.corpus.codeSwitch.tokenRatio > 0 && stats.corpus.fillers.length > 0,
    `tokens=${stats.corpus.tokens} cs=${stats.corpus.codeSwitch.tokenRatio}`);
  ok("the corpus measurement and the derive-half measurement are stored SEPARATELY and differ",
    stats.corpus.tokens !== state.runs[0].proposed_delta.measurements.tokens,
    `corpus=${stats.corpus.tokens} derive=${state.runs[0].proposed_delta.measurements.tokens}`);
  ok("the phrase-bank verdict travels with the run",
    typeof stats.phraseBank.verified === "boolean" && stats.phraseBank.heldOutTokens > 0);
  ok("the transcript's provider and model are recorded — two runs must be comparable",
    stats.transcript.provider === "deterministic-fake-asr" && Boolean(stats.transcript.model));

  ok("the cursor advanced to the NEWEST video, and only after success",
    state.watches[0].last_seen_video_id === "vid0000003C");
  ok("the sweep was stamped as checked", Boolean(state.watches[0].last_checked_at));

  // THE LAW. Not a write, not a read.
  ok("NO statement the sweep issued names vy_teacher_sheet",
    db.calls.every((sql) => !sql.includes("vy_teacher_sheet")));
  ok("every vy_ingest_run statement carries owner_user_id in its predicate",
    db.calls.filter((sql) => sql.includes("vy_ingest_run") && sql.includes("where"))
      .every((sql) => sql.includes("owner_user_id")));

  // Determinism: the same corpus in three videos must measure identically.
  // "The numbers are the product" (evals/ingest.mjs) — a statistical pass
  // whose numbers drift between two runs of the same transcript is worth
  // nothing at all, and a re-ingestion loop runs it every week.
  const counts = new Set(state.runs.map((r) => r.proposed_delta_count));
  ok("the same corpus measured in three runs produces one answer", counts.size === 1, [...counts].join(","));
}

// ── 2. idempotence, both mechanisms ──────────────────────────────────────
{
  const state = firstSweepState;
  const db = fakeDb(state);
  const { channelProvider, asr } = harness();
  const summary = await runChannelIngestSweep({ db, channelProvider, asr });
  ok("a second sweep with nothing new ingests nothing", summary.ingested === 0 && summary.failed === 0);
  ok("...and no new run rows appeared", state.runs.length === 3);
  ok("...and no audio was fetched or transcribed a second time",
    channelProvider.calls.fetchAudio === 0 && asr.calls.transcribe === 0);
  ok("the listing WAS still asked — staying current means asking", channelProvider.calls.listNewVideos === 1);
}
{
  // The mechanism that survives a lost cursor. Reset it by hand and sweep
  // again: the unique index must swallow every re-open, so nothing is
  // transcribed twice even though the cursor says the videos are new. This is
  // the assertion worth having, because reaching this point in production
  // means the ASR bill would otherwise be paid a second time.
  const state = firstSweepState;
  state.watches[0].last_seen_video_id = "";
  const db = fakeDb(state);
  const { channelProvider, asr } = harness();
  const summary = await runChannelIngestSweep({ db, channelProvider, asr });
  ok("with the cursor RESET the listing offers all three again", summary.detail[0].listed === 3);
  ok("...and not one of them is transcribed twice", asr.calls.transcribe === 0);
  ok("...and no second run row is created", state.runs.length === 3);
  ok("...and the run rows are untouched, still 'proposed'", state.runs.every((r) => r.status === "proposed"));
}

// ── 3. failure is per lane, and the cursor stops at it ───────────────────
{
  const state = freshState();
  const db = fakeDb(state);
  const { channelProvider, asr } = harness({ failAudioFor: "vid0000002B" });
  const summary = await runChannelIngestSweep({ db, channelProvider, asr });

  ok("the first video still succeeded", summary.ingested === 1 && summary.failed === 1);
  ok("the failing video's run row landed 'failed' with the provider's code",
    state.runs.find((r) => r.video_ref === "vid0000002B")?.status === "failed" &&
    state.runs.find((r) => r.video_ref === "vid0000002B")?.failure_code === "fixture_audio_unavailable");
  ok("the cursor stopped BEFORE the failure — order is the point",
    state.watches[0].last_seen_video_id === "vid0000001A");
  ok("the video after the failure was never touched",
    !state.runs.some((r) => r.video_ref === "vid0000003C"));

  // The retry: the same watch, a working provider. The failed row re-opens
  // (that is the `where status='failed'` clause) and the succeeded one does
  // not.
  const retry = harness();
  const second = await runChannelIngestSweep({ db, channelProvider: retry.channelProvider, asr: retry.asr });
  ok("the next sweep retries exactly the failed video and continues past it",
    second.ingested === 2 && second.failed === 0 && state.runs.length === 3);
  ok("...and the retried row is now 'proposed'",
    state.runs.find((r) => r.video_ref === "vid0000002B")?.status === "proposed");
  ok("...and the cursor caught up", state.watches[0].last_seen_video_id === "vid0000003C");
}

// ── 4. a revoked watch is unreachable ────────────────────────────────────
{
  for (const status of ["revoked", "paused"]) {
    const state = freshState({ status });
    const db = fakeDb(state);
    const { channelProvider, asr } = harness();
    const summary = await runChannelIngestSweep({ db, channelProvider, asr });
    ok(`a ${status} watch is not swept`, summary.watches === 0 && summary.ingested === 0);
    ok(`...and the provider was never called at all (${status})`,
      channelProvider.calls.listNewVideos === 0 && channelProvider.calls.fetchAudio === 0 && asr.calls.transcribe === 0);
    ok(`...and no run row exists for it (${status})`, state.runs.length === 0);
  }
}

// ── 5. the never-silent-update law, and its negative control ─────────────
{
  const state = freshState();
  const db = fakeDb(state);
  const { channelProvider, asr } = harness();
  await runChannelIngestSweep({ db, channelProvider, asr });
  const runId = state.runs[0].run_id;

  // THE NEGATIVE CONTROL. A deliberately dishonest twin of the approval op:
  // the same transition, with the approver and the decision time struck out.
  // It is written here rather than imported because the point is that no such
  // function exists in the tree — and if one is ever added, the constraint
  // this asserts is what catches it.
  const silentApply = (database, ownerUserId, id) => database(
    `update vy_ingest_run
        set status = 'applied', updated_at = now()
      where run_id = $1 and owner_user_id = $2 and status = 'proposed'
      returning run_id, status`,
    [id, ownerUserId],
  );
  let refused = null;
  try { await silentApply(db, OWNER, runId); }
  catch (error) { refused = error.message; }
  ok("a silent apply — status='applied' with no approver — is REFUSED by the constraint",
    refused === "vy_ingest_run_approval_gate", String(refused));
  ok("...and the run is still merely 'proposed'",
    state.runs.find((r) => r.run_id === runId).status === "proposed");

  // The positive case: the approval op, which names a human.
  const applied = await applyIngestRunDelta(db, OWNER, runId, OWNER);
  ok("the approval op applies the delta and records WHO approved it",
    applied.status === "applied" && applied.approved_by_user_id === OWNER && Boolean(applied.decided_at));
  ok("...and it is not re-appliable", await applyIngestRunDelta(db, OWNER, runId, OWNER).then(() => false, (e) => e.code === "channel_ingest_run_not_approvable"));

  // Rejection keeps the row (migration 051's "revoked rows are kept", one
  // table over): without it the next sweep re-proposes the video forever.
  const rejectedRun = await rejectIngestRun(db, OWNER, state.runs[1].run_id, OWNER);
  ok("a rejected run is kept, marked, and dated", rejectedRun.status === "rejected" && Boolean(rejectedRun.decided_at));

  // Owner scoping, on the two ops a studio can reach.
  ok("another owner cannot apply this owner's run",
    await applyIngestRunDelta(db, OTHER, state.runs[2].run_id, OTHER).then(() => false, (e) => e.code === "channel_ingest_run_not_approvable"));
  ok("another owner's review list is empty rather than partial",
    (await listIngestRunsForReview(db, OTHER, REPLICA)).length === 0);
  const review = await listIngestRunsForReview(db, OWNER, REPLICA);
  ok("the studio's review list carries the delta the UI renders",
    review.length === 3 && review.every((row) => row.proposed_delta && typeof row.proposed_delta_count === "number"));
}

// ── 6. the captions lane ─────────────────────────────────────────────────
{
  const state = freshState();
  const db = fakeDb(state);
  const audioStore = createFakeAudioStore();
  const channelProvider = createFakeChannelProvider({
    videos: VIDEOS.map((video) => ({ ...video, captions: video.turns })),
    audioStore,
    captionsFirst: true,
  });
  const asr = createFakeAsrProvider({ audioStore });
  const summary = await runChannelIngestSweep({ db, channelProvider, asr });
  ok("owner captions are preferred over ASR when they exist",
    summary.ingested === 3 && asr.calls.transcribe === 0 && channelProvider.calls.fetchAudio === 0);
  ok("...and the row records that lane, so two runs stay comparable",
    state.runs.every((r) => r.transcript_source === "captions"));
}

// ── 7. the seams fail closed without env ─────────────────────────────────
{
  const { createProductionChannelProvider, configuredChannelProvider } = await import("../api/_channel/registry.js");
  const { createProductionAsrProvider, configuredAsrProvider } = await import("../api/_asr/registry.js");
  ok("the channel registry throws a coded 503 with no env",
    (() => { try { createProductionChannelProvider({}); return false; } catch (e) { return e.code === "channel_provider_unavailable" && e.status === 503; } })());
  ok("the ASR registry throws a coded 503 with no env",
    (() => { try { createProductionAsrProvider({}); return false; } catch (e) { return e.code === "asr_provider_unavailable" && e.status === 503; } })());
  ok("...and the cron's spelling DISABLES rather than throwing",
    configuredChannelProvider({}) === null && configuredAsrProvider({}) === null);
  // By CONSTRUCTION, not by flag: neither registry imports a fixture, so
  // there is no environment variable and no argument that can make production
  // reach one. Checked over the import statements rather than the file text —
  // both registries discuss the fakes in prose, and a grep that could not
  // tell a comment from an import would have to be satisfied by deleting the
  // explanation.
  const { readFileSync } = await import("node:fs");
  const importsFake = (file) => readFileSync(new URL(file, import.meta.url), "utf8")
    .split("\n").some((line) => /^\s*import\b/.test(line) && /fake/i.test(line));
  ok("no registry has a branch that can return a fixture provider",
    !importsFake("../api/_channel/registry.js") && !importsFake("../api/_asr/registry.js"));
}

console.log(fail ? `\n${fail} of ${pass + fail} FAILURES` : `\nALL ${pass} CHECKS PASS`);
process.exitCode = fail ? 1 : 0;
