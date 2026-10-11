import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const recovery = await import(pathToFileURL(join(ROOT, "src/studio/mirrorCallRecovery.ts")));
const extractionModel = await import(pathToFileURL(join(ROOT, "src/studio/claimExtractionPresentation.ts")));

let checks = 0;
let failures = 0;
function ok(name, condition, detail = "") {
  checks++;
  if (condition) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const RID = "10000000-0000-4000-8000-000000000001";
const SID = "20000000-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-08-30T06:00:00.000Z");
const storage = new MemoryStorage();

const opened = recovery.rememberMirrorCall(RID, SID, NOW, storage);
const persistedJson = [...storage.values.values()][0];
ok("Mirror recovery persists only content-free identifiers and timestamps",
  JSON.stringify(Object.keys(JSON.parse(persistedJson)).sort()) === JSON.stringify([
    "endRequestedAt", "endedAt", "openedAt", "replicaId", "sessionId", "version",
  ])
  && !/(audio|transcript|caption|proposal|score|speaker)/i.test(persistedJson));
ok("The same replica reads the saved recovery intent", recovery.readMirrorCallRecovery(RID, storage)?.sessionId === SID);
ok("A different replica cannot read another replica's recovery intent",
  recovery.readMirrorCallRecovery("30000000-0000-4000-8000-000000000003", storage) === null);

const ending = recovery.rememberMirrorCallEnd(opened, null, NOW + 1_000, storage);
const replayed = recovery.rememberMirrorCallEnd(ending, "2026-08-30T06:00:02.000Z", NOW + 8_000, storage);
ok("A lost response replay keeps the first end-request timestamp",
  replayed.endRequestedAt === NOW + 1_000 && replayed.endedAt === "2026-08-30T06:00:02.000Z");
recovery.clearMirrorCallRecovery(RID, storage);
ok("Terminal speaker review clears the same-tab recovery record", recovery.readMirrorCallRecovery(RID, storage) === null);

const endFence = recovery.createMirrorCallOperationFence();
let endRequests = 0;
if (endFence.tryEnter()) endRequests++;
if (endFence.tryEnter()) endRequests++;
ok("Rapid duplicate End taps admit exactly one request", endRequests === 1 && endFence.active);
endFence.leave();
ok("The End request fence re-opens only after its request settles", !endFence.active && endFence.tryEnter());
endFence.leave();

const status = (nearline) => ({
  replica_id: RID,
  readiness: { ready: true, blockers: [], eligible_spans: 2 },
  nearline,
  runs: [],
});
const queued = extractionModel.presentClaimExtractionTiming(status({
  queued: true, state: "queued", pending_items: 2, complete_items: 0,
  next_attempt_at: "2026-08-30T06:05:00.000Z", last_error_code: "",
  automatic_sweep: { route: "/api/replica-claim-sweep" }, owner_action: { route: "/api/replica-claims", op: "extract" },
}), NOW, true);
ok("Queued extraction names durable work, next attempt and leave guidance without a finish countdown",
  queued.shouldPoll && /2 evidence items/.test(queued.phase) && /scheduled/.test(queued.nextCheck)
  && /close this page/.test(queued.returnGuidance) && /not a promised finish/.test(queued.returnGuidance)
  && /No production completion range/.test(queued.observedRange));

const offline = extractionModel.presentClaimExtractionTiming(status({
  queued: true, state: "running", pending_items: 1, complete_items: 0,
  next_attempt_at: null, last_error_code: "", automatic_sweep: { route: "" }, owner_action: { route: "", op: "" },
}), NOW, false);
ok("Offline extraction pauses only browser checks and says server work continues",
  offline.shouldPoll && /browser is offline/.test(offline.nextCheck) && /Server work continues/.test(offline.returnGuidance));

const complete = extractionModel.presentClaimExtractionTiming(status({
  queued: false, state: "complete", pending_items: 0, complete_items: 3,
  next_attempt_at: null, last_error_code: "", automatic_sweep: { route: "" }, owner_action: { route: "", op: "" },
}), NOW, true);
ok("Completed extraction stops polling and denies automatic acceptance",
  !complete.shouldPoll && /complete/.test(complete.title) && /Nothing was accepted automatically/.test(complete.returnGuidance));

const unknown = extractionModel.presentClaimExtractionTiming(status({
  queued: false, state: "mystery", pending_items: 9, complete_items: 0,
  next_attempt_at: null, last_error_code: "", automatic_sweep: { route: "" }, owner_action: { route: "", op: "" },
}), NOW, true);
ok("NEGATIVE CONTROL: an unknown server state never becomes plausible running work",
  unknown.tone === "unknown" && !unknown.shouldPoll && /will not guess/.test(unknown.returnGuidance));

const mirrorSource = readFileSync(join(ROOT, "src/studio/MirrorCallStudio.tsx"), "utf8");
const personSource = readFileSync(join(ROOT, "src/studio/PersonModelStudio.tsx"), "utf8");
const recoveryStart = mirrorSource.indexOf("async function recoverEndReceipt");
const recoveryEnd = mirrorSource.indexOf("async function startTalking", recoveryStart);
const recoveryBody = mirrorSource.slice(recoveryStart, recoveryEnd);
ok("Reload recovery replays exact idempotent end and does not invent a status fallback",
  /endMirrorCall\(token, intent\.sessionId\)/.test(recoveryBody)
  && !/getMirrorCallStatus/.test(recoveryBody)
  && /sessionForMirrorCallRecovery/.test(recoveryBody)
  && /ops: \["end"\]/.test(mirrorSource));
ok("Mirror recovery is cleared only after a terminal speaker-attestation result",
  /attestationIsTerminal\(result\)[\s\S]*clearMirrorCallRecovery\(replicaId\)/.test(mirrorSource)
  && /state !== "needs_owner_choice"/.test(mirrorSource));
ok("A lost end response offers receipt recovery instead of starting another call",
  /Recover end receipt/.test(mirrorSource) && /Starting a new call would not resolve that ambiguity/.test(mirrorSource));
ok("End and turn requests use immediate shared fences before React can render busy state",
  /endFenceRef\.current/.test(mirrorSource)
  && /turnFenceRef\.current\.active/.test(mirrorSource)
  && /!fence\.tryEnter\(\)/.test(mirrorSource));
ok("Person Model polls only durable pending extraction states and blocks duplicate submissions",
  /extractionTiming\.shouldPoll/.test(personSource)
  && /EXTRACTION_STATUS_POLL_MS/.test(personSource)
  && /disabled=\{extracting \|\| nearlineBusy/.test(personSource));

console.log(failures ? `\n${failures} of ${checks} checks failed` : `\n${checks} studio recovery checks passed`);
process.exit(failures ? 1 : 0);
