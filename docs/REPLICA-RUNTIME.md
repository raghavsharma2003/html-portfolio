# Private replica runtime contract

Status: server/runtime architecture and offline adversarial gate. The route is
deliberately unavailable for production audio until real voice, watermark,
C2PA and protected-signing adapters are connected and qualified.

## Capability, not `latest`

Activation writes `vy_replica_runtime_capability`. It freezes:

- authenticated owner and verified self subject;
- the replica's opaque agent and intrinsic person ids;
- approved Person Model, calibration-policy and VoiceGenome versions;
- one ready disposable provider voice;
- a SHA-256 commitment to the latest passing identity, noisy-robustness,
  behavior, relationship, privacy, abuse and provenance evals;
- the runtime policy version.

Only one capability can be active for a replica. Runtime reads never ask for a
moving latest profile. A retrain is a new candidate that must pass the full
gate and explicitly supersede the previous capability.

## Identity and tenancy

The browser sends `replica_id` plus its Supabase bearer token. The server
resolves `owner_user_id -> subject_person_id -> agent_id` and requires the
account person to equal the self subject. Provider names, provider refs, agent
ids, person ids, qualification hashes, profile definitions and raw memory rows
never enter client responses.

Every relational read uses the exact scalar pair:

```sql
where agent_id = $1 and person_id = $2
```

The current runtime reader covers relationship state, promoted interaction
patterns, rituals, live topics/currencies, shared phrases and kin. A missing
binding fails closed. Another replica cannot express itself in the predicate.

## Prompt compilation

The runtime compiler accepts only builder-owned typed fields for identity,
speech, behavior, values and boundaries. It also accepts registered strategy
ids from one approved calibration policy; the directive is resolved from the
server registry rather than copied from stored or client text. Unknown JSON
keys, forged strategies, transcripts, vectors, provider metadata and arbitrary
evidence blobs are ignored. Dynamic relationship state is rendered separately
and bounded. Evidence is explicitly labelled as data rather than instructions.

This is a minimum safe compiler, not a fidelity claim. Deterministic Person
Model and calibration builders now exist, while claim extraction, learned
preference models and behavior generation still require human evaluation gates.

## Protected cascade

`/api/replica-speech` is a separate authenticated endpoint. The existing
cascade player may send it only an opaque replica id, bearer token, text and
private channel. It cannot select a provider or disable disclosure. If any
replica field is incomplete, or real protection adapters are unavailable, the
endpoint returns no audio.

Replica speech never falls back to Meera, a user-configured ElevenLabs/Sarvam
voice, or device TTS. A wrong human voice is a failed generation, not graceful
degradation. Gemini native live audio also remains disabled for replicas because
it cannot render the qualified external voice identity.

Protected PCM flows through audible disclosure, streaming watermarking, signed
segment commitments and final C2PA sealing. The Neon ledger rechecks active
replica state plus the exact capability-bound voice, VoiceGenome, Person Model
and calibration versions in the same insert that commits each 240 ms segment;
bytes are yielded only after that succeeds. Superseding a capability therefore
cannot accidentally authorize an older generation still in flight.

## Still closed

- real age/identity/liveness and replay verification;
- approved VoiceGenome builder and production behavioral inference adapter;
- a production voice adapter and self-hosted deployment;
- AudioSeal qualification and production embed/detect service;
- HSM-backed segment/receipt signing;
- C2PA generation and independent public verification;
- live schema application, end-to-end latency tests, ABX/human fidelity tests
  and independent abuse/privacy red team.

Offline gate:

```bash
node evals/run.mjs replicaruntime
```
