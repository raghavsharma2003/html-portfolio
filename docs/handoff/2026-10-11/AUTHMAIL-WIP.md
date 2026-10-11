# Azure auth-email WIP checkpoint

Branch: `codex/vyakti-azure-authmail-oct10`.
Base application: `03c285b0`; existing commits `5d49a472` and `fe48f7bf`.
This checkpoint is intentionally isolated from the canonical release branch.

The branch contains a dark-by-default Vyakti-only email lane: Supabase Admin
generates the sign-in link, a durable encrypted outbox guards retries, and Azure
Communication Email is the intended sender. It does not change shared Supabase
SMTP or hooks.

This WIP checkpoint adds three recovery corrections:

- A reader of a `preparing` or `dispatching` row receives a recoverable 409,
  rather than an `accepted` response before the provider has accepted a send.
- Terminal state writes no longer overwrite an already succeeded, failed or
  expired request after a stale concurrent poll.
- Approved Room redirects accept the same optional trailing slash as the route.

It also carries the scoped publication visual/localization pass. These edits are
not merged, deployed, configured or activated.

No Azure resource access key has been read. No Vercel environment variable has
been set. Migration174 has not been run against any database. No email, model,
voice or user action has occurred. The native Azure Email and Communication
resources already exist, but this code must remain dark until development SQL
proof, full release checks, configuration review and a bounded delivery test
complete.

The next agent should run the focused auth-email and publication suites, inspect
the migration174 development helper, then commit/merge only after the database
and full release evidence exist. Do not infer delivery or arbitrary-account
sign-in from fake-store tests.
