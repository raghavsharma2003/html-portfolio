# Replica erasure

Replica revocation is synchronous. The owner request immediately changes the
replica to `revoked`, revokes all consents and capabilities, ends sessions,
aborts open generations and marks provider voice mappings unusable. Physical
purge is asynchronous because Azure and private object storage are external
systems whose outcomes can be transient or ambiguous.

The authenticated `/api/replica-erasure-sweep` cron runs this dependency chain:

1. move requested replicas to `purging` and mark every voice and source for
   deletion;
2. delete provider Personal Voice and provider consent resources;
3. snapshot and delete each source original plus every exact derived object;
4. remove source processing lineage and scrub/retire contaminated models;
5. delete all remaining replica-local rows, encrypted feedback/evaluation
   assets, audit rows and the replica record through database cascades;
6. delete raw logs, traces, graph nodes, relationship memory, group memory and
   self-layer rows scoped to the replica's own synthetic `agent_id`;
7. delete that synthetic agent and retain only an HMAC-blinded, content-free
   deletion receipt plus the already-public signed media receipts.

Every remote step is disable-first and retryable. Leases are random capabilities
returned once; only domain-separated SHA-256 hashes are stored. Expired leases
are reclaimed and their prior attempts closed. Azure 404 is success. There is
no terminal retry count at which a biometric deletion is abandoned.

The final database purge refuses any agent binding that is not the exact
`replica-<replica UUID>` agent with `register.selfReplica=true`. This prevents a
corrupt row from widening one replica deletion into Meera or another agent.

The revoke response returns one opaque `erasure_request_id`. Replica Studio
stores it in owner-scoped browser storage and polls the authenticated
`erasure_status` operation. While the replica still exists, the lookup is bound
to both owner and job ID. After unlinking, only a domain-separated SHA-256 hash
of the random request capability remains on the content-free receipt. The UI
then reports provider deletion, private-storage deletion, completion time and
the configured backup-expiry date without retaining the person's identity or
replica ID in the receipt.

Required production configuration:

```text
CRON_SECRET=<strong scheduler bearer secret>
REPLICA_ERASURE_RECEIPT_KEY_B64=<32 random bytes, base64>
REPLICA_BACKUP_RETENTION_DAYS=<documented provider retention, 1-90>
```

`REPLICA_BACKUP_RETENTION_DAYS` is not a claim that backups vanished
immediately. It is the configured expiry recorded in the receipt. Production
release still requires a live restore/delete drill against the actual Neon,
Supabase and Azure retention configuration.

Offline gates:

```bash
node evals/run.mjs voiceerasure
node evals/run.mjs sourceerasure
node evals/run.mjs replicaerasure
```
