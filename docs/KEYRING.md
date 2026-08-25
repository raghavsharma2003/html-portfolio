# The Google key pool — labels, RCA, and how to add keys

The free-tier Gemini pool is how Maya runs at $0. Each key is a separate AI
Studio account with its own daily quota; the pool walks them, cools a key that
429s, and only spends the paid/Azure lanes when free capacity is gone
(`api/_gkeys.js`, and the resilience ladder in `api/_lanes.js`).

**Never commit a key.** Keys live only in gitignored files and in the Vercel
env. This doc contains no keys — only the label scheme and the RCA method.

## The label scheme (for RCA)

Every pool entry may carry an **owner label** so we can answer "which account is
the one dying at noon" without ever exposing a key. The label is the account
tag the owner supplies — `gaurav-3`, `team@carbonsettle.world` — and it is
**not a secret**: it names *whose* key, never the key.

- **Env format:** `GOOGLE_KEYS` is a comma-separated list where each entry is
  either `label~key` or a bare `key`. The `~` is a safe separator (base64url
  keys use only `[A-Za-z0-9-_.]`). A bare key gets a positional label
  `key-<n>`.
- **Local dev / evals:** `api/_config.js` (gitignored) may instead export
  `GOOGLE_KEYRING = [{label, key}, ...]`. `api/keyring.json` (gitignored) is the
  durable master list; `scripts/keyring.mjs` regenerates the two derived forms
  from it.
- **One direction only:** the code maps `key → label` for the trace. Nothing
  maps a label back to a key, so a leaked label can never reconstruct a secret.
  The `evals/keyring` gate asserts this.

## How RCA works

1. **Per turn**, `api/chat.js` writes `pool.served_label` into the turn trace
   (`meera_turn.legs` / the sealed trace) — the label of the account that
   actually served that turn, plus `pool.aborted` and the `fallbacks` list.
2. **Per instance**, `poolRca()` in `_gkeys.js` keeps a running count, by label,
   of how often each key hit `quota` or a `transient` since the function woke.
3. **The query** (once a paid or full-pool day has traffic): group
   `meera_turn` by `pool.served_label` over a day → load distribution and which
   labels never served (dead on arrival) or served then vanished (quota'd
   early). That is the RCA the owner asked for: which key is whose, and which
   one failed.

## Adding, rotating, or removing a key

1. Edit `api/keyring.json` (gitignored) — add `{ "label": "<owner>", "key":
   "<AQ...>" }`. Labels should be stable and human (an email or a `name-N`).
2. Run `node scripts/keyring.mjs` — it re-validates every key against Gemini
   `countTokens` (free, no generation quota), prints a health table by label,
   rewrites `api/_config.js`'s `GOOGLE_KEYRING`, and writes
   `api/google-keys.env` (the `GOOGLE_KEYS=label~key,...` string).
3. Paste the `GOOGLE_KEYS` value from `api/google-keys.env` into the Vercel
   project env (or set it via the Vercel MCP). Redeploy — the pool picks up the
   new size on the next cold start.

The switching itself is already zero-latency and needs nothing here: rotation is
a synchronous in-memory walk with per-key cooldowns (`COOL_MS` for quota,
`SICK_MS` for a transient), bounded transient retries, and the paid key appended
last and never cooled. A user never waits on a key switch; a dead key is skipped,
not dialed.

## The measured law behind all this

`free-pool-capacity` (context/measurements.md): 9 keys died at ~75 chat calls in
a day, because each turn re-sends her ~14k-token self. More keys is linear free
headroom; caching and a small billed key are the multipliers (see the 50-Key
Ledger analysis). The pool is a shared daily budget that resets ~07:00 UTC and
is also spent by the hourly consolidation cron — `both-lanes-dry` records the
day our own evals drained it and took production chat down, which is why evals
pin fake keys and never touch the pool.
