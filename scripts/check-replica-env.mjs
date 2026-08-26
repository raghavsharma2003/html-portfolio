// Prints which replica/voice subsystems are LIVE, DARK, or BROKEN-HALFWAY in
// the current process env — the check `docs/gurukul/ENV-MANIFEST.md` exists
// to make possible. Read that file first; this script is its executable
// twin, not a replacement for it. Every var name and required-set below is
// sourced from the same file:line citations recorded there — if a subsystem
// here disagrees with the manifest, the manifest is the one that was
// verified against the actual consumer and this file has drifted.
//
//   node scripts/check-replica-env.mjs                 → report against process.env
//   node scripts/check-replica-env.mjs --strict         → same, but exit 1 if
//                                                          any subsystem is
//                                                          BROKEN-HALFWAY
//
// NEVER PRINTS A VALUE. Only names, and only whether each name is set — the
// same discipline scripts/write-config.mjs already holds, for the same
// reason: a log that leaks a key is worse than the deploy problem it exists
// to catch.
//
// Three states, and only the third one is interesting:
//   LIVE            every required var for this subsystem is set. The
//                   subsystem will actually construct/authorize at runtime.
//                   (This script does not validate VALUE shape — a malformed
//                   HMAC key or an unpinned "latest" model string still
//                   throws at the real call site; that is that code's job,
//                   not this preflight's.)
//   DARK            no required var for this subsystem is set. This is the
//                   expected, safe-by-default state for anything not yet
//                   turned on — matches SPEC-GURUKUL.md §4's "thoroughly
//                   built and thoroughly un-turned-on."
//   BROKEN-HALFWAY  SOME but not all required vars are set. This is the
//                   dangerous state the task exists to surface: a subsystem
//                   that LOOKS configured (someone set three of five vars)
//                   but throws 503 / 401 the instant real traffic hits it —
//                   worse than DARK, because DARK is visibly nothing and
//                   this looks like progress until it is exercised.
//
// WHY THIS IS NOT WIRED INTO verify-release.mjs: deploy configuration is a
// property of an ENVIRONMENT (which Vercel project, which Azure resource
// group, whose secrets are loaded into this shell right now), not of the
// TREE. verify-release.mjs's whole design point is gating the tree being
// shipped — the same commit must verify identically on every machine that
// checks it out, which is why it stubs api/_config.js with --stub rather
// than reading real secrets. Wiring a real env-state checker into that gate
// would make the gate's answer depend on whose laptop or which CI runner ran
// it, which is exactly the "verified against a frozen copy" failure shape
// `context/rejected.md#gates-that-live-nowhere` already warns about, just
// inverted: instead of gating a stale tree, it would gate a stale-or-
// irrelevant environment. This script is a human/operator preflight, run by
// hand before a deploy phase (see docs/gurukul/DEPLOY.md), not a CI gate.
// EXITS 0 UNCONDITIONALLY unless --strict is passed, for the same reason.

const args = process.argv.slice(2);
const strict = args.includes("--strict");

const env = process.env;
const has = (name) => typeof env[name] === "string" && env[name].length > 0;

/**
 * @param {object} def
 * @param {string} def.id
 * @param {string} def.target        deployment target this subsystem lives in
 * @param {string[]} def.required    var names that must ALL be set for LIVE
 *                                   (unless def.mode === "any")
 * @param {"all"|"any"} [def.mode]   "any": LIVE if at least one required var
 *                                   is set, DARK if none — no halfway state
 *                                   is possible for an OR-gate (used for
 *                                   CRON_SECRET / REPLICA_ERASURE_SECRET).
 * @param {{var:string, expected:string}} [def.switch]
 *                                   a gating var that must equal `expected`
 *                                   (case-sensitive literal, or "true" for a
 *                                   boolean flag) before `required` even
 *                                   applies. If the switch is unset, the
 *                                   subsystem is DARK regardless of the rest.
 *                                   If the switch is set to something OTHER
 *                                   than `expected`, that is itself a
 *                                   BROKEN-HALFWAY condition — the switch
 *                                   was touched but points nowhere the code
 *                                   accepts (see e.g. `identity_verifier_unsupported`).
 * @param {string} def.note
 */
