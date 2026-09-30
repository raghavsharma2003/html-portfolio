-- A browser upload grant outlives the HTTP response that delivered it. Source
-- erasure must therefore wait until the last exact-object grant can no longer
-- recreate the original after the provider prefix was observed empty.

alter table vy_replica_source
  add column if not exists upload_authorization_expires_at timestamptz;

-- Existing releases did not record upload-grant expiry, and retry_upload did
-- not touch updated_at. Fence every extant row from migration time for the
-- full two-hour grant plus the shipped Azure block's 80-minute service bound
-- and a ten-minute mixed-version rollout margin. This
-- intentionally delays deletion once; an expired receipt would be unsafe.
update vy_replica_source
   set upload_authorization_expires_at=now()+interval '210 minutes'
 where upload_authorization_expires_at is null;
