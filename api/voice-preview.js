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
import { randomUUID } from "node:crypto";
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { readPrivateReplicaObject } from "./_replica-storage.js";
import { createProductionProtectionAdapters } from "./_provenance/registry.js";
import { protectReplicaStream } from "./_provenance/delivery.js";
import { createOpenChatterboxPreviewProvider } from "./_voice/providers/open-chatterbox-preview.js";
import { handleVoicePreviewPanel } from "./_voice/preview-panel.js";
import { voiceWarmth } from "./_voice/warmup.js";
import {
  beginOwnedVoicePreview,
  createNeonVoicePreviewLedger,
  markVoicePreviewFailed,
} from "./_replica-voice-preview.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Expose-Headers",
    "X-Vyakti-Generation, X-Vyakti-Disclosure, X-Vyakti-Model-Commitment, X-Vyakti-Voice-Model-Arm, X-Vyakti-Voice-Quality-State, X-Vyakti-Voice-Quality-Warnings, X-Vyakti-Voice-Effective-Cfg, Retry-After");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ state: "error", error: "POST only" });
  // Per-IP first, so an unauthenticated flood cannot reach Supabase either.
  if (!allow(ipOf(req), "voice_preview_panel_ip", 12)) {
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
    if (!allow(user.id, bucket, bucket.endsWith("status") ? 20 : 4)) {
      return res.status(429).json({ state: "error", error: "slow_down" });
    }

    const provider = createOpenChatterboxPreviewProvider();
    const protection = createProductionProtectionAdapters({ db: q });
    const result = await handleVoicePreviewPanel(body, {
      origin: process.env.AZURE_OPEN_VOICE_ORIGIN,
      warmth: voiceWarmth,
      traceId: `panel_${randomUUID().replaceAll("-", "")}`,
      signal: aborter.signal,
      provider,
      authorize: (input) => beginOwnedVoicePreview(q, user.id, input),
      markFailed: (generationId, error) => markVoicePreviewFailed(q, user.id, generationId, error),
      readObject: (locator) => readPrivateReplicaObject(locator, {
        maxBytes: 20 * 1024 * 1024,
        timeoutMs: 30_000,
      }),
      protect: (input) => protectReplicaStream({
        ...input,
        adapters: Object.freeze({ ...protection, ledger: createNeonVoicePreviewLedger(q) }),
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
