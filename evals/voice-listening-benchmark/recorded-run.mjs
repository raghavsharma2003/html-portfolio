import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync, openSync, ftruncateSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildCells, canonical, opaqueId, parseWav, sha256 } from "./lib.mjs";
import { ingestRecordedPack, readRecordedMedia, recordedPublicSummary, validateRecordedPack, validateRecordedPlan } from "./recorded-pack.mjs";
import { recordedFixture } from "./recorded-fixtures.mjs";
import { serveListeningBenchmark } from "./server.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../.."), temp = mkdtempSync(join(tmpdir(), "vyakti-recorded-"));
const artifact = join(root, "scratchpad", `recorded-pack-${Date.now()}`); mkdirSync(artifact, { recursive: true });
const checks = [], outcomes = [];
const ok = (name) => { checks.push(name); console.log(`ok ${checks.length} - ${name}`); };
const digest = (v) => sha256(canonical(v));
let outbound = 0, localRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  const url = new URL(args[0]);
  if (url.hostname !== "127.0.0.1") { outbound++; throw new Error("network_forbidden"); }
  localRequests++; return originalFetch(...args);
};
let server;
try {
  const old = JSON.parse(readFileSync(join(root, "evals/voice-listening-benchmark/recorded-old-functions.json"), "utf8"));
  for (const entry of Object.values(old)) assert.equal(sha256(entry.source), entry.sha256);
  const loaded = [], scope = { sha256, ROOT: "synthetic-root", resolve: (...parts) => parts.join("/"), fail: (code) => { throw Error(code); },
    loadChatterbox: () => { loaded.push("chatterbox"); return []; }, loadQwen: () => { loaded.push("qwen"); return []; }, loadVox: () => { loaded.push("vox"); return []; }, loadIndicF5: () => { loaded.push("indic"); return []; }, loadVendorPack: () => { loaded.push("vendor"); return []; } };
  runInNewContext(old.loader.source + "\nglobalThis.loader=loadSourcesFromRecordedPacks;" + old.cells.source.replace("export ", "") + "\nglobalThis.cells=buildCells;", scope);
  assert.throws(() => scope.loader([{ id: "recorded_v1", source: "never-read" }]), /benchmark_recorded_source_pack_unknown/);
  assert.equal(loaded.length, 0); ok("portable exact old loader refuses new pack before any historical media read");
  scope.loader(["chatterbox_20260828", "qwen_english_20260828", "voxcpm2_20260828", "indicf5_20260828", "vendor_synthetic"].map((id) => ({ id, source: "fixture" })));
  assert.deepEqual(loaded, ["chatterbox", "qwen", "vox", "indic", "vendor"]);
  assert(readFileSync(join(root, old.loader.file), "utf8").includes(old.loader.source)); ok("actual legacy loader bytes and all historical dispatch families remain unchanged");
  const a = { id: "one", candidateId: "a", language: "hi", textSha256: sha256("same"), comparisonScope: { runId: "run", planSha256: sha256("plan"), subjectId: "subject-one", conditioningGroupId: "conditioning", listeningReferenceManifestSha256: sha256("reference"), comparisonRecipeId: "recipe" } };
  const b = { ...a, id: "two", candidateId: "b", comparisonScope: { ...a.comparisonScope, subjectId: "subject-two" } };
  assert.equal(scope.cells([a, b]).length, 1); assert.equal(buildCells([a, b], { scope: "recorded/v1" }).length, 2); ok("old grouping merges different subjects, scoped actual grouping separates them");
  for (const field of Object.keys(a.comparisonScope)) {
    const next = structuredClone(a); next.id = "different"; next.comparisonScope[field] = field.includes("Sha256") ? sha256("other") : "other";
    assert.equal(buildCells([a, next], { scope: "recorded/v1" }).length, 2);
    const missing = structuredClone(a); delete missing.comparisonScope[field]; assert.throws(() => buildCells([missing], { scope: "recorded/v1" }), /scope_required/);
    ok(`comparison isolates ${field} and refuses missing scope`);
  }
  assert.equal(buildCells([a, { ...a, id: "different", candidateId: "b" }], { scope: "recorded/v1" })[0].comparison, "matched_text");
  assert.equal(buildCells([a, { ...a, id: "different", textSha256: sha256("different") }], { scope: "recorded/v1" }).length, 2);
  assert.throws(() => buildCells([a]), /scope_mode_required/);
  const legacy = [a, b].map(({ comparisonScope, ...rest }) => rest);
  assert.equal(canonical(scope.cells(legacy)), canonical(buildCells(legacy))); ok("candidate may vary, different text separates, explicit mode required, legacy byte result unchanged");

  const fixture = recordedFixture(), validated = validateRecordedPlan(fixture.plan);
  assert.equal(validated.authorityStatus, "unverified"); assert.equal(validated.humanListeningStatus, "not_started");
  assert.equal(fixture.counters().reads, 0); ok("valid portable preparation is useful without media or authority claim");
  const accepted = await ingestRecordedPack(fixture.plan, fixture.pack, fixture);
  assert.equal(accepted.assurance, "synthetic_fixture_only"); assert.equal(accepted.playbackStatus, "unavailable_prerequisite_only");
  assert.equal(accepted.cells.length, 1); assert.equal(accepted.cells[0].stimulusIds.length, 2); ok("complete synthetic pack ingests with explicit fixture assurance and scoped successful cell");
  const summary = recordedPublicSummary(accepted, Buffer.alloc(32, 7));
  assert.deepEqual([summary.attempts, summary.successful, summary.failed, summary.uncertain, summary.notStarted, summary.rated, summary.winner], [4, 2, 1, 1, 0, 0, null]);
  const lone = structuredClone(fixture.pack); lone.outcomes[1] = { ...lone.outcomes[2], attemptId: lone.outcomes[1].attemptId, generationId: lone.outcomes[1].generationId };
  const loneResult = await ingestRecordedPack(fixture.plan, lone, fixture); assert.equal(loneResult.cells[0].comparison, "unmatched_lane");
  ok("failed and uncertain attempts stay in denominator without audio or winner; lone success cannot rank");
  const publicJson = JSON.stringify(recordedPublicSummary({ ...accepted, privateCanary: "do not expose" }, Buffer.alloc(32, 7)));
  for (const forbidden of ["candidate", "private/", "Synthetic", "authority.json", "signature", fixture.plan.subject.id, fixture.plan.runId, "modelSha256", "do not expose"]) assert(!publicJson.includes(forbidden));
  assert.equal(recordedPublicSummary(accepted, Buffer.alloc(32, 7)).runId, summary.runId);
  assert.notEqual(recordedPublicSummary(accepted, Buffer.alloc(32, 8)).runId, summary.runId);
  assert.notEqual(opaqueId(Buffer.alloc(32, 7), "attempt", fixture.plan.runId, "one"), opaqueId(Buffer.alloc(32, 7), "attempt", "other-run", "one")); ok("allow-listed serialization seals identity, source, model and authority; opaque IDs do not join runs");
  const repeat = await ingestRecordedPack(fixture.plan, fixture.pack, fixture);
  assert.equal(repeat.packSha256, accepted.packSha256); assert(fixture.counters().reads > 20); ok("re-ingestion re-reads all media and commitment evidence, not a protected boolean");
  const pipeline = structuredClone(fixture.plan); pipeline.candidates[1].identity.runtimeImageSha256 = sha256("another image"); pipeline.conditioningGroups[0].comparisonKind = "pipeline";
  const revised = validateRecordedPlan(pipeline); assert.notEqual(revised.planSha256, validated.planSha256);
  assert.throws(() => validateRecordedPack(pipeline, fixture.pack), /pack_binding_mismatch/); ok("declared pipeline comparison is distinct from weights-only and cannot reuse the earlier plan pack");
  for (const value of [undefined, null, { self: null }]) assert.throws(() => validateRecordedPack(fixture.plan, value), /recorded_/);
  const cyclic = {}; cyclic.self = cyclic; assert.throws(() => validateRecordedPack(fixture.plan, cyclic), /recorded_pack_invalid/); ok("malformed or cyclic pack input fails with named refusal");

  const planMutations = [
    ["run", (p) => p.runId = "40000000-0000-4000-8000-000000000001"],
    ["corpus hash", (p) => p.corpus.sha256 = sha256("substitution")],
    ["text", (p) => p.corpus.items[0].text += " Changed"],
    ["subject", (p) => p.subject.id = "40000000-0000-4000-8000-000000000001"],
    ["second subject", (p) => p.subjects = [p.subject]],
    ["second listening reference", (p) => p.subject.listeningReferences = [p.subject.listeningReference]],
    ["borrowed listening audio", (p) => p.subject.listeningReference.audio = p.subject.conditioningReferences[0].audio],
    ["reference transcript", (p) => p.subject.conditioningReferences[0].transcript.text += " changed"],
    ["conditioning reference substitution", (p) => p.subject.conditioningReferences[0].audio.sha256 = sha256("other")],
    ["arm reference mapping", (p) => p.conditioningGroups[0].arms[0].referenceId = "unknown"],
    ["weights-only unequal runtime", (p) => p.candidates[1].identity.settingsSha256 = sha256("other settings")],
    ["reference purpose", (p) => p.subject.listeningReference.purpose = "conditioning"],
    ["foreign attempt subject", (p) => p.attempts[0].subjectId = "40000000-0000-4000-8000-000000000001"],
    ["foreign attempt run", (p) => p.attempts[0].runId = "40000000-0000-4000-8000-000000000001"],
    ["unknown candidate", (p) => p.attempts[0].candidateId = "unknown"],
    ["unsupported lane", (p) => p.candidates[0].languages = ["en-IN"]],
    ["duplicate attempt", (p) => p.attempts.push(p.attempts[0])],
    ["duplicate cell different ID", (p) => p.attempts.push({ ...p.attempts[0], id: "alias" })],
    ["normalized text substitution", (p) => p.attempts[0].normalization.synthesisText = "other"],
    ["normalization receipt", (p) => p.attempts[0].normalization.receipt.sha256 = sha256("other")],
    ["normalization recipe", (p) => p.attempts[0].normalization.recipeSha256 = sha256("other")],
    ["comparison recipe", (p) => p.attempts[0].comparisonRecipeId = "other"],
    ["listening reference manifest", (p) => p.attempts[0].listeningReferenceManifestSha256 = sha256("other")],
    ["relative escape", (p) => p.subject.listeningReference.audio.path = "../private.wav"],
    ["encoded escape", (p) => p.subject.listeningReference.audio.path = "%2e%2e/private.wav"],
    ["Windows absolute path", (p) => p.subject.listeningReference.audio.path = "C:/private.wav"],
    ["protection boolean", (p) => p.protectionVerified = true],
  ];
  for (const [name, mutate] of planMutations) { const plan = structuredClone(fixture.plan); mutate(plan); assert.throws(() => validateRecordedPlan(plan), /recorded_/); ok(`plan refuses ${name}`); }
  for (const [name, mutate] of [
    ["missing outcome", (p) => p.outcomes.pop()], ["duplicate outcome", (p) => p.outcomes.push(p.outcomes[0])],
    ["pack plan substitution", (p) => p.runPlanSha256 = sha256("other")], ["pack corpus substitution", (p) => p.corpusSha256 = sha256("other")],
    ["foreign outcome", (p) => p.outcomes[0].runId = "40000000-0000-4000-8000-000000000001"],
    ["duplicate generation", (p) => p.outcomes[1].generationId = p.outcomes[0].generationId],
    ["failed waveform", (p) => p.outcomes[2].output = p.outcomes[0].output],
    ["uncertain waveform", (p) => p.outcomes[3].output = p.outcomes[0].output],
    ["successful boolean receipt", (p) => p.outcomes[0].protection = true],
    ["unverified transformation", (p) => p.outcomes[0].delivery.history = [{ gain: 2 }]],
    ["negative cost", (p) => p.outcomes[0].cost = { status: "recorded", microUsd: -1 }],
    ["invented zero unknown cost", (p) => p.outcomes[3].cost.microUsd = 0],
  ]) { const pack = structuredClone(fixture.pack); mutate(pack); assert.throws(() => validateRecordedPack(fixture.plan, pack), /recorded_/); ok(`outcomes refuse ${name}`); }
  for (const which of ["output", "protection", "reference", "authority", "normalization"]) {
    const f = recordedFixture(); const descriptor = which === "output" ? f.pack.outcomes[0].output : which === "protection" ? f.pack.outcomes[0].protection
      : which === "reference" ? f.plan.subject.listeningReference.audio : which === "authority" ? f.plan.subject.listeningReference.authority : f.plan.attempts[0].normalization.receipt;
    f.media.set(descriptor.path, Buffer.from("substituted bytes")); await assert.rejects(ingestRecordedPack(f.plan, f.pack, f), /media_hash_mismatch/); ok(`exact re-verification refuses substituted ${which} bytes`);
  }
  const signedMismatch = recordedFixture(); signedMismatch.pack.outcomes[0].generationId = "40000000-0000-4000-8000-000000000001";
  await assert.rejects(ingestRecordedPack(signedMismatch.plan, signedMismatch.pack, signedMismatch)); ok("fixture signed output binding detects re-declared generation substitution");
  const wrongVerifier = recordedFixture(); await assert.rejects(ingestRecordedPack(wrongVerifier.plan, wrongVerifier.pack, { ...wrongVerifier, verifyEvidence: () => true }), /verification_binding_invalid/);
  await assert.rejects(ingestRecordedPack(wrongVerifier.plan, wrongVerifier.pack, { ...wrongVerifier, verifyEvidence: ({ bindingSha256 }) => ({ bindingSha256, assurance: "unknown" }) }), /verification_binding_invalid/);
  await assert.rejects(ingestRecordedPack(wrongVerifier.plan, wrongVerifier.pack, { readMedia: () => { throw Error("must not read media"); } }), /external_verification_unavailable/); ok("unknown or boolean verifier never grants evidence; real default blocks before media");
  const unequal = recordedFixture({ listeningDurationMs: 170, outputDurationMs: [70, 120] });
  const verifiedOriginals = [];
  const unequalResult = await ingestRecordedPack(unequal.plan, unequal.pack, { ...unequal, verifyEvidence: async (input) => {
    if (input.phase === "evidence") {
      const original = input.binding.kind === "reference" ? input.binding.reference.audio : input.binding.outcome.output;
      if (original) {
        const bytes = input.binding.kind === "reference" ? input.materials.audio : input.materials.bytes;
        assert(bytes.equals(unequal.media.get(original.path))); verifiedOriginals.push(parseWav(bytes).durationMs);
      }
    }
    return unequal.verifyEvidence(input);
  } });
  assert.equal(unequalResult.assurance, "synthetic_fixture_only"); assert.deepEqual(verifiedOriginals, [100, 170, 70, 120]);
  ok("independent reference and unequal-duration outputs verify with every original byte unchanged");
  const invalidFormat = recordedFixture(), invalidOutput = invalidFormat.pack.outcomes[0];
  const wrongRate = Buffer.from(invalidFormat.media.get(invalidOutput.output.path)); wrongRate.writeUInt32LE(16000, 24); invalidFormat.media.set(invalidOutput.output.path, wrongRate);
  invalidOutput.output.sha256 = sha256(wrongRate); invalidOutput.delivery.originalSha256 = invalidOutput.output.sha256; invalidOutput.delivery.deliveredSha256 = invalidOutput.output.sha256;
  await assert.rejects(ingestRecordedPack(invalidFormat.plan, invalidFormat.pack, invalidFormat), /benchmark_wav_format_invalid/);
  ok("unequal durations do not permit unsupported output format");

  const mediaRoot = join(temp, "media"); mkdirSync(mediaRoot);
  for (const [name, bytes] of fixture.media) { mkdirSync(dirname(join(mediaRoot, name)), { recursive: true }); writeFileSync(join(mediaRoot, name), bytes); }
  assert(readRecordedMedia(mediaRoot, fixture.plan.subject.listeningReference.audio).equals(fixture.media.get(fixture.plan.subject.listeningReference.audio.path)));
  const outside = join(temp, "outside"); mkdirSync(outside); writeFileSync(join(outside, "voice.wav"), Buffer.from("outside"));
  symlinkSync(outside, join(mediaRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => readRecordedMedia(mediaRoot, { path: "linked/voice.wav", sha256: sha256("outside") }), /media_outside_root/); ok("actual filesystem reader verifies hash and rejects junction escape outside exact root");
  const oversized = join(mediaRoot, "oversized.wav"), fd = openSync(oversized, "wx"); try { ftruncateSync(fd, 50_000_001); } finally { closeSync(fd); }
  assert.throws(() => readRecordedMedia(mediaRoot, { path: "oversized.wav", sha256: sha256("not read") }), /media_size_invalid/);
  assert.throws(() => readRecordedMedia(mediaRoot, { path: "missing.wav", sha256: sha256("missing") }), /^Error: recorded_media_unavailable$/); ok("filesystem size is bounded before read and unavailable media errors do not expose private paths");

  const planFile = join(temp, "plan.json"), packFile = join(temp, "pack.json"), home = join(temp, "prepared");
  writeFileSync(planFile, JSON.stringify(fixture.plan)); writeFileSync(packFile, JSON.stringify(fixture.pack));
  const cli = (args) => { const result = spawnSync(process.execPath, [join(root, "scripts/voice-listening-benchmark.mjs"), ...args], { cwd: root, encoding: "utf8" }); outcomes.push({ args: args.map((v) => v.startsWith(temp) ? v.replace(temp, "TEMP") : v), status: result.status, stdout: result.stdout, stderr: result.stderr }); return result; };
  assert.equal(cli(["recorded-prepare", "--plan", planFile, "--home", home]).status, 0);
  assert.equal(cli(["recorded-verify", "--home", home]).status, 0);
  assert(!existsSync(join(home, "served", "page.html"))); assert(!existsSync(join(home, "served", "stimuli")));
  const keyBefore = readFileSync(join(home, "private", "recorded-run.json"));
  const denied = cli(["recorded-ingest", "--pack", packFile, "--media-root", join(temp, "missing-no-read"), "--home", home]); assert.equal(denied.status, 1); assert.match(denied.stderr, /external_verification_unavailable/);
  assert(readFileSync(join(home, "private", "recorded-run.json")).equals(keyBefore)); ok("real CLI prepares/verifies portable no-media plan then refuses ingestion without changes or playback");
  for (const args of [
    ["recorded-prepare", "--plan", planFile, "--home", home],
    ["recorded-prepare", "--plan", planFile, "--home", join(temp, "bad"), "--test-verifier", "true"],
    ["recorded-prepare", "--plan", planFile, "--home", join(temp, "bad"), "--vendor-pack", "fake"],
    ["recorded-prepare", "--plan", planFile, "--plan", planFile, "--home", join(temp, "bad")],
    ["build", "--plan", planFile, "--home", join(temp, "bad")],
  ]) assert.equal(cli(args).status, 1);
  assert(!existsSync(join(temp, "bad"))); ok("CLI refuses overwrite, synthetic verifier, mixed legacy flags and duplicate arguments before writes");
  const publicPath = join(home, "served", "manifest.json"), publicBytes = readFileSync(publicPath);
  writeFileSync(publicPath, JSON.stringify({ ...JSON.parse(publicBytes), privateLeak: "forbidden" })); assert.equal(cli(["recorded-verify", "--home", home]).status, 1); writeFileSync(publicPath, publicBytes);
  const keyPath = join(home, "private", "recorded-run.json"), changed = JSON.parse(keyBefore); changed.plan.candidates[0].identity.modelSha256 = sha256("changed"); writeFileSync(keyPath, JSON.stringify(changed)); assert.equal(cli(["recorded-verify", "--home", home]).status, 1); writeFileSync(keyPath, keyBefore); ok("real CLI re-verification catches public exposure and private plan drift");
  server = await serveListeningBenchmark({ runId: "prepared", served: join(home, "served"), answers: join(home, "answers") }, 0);
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(base + "/manifest.json")).json(), JSON.parse(publicBytes));
  for (const path of ["/private/recorded-run.json", "/page.html", "/trials.json", "/stimuli/" + "a".repeat(24) + ".wav"]) assert.equal((await fetch(base + path)).status, 404);
  ok("existing loopback router serves only public prepared counts; no private reference player or mapping exists");
  assert.equal(outbound, 0);
  writeFileSync(join(artifact, "result.json"), JSON.stringify({ at: new Date().toISOString(), checks, cli: outcomes, outboundCalls: outbound, loopbackCalls: localRequests, generations: 0, listeners: 0, artifactTemp: temp, oldHashes: Object.fromEntries(Object.entries(old).map(([k, v]) => [k, v.sha256])), scope: "Synthetic tones/signatures only; no real authority/protection/owner audio or voice quality. Preparation is playable nowhere until external verifier integration." }, null, 2));
  console.log(`PASS ${checks.length} recorded-pack groups; ${artifact}`);
} catch (error) {
  writeFileSync(join(artifact, "failure.json"), JSON.stringify({ checks, cli: outcomes, error: String(error.stack || error), outboundCalls: outbound, artifactTemp: temp }, null, 2)); throw error;
} finally {
  globalThis.fetch = originalFetch;
  if (server) await new Promise((done) => server.close(done));
}
