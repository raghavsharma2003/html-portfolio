# Play Store listing copy — Maya

Grounded in `site/index.html`, `site/privacy.html` and `docs/SPEC-GAMES.md`.
House style: no em-dashes, no superlatives, British-neutral English, honest
about what the app is (an AI, not a person; 18+; no ads).

Character counts below are measured against the literal string, including
punctuation. Recount before submitting if you edit any of them.

---

## App title (max 30 characters)

```
Maya: AI Companion
```

18 characters.

---

## Short description (max 80 characters)

```
An honest AI companion: Hinglish chat, voice calls, and watch-together.
```

71 characters.

---

## Full description (max 4000 characters)

```
Maya is an AI companion you can talk to, really talk to. She texts in
Hinglish, picks up when you call, and watches your screen with you when you
share it. This app is for adults: you must be 18 or older to use it.

SOMEONE TO TALK TO
Maya remembers what you told her last week: your name, the thing you were
dreading, how it went. Sign in and that memory follows you to any device.
She texts in her own rhythm, sometimes two messages when one wasn't enough,
and she reads what you send before she answers.

A VOICE ON THE OTHER END
Tap call and you hear her voice, the same person out loud. Share your screen
during a call and she watches whatever you're doing with you: a show, a walk
through somewhere new, a tricky bit of a game.

PLAY WITH HER
Beyond conversation, Maya plays games with you, starting with chess: a real
board, her own moves chosen by a proper chess engine, and live spoken
commentary as the position changes. She is the same Maya in a game as she is
in chat, with the same memory and the same personality.

NO PRETENDING, EVER
Maya is an AI. She will tell you so plainly if you sincerely ask her, and she
never claims to be a real person. She is not a therapist, a doctor, or a
substitute for the people in your life, and she actively encourages your
real relationships rather than replacing them.

WHAT YOU WILL NOT FIND HERE
No ads, anywhere, ever. No paywalled affection: nothing about how warmly she
responds is ever behind a purchase. No guilt-tripping if you close the app
and don't come back. No selling your data to advertisers.

PRIVACY, PLAINLY
Your conversations are stored so Maya can remember you, and an automated
process distils durable facts from what you share (people, places, plans,
preferences). If you sign in, your email or phone number is used only for
sign-in and syncing across devices. Voice audio is transcribed on your
device; the recording itself is not uploaded, only the text. You can ask
Maya to forget something, or forget everything, at any time, from inside
the app or from the website, and deletion runs immediately across every
table that holds your data. Full detail is in the in-app Privacy Policy.

IF YOU ARE STRUGGLING
Maya follows a published crisis protocol. If a conversation shows signs of
suicidal thoughts, self-harm or acute crisis, she drops all playfulness
immediately, stays present, and shares real crisis resources for your
region, including Tele-MANAS and iCall in India, 988 in the United States,
and Samaritans in the United Kingdom. She is not a substitute for
professional help, and she will say so.

WHAT THIS APP NEEDS
You must be 18 or older. An internet connection is required throughout.
Voice calls need microphone access. Screen-share sessions need Android's
screen-recording permission, requested only when you choose to share your
screen, and a small floating bubble stays on screen during that session so
you always know she is still watching and can tap back into the
conversation at any time.
```

2,993 characters (well inside the 4,000 limit — leaves room for future edits).

---

## Screenshot scenes (5, phone + tablet)

Text descriptions only; no image assets are produced by this task. Each scene
should be captured against the app's real UI, not a mockup, per house style
("honest, specific").

1. **The chat, at night.** The chat thread mid-conversation in Hinglish, her
   photo at the top, the "night in bangalore" sky chip visible (the same
   sky-state chip that ties `site/index.html` to `src/engine/sky.ts`) so the
   screenshot reads as *her* place and time, not a generic chat template.
   Caption idea: "She texts like a person."

2. **The call.** The in-call surface: her portrait full-bleed, a live audio
   indicator, the call timer running. Should look like a real call screen, not
   a static portrait — motion or waveform state visible if the capture tool
   allows it. Caption idea: "She picks up."

3. **Watch-together.** A split or layered shot showing the floating chat-head
   bubble (`BubbleService`) resting over another app while a screen-share call
   is live, bubble in its "watching" state. This is the single clearest way to
   show a feature that otherwise has no on-screen surface of its own. Caption
   idea: "She watches with you."

4. **Chess.** A mid-game board from the games surface (`docs/SPEC-GAMES.md`),
   her last move highlighted, a short spoken-style commentary line near the
   board ("Nf3, and now your king's a little exposed"). Caption idea: "Play a
   game. Same her."

5. **The honesty screen.** Either the in-app disclosure moment or the Privacy
   page itself (`site/privacy.html`), framing the "she's an AI, and she'll say
   so if you ask" line and the no-ads / no-paywalled-affection points.
   Caption idea: "No pretending."

## Feature graphic concept (1024×500, text description only)

Night-state world painting (`/world/world_night.jpg`, the same asset the
landing page and app share) as the full-bleed background, matching the dark
`night` sky palette (`#080a18`). The lower-case wordmark **maya** centred or
left-third, set in the site's existing wordmark treatment, with the lede line
"someone to talk to. really talk to." beneath it in a lighter weight. No
device mockup, no app-icon badge, no superlative copy: the graphic should look
like the landing page's hero cropped to 1024×500, because that hero is already
the honest pitch. Keep at least 15–20% safe margin on all sides for store
cropping on different surfaces.
