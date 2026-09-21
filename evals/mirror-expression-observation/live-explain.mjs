import { q } from "../../api/_db.js";
import { createSettledMirrorExpressionRecords } from "../../api/_experience-compiler/mirror-expression.js";
import { settleMirrorWindow } from "../../api/_mirrorcall-store.js";

const OWNER = "20000000-0000-4000-8000-000000000002";
const REPLICA = "10000000-0000-4000-8000-000000000001";
const SOURCE = "30000000-0000-4000-8000-000000000003";
const SESSION = "40000000-0000-4000-8000-000000000004";
const WINDOW = "50000000-0000-4000-8000-000000000005";
const AGENT = "60000000-0000-4000-8000-000000000006";
const PERSON = "70000000-0000-4000-8000-000000000007";
const CONSENT = "80000000-0000-4000-8000-000000000008";

const expressionObservations = createSettledMirrorExpressionRecords({
  ownerUserId: OWNER,
  replicaId: REPLICA,
  sourceId: SOURCE,
  sourceSha256: "a".repeat(64),
  sourceByteSize: 576_044,
  sessionId: SESSION,
  windowId: WINDOW,
  agentId: AGENT,
  personId: PERSON,
  consentScopes: ["capture", "storage", "transcription"],
  consentId: CONSENT,
  consentScope: "training",
  consentGrantedAt: "2026-08-30T10:00:00.000Z",
  capturedAt: "2026-08-30T10:00:01.000Z",
  speakerVerification: "unverified",
  transcript: "mera subject vigyan hai today",
  transcriptConfidence: 0.82,
  durationMs: 12_000,
  wavProbe: { rms: 0.1 },
  asrProvider: "azure-speech-short",
  asrModel: "2025-10-15",
});

let parsed = false;
await settleMirrorWindow(async (sql, params) => {
  const rows = await q(`explain (format json) ${sql}`, params);
  if (!rows?.[0]?.["QUERY PLAN"]) throw new Error("mirror_expression_live_explain_missing_plan");
  parsed = true;
  return rows;
}, OWNER, REPLICA, WINDOW, {
  transcript: "mera subject vigyan hai today",
  provider: "azure-speech-short",
  model: "2025-10-15",
  evidence: [],
  expressionObservations,
});

if (!parsed || expressionObservations.length !== 5) throw new Error("mirror_expression_live_explain_incomplete");
console.log("ok live Neon read-only EXPLAIN parsed atomic Mirror settlement with four inferred mechanics and direct RMS energy");
