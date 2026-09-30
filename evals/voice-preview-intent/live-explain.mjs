// Read-only parser gate for the durable claim statement. Run only after
// migration 067 is applied. EXPLAIN without ANALYZE plans the INSERT/UPDATE
// CTE but executes none of it.
import { createHash, randomUUID } from "node:crypto";
import { q } from "../../api/_db.js";
import { beginOwnedVoicePreview } from "../../api/_replica-voice-preview.js";
import { buildVoiceTextPlan, voiceTextPlanAudit } from "../../api/_voice/hindi-text-frontend.js";

const [present] = await q(
  "select to_regclass($1) is not null as present",
  ["public.vy_replica_voice_preview_intent"],
  10_000,
);
if (present?.present !== true) {
  console.log("SKIP live voice-preview intent EXPLAIN: migration 067 is not applied");
  process.exit(2);
}

const text = "Namaste, this is a private preview.";
const plan = buildVoiceTextPlan({ text, languageId: "hi" });
const sentinel = Object.freeze({ code: "explain_complete" });
let planned = null;
try {
  await beginOwnedVoicePreview(async (sql, params) => {
    planned = await q(`explain (format json) ${sql}`, params, 30_000);
    throw sentinel;
  }, randomUUID(), {
    replica_id: randomUUID(),
    genome_version: 1,
    trace_id: `explain_${randomUUID().replaceAll("-", "")}`,
    language_id: "hi",
    text_hash: createHash("sha256").update(text, "utf8").digest("hex"),
    text_language_mode: "latin_only",
    text_frontend: voiceTextPlanAudit(plan),
    style_key: "identity_anchor",
    output_storage_bucket: "preview-explain-only",
  });
} catch (error) {
  if (error !== sentinel) throw error;
}
if (!planned?.[0]?.["QUERY PLAN"]) throw new Error("voice_preview_intent_explain_missing");
console.log("ok live Neon read-only EXPLAIN parsed durable voice-preview intent claim");
