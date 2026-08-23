// Production protection adapters are intentionally explicit. A missing real
// watermark, C2PA signer or protected signing key is a hard no-output state,
// never a fall-through to unmarked audio or deterministic fixtures.
export function createProductionProtectionAdapters() {
  throw Object.assign(new Error("protection_adapters_unavailable"), {
    code: "protection_adapters_unavailable",
    status: 503,
  });
}
