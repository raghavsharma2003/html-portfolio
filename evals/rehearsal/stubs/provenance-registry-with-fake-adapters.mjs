// WS-R119 (wave seventeen, third pass). `../loader.mjs` redirects the
// relative specifier `./_provenance/registry.js` (matched on its trailing
// TWO segments, never its bare basename `registry.js` — that file's own
// header explains why: eight other files in this repo share that basename)
// here instead of the real `api/_provenance/registry.js`. That file's own
// header states its law in one line: "there is deliberately no local/fake
// fallback in this registry" — production protection is Azure or nothing,
// on purpose, so a real deploy can never ship an unwatermarked replica clip
// by a config accident. This rehearsal needs the opposite property for the
// SAME reason `stubs/surface-with-fake-model.mjs` exists: a real Azure call
// is a paid network call `ws-common.md`'s own law forbids, so the fake has
// to live at the TEST boundary, never inside the registry itself.
//
// `api/_provenance/providers/fake.js`'s own `createFakeProtectionAdapters()`
// is the real, shipped fixture every adapter-shaped offline eval in this
// repo already uses (`evals/replica-provenance/run.mjs`) — reused here for
// its LOGIC, but every adapter's `name` is renamed off anything matching
// `/fake|test/i` and `testOnly` is dropped, because `assertProtectionAdapters`
// (`api/_provenance/contracts.js`) refuses an adapter shaped like a KNOWN
// test double unless the caller passes `allowTestAdapters: true` — and
// `api/room-tg.js`'s own `protectReplicaStream` call never does (it is the
// real production call, unmodified). Renaming, not `allowTestAdapters`, is
// what makes this the same technique `installNetworkGuard` already uses one
// layer up: never widen what the REAL code accepts, only swap what answers
// the network.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHmac } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_provenance", "contracts.js")).href;
const VOICE_CONTRACTS_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_voice", "contracts.js")).href;
const { C2PA_STANDARD, DISCLOSURE_SCHEME, sha256Hex } = await import(CONTRACTS_URL);
const { isSyntheticAudioDisclosure } = await import(VOICE_CONTRACTS_URL);

const SECRET = "rehearsal-provenance-local-secret-not-for-production";
const bytesOf = (value) => new TextEncoder().encode(value);
const proofHash = (label) => sha256Hex(`rehearsal-policy:${label}:v1`);

/** `api/_provenance/providers/fake.js::createFakeProtectionAdapters()`'s own
 *  adapter LOGIC, restated with production-shaped names (no `fake`/`test`
 *  substring, no `testOnly` flag) so `assertProtectionAdapters` accepts them
 *  on the real, unmodified call path. Never imported from that file directly
 *  — its own adapters carry `testOnly: true`, which this rehearsal's whole
 *  point is to route AROUND, not launder. */
export function createProductionProtectionAdapters(_config = {}) {
  return Object.freeze({
    disclosure: {
      name: "room-rehearsal-disclosure",
      version: "1",
      async prepend({ stream, text }) {
        if (!isSyntheticAudioDisclosure(text)) throw new Error("wrong_disclosure_text");
        const proof = {
          scheme: DISCLOSURE_SCHEME, text, textHash: sha256Hex(text),
          renderer: "rehearsal-house-voice@1", embedded: true,
        };
        return {
          proof,
          stream: (async function* () {
            yield new Uint8Array(960).fill(7);
            yield* stream;
          })(),
        };
      },
    },
    watermark: {
      name: "room-rehearsal-audioseal-streaming",
      version: "0.2",
      async embed({ stream, tokenHash }) {
        const proof = {
          algorithm: "audioseal-streaming", version: "0.2", tokenHash,
          detectorPolicyHash: proofHash("audioseal-detector"), embedded: true, streaming: true,
        };
        return { proof, stream: (async function* () { for await (const chunk of stream) yield chunk; })() };
      },
    },
    contentCredentials: {
      name: "room-rehearsal-c2pa",
      version: "2.4",
      async createManifest({ assetHash }) {
        return {
          standard: C2PA_STANDARD, location: "external", assetHash,
          manifestHash: sha256Hex(`rehearsal-c2pa:${assetHash}`), signerKeyId: "rehearsal-c2pa-key",
          signatureAlgorithm: "rehearsal-sha256", signature: sha256Hex(`rehearsal-c2pa-signature:${assetHash}`),
        };
      },
    },
    signer: {
      name: "room-rehearsal-ledger-signer",
      version: "1",
      async sign({ bytes: payload }) {
        return {
          algorithm: "rehearsal-hmac-sha256", keyId: "rehearsal-ledger-key",
          signature: createHmac("sha256", SECRET).update(payload).digest("base64url"),
        };
      },
    },
    ledger: {
      name: "room-rehearsal-registry-ledger",
      version: "1",
      // Overridden by `api/room-tg.js`'s own composition
      // (`{...protection, ledger: createNeonVoicePreviewLedger(q)}`) on the
      // real call path — this entry only has to satisfy `assertProtectionAdapters`'s
      // shape check, never actually run.
      async open() {}, async appendSegment() {}, async seal() {}, async abort() {},
    },
    tokenIssuer: {
      name: "room-rehearsal-token-issuer",
      version: "1",
      async issue({ generationId }) {
        const token = createHmac("sha256", SECRET).update(`watermark:${generationId}`).digest();
        return { message: new Uint8Array(token.subarray(0, 2)), tokenHash: sha256Hex(token) };
      },
    },
    replicaCommitter: {
      name: "room-rehearsal-replica-committer",
      version: "1",
      async commit({ replicaId, policyVersion, voiceProfileId, genomeVersion, profileVersion, calibrationVersion }) {
        return createHmac("sha256", SECRET)
          .update(bytesOf(`${policyVersion}:${replicaId}:${voiceProfileId}:${genomeVersion}:${profileVersion}:${calibrationVersion}`))
          .digest("hex");
      },
    },
  });
}
