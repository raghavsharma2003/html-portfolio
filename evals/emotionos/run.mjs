// WS-R153. EmotionOS: vibe and register. WS-R176 adds §4: the register in
// the Room's own reply and voice.
//
//   node evals/emotionos/run.mjs
//
// Three things this suite proves, offline, against the REAL modules:
//
//   1. THE REGISTER READ (register.ts's `readRegister`/`renderRegisterHint`).
//      60 hand-labelled turns, 20 per language (English, Hindi/Devanagari,
//      Hinglish), 4 per register bucket per language — driven through the
//      real cascade, tallied into a confusion table (expected x actual),
//      printed and logged to context/measurements.md verbatim. A REQUIRED
//      NEGATIVE CONTROL: a neutral turn renders NOTHING from
//      `renderRegisterHint`, at any confidence — the render-site law
//      register.ts's own header states, checked here rather than trusted.
//   2. THE VIBE RENDER (compiler.ts's `renderVibe`). Every one of the five
//      0-4 dials bands to its own authored word; absent input renders "";
//      a malformed dial (out of 0-4, non-integer) fails the WHOLE block
//      closed rather than rendering four good lines and dropping the fifth.
//   3. WS-R176 — THE ROOM, END TO END. The SAME 60 labelled turns, driven
//      through the REAL `roomSay` (api/_room-surface.js): the compiled
//      prompt carries the expected hint (or none) at the position
//      `readRegister` itself computed for the SAME inputs `roomSay` now
//      passes it (text, a gap of 0, the hour of the fixed clock this
//      section uses). Then the REAL `roomSpeak`, on the SAME reply,
//      carries the SAME register into the prosody plan handed to
//      `deps.synth`. A REQUIRED NEGATIVE CONTROL: a genuine LOW-confidence
//      row, run through `roomSay`+`roomSpeak` once as itself and once with
//      `engine.readRegister` overridden to return an explicit neutral read,
//      produces a BYTE-IDENTICAL compiled prompt and a BYTE-IDENTICAL
//      prosody plan either way — proving a low-confidence read is already
//      inert at both render sites, never merely untested. A second control
//      proves that comparison is not vacuous: the identical override
//      applied to a genuine HIGH-confidence row DOES change both.
//
// Offline, deterministic, $0, no DB, no network, no model call.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REGISTER_FIXTURES } from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

// ── bundle register.ts and compiler.ts's vibe exports from the REAL source
//    — evals/clonechannel.mjs's own precedent ("a frozen bundle passes
//    forever while the source rots"), never a re-typed copy of either. ──
const OUT = mkdtempSync(join(tmpdir(), "emotionos-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  [
    `export { readRegister, renderRegisterHint, REGISTERS, REGISTER_HINTS } from ${JSON.stringify(join(REPO, "src/engine/register"))};`,
    `export { renderVibe } from ${JSON.stringify(join(REPO, "src/engine/compiler"))};`,
    "",
  ].join("\n"),
);
const BUNDLE = join(OUT, "emotionos.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error ` +
    `--alias:@capacitor/core=${join(REPO, "evals/stubs/capacitor.mjs")}`,
  { cwd: REPO, stdio: "inherit" },
);
const { readRegister, renderRegisterHint, REGISTERS, REGISTER_HINTS, renderVibe } =
  await import(pathToFileURL(BUNDLE).href);

// ═════════════════════════════════════════════════════════════════════════
// §1. THE REGISTER READ — 60 labelled turns, confusion table
// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: the register read, 60 labelled turns across three languages ──");

ok("REGISTER_FIXTURES carries exactly 60 rows (the brief's own count)", REGISTER_FIXTURES.length === 60,
  `got ${REGISTER_FIXTURES.length}`);

const LANGS = ["en", "hi", "hinglish"];
const perLang = {};
for (const l of LANGS) perLang[l] = REGISTER_FIXTURES.filter((r) => r[0] === l).length;
ok("20 rows per language", LANGS.every((l) => perLang[l] === 20), JSON.stringify(perLang));