function evaluate(def) {
  if (def.switch) {
    const switchVal = env[def.switch.var];
    const switchSet = typeof switchVal === "string" && switchVal.length > 0;
    if (!switchSet) {
      const anyRequiredSet = def.required.some(has);
      // The switch is the gate. If it's off but stray required vars are
      // set anyway, that is still worth flagging — those vars are inert
      // right now, but a later `git blame` reader deserves to know they
      // exist unused, not that the subsystem is cleanly dark.
      return anyRequiredSet
        ? { state: "BROKEN-HALFWAY", detail: `switch ${def.switch.var} unset, but ${def.required.filter(has).length}/${def.required.length} required vars ARE set (inert until the switch is set to "${def.switch.expected}")` }
        : { state: "DARK", detail: `switch ${def.switch.var} unset` };
    }
    if (switchVal !== def.switch.expected) {
      return { state: "BROKEN-HALFWAY", detail: `${def.switch.var} is set but not to the accepted value — provider construction will throw at runtime` };
    }
  }
  if (def.mode === "any") {
    const setCount = def.required.filter(has).length;
    return setCount > 0
      ? { state: "LIVE", detail: `${setCount}/${def.required.length} alternative(s) set` }
      : { state: "DARK", detail: "none set" };
  }
  const setCount = def.required.filter(has).length;
  const total = def.required.length;
  if (setCount === 0) return { state: "DARK", detail: "none set" };
  if (setCount === total) return { state: "LIVE", detail: `${setCount}/${total} set` };
  const missing = def.required.filter((n) => !has(n));
  return { state: "BROKEN-HALFWAY", detail: `${setCount}/${total} set — missing: ${missing.join(", ")}` };
}

