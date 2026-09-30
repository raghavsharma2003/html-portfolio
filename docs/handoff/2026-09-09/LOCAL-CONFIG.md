# Local expert configuration

The expert studio serves models through Azure. Do not request an OpenRouter key merely because the shared template contains legacy companion settings.

The checked-in `_config.example.js` is an inert module, not a credential file. The development launcher now creates ignored `api/_config.js` from that template only when it is absent, without overwriting an existing file. Real values continue to come from the parent process environment. A static import still needs a module to exist even when environment variables provide its values; this omission caused the earlier local account-handler500.

Source inspection of the handover confirms:

- `api/_db.js` selects `process.env.NEON_URL` before the imported template value.
- `api/_auth.js` selects `process.env.SUPABASE_URL` and `process.env.SUPABASE_KEY` before template values.
- `api/_replica-storage.js` selects the environment for Azure storage account, account key and container; its Supabase storage path similarly supports environment values.
- `scripts/dev-expert.mjs` requires the named isolated development database, checks that the connection targets it, and verifies `current_database()` before serving. It enforces Azure-only model destinations while allowing the configured database and authentication origins.

Do not copy credentials into this repository or expose a production database to make the preview start. Preserve the existing protected local bindings. The handover evidence records a temporary successful account-handler probe, not complete OAuth, OTP delivery, owner authentication or the full upload-to-Meet journey.

After restoring dependencies and authorized environment bindings, use the development launcher rather than serving only Vite's HTML shell. Diagnose a failed handler separately from an unconfigured external provider: the previous Google-unavailable message was caused by a local missing-module error before the Google URL handler executed.