// confusion[expected][actual] = count
const confusion = {};
for (const e of REGISTERS) { confusion[e] = {}; for (const a of REGISTERS) confusion[e][a] = 0; }
let correct = 0;
let highConfCorrect = 0;
let highConfTotal = 0;
const byLang = {};
for (const l of LANGS) byLang[l] = { n: 0, correct: 0 };
const misses = [];

for (const [lang, text, expected, extra] of REGISTER_FIXTURES) {
  const result = readRegister(text, extra || {});
  confusion[expected][result.register] = (confusion[expected][result.register] || 0) + 1;
  const isCorrect = result.register === expected;
  if (isCorrect) correct++;
  byLang[lang].n++;
  if (isCorrect) byLang[lang].correct++;
  if (result.confidence === "high") {
    highConfTotal++;
    if (isCorrect) highConfCorrect++;
  }
  if (!isCorrect) misses.push({ lang, text, expected, got: result.register, confidence: result.confidence });
}

console.log("\n  confusion table (rows = expected, cols = actual):");
console.log(`  ${"".padEnd(10)}${REGISTERS.map((r) => r.padEnd(10)).join("")}`);
for (const e of REGISTERS) {
  console.log(`  ${e.padEnd(10)}${REGISTERS.map((a) => String(confusion[e][a]).padEnd(10)).join("")}`);
}
console.log(`\n  overall accuracy: ${correct}/${REGISTER_FIXTURES.length} (${((correct / REGISTER_FIXTURES.length) * 100).toFixed(1)}%)`);
for (const l of LANGS) {
  console.log(`  ${l}: ${byLang[l].correct}/${byLang[l].n} (${((byLang[l].correct / byLang[l].n) * 100).toFixed(1)}%)`);
}
console.log(`  accuracy AMONG high-confidence calls: ${highConfCorrect}/${highConfTotal} ` +
  `(${highConfTotal ? ((highConfCorrect / highConfTotal) * 100).toFixed(1) : "n/a"}%)`);
if (misses.length) {
  console.log("\n  misses:");
  for (const m of misses) console.log(`    [${m.lang}] "${m.text}" — expected ${m.expected}, got ${m.got}/${m.confidence}`);
}

// The gate: overall accuracy at or above 90%, and — the property that
// actually matters for a render-gated hint — accuracy among HIGH-confidence
// calls at or above 95%, since a wrong LOW-confidence call never reaches the
// model at all (renderRegisterHint's own gate), while a wrong HIGH-confidence
// one does.
ok(`overall accuracy >= 90% (measured ${((correct / REGISTER_FIXTURES.length) * 100).toFixed(1)}%)`,
  correct / REGISTER_FIXTURES.length >= 0.9);
ok(`high-confidence accuracy >= 95% (measured ${highConfTotal ? ((highConfCorrect / highConfTotal) * 100).toFixed(1) : "n/a"}%, n=${highConfTotal})`,
  highConfTotal > 0 && highConfCorrect / highConfTotal >= 0.95);
for (const l of LANGS) {
  ok(`${l}: no language is systematically worse (>=80% of its own 20 rows correct)`, byLang[l].correct / byLang[l].n >= 0.8,
    `${byLang[l].correct}/${byLang[l].n}`);
}

// ═════════════════════════════════════════════════════════════════════════
// §2. NEGATIVE CONTROL — "neutral" never renders, at any confidence
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: negative control — a neutral turn renders nothing ──");

const neutralRow = REGISTER_FIXTURES.find((r) => r[2] === "neutral");
const neutralResult = readRegister(neutralRow[1], neutralRow[3] || {});
ok("a real neutral-labelled turn is actually classified neutral by the real cascade (fixture sanity)",
  neutralResult.register === "neutral", JSON.stringify(neutralResult));
ok("renderRegisterHint(neutral/low) is empty", renderRegisterHint({ register: "neutral", confidence: "low" }) === "");
ok("renderRegisterHint(neutral/high) is ALSO empty — neutral never renders regardless of confidence " +
  "(a fabricated high-confidence neutral, since the real cascade never emits one, proving the RENDER " +
  "GATE itself refuses it rather than merely never being asked to)",
  renderRegisterHint({ register: "neutral", confidence: "high" }) === "");
