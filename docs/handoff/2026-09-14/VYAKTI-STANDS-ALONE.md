# Owner directive, 2026-09-14: Vyakti stands alone. Meera stays where it is.

The owner's words: Meera is a completely separate product. Vyakti took the
best technology from Meera and has nothing to do with it as a product. Meera
stays deployed as it is. The Vyakti platform (the final product) is deployed
on its own and never redirects to, links to, or mentions Meera.

This is the first wave the next loop runs, before resuming wave twenty-four's
patches. It is mechanical and must not change product behaviour.

## What the loop builds (wave twenty-five, "Vyakti stands alone")

1. **One repo.** A new repository `raghavsharma2003/vyakti`, created from the
   tip of `claude/vyakti-cloning-platform-aq05n4` with full history kept
   (`git push` of the branch as `main`, never a squash). Then, in that repo,
   remove Meera's product surface and keep the shared engine:
   - remove: `/chat` (the Meera app entry and `api/chat.js`'s Meera route),
     Meera's persona (`src/engine/persona.ts`'s Meera character and the
     persona-invariant suites that guard HER helplines and voice; Vyakti's
     equivalents live in the person sheet and `honesty.ts`), `liveCall.ts` and
     `evals/echosim` (Meera's call audio floor) unless a Vyakti mirror call
     imports them (grep first; keep what Vyakti imports), the `meera_*`
     tables' cron sweeps that no Vyakti path reads, Meera's landing copy and
     assets, `meera-silk` references in `vercel.json`, CI and docs;
   - keep: the compiler, relstate, texture, selfarc, reciprocity, moment,
     honesty, the relational kernel, every `vy_*` table, every Vyakti door,
     the studio, the Room, the gates and the whole `evals/` registry minus
     the Meera-only suites (each removal named in `context/rejected.md`).
   - `CLAUDE.md` and `AGENTS.md` are rewritten for Vyakti alone (the laws
     stay; the Meera paragraphs go); `context/STATE.md`'s START HERE says
     "this repo is Vyakti; Meera lives in html-portfolio".
   - The gate must pass 25 of 25 in the new repo before anything is deployed.
2. **One Vercel project.** `vyakti`, connected to the new repo, production
   branch `main`, one domain. One root serves everything: `/` the landing,
   `/studio` the personal studio, `/r/<name>` the Rooms, `/api/*` the doors,
   the fourteen cron sweeps. `STUDIO_ROOT` goes away (the split it encoded
   was Meera's).
3. **Environment variables copied, not retyped.** With a Vercel token the
   loop reads every variable from `vyakti-replica-lab`, writes the ones
   Vyakti needs into the `vyakti` project for all three environments, and
   adds the Azure Foundry names it creates itself (step 5). The manifest
   (`docs/gurukul/ENV-MANIFEST.md`) is the list; Meera-only names are dropped.
4. **One text provider: Azure.** The Room's reply path (`api/chat.js`'s
   `think()` on OpenRouter) is moved onto the same Azure Foundry registry
   Meet already uses, so the product needs no OpenRouter key. Spend stays
   fenced by `AZURE_REPLICA_APP_BUDGET_USD`.
5. **Azure resources created by the loop** with the owner's service
   principal: one Foundry project with a chat model deployment (claims and
   dialogue), the endpoint and key written into Vercel (step 3), the Speech
   resource re-checked (the current `AZURE_SPEECH_KEY` shows "needs
   attention"), and the voice program's day-one command
   (`scripts/voice-day-one.mjs`, WS-R188's patch) pointed at them.
6. **Meera untouched.** `html-portfolio` and `meera-silk.vercel.app` keep
   serving Meera from their current production branch. Nothing in the new
   repo links to them; `evals/room-doors` gains a control that no Vyakti
   page or door references a Meera route or domain.
7. **Retire `Vyakti-GroupAI`** (archive on GitHub; its relational kernel was
   ported in WS-R135 and lives in `api/_relational-core.js`).

Then wave twenty-four resumes from its patches on the new repo's `main`.

## What only the owner can do (in this order)

1. **GitHub**: create an empty private repository named `vyakti` under your
   account, and add it to the repositories Claude Code and Codex may use
   (claude.ai admin settings for the Claude connector; Codex's repo access).
2. **Vercel**: Account Settings, Tokens, create a token named `vyakti-build`
   (full access). Put its value in the build environment as `VERCEL_TOKEN`.
   The loop creates the `vyakti` project and moves the variables itself.
3. **Azure** (the grant subscription): Microsoft Entra ID, App registrations,
   New registration, name `vyakti-build`. On its Overview copy the
   Application (client) id and the Directory (tenant) id. Certificates and
   secrets, New client secret, copy the VALUE once. Then Subscriptions, your
   subscription, Access control (IAM), Add role assignment, Contributor, to
   the `vyakti-build` app; copy the Subscription id. Put the four values in
   the build environment as `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
   `AZURE_CLIENT_SECRET`, `AZURE_SUBSCRIPTION_ID`.
4. **Azure voice approval**: submit Microsoft's Limited Access form for
   Speech Personal Voice (Azure portal, your Speech resource, the "Limited
   Access" link), with your company name. Approval takes days to weeks and
   only a human can submit it. Until it is granted the product speaks with
   the open-voice lane already configured (`AZURE_OPEN_VOICE_ORIGIN`).
5. **Database**: put the Neon connection string in the build environment as
   `NEON_URL` (the same value already on Vercel), so the loop can run the
   full 27-check gate and apply migrations itself.
6. **Supabase**: Authentication, URL configuration, add the new domain's
   `/r/*` and `/studio*` to Redirect URLs; Authentication, SMTP, a sender
   for sign-in codes if not already set.
7. **Domain** (optional now): buy the domain you want for Vyakti and add it
   to the `vyakti` Vercel project; until then `vyakti.vercel.app` works.
8. **When the app ships**: the Android keystore and its password, an Apple
   developer account for the iOS shell.

"Build environment" means the environment settings of the Claude Code or
Codex session (environment variables), never a message, never the repo.

## The prompt for the next loop (replaces the one in CODEX-HANDOFF.md)

> You are continuing Vyakti. Start from `raghavsharma2003/html-portfolio`,
> branch `claude/vyakti-cloning-platform-aq05n4`, tip. Read
> `docs/handoff/2026-09-14/VYAKTI-STANDS-ALONE.md` first, then
> `docs/handoff/2026-09-14/CODEX-HANDOFF.md`, `context/STATE.md`'s first
> block, `context/rejected.md`, `AGENTS.md`, `CLAUDE.md`. Do wave
> twenty-five ("Vyakti stands alone") exactly as VYAKTI-STANDS-ALONE.md
> lists it, using the credentials in the environment (`VERCEL_TOKEN`,
> `AZURE_*`, `NEON_URL`), never printing a value; gate 25 of 25 in the new
> repo before deploying; Meera untouched. Then resume wave twenty-four from
> the ten patches under `docs/handoff/2026-09-14/wave-24-wip/` on the new
> repo's `main`, five at a time, per CODEX-HANDOFF.md. Log every decision,
> measurement and rejection in `context/` as the laws require.
