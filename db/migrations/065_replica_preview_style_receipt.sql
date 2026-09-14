-- Migration 065 - admit the bounded, receipt-bearing preview style written by
-- the multilingual text frontend. Migration 046's 512-byte ceiling predates
-- the text-plan and language-conditioning audit now stored in the same object.
-- Keep the replacement atomic so a statement-by-statement retry can never
-- leave the generation ledger without a size and object-shape constraint.

alter table vy_replica_generation
  drop constraint if exists vy_replica_generation_preview_style_check,
  add constraint vy_replica_generation_preview_style_check
    check (jsonb_typeof(preview_style)='object' and octet_length(preview_style::text)<=2048);
