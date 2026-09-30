-- Migration 068 - short-lived, source-cited expression observations.
--
-- This is an observation ledger, not an emotion or personality profile. One
-- row stores one measurable delivery or turn-taking feature. There is no free
-- text label column and the feature vocabulary is closed, so an inner-state
-- claim cannot be smuggled into the value that later readers consume.

create unique index if not exists vy_replica_expression_scope_ix
  on vy_replica (replica_id, owner_user_id, agent_id);

create unique index if not exists vy_replica_source_expression_scope_ix
  on vy_replica_source (source_id, replica_id, owner_user_id, sha256);

create unique index if not exists vy_mirror_session_expression_scope_ix
  on vy_mirror_session (session_id, replica_id, owner_user_id);

create unique index if not exists vy_mirror_window_expression_scope_ix
  on vy_mirror_window (window_id, session_id, replica_id, owner_user_id);

create unique index if not exists vy_mirror_turn_expression_scope_ix
  on vy_mirror_turn (turn_id, window_id, session_id, replica_id, owner_user_id);

create table if not exists vy_replica_expression_observation (
  observation_id          text primary key
                          check (observation_id ~ '^obs_[0-9a-f]{64}$'),
  replica_id               uuid not null,
  owner_user_id            uuid not null,
  source_id                uuid not null,
  source_commitment_id     text not null
                          check (source_commitment_id ~ '^src_[0-9a-f]{64}$'),
  source_record_hash       text not null
                          check (source_record_hash ~ '^[0-9a-f]{64}$'),
  source_content_sha256    text not null
                          check (source_content_sha256 ~ '^[0-9a-f]{64}$'),
  source_consent_id        uuid not null,

  -- Generic turn scope is required by the expression contract. Mirror ids are
  -- additional typed links when this observation came from Mirror Call.
  session_id               uuid,
  window_id                uuid,
  mirror_turn_id           uuid,
  turn_id                  text not null
                          check (turn_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  dyad_id                  text not null
                          check (dyad_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  agent_id                 uuid,
  person_id                uuid,

  span_unit                text not null
                          check (span_unit in ('audio_ms','video_ms','utf8_bytes')),
  span_start               bigint not null check (span_start >= 0),
  span_end                 bigint not null check (span_end > span_start),
  span_content_sha256      text not null
                          check (span_content_sha256 ~ '^[0-9a-f]{64}$'),
  span_hash                text not null
                          check (span_hash ~ '^[0-9a-f]{64}$'),

  -- Closed numeric vocabulary. These are delivery and interaction mechanics,
  -- never psychological, medical, affective, intent, or inner-emotion labels.
  feature_name             text not null check (feature_name in (
                            'speech_rate_wpm','articulation_rate_sps',
                            'pause_ratio','mean_pause_ms','pause_count',
                            'turn_latency_ms','turn_duration_ms',
                            'overlap_ratio','interruption_count','backchannel_count',
                            'laughter_ratio','laughter_count',
                            'energy_rms_db','pitch_median_hz','pitch_range_hz',
                            'voiced_ratio','emphasis_rate','code_switch_ratio',
                            'token_count','syllable_count'
                          )),
  feature_value            double precision not null,
  feature_unit             text not null check (feature_unit in (
                            'words_per_minute','syllables_per_second','ratio',
                            'milliseconds','count','decibels_rms','hertz',
                            'events_per_minute'
                          )),

  epistemic_status         text not null check (epistemic_status in ('observed','inferred')),
  confidence               double precision not null check (confidence between 0 and 1),
  producer_kind            text not null
                          check (producer_kind in ('direct_measurement','model','rules','human_annotation')),
  producer_name            text not null
                          check (producer_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  producer_revision        text not null
                          check (producer_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  producer_code_hash       text not null
                          check (producer_code_hash ~ '^[0-9a-f]{64}$'),
  calibration_status      text not null check (calibration_status in ('calibrated','uncalibrated')),
  calibration_method      text not null
                          check (calibration_method ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  calibration_revision    text not null
                          check (calibration_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'),
  calibration_sample_size integer not null check (calibration_sample_size >= 0),
  calibration_dataset_hash text,
  calibration_measured_at timestamptz,

  observed_at              timestamptz not null,
  expires_at               timestamptz not null,
  compiler_revision        text not null check (compiler_revision='experience-compiler-contract-v1'),
  claim_target             text not null check (claim_target='delivery_cue'),
  interpretation           text not null check (interpretation='observer_interpretation'),
  may_claim_inner_emotion  boolean not null default false
                          check (may_claim_inner_emotion=false),
  record_hash              text not null unique
                          check (record_hash ~ '^[0-9a-f]{64}$'),
  created_at               timestamptz not null default now(),

  constraint vy_replica_expression_observation_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_expression_observation_agent_scope_fk
    foreign key (replica_id, owner_user_id, agent_id)
    references vy_replica(replica_id, owner_user_id, agent_id) on delete cascade,
  constraint vy_replica_expression_observation_person_fk
    foreign key (person_id) references vy_person(person_id) on delete cascade,
  constraint vy_replica_expression_observation_source_fk
    foreign key (source_id, replica_id, owner_user_id, source_content_sha256)
    references vy_replica_source(source_id, replica_id, owner_user_id, sha256) on delete cascade,
  constraint vy_replica_expression_observation_consent_fk
    foreign key (source_consent_id, replica_id, owner_user_id)
    references vy_replica_consent(consent_id, replica_id, owner_user_id),
  constraint vy_replica_expression_observation_session_fk
    foreign key (session_id, replica_id, owner_user_id)
    references vy_mirror_session(session_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_expression_observation_window_fk
    foreign key (window_id, session_id, replica_id, owner_user_id)
    references vy_mirror_window(window_id, session_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_expression_observation_turn_fk
    foreign key (mirror_turn_id, window_id, session_id, replica_id, owner_user_id)
    references vy_mirror_turn(turn_id, window_id, session_id, replica_id, owner_user_id) on delete cascade,

  constraint vy_replica_expression_observation_mirror_scope check (
    (session_id is null and window_id is null and mirror_turn_id is null)
    or
    (session_id is not null and
      (window_id is not null or mirror_turn_id is null) and
      (mirror_turn_id is null or window_id is not null))
  ),
  constraint vy_replica_expression_observation_turn_binding
    check (mirror_turn_id is null or turn_id=mirror_turn_id::text),
  constraint vy_replica_expression_observation_finite
    check (feature_value > '-Infinity'::double precision
      and feature_value < 'Infinity'::double precision),
  constraint vy_replica_expression_observation_feature_shape check (
    (feature_name='speech_rate_wpm' and feature_unit='words_per_minute' and feature_value between 0 and 1000)
    or (feature_name='articulation_rate_sps' and feature_unit='syllables_per_second' and feature_value between 0 and 50)
    or (feature_name in ('pause_ratio','overlap_ratio','laughter_ratio','voiced_ratio','code_switch_ratio')
      and feature_unit='ratio' and feature_value between 0 and 1)
    or (feature_name in ('mean_pause_ms','turn_latency_ms') and feature_unit='milliseconds' and feature_value between 0 and 300000)
    or (feature_name='turn_duration_ms' and feature_unit='milliseconds' and feature_value between 1 and 86400000)
    or (feature_name in ('pause_count','interruption_count','backchannel_count','laughter_count')
      and feature_unit='count' and feature_value between 0 and 10000 and feature_value=trunc(feature_value))
    or (feature_name in ('token_count','syllable_count')
      and feature_unit='count' and feature_value between 0 and 1000000 and feature_value=trunc(feature_value))
    or (feature_name='energy_rms_db' and feature_unit='decibels_rms' and feature_value between -200 and 50)
    or (feature_name in ('pitch_median_hz','pitch_range_hz') and feature_unit='hertz' and feature_value between 0 and 5000)
    or (feature_name='emphasis_rate' and feature_unit='events_per_minute' and feature_value between 0 and 1000)
  ),
  constraint vy_replica_expression_observation_epistemic_producer check (
    (epistemic_status='observed' and producer_kind in ('direct_measurement','human_annotation'))
    or
    (epistemic_status='inferred' and producer_kind in ('model','rules'))
  ),
  constraint vy_replica_expression_observation_calibration_shape check (
    (calibration_status='uncalibrated' and calibration_sample_size=0
      and calibration_dataset_hash is null and calibration_measured_at is null)
    or
    (calibration_status='calibrated' and calibration_sample_size>0
      and calibration_dataset_hash ~ '^[0-9a-f]{64}$' and calibration_measured_at is not null)
  ),
  constraint vy_replica_expression_observation_expiry check (
    expires_at>observed_at and expires_at<=observed_at+interval '24 hours'
  )
);

create index if not exists vy_replica_expression_observation_active_ix
  on vy_replica_expression_observation
    (owner_user_id, replica_id, expires_at, observed_at desc);

create index if not exists vy_replica_expression_observation_dyad_ix
  on vy_replica_expression_observation
    (owner_user_id, replica_id, dyad_id, observed_at desc);

create index if not exists vy_replica_expression_observation_source_ix
  on vy_replica_expression_observation
    (source_id, span_start, span_end, feature_name);
