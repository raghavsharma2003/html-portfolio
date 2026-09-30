-- Migration 055 — vy_clone_channel: which published clone answers on which
-- surface, and under whose credential.
--
-- Contract: docs/gurukul/SPEC-GURUKUL.md §8 ("cloning through deployment: the
-- clone deploys to students as an app"), docs/SURFACES.md §0 (a surface is a
-- TRANSPORT, never a tenant), docs/gurukul/safety-floor-teacher.md §2.2
-- (revocation deregisters the module rather than asking the clone to stop).
--
-- The sentence this table exists to make true: an expert publishes a clone and
-- puts it in front of their audience on the surfaces that audience already
-- uses, SELF-SERVE, without anyone writing code per customer. Before this
-- table, `api/_surface.js` resolved every inbound event to exactly one agent —
-- `MEERA_AGENT_ID`, named as a constant in two writers — so a second clone on
-- Telegram was a code change, and a hundred clones were a hundred of them.
--
-- Idempotent, one statement per request — 009's law, restated by 051, 052 and
-- 053 and binding here for the same reason: Neon's SQL-over-HTTP endpoint
-- accepts exactly ONE statement per body, db/migrations/apply.mjs runs them
-- individually with no transaction, so every statement below is independently
-- re-runnable and an apply interrupted halfway is recovered by running this
-- same file again, never by manual repair. NO DO blocks and no functions:
-- apply.mjs's splitter is deliberately small and does not handle them.
--
-- ── no foreign keys, same convention as 051/053 ───────────────────────────
-- `agent_id`, `replica_id`, `owner_user_id` are FK-SHAPED and carry no FK
-- constraint. 009 established this for every agent-scoped table and 051
-- restated the reason: the binding is enforced by the WHERE clause, before
-- rank, and a single table whose binding were enforced in the database would
-- read as a stricter rule while actually being an inconsistent one. The
-- indexes below are what make the predicate cheap.
--
-- ── credentials_ref is a uuid, and that is the whole point ────────────────
-- The brief says "a REFERENCE ONLY — never a token in this DB". A `text`
-- column with a comment saying so is a preference; a `uuid` column is a
-- guarantee, because a Telegram bot token (`\d+:[A-Za-z0-9_-]{35}`) or a Meta
-- access token cannot be cast into one. This is migration 053's
-- `oauth_grant_ref` argument transferred verbatim, and it is transferred
-- because the thing being prevented is identical: a live credential for a real
-- teacher's bot sitting in a table that gets selected, logged and joined.
--
-- WHERE THE SECRET ACTUALLY LIVES: `api/_channel-secrets.js`, behind a backend
-- seam. The default backend is `none` and it REFUSES to store anything, so a
-- deployment that has not configured a secret store cannot connect a
-- credentialed channel at all — it fails closed rather than inventing a place
-- to put a token. The configured backend today is Azure Key Vault
-- (`CHANNEL_SECRET_BACKEND=azure-keyvault`), one secret per
-- `credentials_ref`, named `clone-channel-<credentials_ref>`. Postgres never
-- sees the value; this column holds the name's uuid half and nothing else.
--
-- ── the connect gate is a CHECK, not a code path ──────────────────────────
-- safety-floor-teacher.md's governing measurement (`gate0-structural`):
-- "prompt instructions leaked 57-98%; the SQL predicate leaked 0 of 31,122 …
-- A sentence in a brief is a preference; a predicate on the output is a
-- guarantee." So the rule that a THIRD-PARTY channel cannot be 'connected'
-- without both an external address and a credential reference is a table
-- constraint, not merely a branch in api/_clonechannel.js. Both exist; only
-- one of them cannot be forgotten by the next writer, and what it prevents is
-- a channel row that looks live, resolves to a real clone, and has no way to
-- send — which fails at the last possible moment, in front of a student.
--
-- The web kinds are exempt from the credential half and only from that half:
-- an embeddable widget is served by this deployment and authenticates nothing
-- outbound. It still needs an external_ref (its public slug), because a
-- connected channel with no address is a channel nothing can ever route to.
--
-- ── revoked rows are kept ─────────────────────────────────────────────────
-- 051's reason, one axis over: revocation deregisters the binding, it does not
-- delete the record of what was bound and to whom. A revoked row is also what
-- stops the same external_ref being silently re-adopted by a different clone
-- while a partial unique index looks at only the connected ones.

create table if not exists vy_clone_channel (
  channel_id      uuid primary key,
  -- the published clone that answers here. FK-shaped, see the header.
  agent_id        uuid not null,
  -- the studio's handle on the same clone, so the Channels screen can read
  -- and write without first resolving an agent it never shows the owner.
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  kind            text not null
                  check (kind in ('web_embed','web_widget','telegram','whatsapp','instagram_dm')),
  -- the surface's own address for this binding: a Telegram bot id, a WhatsApp
  -- Cloud API phone_number_id, an Instagram page/IG id, or — for the web
  -- kinds — the public slug the embed script carries. OPAQUE: nothing parses
  -- it, exactly as docs/SURFACES.md requires of a chatKey.
  -- '' rather than null so the connect gate below has no three-valued case.
  external_ref    text not null default '',
  -- a reference to a secret, NEVER a secret. See the header for where the
  -- value lives. Nullable because a channel is DRAFT before it is credentialed
  -- — the owner creates the row, then pastes the token into the secret write.
  credentials_ref uuid,
  status          text not null default 'draft'
                  check (status in ('draft','connected','paused','revoked')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- drop-then-add is the idempotent pair for a constraint (051's shape, 009's
-- before it): re-running drops what it just added and adds it back.
alter table vy_clone_channel drop constraint if exists vy_clone_channel_connect_gate;

-- THE GATE. A connected channel has an address; a connected THIRD-PARTY
-- channel also has a credential reference. Every other status may carry nulls.
alter table vy_clone_channel add constraint vy_clone_channel_connect_gate
  check (
    status <> 'connected'
    or (
      external_ref <> ''
      and (kind in ('web_embed','web_widget') or credentials_ref is not null)
    )
  );

-- THE ROUTING INDEX, and it is a uniqueness law rather than a lookup hint:
-- one connected clone per (kind, external_ref). Without it, two clones can
-- claim the same bot and the answer to "who replies on this wire" depends on
-- write ordering — the same defect 051 closed with
-- `vy_teacher_sheet_one_published_ix`, at the surface layer instead of the
-- sheet layer, and with a worse blast radius: a student asking their physics
-- teacher would reach someone else's clone, and every log line would look
-- healthy. Partial, so paused and revoked rows are KEPT (see the header).
create unique index if not exists vy_clone_channel_route_ix
  on vy_clone_channel (kind, external_ref) where status = 'connected';

-- At most one connected channel of a kind per clone. Two live Telegram bots
-- for one clone is not a feature anybody asked for and it makes "which bot is
-- this teacher's" unanswerable.
create unique index if not exists vy_clone_channel_one_per_kind_ix
  on vy_clone_channel (agent_id, kind) where status = 'connected';

-- What the studio's Channels screen reads: this owner's rows for this clone.
create index if not exists vy_clone_channel_owner_ix
  on vy_clone_channel (owner_user_id, replica_id, kind);

-- The reverse direction, for the revocation cascade: every binding a clone has.
create index if not exists vy_clone_channel_agent_ix
  on vy_clone_channel (agent_id, status);