// ── vercel-app subsystems (docs/gurukul/ENV-MANIFEST.md §1-15) ─────────────
const VERCEL_APP = [
  {
    id: "foundry_claim_extraction",
    required: ["AZURE_FOUNDRY_ENDPOINT", "AZURE_FOUNDRY_API_KEY", "AZURE_FOUNDRY_CLAIM_MODEL"],
    note: "WS-F ingestion's LLM claim pass (api/_claim-extraction/registry.js)",
  },
  {
    id: "foundry_dialogue_generation",
    required: ["AZURE_FOUNDRY_ENDPOINT", "AZURE_FOUNDRY_API_KEY", "AZURE_FOUNDRY_DIALOGUE_MODEL"],
    note: "WS-E sheet-authoring assist (api/_dialogue/registry.js)",
  },
  {
    id: "foundry_spend_budget",
    required: ["AZURE_REPLICA_APP_BUDGET_USD", "AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS", "AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS"],
    note: "fences both foundry subsystems above (api/_provider-budget.js reserveFoundrySpend)",
  },
  {
    id: "identity_verification",
    switch: { var: "REPLICA_IDENTITY_VERIFIER", expected: "azure_identity_composite" },
    required: ["AZURE_COMPOSITE_IDENTITY_ENABLED", "AZURE_IDENTITY_REVIEW_PATH_APPROVED", "AZURE_COMPOSITE_IDENTITY_ENDPOINT", "AZURE_COMPOSITE_IDENTITY_HMAC_KEY_B64", "AZURE_COMPOSITE_IDENTITY_VERSION"],
    note: "Studio identity check + api/replica-identity-sweep.js — AZURE_IDENTITY_REVIEW_PATH_APPROVED must stay false until the (currently nonexistent) review service is built, see ENV-MANIFEST §22",
  },
  {
    id: "liveness_verification",
    switch: { var: "REPLICA_LIVENESS_VERIFIER", expected: "azure_face_speech_composite" },
    required: ["AZURE_COMPOSITE_LIVENESS_ENABLED", "AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED", "AZURE_COMPOSITE_LIVENESS_ENDPOINT", "AZURE_COMPOSITE_LIVENESS_HMAC_KEY_B64", "AZURE_COMPOSITE_LIVENESS_VERSION"],
    note: "api/replica-liveness-sweep.js — Microsoft Limited Access gated (AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED)",
  },
  {
    id: "face_session_broker",
    switch: { var: "REPLICA_FACE_SESSION_BROKER", expected: "azure_face_liveness_quicklink" },
    required: ["AZURE_FACE_SESSION_BROKER_ENABLED", "AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED", "AZURE_FACE_DEDICATED_RESOURCE", "AZURE_FACE_SESSION_BROKER_ORIGIN", "AZURE_FACE_SESSION_BROKER_HMAC_KEY_B64", "AZURE_FACE_DEVICE_CORRELATION_HMAC_KEY_B64", "AZURE_FACE_SESSION_BROKER_VERSION", "AZURE_FACE_LIVENESS_MODEL_VERSION"],
    note: "api/replica-face-session-sweep.js + the erasure sweep's Face-fenced cleanup",
  },
  {
    id: "provenance_protection_client",
    required: ["AZURE_AUDIO_PROTECTION_ORIGIN", "AZURE_AUDIO_PROTECTION_HMAC_SECRET", "REPLICA_WATERMARK_TOKEN_SECRET", "REPLICA_COMMITMENT_SECRET"],
    note: "watermark/C2PA client (api/_provenance/registry.js) — \"all-or-nothing\" by the registry's own doc comment, no local/fake fallback",
  },
  {
    id: "voice_azure_personal_voice",
    required: ["AZURE_PERSONAL_VOICE_ENABLED", "AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED", "AZURE_PERSONAL_VOICE_ENDPOINT", "AZURE_PERSONAL_VOICE_TTS_ENDPOINT", "AZURE_PERSONAL_VOICE_KEY", "AZURE_PERSONAL_VOICE_PROJECT_ID", "AZURE_PERSONAL_VOICE_COMPANY_NAME", "AZURE_PERSONAL_VOICE_BASE_MODEL"],
    note: "Microsoft Limited Access gated — also needs replica_storage LIVE (shares SUPABASE_URL) to actually create a voice",
  },
  {
    id: "voice_personal_voice_budget",
    required: ["AZURE_REPLICA_APP_BUDGET_USD", "AZURE_PERSONAL_VOICE_USD_PER_PROFILE", "AZURE_PERSONAL_VOICE_SYNTHESIS_USD_PER_MCHARACTERS"],
    note: "fences voice_azure_personal_voice's training + synthesis spend",
  },
  {
    id: "voice_chatterbox_preview",
    required: ["AZURE_OPEN_VOICE_ORIGIN", "OPEN_VOICE_HMAC_SECRET"],
    note: "api/replica-voice-preview.js — the approval-FREE voice lane; also needs provenance_protection_client and replica_storage LIVE to deliver end to end",
  },
  {
    // WS-I, the stays-current loop. Both halves are needed before
    // /api/channel-ingest-sweep does anything: with either dark it answers
    // {ok:true, disabled:true} rather than half-working.
    id: "channel_watch_youtube",
    required: ["YOUTUBE_OAUTH_CLIENT_ID", "YOUTUBE_OAUTH_CLIENT_SECRET"],
    note: "api/_channel/registry.js — new-video detection. The teacher's refresh token is NOT an env var: vy_channel_watch stores a uuid grant REF and the provider takes an injected grant store",
  },
  {
    id: "asr_self_hosted",
    required: ["ASR_SELF_HOSTED_ORIGIN", "ASR_HMAC_SECRET"],
    note: "api/_asr/providers/self-hosted.js — the in-house ASR lane (SPEC §8 item 1). Preferred over Sarvam whenever LIVE",
  },
  {
    // "any" because SARVAM_API_KEY alone is a working lane — the model and
    // origin have defaults. A halfway state is not reachable here and
    // pretending otherwise would print a warning that can never be acted on.
    id: "asr_sarvam",
    mode: "any",
    required: ["SARVAM_API_KEY"],
    note: "api/_asr/registry.js (mirror-call, channel ingest) picks this when asr_self_hosted is DARK. The processing-worker DAG's `transcribe` step (api/_replica-processing/providers/sarvam-transcription.js, WS-AN 2026-08-26) goes straight to Sarvam regardless of asr_self_hosted, by design — see that file's header. NOT spend-fenced: ingestion-research.md §3's pricing sources conflict by 3x and the real rate must be confirmed before the first paid run",
  },
  {
    id: "voice_evidence_client",
    required: ["AZURE_VOICE_EVIDENCE_ORIGIN", "AZURE_VOICE_EVIDENCE_HMAC_SECRET"],
    note: "api/_replica-processing/providers/azure-voice-evidence.js, called from the processing pipeline",
  },
  {
    id: "fast_transcription_budget",
    required: ["AZURE_REPLICA_APP_BUDGET_USD", "AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR"],
    note: "fenced Azure Speech fast-transcription spend. Dormant since WS-AN (2026-08-26): `transcribe` runs through Sarvam now, whose adapter sets no billing meter, so worker.js's `azure_speech_audio_ms` reservation path never fires. Left checked in case Azure Fast Transcription is ever reintroduced as a second lane",
  },
  {
    id: "replica_storage",
    required: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    note: "api/_replica-storage.js — the private bucket every replica subsystem reads/writes through",
  },
  {
    id: "kek_provider_consent",
    required: ["REPLICA_PROVIDER_CONSENT_KEK_ID", "REPLICA_PROVIDER_CONSENT_KEK_B64"],
    note: "api/_replica-provider-consent-crypto.js",
  },
  {
    id: "kek_feedback",
    required: ["REPLICA_FEEDBACK_KEK_ID", "REPLICA_FEEDBACK_KEK_B64"],
    note: "api/_replica-feedback-crypto.js",
  },
  {
    id: "kek_candidate_eval",
    required: ["REPLICA_EVAL_KEK_ID", "REPLICA_EVAL_KEK_B64"],
    note: "api/_replica-candidate-eval-crypto.js",
  },
  {
    id: "erasure_finalizer",
    required: ["REPLICA_ERASURE_RECEIPT_KEY_B64", "REPLICA_BACKUP_RETENTION_DAYS"],
    note: "api/_replica-full-erasure.js — earlier sweep steps (prepare, provider cleanup) can still run without this; only the finalizer fails",
  },
  {
    id: "cron_auth_shared",
    required: ["CRON_SECRET"],
    note: "authenticates 4 of 5 replica cron sweeps directly via process.env — deliberately NOT baked by scripts/write-config.mjs, see ENV-MANIFEST §15. Vercel-env-only.",
  },
  {
    id: "erasure_sweep_auth",
    mode: "any",
    required: ["CRON_SECRET", "REPLICA_ERASURE_SECRET"],
    note: "api/replica-erasure-sweep.js accepts EITHER — an OR-gate, so no halfway state is possible here",
  },
];

