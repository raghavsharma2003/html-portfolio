// POST /api/voice-preview — the studio's "Preview my voice" panel.
//
// A thin adapter. Every decision lives in `api/_voice/preview-panel.js`, which
// takes its collaborators as arguments so the eval suite can drive the whole
// state machine with no credentials; this file is the only place the real
// database, bucket, HMAC provider and protection ledger are wired to it.
//
// Identity comes from `requireUser` and nowhere else. `replica_id` in the body
// is a claim that the SQL fence in `beginOwnedVoicePreview` either accepts for
// this owner or refuses — it is never treated as proof.
import { createHash, randomUUID } from "node:crypto";
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  REPLICA_STORAGE_WRITE_BUCKET,
  deleteReplicaObject,
  readPrivateReplicaObject,
  writeImmutableReplicaArtifact,
} from "./_replica-storage.js";
import {
  acquireVoicePreviewSourceStorageWriter,
  releaseSourceStorageWriter,
  renewSourceStorageWriter,
} from "./_replica-storage-writer.js";
import { createProductionProtectionAdapters } from "./_provenance/registry.js";
import { protectReplicaStream } from "./_provenance/delivery.js";
import { createOpenChatterboxPreviewProvider } from "./_voice/providers/open-chatterbox-preview.js";
import { handleVoicePreviewPanel } from "./_voice/preview-panel.js";
import { markVoicePreviewResultDeleted } from "./_voice-preview-result-cleanup.js";
import { voiceWarmth } from "./_voice/warmup.js";
import {
  beginOwnedVoicePreview,
  createNeonVoicePreviewLedger,
  expireVoicePreviewIntent,
  markVoicePreviewAborted,
  markVoicePreviewFailed,
  markVoicePreviewIntentRetryable,
  markVoicePreviewIntentFailed,
  markVoicePreviewIntentWarming,
  renewVoicePreviewIntentLease,
  sealVoicePreviewIntent,
} from "./_replica-voice-preview.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Expose-Headers",
    "X-Vyakti-Generation, X-Vyakti-Preview-Intent, X-Vyakti-Preview-Reused, X-Vyakti-Disclosure, X-Vyakti-Model-Commitment, X-Vyakti-Voice-Model-Arm, X-Vyakti-Voice-Quality-State, X-Vyakti-Voice-Quality-Warnings, X-Vyakti-Voice-Effective-Cfg, X-Vyakti-Text-Plan, X-Vyakti-Text-Transformations, X-Vyakti-Spoken-Text, Retry-After");
  res.setHeader("Cache-Control", "no-store");
}

