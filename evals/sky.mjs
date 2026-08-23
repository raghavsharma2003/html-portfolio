// WS-WORLD — the sky is the clock, pinned.
//
// Every failure mode of a time-driven world is silent, which is the same
// argument evals/theme.mjs opens with and it is even more true here: a sky
// that resolves the wrong state at 04:29 is wrong for ninety seconds a day,
// on a screen nobody is looking at, and it looks perfect at every other
// moment. Nothing that runs the app can catch that. A table can.
//
// Bundled fresh from the REAL src/engine/sky.ts on every run (same discipline
// as evals/run.mjs: a frozen copy passes forever while the source rots), and
// self-contained rather than riding evals/.entry.ts so it can be run alone:
//
//   node evals/sky.mjs
//
// Offline, deterministic, no database, no network, no model call, ~1s.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const dir = mkdtempSync(join(tmpdir(), "skyeval-"));
const out = join(dir, "sky.mjs");
execFileSync(
  "npx",
  [
    "esbuild",
    "src/engine/sky.ts",
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${out}`,
    "--log-level=error",
  ],
  { cwd: ROOT, stdio: "inherit" },
);
const sky = await import(out);
// also bundle away.ts, because the consistency invariant below is a claim
// about TWO files and asserting it against a copied-out constant would be
// asserting it against nothing
const outAway = join(dir, "away.mjs");
execFileSync(
  "npx",
  [
    "esbuild",
    "src/engine/away.ts",
    "--bundle",
    "--format=esm",
    "--platform=node",
    `--outfile=${outAway}`,
    "--log-level=error",
  ],
  { cwd: ROOT, stdio: "inherit" },
);
const away = await import(outAway);

const {
  SKY_STATES,
  SKY_BOUNDARIES,
  SKY_TOKENS,
  SKY_TRANSITION_MIN,
  stateAtMinute,
  nextBoundaryAfter,
  skyAt,
  skyMode,
  moonPhaseAt,
  parseSkySeed,
  midpointOf,
  tokensFor,
} = sky;

let fail = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

/** A Bangalore minute-of-day, as an epoch ms on a fixed date. IST is UTC+5:30
 *  with no DST ever, so this is exact rather than approximate. */
const IST = 330 * 60_000;
const DAY = 86_400_000;
const BASE_MIDNIGHT = Math.floor((Date.UTC(2026, 7, 22) + IST) / DAY) * DAY - IST;
const atMin = (m) => BASE_MIDNIGHT + m * 60_000;

// ── 1. the table itself ───────────────────────────────────────────────────
ok("five states, no more", SKY_STATES.length === 5, String(SKY_STATES.length));
ok(
  "the five states are the direction doc's five",
  ["night", "predawn", "morning", "golden", "dusk"].every((s) => SKY_STATES.includes(s)),
);
ok("every state has tokens", SKY_STATES.every((s) => SKY_TOKENS[s]));
ok("tokensFor agrees with the table", SKY_STATES.every((s) => tokensFor(s) === SKY_TOKENS[s]));
ok(
  "every state names itself in its own row",
  SKY_STATES.every((s) => SKY_TOKENS[s].state === s),
);
ok(
  "every sky has exactly four stops",
  SKY_STATES.every((s) => SKY_TOKENS[s].stops.length === 4),
);
ok(
  "every stop is a 6-digit hex",
  SKY_STATES.every((s) => SKY_TOKENS[s].stops.every((c) => /^#[0-9a-f]{6}$/i.test(c))),
);
ok(
  "every state declares a light/dark mode",
  SKY_STATES.every((s) => SKY_TOKENS[s].mode === "light" || SKY_TOKENS[s].mode === "dark"),
);

// THE PAINTING SWAP POINT. Stage 2 changes `img` and nothing else; a state
// that lost the field would silently stay procedural forever while the other
// four swapped, which is the kind of bug that ships.
ok(
  "every state carries the --world-img swap point",
  SKY_STATES.every((s) => typeof SKY_TOKENS[s].img === "string"),
);

// ── 1b. THE PAINTING MANIFEST ─────────────────────────────────────────────
//
// This block used to assert the opposite — "stage 1 ships with no painting
// wired", `img === ""` for all five. Stage 2 landed, so the assertion
// inverts: every state must name a painting AND that painting must be a file
// that exists.
//
// The second half is the one that matters and it is not pedantry. The app
// FALLS BACK when a painting fails to load: the procedural sky returns, it is
// beautiful, every contrast floor still passes, and nothing anywhere says a
// word. A typo in one url is therefore invisible in production and invisible
// to every test that runs the code — one state alone quietly reverting to
// stage 1 forever, which is exactly the failure the original "swap point"
// check was written to catch, one step further along.
{
  const { existsSync } = await import("node:fs");
  const pub = (rel) => join(ROOT, "public", rel);
  ok(
    "every state names a painting",
    SKY_STATES.every((s) => SKY_TOKENS[s].img !== "" && SKY_TOKENS[s].imgWide !== ""),
    SKY_STATES.filter((s) => !SKY_TOKENS[s].img || !SKY_TOKENS[s].imgWide).join(","),
  );
  // `imgPath` is the ONE unwrapper — WorldLayer preloads through it and
  // check-contrast decodes through it, so an unwrapper that silently returned
  // "" would take the preload, the gate and this eval down together.
  ok(
    "imgPath unwraps the CSS url form",
    sky.imgPath('url("/world/world_dusk.jpg")') === "/world/world_dusk.jpg" &&
      sky.imgPath("url(/world/x.jpg)") === "/world/x.jpg" &&
      sky.imgPath("none") === "" &&
      sky.imgPath("") === "",
  );
  for (const s of SKY_STATES) {
    const { portrait, wide } = sky.paintingsFor(s);
    ok(`${s}: portrait painting exists (${portrait})`, Boolean(portrait) && existsSync(pub(portrait)));
    ok(`${s}: wide painting exists (${wide})`, Boolean(wide) && existsSync(pub(wide)));
    ok(
      `${s}: the two crops are different files`,
      portrait !== wide,
      portrait,
    );
  }
  // The plates are the one procedural element that survives a painting, so
  // they are the one pair of assets whose absence would show as a sky that
  // never moves — a still that looks exactly like a working still.
  //
  // AND THEIR BYTES ARE PART OF THE CONTRACT. They shipped as 1400x788 PNGs,
  // 237 KB together, for boxes drawn at 410x143 and 281x101 CSS px — fetched
  // on every cold open of the landing surface. The re-emitted WebPs are 58 KB.
  // A ceiling here is what stops the next re-export quietly putting the
  // quarter-megabyte back: a bigger file has no symptom, it just costs
  // everyone a second of their first impression.
  const PLATE_BUDGET = 72 * 1024;
  let plateBytes = 0;
  for (const c of ["cloud_a.webp", "cloud_b.webp"]) {
    const at = pub(`/world/${c}`);
    const there = existsSync(at);
    ok(`the drifting plate ${c} ships`, there);
    if (there) plateBytes += statSync(at).size;
  }
  ok(
    `the two plates together stay under ${(PLATE_BUDGET / 1024) | 0} KB`,
    plateBytes > 0 && plateBytes <= PLATE_BUDGET,
    `${(plateBytes / 1024).toFixed(1)} KB (was 237 KB as PNG)`,
  );
  // …and nothing still points at the PNGs, which are deleted. A stale url()
  // is a 404 that renders as a sky with no clouds in it — the exact "blank,
  // not still" failure world.css's reduced-motion block exists to prevent,
  // and it would look like a design choice.
  {
    const css = readFileSync(join(ROOT, "src/styles/world.css"), "utf8");
    ok("world.css references no cloud PNG", !/cloud_[ab]\.png/.test(css));
    ok(
      "world.css points at both plates",
      /cloud_a\.webp/.test(css) && /cloud_b\.webp/.test(css),
    );
  }
}

// ── 1c. the two veils ─────────────────────────────────────────────────────
// A painting is a busier ground than a gradient and never a calmer one, so
// the painted veil may never be the thinner of the two. The floors themselves
// are `scripts/check-contrast.mjs`'s job (it decodes the jpgs); this is the
// structural half, which is the half that survives someone "simplifying" the
// two numbers back into one.
ok(
  "every state declares a painted scrim alpha",
  SKY_STATES.every((s) => typeof SKY_TOKENS[s].scrimAlphaPainted === "number"),
);
ok(
  "the painted veil is never thinner than the gradient's",
  SKY_STATES.every((s) => SKY_TOKENS[s].scrimAlphaPainted >= SKY_TOKENS[s].scrimAlpha),
  SKY_STATES.filter((s) => SKY_TOKENS[s].scrimAlphaPainted < SKY_TOKENS[s].scrimAlpha).join(","),
);
ok(
  "both veils stay inside the sane band",
  SKY_STATES.every(
    (s) =>
      SKY_TOKENS[s].scrimAlpha >= 0.3 &&
      SKY_TOKENS[s].scrimAlpha <= 0.8 &&
      SKY_TOKENS[s].scrimAlphaPainted >= 0.3 &&
      SKY_TOKENS[s].scrimAlphaPainted <= 0.8,
  ),
);
// ── 1d. the THIRD veil: the thread's wallpaper ────────────────────────────
// docs/DESIGN-WORLD.md §Phase 3.1. `scripts/check-contrast.mjs` owns the
// floors (it decodes the jpgs); this is the structural half — the half that
// survives someone collapsing four numbers into one, or wiring a state's
// wallpaper to the sky's own mode instead of to the theme.
{
  const FIELDS = [
    "wallScrimLight", "wallAlphaLight", "wallScrimDark", "wallAlphaDark",
    // WS-SKYFELT. Four more, and they are the answer to a defect rather than a
    // refinement: at 11:27 IST `sky` resolves to the light palette, so the
    // thread painted the LIGHT veil and Sky was pixel-identical to Light until
    // dusk. These carry the same veil for a person who chose SKY, thinner and
    // colourless, so the mode can be SEEN. `check-contrast.mjs` owns their
    // floors and the three laws that keep them apart from the plain pair; this
    // is the structural half, and its whole job is to fail loudly if a state
    // ever loses one and the var resolves to nothing on a night thread.
    "wallScrimLightSky", "wallAlphaLightSky", "wallScrimDarkSky", "wallAlphaDarkSky",
  ];
  ok(
    "every state carries all four wallpaper fields",
    SKY_STATES.every((s) => FIELDS.every((f) => SKY_TOKENS[s][f] !== undefined)),
    SKY_STATES.filter((s) => !FIELDS.every((f) => SKY_TOKENS[s][f] !== undefined)).join(","),
  );
  ok(
    "both wallpaper scrims are 6-digit hexes the gate can parse",
    SKY_STATES.every(
      (s) =>
        /^#[0-9a-f]{6}$/i.test(SKY_TOKENS[s].wallScrimLight) &&
        /^#[0-9a-f]{6}$/i.test(SKY_TOKENS[s].wallScrimDark) &&
        /^#[0-9a-f]{6}$/i.test(SKY_TOKENS[s].wallScrimLightSky) &&
        /^#[0-9a-f]{6}$/i.test(SKY_TOKENS[s].wallScrimDarkSky),
    ),
  );
  // The sky-choice veil is the one a person SEES the mode through, so a state
  // whose sky alpha is not thinner than its plain one is a state on which the
  // mode is invisible — the exact defect this pair was added for, one state at
  // a time. The ratio floors live in check-contrast.mjs; this is the property
  // that has no ratio.
  ok(
    "every state's sky-choice veil is thinner than its plain one",
    SKY_STATES.every(
      (s) =>
        SKY_TOKENS[s].wallAlphaLight - SKY_TOKENS[s].wallAlphaLightSky >= 0.02 &&
        SKY_TOKENS[s].wallAlphaDark - SKY_TOKENS[s].wallAlphaDarkSky >= 0.02,
    ),
    SKY_STATES.map((s) => `${s} L${SKY_TOKENS[s].wallAlphaLight}/${SKY_TOKENS[s].wallAlphaLightSky}`).join(" "),
  );
  ok(
    "both wallpaper alphas are numbers inside the sane band",
    SKY_STATES.every(
      (s) =>
        SKY_TOKENS[s].wallAlphaLight >= 0.35 &&
        SKY_TOKENS[s].wallAlphaLight <= 0.97 &&
        SKY_TOKENS[s].wallAlphaDark >= 0.35 &&
        SKY_TOKENS[s].wallAlphaDark <= 0.97,
    ),
  );
  // THE VEIL IS INDEXED BY THEME, NOT BY THE SKY'S OWN MODE, and this is the
  // check that says so in a way a refactor cannot talk its way past. The
  // tempting simplification is "the sky already knows if it is light or dark,
  // use `mode`" — and it is wrong, because `data-theme` beats the sky: a
  // person on the explicit light theme reads dark ink at midnight. If the two
  // families were really one, every dark state would share an alpha and every
  // light state would share the other. They do not, and cannot.
  const darkStates = SKY_STATES.filter((s) => SKY_TOKENS[s].mode === "dark");
  ok(
    "the wallpaper veil does not merely track the sky's own mode",
    new Set(darkStates.map((s) => SKY_TOKENS[s].wallAlphaDark)).size > 1,
    darkStates.map((s) => `${s} ${SKY_TOKENS[s].wallAlphaDark}`).join(", "),
  );
  // A dark painting can be let through; a bright one cannot. That ordering is
  // the physical fact underneath every number in the table, so it is pinned:
  // the morning sky (the brightest painting) must take the heaviest dark veil,
  // and night (the darkest) the lightest.
  ok(
    "the dark veil is heaviest on the brightest painting",
    SKY_TOKENS.morning.wallAlphaDark > SKY_TOKENS.night.wallAlphaDark,
    `morning ${SKY_TOKENS.morning.wallAlphaDark} vs night ${SKY_TOKENS.night.wallAlphaDark}`,
  );
  // world.css must actually consume all four, or the table is decoration.
  {
    const css = readFileSync(join(ROOT, "src/styles/world.css"), "utf8");
    for (const v of ["--wall-scrim-light", "--wall-a-light", "--wall-scrim-dark", "--wall-a-dark"])
      ok(`world.css reads ${v}`, css.includes(v));
    ok(
      "world.css declares the wallpaper variant",
      /\.world\[data-variant="wallpaper"\]/.test(css),
    );
    // A WALLPAPER IS STILL. The variant must turn off every ambient layer —
    // the celestials are not rendered into it at all (WorldLayer.tsx), and
    // this is the stylesheet's half of the same promise.
    ok(
      "the wallpaper variant stops the emphasis vignette",
      /\.world\[data-variant="wallpaper"\] \.world-scrim::after/.test(css),
    );
  }
  // …and WorldLayer must not render a single moving thing into it.
  {
    const tsx = readFileSync(join(ROOT, "src/components/WorldLayer.tsx"), "utf8");
    ok(
      "WorldLayer knows the wallpaper variant",
      /"full" \| "band" \| "wallpaper"/.test(tsx),
    );
    ok(
      "the wallpaper renders no procedural celestials",
      (tsx.match(/!painted && !still/g) || []).length >= 4,
      `${(tsx.match(/!painted && !still/g) || []).length} guarded`,
    );
  }
}

// The scrim's top/bottom emphasis curve, which the contrast gate composites
// and world.css draws. Pinned to the gradient's own stops: if the stylesheet
// moves them and this does not, the gate is measuring a screen nobody ships.
{
  const e = sky.scrimEmphasisAt;
  ok("emphasis is full at the very top", Math.abs(e(0) - 0.55) < 1e-9, String(e(0)));
  ok("emphasis is full at the very bottom", Math.abs(e(1) - 0.55) < 1e-9, String(e(1)));
  ok("emphasis is zero through the middle", e(0.3) === 0 && e(0.5) === 0 && e(0.57) === 0);
  ok("emphasis is zero exactly at the 24% stop", Math.abs(e(0.24)) < 1e-9, String(e(0.24)));
  ok("emphasis is monotone rising after 58%", e(0.8) > e(0.7) && e(0.7) > e(0.6));
  ok("emphasis clamps outside 0..1", e(-1) === e(0) && e(2) === e(1));
  ok(
    "the text bands are the ones the gate reads",
    sky.TEXT_BAND_TOP > 0 && sky.TEXT_BAND_TOP < 0.5 && sky.TEXT_BAND_BOTTOM > 0 && sky.TEXT_BAND_BOTTOM < 0.5,
  );
}

// ── 2. the boundaries, to the minute ──────────────────────────────────────
// Pinned as literals rather than re-derived from the table: a test that reads
// the table it is testing tests nothing at all.
const EXPECT = [
  [270, "predawn"], // 04:30
  [370, "morning"], // 06:10
  [980, "golden"], // 16:20
  [1090, "dusk"], // 18:10
  [1180, "night"], // 19:40
];
ok("the boundary count is pinned", SKY_BOUNDARIES.length === EXPECT.length);
for (let i = 0; i < EXPECT.length; i++) {
  const b = SKY_BOUNDARIES[i];
  ok(
    `boundary ${i}: ${EXPECT[i][1]} at minute ${EXPECT[i][0]}`,
    b && b.at === EXPECT[i][0] && b.state === EXPECT[i][1],
    b ? `${b.state}@${b.at}` : "missing",
  );
}
ok(
  "boundaries are strictly ascending",
  SKY_BOUNDARIES.every((b, i) => i === 0 || b.at > SKY_BOUNDARIES[i - 1].at),
);

// The state on EACH SIDE of every boundary, which is the assertion that
// actually catches an off-by-one — a boundary table can be right and the
// lookup still wrong.
for (const [min, state] of EXPECT) {
  ok(`minute ${min} IS ${state}`, stateAtMinute(min) === state, stateAtMinute(min));
  const prevExpected =
    EXPECT.filter((e) => e[0] < min).pop()?.[1] ?? "night";
  ok(
    `minute ${min - 1} is still ${prevExpected}`,
    stateAtMinute(min - 1) === prevExpected,
    stateAtMinute(min - 1),
  );
}

// ── 3. totality ───────────────────────────────────────────────────────────
// Every minute of the day resolves, and resolves to a state that has tokens.
// A gap here is a blank screen at a time of day nobody tested.
{
  let bad = 0;
  const seen = new Set();
  for (let m = 0; m < 1440; m++) {
    const s = stateAtMinute(m);
    if (!SKY_STATES.includes(s) || !SKY_TOKENS[s]) bad++;
    seen.add(s);
  }
  ok("all 1440 minutes resolve to a real state", bad === 0, `${bad} bad`);
  ok("every state is reachable from some minute", seen.size === 5, [...seen].join(","));
}
// Wrap-around: midnight belongs to night, which is the one the table does not
// state directly (night is the state BEFORE the first boundary and AFTER the
// last, and a lookup that got that wrong would be wrong for four and a half
// hours every night).
ok("00:00 is night", stateAtMinute(0) === "night");
ok("23:59 is night", stateAtMinute(1439) === "night");
ok("negative minutes fold rather than throw", stateAtMinute(-1) === "night");
ok("minutes past a day fold", stateAtMinute(1440) === stateAtMinute(0));

// ── 4. THE away.ts INVARIANT ──────────────────────────────────────────────
// The load-bearing cross-file claim, stated in sky.ts's header: every minute
// inside away.ts's night window (NIGHT_START_HOUR..NIGHT_END_HOUR, the hours
// whose crossing makes a gap "overnight") must resolve to a DARK sky.
//
// It is asserted against away.ts's REAL constants, bundled above. If someone
// widens that window to 00:00-07:00, this fails and the sky table has to
// answer for it, which is the entire point: two clocks that disagree in front
// of the user is the failure, and neither file can see the other.
{
  let light = [];
  for (let h = away.NIGHT_START_HOUR; h < away.NIGHT_END_HOUR; h++) {
    for (let m = 0; m < 60; m++) {
      const s = stateAtMinute(h * 60 + m);
      if (SKY_TOKENS[s].mode !== "dark") light.push(`${h}:${String(m).padStart(2, "0")}=${s}`);
    }
  }
  ok(
    `away.ts's night window (${away.NIGHT_START_HOUR}-${away.NIGHT_END_HOUR}) is dark sky throughout`,
    light.length === 0,
    light.slice(0, 4).join(" "),
  );
}
// …and the converse sanity: broad daylight is NOT dark.
ok("noon is a light sky", SKY_TOKENS[stateAtMinute(720)].mode === "light");
ok("11pm is a dark sky", SKY_TOKENS[stateAtMinute(23 * 60)].mode === "dark");

