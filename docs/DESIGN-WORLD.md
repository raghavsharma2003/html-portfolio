# The World Layer — design direction (owner mandate, 2026-08-22)

Owner, verbatim intent: competitor-level is the floor, not the target —
"a design of this level, and actually better... premium, smooth,
engaging, thoughtful, unique ideas... it goes night and in the morning
it goes morning... ad-free."

Studied: ira (Play Store), full recording + stills. What is genuinely
good there is ONE idea executed well: **the app is a PLACE.** A painted
night sky over a moonlit city; activity cards floating in the world; the
chat entered from the world; a serif lowercase identity; a reassurance
line under the call controls. What is weak there is everything under the
shell: ads on every surface, voice behind a paywall, a plain dark chat,
and — the unforgivable one — she denies being an AI when asked directly.
We take the PLACE. We keep our soul.

## The direction

1. **THE SKY IS THE CLOCK.** One painted world — an Indian city under a
   big sky — rendered in 5 time states (night, pre-dawn, morning, golden
   hour, dusk) driven by the REAL clock (the same hour machinery T9
   already trusts). The world layer grounds: the HOME screen, both call
   screens, onboarding, and the story ring surface. Procedural CSS
   celestials (twinkling stars, drifting cloud layer, moon phase) float
   OVER the paintings — cheap, animatable, reduced-motion compliant.
2. **HOME IS A HANGOUT, NOT A LIST.** A new landing surface inside the
   app: her presence (avatar + gold ring + one live line), the last
   exchange as a pill that opens the chat, and the activity cards —
   chess, tic tac toe, would-you-rather, watch together, her story, Us —
   floating gently in the world (parallax on scroll/tilt, spring on
   touch). We have REAL activities behind every card; theirs are links.
3. **THE CHAT STAYS LEGIBLE-FIRST.** The thread keeps its readable
   surfaces and every contrast gate. The world reaches it only as: the
   sky visible through a translucent header band, and the theme itself.
4. **"SKY" BECOMES THE DEFAULT THEME MODE.** Light / Dark / System stay
   as explicit choices; the new default "Sky" follows the real sky —
   warm paper by day, deep atmospheric night after dusk, with the dawn/
   dusk states in between. This is the owner's "you should be able to
   choose" AND the living world, reconciled: a mode, not a takeover.
5. **HONEST REASSURANCE, BETTER THAN THEIRS.** Their call screen claims
   "end to end private" (almost certainly false). Ours states what is
   TRUE and warm: no ads ever, conversations never sold, she will always
   tell you what she is. The exact line ships from the existing honest
   copy voice; nothing we cannot defend in a deposition.
6. **AD-FREE IS A DESIGN FEATURE.** Every surface they spend on banners
   and "watch an ad" nags, we spend on air. Emptiness where they have
   ads IS the premium signal.

## Asset contract (owner generates; placeholders ship first)

The world ships in TWO stages so nothing waits: stage 1 is fully
procedural (layered CSS gradients + celestials — shippable, gated,
beautiful enough to stand alone); stage 2 swaps in the owner's painted
skies via one CSS variable per time state, no code change.

Paintings (GPT Image, one consistent style — soft painterly, Ghibli-adjacent
warmth, an Indian skyline, NO text, NO people): see the prompt pack in
docs/assets/world-brief.md. 5 time states x portrait 1080x1920 + one wide
1920x1080 crop each; plus 2 loose cloud PNGs (transparent) for parallax.

## Laws that do not bend for beauty

Contrast gates extend to the world layer (text over sky = scrim tokens,
measured); motion lint applies to every drift/twinkle; reduced-motion
gets a still sky, never a blank one; the theme choice stays honored
(`data-theme` beats the sky); no surface may cover the honesty footer;
and the thread's readability audit numbers may not regress by one point.

## Phase 3 — the thread and the first minute join the world (owner, 2026-08-23)

Owner verdict from real use: home and calls are right; the CHAT and
ONBOARDING still read as the old paper app. Direction:

1. **THE THREAD GETS A WALLPAPER, NOT A REDESIGN.** The mental model
   already exists — a chat has a wallpaper — and it is the one way a
   thread can live in the world without spending a single point of
   bubble legibility: the sky painting becomes the ground BETWEEN
   bubbles at heavy scrim (a tint, never a photo fighting text), the
   bubbles stay fully opaque on their existing gated tokens, and the
   scrim follows the theme (light theme = a warm, faint day version;
   dark = the deep night). One fixed background layer: zero per-row
   cost, the windowed-thread perf work untouched.
2. **THE HEADER JOINS THE WORLD.** The shipped-but-unwired band
   variant finally gets its call site: glass header, sky visible
   through it, the gold-ring avatar and serif lowercase name matching
   home. Composer becomes the same glass family; day separators and
   call chips become quiet glass chips.
3. **ONBOARDING IS HER WORLD, NOT A FORM.** The whole flow runs on the
   WorldLayer: her window-night photo as the meeting moment, glass
   step cards, the same motion vocabulary, name + topics as two light
   touches — the first minute must feel like walking into the painting
   the rest of the app lives in.
4. **THE LAWS HOLD.** Bubble contrast is untouched by construction
   (opaque surfaces); new gated floors for the header band and the
   wallpapered ground (timestamps/separators sit ON the ground);
   reduced motion; both themes x five skies; 320 and 390.
