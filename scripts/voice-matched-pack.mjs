#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { serveListeningBenchmark } from "../evals/voice-listening-benchmark/server.mjs";
import {
  ARM_SPECS,
  CLOUD_HARD_STOP_USD,
  MATCHED_PACK_CONTRACT,
  SYNTHESIS_PATH,
  TRANSPORT_PROTOCOL,
  buildPlan,
  canonical,
  cropReference,
  decodeSecret,
  payloadForItem,
  reserveAttempt,
  sha256,
  signaturesEqual,
  transportSignature,
  verifyProviderResult,
} from "../evals/voice-matched-pack/contract.mjs";
import {
  pathsFor,
  prepareHome,
  exportStudioBundle,
  importStudioAnswerSheet,
  saveResult,
  scoreHome,
  sealHome,
  unsealHome,
  verifySealedHome,
} from "../evals/voice-matched-pack/pack.mjs";

const DEFAULT_HOME = resolve("scratchpad/voice-matched-pack-20260828");
const DEFAULT_SOURCE = resolve("scratchpad/voxcpm2-20260828/owner-reference.wav");
const DEFAULT_REFERENCE_EVIDENCE = resolve("scratchpad/qwen3-owner-reference-asr.private.json");

function fail(code) {
  throw new Error(code);
}

function flagsFrom(args) {
  const flags = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }
  return flags;
}

const [command = "help", ...rawFlags] = process.argv.slice(2);
const flags = flagsFrom(rawFlags);
const home = resolve(String(flags.get("home") || DEFAULT_HOME));

function readPlan(paths) {
  const plan = JSON.parse(readFileSync(paths.plan, "utf8"));
  if (plan.contract !== MATCHED_PACK_CONTRACT) fail("matched_pack_plan_invalid");
  return plan;
}