// ── 5. skyAt / the frame ──────────────────────────────────────────────────
{
  const f = skyAt(atMin(720)); // noon
  ok("frame reports the minute it resolved from", f.minuteOfDay === 720, String(f.minuteOfDay));
  ok("noon is morning", f.state === "morning", f.state);
  ok("noon's next is golden", f.next === "golden", f.next);
  ok("far from a boundary, blend is 0", f.blend === 0, String(f.blend));
  ok("frame carries its own tokens", f.tokens === SKY_TOKENS.morning);
  ok("frame carries the next state's tokens", f.nextTokens === SKY_TOKENS.golden);
  ok("msToNext is positive", f.msToNext > 0);
  // 16:20 - 12:00 = 260 minutes
  ok("msToNext counts to the real boundary", f.msToNext === 260 * 60_000, String(f.msToNext));
}
// The cross-fade window: blend rises to 1 AT the boundary and is 0 one minute
// before the window opens. A blend that never reached 1 would leave a visible
// snap at every boundary; one that started early would wash out the state.
{
  const b = 980; // golden begins
  ok("blend is 0 outside the window", skyAt(atMin(b - SKY_TRANSITION_MIN - 1)).blend === 0);
  ok(
    "blend opens at the window edge",
    skyAt(atMin(b - SKY_TRANSITION_MIN)).blend === 0,
    String(skyAt(atMin(b - SKY_TRANSITION_MIN)).blend),
  );
  const mid = skyAt(atMin(b - SKY_TRANSITION_MIN / 2)).blend;
  ok("blend is halfway at the window's midpoint", Math.abs(mid - 0.5) < 1e-9, String(mid));
  const last = skyAt(atMin(b - 1)).blend;
  ok("blend is nearly 1 at the last minute", last > 0.9, String(last));
  ok("blend is never above 1", last <= 1);
  ok(
    "the state on the far side of the window has actually changed",
    skyAt(atMin(b)).state === "golden" && skyAt(atMin(b - 1)).state === "morning",
  );
}
// Purity: the same instant answers the same way, always.
{
  const t = atMin(1000);
  const a = skyAt(t);
  const b = skyAt(t);
  ok(
    "skyAt is pure",
    a.state === b.state && a.blend === b.blend && a.minuteOfDay === b.minuteOfDay,
  );
}

