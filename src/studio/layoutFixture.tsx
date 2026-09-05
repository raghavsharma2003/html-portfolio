/* THE LAYOUT GATE'S EYES.
 *
 * Why this file exists, stated plainly so nobody deletes it as dead code:
 *
 * `scripts/check-layout.mjs` asks the only question that matters about a
 * layout, CAN I READ THIS, and it asks it of a real browser at real widths.
 * But the defects it exists to catch all live in the SIGNED-IN studio panels,
 * and signing in needs a real Supabase user and a real service key. A gate that
 * needs a secret cannot run in CI, so the first version of the gate rendered
 * `/studio` signed out, measured an empty screen, and reported OK while the
 * studio was wrapping one word per line. It was the same defect class it
 * existed to catch: a check that cannot see the thing it checks.
 *
 * So this page renders the REAL `StudioApp` with a REAL replica in state and a
 * stubbed `/api/*` surface. No secret, no network, deterministic, and the panels
 * that break are on screen. The components are imported from source, not
 * copied, so the gate exercises the tree being shipped rather than a snapshot.
 *
 * It is inert in production by construction: it refuses to render anywhere but
 * loopback, and nothing links to it. See `context/decisions.md#layout-fixture`.
 */
import ReactDOM from "react-dom/client";
import StudioApp from "./StudioApp";
import "./design/tokens.css";
import "./studio.css";
import "./design/honesty.css";
import "./design/mobile.css";
// WS-R4. The review card is rendered by this fixture, so the gate has to load
// the stylesheet the real studio loads or it would measure an unstyled panel
// and report OK about a layout nobody ships.
import "./design/review-queue.css";
import type { Replica } from "./types";
import { loadStudioCopy, STUDIO_COPY_TABLE } from "./copy";

/** WS-R52. `src/room/layoutFixture.tsx`'s own `flattenHiStrings` -- the
 *  measurement algorithm it feeds (`scripts/check-layout.mjs`'s `glyphAudit`)
 *  is shared by calling the SAME function with a different `stringsGlobal`;
 *  this eight-line flatten helper is glue, not measurement, and is kept
 *  local rather than imported from `src/room/layoutFixture.tsx` because that
 *  module runs a side-effecting `render()` at import time against a DOM node
 *  (`#room-root`) this page never mounts. */
