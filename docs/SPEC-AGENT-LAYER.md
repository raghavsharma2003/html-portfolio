# Phase E — the agent layer: one relational OS, many AI people, many surfaces

Phase C built the relational engine and proved it. It is **single-tenant by
construction**: there is exactly one AI person in it, her name is compiled in,
and her memory is keyed by the human alone. Phase E removes that assumption
without weakening a single property Phase C paid for.

The owner's framing, which is the acceptance test for this document:

> store the whole relationship, culture, preferences, memory etc. in a
> structured manner so that the agent remembers it like a human would and
> interacts like a human would — and later build multiple agents on top of it
> in different forms.

So: **the relationship is the record, the agent is a tenant of it, and the
surface is a transport.** Three separations that do not exist in the tree today.

---

## 0. State of the layer entering Phase E (measured 2026-08-18, live DB)

Read this before believing any diagram.

| claim | reality |
|---|---|
| relational schema exists | **yes** — 24 `vy_*` tables, citations DB-enforced, forget cascade complete |
| it is populated in production | **no** — 41 devices, 2,358 log rows, **2 episodes, 8 facts, 0 rel_state rows** |
| consolidation runs | **once, ever** (2026-08-15, one person, log span 2173–2224) |
| a second AI person can exist | **no** — zero occurrences of `agent_id`/`persona_id` anywhere in `src/`, `api/`, `db/` |
| a second surface can be added cheaply | **no** — `api/tg.js` is 760 bespoke lines; a Discord port is a copy |
| Meera's persona is swappable | **no** — `compiler.ts:27` static-imports `./persona` |

The third row is the one that matters most and is the cheapest to fix.
**A memory architecture that never runs is indistinguishable from no memory
architecture**, and that is the state the product is in right now: she has a
system of record and it is empty. Every "she doesn't remember me" report is
explained by this row, not by the schema above it.

`vercel.json` has no `crons` array. The only trigger is
`src/engine/memory.ts:321`, a fire-and-forget `fetch()` from a live client —
so consolidation happens only if a session is open long enough for the request
to land, and never for the 40 people who are not currently typing.

---

## 1. The three separations

```
   PERSON            ×          AGENT           ×        SURFACE
   who the human is        which AI person         how bytes arrive
   ─────────────           ───────────────         ────────────────
   vy_person               vy_agent                vy_surface_identity
   vy_person_device        persona module          api/_surface.js
   surface identities      register config         tg / discord / wa / web

        └──────────── the relationship lives at (agent × person) ────────────┘
                 episodes, facts, rel_state, patterns, phrases,
                 rituals, currency, kin, taste, shared moments
```

**Person is shared. Agent scopes the relationship. Surface scopes nothing.**

That last clause is load-bearing. A user who talks to Meera on Telegram and
then on the web is the *same relationship* — the surface is a phone line, not a
different friend. Anything that keys memory by surface reintroduces the amnesia
we are trying to delete.

---

## 2. Law E1 — agent isolation is structural, never behavioural

Phase C's `structural-disclosure` law says person B's private material never
enters person A's context, and it is enforced as one numbered SQL predicate
before rank (`api/_disclosure.js`) rather than as a prompt instruction, because
everything behavioural measured 9–90% residual leakage.

**Law E1 extends that predicate from person↔person to agent↔agent, verbatim
and for the same reason.** What Meera learned about you is not available to any
other AI person on this stack. Not by policy, not by prompt — by a `WHERE`
clause that makes the row unreachable.

Consequence, accepted deliberately: **a second agent starts from zero with a
user Meera knows well.** That is not a limitation to engineer around, it is the
correct behaviour. A new friend does not inherit your old friend's knowledge of
you, and a product where they do is the betrayal engine `multiparty-direction`
already named. Cross-agent sharing, if it is ever wanted, arrives the way
DM→room disclosure did: an explicit, cited, user-granted row — never a default.

### What is agent-scoped vs person-intrinsic

**Agent-scoped** (the relationship, and everything derived from it):
`vy_episode`, `vy_fact`, `vy_rel_state`, `vy_rel_event`, `vy_pattern`,
`vy_phrase`, `vy_ritual`, `vy_currency`, `vy_kin`, `vy_india_profile`,
`vy_taste_candidate`, `vy_shared_moment`, `vy_visual_assertion`,
`vy_embedding`, `vy_derivation`, `vy_session`, `vy_group`, `vy_group_member`,
`vy_disclosure_grant`, `vy_group_turn`.