// ── 6. nextBoundaryAfter ──────────────────────────────────────────────────
ok("next boundary after noon is 16:20", nextBoundaryAfter(720) === 980);
ok("next boundary after 20:00 wraps past midnight", nextBoundaryAfter(1200) === 1440 + 270);
ok("next boundary after 00:10 is 04:30", nextBoundaryAfter(10) === 270);

// ── 7. skyMode — the theme mode's only input ──────────────────────────────
ok("skyMode at noon is light", skyMode(atMin(720)) === "light");
ok("skyMode at 2am is dark", skyMode(atMin(120)) === "dark");
ok("skyMode at 5am (predawn) is dark", skyMode(atMin(300)) === "dark");
ok("skyMode at 5pm (golden) is light", skyMode(atMin(1020)) === "light");
ok("skyMode at 6:30pm (dusk) is dark", skyMode(atMin(1110)) === "dark");
ok(
  "skyMode never disagrees with the token table",
  Array.from({ length: 1440 }, (_, m) => skyMode(atMin(m)) === SKY_TOKENS[stateAtMinute(m)].mode)
    .every(Boolean),
);

// ── 8. the moon ───────────────────────────────────────────────────────────
// A moon that is always full is a sticker. These pin that it moves, that it
// is never invisible, and that it is the same moon on every device.
{
  const p = moonPhaseAt(Date.UTC(2026, 7, 22));
  ok("phase fraction is in range", p.fraction >= 0 && p.fraction < 1, String(p.fraction));
  ok("lit fraction is in range", p.lit >= 0 && p.lit <= 1, String(p.lit));
  ok("side is -1 or 1", p.side === -1 || p.side === 1, String(p.side));
  ok("phase has a label", typeof p.label === "string" && p.label.length > 0);

  let minOffset = Infinity;
  let maxOffset = -Infinity;
  const labels = new Set();
  for (let d = 0; d < 60; d++) {
    const q = moonPhaseAt(Date.UTC(2026, 0, 1) + d * DAY);
    minOffset = Math.min(minOffset, q.offset);
    maxOffset = Math.max(maxOffset, q.offset);
    labels.add(q.label);
  }
  // NEVER INVISIBLE: an absent moon on a sky that has one every other night
  // reads as a bug, so the crescent floors at a sliver rather than going to
  // nothing at new moon.
  ok("the moon is never fully eaten", minOffset >= 7, minOffset.toFixed(2));
  ok("the moon reaches (near) full", maxOffset > 97, maxOffset.toFixed(2));
  ok("two months produce several distinct phases", labels.size >= 4, [...labels].join(","));
  ok(
    "the phase is deterministic",
    moonPhaseAt(12345678).offset === moonPhaseAt(12345678).offset &&
      moonPhaseAt(12345678).label === moonPhaseAt(12345678).label,
  );
  // Both directions actually occur, or the crescent would only ever open one
  // way and half of every month would be drawn backwards.
  const sides = new Set(
    Array.from({ length: 40 }, (_, d) => moonPhaseAt(Date.UTC(2026, 0, 1) + d * DAY).side),
  );
  ok("waxing and waning both happen", sides.size === 2, [...sides].join(","));
}