function selectedArmIds() {
  const raw = String(flags.get("arms") || "chatterbox,qwen,voxcpm2");
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function plan() {
  const sourcePath = resolve(String(flags.get("source") || DEFAULT_SOURCE));
  const evidencePath = resolve(String(flags.get("reference-evidence") || DEFAULT_REFERENCE_EVIDENCE));
  const consentReceiptSha256 = String(flags.get("consent-receipt") || process.env.VOICE_MATCHED_CONSENT_RECEIPT_SHA256 || "");
  const replicaId = String(flags.get("replica-id") || process.env.VOICE_MATCHED_REPLICA_ID || "");
  const sourceWav = readFileSync(sourcePath);
  const referenceWav = cropReference(sourceWav);
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const referenceText = String(evidence.transcript_hypothesis || "").trim();
  if (evidence.contract !== "vyakti-private-reference-asr/v1"
    || evidence.evidence_scope !== "asr_unreviewed"
    || evidence.source_object_sha256 !== sha256(sourceWav)
    || evidence.reference_sha256 !== sha256(referenceWav)
    || evidence.reference_offset_ms !== 0
    || evidence.reference_duration_ms !== 12_000
    || evidence.transcript_hypothesis_sha256 !== sha256(Buffer.from(referenceText))) {
    fail("matched_pack_reference_evidence_invalid");
  }
  const value = buildPlan({
    sourceWav,
    referenceWav,
    referenceText,
    referenceTextEvidenceScope: evidence.evidence_scope,
    consentReceiptSha256,
    replicaId,
    armIds: selectedArmIds(),
    indicf5Variant: String(flags.get("indicf5-variant") || "pronunciation_normalized"),
  });
  prepareHome({ home, plan: value, referenceWav, referenceText });
  console.log(`matched pack plan ready: ${value.items.length} exact-text requests across ${value.arms.length} arms`);
  console.log(`comparison cells: ${value.comparisonCells.length}; projected request reservation: USD ${value.projectedAttemptReservationUsd.toFixed(2)} of USD ${value.cloudHardStopUsd.toFixed(2)}`);
  console.log("cloud/model calls: 0");
}

function armEnvironment(item) {
  const spec = ARM_SPECS[item.armId];
  const prefix = `VOICE_MATCHED_${spec.envPrefix}`;
  const origin = String(process.env[`${prefix}_ORIGIN`] || "").replace(/\/+$/, "");
  const secretRaw = String(process.env[`${prefix}_HMAC_SECRET`] || process.env.VOICE_MATCHED_HMAC_SECRET || "");
  const expectedModelCommitment = item.expectedModelCommitment === "required_at_run"
    ? String(process.env[`${prefix}_MODEL_COMMITMENT`] || "")
    : item.expectedModelCommitment;
  if (!/^https:\/\/[^/]+$/.test(origin)) fail(`matched_pack_${item.armId}_origin_required`);
  if (!/^[0-9a-f]{64}$/.test(expectedModelCommitment)) fail(`matched_pack_${item.armId}_model_commitment_required`);
  return { origin, secret: decodeSecret(secretRaw), expectedModelCommitment };
}

async function signedCall({ origin, secret, payload }) {
  const body = Buffer.from(canonical(payload));
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(24).toString("base64url");
  const bodyHash = sha256(body);
  const response = await fetch(`${origin}${SYNTHESIS_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vyakti-protocol": TRANSPORT_PROTOCOL,
      "x-vyakti-timestamp": timestamp,
      "x-vyakti-nonce": nonce,
      "x-vyakti-content-sha256": bodyHash,
      "x-vyakti-signature": transportSignature(secret, TRANSPORT_PROTOCOL, "POST", SYNTHESIS_PATH, timestamp, nonce, bodyHash),
    },
    body,
    signal: AbortSignal.timeout(240_000),
  });
  const responseBody = Buffer.from(await response.arrayBuffer());
  const expected = transportSignature(secret, TRANSPORT_PROTOCOL, "response", SYNTHESIS_PATH, nonce, String(response.status), sha256(responseBody));
  const responseSignatureVerified = signaturesEqual(response.headers.get("x-vyakti-response-signature"), expected);
  if (!responseSignatureVerified) fail("matched_pack_response_hmac_invalid");
  let result;
  try { result = JSON.parse(responseBody.toString("utf8")); }
  catch { fail("matched_pack_response_json_invalid"); }
  if (!response.ok) fail(String(result?.error || `matched_pack_http_${response.status}`));
  return { result, responseSignatureVerified };
}

function updateLedger(paths, ledger, itemId, state, details = {}) {
  const attempts = ledger.attempts.map((attempt, index) => index === ledger.attempts.length - 1
    ? { ...attempt, itemId, state, ...details }
    : attempt);
  const next = { ...ledger, attempts };
  writeFileSync(paths.ledger, JSON.stringify(next, null, 2));
  return next;
}

async function runCloud() {
  if (flags.get("confirm-cloud") !== "exact-text-matched-pack") fail("matched_pack_cloud_confirmation_required");
  const maxUsd = Number(flags.get("max-usd"));
  if (!Number.isFinite(maxUsd) || maxUsd <= 0 || maxUsd > CLOUD_HARD_STOP_USD) fail("matched_pack_cloud_limit_invalid");
  const paths = pathsFor(home);
  const planValue = readPlan(paths);
  const referenceWav = readFileSync(paths.reference);
  const referenceText = readFileSync(paths.referenceText, "utf8");
  let ledger = JSON.parse(readFileSync(paths.ledger, "utf8"));
  const only = flags.get("only") ? new Set(String(flags.get("only")).split(",").map((value) => value.trim()).filter(Boolean)) : null;
  if (only && [...only].some((armId) => !planValue.arms.some((arm) => arm.id === armId))) fail("matched_pack_only_arm_invalid");
  const pending = planValue.items.filter((item) => (!only || only.has(item.armId)) && !existsSync(join(paths.outputs, `${item.id}.wav`)));
  for (const item of pending) {
    const requestId = randomUUID();
    const generationId = randomUUID();
    const payload = payloadForItem({ plan: planValue, item, referenceWav, referenceText, requestId, generationId });
    const { origin, secret, expectedModelCommitment } = armEnvironment(item);
    ledger = reserveAttempt(ledger, item.id, maxUsd);
    writeFileSync(paths.ledger, JSON.stringify(ledger, null, 2));
    try {
      const { result, responseSignatureVerified } = await signedCall({ origin, secret, payload });
      const normalized = verifyProviderResult({ plan: planValue, item, payload, result, responseSignatureVerified, expectedModelCommitment });
      saveResult(paths, normalized);
      ledger = updateLedger(paths, ledger, item.id, "succeeded", {
        outputWavSha256: normalized.outputWavSha256,
        elapsedMs: normalized.elapsedMs,
      });
      console.log(`sealed source ${item.armId}/${item.languageId}: ${item.id}`);
    } catch (error) {
      updateLedger(paths, ledger, item.id, "failed", { error: error?.message || String(error) });
      throw error;
    }
  }
  console.log(pending.length ? `completed ${pending.length} signed synthesis request(s)` : "no pending requests for the selected arms");
}

function seal() {
  const built = sealHome(home);
  console.log(`matched listening pack sealed: ${built.manifest.baseStimuli} clips, ${built.manifest.exactTextCrossProviderCells} exact-text cells`);
  console.log(`rating screens: ${built.manifest.ratingTrials}; model mapping remains sealed`);
  console.log("human listening: not started; no quality winner exists");
}

async function verify() {
  const result = verifySealedHome(home);
  const paths = pathsFor(home);
  const server = await serveListeningBenchmark(paths, 0);
  const port = server.address().port;
  try {
    for (const path of ["/", "/manifest.json", "/trials.json"]) {
      if ((await fetch(`http://127.0.0.1:${port}${path}`)).status !== 200) fail("matched_pack_public_route_invalid");
    }
    for (const path of ["/private/sealed-key.json", "/../private/sealed-key.json", "/stimuli/%2e%2e%2f%2e%2e%2fprivate%2fsealed-key.json"]) {
      if ((await fetch(`http://127.0.0.1:${port}${path}`)).status !== 404) fail("matched_pack_private_route_reachable");
    }
  } finally {
    server.close();
  }
  console.log(`exact-text matched-pack integrity: ${result.checks}/18 core checks plus local route isolation passed`);
  console.log(`${result.stimuli} stimuli; ${result.cells} exact-text cross-provider cells; ${result.commonGeometry}`);
  console.log("model mapping remains sealed; no human quality score exists");
}