`vy_kin` and `vy_india_profile` are agent-scoped on purpose despite looking
person-intrinsic. "My mausi is called Bua at home", "I don't eat egg on
Tuesdays" — these were *told to someone*. Filing them as person-global would
mean agent two knows your dietary rules on turn one having never asked, which
is exactly the tell that makes a companion feel like a database with a face.

**Person-intrinsic** (never agent-scoped):
`vy_person` (identity anchor + age tier — a safety property, must not be
re-derivable per agent), `vy_person_device`, `vy_surface_identity`.

**Agent-free** (already carry no person reference):
`vy_model`, `vy_gate_run` — the router/gate machinery is shared infrastructure,
per the generalization audit's item 2.

---

## 3. Law E2 — a persona is a module, and Meera's is unchanged

`compiler.ts` gets an injected `AgentModule` instead of a static import.
`agents/meera.ts` is a **re-export of `persona.ts` with zero content edits**,
so byte-identity (83/83 fixtures), the 138 persona invariants, and the prompt
budget all hold *by construction* rather than by re-measurement.

```ts
export interface AgentModule {
  slug: string;                 // "meera" — matches vy_agent.slug
  displayName: string;
  personaVersion: string;       // part of the CORE cache key
  buildSystemPromptParts(user, messageCount, medium, dimsStage): PromptParts;
  buildSpeechStyle(engine): string;
  WATCH_MODE_NOTE: string;
  SEARCH_DECISION: string;      // appended LAST — prompt-position is mechanism
  FORGET_DECISION: string;      // appended LAST
  CRISIS_LINES: string;         // invariant-protected, never optional
  register: {
    script: "latin" | "deva";
    honorificSystem: "hi-TV" | "none";
    hindiMarkers?: string[];    // feeds cs_ratio / detectAddressTerm
  };
}
```

Two rules any future agent module inherits and cannot opt out of:

1. **`recited-prompt`** — write shapes, never lines the agent could say. Twice
   measured, twice expensive.
2. **`prompt-position`** — `SEARCH_DECISION` and `FORGET_DECISION` are appended
   last. A rule buried mid-brief fired 0/8; the identical rule appended last
   fired 8/8.

The safety floor (crisis helplines, never-deny-being-an-AI, NEVER MANIPULATE,
honest forget) is **not** a per-agent choice. It is asserted by the invariant
suite against every registered module, not just Meera's.

### The register dimensions are Hindi-specific, and that is not fixed here

`vy_rel_state.honorific ∈ (tu,tum,aap)` and `cs_on_stress` encode a T–V
distinction and a code-switch axis that exist in Hindi/Urdu and do not exist in
English or Japanese. The generalization audit classified this **(c) STRUCTURAL**
— redesign, not config.

**Phase E does not touch it.** Every agent on the near-term roadmap (Meera plus
the Indian human-agent surfaces) is a Hinglish agent, so the axis is correct for
all of them, and `register.honorificSystem: "none"` is reserved in the interface
as the seam a future non-T–V agent widens. Building the abstraction now would be
paying for a generality nothing has asked for, against a dimension whose
replacement shape we cannot yet name.

---

## 4. Law E3 — a surface is a transport, and it implements four functions

`vy_tg_person(tg_user_id → person_id)` generalizes to:

```sql
vy_surface_identity(
  surface        text,      -- 'telegram' | 'discord' | 'whatsapp' | 'web'
  surface_user_id text,
  person_id      uuid not null,
  handle         text not null default '',
  linked_at      timestamptz not null default now(),
  primary key (surface, surface_user_id)
)
```

Note what is **absent**: no `agent_id`. Identity resolution is agent-independent
— the same human, whoever they are talking to. The agent enters at retrieval,
not at identification.

`api/_surface.js` defines the contract. A surface adapter implements exactly:

| function | job |
|---|---|
| `verify(req)` | authenticate the webhook (secret header / signature) |
| `parse(payload) → InboundEvent[]` | normalize to `{surface, surfaceUserId, chatKey, kind, text, isGroup, adminBits}` |
| `send(chatKey, OutboundMessage)` | deliver |
| `render(text) → native` | media tags → this surface's own affordances |

