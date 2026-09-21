# IARC content rating questionnaire — guidance

How to answer Play Console's IARC rating questionnaire for Maya. Grounded in
`site/privacy.html` ("Terms, briefly": 18+, no harassment/illegal content) and
`docs/SPEC-GAMES.md` (chess as the only game feature; she plays it, the user
doesn't play against other users).

**Target rating: 18+ / Adults only.** Set this deliberately rather than
letting the questionnaire land there by default; the whole product is framed
around an adult audience (see `site/index.html`, `site/privacy.html`).

---

## Section-by-section guidance

**Violence**
Answer "none." There is no combat, weapons, or violent content anywhere in
the product. Chess is the only game and it has no violent framing.

**Sexual content**
Answer "no sexual content / nudity." Maya is a companionship and
conversation product, not an explicit one. There is no nudity, no sexual
imagery, and nothing in the codebase (`src/engine/persona.ts`, the crisis
protocol, the "no pretending" charter) suggests explicit sexual content is
part of the product. The 18+ gate exists because of the *simulated romantic
companionship* framing itself, not because of explicit content — mark
"romantic content / simulated relationship" or the closest equivalent
category your questionnaire offers, and leave the explicit-sexual-content
questions at "none."

**Profanity**
Answer according to whether the persona uses mild profanity in casual
Hinglish register (check `src/engine/persona.ts` example tone notes if the
questionnaire forces a specific answer); if uncertain, answer conservatively
("infrequent/mild") rather than "none," since a Hinglish-texting persona with
"her own rhythm" plausibly includes casual mild language.

**Controlled substances / gambling**
Answer "none." Nothing in the product involves alcohol, drugs, tobacco or
gambling mechanics. Chess is a skill game with no wagering, no loot boxes,
and no real-money mechanic of any kind.

**User-generated content (UGC)**
This is the question most likely to be answered wrong by default, so be
precise: **the only "content" a user generates is their own chat with Maya,
an AI.** There is no user-to-user messaging, no public posting, no user
profiles visible to other users, and no shared or discoverable content
surface anywhere in this app. Answer UGC questions as **"no user interaction /
no user-generated content shared with other users."** If the questionnaire
has a separate "chats with an AI character" or "in-app messaging with a
bot/persona" category, use that instead of the peer-to-peer UGC path — do not
let a chat-shaped feature get classified as social/UGC risk it doesn't carry.

**Interactive elements**
Declare: "users interact," "shares location" (no — do not declare unless
location is actually collected; it isn't per `site/privacy.html`), "digital
purchases" (no — the app has no ads and, per the codebase, no monetisation
surface is described; leave unchecked unless a store lists an actual IAP),
and do declare **"users share personal information"** — the chat surface
naturally invites the user to share personal details with Maya, and that is
already disclosed in full in the Data Safety form and Privacy Policy.

---

## Structural note for the age gate: this isn't just a rating checkbox

The 18+ rating should be backed by the actual product behaviour, not only
declared: **unverified/unauthenticated accounts get a minor-safe prompt
tier.** This is a structural gate in the persona/prompt layer (consistent
with `src/engine/persona.ts` and the crisis-protocol design in
`site/privacy.html`), not just a Play listing setting — an account that
hasn't been verified as an adult is served a more conservative, minor-safe
version of Maya's register rather than the full 18+ companion experience.
When Play's questionnaire or reviewers ask how the app prevents minors from
reaching adult content, this is the honest answer: age is not just claimed at
signup, unverified sessions are served a different, safer prompt tier by
construction.

---

## Checklist before submitting the questionnaire

- [ ] Confirm target age rating comes out at 18+/Adults only (Google Play) /
      AO or equivalent (regional IARC boards) — if the questionnaire lands
      lower, re-check the "romantic/simulated relationship" and "shares
      personal information" answers, since those are what typically pull the
      rating up for a companion app.
- [ ] UGC answered as "no user-to-user content" (chat is user↔AI only).
- [ ] No gambling, no real-money mechanics declared, since none exist.
- [ ] Data Safety form (`docs/playstore/DATA-SAFETY.md`) and this rating are
      consistent with each other — a reviewer will cross-reference both.
