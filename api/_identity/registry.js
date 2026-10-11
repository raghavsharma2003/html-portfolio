import { createAzureCompositeIdentityVerifier } from "./providers/azure-composite.js";

export function configuredIdentityVerifier(options = {}) {
  const env = options.env || process.env;
  const name = String(env.REPLICA_IDENTITY_VERIFIER || "").trim();
  if (!name) return null;
  if (name !== "azure_identity_composite") {
    throw Object.assign(new Error("identity_verifier_unsupported"), { code: "identity_verifier_unsupported", status: 503 });
  }
  return createAzureCompositeIdentityVerifier(options);
}