Everything else — identity resolve, room ensure, roster, disclosure, recall,
compile, think, log, consolidate-trigger — lives once in `_surface.js` and is
shared. The measure of success: **a new surface is under ~200 lines**, and
`api/tg.js` shrinks toward that number rather than being left as the exception.

`render()` is where surfaces genuinely differ and must not be flattened:
Telegram has native voice notes and animated stickers, Discord has embeds and
2,000-char limits, WhatsApp Cloud API has a 24-hour customer-service window and
template-message rules outside it. The contract makes those *adapter* concerns
instead of leaking into the engine.

---

## 5. Law E4 — memory that is not consolidated does not exist

Consolidation moves the raw log into the structured layer. Today it is
client-triggered and has effectively never run (§0). Phase E makes it
**scheduled and idempotent**:

1. A sweep endpoint that selects persons with un-consolidated log spans
   (`meera_log.id > coalesce(max(vy_episode.log_to), 0)` per person) and
   processes them oldest-first under a per-run budget.
2. A cron entry in `vercel.json` (hourly), plus the existing client trigger kept
   as a latency optimisation, not as the mechanism.
3. A **backfill** over the 2,358 existing log rows, so the 40 people who have
   already talked to her get the relationship they already earned.
4. Observability: a `vy_derivation`-backed counter so "how far behind is
   consolidation" is a query, not a guess.

The `error-marked-done` law applies to the sweep's resume state: a person is
consolidated only when **episodes exist**, never when an attempt was made.
And `relstate-zero-rows` applies to its writers: every table has exactly one
named first-row owner and derivers are upserts.

---

## 6. Migration 009 — shape and safety

Additive, idempotent, one statement per request (Neon SQL-HTTP accepts exactly
one; `db/migrations/apply.mjs` splits and runs them individually, so **every
statement must be independently re-runnable**).

```sql
create table if not exists vy_agent (
  agent_id       uuid primary key,
  slug           text not null unique,
  display_name   text not null,
  persona_version text not null default '',
  register       jsonb not null default '{}'::jsonb,
  status         text not null default 'active'
                 check (status in ('active','paused','retired')),
  created_at     timestamptz not null default now()
);
```

Meera's id is the fixed constant
`MEERA_AGENT_ID = 'a0000000-0000-4000-8000-00000000meer'`-shaped uuid pinned in
`db/migrations/009_agents.sql` and mirrored in `src/engine/agents/registry.ts`,
asserted equal by a verify script (same pattern as `OPERATIONAL_CORE_CAP`,
which is mirrored rather than imported and CI-asserted).

Per agent-scoped table:

```sql
alter table <t> add column if not exists agent_id uuid;
update <t> set agent_id = '<meera>' where agent_id is null;   -- idempotent
alter table <t> alter column agent_id set default '<meera>';
alter table <t> alter column agent_id set not null;
create index if not exists <t>_agent_person on <t>(agent_id, person_id);
```

The default is what keeps every existing call site correct while the code is
migrated: a writer that does not yet know about agents writes Meera's rows, as
it does today. The default is **removed** in migration 010, after the
agent-scope predicate is proven, so that a forgotten call site fails loudly
instead of silently filing another agent's memory under Meera.

Primary keys that must become composite:

| table | was | becomes |
|---|---|---|
| `vy_rel_state` | `(person_id)` | `(agent_id, person_id)` |
| `vy_ritual` | `(person_id, key)` | `(agent_id, person_id, key)` |
| `vy_currency` | `(person_id, topic)` | `(agent_id, person_id, topic)` |
| `vy_india_profile` | `(person_id)` | `(agent_id, person_id)` |

A PK change is the one non-additive act here. It is safe **only** because these
tables hold 0 rows in production (§0) — measured, not assumed. Re-check the
counts at apply time; if any is non-zero, the drop-and-recreate becomes a
copy-through-temp and this document is wrong until amended.

