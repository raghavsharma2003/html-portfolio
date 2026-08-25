# Replica processing job

This is a private Azure Container Apps Job, not a public API. A scheduled or event-driven execution leases a bounded number of database jobs and exits, so idle cost is zero.

The job performs the full evidence chain:

1. Re-read and SHA-256 verify the exact private object.
2. Stream it through current ClamAV signatures. Signature refresh failure blocks the job.
3. Probe the decodable audio stream with `ffprobe`.
4. Call the private GPU voice-evidence service for conservative diarization, two-speaker separation, dual-candidate enhancement and two independent speaker embeddings.
5. Call Azure Speech fast transcription for aligned Hinglish text.
6. Create-only write every derived byte, re-read it, rehash it, persist the immutable manifest/evidence, settle the lease, and enqueue only the next valid DAG stage.

Operational requirements:

- Build this Dockerfile with the repository root as context.
- Private outbound access to Neon, Supabase Storage, the private evidence service, Azure Speech, and ClamAV's signature CDN only.
- Store all credentials as Container Apps secrets. Never place them in job arguments or logs.
- Set a 15-minute replica timeout, one parallel execution initially, and a hard Azure budget alert.
- `AZURE_SPEECH_KEY` is supported initially. Replace it with managed identity once the Speech resource role and token path are deployed and proven.

The worker emits only content-free outcome codes. It never logs tenant IDs, paths, transcripts, vectors, audio, or provider request IDs.

