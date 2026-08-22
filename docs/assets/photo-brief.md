# Meera photo brief — GPT Image 2.0 generation pack

Owner generates; this file is the repo copy of the prompt pack (2026-08-22).
Face-lock: every prompt runs WITH a reference image attached
(src/assets/meera.jpg, plus meera-walk.jpg for full-body posture). The
identity block below goes into every prompt verbatim; the reference photo is
what actually locks the face — the text only stops drift in lighting/age.

Catalog contract: files land in public/moments/<tag>.jpg, ~17-23 kB after
compression (we compress; owner delivers full-res). Selfie/mirror sets are
phone-camera vertical; POV sets are what HER eyes see (hands allowed, face
absent); no other recognisable faces anywhere; no text/watermarks/logos.

Existing coverage: 89 tags (selfie_*, pov_*, mirror_*, ambient). The pack
below fills the measured gaps: festivals, monsoon, street food, transit,
night city, winter, terrace, plus identity-asset refreshes (avatar,
onboarding fan, landing).

## Identity block (paste into EVERY prompt, after attaching the reference)

> Same woman as the reference photo: Meera, 24, North Indian, warm medium
> skin, dark expressive eyes, long dark hair, soft natural features, minimal
> makeup, small everyday jewellery at most. Keep the face EXACTLY consistent
> with the reference. Realistic phone-camera photo, slightly imperfect
> framing, natural grain, believable Indian home/city setting, warm light.
> No text, no watermark, no logos, no other recognisable faces.

## Global negatives (append to every prompt)

> Not a studio shoot, not airbrushed, not influencer-glossy, no heavy
> filters, no western apartment aesthetics, no visible brand marks.

## The prompts (filename → aspect → prompt)

### A. Festivals (missing entirely)
1. `selfie_diwali_diyas.jpg` — 3:4 vertical — Selfie at night on a balcony
   lined with lit clay diyas and one string of warm fairy lights; she wears a
   simple festive kurti, small jhumkas; face lit by flame-warm light, happy
   tired smile.
2. `pov_diwali_rangoli.jpg` — 3:4 — POV looking down: her hands finishing a
   small rangoli on a home floor, colour powders in steel bowls beside, one
   diya lit at the corner.
3. `selfie_holi_colour.jpg` — 3:4 vertical — Daytime selfie, cheeks and
   kurta dusted with pink and yellow gulal, laughing, messy hair, sunny
   terrace behind, colour smudges on the phone-holding arm.
4. `pov_rakhi_thali.jpg` — 3:4 — POV: her hands holding a small puja thali
   with rakhi, roli, rice and a sweet, home living room soft-blurred behind.

### B. Monsoon (missing)
5. `pov_rain_window_chai.jpg` — 3:4 — POV: rain streaking a window, a hand
   holding a steel cup of chai on the sill, grey-green wet trees outside,
   cosy dim room light.
6. `selfie_monsoon_terrace.jpg` — 3:4 vertical — Selfie on a wet terrace
   just after rain, hair damp at the edges, dupatta/hoodie, low grey sky,
   drops on the lens corner, big grin.
7. `pov_umbrella_street.jpg` — 3:4 — POV under an umbrella on a wet Indian
   street, autos and scooters blurred, reflections on the road, one hand
   holding a paper bag of pakode.

### C. Street food & city evenings (thin)
8. `pov_panipuri_stall.jpg` — 3:4 — POV at a chaat stall: a filled pani puri
   held toward camera, steel bowls and the vendor's cart soft-blurred, string
   bulb light, evening.
9. `pov_momos_plate.jpg` — 3:4 — POV: steaming plate of momos with red
   chutney on a roadside table, her other hand with a fork, winter evening
   light.
10. `selfie_nightmarket_lights.jpg` — 3:4 vertical — Selfie in a busy night
    market lane, bokeh of shop lights and fairy strings, denim jacket, alive
    and a little mischievous.
11. `pov_chai_tapri.jpg` — 3:4 — POV: cutting chai in a small glass at a
    roadside tapri, kettle and stacked glasses blurred behind, morning fog.

### D. Transit (thin — only train tags exist)
12. `pov_metro_window.jpg` — 3:4 — POV: metro window at golden hour, city
    sliding past, her reflection faint in the glass (face indistinct), earbud
    wire visible.
13. `pov_auto_ride.jpg` — 3:4 — POV from inside an auto-rickshaw: the green-
    yellow frame, driver's back unrecognisable, bright street ahead, her
    hand holding the rail, dupatta flying a little.

### E. Winter & terrace (missing)
14. `selfie_winter_shawl_fog.jpg` — 3:4 vertical — Morning selfie wrapped in
    a warm shawl on a foggy rooftop, nose slightly red, steam from a cup at
    frame edge, soft white light.
15. `pov_terrace_sunset_clothesline.jpg` — 3:4 — POV: terrace at sunset,
    clothesline with drying dupattas, water tank silhouettes, orange sky
    over an Indian skyline.
16. `pov_razai_laptop_night.jpg` — 3:4 — POV: under a razai at night, laptop
    glow, a bowl of peanuts, one sock foot sticking out, lamp warm.

### F. Everyday additions
17. `selfie_mehendi_hand.jpg` — 3:4 vertical — Selfie with one fresh mehendi
    hand held up beside her face, casual home clothes, delighted.
18. `pov_streetdog_pet.jpg` — 3:4 — POV: her hand scratching a calm street
    dog's head outside a gate, morning light, chappals visible.
19. `pov_sabzi_mandi.jpg` — 3:4 — POV: vegetable market crates of bhindi,
    tomatoes, coriander, her hand picking; vendor blurred, no face.
20. `selfie_saree_first_try.jpg` — 3:4 vertical — Mirror selfie mid-way
    through draping a simple cotton saree, pleats held in one hand, pins in
    mouth-corner smile, bedroom mirror.

### G. Identity assets (replacements/refresh)
21. `avatar_face_soft.jpg` — 1:1 square — Tight head-and-shoulders portrait,
    soft window light, plain warm wall, gentle direct smile, hair loose.
    (Will become the app avatar; keep it calm and timeless.)
22. `onboard_walk_lane.jpg` — 3:4 vertical — Full-body walking down a leafy
    Indian lane in casual kurti + jeans with a tote, caught mid-laugh
    looking slightly off-camera. (Onboarding fan refresh.)
23. `onboard_reading_sill.jpg` — 3:4 vertical — Sitting on a window sill
    reading a paperback, chai beside, monstera leaf edge in frame.
24. `landing_dusk_balcony.jpg` — 16:9 wide — Wide cinematic shot from behind
    /side: her at a balcony rail at dusk, city bokeh, warm interior light
    spilling out; face partly turned away. (Landing hero; identity carried
    by silhouette, not face detail.)

## Delivery
- Export the LARGEST size GPT Image gives (we downscale; never upscale).
- JPEG or PNG both fine; keep the filenames above exactly.
- Drop them all in one folder/zip and hand over — wiring into
  photoCatalog.ts + compression to catalog spec happens repo-side.
- If a generation drifts off-face, regenerate rather than accept: the face
  IS the product's continuity.