// Testable provider-boundary seam. A timeout intentionally does not release
// the writer authority: the provider may acknowledge late, and source erasure
// must continue waiting until the durable not-after before its final sweep.
export async function storeVoicePreviewResult(db, ownerUserId, started, bodyBytes, signal, deps = {}) {
  signal?.throwIfAborted?.();
  const acquireWriter = deps.acquireWriter || acquireVoicePreviewSourceStorageWriter;
  const renewWriter = deps.renewWriter || renewSourceStorageWriter;
  const writeArtifact = deps.writeArtifact || writeImmutableReplicaArtifact;
  const storageBucket = started.generation.preview_result_storage_bucket;
  const objectPath = started.generation.preview_result_object_path;
  const sha256 = createHash("sha256").update(bodyBytes).digest("hex");
  let storageWriter = await acquireWriter(db, ownerUserId, started);
  const stored = await writeArtifact({
    storageBucket,
    objectPath,
    mime: "audio/wav",
    body: bodyBytes,
    expectedSha256: sha256,
    ifNoneMatch: "*",
  }, {
    maxBytes: 64 * 1024 * 1024,
    timeoutMs: 60_000,
    signal,
    beforeWriteRequest: async () => {
      storageWriter = await renewWriter(db, storageWriter);
    },
  });
  signal?.throwIfAborted?.();
  return Object.freeze({ storageBucket, objectPath, storageWriter, ...stored });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ state: "error", error: "POST only" });
  // Per-IP first, so an unauthenticated flood cannot reach Supabase either.
  // Durable SQL intent admission is now the GPU-money guard. This outer limit
  // only absorbs unauthenticated floods, so it must leave room for several
  // phones behind one household or school NAT to observe their own intents.
  if (!allow(ipOf(req), "voice_preview_panel_ip", 60)) {
    return res.status(429).json({ state: "error", error: "slow_down" });
  }

  const aborter = new AbortController();
  req.on?.("aborted", () => aborter.abort(new Error("client_aborted")));
  const deadline = setTimeout(() => aborter.abort(new Error("voice_preview_timeout")), 240_000);
  try {
    const user = await requireUser(req);
    const body = req.body || {};
    // Two buckets on purpose. `status` is cheap and the UI polls it while a
    // wake is in flight; `preview` is GPU money and gets four per minute.
    const bucket = String(body.op || "preview") === "status" ? "voice_preview_panel_status" : "voice_preview_panel_run";
    if (!allow(user.id, bucket, 30)) {
      return res.status(429).json({ state: "error", error: "slow_down" });
    }

    // Resolve deployment configuration only after the SQL ownership fence.
    let provider;
    const result = await handleVoicePreviewPanel(body, {
      origin: process.env.AZURE_OPEN_VOICE_ORIGIN,
      outputStorageBucket: REPLICA_STORAGE_WRITE_BUCKET,
      warmth: voiceWarmth,
      traceId: `panel_${randomUUID().replaceAll("-", "")}`,
      signal: aborter.signal,
      get provider() { return provider ||= createOpenChatterboxPreviewProvider(); },
      authorize: (input) => beginOwnedVoicePreview(q, user.id, input),
      markAborted: (generationId, reason) => markVoicePreviewAborted(q, user.id, generationId, reason),
      markFailed: (generationId, error) => markVoicePreviewFailed(q, user.id, generationId, error),
      markWarming: (started, reason) => markVoicePreviewIntentWarming(q, user.id, started, reason),
      markRetryable: (started, error) => markVoicePreviewIntentRetryable(q, user.id, started, error),
      markTerminal: (started, error) => markVoicePreviewIntentFailed(q, user.id, started, error),
      renewIntent: (started) => renewVoicePreviewIntentLease(q, user.id, started),
      sealIntent: async (started, resultInput) => {
        const sealed = await sealVoicePreviewIntent(q, user.id, started, resultInput);
        if (resultInput?.storageWriter) {
          // The result is now durably bound to its intent. A failed release is
          // safe and only delays erasure until the authority expires.
          await releaseSourceStorageWriter(q, resultInput.storageWriter).catch(() => false);
        }
        return sealed;
      },
      expireIntent: (started) => expireVoicePreviewIntent(q, user.id, started),
      deleteResult: (locator) => deleteReplicaObject({
        storageBucket: locator.storageBucket,
        objectPath: locator.objectPath,
      }),
      markResultDeleted: (started, locator) => markVoicePreviewResultDeleted(q, {
        intentId: started.intent.intentId,
        replicaId: started.generation.replica_id,
        ownerUserId: user.id,
        generationId: started.generation.generation_id,
        storageBucket: locator.storageBucket,
        objectPath: locator.objectPath,
      }),
      readObject: (locator) => readPrivateReplicaObject(locator, {
        maxBytes: 20 * 1024 * 1024,
        timeoutMs: 30_000,
      }),
      readResult: (locator) => readPrivateReplicaObject(locator, {
        maxBytes: 64 * 1024 * 1024,
        timeoutMs: 30_000,
      }),
      storeResult: async (started, bodyBytes) => {
        // The source id in this prefix is server-selected by the owner fence.
        // Source erasure can find and remove this derivative before the intent
        // and generation rows are cascaded.
        return storeVoicePreviewResult(q, user.id, started, bodyBytes, aborter.signal);
      },
      protect: (input) => protectReplicaStream({
        ...input,
        adapters: Object.freeze({ ...createProductionProtectionAdapters({ db: q }), ledger: createNeonVoicePreviewLedger(q) }),
      }),
    });

    for (const [name, value] of Object.entries(result.headers || {})) res.setHeader(name, value);
    if (result.kind === "audio") {
      res.setHeader("Content-Length", String(result.body.length));
      return res.status(result.status).send(result.body);
    }
    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ state: "error", error: error.code });
    // Provider construction fails closed when the origin or the HMAC secret is
    // absent. That is a deployment fact, not a cold start, and says so.
    const code = String(error?.code || "");
    // DEPLOYMENT ABSENCE IS A 503, AND IT IS A CLASS, NOT A LIST. The three
    // open_voice_* codes were enumerated here by name, so when the protection
    // adapters started refusing with `audio_protection_origin_required` the
    // route reported a missing environment variable as a server crash, which
    // is the exact contract ENV-MANIFEST.md §6 says it must not
    // ("protection adapters unavailable (503)"). Matching the SHAPE of a
    // configuration refusal covers the services that do not exist yet, which
    // is the only version of this that stays true.
    const configAbsent =
      /_(origin|secret|key|endpoint|url)_(required|invalid)$/.test(code) ||
      /_not_configured$/.test(code);
    if (configAbsent) {
      console.warn(`[voice-preview] not configured: ${code}`);
      return res.status(503).json({ state: "error", error: code });
    }
    // A refusal that CHOSE its own status and code is an answer, not a crash.
    // Flattening one into a 500 cost this lane its whole default path: the
    // panel omitted a style, the validator refused with a named 400, and the
    // owner was shown a server error with nothing in the logs to explain it.
    // The code is logged either way, because an operator who cannot see why a
    // production request failed will guess, and guessing is how the last one
    // stayed broken.
    // A 4xx is honoured whether or not the thrower named itself. Sixteen
    // validators in this codebase still throw a bare `{ status: 400 }`, and
    // requiring a code here would keep reporting every one of them as a server
    // crash. An unnamed refusal gets a stable fallback code so the client has
    // something to branch on and the log has something to grep.
    const status = Number(error?.status);
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      const named = code || "voice_preview_invalid_request";
      console.warn(`[voice-preview] refused ${status} ${named}`);
      // `blocker` rides along when the thrower knows WHOSE turn it is. The
      // preview refusal used to be one opaque word for fifteen preconditions,
      // which read as "you are not allowed" even when the truth was "we have
      // not finished building your voice". The panel needs the class to pick
      // the right voice, and the split is a law here rather than a nicety, so
      // it travels with the code instead of being re-guessed on the client.
      const blocker = error?.blockerClass;
      return res.status(status).json(
        blocker ? { state: "error", error: named, blocker } : { state: "error", error: named },
      );
    }
    console.error(`[voice-preview] failed: ${code || "unnamed"}`);
    return res.status(500).json({ state: "error", error: "voice_preview_failed" });
  } finally {
    clearTimeout(deadline);
  }
}

export const config = { maxDuration: 300 };
