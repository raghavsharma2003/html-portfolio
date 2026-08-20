# The turn trace — making every turn reconstructible

**Status:** schema frozen, transport live, one leg pending a `brain.ts` hook.
**Owner:** WS-TRACE. **Migration:** `db/migrations/012_turn_trace.sql`.

---

## 0. Why this exists, stated as a failure shape

Four bugs in one session shared one shape: **the artefact existed and nothing
observed it.**

| bug | what existed | what observed it |
|---|---|---|
| realtime lane read an empty recall string every call | the recall response | nothing |
| three tail slots rendered zero bytes everywhere | the compiled tail | a manifest that *asserted* `sourceStatus: "wired"` |
| a deploy workflow died at startup with zero jobs | the workflow file | a reporter that died with it |
| she fabricated an email and a received resume | the prompt she answered from | nothing |

Today "she lied" is answered by reading source code and guessing. After this it
is a query:

```
node scripts/trace.mjs --turn <turn_id>
```

The unit is **one turn**, and a turn is reconstructible when every layer that
touched it left a row keyed to the same `turn_id`.

---

## 1. Four laws

**L1 — Off the critical path, structurally, not by discipline.**
No leg is written by a request the user is waiting on. Server legs ride the
response they were already sending (a few hundred extra bytes on a body already
in flight); the client batches them and posts them later, fire-and-forget, on
the same transport discipline `telemetry.ts` already proves. There is exactly
**one writer** — `api/trace.js` — and it is never on a reply path.
`live-floor` (1.4–1.5 s) and `api/chat.js`'s 720 ms text floor are therefore
untouched by construction, not by care. Measured in §6.

**L2 — References, not copies.**
A trace stores *what row*, *how many bytes*, *how long*, *which branch*. It does
not store what anybody said. Conversation content already lives in `meera_log`
and is referenced by id. This is `telemetry.ts` rule 3, one layer up, and it is
what makes the trace safe to keep for 90 days. §4 states the boundary line by
line.

