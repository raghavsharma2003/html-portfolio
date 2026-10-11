# Version-bound private replica dialogue

Status: implemented server, Studio and offline adversarial slice on
`voice-cloning`, 2026-08-24. The Azure Foundry protocol is mocked; no live
model quality, latency, cost or fidelity claim is made.

## One reply path

```text
bearer owner + opaque replica id
  -> active immutable runtime capability
  -> approved Person Model + calibration
  -> private (agent_id, person_id) relationship snapshot
  -> recent session turns from erasable raw log
  -> strict structured dialogue model
  -> server safety validation
  -> exact assistant log + content-free turn ledger
  -> optional protected voice for that exact turn id
```

`/api/replica-dialogue` never accepts owner, agent, person, provider or model
identifiers. The server resolves one active capability and compiles only the
typed, approved Person Model and registered calibration strategies. Every
relationship read is scoped to that capability's exact `(agent_id, person_id)`
pair. Recent turns are read only from the same owner-bound session.

Conversation text lives once in `meera_log`, where existing relationship
forget and consolidation machinery can process or erase it. The dialogue turn
stores log ids, version/provider metadata, prompt/response hashes and a
controlled delivery plan; it does not copy the user message or reply. Composite
foreign keys bind session, capability, replica, owner, agent, person, device
and both log rows. A session-owned atomic counter prevents turn-order races.

## Model boundary

The provider-neutral contract produces:

```json
{
  "reply": "...",
  "delivery": {
    "mode": "grounded | warm | playful | direct | repair",
    "pace": "slow | natural | brisk",
    "intensity": 0.62,
    "language_hint": "Hinglish",
    "nonverbals": ["pause"]
  }
}
```

Unknown fields and invalid enums fail closed. The server also blocks generated
credential/OTP solicitation, payment-transfer requests and false claims of
being the actual human. Conversation messages are labelled untrusted and
cannot override the synthetic-identity, uncertainty, privacy or anti-fraud
runtime laws. These deterministic checks are a safety layer, not a substitute
for an independently evaluated policy model and red team.

The production adapter uses Azure Foundry Model Inference chat completions with
strict JSON schema, following Microsoft's [REST
reference](https://learn.microsoft.com/en-us/rest/api/microsoftfoundry/model-inference/get-chat-completions/get-chat-completions?view=rest-microsoftfoundry-model-inference-2024-05-01-preview)
and [structured outputs guidance](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs).
It requires `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_DIALOGUE_MODEL` and
`AZURE_FOUNDRY_API_KEY`, accepts only HTTPS `*.services.ai.azure.com`, bounds
the whole response-body deadline and does not return provider bodies or
credentials in errors. There is no production fake fallback. A paid turn also
requires the server-only budget limit and current deployed-model input/output
rates. It reserves the maximum call before Azure I/O, settles provider-reported
usage, and returns a reconciliation marker without retrying when settlement is
ambiguous. See [the paid-provider budget](PROVIDER-BUDGET.md).

## Text-to-voice binding

Private conversation audio no longer accepts client-authored text. The client
sends only `replica_id` and the completed `dialogue_turn_id`. The speech server
loads the exact assistant log and derives provider style from the controlled
delivery enum, then the existing generation authorization rechecks the same
capability, Person Model and calibration versions before speech begins.

The resulting PCM still has to pass audible disclosure, watermarking, signed
segment persistence and final C2PA sealing. Calibration is the only speech
purpose that may accept explicit client text, because held-out test phrases are
the object being evaluated; it is restricted to `studio_preview`.

## Fidelity learning

Every completed turn can receive append-only, owner-only ratings for overall
fit, wording, behavior, relationship, memory and delivery. Voice identity is
rateable only after that turn has a sealed protected-audio generation. An
optional owner-authored correction is envelope-encrypted before persistence
and can become an exact rejected/preferred pair for a future qualified model.
It never changes the live prompt or approved calibration automatically. See
[turn fidelity feedback](TURN-FEEDBACK.md).

## Closed gates

- Live identity/liveness/inference consent, migrations 023-027, Azure model and
  production protection adapters are not deployed, so real dialogue remains
  unavailable.
- Migration 028, current subscription rates and an operator-only usage
  reconciliation procedure are also required before the paid adapter is live.
- The first UI is owner-only private self conversation. Other people cannot
  interact with a replica until scoped participant consent, relationship
  authorization, disclosure and per-relationship erasure are implemented.
- Raw log storage currently inherits the database's operational security and
  deletion model; application-layer envelope encryption is still required for
  a production biometric/memory vault.
- No live behavioural, autobiographical, relationship, Hinglish, latency or
  fraud-resistance benchmark has passed. Structural tests are not fidelity.
- The existing consolidator can consume agent-scoped raw turns, but a deployed
  queue/sweeper and replica-specific retention drill are still required before
  claiming durable relationship learning.

Offline gates:

```bash
node evals/run.mjs replicadialogue
node evals/run.mjs replicaruntime
node evals/run.mjs replicaprovenance
node evals/run.mjs replicafeedback
```