`PERSON_TABLES` in `api/memory.js` gains `agent: true` on scoped rows. **The
forget cascade must remain complete**: a full wipe of a person deletes their
rows across *all* agents (it is their data, not the agent's), while a
per-agent wipe deletes only that agent's. Both paths get a test; the first is
the existing proven property and may not regress.

---

## 7. Gates — nothing lands without these

| gate | bar | why it exists |
|---|---|---|
| G-E1 agent isolation | 0 cross-agent rows retrieved, n≥300, two-agent fixture | Law E1; same shape as multiparty Gate 0 |
| G-E2 byte-identity | 83/83 compiler fixtures unchanged | Meera's prompt must not move |
| G-E3 persona invariants | 138/138, run against **every** registered module | the safety floor is not per-agent |
| G-E4 prompt budget | `scripts/check-prompt-budget.mjs` passes | silent truncation ate the helplines once |
| G-E5 forget completeness | full wipe leaves 0 rows across all agents; per-agent wipe leaves the other agent intact | the proven property, extended |
| G-E6 disclosure unchanged | multiparty Gate 0 still 0 violations | agent_id must not open a person↔person path |
| G-E7 consolidation liveness | backfill produces episodes for ≥90% of persons with ≥20 log rows | Law E4 — the number that says memory is real |

`node scripts/verify-release.mjs` (tsc + prompt budget + build) remains the
outer gate. `npx vite build` alone is not a gate — it exits 0 with type errors.

---

## 8. Workstreams and exclusive file ownership

The §13 collision contract from `SPEC.md` applies: **every file has exactly one
owning workstream**, cross-workstream needs go through declared interfaces, and
no workstream edits another's files. This rule exists because two agents once
edited `liveCall.ts` concurrently.

| WS | owns | may not touch |
|---|---|---|
| **WS-AGENT-SCHEMA** | `db/migrations/009_agents.sql`, `db/schema.sql`, `api/memory.js` (PERSON_TABLES only) | `src/engine/*` |
| **WS-AGENT-PERSONA** | `src/engine/agents/*`, `src/engine/compiler.ts`, `evals/persona-invariants.mjs` | `persona.ts` (READ-ONLY), `api/*` |
| **WS-AGENTSCOPE** | `api/_agentscope.js`, `evals/agent/*` | `api/_disclosure.js`, `db/*` |
| **WS-SURFACE** | `api/_surface.js`, `api/tg.js`, `api/discord.js`, `api/whatsapp.js`, `api/_room.js` | `api/consolidate.js` |
| **WS-CONSOLIDATE-RUN** | `api/consolidate-sweep.js`, `vercel.json`, `scripts/backfill-consolidate.mjs` | `api/consolidate.js` internals beyond its exported entry |

`src/engine/persona.ts` is READ-ONLY for the whole phase. Its 45k characters are
the product; nothing in a tenancy refactor has any business editing them.

---

## 9. What this phase deliberately does NOT do

- **Cross-agent memory sharing.** Reserved for an explicit cited grant, never a
  default (§2).
- **Non-T–V register dimensions.** The seam is reserved, the redesign is not
  attempted (§3).
- **A second real persona.** The layer must be able to hold one; authoring one
  is product work with its own charm gates, and shipping an unloved second
  agent to prove a schema is backwards.
- **Voice/watch lanes on non-web surfaces.** Telegram voice notes are a
  `render()` concern; the live audio floor is not portable and is not portable
  cheaply (see `rejected.md#live-model-swap`).
- **Retiring the `meera_*` legacy log.** `vy_episode.log_from/log_to` still cite
  it. Generalizing that anchor is real work (generalization audit item 5) and it
  is not on the critical path for multi-agent, because a second agent can cite
  the same log table with its own `agent_id` scoping. Logged, deferred, named.

---

## 10. Reversal conditions

- **E1 reverses if** a measured design shows cross-agent behavioural filtering
  reaching near-zero leakage at n≥300 — the same bar `structural-disclosure`
  set for its own reversal. Until then, structure only.
- **E2 reverses if** injecting the persona module measurably moves Meera's
  compiled bytes or trips an invariant — in which case the static import stays
  and multi-agent waits for a compiler rewrite rather than a seam.
- **E3 reverses if** two real surfaces cannot be expressed in the four
  functions without the engine learning surface-specific behaviour — then the
  contract is wrong and adapters stay bespoke.
- **E4 reverses if** scheduled consolidation costs more than the relational
  layer returns in measured recall quality — the one thing here with a running
  cost, and the one most likely to need a budget rather than a cron.