function flattenHiStrings(node: unknown, prefix: string, out: [string, string][]): void {
  if (typeof node === "string") {
    out.push([prefix, node]);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => flattenHiStrings(v, `${prefix}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) flattenHiStrings(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

declare global {
  interface Window {
    __STUDIO_HI_STRINGS__?: [string, string][];
  }
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", ""]);

const FIXTURE_REPLICA: Replica = {
  replica_id: "fixture-replica-0001",
  display_name: "Anjali Physics",
  subject_mode: "self",
  lifecycle: "consent_pending",
  policy_version: "replica-self-v1",
  age_verified: false,
  identity_verified: false,
  liveness_verified: false,
  locale: "en",
  created_at: "2026-08-01T09:00:00.000Z",
  updated_at: "2026-08-01T09:00:00.000Z",
};

/* Every studio route answers, and answers with the shape its caller reads.
 * Unlisted routes get an empty object, which lands the panel in its EMPTY
 * state. That is deliberate: the empty and blocked states carry the longest
 * prose in the studio, and they are exactly where the collapsed columns were
 * found. A gate that only ever saw populated panels would miss them. */
const ROUTES: Record<string, unknown> = {
  "/api/replica": { replicas: [FIXTURE_REPLICA], replica: FIXTURE_REPLICA },
  "/api/account": { account: { email: "teacher@example.edu", verified: true } },
  "/api/replica-source": { sources: [] },
  "/api/replica-review": { review: null, items: [] },
  /* WS-R4. POPULATED on purpose, unlike most routes here: the review card is
     the longest single block of model-authored prose in the studio and it is
     the exact shape the collapsed-column defect lives in. An empty queue would
     render three sentences and prove nothing. */
  "/api/review-queue": {
    queue: {
      replica_id: "fixture-replica-0001",
      cards: [{
        card_id: "fixture-card-0001",
        kind: "question",
        prompt_text: "Should I do cardio on lifting days, or keep the two completely separate through the week?",
        answer_text: "Keep them separate where you can. If you have to stack them, lift first and put the cardio after, "
          + "twenty minutes at a pace you could hold a conversation at. The point is that the lifting session is the one "
          + "you protect, and everything else fits around it.",
        source_refs: [],
        state: "open",
        decided_at: null,
        has_correction: false,
        created_at: "2026-08-01T09:00:00.000Z",
      }],
      open_count: 14,
      decided_count: 16,
      fixed_count: 3,
      never_count: 1,
      active_never_rules: 1,
      cap: 30,
    },
    // WS-R72. Two more populated-on-purpose shapes at the SAME path, the
    // comment above's own reasoning restated: `flags` (the studio's flagged-
    // reply cards, so their "Never say this" / "Sounds right anyway" render
    // for real rather than behind an empty list) and `cards` (the Share
    // tab's picker, `op: "showcase_eligible"`'s own response key). This
    // fixture answers every request to this path with the SAME static body
    // regardless of method or `op` - `installStubFetch`'s own limit, stated
    // in its header - so both live alongside `queue` rather than replacing
    // it.
    flags: [
      {
        reply_sha256: "1".repeat(64),
        reply_text: "The exam is on the 14th, not the 12th. I checked the notice again this morning.",
        count: 3,
        reasons: { wrong: 1, harmful: 2, not_them: 0, other: 0 },
        suggest_never: true,
        last_flagged_at: "2026-08-30T10:00:00.000Z",
      },
      {
        reply_sha256: "2".repeat(64),
        reply_text: "You can skip the mock test this week if you are still recovering from the fever.",
        count: 1,
        reasons: { wrong: 0, harmful: 0, not_them: 1, other: 0 },
        suggest_never: false,
        last_flagged_at: "2026-08-29T08:00:00.000Z",
      },
    ],
    cards: [
      {
        card_id: "fixture-card-eligible-0001",
        kind: "question",
        prompt_text: "How long before a JEE mock test should I stop revising new topics?",
        answer_text: "Stop new topics about a week out. The last week is for the mistakes you already know you make, "
          + "not for anything new.",
      },
      {
        card_id: "fixture-card-eligible-0002",
        kind: "claim",
        prompt_text: "Does your AI have this right about you?",
        answer_text: "I only take students who can commit to daily practice, not weekend crash sessions.",
      },
    ],
  },
  // `ActivityView`. `jobs` and `lanes` are both read without a guard, and
  // `next_poll_ms: null` is what stops the panel polling forever under the gate.
  "/api/replica-activity": {
    replica_id: "fixture-replica-0001",
    generated_at: "2026-08-01T09:00:00.000Z",
    jobs: [],
    lanes: [],
    in_flight: false,
    next_poll_ms: null,
  },
  "/api/replica-runtime": { status: null, blockers: [] },
  // `ContextLockerView`. `limits` is read without a guard, so the shape has to
  // be complete or the whole Feed step throws and the gate sees a blank page.
  "/api/context-items": {
    items: [],
    count: 0,
    quota: { items: 0, bytes: 0, max_items: 200, max_bytes: 524_288_000 },
    limits: {
      max_item_bytes: 20_971_520,
      accepted_file_formats: ["txt", "md", "pdf", "docx"],
      routed_elsewhere: {},
    },
  },
  "/api/clone-channel": { channels: [] },
  // WS-R7. The Room's creator side. `room: null` with a named reason is the
  // REAL shape `getOwnedRoom` returns before a creator has ever set one up —
  // the empty state that carries this panel's longest prose, so it is the one
  // worth measuring rather than a bare `{}`.
  "/api/room-publish": { room: null, reason: "not_created" },
  // `RoomStudio`'s Week six card reads `cohorts` and `verdict` without a
  // guard the moment a Room is published (the `showcase-picker` scenario
  // publishes one); an unlisted route's `{}` threw before the picker could
  // paint (found by the wave-thirteen merge gate). The real door always
  // answers this shape (api/_room-cohorts.js's own `verdictFor`).
  "/api/room-cohorts": {
    cohorts: [],
    verdict: { verdict: "not_measurable_yet", cohort_week: null, week6_return_share: null },
  },
  // `InviteCreatorCard` (WS-R47) reads `quota.remaining` without a guard once
  // a Room is published, the same way as the cohorts card above; the real
  // door's own shape (`api/_creator-invites.js`: three invites, none used).
  "/api/invites": { invites: [], quota: { max: 3, used: 0, remaining: 3 } },
  // `HandoffCard` (WS-R20) reads `counts.sent`/`counts.answered` without a
  // guard once a Room is published. One static body answers every op on this
  // path (`installStubFetch`'s own limit), so `config_get`'s two fields and
  // `queue`'s two fields live side by side: Handoff off, an empty queue.
  "/api/handoff": {
    enabled: false, monthly_cap: 0,
    counts: { drafted: 0, sent: 0, answered: 0, withdrawn: 0 }, next: null,
  },
  // `CheckinsCard` (WS-R16): `design_list` unwraps `designs`; none designed.
  "/api/checkins": { designs: [] },
  // `RoomStudio`'s Suite line (WS-R28): `room_status` unwraps `org`; not in a Suite.
  "/api/org": { org: null },
  // `ChannelWatchView`. `attestations` is read without a guard, so it has to
  // be an array or the Feed step throws before it paints.
  "/api/channel-watch": {
    attestations: [],
    watches: [],
    statements: [
      "This YouTube channel is mine, I own it or I control it.",
      "I hold the rights to the videos on it, so I can license their use for my own AI.",
      "I authorise this platform to take the audio from those videos and use it to build my own AI.",
    ],
    statement_set: "channel-ownership-v1",
    extraction_available: false,
  },
  "/api/teacher-sheet": { sheet: null, draft: null },
  "/api/replica-claims": { claims: [] },
  "/api/replica-voice": { versions: [] },
  "/api/replica-consent": { consent: null },
  "/api/replica-identity": { identity: null },
  "/api/replica-liveness": { liveness: null },
  "/api/replica-person-model": { model: null, blockers: [] },
  "/api/replica-calibration": { calibration: null },
  "/api/replica-dialogue": { turns: [] },
  "/api/replica-feedback": { feedback: [] },
  "/api/replica-candidate-eval": { candidates: [] },
  "/api/replica-speech": { speech: null },
  "/api/replica-voice-preference": { comparison: null },
  "/api/replica-voice-delivery-policy": { policy: null },
  "/api/replica-voice-trial": { trial: null },
  "/api/replica-voice-preview": { preview: null },
  "/api/replica-provider-consent": { consents: [] },
  "/api/voice-preview": { preview: null },
  "/api/video-enroll": {
    enrollments: [], extraction_configured: false,
    limits: { perOwnerPerDay: 4, maxDurationMs: 7_200_000, maxAudioBytes: 536_870_912, globalPerDay: 20 },
  },
  "/api/mirror-call": { contract: null, call: null },
};

/* WS-AP's scenarios, layered onto `ROUTES` by `?scenario=`.
 *
 * The default fixture (empty, signed-in, nothing uploaded) is what
 * `check-layout.mjs` already drives, and it cannot see the owner's actual
 * complaint: none of it exists until a real upload is in flight. Reusing THIS
 * fixture rather than building a third harness (the brief's own instruction)
 * meant adding scenarios here, not a parallel page. Each overlay is a partial
 * `ROUTES` patch, applied on top of the base table, so a scenario only needs
 * to state what is DIFFERENT about it. */
const ACTIVITY_LANES = [
  "upload_processing", "channel_video", "channel_watch",
  "context_item", "voice_model_build", "mirror_finetune", "erasure",
] as const;
const LANE_LABELS: Record<(typeof ACTIVITY_LANES)[number], string> = {
  upload_processing: "Uploaded recordings", channel_video: "Individual videos",
  channel_watch: "Channel watching", context_item: "Files and links",
  voice_model_build: "Voice builds", mirror_finetune: "Mirror Call learning",
  erasure: "Erasure",
};

const VOICE_DRAFT_REVIEW = {
  review: {
    replica_id: FIXTURE_REPLICA.replica_id,
    self_test_mode: true,
    sources: [], jobs: [], attempts: [], artifacts: [], evidence: [], builds: [],
    voice_genomes: [{
      version: 2, status: "draft", source_set_hash: "1".repeat(64), manifest_hash: "2".repeat(64),
      builder_version: "layout-fixture", embedding_families: 1, target_segments: 1,
      enrollment_artifacts: 1, created_at: "2026-08-28T08:00:00.000Z",
    }],
    voice_genome_readiness: {
      ready: true, blockers: [], reviewed_real_evidence: 1, embedding_families: 1,
      voice_measurements: 1, quality_measurements: 1, speaker_segments: 1,
    },
  },
};

const SCENARIOS: Record<string, Partial<typeof ROUTES>> = {
  // Nothing uploaded yet. The base table already is this scenario; listed
  // for symmetry so `?scenario=empty` and no param at all are the same page.
  empty: {},

  // The two states a static empty fixture cannot reach. Both mount the real
  // owner panel with a real draft shape; installStubFetch supplies either the
  // protected audio receipt or the server's honest 202 warming contract.
  "voice-ready": { "/api/replica-review": VOICE_DRAFT_REVIEW },
  "voice-warming": { "/api/replica-review": VOICE_DRAFT_REVIEW },

  // An audio upload is mid-pipeline. Proves the status banner is visible
  // without a scroll on Feed, and that the pager on Feed does not push
  // forward into a Meet step with nothing on it yet.
  processing: {
    "/api/replica-source": {
      sources: [{
        source_id: "src-processing-0001", replica_id: FIXTURE_REPLICA.replica_id,
        kind: "audio", capture_mode: "upload", mime: "audio/mpeg", byte_size: 34_512_000,
        state: "processing", contains_third_parties: false, rejection_code: "",
        created_at: "2026-08-26T18:40:00.000Z", updated_at: "2026-08-26T18:41:00.000Z",
      }],
    },
    "/api/replica-activity": {
      replica_id: FIXTURE_REPLICA.replica_id,
      generated_at: "2026-08-26T18:45:00.000Z",
      jobs: [{
        job_id: "upload_processing:src-processing-0001", ref: "src-processing-0001",
        lane: "upload_processing", subject: "lecture-recording.mp3", state: "running",
        state_reason: "Separating your voice from background noise.",
        started_at: "2026-08-26T18:41:00.000Z", updated_at: "2026-08-26T18:44:30.000Z",
        finished_at: null, progress: { done: 5, total: 8, unit: "steps" },
        next_action: { kind: "wait", label: "Runs automatically" },
      }],
      lanes: ACTIVITY_LANES.map((lane) => ({ lane, label: LANE_LABELS[lane], deployed: true, missing: [] })),
      in_flight: true,
      next_poll_ms: 4000,
    },
    "/api/replica-runtime": {
      runtime: {
        replica_id: FIXTURE_REPLICA.replica_id, lifecycle: "consent_pending", active: false,
        can_activate: false,
        blockers: ["identity_verification_required", "liveness_verification_required", "voice_genome_not_approved", "voice_not_ready"],
        qualification: { passed: 0, required: 7 },
        versions: { profile: null, calibration: null, voice_genome: null },
        activated_at: null,
      },
    },
  },

  // The coordinator's exact production case: all eight processing steps
  // complete, identity AND liveness verified, and NO voice genome or build
  // queued at all. Proves the rail and "Preview my voice" both now say
  // "you" (go review and approve) rather than "us".
  "review-pending": {
    "/api/replica": {
      replicas: [{ ...FIXTURE_REPLICA, age_verified: true, identity_verified: true, liveness_verified: true }],
      replica: { ...FIXTURE_REPLICA, age_verified: true, identity_verified: true, liveness_verified: true },
    },
    "/api/replica-source": {
      sources: [{
        source_id: "src-ready-0001", replica_id: FIXTURE_REPLICA.replica_id,
        kind: "audio", capture_mode: "upload", mime: "audio/mpeg", byte_size: 34_512_000,
        state: "ready", contains_third_parties: false, rejection_code: "",
        created_at: "2026-08-26T14:00:00.000Z", updated_at: "2026-08-26T14:20:00.000Z",
      }],
    },
    "/api/replica-activity": {
      replica_id: FIXTURE_REPLICA.replica_id,
      generated_at: "2026-08-26T18:45:00.000Z",
      jobs: [{
        job_id: "upload_processing:src-ready-0001", ref: "src-ready-0001",
        lane: "upload_processing", subject: "lecture-recording.mp3", state: "done",
        state_reason: "Processed. This recording is ready to use.",
        started_at: "2026-08-26T14:00:00.000Z", updated_at: "2026-08-26T14:20:00.000Z",
        finished_at: "2026-08-26T14:20:00.000Z", progress: { done: 8, total: 8, unit: "steps" },
        next_action: { kind: "none", label: null },
      }],
      lanes: ACTIVITY_LANES.map((lane) => ({ lane, label: LANE_LABELS[lane], deployed: true, missing: [] })),
      in_flight: false,
      next_poll_ms: null,
    },
    "/api/replica-runtime": {
      runtime: {
        replica_id: FIXTURE_REPLICA.replica_id, lifecycle: "consent_pending", active: false,
        can_activate: false,
        // Identity and liveness are DONE here (the replica record above says
        // so), so the runtime does not report those two. What is left is
        // exactly the coordinator's report: no genome, nothing queued.
        blockers: ["voice_genome_not_approved", "voice_not_ready"],
        qualification: { passed: 0, required: 7 },
        versions: { profile: null, calibration: null, voice_genome: null },
        activated_at: null,
      },
    },
  },

  // WS-R72. A published Room, so the Share tab's `ShowcaseCard` mounts at
  // all - the base fixture's `/api/room-publish` answers `{ room: null,
  // reason: "not_created" }` on purpose (`RoomStudio.tsx`'s own "shown
  // whenever there is no room yet" comment), which is exactly why this Room
  // has never rendered under the layout gate before this scenario existed.
  // `check-layout.mjs`'s own "deploy-picker" step opens the picker with a
  // REAL CLICK on `[data-picker-open="1"]` rather than a second flag pre-
  // opening it (`context/rejected.md`'s WS-R43 law, restated for a new
  // control rather than a Room dialog).
  "showcase-picker": {
    "/api/room-publish": {
      room: {
        room_id: "fixture-room-0001", slug: "anjali-physics", display_name: "Anjali Physics",
        free_monthly_messages: 20, paid_monthly_messages: 400, paid_monthly_voice_seconds: 1_800,
        default_locale: "en", one_line_bio: "JEE physics, one topic a day.",
        listed: true, listed_at: "2026-08-20T09:00:00.000Z",
        published: true, paused: false,
        published_at: "2026-08-15T09:00:00.000Z", paused_at: null,
        created_at: "2026-08-01T09:00:00.000Z", updated_at: "2026-08-20T09:00:00.000Z",
        telegram_deep_link: null,
      },
      reason: null,
      can_publish: true,
      blockers: { waiting_on_you: [], waiting_on_us: [] },
      showcase: [],
    },
  },
};

function installStubFetch() {
  const params = new URLSearchParams(window.location.search);
  const scenarioName = params.get("scenario") || "empty";
  const scenario = SCENARIOS[scenarioName] ?? {};
  const routes: Record<string, unknown> = { ...ROUTES, ...scenario };
  window.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(raw, window.location.origin).pathname;
    if (path === "/api/voice-preview" && scenarioName === "voice-warming") {
      return new Response(JSON.stringify({
        state: "warming", stage: "runtime_cold",
        message: "Your voice runtime is starting up. This takes about 2 to 5 minutes from cold.",
        eta_seconds_low: 120, eta_seconds_high: 300, retry_after_ms: 30_000,
      }), { status: 202, headers: { "content-type": "application/json" } });
    }
    if (path === "/api/voice-preview" && scenarioName === "voice-ready") {
      // Header plus 64 bytes of silent PCM. Playback is not the fixture's job;
      // the valid audio shape lets the real client reach its protected result.
      const wav = new Uint8Array(108);
      const view = new DataView(wav.buffer);
      for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
        for (let index = 0; index < text.length; index += 1) wav[offset + index] = text.charCodeAt(index);
      }
      view.setUint32(4, 100, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 64, true);
      return new Response(wav, {
        status: 200,
        headers: {
          "content-type": "audio/wav",
          "x-vyakti-generation": "fixture-generation-0001",
          "x-vyakti-disclosure": "audible-prefix-v1",
          "x-vyakti-model-commitment": "3".repeat(64),
          "x-vyakti-text-plan": "4".repeat(64),
          "x-vyakti-text-transformations": "2",
          "x-vyakti-spoken-text": encodeURIComponent("नमस्ते, यह एक सुरक्षित परीक्षण है।"),
        },
      });
    }
    const body = Object.prototype.hasOwnProperty.call(routes, path) ? routes[path] : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function seedAuth() {
  const KEY = "meera.state.v1";
  let state: Record<string, unknown> = {};
  try {
    state = JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    state = {};
  }
  // Not a credential. The fetch stub above never reaches a network, so this
  // string is only ever read back by our own code as "somebody is signed in".
  state.auth = {
    accessToken: "layout-fixture-not-a-token",
    refreshToken: "layout-fixture-not-a-token",
    expiresAt: Date.now() + 3_600_000,
    email: "teacher@example.edu",
  };
  localStorage.setItem(KEY, JSON.stringify(state));
}

const root = document.getElementById("studio-root")!;
if (!LOOPBACK.has(window.location.hostname)) {
  root.textContent = "This page runs only on a local test server.";
} else {
  installStubFetch();
  seedAuth();
  // The Hindi table is its own chunk (`src/studio/hiCopy.ts`, the WS-R71
  // merge): install it through the app's own loader BEFORE the glyph list is
  // built or the app mounts, so the gate's `__STUDIO_HI_STRINGS__` is the
  // real table and a `?lang=hi` fixture paints Hindi on its first frame.
  void loadStudioCopy("hi").then(() => {
    // WS-R52: the live copy table, exposed exactly as `src/room/layoutFixture.tsx`
    // exposes `ROOM_COPY_TABLE.hi` -- never a list re-typed in this file.
    window.__STUDIO_HI_STRINGS__ = (() => {
      const out: [string, string][] = [];
      flattenHiStrings(STUDIO_COPY_TABLE.hi, "", out);
      return out;
    })();
    // No StrictMode. Its double render is right for finding effect bugs and wrong
    // for a layout gate, which wants one settled paint to measure.
    ReactDOM.createRoot(root).render(<StudioApp />);
  });
}