// ── 9. the test seam ──────────────────────────────────────────────────────
// The seam is how the browser battery photographs all five states without
// waiting for a day to pass, so a broken seam is a battery that silently
// screenshots the same sky five times.
ok("a bad seed is rejected", parseSkySeed("nonsense") === null);
ok("an empty seed is rejected", parseSkySeed("") === null);
ok("a null seed is rejected", parseSkySeed(null) === null);
ok("an out-of-range time is rejected", parseSkySeed("25:00") === null);
ok("a bad minute is rejected", parseSkySeed("04:99") === null);
for (const s of SKY_STATES) {
  const at = parseSkySeed(s, BASE_MIDNIGHT + 11 * 3_600_000);
  ok(`seed "${s}" resolves`, at !== null);
  ok(
    `seed "${s}" lands in ${s}`,
    at !== null && skyAt(at).state === s,
    at === null ? "null" : skyAt(at).state,
  );
  // The midpoint, so a screenshot is of the STATE rather than of a cross-fade.
  ok(`seed "${s}" is clear of the transition window`, at !== null && skyAt(at).blend === 0);
}
{
  const at = parseSkySeed("04:45", BASE_MIDNIGHT + 11 * 3_600_000);
  ok("an explicit IST time resolves", at !== null);
  ok("04:45 is predawn", at !== null && skyAt(at).state === "predawn", String(at && skyAt(at).state));
  ok("04:45 resolves to minute 285", at !== null && skyAt(at).minuteOfDay === 285);
}
ok(
  "every midpoint is inside its own state",
  SKY_STATES.every((s) => stateAtMinute(midpointOf(s)) === s),
);
// The night midpoint is the one that has to cross midnight to be right.
ok("night's midpoint is in the small hours", midpointOf("night") < 270, String(midpointOf("night")));

