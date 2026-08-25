import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordOwnedVoicePreference, voicePreferencePairHash } from "../../api/_replica-voice-preference.js";
import { voicePreviewStyle } from "../../api/_replica-voice-preview.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IDS = {
  owner: "11111111-1111-4111-8111-111111111111",
  replica: "22222222-2222-4222-8222-222222222222",
  left: "33333333-3333-4333-8333-333333333333",
  right: "44444444-4444-4444-8444-444444444444",
  preference: "55555555-5555-4555-8555-555555555555",
  trial: "66666666-6666-4666-8666-666666666666",
};
let passed = 0;
function ok(name, condition) { assert.ok(condition, name); passed++; console.log(`  PASS ${name}`); }

const hash = voicePreferencePairHash(IDS.left, IDS.right);
ok("the pair commitment is position-invariant", hash === voicePreferencePairHash(IDS.right, IDS.left) && /^[0-9a-f]{64}$/.test(hash));
assert.throws(() => voicePreferencePairHash(IDS.left, IDS.left), /distinct_generations/);
ok("one generation cannot be compared with itself", true);

ok("preview conditions are a closed server-owned vocabulary", voicePreviewStyle("faithful").schema === "vyakti.voice-preview-style.v1" && voicePreviewStyle("expressive").temperature === 0.9);
assert.throws(() => voicePreviewStyle("client_custom"), /style_invalid/);
ok("arbitrary client synthesis controls are refused", true);

let sql = "";
let params = [];
const preference = await recordOwnedVoicePreference(async (statement, values) => {
  sql = statement; params = values;
  return [{
    preference_id: IDS.preference, replica_id: IDS.replica, genome_version: 7,
    left_generation_id: IDS.left, right_generation_id: IDS.right, choice: "left",
    reason_codes: ["identity", "rhythm"], confidence: "0.900", created_at: "2026-08-25T00:00:00.000Z",
    left_style_key: "faithful", right_style_key: "balanced",
  }];
}, IDS.owner, {
  replica_id: IDS.replica,
  left_generation_id: IDS.left,
  right_generation_id: IDS.right,
  trial_id: IDS.trial,
  choice: "left",
  reason_codes: ["rhythm", "identity", "identity"],
  confidence: 0.9,
});
ok("the owner decision is whitelist-built", preference.preference_id === IDS.preference && preference.confidence === 0.9 && preference.reason_codes.length === 2);
ok("ownership is derived outside the request body", params[1] === IDS.owner && !sql.includes("body.owner"));
ok("both candidates must be sealed protected Studio previews", /l\.state='sealed' and r\.state='sealed'/.test(sql) && /l\.purpose='voice_preview' and r\.purpose='voice_preview'/.test(sql));
ok("both candidates must occupy the server-assigned sides of one active trial", /l\.preview_trial_id=t\.trial_id/.test(sql) && /l\.preview_trial_side='left'/.test(sql) && /r\.preview_trial_side='right'/.test(sql) && /t\.state='issued'/.test(sql));
ok("a valid pair holds identity evidence and prompt constant", /l\.genome_version=r\.genome_version/.test(sql) && /l\.preview_artifact_id=r\.preview_artifact_id/.test(sql) && /l\.preview_text_hash=r\.preview_text_hash/.test(sql));
ok("a valid pair holds language and model constant", /l\.preview_language_id=r\.preview_language_id/.test(sql) && /l\.preview_model_commitment=r\.preview_model_commitment/.test(sql));
ok("a valid pair holds one positive sampling seed constant", /l\.preview_seed>0 and l\.preview_seed=r\.preview_seed/.test(sql));
ok("the only intended pair difference is a known delivery condition", /preview_style->>'key'<>r\.preview_style->>'key'/.test(sql) && /STYLE_KEYS/.test(readFileSync(join(ROOT, "api/_replica-voice-preference.js"), "utf8")));
ok("preference capture rechecks adult identity plus biometric and training grants", /identity_expires_at>now\(\)/.test(sql) && /scope='biometric'/.test(sql) && /scope='training'/.test(sql));
ok("a swapped replay cannot create a second label for one pair", /on conflict \(replica_id,owner_user_id,pair_hash\) do nothing/.test(sql));

await assert.rejects(recordOwnedVoicePreference(async () => [], IDS.owner, { replica_id: IDS.replica, left_generation_id: IDS.left, right_generation_id: IDS.right, trial_id: IDS.trial, choice: "best" }), /choice_invalid/);
await assert.rejects(recordOwnedVoicePreference(async () => [], IDS.owner, { replica_id: IDS.replica, left_generation_id: IDS.left, right_generation_id: IDS.right, trial_id: IDS.trial, choice: "tie", reason_codes: ["secret_reason"] }), /reasons_invalid/);
ok("choices and reason codes are bounded before SQL", true);

const migration = readFileSync(join(ROOT, "db/migrations/046_replica_voice_preference.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
ok("the ledger is composite-owner bound to both exact generations", /voice_preference_left_fk/.test(migration) && /voice_preference_right_fk/.test(migration) && /generation_id,replica_id,owner_user_id/.test(migration));
ok("the preference ledger stores no prompt transcript", !/\b(text|prompt|transcript)\s+(text|jsonb)/i.test(migration) && /preview_text_hash/.test(migration));
ok("canonical schema carries migration 046", schema.includes("vy_replica_voice_preference_pair") && schema.includes("vy_replica_generation_preview_style_check") && schema.includes("vy_replica_generation_preview_seed_check"));

const handler = readFileSync(join(ROOT, "api/replica-voice-preference.js"), "utf8");
const previewHandler = readFileSync(join(ROOT, "api/replica-voice-preview.js"), "utf8");
const api = readFileSync(join(ROOT, "src/studio/voicePreviewApi.ts"), "utf8");
const studio = readFileSync(join(ROOT, "src/studio/VoicePreviewLab.tsx"), "utf8");
ok("the HTTP boundary is bearer-owner-only and rate limited", /requireUser/.test(handler) && /replica_voice_preference_user/.test(handler) && !/req\.body\.owner/.test(handler));
ok("every generation records its server-owned style and content hash", /text_hash: textHash/.test(previewHandler) && /style_key: trial\?\.styleKey \|\| body\.style_key/.test(previewHandler) && /started\.previewStyle/.test(previewHandler));
ok("the browser sends style keys rather than raw synthesis parameters", /style_key: input\.styleKey/.test(api) && !/cfg_weight|exaggeration|temperature/.test(api));
ok("the Studio requests a server-assigned blind trial and withholds labels until decision", /issueVoiceTrial/.test(studio) && !/crypto\.getRandomValues/.test(studio) && studio.indexOf("Preference secured") < studio.indexOf("CONDITION_LABELS[preferenceSaved.leftStyle]"));
ok("both players must finish before exact-generation preference submission", /onEnded/.test(studio) && !/onPlay/.test(studio) && /!heard\.left \|\| !heard\.right/.test(studio) && /trialId: pair\.trialId/.test(studio) && /leftGenerationId: pair\.left\.generationId/.test(studio) && /rightGenerationId: pair\.right\.generationId/.test(studio));
ok("new preference UI copy contains no em dash or en dash", !/[—–]/.test(studio));

console.log(`\nVoice preference learning: ${passed} checks passed.`);
