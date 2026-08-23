import { createHash } from "node:crypto";
import {
  PROVENANCE_POLICY,
  PROVENANCE_SEGMENT_BYTES,
  EMPTY_CHAIN_SHA256,
  SYNTHETIC_AUDIO_DISCLOSURE,
  assertByteStream,
  assertDisclosureProof,
  assertGenerationAuthorization,
  assertManifestProof,
  assertPcmFormat,
  assertProtectionAdapters,
  assertWatermarkProof,
  canonicalJson,
  createUnsignedEnvelope,
  createSegmentEnvelope,
  publicReceiptFromEnvelope,
  publicSegmentReceipt,
} from "./contracts.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function errorCode(error) {
  return String(error?.code || error?.message || "protection_failed").slice(0, 120);
}

function assertAudioChunk(chunk) {
  if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) throw new Error("invalid_pcm_chunk");
  if (chunk.byteLength % 2 !== 0) throw new Error("unaligned_pcm_chunk");
  return chunk;
}

async function bestEffortAbort(ledger, authorization, error) {
  try {
    await ledger.abort({
      generationId: authorization.generationId,
      replicaId: authorization.replicaId,
      ownerUserId: authorization.ownerUserId,
      traceId: authorization.traceId,
      policyVersion: PROVENANCE_POLICY,
      failureCode: errorCode(error),
    });
  } catch {
    // The caller still receives the protection failure. A production ledger
    // must recover abandoned open rows with its authorized/streaming sweeper.
  }
}

/**
 * Wrap a provider PCM stream in the only allowed replica delivery path.
 *
 * Audible disclosure and streaming watermarking happen before bytes reach the
 * consumer. The public signed receipt is completed after the final protected
 * byte is hashed. Real-time callers must await `completion` after playback;
 * aborted streams are recorded as aborted and never receive a sealed receipt.
 */