// ── 10. the one clock ─────────────────────────────────────────────────────
// STRUCTURAL, on the source text, because this is a rule about what the file
// may CONTAIN rather than about what it returns. sky.ts must derive its hour
// from timeline.ts's istParts and from nothing else — a `new Date().getHours()`
// slipped in here would read the DEVICE's clock, and a user in California
// would get a night sky over her Bangalore morning while the prompt she is
// answering from says it is 10am.
{
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(join(ROOT, "src/engine/sky.ts"), "utf8"),
  );
  ok("sky.ts imports istParts from timeline", /import \{ istParts \} from "\.\/timeline"/.test(src));
  // Comment-blind, because this file's own header states the rule in prose
  // and the first version of this check failed on the sentence describing
  // what may not be there. A lint that flags its own justification is a lint
  // people delete.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
  ok(
    "sky.ts never reads local hours",
    !/getHours\(|getMinutes\(|getDay\(|toLocaleTimeString/.test(code),
  );
  ok(
    "sky.ts imports nothing but timeline",
    (src.match(/^import /gm) || []).length === 1,
    String((src.match(/^import /gm) || []).length),
  );
}

// ── 11. HER STORY, AND THE CLOCK IT ANSWERS TO ────────────────────────────
//
// The story pool is the sky's problem, which is why it is pinned here rather
// than in a file of its own: a pool that drifted out of step with the sky
// would put a thali on screen under a noon painting. Every failure mode of it
// is the same silent species as the sky's — wrong for one part of one day,
// perfect at every other moment.
//
// ── AND IT IS THE MIRROR'S GATE ──────────────────────────────────────────
//
// `storyCatalog.ts` cannot import `sky.ts` or `timeline.ts`. `persona.ts`
// imports `storyContext()` from it, and the edge closes this loop:
//
//   persona -> storyCatalog -> timeline -> shapelint -> compiler
//   compiler -> agents/registry -> agents/meera -> persona
//
// which is not a stylistic cycle — `compiler.ts` reads
// `DEFAULT_AGENT.CRISIS_LINES` at module scope, so with the edge present the
// engine bundle throws on import and `evals/honesty` dies before its first
// assertion. tsc and vite both pass either way, which is exactly why it needs
// a gate and not a convention.
//
// So the file mirrors four clock facts, and THIS BLOCK is the thing that
// stops a mirror becoming a second clock: both implementations are bundled
// and swept against each other over every minute of every weekday. Same
// device as `evals/self/life.mjs` running api/life.js's duplicated lint
// against life.ts's, and same reason.
{
  const outStory = join(dir, "story.mjs");
  execFileSync(
    "npx",
    ["esbuild", "src/engine/storyCatalog.ts", "--bundle", "--format=esm", "--platform=node",
      `--outfile=${outStory}`, "--log-level=error"],
    { cwd: ROOT, stdio: "inherit" },
  );
  const story = await import(outStory);
  // timeline.ts too: the mirror's other half. Asserting the split point
  // against a constant copied into this file would assert nothing.
  const outTime = join(dir, "timeline.mjs");
  execFileSync(
    "npx",
    ["esbuild", "src/engine/timeline.ts", "--bundle", "--format=esm", "--platform=node",
      `--outfile=${outTime}`, "--log-level=error"],
    { cwd: ROOT, stdio: "inherit" },
  );
  const timeline = await import(outTime);
  const { existsSync } = await import("node:fs");

  // ── THE MIRROR AGREES WITH THE ORIGINALS ────────────────────────────────
  // Swept, not spot-checked: the whole point of a mirror is that it is right
  // everywhere or it is a second clock.
  {
    let dateDrift = 0;
    let firstDate = "";
    for (let d = 0; d < 9; d++) {
      for (let m = 0; m < 1440; m += 3) {
        const at = BASE_MIDNIGHT + d * DAY + m * 60_000;
        // THE MIRROR ITSELF, not a story id. This used to slice the date out
        // of `poolStoryAt(at).id`, which was a proxy that happened to hold
        // while the id keyed on the calendar day. It no longer does (a night
        // story keeps ONE id across midnight — storyCatalog's `poolStoryAt`),
        // so the proxy would now fail for a property it was never testing.
        const mine = story.istDateKey(at);
        const theirs = timeline.istParts(at).dateKey;
        if (mine !== theirs) {
          dateDrift++;
          if (!firstDate) firstDate = `${mine} vs ${theirs}`;
        }
      }
    }
    ok("the mirrored date key matches timeline.ts's", dateDrift === 0, `${dateDrift} ${firstDate}`);
    // The one boundary the sky does not own. It is timeline.ts's weekday
    // morning_work -> midday_work edge, and it has to STAY that: a fixed
    // 11:30 that timeline later moved would be the drift this block exists
    // to prevent.
    const WEEKDAY = 3; // Wednesday
    ok(
      "the midday split is timeline.ts's own morning_work -> midday_work edge",
      timeline.slotAt(11 * 60 + 29, WEEKDAY).def.key === "morning_work" &&
        timeline.slotAt(11 * 60 + 30, WEEKDAY).def.key === "midday_work" &&
        story.slotForStory(BASE_MIDNIGHT + (11 * 60 + 29) * 60_000) === "morning" &&
        story.slotForStory(BASE_MIDNIGHT + (11 * 60 + 30) * 60_000) === "midday",
      `${timeline.slotAt(11 * 60 + 30, WEEKDAY).def.key} / ${story.slotForStory(BASE_MIDNIGHT + (11 * 60 + 30) * 60_000)}`,
    );
    ok(
      "the mirrored IST offset matches timeline.ts's",
      timeline.IST_OFFSET_MIN === 330 &&
        story.istDayIndex(BASE_MIDNIGHT) === story.istDayIndex(BASE_MIDNIGHT + 1439 * 60_000),
      String(timeline.IST_OFFSET_MIN),
    );
  }

  // ── the pool itself ─────────────────────────────────────────────────────
  ok("the pool has six scenes", story.STORY_POOL.length === 6, String(story.STORY_POOL.length));
  ok(
    "every pool image ships",
    story.STORY_POOL.every((p) => existsSync(join(ROOT, "public/stories", `${p.slug}.jpg`))),
    story.STORY_POOL.filter((p) => !existsSync(join(ROOT, "public/stories", `${p.slug}.jpg`)))
      .map((p) => p.slug)
      .join(","),
  );
  ok("slugs are unique", new Set(story.STORY_POOL.map((p) => p.slug)).size === 6);
  ok(
    "every declared slot is one of the five",
    story.STORY_POOL.every((p) => story.STORY_SLOTS.includes(p.slot)),
  );
  // A slot with no image is a slot where she has no story, which is the empty
  // ring the pool exists to prevent — and it would only appear at that hour.
  ok(
    "every slot has at least one image",
    story.STORY_SLOTS.every((s) => story.STORY_POOL.some((p) => p.slot === s)),
    story.STORY_SLOTS.filter((s) => !story.STORY_POOL.some((p) => p.slot === s)).join(","),
  );

  // ── shapelint, on the descs, because they reach the prompt ──────────────
  // `recited-prompt`: these are injected by `storyContext()` and are the most
  // sentence-shaped thing in that block. The three rules `lintLine` actually
  // measures, re-implemented from shapelint.ts's own constants rather than
  // imported, so a pool desc cannot pass by the lint being loosened.
  {
    const dirty = [];
    for (const p of story.STORY_POOL) {
      const d = p.desc.trim();
      const words = d.split(/\s+/).filter(Boolean).length;
      if (words > 14) dirty.push(`${p.slug}: ${words} words`);
      if (/^[A-Z][^.?!]*[.?!]$/.test(d)) dirty.push(`${p.slug}: sentence-shaped`);
      if (/^(i\b|i'm\b|i've\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i.test(d)) {
        dirty.push(`${p.slug}: first-person line-initial`);
      }
      if (!d) dirty.push(`${p.slug}: empty desc`);
    }
    ok("every pool desc is shape-lint clean", dirty.length === 0, dirty.join("; "));
  }

  // ── the slot map: total, and in step with the sky ───────────────────────
  // Every minute of every day of the week must resolve, and must resolve to a
  // slot whose light agrees with the sky behind it. The second half is the
  // load-bearing one: `golden` maps to golden, `dusk` to dusk, and both dark
  // states to `night`, so the story's light can never disagree with the
  // painting it is opened from.
  {
    let bad = 0;
    let mismatched = [];
    const seen = new Set();
    for (let d = 0; d < 7; d++) {
      for (let m = 0; m < 1440; m++) {
        const at = BASE_MIDNIGHT + d * DAY + m * 60_000;
        const slot = story.slotForStory(at);
        if (!story.STORY_SLOTS.includes(slot)) bad++;
        seen.add(slot);
        const skyState = skyAt(at).state;
        const wanted =
          skyState === "golden" ? "golden"
          : skyState === "dusk" ? "dusk"
          : skyState === "night" || skyState === "predawn" ? "night"
          : null; // `morning` splits into morning/midday and is checked below
        if (wanted && slot !== wanted) mismatched.push(`d${d} ${m}: sky ${skyState} -> ${slot}`);
        if (!wanted && slot !== "morning" && slot !== "midday") {
          mismatched.push(`d${d} ${m}: sky morning -> ${slot}`);
        }
      }
    }
    ok("every minute of every weekday resolves to a slot", bad === 0, `${bad} bad`);
    ok("all five slots are reachable", seen.size === 5, [...seen].join(","));
    ok(
      "the story's slot never disagrees with the sky",
      mismatched.length === 0,
      mismatched.slice(0, 3).join(" | "),
    );
  }
  // …and the split inside the long `morning` sky is a real split, not a
  // constant: both halves have to actually occur or one of the two midday
  // images would never be seen by anyone.
  {
    const slots = new Set();
    for (let m = 370; m < 980; m++) slots.add(story.slotForStory(BASE_MIDNIGHT + m * 60_000));
    ok("the daylight block splits into morning AND midday", slots.size === 2, [...slots].join(","));
  }

  // ── determinism: two devices, one picture ───────────────────────────────
  // There is no server telling anyone which image is live, so this is the
  // only thing making the phone and the browser agree. Checked across a whole
  // day's minutes, because a pick that depended on the time rather than the
  // date would change under someone mid-scroll.
  {
    const day0 = BASE_MIDNIGHT + 8 * DAY;
    let unstable = 0;
    for (const slot of story.STORY_SLOTS) {
      const first = story.pickFor(slot, day0);
      for (let m = 0; m < 1440; m += 7) {
        if (story.pickFor(slot, day0 + m * 60_000)?.slug !== first?.slug) unstable++;
      }
    }
    ok("a slot's pick is fixed for the whole Bangalore day", unstable === 0, `${unstable} drifts`);
    ok(
      "the same instant answers the same way twice",
      story.poolStoryAt(day0 + 750 * 60_000).id === story.poolStoryAt(day0 + 750 * 60_000).id,
    );
    // The day number is what makes two timezones agree; a device clock read
    // anywhere in the same Bangalore day must land on the same index.
    ok(
      "the day index is constant across a Bangalore day and steps at midnight",
      story.istDayIndex(BASE_MIDNIGHT) === story.istDayIndex(BASE_MIDNIGHT + 1439 * 60_000) &&
        story.istDayIndex(BASE_MIDNIGHT + DAY) === story.istDayIndex(BASE_MIDNIGHT) + 1,
    );
  }

  // ── no repeat until the pool cycles ─────────────────────────────────────
  // The property a `hash % n` cannot give you: over any n consecutive days,
  // a slot with n images shows each of them exactly once. Swept over 60 days
  // and every cycle boundary in them, which is where a naive implementation
  // repeats.
  {
    const broken = [];
    for (const slot of story.STORY_SLOTS) {
      const n = story.STORY_POOL.filter((p) => p.slot === slot).length;
      for (let start = 0; start < 60; start++) {
        const window = [];
        for (let k = 0; k < n; k++) {
          window.push(story.pickFor(slot, BASE_MIDNIGHT + (start + k) * DAY)?.slug);
        }
        // Only ALIGNED windows carry the guarantee — an arbitrary sliding
        // window across a cycle boundary may legitimately repeat, the same
        // way a reshuffled deck may deal the same card twice in a row.
        const aligned = story.istDayIndex(BASE_MIDNIGHT + start * DAY) % n === 0;
        if (aligned && new Set(window).size !== n) broken.push(`${slot}@${start}: ${window.join(",")}`);
      }
    }
    ok("each cycle deals every image in the slot exactly once", broken.length === 0, broken.slice(0, 3).join(" | "));
  }
  // ── M1: NO IMAGE EVER FOLLOWS ITSELF ────────────────────────────────────
  //
  // The property the aligned-window check above CANNOT see, and the one a
  // person actually experiences. Each cycle dealt every image exactly once
  // and that was true, while nothing looked at the SEAM between two deals —
  // where one cycle's last pick and the next cycle's first pick were drawn
  // independently. On the two-image midday slot that is a coin flip every
  // second day: measured 45.5% of consecutive day pairs showing the same
  // image, arriving as AABB runs.
  //
  // 4000 days, every slot with two or more images. A one-image slot is
  // exempt, and exempt IN WRITING: one picture cannot avoid following itself,
  // and pretending otherwise would make this unpassable by construction
  // rather than by defect.
  {
    const DAYS = 4000;
    const swept = [];
    for (const slot of story.STORY_SLOTS) {
      const n = story.STORY_POOL.filter((p) => p.slot === slot).length;
      if (n < 2) continue;
      let repeats = 0;
      let first = "";
      let prev = story.pickFor(slot, BASE_MIDNIGHT)?.slug;
      for (let d = 1; d < DAYS; d++) {
        const cur = story.pickFor(slot, BASE_MIDNIGHT + d * DAY)?.slug;
        if (cur === prev) {
          repeats++;
          if (!first) first = `day ${d}: ${prev} twice`;
        }
        prev = cur;
      }
      swept.push({ slot, n, repeats, first });
    }
    ok(
      "there is at least one slot with n>=2 for the sweep to mean anything",
      swept.length > 0,
      `${swept.length} slots`,
    );
    ok(
      `no image follows itself, ${DAYS} days, every slot with n>=2`,
      swept.length > 0 && swept.every((w) => w.repeats === 0),
      swept
        .map((w) => `${w.slot}(n=${w.n}) ${w.repeats}${w.first ? ` — ${w.first}` : ""}`)
        .join(" | "),
    );
  }
  // …and the same, at pool sizes this repo does not currently have. `pickFor`
  // can only ever exercise the sizes the shipped pool happens to hold (one
  // slot at n=2, four at n=1), so the n>=3 branch of `cycleOrder` — the
  // shuffle-and-swap — is code no test would otherwise reach. `dead-writers`
  // applies to branches as much as it does to writers.
  {
    const bad = [];
    for (let n = 2; n <= 8; n++) {
      const seq = [];
      // negative cycles included: `pickFor` floor-divides, so instants before
      // the epoch produce them and the eval elsewhere sweeps those
      for (let c = -20; c < 400; c++) seq.push(...story.cycleOrder(`probe-${n}`, c, n));
      for (let c = 0; (c + 1) * n <= seq.length; c++) {
        const block = seq.slice(c * n, c * n + n);
        if (new Set(block).size !== n) bad.push(`n=${n} cycle ${c} is not a full deal`);
      }
      for (let i = 1; i < seq.length; i++) {
        if (seq[i] === seq[i - 1]) bad.push(`n=${n} repeat at index ${i}`);
      }
    }
    ok("cycleOrder deals cleanly and never repeats, n=2..8", bad.length === 0, bad.slice(0, 3).join(" | "));
  }
  // n=2 is FORCED to alternate, and this asks for that rather than for a
  // variety it cannot have: with two images, "each appears once per two days"
  // plus "never twice running" has exactly one solution. Above n=2 the order
  // must still vary between cycles, or the pool is a fixed playlist.
  {
    const twos = new Set();
    for (let c = 0; c < 40; c++) twos.add(story.cycleOrder("probe-2", c, 2).join(">"));
    ok("n=2 alternates — the only repeat-free deal that exists there", twos.size === 1, [...twos].join(" "));
    const fours = new Set();
    for (let c = 0; c < 40; c++) fours.add(story.cycleOrder("probe-4", c, 4).join(">"));
    ok("n=4 deals more than one order across cycles", fours.size > 1, `${fours.size} orders`);
  }

  // ── M2: MIDNIGHT DOES NOT REWRITE HER EVENING ───────────────────────────
  //
  // The night slot runs 19:40 -> 06:10 on purpose (predawn folds into night:
  // she was asleep, she did not post at five). Keying the story on the
  // CALENDAR day broke that one run into three, and each break was its own
  // visible lie: the picture you had already watched came back as an unseen
  // gold ring at 00:00, its age reset to "just now", and at 04:30 it started
  // again and claimed "1m".
  {
    const at = (d, h, m) => BASE_MIDNIGHT + d * DAY + (h * 60 + m) * 60_000;
    const s = (t) => story.poolStoryAt(t);
    ok(
      "the night slot has a picture to test with",
      story.STORY_POOL.some((p) => p.slot === "night"),
    );

    const before = s(at(3, 23, 58));
    const after = s(at(4, 0, 1));
    ok(
      "23:58 -> 00:01 keeps the id, so seen-state survives the wrap",
      before.id === after.id,
      `${before.id} / ${after.id}`,
    );
    ok("23:58 -> 00:01 keeps the picture", before.src === after.src, `${before.src} / ${after.src}`);
    ok(
      "23:58 -> 00:01 keeps the post time",
      before.at === after.at,
      `${new Date(before.at).toISOString()} / ${new Date(after.at).toISOString()}`,
    );

    // 04:31 — the case that read "posted 1m ago". Her night story began at
    // 19:40 the previous evening, so it is nearly nine hours old.
    const late = s(at(4, 4, 31));
    const ageMin = Math.round((at(4, 4, 31) - late.at) / 60_000);
    ok(
      "04:31 is still the same night story, not a new one",
      late.id === before.id,
      `${late.id} / ${before.id}`,
    );
    ok("04:31 never claims a fresh post time", ageMin >= 8 * 60, `${ageMin} min old (was 1)`);

    // The whole run, minute by minute: ONE id and ONE post time from 19:40
    // through 06:09 the next morning.
    const ids = new Set();
    const ats = new Set();
    for (let t = at(3, 19, 40); t < at(4, 6, 10); t += 60_000) {
      ids.add(s(t).id);
      ats.add(s(t).at);
    }
    ok(
      "one night is one story, all 630 minutes of it",
      ids.size === 1 && ats.size === 1,
      `${ids.size} ids, ${ats.size} post times`,
    );
    // …and it DOES turn over at 06:10, or the ring is simply stuck.
    ok("06:10 is a new story", s(at(4, 6, 10)).id !== [...ids][0], s(at(4, 6, 10)).id);
  }
  // `slotStartedAt` walks two days of boundaries back, which is only enough
  // because night is the one slot that crosses a midnight and crosses exactly
  // one. Asserted rather than assumed.
  {
    let longest = -1;
    let where = "";
    let negatives = 0;
    for (let d = 0; d < 14; d++) {
      for (let m = 0; m < 1440; m += 7) {
        const t = BASE_MIDNIGHT + d * DAY + m * 60_000;
        const age = t - story.slotStartedAt(t);
        if (age < 0) negatives++;
        if (age > longest) {
          longest = age;
          where = `${story.slotForStory(t)} at day ${d} ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        }
      }
    }
    ok("a slot never began in the future", negatives === 0, `${negatives}`);
    ok(
      "no slot occurrence is longer than a day, so the two-day walk is enough",
      longest < DAY,
      `${(longest / 3_600_000).toFixed(2)}h, longest is ${where}`,
    );
  }

  // ── the authored days still win ─────────────────────────────────────────
  // Publishing a real day has to keep working exactly as storyCatalog's own
  // header documents, or the pool has quietly taken the feature over.
  {
    const authoredAt = story.STORIES[0].at;
    const live = story.activeStories(authoredAt + 3_600_000);
    ok(
      "an authored day beats the pool on its own date",
      live.length === story.STORIES.length && live.every((s) => !s.id.startsWith("pool-")),
      live.map((s) => s.id).join(","),
    );
    // …and does NOT leak into every other day, which is the "never expires"
    // workaround this replaced: a fortnight later the ring must be showing
    // today's story, not a book she read on the 9th.
    const later = story.activeStories(authoredAt + 14 * DAY);
    ok(
      "a fortnight later the pool has the ring, not the old batch",
      later.length === 1 && later[0].id.startsWith("pool-"),
      later.map((s) => s.id).join(","),
    );
  }

  // ── the ring is never empty, and never claims the future ────────────────
  {
    let empty = 0;
    let future = 0;
    let stale = 0;
    let missingSrc = 0;
    for (let d = 0; d < 21; d++) {
      for (let m = 0; m < 1440; m += 11) {
        const at = BASE_MIDNIGHT + d * DAY + m * 60_000;
        const live = story.activeStories(at);
        if (!live.length) empty++;
        for (const s of live) {
          if (s.at > at) future++;
          // A pool story is always TODAY's, so `storyAge` never reaches its
          // over-a-day branch and StoryView's label is always minutes/hours.
          if (s.id.startsWith("pool-") && at - s.at >= DAY) stale++;
          if (!existsSync(join(ROOT, "public", s.src))) missingSrc++;
        }
      }
    }
    ok("the ring is never empty", empty === 0, `${empty} empty`);
    ok("a story is never posted in the future", future === 0, `${future}`);
    ok("a pool story is always less than a day old", stale === 0, `${stale}`);
    ok("every live story points at a file that ships", missingSrc === 0, `${missingSrc}`);
  }

  // The id carries the date, which is what makes seen-state clear itself at
  // midnight and the gold ring come back for a new day.
  {
    const a = story.poolStoryAt(BASE_MIDNIGHT + 750 * 60_000).id;
    const b = story.poolStoryAt(BASE_MIDNIGHT + DAY + 750 * 60_000).id;
    ok("a new day is a new story id", a !== b, `${a} / ${b}`);
  }
}

console.log(fail ? `${fail} of ${checks} FAILED` : `ALL PASS (${checks} checks)`);
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* temp dir */
}
process.exit(fail ? 1 : 0);
