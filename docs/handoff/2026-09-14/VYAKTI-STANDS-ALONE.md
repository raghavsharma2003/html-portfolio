# Owner directive, 2026-09-14 (revised the same day): Vyakti stays, Meera moves out.

The owner's words: Meera is a completely separate product. Vyakti took the
best technology from Meera and has nothing to do with it as a product. Meera
stays deployed as it is. The Vyakti platform (the final product) is deployed
on its own and never redirects to, links to, or mentions Meera.

Revision: Vyakti STAYS in `raghavsharma2003/html-portfolio` on
`claude/vyakti-cloning-platform-aq05n4` (the env vars, branches and research
are there). MEERA is what moves out. The owner is not doing any manual step
for this wave; the loop does everything it can reach and ends with a short,
exact list of what only the owner can supply, if anything remains.

This is the first wave the next loop runs, before resuming wave twenty-four's
patches. It is mechanical and must not change Vyakti's product behaviour.

## What the loop builds (wave twenty-five, "Vyakti stands alone")

1. **Meera moves out.** Create `raghavsharma2003/meera` from the CURRENT
   production branch of `html-portfolio` (the one `meera-silk.vercel.app`
   serves today, full history kept). Point the `html-portfolio` Vercel
   project at that new repo (or leave it exactly as it is if Vercel cannot
   be reached without a token; Meera keeps working either way). Nothing
   else changes for Meera.
2. **Vyakti's repo becomes Vyakti only.** On `claude/vyakti-cloning-platform-aq05n4`:
   remove Meera's product surface and keep the shared engine:
   - remove: the `/chat` entry and `api/chat.js`'s Meera route, Meera's
     persona (`src/engine/persona.ts`'s character and the persona-invariant
     suites that guard HER helplines and voice; Vyakti's equivalents live in
     the person sheet and `honesty.ts`), `liveCall.ts` and `evals/echosim`
     unless a Vyakti path imports them (grep first; keep what Vyakti imports),
     the `meera_*` cron sweeps no Vyakti path reads, Meera's landing copy
     and assets, every `meera-silk` reference in `vercel.json`, CI and docs;
   - keep: the compiler, relstate, texture, selfarc, reciprocity, moment,
     honesty, the relational kernel, every `vy_*` table, every Vyakti door,
     the studio, the Room, the gates and the whole `evals/` registry minus
     the Meera-only suites (each removal named in `context/rejected.md`).
   - `CLAUDE.md` and `AGENTS.md` are rewritten for Vyakti alone (the laws
     stay; the Meera paragraphs go); `context/STATE.md`'s START HERE says
     "this repo is Vyakti; Meera lives in the `meera` repo".
   - Merge PR #6 into `main` so `main` IS the product, and set `main` as the
     default branch. Renaming the repo to `vyakti` is optional and last
     (GitHub redirects the old name).
   - The gate must pass 25 of 25 before anything is deployed.
3. **One Vercel project for Vyakti: `vyakti-replica-lab`** (it already holds
   the variables). Production branch = `main`. One root serves everything:
   `/` the landing, `/studio` the personal studio, `/r/<name>` the Rooms,
   `/api/*` the doors, the fourteen cron sweeps (moved here from
   `html-portfolio`'s `vercel.json`). `STUDIO_ROOT` goes away (the split it
   encoded was Meera's). Every variable is enabled for Production, Preview
   and Development. Rename the project to `vyakti` if the dashboard allows.
4. **One text provider: Azure.** The Room's reply path (`api/chat.js`'s
   `think()` on OpenRouter) moves onto the Azure Foundry registry Meet
   already uses, so no OpenRouter key is needed. Spend stays fenced by
   `AZURE_REPLICA_APP_BUDGET_USD`.
5. **Azure resources**: with a service principal in the environment, create
   the Foundry project and chat deployment, write its endpoint, key and model
   names into Vercel, and re-check the Speech key that shows "needs
   attention". Without a service principal, prepare everything and put the
   exact seven names with blanks in the final report.
6. **Meera untouched as a product.** `evals/room-doors` gains a control that
   no Vyakti page or door references a Meera route or domain.
7. **Retire `Vyakti-GroupAI`** (archive on GitHub; its relational kernel was
   ported in WS-R135 and lives in `api/_relational-core.js`).

Then wave twenty-four resumes from its patches on `main`.

## What may still need the owner (the loop reports these at the end, pre-filled, nothing else)

- A Vercel token, if the loop's connectors cannot reach the Vercel dashboard.
- An Azure service principal (tenant id, client id, client secret,
  subscription id) with Contributor on the grant subscription, for creating
  the Foundry deployment and running the voice program.
- Microsoft's Limited Access approval for Speech Personal Voice (a form with
  the company name; a human signs it). Until then the open-voice lane already
  configured speaks.
Everything else (repos, branches, merges, variables that already exist,
Supabase redirect URLs if a Supabase connector exists, docs, context) the
loop does itself.

## The prompt for the next loop (paste as the first message)

> You are continuing Vyakti. Repo `raghavsharma2003/html-portfolio`, branch
> `claude/vyakti-cloning-platform-aq05n4`, tip; never start from another
> branch. Read `docs/handoff/2026-09-14/VYAKTI-STANDS-ALONE.md` first, then
> `docs/handoff/2026-09-14/CODEX-HANDOFF.md`, `context/STATE.md`'s first
> block, `context/rejected.md`, `AGENTS.md`, `CLAUDE.md`. The owner does no
> manual steps: do wave twenty-five ("Vyakti stands alone", Meera moves out,
> Vyakti stays) exactly as VYAKTI-STANDS-ALONE.md lists it, using whatever
> GitHub, Vercel, Supabase and Azure access your environment and connectors
> give you, never printing a secret; gate 25 of 25 before any deploy; Meera
> keeps working throughout. Then resume wave twenty-four from the ten
> patches under `docs/handoff/2026-09-14/wave-24-wip/` (five at a time,
> hourly WIP commits, per CODEX-HANDOFF.md), merge, gate, push, close in
> `context/` as the wave-twenty-three close did. End with ONE short list of
> anything only the owner can supply, each item pre-filled with exactly
> where it goes; if nothing remains, say so.
