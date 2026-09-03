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
  // No StrictMode. Its double render is right for finding effect bugs and wrong
  // for a layout gate, which wants one settled paint to measure.
  ReactDOM.createRoot(root).render(<StudioApp />);
}
