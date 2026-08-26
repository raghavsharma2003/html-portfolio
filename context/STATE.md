# STATE — read this first, then the graph

One page, kept current, so a new session spends zero tokens re-deriving where
the project stands. Deep history lives in `decisions.md` / `rejected.md` /
`measurements.md`; the index is `graph.json` (`node scripts/context.mjs`).
**If this file and any other disagree, the other files win — fix this one.**

Last updated: 2026-08-26 (session: gurukul build + first live deploy)

## What the product is

Vyakti: a self-serve platform where an expert (edtech first: JEE teachers)
builds an AI version of themselves — voice, personality, style — that
**remembers each person it talks to** and carries a **measured guarantee it
still sounds like them**. Cloning through deployment: the finished clone
ships to students as an app. North star and binding consequences:
`docs/gurukul/SPEC-GURUKUL.md` §8 (owner reweight, 2026-08-26).

Standing owner directives: in-house replica stack (self-hosted open weights
primary, vendors optional); Maya/Meera deprioritized as a product (its engine
gates stay); Fable runs the main loop, Opus 5 / Sonnet 5 run subagents.

## Where the code is

- Branch `claude/gurukul-platform`, PR #5 (draft, CI green).
- The union of the companion line (RelationalOS engine) and the voice-cloning
  line (Replica Lab studio). `docs/gurukul/SPEC-GURUKUL.md` is the map;
  `docs/gurukul/ROADMAP-100X.md` is the build order;
  `docs/gurukul/research/` holds the competitor / memory-science / voice-stack
  sweeps behind those decisions.
- Gates: `node scripts/verify-release.mjs` (11 checks, all green).

## What is LIVE (verified, not assumed)

| thing | state |
|---|---|
| Neon Postgres | migrations 015–054 applied; 111 tables |
| Supabase (new project, separate from Meera's) | auth working; `vyakti-replica-private` bucket created |
| Auth | Google OAuth live; email OTP live (6-digit); built-in mailer capped ~2/hr until SMTP |
| Studio | `vyakti-replica-lab.vercel.app` → teacher studio at `/`; replica create/list verified against live DB |
| Meera production | untouched; its deploy trigger no longer matches this branch |
| In-house voice | Azure RG `vyakti-voice`: Chatterbox GPU runtime + admission broker + voice evidence, scale-to-zero, synthesising (RTF 0.79 warm). `docs/gurukul/AZURE-DEPLOY-STATE.md` |

## What is NOT live

- **Voice QUALITY**: the stack is LIVE (see the table above) but no consented
  reference has been cloned and no ABX bench has run — the smoke test used a
  buzz tone. Nothing may be claimed about how a clone sounds until the bench
  in `docs/gurukul/research/voice-stack.md` runs. Cold start (161 s ready,
  504 at 242 s) needs a warm-up before any user-facing use.
- **Ingestion**: statistical half built and gated; ASR + LLM passes are seams
  awaiting keys/GPU. No teacher ingested.
- **Student app**: built behind `VITE_PRODUCT_SURFACE=gurukul-student`, not
  deployed as its own project.
- **Fidelity thresholds**: provisional; nothing benched against ElevenLabs yet.

## Open owner items

1. Google App Password → SMTP (removes the email rate cap).
2. Rotate everything pasted into a chat transcript: Neon password, Supabase
   keys + management token, Azure SP secret, Google OAuth secret, and the two
   keys flagged in `session-2026-08-25b-close`.
3. Azure GPU quota, if the deploy agent reports the subscription has none.

## The laws a new session must not relearn

- `offline-mocks-cannot-type-check-sql` — a mocked DB proves control flow, not
  types or referential integrity. Smoke-test every lane against the real
  database before calling it done.
- `gurukul-no-production-glob` — a feature branch must never match another
  product's deploy trigger.
- `recited-prompt` / `prompt-position` — write shapes, never lines; position is
  mechanism.
- Isolation is a SQL predicate, never a prompt instruction.
- Every claim is measured or it is marked unverified. No offline numbers in
  `measurements.md`.
