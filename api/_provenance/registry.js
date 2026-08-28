import { createAzureProtectionAdapters } from "./providers/azure-protection.js";
import { createNeonProvenanceLedger } from "./providers/neon-ledger.js";

// Production protection is all-or-nothing. Configuration, HMAC transport,
// AudioSeal, C2PA/Key Vault and the database ledger must all resolve before a
// provider byte can reach a caller. There is deliberately no local/fake
// fallback in this registry.
export function createProductionProtectionAdapters({ db, env = process.env, fetchImpl = fetch } = {}) {
  try {
    return Object.freeze({
      ...createAzureProtectionAdapters({ db, env, fetchImpl }),
      ledger: createNeonProvenanceLedger(db),
    });
  } catch (cause) {
    if (cause?.code) throw cause;
    throw Object.assign(new Error("protection_adapters_unavailable"), {
      code: "protection_adapters_unavailable",
      status: 503,
      cause,
    });
  }
}
