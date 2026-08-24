import { createHash } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cleanGenerationId(value) {
  const generationId = String(Array.isArray(value) ? value[0] : value || "").trim().toLowerCase();
  if (!UUID.test(generationId)) throw Object.assign(new Error("generation_id_invalid"), { status: 400 });
  return generationId;
}

export function createReplicaProvenanceHandler({ db }) {
  if (typeof db !== "function") throw new Error("provenance db required");
  return async function replicaProvenance(req, res) {
    const generationId = cleanGenerationId(req.query?.generation_id);
    const kind = String(Array.isArray(req.query?.kind) ? req.query.kind[0] : req.query?.kind || "receipt");
    if (kind === "manifest") {
      const rows = await db(
        `select encode(m.manifest_bytes,'base64') as manifest_base64,m.manifest_sha256
           from vy_replica_c2pa_manifest m
           join vy_replica_generation_receipt r
             on r.generation_id=m.generation_id
            and r.manifest_sha256=m.manifest_sha256
            and r.provenance_standard=m.standard
          where m.generation_id=$1`,
        [generationId],
      );
      if (!rows[0]) return res.status(404).json({ error: "provenance_not_found" });
      const bytes = Buffer.from(String(rows[0].manifest_base64 || ""), "base64");
      if (bytes.length < 64 || bytes.length > 1_048_576 || sha256(bytes) !== rows[0].manifest_sha256)
        throw new Error("stored_manifest_invalid");
      res.setHeader("Content-Type", "application/c2pa");
      res.setHeader("Content-Disposition", `inline; filename="${generationId}.c2pa"`);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.status(200).send(bytes);
    }
    if (kind !== "receipt") return res.status(400).json({ error: "provenance_kind_invalid" });
    const rows = await db(
      `select r.generation_id,r.replica_commitment,r.policy_version,r.channel,
              r.disclosure_scheme,r.disclosure_text_hash,r.watermark_algorithm,
              r.watermark_token_hash,r.detector_policy_hash,r.provenance_standard,
              r.manifest_location,r.manifest_sha256,r.audio_sha256,r.segment_count,
              r.final_chain_sha256,r.envelope_sha256,r.signature_algorithm,
              r.signer_key_id,r.envelope_signature,r.issued_at,
              encode(e.envelope_canonical,'base64') as signed_envelope_base64
         from vy_replica_generation_receipt r
         join vy_replica_generation_receipt_envelope e
           on e.generation_id=r.generation_id and e.envelope_sha256=r.envelope_sha256
        where r.generation_id=$1`,
      [generationId],
    );
    if (!rows[0]) return res.status(404).json({ error: "provenance_not_found" });
    const envelope = Buffer.from(String(rows[0].signed_envelope_base64 || ""), "base64");
    if (envelope.length < 128 || envelope.length > 16_384 || sha256(envelope) !== rows[0].envelope_sha256)
      throw new Error("stored_envelope_invalid");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    return res.status(200).json(Object.freeze({
      schema: "vyakti.generation-receipt.public.v1",
      ...rows[0],
      manifest_url: `/api/replica-provenance?generation_id=${generationId}&kind=manifest`,
    }));
  };
}
