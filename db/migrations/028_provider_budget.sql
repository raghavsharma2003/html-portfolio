-- Migration 028 - content-free, atomic paid-provider budget control.
--
-- The Azure sponsorship is finite. Reservations are charged against one
-- server-configured ceiling before a provider call; actual usage settles the
-- reservation afterwards. No prompt, transcript, reply, owner id or replica id
-- is stored in this ledger.

create table if not exists vy_provider_budget (
  budget_id           text primary key,
  currency            text not null default 'USD' check (currency='USD'),
  limit_microusd      bigint not null check (limit_microusd > 0),
  reserved_microusd   bigint not null default 0 check (reserved_microusd >= 0),
  spent_microusd      bigint not null default 0 check (spent_microusd >= 0),
  state               text not null default 'active' check (state in ('active','paused','exhausted')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint vy_provider_budget_total_check check (spent_microusd + reserved_microusd <= limit_microusd)
);

create table if not exists vy_provider_spend (
  reservation_id       uuid primary key default gen_random_uuid(),
  budget_id             text not null references vy_provider_budget(budget_id) on delete restrict,
  operation             text not null check (operation in ('claim_extraction','dialogue','transcription','voice_training','synthesis','liveness','watermarking')),
  provider_family       text not null,
  provider_name         text not null,
  provider_version      text not null,
  model                  text not null,
  request_hash           text not null,
  unit_kind              text not null check (unit_kind in ('tokens','characters','audio_ms','requests')),
  reserved_input_units   bigint not null default 0 check (reserved_input_units >= 0),
  reserved_output_units  bigint not null default 0 check (reserved_output_units >= 0),
  actual_input_units     bigint check (actual_input_units is null or actual_input_units >= 0),
  actual_output_units    bigint check (actual_output_units is null or actual_output_units >= 0),
  reserved_microusd      bigint not null check (reserved_microusd > 0),
  actual_microusd        bigint check (actual_microusd is null or actual_microusd >= 0),
  state                  text not null default 'pending'
                         check (state in ('pending','reserved','in_flight','settled','released','reconcile_required')),
  failure_code           text not null default '',
  created_at             timestamptz not null default now(),
  settled_at             timestamptz,
  updated_at             timestamptz not null default now(),
  constraint vy_provider_spend_request_hash check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_provider_spend_request_unique unique (budget_id,operation,request_hash)
);

create index if not exists vy_provider_spend_state_ix
  on vy_provider_spend (budget_id,state,created_at);

create index if not exists vy_provider_spend_provider_ix
  on vy_provider_spend (provider_name,model,created_at desc);
