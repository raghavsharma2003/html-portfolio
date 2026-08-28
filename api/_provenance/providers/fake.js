import { createHmac } from "node:crypto";
import {
  C2PA_STANDARD,
  DISCLOSURE_SCHEME,
  sha256Hex,
} from "../contracts.js";
import { isSyntheticAudioDisclosure } from "../../_voice/contracts.js";

const TEST_SECRET = "offline-provenance-test-secret-not-for-production";

function bytes(value) {
  return new TextEncoder().encode(value);
}

function proofHash(label) {
  return sha256Hex(`test-policy:${label}:v1`);
}

export function createFakeProtectionAdapters() {
  const opened = [];
  const segments = [];
  const sealed = [];
  const aborted = [];
  const adapters = {
    disclosure: {
      name: "fake-disclosure",
      version: "1",
      testOnly: true,
      async prepend({ stream, text }) {
        if (!isSyntheticAudioDisclosure(text)) throw new Error("wrong_disclosure_text");
        const proof = {
          scheme: DISCLOSURE_SCHEME,
          text,
          textHash: sha256Hex(text),
          renderer: "fake-house-voice@1",
          embedded: true,
        };
        return {
          proof,
          stream: (async function* () {
            // Deterministic PCM-like prefix representing a separately rendered
            // house-voice disclosure. It is structural test data, not speech.
            yield new Uint8Array(960).fill(7);
            yield* stream;
          })(),
        };
      },
    },
    watermark: {
      name: "fake-audioseal-streaming",
      version: "0.2-test",
      testOnly: true,
      async embed({ stream, tokenHash }) {
        const proof = {
          algorithm: "audioseal-streaming",
          version: "0.2-test",
          tokenHash,
          detectorPolicyHash: proofHash("audioseal-detector"),
          embedded: true,
          streaming: true,
        };
        return {
          proof,
          stream: (async function* () {
            for await (const chunk of stream) yield chunk;
          })(),
        };
      },
    },
    contentCredentials: {
      name: "fake-c2pa",
      version: "2.4-test",
      testOnly: true,
      async createManifest({ assetHash }) {
        return {
          standard: C2PA_STANDARD,
          location: "external",
          assetHash,
          manifestHash: sha256Hex(`fake-c2pa:${assetHash}`),
          signerKeyId: "test-c2pa-key",
          signatureAlgorithm: "fake-sha256",
          signature: sha256Hex(`fake-c2pa-signature:${assetHash}`),
        };
      },
    },
    signer: {
      name: "fake-ledger-signer",
      version: "1",
      testOnly: true,
      async sign({ bytes: payload }) {
        return {
          algorithm: "fake-hmac-sha256",
          keyId: "test-ledger-key",
          signature: createHmac("sha256", TEST_SECRET).update(payload).digest("base64url"),
        };
      },
    },
    ledger: {
      name: "fake-ledger",
      version: "1",
      testOnly: true,
      async open(record) { opened.push(record); },
      async appendSegment(record) { segments.push(record); },
      async seal(record) { sealed.push(record); },
      async abort(record) { aborted.push(record); },
    },
    tokenIssuer: {
      name: "fake-token-issuer",
      version: "1",
      testOnly: true,
      async issue({ generationId }) {
        const token = createHmac("sha256", TEST_SECRET).update(`watermark:${generationId}`).digest();
        return { message: new Uint8Array(token.subarray(0, 2)), tokenHash: sha256Hex(token) };
      },
    },
    replicaCommitter: {
      name: "fake-replica-committer",
      version: "1",
      testOnly: true,
      async commit({ replicaId, policyVersion, voiceProfileId, genomeVersion, profileVersion, calibrationVersion }) {
        return createHmac("sha256", TEST_SECRET)
          .update(bytes(`${policyVersion}:${replicaId}:${voiceProfileId}:${genomeVersion}:${profileVersion}:${calibrationVersion}`))
          .digest("hex");
      },
    },
  };
  return { adapters, events: { opened, segments, sealed, aborted } };
}