ok("renderRegisterHint(null) is empty (a caller with no turn)", renderRegisterHint(null) === "");
ok("renderRegisterHint(undefined) is empty", renderRegisterHint(undefined) === "");
ok("an empty string turn reads as neutral/low", (() => {
  const r = readRegister("", {});
  return r.register === "neutral" && r.confidence === "low";
})());

// LOW confidence never renders either, for a real non-neutral bucket —
// the actual gate `compiler.ts` relies on, exercised on a genuine low-
// confidence row from the table above rather than a hand-built one.
const lowConfRow = REGISTER_FIXTURES
  .map(([lang, text, expected, extra]) => ({ lang, text, expected, result: readRegister(text, extra || {}) }))
  .find((r) => r.result.confidence === "low" && r.result.register !== "neutral");
ok("a genuine low-confidence, non-neutral row exists in the fixture set (so the next check is not vacuous)",
  Boolean(lowConfRow), lowConfRow ? `${lowConfRow.lang}: "${lowConfRow.text}"` : "none found");
if (lowConfRow) {
  ok(`renderRegisterHint refuses a real LOW-confidence "${lowConfRow.result.register}" row`,
    renderRegisterHint(lowConfRow.result) === "");
}

// Every non-neutral register has exactly one authored hint, content-free of
// the turn's own words (no interpolation) — `recited-prompt` checked
// mechanically: none of the fixture turns' own distinctive words appear in
// any hint.
for (const r of REGISTERS) {
  if (r === "neutral") continue;
  ok(`REGISTER_HINTS has a non-empty, single-line hint for "${r}"`,
    typeof REGISTER_HINTS[r] === "string" && REGISTER_HINTS[r].length > 0 && !REGISTER_HINTS[r].includes("\n"));
}
const allFixtureWords = new Set(
  REGISTER_FIXTURES.flatMap(([, text]) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/))
    .filter((w) => w.length > 3),
);
const hintWords = Object.values(REGISTER_HINTS).flatMap((h) => h.toLowerCase().split(/\s+/));
const leakedWords = hintWords.filter((w) => allFixtureWords.has(w) && w.length > 4);
ok("no rendered hint borrows a distinctive word from any labelled turn (recited-prompt guard)",
  leakedWords.length === 0, leakedWords.join(","));

// ═════════════════════════════════════════════════════════════════════════
// §3. THE VIBE RENDER — bands, absence, fail-closed on a malformed dial
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: the vibe render ──");

ok("absent vibe (undefined) renders \"\"", renderVibe(undefined) === "");
ok("absent vibe (null) renders \"\"", renderVibe(null) === "");

const FULL_VIBE = { warmth: 4, energy: 0, humour: 1, directness: 2, formality: 2 };
const rendered = renderVibe(FULL_VIBE);
ok("a full, valid vibe renders a non-empty block", rendered.length > 0);
ok("the block carries all five dims, semicolon-joined on one data line", (() => {
  const lastLine = rendered.split("\n").pop();
  return ["warmth", "energy", "humour", "directness", "formality"].every((d) => lastLine.includes(`${d}: `))
    && lastLine.split(";").length === 5;
})(), rendered);
ok("no digit appears anywhere in the rendered block (state-leak guard, texture.ts's own rule 1 restated)",
  !/\d/.test(rendered), rendered);

// Every band index renders a DIFFERENT word from its neighbours (bands are
// real, not five identical labels the eval would trivially pass).
for (const dim of ["warmth", "energy", "humour", "directness", "formality"]) {
  const words = new Set();
  for (let v = 0; v <= 4; v++) {
    const r = renderVibe({ ...FULL_VIBE, [dim]: v });
    const line = r.split("\n").pop();
    const m = line.match(new RegExp(`${dim}: ([^;]+)`));
    words.add(m ? m[1] : null);
  }
  ok(`"${dim}" has 5 distinct band words across its 0-4 range`, words.size === 5, [...words].join(" | "));
}

// Fail-closed: one bad dial drops the WHOLE block, never four good lines and
// a silently missing fifth ("a sliced block is a lie", texture.ts/compiler.ts's
// own shared rule for an over-budget block, applied here to a malformed one).
for (const bad of [-1, 5, 2.5, NaN, "abc", null, undefined]) {
  const r = renderVibe({ ...FULL_VIBE, warmth: bad });
  ok(`a malformed warmth (${JSON.stringify(bad)}) fails the WHOLE block closed, never a partial render`, r === "", r);
}

