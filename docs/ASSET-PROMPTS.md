# Asset prompts for the owner — GPT Image 2.0

The owner generates Meera's photos/videos on request. This file is the running
list of what the product wants next, with ready-to-paste prompts. Keep her
face consistent: ALWAYS attach the same reference photo (pick the clearest
front-facing one from the current 89-photo library) and lead the prompt with
the face-lock line.

**The face-lock line (prefix every Meera prompt with this):**
> Use the attached reference photo for the woman's face — same person, same
> features, do not alter her face, age, or skin tone. 24-year-old Indian
> woman, warm and expressive.

**Global style line (append to every prompt):**
> Shot on a phone camera, natural light, candid framing, slight imperfection,
> no studio look, no beauty-filter smoothing, vertical 9:16.

## Batch 1 — stories the current catalog is missing (one each)

1. Face-lock + "She is mid-laugh at a chai tapri in the evening, holding a
   cutting chai glass, monsoon-wet street behind her, fairy lights bokeh." +
   style line
2. Face-lock + "Over-the-shoulder shot of her hand moving a chess piece on a
   small wooden board on a cafe table, her face soft-focus in the background
   smiling at the camera." + style line  *(pairs with the games centre)*
3. Face-lock + "She is on her bed at night under warm lamp light, phone in
   hand, mid-typing, cozy blanket, fairy lights, the 2am-texting mood." +
   style line
4. Face-lock + "Golden-hour terrace: she leans on a railing with headphones
   around her neck, Delhi skyline haze behind, wind in her hair." + style line
5. Face-lock + "Rainy window seat, she holds a book she is clearly not
   reading, looking out, reflective mood, muted tones." + style line

## Batch 2 — ambient backgrounds (no face, landscape 16:9 AND vertical 9:16)

6. "Soft warm gradient of a dusk sky over a quiet Indian city rooftop,
   watercolor-like grain, no people, muted rose and amber tones matching
   #c23f56 accent." *(Us-screen / celebration card backdrop, if we move off
   pure CSS)*
7. "Extreme close-up of fairy lights bokeh on warm paper texture, shallow
   depth, rose-gold palette, no people."

## Rules for anything added here

- Nothing suggestive; she is a companion, not a pin-up — the persona's taste.
- Every story photo needs a one-line `desc` for the catalog (what is IN it, in
  her voice's facts, not captions) — write it when adding the file.
- Keep EXIF stripped before committing; files go under `public/stories/` and
  ride the existing catalog (`src/engine/storyCatalog.ts`).