async function listen() {
  const paths = pathsFor(home);
  if (!existsSync(paths.key)) fail("matched_pack_not_sealed");
  const port = Number(flags.get("port") || 8792);
  const server = await serveListeningBenchmark(paths, port, { onSaved: (file) => console.log(`saved ${file}`) });
  console.log(`open http://127.0.0.1:${server.address().port}/`);
  console.log("the sealed key is not served; stop with Ctrl+C after ratings are locked");
}

function score() {
  const report = scoreHome(home);
  console.log(`accepted listeners: ${report.acceptedListeners}`);
  console.log("model mapping remains sealed");
}

function studioBundle() {
  const output = resolve(String(flags.get("out") || join(home, "reports", `${home.split(/[\\/]/).at(-1)}-studio-bundle.json`)));
  const result = exportStudioBundle(home, output);
  console.log(`owner Studio bundle ready: ${result.file}`);
  console.log(`${result.stimuli} opaque audio files; ${result.ratingTrials} rating screens; ${result.bytes} bytes`);
  console.log(`bundle sha256: ${result.sha256}`);
  console.log("model mapping remains sealed");
}

function importStudioAnswers() {
  const input = flags.get("file");
  if (!input || input === true) fail("matched_pack_studio_answers_file_required");
  const result = importStudioAnswerSheet(home, resolve(String(input)));
  console.log(`accepted locked owner ratings: ${result.listener}`);
  console.log("model mapping remains sealed until the explicit unseal command");
}

function unseal() {
  if (flags.get("confirm-ratings-locked") !== true) fail("matched_pack_unseal_requires_locked_ratings");
  const report = unsealHome(home);
  console.log(`unsealed ${report.cells.length} exact-text cells for ${report.acceptedListeners} accepted listener(s)`);
  console.log("descriptive means are reported; no production quality winner is claimed");
}

function usage() {
  console.log("voice-matched-pack");
  console.log("  plan --consent-receipt <sha256> --replica-id <uuid> [--arms chatterbox,qwen,voxcpm2,indicf5,zonos2] [--indicf5-variant unnormalized_baseline|pronunciation_normalized] [--home path]");
  console.log("  run --confirm-cloud exact-text-matched-pack --max-usd 5 [--only arm,arm] [--home path]");
  console.log("  seal [--home path]");
  console.log("  verify [--home path]");
  console.log("  listen [--home path] [--port 8792]");
  console.log("  studio-bundle --out path [--home path]");
  console.log("  import-studio-answers --file path [--home path]");
  console.log("  score [--home path]");
  console.log("  unseal --confirm-ratings-locked [--home path]");
}

try {
  if (command === "plan") plan();
  else if (command === "run") await runCloud();
  else if (command === "seal") seal();
  else if (command === "verify") await verify();
  else if (command === "listen") await listen();
  else if (command === "studio-bundle") studioBundle();
  else if (command === "import-studio-answers") importStudioAnswers();
  else if (command === "score") score();
  else if (command === "unseal") unseal();
  else usage();
} catch (error) {
  console.error(error?.message || String(error));
  process.exitCode = 1;
}
