-- Migration 137: additive issued voice-challenge contract.
-- No backfill: NULL means legacy/unversioned evidence, never inferred locale.
-- Non-v2 legacy policy labels are preserved, not authorized for new serving.
-- Each statement is independently idempotent; no DO block or cross-request
-- transaction is required. Hashes are format-checked here; canonical JSON
-- commitment validation and bank/profile registry checks remain application
-- responsibilities. This migration does not enable the prerequisite profile.

alter table vy_replica_voice_challenge
  add column if not exists issued_locale text,
  add column if not exists sentence_bank_version text,
  add column if not exists verifier_profile text,
  add column if not exists issued_contract jsonb,
  add column if not exists issued_contract_sha256 text;

alter table vy_replica_voice_challenge
  drop constraint if exists vy_replica_voice_challenge_issued_contract_check,
  add constraint vy_replica_voice_challenge_issued_contract_check
  check ((
    (
      issued_locale is null and sentence_bank_version is null
      and verifier_profile is null and issued_contract is null
      and issued_contract_sha256 is null
      and challenge_policy <> 'voice-identity-challenge/v2'
    )
    or
    (
      issued_locale is not null and sentence_bank_version is not null
      and verifier_profile is not null and issued_contract is not null
      and issued_contract_sha256 is not null
      and challenge_policy = 'voice-identity-challenge/v2'
      and reference_genome_version is not null and reference_genome_version > 0
      and issued_locale in ('hi-IN','en-IN')
      and (
        (issued_locale='hi-IN' and sentence_bank_version='identity-bank-hi-deva/v1')
        or (issued_locale='en-IN' and sentence_bank_version='identity-bank-en-latn/v1')
      )
      and verifier_profile='azure-shared-audio/v1'
      and length(issued_contract_sha256)=64
      and issued_contract_sha256 ~ '^[0-9a-f]{64}$'
      and octet_length(issued_contract::text)<=4096
      and case when jsonb_typeof(issued_contract)='object' then (
        -- Both checks are needed: no missing keys and no additional keys.
        issued_contract ?& array[
          'schema','challenge_id','replica_id','owner_user_id','issued_locale',
          'sentence_bank_version','sentence_bank_sha256','sentence_item_id',
          'sentence_hash','nonce_sha256','normalizer_version',
          'decision_policy_version','verifier_profile','verifier_profile_sha256',
          'reference_genome_version'
        ]::text[]
        and (issued_contract - array[
          'schema','challenge_id','replica_id','owner_user_id','issued_locale',
          'sentence_bank_version','sentence_bank_sha256','sentence_item_id',
          'sentence_hash','nonce_sha256','normalizer_version',
          'decision_policy_version','verifier_profile','verifier_profile_sha256',
          'reference_genome_version'
        ]::text[])='{}'::jsonb
        and jsonb_typeof(issued_contract->'schema')='string'
        and jsonb_typeof(issued_contract->'challenge_id')='string'
        and jsonb_typeof(issued_contract->'replica_id')='string'
        and jsonb_typeof(issued_contract->'owner_user_id')='string'
        and jsonb_typeof(issued_contract->'issued_locale')='string'
        and jsonb_typeof(issued_contract->'sentence_bank_version')='string'
        and jsonb_typeof(issued_contract->'sentence_bank_sha256')='string'
        and jsonb_typeof(issued_contract->'sentence_item_id')='string'
        and jsonb_typeof(issued_contract->'sentence_hash')='string'
        and jsonb_typeof(issued_contract->'nonce_sha256')='string'
        and jsonb_typeof(issued_contract->'normalizer_version')='string'
        and jsonb_typeof(issued_contract->'decision_policy_version')='string'
        and jsonb_typeof(issued_contract->'verifier_profile')='string'
        and jsonb_typeof(issued_contract->'verifier_profile_sha256')='string'
        and jsonb_typeof(issued_contract->'reference_genome_version')='number'
        and issued_contract->>'schema'='vyakti.identity-issued.v1'
        and issued_contract->>'challenge_id'=challenge_id::text
        and issued_contract->>'replica_id'=replica_id::text
        and issued_contract->>'owner_user_id'=owner_user_id::text
        and issued_contract->>'issued_locale'=issued_locale
        and issued_contract->>'sentence_bank_version'=sentence_bank_version
        and issued_contract->>'verifier_profile'=verifier_profile
        and issued_contract->>'decision_policy_version'=challenge_policy
        and issued_contract->'reference_genome_version'=to_jsonb(reference_genome_version)
        and issued_contract->>'sentence_hash'=sentence_hash
        and issued_contract->>'normalizer_version'='challenge-speech-nfkc-digitfold/v1'
        and issued_contract->>'sentence_item_id' in ('item-1','item-2','item-3','item-4','item-5','item-6')
        and length(issued_contract->>'sentence_hash')=64
        and issued_contract->>'sentence_hash' ~ '^[0-9a-f]{64}$'
        and length(issued_contract->>'nonce_sha256')=64
        and issued_contract->>'nonce_sha256' ~ '^[0-9a-f]{64}$'
        and length(issued_contract->>'sentence_bank_sha256')=64
        and issued_contract->>'sentence_bank_sha256' ~ '^[0-9a-f]{64}$'
        and length(issued_contract->>'verifier_profile_sha256')=64
        and issued_contract->>'verifier_profile_sha256' ~ '^[0-9a-f]{64}$'
      ) else false end
    )
  ) is true);