// ── standalone service subsystems (ENV-MANIFEST §16-20) — each is a
//    DIFFERENT deployment's env. Checking these against your local shell's
//    env only means something if you've loaded THAT service's env into it
//    (e.g. before running its own start command). Included for completeness
//    of the "what would light up" answer, not because one process env can
//    hold all six deployments' secrets at once. ──────────────────────────
const SERVICES = [
  {
    id: "svc_azure_verifier_core",
    target: "azure-verifier",
    required: ["VYAKTI_PRIVATE_SOURCE_ORIGIN", "VYAKTI_BROKER_HMAC_KEY_B64", "VERIFIER_VERSION", "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "AZURE_DOCUMENT_INTELLIGENCE_KEY", "AZURE_FACE_ENDPOINT", "AZURE_FACE_KEY", "AZURE_DOCUMENT_REVIEW_ENDPOINT", "AZURE_DOCUMENT_REVIEW_HMAC_KEY_B64", "AZURE_DOCUMENT_REVIEW_VERSION"],
    note: "services/azure-verifier — AZURE_DOCUMENT_REVIEW_ENDPOINT points at a review service that does not exist in this tree yet (ENV-MANIFEST §24)",
  },
  {
    id: "svc_azure_verifier_liveness",
    target: "azure-verifier",
    switch: { var: "AZURE_FACE_LIVENESS_ENABLED", expected: "true" },
    required: ["AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED", "AZURE_FACE_DEDICATED_RESOURCE", "AZURE_FACE_LIVENESS_MODEL_VERSION", "AZURE_FACE_VERIFY_CONFIDENCE_THRESHOLD", "AZURE_FACE_LIVENESS_SESSION_TTL_SECONDS", "AZURE_LIVENESS_SESSION_SEAL_KEY_B64", "VYAKTI_PUBLIC_APP_ORIGIN"],
    note: "services/azure-verifier's liveness-with-verify path — README ships AZURE_FACE_LIVENESS_ENABLED=false by default",
  },
  {
    id: "svc_voice_evidence",
    target: "voice-evidence",
    required: ["AZURE_VOICE_EVIDENCE_HMAC_SECRET"],
    note: "services/voice-evidence — fails RuntimeError at startup without this",
  },
  {
    id: "svc_audio_protection",
    target: "audio-protection",
    required: ["AZURE_AUDIO_PROTECTION_HMAC_SECRET", "AZURE_KEY_VAULT_KEY_ID", "C2PA_SIGN_CERTIFICATE_B64", "PUBLIC_APP_ORIGIN"],
    note: "services/audio-protection — fail-closed startup, no public ingress",
  },
  {
    id: "svc_open_voice_runtime",
    target: "open-voice-runtime",
    required: ["OPEN_VOICE_HMAC_SECRET", "OPEN_VOICE_RUNTIME_ORIGIN"],
    note: "services/open-voice-runtime's broker.py — the GPU app itself is never internet-reachable, this is the admission broker's config",
  },
  {
    id: "svc_processing_worker",
    target: "processing-worker",
    required: ["NEON_URL", "SARVAM_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AZURE_VOICE_EVIDENCE_ORIGIN", "AZURE_VOICE_EVIDENCE_HMAC_SECRET"],
    note: "services/replica-processing-worker — Container Apps Job, reuses api/_replica-processing/* and api/_replica-storage.js directly. SARVAM_API_KEY as of WS-AN (2026-08-26): `transcribe` no longer needs AZURE_SPEECH_ENDPOINT/AZURE_SPEECH_KEY, which this subscription has never had (zero Cognitive Services accounts)",
  },
];

function report(section, defs, target) {
  console.log(`\n── ${section} ──`);
  const rows = defs.map((def) => ({ def, result: evaluate(def) }));
  for (const { def, result } of rows) {
    const tag = result.state === "LIVE" ? " LIVE " : result.state === "DARK" ? " DARK " : "BROKEN";
    console.log(`${tag}  ${def.id.padEnd(30)} ${result.detail}`);
    if (def.note) console.log(`        ${def.note}`);
  }
  return rows;
}

console.log("Replica/voice env preflight — never prints a value, only names and presence.");
console.log(`Checked against: this process's env (${Object.keys(env).length} vars total in it, most irrelevant here)`);

const allRows = [
  ...report("vercel-app subsystems (ENV-MANIFEST §1-15)", VERCEL_APP),
  ...report("standalone-service subsystems (ENV-MANIFEST §16-20) — only meaningful if THIS service's env is loaded", SERVICES),
];

const counts = { LIVE: 0, DARK: 0, "BROKEN-HALFWAY": 0 };
for (const { result } of allRows) counts[result.state]++;
const broken = allRows.filter((r) => r.result.state === "BROKEN-HALFWAY");

console.log(
  `\n${allRows.length} subsystems checked: ${counts.LIVE} LIVE, ${counts.DARK} DARK, ${counts["BROKEN-HALFWAY"]} BROKEN-HALFWAY.`,
);
if (broken.length) {
  console.log(
    `\nBROKEN-HALFWAY subsystems (some-but-not-all required vars set — the dangerous state):\n` +
      broken.map((r) => `  - ${r.def.id}: ${r.result.detail}`).join("\n"),
  );
} else if (counts.LIVE === 0) {
  console.log("\nEverything DARK — expected in a checkout with no replica secrets loaded (this environment, most CI runs).");
}

if (strict && broken.length) {
  console.error(`\n--strict: ${broken.length} subsystem(s) BROKEN-HALFWAY — exiting 1.`);
  process.exit(1);
}
process.exit(0);
