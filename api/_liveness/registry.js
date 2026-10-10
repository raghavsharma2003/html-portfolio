import { createAzureCompositeLivenessVerifier } from "./providers/azure-composite.js";
import { createModernSharedAudioLivenessVerifier } from "./azure-shared-audio.js";
import { createModernCaptureAuthorityLoader } from "./issued-authority.js";

export function configuredLivenessVerifier(options = {}) {
  const env = options.env || process.env;
  const name = String(env.REPLICA_LIVENESS_VERIFIER || "").trim();
  if (!name) return null;
  if (name !== "azure_face_speech_composite") {
    throw Object.assign(new Error("liveness_verifier_unsupported"), { code: "liveness_verifier_unsupported", status: 503 });
  }
  const authorityOptions = { ...options,
    ...(options.db && !options.loadAuthority ? { loadAuthority: createModernCaptureAuthorityLoader(options) } : {}) };
  return createModernSharedAudioLivenessVerifier(createAzureCompositeLivenessVerifier(options), authorityOptions);
}
