# Photos → the relational record (WS-PHOTOS)

Closes the gap docs/SPEC-SELF-LAYER.md §4 names third: a photo the user sends
was described (`gemini-3.1-flash-lite`, `api/memory.js` `opDescribe`) and the
description informed one reply, then died. `rememberFrom` (`src/engine/
memory.ts`) filters its 16-turn window to `m.kind === "text"` before it ever
reaches `opRemember` — a photo message never entered the extraction pass at
all. Nothing about a photo reached `vy_episode` or `vy_fact` by any route.

## What ships

`opDescribe` now writes, entirely server-side, riding the same `describe` call
the client already makes right after upload — **no client file changed**:

1. **An episode.** `vy_episode.channel`'s CHECK constraint (verified live) is
   exactly `('chat','call','watch','voicenote')` — there is no `'photo'`
   value, and adding one is a migration this workstream cannot apply. `'chat'`
   is the closest legal value: a photo sent inline in the chat stream is
   structurally a chat-channel event, and `meera_log` already logs its
   `[photo]` marker under `channel:'chat'`. `'watch'` is a different object
   (the live watch-together lane, under its own vision-fab governance);
   `'voicenote'` is an audio message.
2. **A claim, in `vy_visual_assertion` — never in `vy_fact`.** The raw
   description, cited to the episode, `extractor_model` and `confidence` set.
   Correctable, inspectable, not surfaced anywhere today (same status the
   watch lane's own writer had before this workstream — nothing new is dead,
   this is the *existing, already-shipped* design for exactly this shape of
   thing, reused).
3. **An event, in `vy_fact` — and *only* the event.** `body: "shared a photo"`,
   nothing about content. Cited to the episode, `sensitive: true` always.

## What was deliberately refused, and why

**No content-bearing claim is promoted into `vy_fact`.** The brief's own
escape hatch — "if the honest conclusion is only the sharing event and the
reaction should be stored, build that and argue it" — is what this is.

- `visiongate-powered` measured 10.2%/11.2% fabrication (95% CI up to ~14%,
  n>300) for **grok-4-20**, a stronger model, with multi-frame continuity,
  scene-change gating and a tuned directive. `opDescribe` has none of that:
  one downscaled JPEG, the cheapest model tier, a single 110-char guess, no
  self-reported confidence, no permission in its own prompt to say "can't
  tell." Treating its output as *more* trustworthy than the measured,
  better-resourced lane would be dishonest.
- The watch lane's own law — "claims and reactions are SEPARATE OBJECTS...
  a later-corrected visual claim must not delete a genuine emotional beat" —
  is applied here, minus the half this workstream cannot build: a verified
  *reaction* to anchor a `vy_shared_moment` on. That text lives in her actual
  reply, generated in `api/chat.js`, outside these exclusive files. Writing
  `vy_shared_moment.reaction` without it would mean inventing what she said —
  the confident-placeholder failure `context/rejected.md`'s `error-marked-
  done` already names. So `vy_shared_moment` stays unused for photos.
- **The provisional-tier safety net doesn't exist for photo content.** A
  same-turn *text* fact is safe at confidence 0.7 because the nightly
  consolidation pass re-derives it from `meera_log` with a stronger model and
  more context. A photo fact has no equivalent: `meera_log` only ever carries
  the `[photo] caption` marker (`src/components/Chat.tsx` `logTurns`), never
  the vision description. There is no second look. A wrong claim written to
  `vy_fact` would sit there, cited, uncorrected, forever.
- Net effect: **prefer under-recording.** A missed photo memory is a mild
  loss; a fabricated one, cited later as evidence, is a trust failure — the
  asymmetry the brief itself names.

## Fabrication guard mechanics

`PHOTO_VISION_CONFIDENCE = 0.35` — not model-self-reported (the prompt never
asks for one), fixed and documented rather than derived, deliberately below
opRemember's 0.7 extracted-text default. `PHOTO_REFUSAL_RE` catches a model
apologizing instead of returning nothing; `lintPhotoDesc` also rejects
anything under 4 characters. **A failed, empty, or refused description writes
nothing** — no episode touch, no assertion, no fact.

## Privacy and forget

- `vy_fact.sensitive = true` unconditionally on the event fact — a photo may
  show a third party, a document, an address, a medical detail, and none of
  that is verifiable from here. `api/_disclosure.js` already treats
  `sensitive` as a hard floor at the multiparty disclosure boundary, so this
  fact never crosses into a room a photo wasn't meant for.
- **Forget reaches everything written here with zero manifest changes.**
  `vy_episode`, `vy_visual_assertion` and `vy_fact` were already in
  `PERSON_TABLES` (not touched by this workstream); `vy_visual_assertion` also
  cascades off `vy_episode`'s FK. Verified live: `op:"forget"` `scope:"all"`
  removes the episode, the assertion and the fact for a fixture person.
  `scope:"item"` reaches them too **only if** the forgotten term matches the
  episode's `summary` (the "additional net" `purgeRelational` already uses for
  every episode) — which is why `recordPhotoMemory` sets
  `summary: "photo: <description>"` on every touch.
- **The image itself, in Supabase storage, is a real, pre-existing gap this
  workstream did not introduce but that bears directly on photos
  specifically: `deletePhotos()` (`api/memory.js`) is only called for
  `scope:"session"`, `scope:"day"` and `scope:"all"`. `scope:"item"` — the
  scope a named "bhool ja wo photo jo maine bheji thi" forget actually
  resolves to (`resolveForget`, `src/engine/memory.ts`) — never calls it.**
  So the common case of forgetting one specific photo by naming it deletes the
  episode/fact/assertion rows (the *description* of the photo) but leaves the
  actual JPEG sitting in Supabase storage indefinitely. This is the sharpest
  version of the exact failure `api/memory.js`'s own `deletePhotos()` comment
  already names for the tables it does cover ("deleted the description of a
  photo and kept the photo") — it just doesn't yet cover this scope. Fixing it
  is a `scope:"item"` windowing problem in `opForget`/`deletePhotos()`, not a
  new-table problem, and it is outside this workstream's exclusive files
  (the fix belongs next to the existing `deletePhotos()` call sites, which
  this task did not open for editing beyond the photo ops it was scoped to).

## Verification

`evals/multimodal/photo.mjs` — self-contained, real Postgres, `wsphoto-test-`
marker, zero-residue proven by a live count after teardown. Two negative
controls: an agent-scoped insert omitting `agent_id` fails loudly (migration
010 dropped the transitional default), and an `'extracted'` `vy_fact` insert
with no citations fails loudly (`vy_fact_cite_or_authored`).