export async function protectReplicaStream({
  authorization: authorizationInput,
  sourceStream,
  format,
  adapters,
  signal,
  now = new Date(),
  allowTestAdapters = false,
}) {
  const authorization = assertGenerationAuthorization(authorizationInput, now);
  assertPcmFormat(format);
  assertByteStream(sourceStream);
  assertProtectionAdapters(adapters, { allowTestAdapters });

  const issued = await adapters.tokenIssuer.issue({
    generationId: authorization.generationId,
    replicaId: authorization.replicaId,
    policyVersion: authorization.policyVersion,
  });
  if (!(issued?.message instanceof Uint8Array) || issued.message.byteLength < 2 ||
      !/^[0-9a-f]{64}$/.test(String(issued?.tokenHash || ""))) {
    throw new Error("invalid_watermark_token");
  }
  const replicaCommitment = await adapters.replicaCommitter.commit({
    replicaId: authorization.replicaId,
    policyVersion: authorization.policyVersion,
    voiceProfileId: authorization.voiceProfileId,
    genomeVersion: authorization.genomeVersion,
    profileVersion: authorization.profileVersion,
    calibrationVersion: authorization.calibrationVersion,
  });
  if (!/^[0-9a-f]{64}$/.test(String(replicaCommitment || ""))) throw new Error("invalid_replica_commitment");

  await adapters.ledger.open({
    ...authorization,
    disclosureScheme: "audible-prefix-v1",
    watermarkAlgorithm: `${adapters.watermark.name}@${adapters.watermark.version}`,
    watermarkTokenHash: issued.tokenHash,
    replicaCommitment,
    provenanceStandard: "c2pa-2.4",
  });

  let disclosureResult;
  let watermarkResult;
  try {
    disclosureResult = await adapters.disclosure.prepend({
      stream: sourceStream,
      format,
      text: SYNTHETIC_AUDIO_DISCLOSURE,
      signal,
    });
    assertByteStream(disclosureResult?.stream);
    assertDisclosureProof(disclosureResult?.proof);
    watermarkResult = await adapters.watermark.embed({
      stream: disclosureResult.stream,
      format,
      message: issued.message,
      tokenHash: issued.tokenHash,
      signal,
    });
    assertByteStream(watermarkResult?.stream);
    assertWatermarkProof(watermarkResult?.proof, issued.tokenHash);
  } catch (error) {
    await bestEffortAbort(adapters.ledger, authorization, error);
    throw error;
  }

  const done = deferred();
  // Avoid a process-level unhandled rejection when a consumer abandons a
  // stream and never inspects completion. The original promise still rejects
  // for callers that correctly await it.
  done.promise.catch(() => {});
  let consumed = false;

  const protectedStream = (async function* () {
    if (consumed) throw new Error("protected_stream_already_consumed");
    consumed = true;
    const audioHasher = createHash("sha256");
    let pending = new Uint8Array(0);
    let sequence = 0;
    let byteOffset = 0;
    let chainSha256 = EMPTY_CHAIN_SHA256;
    const commitSegment = async (segmentBytes) => {
      const issuedAt = new Date().toISOString();
      const segment = createSegmentEnvelope({
        authorization,
        sequence,
        byteOffset,
        bytes: segmentBytes,
        previousChainSha256: chainSha256,
        issuedAt,
      });
      const signature = await adapters.signer.sign({
        bytes: new TextEncoder().encode(canonicalJson(segment)),
        purpose: "vyakti-generation-segment-v1",
      });
      const segmentReceipt = publicSegmentReceipt(segment, signature);
      await adapters.ledger.appendSegment({ authorization, receipt: segmentReceipt });
      audioHasher.update(segmentBytes);
      sequence++;
      byteOffset += segmentBytes.byteLength;
      chainSha256 = segment.chainSha256;
      return segmentBytes;
    };
    try {
      for await (const rawChunk of watermarkResult.stream) {
        if (signal?.aborted) throw signal.reason || new Error("delivery_aborted");
        const chunk = assertAudioChunk(rawChunk);
        const combined = new Uint8Array(pending.byteLength + chunk.byteLength);
        combined.set(pending);
        combined.set(chunk, pending.byteLength);
        let cursor = 0;
        while (combined.byteLength - cursor >= PROVENANCE_SEGMENT_BYTES) {
          yield await commitSegment(combined.slice(cursor, cursor + PROVENANCE_SEGMENT_BYTES));
          cursor += PROVENANCE_SEGMENT_BYTES;
        }
        pending = combined.slice(cursor);
      }
      if (pending.byteLength) yield await commitSegment(pending);

      const [disclosureProof, watermarkProof] = await Promise.all([
        disclosureResult.completion ? disclosureResult.completion : disclosureResult.proof,
        watermarkResult.completion ? watermarkResult.completion : watermarkResult.proof,
      ]);
      assertDisclosureProof(disclosureProof);
      assertWatermarkProof(watermarkProof, issued.tokenHash);

      const audioHash = audioHasher.digest("hex");
      const manifest = await adapters.contentCredentials.createManifest({
        generationId: authorization.generationId,
        assetHash: audioHash,
        assetFormat: format,
        title: "AI-generated voice replica",
        claim: {
          generated: true,
          disclosed: true,
          policyVersion: authorization.policyVersion,
        },
      });
      assertManifestProof(manifest, audioHash);
      const sealedAt = new Date().toISOString();
      const envelope = createUnsignedEnvelope({
        authorization,
        replicaCommitment,
        audioHash,
        segmentCount: sequence,
        finalChainSha256: chainSha256,
        disclosure: disclosureProof,
        watermark: watermarkProof,
        manifest,
        issuedAt: sealedAt,
      });
      const ledgerSignature = await adapters.signer.sign({
        bytes: new TextEncoder().encode(canonicalJson(envelope)),
        purpose: "vyakti-generation-receipt-v1",
      });
      const receipt = publicReceiptFromEnvelope(envelope, ledgerSignature);

      // A real ledger adapter must seal the tenant-bound row and insert the
      // immutable public receipt in one database transaction or stored proc.
      await adapters.ledger.seal({
        authorization,
        receipt,
        audioHash,
        watermarkTokenHash: issued.tokenHash,
        manifestHash: manifest.manifestHash,
        segmentCount: sequence,
        finalChainSha256: chainSha256,
        sealedAt,
      });
      done.resolve(receipt);
    } catch (error) {
      await bestEffortAbort(adapters.ledger, authorization, error);
      done.reject(error);
      throw error;
    }
  })();

  return Object.freeze({
    format,
    stream: protectedStream,
    completion: done.promise,
  });
}