// ═════════════════════════════════════════════════════════════════════════
// §4. WS-R176 — THE ROOM, END TO END: the same 60 labelled turns, driven
// through the REAL `roomSay`/`roomSpeak`, plus the negative/positive
// override controls.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: the Room, end to end (WS-R176) ──");
{
  process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "m".repeat(48);
  const { freshState, fakeDb, loadFixtureAgent, SLUG, USER_A, PERSON_A } = await import(
    pathToFileURL(join(REPO, "evals/room/fixtures.mjs")).href
  );
  const { joinRoom, roomSay, roomSpeak } = await import(
    pathToFileURL(join(REPO, "api/_room-surface.js")).href
  );
  const { engine, loadAgent } = await loadFixtureAgent(REPO);
  const memory = { openEpisode: async () => ({}), logTurn: async () => {}, history: async () => [], recall: async () => [] };
  const NOW = Date.parse("2026-09-15T12:00:00.000Z");
  const HOUR = new Date(NOW).getUTCHours();
  const SAFE_REPLY = "Achha, samajh gayi. Bolo.";

  function fakeAuthorize() {
    let seq = 0;
    return async ({ text }) => {
      seq += 1;
      return {
        generation: { generation_id: `gen-${seq}`, preview_language_id: "en" },
        authorizationInput: { replicaId: "c1000000-0000-4000-8000-000000000001", ownerUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        previewStyle: { exaggeration: 0.35, cfg_weight: 0.65, temperature: 0.65 },
        previewSeed: 1,
        reference: { sha256: "0".repeat(64), durationMs: 1000, languageMode: "unknown", languageEvidenceScope: "unverified" },
      };
    };
  }
  // The real shape roomSpeak needs from both seams — `evals/room-speak-
  // plan/run.mjs`'s own `voiceSeam`, restated (that file's own is a local,
  // unexported const, this suite's own precedent for copying a sibling
  // suite's fixture rather than importing a private helper).
  function voiceSeam() {
    const plans = [];
    const synth = async ({ authorized, text, prosody }) => {
      plans.push(prosody);
      const raw = Buffer.from(`RAW:${authorized.generation.generation_id}:${text}`);
      return {
        stream: { [Symbol.asyncIterator]: async function* () { yield raw; } },
        format: { sampleRate: 24000, channels: 1 },
        renderedText: text,
        disclosureText: "This is an AI voice.",
        renderer: "fake",
      };
    };
    const protect = async ({ sourceStream }) => {
      const chunks = [];
      for await (const c of sourceStream) chunks.push(Buffer.from(c));
      const watermarked = Buffer.concat([Buffer.from("WATERMARKED:"), ...chunks]);
      return {
        stream: { [Symbol.asyncIterator]: async function* () { yield watermarked; } },
        completion: Promise.resolve({ watermark_algorithm: "fake@1", disclosure_scheme: "audible-prefix-v1" }),
      };
    };
    return { plans, synth, protect };
  }

  async function setupPaidFollower(db, state) {
    const joined = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW });
    const f = state.followers.find((x) => x.person_id === PERSON_A);
    f.tier = "paid";
    return joined.session;
  }

  // ── the main pass: all 60 rows, each its OWN fresh Room/follower so a
  // turn cannot see another's register through any carried state ──
  let hintMatches = 0;
  let planMatches = 0;
  for (const [lang, text, , extra] of REGISTER_FIXTURES) {
    const expected = readRegister(text, { gapSinceLastMs: 0, timeOfDay: HOUR });
    const expectedHint = renderRegisterHint(expected);

    const state = freshState();
    const db = fakeDb(state);
    const session = await setupPaidFollower(db, state);
    let captured = null;
    const said = await roomSay(db, { session, message: text }, {
      loadAgent, memory, engine, now: NOW,
      reply: (compiled) => { captured = compiled; return SAFE_REPLY; },
    });
    const hintOnPrompt = REGISTER_HINTS
      ? Object.values(REGISTER_HINTS).find((h) => captured.tail.includes(h)) || ""
      : "";
    if (hintOnPrompt === expectedHint) hintMatches += 1;

    const seam = voiceSeam();
    await roomSpeak(
      { db, loadAgent, engine, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect },
      said.session,
      { text: said.reply, index: 0 },
    );
    const appliedOnPlan = seam.plans[0]?.appliedRegister ?? null;
    const expectedApplied = expected.confidence === "high" && expected.register !== "neutral" ? expected.register : null;
    if (appliedOnPlan === expectedApplied) planMatches += 1;
  }
  ok(`all 60 rows: the compiled prompt carries the hint iff readRegister(text, gap=0, hour=${HOUR}) says high-confidence non-neutral`,
    hintMatches === REGISTER_FIXTURES.length, `${hintMatches}/${REGISTER_FIXTURES.length}`);
  ok("all 60 rows: roomSpeak's own prosody plan applies the SAME register the compiled prompt's hint was built from",
    planMatches === REGISTER_FIXTURES.length, `${planMatches}/${REGISTER_FIXTURES.length}`);

  // ── negative control: a genuine LOW-confidence, non-neutral row is
  // byte-identical, at BOTH render sites, to the same row forced neutral ──
  const lowRow = REGISTER_FIXTURES
    .map(([, text]) => ({ text, result: readRegister(text, { gapSinceLastMs: 0, timeOfDay: HOUR }) }))
    .find((r) => r.result.confidence === "low" && r.result.register !== "neutral");
  ok("a genuine low-confidence, non-neutral row exists at gap=0 (so the control below is not vacuous)", Boolean(lowRow));

  // ── positive control: the SAME override, on a genuine HIGH-confidence
  // row, actually changes both — proving the comparison technique itself
  // is load-bearing rather than trivially always-equal ──
  const highRow = REGISTER_FIXTURES
    .map(([, text]) => ({ text, result: readRegister(text, { gapSinceLastMs: 0, timeOfDay: HOUR }) }))
    .find((r) => r.result.confidence === "high" && r.result.register !== "neutral");
  ok("a genuine high-confidence, non-neutral row exists at gap=0 (so the positive control below is not vacuous)", Boolean(highRow));

  async function runOnce(text, engineOverride) {
    const state = freshState();
    const db = fakeDb(state);
    const session = await setupPaidFollower(db, state);
    let captured = null;
    const said = await roomSay(db, { session, message: text }, {
      loadAgent, memory, engine: engineOverride, now: NOW,
      reply: (compiled) => { captured = compiled; return SAFE_REPLY; },
    });
    const seam = voiceSeam();
    await roomSpeak(
      { db, loadAgent, engine: engineOverride, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect },
      said.session,
      { text: said.reply, index: 0 },
    );
    return { system: captured.system, plan: seam.plans[0] };
  }
  const neutralOverrideEngine = { ...engine, readRegister: () => ({ register: "neutral", confidence: "low" }) };

  if (lowRow) {
    const asIs = await runOnce(lowRow.text, engine);
    const forced = await runOnce(lowRow.text, neutralOverrideEngine);
    ok("NEGATIVE CONTROL: a real LOW-confidence read leaves the compiled prompt BYTE-IDENTICAL to an explicit neutral read",
      asIs.system === forced.system);
    ok("NEGATIVE CONTROL: a real LOW-confidence read leaves roomSpeak's prosody plan BYTE-IDENTICAL to an explicit neutral read",
      JSON.stringify(asIs.plan) === JSON.stringify(forced.plan));
  }
  if (highRow) {
    const asIs = await runOnce(highRow.text, engine);
    const forced = await runOnce(highRow.text, neutralOverrideEngine);
    ok("NEGATIVE CONTROL is not vacuous: the SAME override applied to a real HIGH-confidence row DOES change the compiled prompt",
      asIs.system !== forced.system);
    ok("NEGATIVE CONTROL is not vacuous: the SAME override applied to a real HIGH-confidence row DOES change roomSpeak's prosody plan",
      JSON.stringify(asIs.plan) !== JSON.stringify(forced.plan));
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
rmSync(OUT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
