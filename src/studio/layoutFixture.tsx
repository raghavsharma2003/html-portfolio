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
      "I hold the rights to the videos on it, so I can license their use for my own clone.",
      "I authorise this platform to take the audio from those videos and use it to build my own clone.",
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
  "/api/video-enroll": { enrollments: [] },
  "/api/mirror-call": { contract: null, call: null },
};

function installStubFetch() {
  window.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(raw, window.location.origin).pathname;
    const body = Object.prototype.hasOwnProperty.call(ROUTES, path) ? ROUTES[path] : {};
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