**L3 — Write-only from the product.**
Nothing in the engine, the prompt, or any API response ever reads
`meera_turn`/`meera_turn_leg`. There is no read endpoint. Reading requires the
`NEON_URL` in the gitignored `api/_config.js`, i.e. an operator on their own
machine running `scripts/trace.mjs`. This is `structural-disclosure` applied to
ourselves: the access rule is the absence of a code path, not a promise. It is
also what keeps `inner.ts` G1 ("her interior never reads the user") and G4 ("her
interior has no UI") true — a trace that fed back would violate G1, and a trace
with a viewer in the app would violate G4.

**L4 — Unknown legs are stored, not rejected.**
`leg` is free text. A schema that can refuse a leg name decides which future
questions are answerable, and it always decides wrong — the leg nobody
allowlisted is the one the incident turns out to be about. (`api/telemetry.js`
learned this for event names; same rule, same reason.)

---

## 2. Schema

Two tables. A denormalised **spine** (one row per turn, upserted by whichever
leg arrives) and an append-only **leg** table (the detail).

The split is not taste. `api/_db.js q()` runs **one statement per request** with
no transactions, so legs arrive from different processes, out of order, and
possibly more than once. A spine that is upserted with `coalesce`/`greatest`
converges regardless of arrival order — the same shape `meera_tel_session`'s
rollup already uses for exactly this reason.

### 2.1 `meera_turn` — the spine

| column | type | what it holds |
|---|---|---|
| `turn_id` | `text` PK | client-minted, `[A-Za-z0-9_-]{8,64}` |
| `agent_id` | `uuid NOT NULL` | explicit, no default (migration 010) |
| `device_id` | `text NOT NULL` | the device (forget/export key) |
| `person_id` | `uuid` | resolved server-side, when known |
| `session_id` | `text` | joins `meera_tel_session` |
| `surface` | `text` | `web` \| `android` \| `telegram` \| `discord` \| `whatsapp` |
| `channel` | `text` | `chat` \| `call` \| `watch` |
| `lane` | `text` | `proxy` \| `openrouter` \| `claude` \| `realtime` \| `heart` |
| `started_at` / `ended_at` | `timestamptz` | `least`/`greatest` on upsert |
| `in_msg_id` / `out_msg_id` | `text` | client message ids (telemetry join) |
| `in_log_id` / `out_log_ids` | `bigint` / `bigint[]` | **`meera_log` rows — the content reference** |
| `in_chars` / `in_kind` | `int` / `text` | shape of the user turn |
| `out_bubbles` / `out_chars` | `int` | shape of her reply |
| `core_hash` / `manifest_hash` | `text` | prompt identity |
| `core_bytes` / `tail_bytes` | `int` | assembly totals |
| `sections` | `jsonb` | **per-slot byte map: `{"T1":210,…,"T13":0}`** |
| `dropped` | `jsonb` | blocks dropped, with priority and reason |
| `recall_bytes` | `int` | bytes of `memories` the turn actually received |
| `retrieval` | `jsonb` | row-id manifest of every read (§3.2) |
| `model` / `served_by` | `text` | requested vs who actually answered |
| `latency_ms` | `int` | model leg wall time |
| `tokens_in` / `tokens_out` / `tokens_cached` | `int` | cost + cache-hit evidence |
| `retries` | `int` | |
| `fallbacks` | `jsonb` | `[{from,to,why}]` — **why**, not just that |
| `flags` | `jsonb` | derived alarms (§5) |
| `legs` | `int` | leg count, incremented by the inserting statement |

> **Reader beware, measured 2026-08-20:** Neon's SQL-over-HTTP endpoint returns
> a `bigint[]` as an array of **strings**, and returns an **empty** array as
> `[""]` — one empty string, not zero elements. `(row.out_log_ids || []).length`
> is therefore `1` for a turn that linked nothing, and a reader that trusts it
> prints a linked-looking `#`. Every id column read goes through
> `logIds()` in `scripts/trace.mjs`.

Indexes: `(agent_id, started_at desc)`, `(device_id, started_at desc)`,
`(person_id, started_at desc)`, `(started_at desc)`, and a **partial** index on
`started_at` `where flags <> '{}'` — the alarm query must never scan the table.

### 2.2 `meera_turn_leg` — the detail

`(id, turn_id, agent_id, device_id, leg, seq, t_ms, payload jsonb, at)`.

`device_id` is present *only* so the forget manifest can wipe it by the same key
as everything else; nothing reads legs by device.

Indexes: `(turn_id, seq)`, `(at)` (retention), `(leg, at desc)`.

### 2.3 Retention, without a scheduler

`never-scheduled` is load-bearing: **no scheduled job has ever run in this
repo**, so a retention cron is a retention policy that does not exist.

Retention is therefore enforced **at write time, in the writing statement**:
every `api/trace.js` batch prepends a CTE that deletes at most 200 rows past the
horizon, chosen by an index range scan on `at`.

```sql
with prune as (
  delete from meera_turn_leg
   where id in (select id from meera_turn_leg where at < $h order by at limit 200)
), ins as ( insert into meera_turn_leg … )
insert into meera_turn … on conflict … 
```

Steady state: one batch carries ≤ 8 legs and deletes up to 200, so the table
cannot outrun its own pruning by more than a burst. Horizons: **legs 30 days,
spine 90 days.** Both are one constant in `api/_trace.js`.

This is the only cron-free retention that survives `never-scheduled`. It costs
one bounded index scan per batch, off the critical path, and it degrades safely:
if the delete finds nothing it costs a `limit 200` on an index and returns.

### 2.4 Forget and export

`meera_turn` and `meera_turn_leg` are added to `PERSON_TABLES` in
`api/memory.js`, keyed `device_id`, lane `legacy` — exactly where `meera_tel`
and `meera_tel_session` already sit. Consequences, both intended:

- a person's whole-wipe destroys their trace rows with everything else;
- a person's export **includes** their trace rows. They contain no conversation
  content (§4), only references and shapes, and they are about that person, so
  a DSAR that omits them would be the wrong answer.

---

## 3. The seven legs

One turn, inside-out. Every leg carries `turn_id`; every payload is shape and
references only.

### 3.1 `ingress`
`surface, channel, device_id, person_id?, agent_id, msg_id, in_kind, in_chars,
attachment{kind, bytes}?, history_len, gap_since_last_ms, tz_offset_min,
platform, app_version, at`.

Not the text. `in_chars` plus `in_log_id` is strictly more useful than a copy:
the copy would drift from `meera_log` after a forget, the reference cannot.

### 3.2 `retrieval` — every read the turn made
Produced **server-side by `opRecall`** and returned on the response it was
already sending.

```
q_chars, q_words_n, ms_total, person_id,
keyword:  { background_ids[], matched_ids[], ms },
semantic: { ok, embed_ms, fact_ids[], ms },
observations: { ids[], n },
relbundle: { present, relstate_present, dims_n, we_episodes_n, phrases_n,
             patterns_n, rituals_n, currency_n, home_region: bool,
             last_honorific_move_at },
selfbundle:{ present, texture_present, arc_n, untold_n },
memories_bytes, blocks[]           // block LABELS, e.g. ["RELEVANT","BACKGROUND"]
```

`*_ids[]` are the row ids. That is the whole point: "why did she say that"
becomes `select * from meera_nodes where id = any(…)`, run by an operator, on
demand — rather than a copy of the summaries sitting in a trace table forever.

`memories_bytes` is the field that would have caught
`realtime-recall-never` in a day: the realtime lane's assembly leg would have
shown a recall of 0 bytes on every single call while the chat lane's showed
1–3 k.

### 3.3 `interior` — `inner.ts`, under the charter
```
thread: { present, sign, w_band: "low"|"mid"|"high", told, age_ms },
wants_n, owed_n, taste: { pulled, kind? }, week_shape,
gate: { moment, pulled }, she_initiated, surface
```

**Her sentence is never stored.** G6 says her judgment generates the behaviour
and the code only decides whether a line is present — so *whether it was
present* is the whole diagnosable fact, and the weight is banded rather than
exact so no consumer can start treating it as a scalar mood. G4 forbids her
interior becoming a surface; L3 (no read path) is what keeps that true of the
trace itself. G1 is preserved because nothing here is ever read back.

### 3.4 `assembly` — the highest-value leg
```
mode, medium, watching, is_directive,
core_bytes, tail_bytes, core_hash, manifest_hash, core_changed,
sections: { T1..T13, watch, culture, mp.roster, mp.bridge },   // BYTES
zero_slots: [ ids whose byte count is 0 ],                     // derived, indexed
dropped:    [ { id, priority, reason } ],
caps: { core: 64000, tail: 24000 }, over_core, over_tail,
age_gates: { romanceRegisters, engagementMechanics }, room: bool
```

`sections` already exists — `compiler.ts` computes it as `tail.length` deltas
around each append, so it *cannot* disagree with what was assembled. The only
thing missing is that `brain.ts` emits it **only when `core_hash` changes**
(§7). Per-turn it is ~200 bytes.

`zero_slots` is the direct answer to `manifest-sourcestatus`: a manifest that
claims `wired` while the block renders nothing is an anti-signal. Bytes are not.

### 3.5 `model`
```
lane, requested_model, served_by: "gemini-free"|"openrouter"|"claude"|"device",
effort, max_tokens, stream, messages_n, images_n,
core_bytes_sent, tail_bytes_sent, core_truncated, tail_truncated,
upstream_status, ms, retries,
fallbacks: [ { from, to, why } ],       // WHY, always
tokens: { in, out, cached, reasoning }, cache_hit_ratio,
finish_reason, empty_guard_fired, pool: { size, tried }
```

`served_by` and `fallbacks[].why` are the fields nothing records today.
`api/chat.js` silently walks free-Gemini → paid OpenRouter, and a turn that
tastes different because the pool was exhausted is currently
indistinguishable from one that is not.

**No key material of any kind.** `pool.tried` is a count. There is no key id,
no key prefix, no key hash — a hash of a secret is still a secret-shaped
identifier and it has no diagnostic value the count does not have.

### 3.6 `egress`
```
bubbles_n, out_chars, media: { photo, voice, gif }, photo_at,
filters: [ { name, dropped_n } ],   // META_LEAK, splitLong, direction-guard, …
spoken: bool, tts_lane, out_msg_id, out_log_ids[], latency_ms, forgot
```

### 3.7 `consolidation`
Written later by `api/consolidate.js`, linked by the `meera_log` ids the turn
already recorded: `{ deriver, episode_ids[], fact_ids[], rel_event_ids[],
texture_ids[], observation_ids[], from_log_ids[] }`.

This is what closes the loop the owner asked for — "what the derivers did later
with this turn". It joins backwards: `meera_turn.out_log_ids` ∩
`vy_episode.log_from..log_to`.

---

## 4. What is stored, what is a reference, what never exists

| never stored | stored as a reference | stored as shape |
|---|---|---|
| the user's message text | `in_log_id`, `in_msg_id` | `in_chars`, `in_kind` |
| her reply text | `out_log_ids`, `out_msg_id` | `out_bubbles`, `out_chars` |
| any prompt text, core or tail | `core_hash`, `manifest_hash` | `sections` byte map |
| recalled memory summaries | `matched_ids[]`, `fact_ids[]` | counts, `memories_bytes` |
| her carried feeling, her wants | — | present/absent, sign, weight band |
| the `[search:]` query | — | `q_chars`, `ok`, `soft` |
| any API key, prefix, or hash of one | — | `pool.size`, `pool.tried` |
| screen-share frames, photos | — | `attachment.kind`, `bytes` |

**Who can read it.** No one, through the product. `api/trace.js` is POST-only
and returns counts. There is no GET, no `op:"trace"`, no admin page. The read
path is `scripts/trace.mjs`, which needs `NEON_URL`. A future viewer must be a
reviewable diff that adds a read path where none exists — which is the property
`_agentscope.js` calls "a property of the clause's shape, not of the value it
was called with".

**What this design still exposes, stated plainly.** An operator with `NEON_URL`
can see, for any person: when they talked, how long their messages were, which
memories were retrieved (by id — and can then look those up), what her interior
state was in shape, and what she was told. That is a real surveillance surface.
It is the same surface `meera_tel` + `meera_log` already grant, and this table
adds *no new content* to it — only structure over what is already there. The
mitigation is the 30/90-day horizon and the absence of a read path, not a
promise about who looks.

---

## 5. Flags — the alarms that make the trace worth reading

Computed at write time in `api/_trace.js`, stored in `flags`, indexed partially.
A flag is a *cheap invariant that has already been violated in production once*:

| flag | fires when | the bug it would have caught |
|---|---|---|
| `recall_empty` | `recall_bytes = 0` on a lane whose sibling is non-zero | `realtime-recall-never` |
| `slot_zero` | a slot declared wired renders 0 bytes | `manifest-sourcestatus`, `selflayer-rows-zero` |
| `tail_over` | `tail_bytes > 24000` | the silent-truncation family |
| `core_over` | `core_bytes > 64000` | crisis helplines, once already |
| `fallback` | `served_by ≠ requested lane` | free-pool exhaustion tasting different |
| `no_person` | `person_id` null on a device with rows | `relstate-zero-rows` shape |
| `empty_reply` | `out_bubbles = 0` | the 200-with-empty-content failure |

---

## 6. Cost — measured, not estimated

All numbers from `node evals/trace/roundtrip.mjs` and `node evals/trace/run.mjs`
against the live database on 2026-08-20. Method and n are stated because a
number without them cannot be compared to a future one.

| | measured | method |
|---|---|---|
| **SQL statements added to `op:"recall"`** | **12 → 12** (zero) | counted at the `fetch`-to-Neon boundary, one paired call |
| wall time on `op:"recall"` | +4 ms median (n=8/arm, alternating) | spreads 369–583 ms vs 359–509 ms — **under the noise floor**; the statement count above is what carries the claim |
| response bytes added to `op:"recall"` | **+593 B** | median of 8, real device, real query |
| SQL statements added to `/api/chat` | **0** | structural: the file imports no `_db.js` at all (asserted in `evals/trace/run.mjs` D) |
| response bytes added to `/api/chat` | ~350 B | one `trace` field / one trailing SSE frame |
| client tap cost | **0.48–0.52 µs per telemetry event** | n=20 000 × 5 alternating blocks, medians; ~8 traced events per turn ⇒ **~4 µs per turn** against a 720 ms floor |
| bytes stored per turn | **4 456 B** (1 120 spine + 3 336 legs) | `pg_column_size`, one full 7-leg turn |
| batch write time | 45 ms | off-path, in `api/trace.js`, awaited there and nowhere else |
| 500 turns/day | 2.2 MB/day → **~100 MB** at 30-day legs + 90-day spine | arithmetic on the row above |

A trace too expensive to keep is a trace that gets turned off. At 100 MB
steady-state this is cheaper than `meera_tel` already is, and it is free on
every path a person is waiting on — not "fast", **free**, because there is no
statement to be slow.

---

## 7. The one thing that is not live: the `brain.ts` hook

`brain.ts` is another workstream's file this cycle. Everything above is wired
except the two client-side legs whose only natural call site is inside
`think()`. Until that hook lands, the client half is reconstructed by
`src/engine/trace.ts` from the `diag()`/`tel()` events `brain.ts` **already
emits** — which yields every field except **per-slot `sections` on turns where
`core_hash` did not change** (they arrive on the first turn of every app run
and after every deploy) and the model leg `api/chat.js` now returns.

### The hook, exactly

Three call sites in `proxyThink`, plus one word deleted from a diag call.
`traceRequestFields` / `traceModelResponse` already exist, are exported, and are
exercised by `evals/trace/run.mjs` section F — so this is a paste, not a
translation, and the seam is not a dead interface waiting for one.

```ts
import { traceRequestFields, traceModelResponse } from "./trace";

// 1. proxyThink's request body — carry the turn id up
body: JSON.stringify({ system, system_tail: …, messages: turns, …,
                       ...traceRequestFields(mode) }),

// 2. proxyThink's non-streaming return — fold the model leg back
const data = await res.json();
traceModelResponse(mode, data);                       // <- added
return typeof data?.text === "string" && data.text.trim() ? data.text : null;

// 3. proxyThink's SSE loop — the same, off the trailing frame
const j = JSON.parse(payload);
if (traceModelResponse(mode, j)) continue;            // <- added
const delta = j?.choices?.[0]?.delta?.content;
```

And in `think()`, the `compile.manifest` diag currently emits `sections` only
inside `...(coreChanged ? { core_bytes, sections } : {})`. **Move `sections` out
of that spread so it is emitted every turn.** Per-slot bytes are the single
highest-value field in the record — they are the only thing that can tell a slot
that is switched off from a slot that is empty from a slot that was never wired
— they cost ~200 bytes, and the throttle was sized for a different consumer
(`core_bytes` can stay throttled; it only changes when the hash does).
