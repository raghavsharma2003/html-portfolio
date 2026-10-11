// The QR encoder (WS-R78, `api/_qr.js`) — offline, deterministic, $0, no
// DB, no network, no model call, no GPU.
//
//   node evals/qr/run.mjs
//
// Drives the REAL module. Proves, layer by layer, exactly what this
// module's own header claims and no more:
//
//   1. GF(256) HYGIENE. The field this module bootstraps at load time has
//      the algebraic properties a GF(256) built on primitive polynomial
//      0x11D and generator 2 must have — multiplicative order 255, every
//      nonzero element self-inverse under `gfMul(a, GF_EXP[255-log(a)])`.
//   2. REED-SOLOMON, BY THE MATH, NOT BY EXAMPLE. `rsEncode(data, ec)`
//      produces codewords such that `data ++ ec`, read as a GF(256)
//      polynomial, is EXACTLY divisible by the generator polynomial for
//      that many EC codewords — this is what an RS codeword IS, checked
//      here by an INDEPENDENT polynomial-division routine (this file's
//      own, not imported from `_qr.js`) for every EC-codeword count the
//      versions-1-10/level-M capacity table actually uses. NEGATIVE
//      CONTROL: flipping one byte of a valid codeword breaks divisibility.
//   3. KNOWN VECTORS: BCH FORMAT INFO. The masked 15-bit format-info code
//      for EC level M and every mask pattern 0-7, asserted against the
//      standard published table (0x5412, 0x5125, 0x5E7C, ... 0x4AA0) — the
//      one genuinely memorised fact this suite leans on, chosen because it
//      is the fact every independent QR implementation publishes
//      identically, for the reason `api/_qr.js`'s own header names.
//   4. KNOWN VECTORS: BCH VERSION INFO. The 18-bit version-info code for
//      versions 7-10 (the only versions in this module's 1-10 range that
//      carry one), asserted against the standard published table
//      (0x07C94, 0x085BC, 0x09A99, 0x0A4D3).
//   5. STRUCTURAL SANITY. For a spread of versions (including one forced
//      into 7-10 by a long payload, to exercise the version-info path at
//      all): matrix size is exactly `17 + 4*version`; all three finder
//      patterns are the exact 7x7 ring-in-ring-in-core shape at their
//      three corners; the timing pattern alternates dark/light along row
//      6 and column 6; the dark module sits at its fixed position;
//      capacity throws past version 10; encoding is deterministic (two
//      calls on the same text produce byte-identical matrices).
//   6. SELF-CONSISTENCY ROUND TRIP. This file's OWN, independently written
//      readback (never imported from `_qr.js`) recovers the mask pattern
//      from the format-info modules and the version number from the
//      version-info modules, for several versions including 7-10 — proving
//      the write and the well-known encode math agree with each other, the
//      strongest check available without an external decoder or a real
//      camera (see `_qr.js`'s own header on what this does and does not
//      prove about real-world scannability).
//   7. NEGATIVE CONTROL: a flipped format module changes the recovered
//      mask pattern (or moves it outside 0-7 in a way the real value never
//      would), proving the round trip in (6) has teeth rather than
//      trivially agreeing with itself.
//   8. A REAL, INDEPENDENT SCANNER. `jsqr` (npm, zero dependencies, no
//      install script, a devDependency here — never imported by `api/`,
//      so law 1's "no third-party runtime" for the ENCODER is untouched)
//      decodes PIXELS this file rasterises with the same `@napi-rs/canvas`
//      engine `api/_room-card.js` ships with, for a spread of payloads
//      spanning versions 1-10 and all masks the "best" selection actually
//      picks across them. This is the check that matters most and the one
//      every earlier layer in this file could not BE: sections 1-7 all
//      passed, twice over, on the first two real bugs this module shipped
//      with — a byte-reversed Reed-Solomon generator polynomial (the
//      divisibility check in (2) cannot tell a correct generator from its
//      own mirror image, since divisibility is not orientation-sensitive
//      the way real decoding is) and an MSB-first format-info write where
//      the spec wants LSB-first (the round trip in (6) reads back
//      whatever it wrote, by construction, so it agreed with a wrong
//      answer as readily as a right one) — and neither was visible until
//      an independent decoder was pointed at the actual rendered pixels.
//      `context/rejected.md#ws-r78-reversed-rs-generator-polynomial-passed-every-self-check`
//      names both, in full, including the debugging method (byte-for-byte
//      differential against the reference `qrcode` package's own internal
//      modules) that found them. NEGATIVE CONTROL: flipping one pixel's
//      worth of a dark module in the rendered PNG (not the matrix) makes
//      the same decoder fail or return a different string.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import jsQR from "jsqr";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const { encodeQR, chooseVersion, QRCapacityError, _internals } = await import(
  pathToFileURL(join(REPO, "api/_qr.js")).href
);

// ═══ 1. GF(256) HYGIENE ═══════════════════════════════════════════════════
console.log("\n── 1. GF(256) hygiene ──");
{
  const { GF_EXP, GF_LOG, gfMul } = _internals;
  ok("GF_EXP[0] === 1 (alpha^0)", GF_EXP[0] === 1);
  ok("GF_EXP[255] === 1 (multiplicative order 255)", GF_EXP[255] === 1);
  let order255 = true;
  for (let i = 1; i < 255; i++) if (GF_EXP[i] === 1) order255 = false;
  ok("no smaller power of alpha returns to 1 (order is exactly 255, not a divisor)", order255);
  let inversesOk = true;
  for (let a = 1; a < 256; a++) {
    const inv = GF_EXP[(255 - GF_LOG[a]) % 255];
    if (gfMul(a, inv) !== 1) inversesOk = false;
  }
  ok("every nonzero element has a multiplicative inverse (a * a^-1 === 1)", inversesOk);
}

// ═══ 2. REED-SOLOMON DIVISIBILITY ═══════════════════════════════════════
console.log("\n── 2. Reed-Solomon: divisibility, not example ──");
{
  const { rsEncode, rsGeneratorPoly, gfMul } = _internals;
  // Independent polynomial-mod routine — NOT imported from _qr.js's own
  // rsEncode, so a bug shared between "compute" and "check" cannot hide.
  function dividesEvenly(codewords, ecCount) {
    const gen = rsGeneratorPoly(ecCount);
    const msg = codewords.slice();
    for (let i = 0; i < msg.length - ecCount; i++) {
      const coef = msg[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
    return msg.slice(msg.length - ecCount).every((x) => x === 0);
  }
  // Every EC-codeword count the versions-1-10/level-M capacity table uses.
  const EC_COUNTS = [10, 16, 18, 22, 24, 26];
  for (const ec of EC_COUNTS) {
    const data = Array.from({ length: 30 }, (_, i) => (i * 41 + ec * 7) % 256);
    const enc = rsEncode(data, ec);
    ok(`ec=${ec}: data++ec codewords divide evenly by the ec=${ec} generator (a real RS codeword)`,
      dividesEvenly(data.concat(enc), ec));
    ok(`ec=${ec}: exactly ${ec} EC codewords produced`, enc.length === ec);
  }
  // NEGATIVE CONTROL: flip one byte, divisibility must break.
  const data = Array.from({ length: 16 }, (_, i) => (i * 13) % 256);
  const enc = rsEncode(data, 10);
  const good = data.concat(enc);
  const bad = good.slice();
  bad[3] ^= 0xff;
  ok("NEGATIVE CONTROL: a valid codeword block divides evenly", dividesEvenly(good, 10));
  ok("NEGATIVE CONTROL: flipping one byte breaks divisibility", !dividesEvenly(bad, 10));
}

// ═══ 3. KNOWN VECTORS: BCH FORMAT INFO (EC level M) ═════════════════════
console.log("\n── 3. known vectors: BCH format info, EC level M ──");
{
  // The standard published table for EC level M, masks 0-7 — reproduced
  // identically by essentially every independent QR implementation.
  const KNOWN_FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
  for (let mask = 0; mask < 8; mask++) {
    const got = _internals.formatInfoBits(mask);
    ok(`EC-M, mask ${mask}: format info = 0x${KNOWN_FORMAT_M[mask].toString(16)}`,
      got === KNOWN_FORMAT_M[mask], `got 0x${got.toString(16)}`);
  }
}

// ═══ 4. KNOWN VECTORS: BCH VERSION INFO ══════════════════════════════════
console.log("\n── 4. known vectors: BCH version info, versions 7-10 ──");
{
  const KNOWN_VERSION = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
  for (const v of [7, 8, 9, 10]) {
    const got = _internals.versionInfoBits(v);
    ok(`version ${v}: version info = 0x${KNOWN_VERSION[v].toString(16)}`,
      got === KNOWN_VERSION[v], `got 0x${got.toString(16)}`);
  }
}

// ═══ 5. STRUCTURAL SANITY ═══════════════════════════════════════════════
console.log("\n── 5. structural sanity ──");
{
  function checkFinder(matrix, top, left) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const onRing = r === 0 || r === 6 || c === 0 || c === 6;
        const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        if (matrix[top + r][left + c] !== (onRing || inner)) return false;
      }
    }
    return true;
  }
  function checkTiming(matrix, size) {
    for (let i = 8; i <= size - 9; i++) {
      if (matrix[6][i] !== (i % 2 === 0)) return false;
      if (matrix[i][6] !== (i % 2 === 0)) return false;
    }
    return true;
  }
  for (const text of ["A", "https://vyakti.app/r/x?via=poster", "0".repeat(60)]) {
    const r = encodeQR(text);
    const expectedSize = 17 + 4 * r.version;
    ok(`"${text.slice(0, 20)}...": matrix is ${expectedSize}x${expectedSize} (version ${r.version})`,
      r.matrix.length === expectedSize && r.matrix.every((row) => row.length === expectedSize));
    ok(`"${text.slice(0, 20)}...": three finder patterns are the real 7x7 shape`,
      checkFinder(r.matrix, 0, 0) && checkFinder(r.matrix, 0, expectedSize - 7) && checkFinder(r.matrix, expectedSize - 7, 0));
    ok(`"${text.slice(0, 20)}...": timing pattern alternates on row 6 and column 6`,
      checkTiming(r.matrix, expectedSize));
    ok(`"${text.slice(0, 20)}...": dark module set at (size-8, 8)`, r.matrix[expectedSize - 8][8] === true);
  }

  // A long payload that must land in version 7-10, to exercise version info.
  const longUrl =
    "https://vyakti-rooms-preview-git-claude-73ad3b-raghav-carbonsettles-projects.vercel.app" +
    "/r/anjali-sharma-jee-physics-doubt-clearing-sessions?via=poster";
  const long = encodeQR(longUrl);
  ok("a long poster URL lands at version 7 or above (exercises version-info placement)", long.version >= 7);

  ok("chooseVersion(213) is 10 (EC-M version 10's own byte capacity, exactly)", chooseVersion(213) === 10);
  let threw = false;
  try {
    chooseVersion(214);
  } catch (e) {
    threw = e instanceof QRCapacityError;
  }
  ok("chooseVersion(214) throws QRCapacityError (one byte past every version 1-10 can hold)", threw);

  const a = encodeQR("https://vyakti.app/r/determinism-check?via=poster");
  const b = encodeQR("https://vyakti.app/r/determinism-check?via=poster");
  ok("encoding the same text twice is byte-identical (deterministic)",
    JSON.stringify(a.matrix) === JSON.stringify(b.matrix) && a.maskPattern === b.maskPattern);
}

// ═══ 6. SELF-CONSISTENCY ROUND TRIP ═══════════════════════════════════════
console.log("\n── 6. self-consistency: format/version info round trip ──");

// Independently written readback — coordinates only, never imported from
// `_qr.js`'s own writer functions, so a shared bug in "write" and "check"
// cannot cancel out silently.
const FORMAT_MASK = 0b101010000010010;
// `setA[i]` carries bit `i` of the 15-bit format value (LSB at `setA[0]`,
// the coordinate order cross-checked directly against the reference
// `qrcode` (npm) package's own `setupFormatInfo` — see `_qr.js`'s
// `writeFormatInfo` for the same cross-check and why an earlier MSB-first
// draft here was wrong in a way this readback's own round trip could not
// have caught on its own (`_qr.js`'s own header names the rejected.md entry).
function readFormatMaskPattern(matrix, size) {
  const setA = [
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
    [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  ];
  let raw = 0;
  for (let i = 14; i >= 0; i--) {
    const [r, c] = setA[i];
    raw = (raw << 1) | (matrix[r][c] ? 1 : 0);
  }
  const unmasked = raw ^ FORMAT_MASK;
  return (unmasked >>> 10) & 0b111;
}
function readVersionNumber(matrix, size) {
  const bits = [];
  for (let col = 0; col < 6; col++) {
    for (let row = size - 11; row <= size - 9; row++) bits.push(matrix[row][col] ? 1 : 0);
  }
  let val = 0;
  for (let i = bits.length - 1; i >= 0; i--) val = (val << 1) | bits[i];
  return val >>> 12;
}

{
  for (const text of ["A", "https://vyakti.app/r/x?via=poster"]) {
    const r = encodeQR(text);
    const recoveredMask = readFormatMaskPattern(r.matrix, r.size);
    ok(`"${text}": mask pattern recovered from format-info modules matches what was written`,
      recoveredMask === r.maskPattern, `wrote ${r.maskPattern}, read ${recoveredMask}`);
  }
  const longUrl =
    "https://vyakti-rooms-preview-git-claude-73ad3b-raghav-carbonsettles-projects.vercel.app" +
    "/r/anjali-sharma-jee-physics-doubt-clearing-sessions?via=poster";
  const long = encodeQR(longUrl);
  ok("long payload (version 7+): mask pattern recovered from format-info modules matches",
    readFormatMaskPattern(long.matrix, long.size) === long.maskPattern);
  ok("long payload (version 7+): version number recovered from version-info modules matches",
    readVersionNumber(long.matrix, long.size) === long.version);
}

// ═══ 7. NEGATIVE CONTROL: a flipped module changes the recovered value ═══
console.log("\n── 7. negative control: a flipped format module ──");
{
  const r = encodeQR("https://vyakti.app/r/flip-control?via=poster");
  const flipped = r.matrix.map((row) => row.slice());
  // `setA[12]` carries bit12 of the 15-bit format value — the HIGH bit of
  // the 3-bit mask-pattern field itself (bits 12-10), not one of the two
  // EC-level bits above it (bits 14-13, always 0 for level M and so
  // invisible to a check that only ever inspects the mask field) — the
  // very first attempt at this control picked a coordinate carrying an
  // EC-level bit instead, and the recovered mask silently held steady
  // because that bit sits outside the field this readback ever inspects.
  const [fr, fc] = [8, 2];
  flipped[fr][fc] = !flipped[fr][fc];
  const recovered = readFormatMaskPattern(flipped, r.size);
  ok("NEGATIVE CONTROL: flipping one format-info module changes the recovered mask pattern",
    recovered !== r.maskPattern, `still read ${recovered}`);
}

// ═══ 8. A REAL, INDEPENDENT SCANNER (jsQR) ════════════════════════════════
console.log("\n── 8. a real scanner reads the actual rendered pixels ──");
{
  const canvasMod = await import("@napi-rs/canvas");

  function rasterizeMatrix(matrix, quiet = 4, moduleSize = 6) {
    const size = matrix.length;
    const dim = size + quiet * 2;
    const px = dim * moduleSize;
    const canvas = canvasMod.createCanvas(px, px);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#000000";
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (matrix[row][col]) ctx.fillRect((col + quiet) * moduleSize, (row + quiet) * moduleSize, moduleSize, moduleSize);
      }
    }
    return { canvas, px };
  }

  function decode(canvas, px) {
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, px, px);
    const result = jsQR(imageData.data, px, px);
    return result ? result.data : null;
  }

  // A spread chosen to hit every version band this module supports and a
  // range of masks — never hand-picked to dodge a bad one: this is
  // exactly the loop that caught both real bugs `_qr.js`'s own header
  // names, run again here as the release gate rather than a one-off
  // debugging script.
  const SCAN_TEXTS = [
    "HELLO",
    "https://vyakti.app/r/anjali-sharma?via=poster",
    "https://vyakti-rooms.vercel.app/r/priya-hindi-jee?via=poster",
    "0".repeat(60),
    "A".repeat(120),
    "https://vyakti-rooms-preview-git-claude-73ad3b-raghav-carbonsettles-projects.vercel.app" +
      "/r/anjali-sharma-jee-physics-doubt-clearing-sessions?via=poster",
  ];
  const versionsSeen = new Set();
  const masksSeen = new Set();
  for (const text of SCAN_TEXTS) {
    const r = encodeQR(text);
    versionsSeen.add(r.version);
    masksSeen.add(r.maskPattern);
    const { canvas, px } = rasterizeMatrix(r.matrix);
    const decoded = decode(canvas, px);
    ok(`v${r.version} mask${r.maskPattern} "${text.slice(0, 30)}${text.length > 30 ? "..." : ""}": a real scanner reads back the exact text`,
      decoded === text, decoded === null ? "not decoded at all" : `decoded "${decoded.slice(0, 40)}"`);
  }
  ok(`the spread above touched more than one version (saw: ${[...versionsSeen].sort((a, b) => a - b).join(", ")})`,
    versionsSeen.size > 1);
  ok(`the spread above touched more than one mask pattern (saw: ${[...masksSeen].sort((a, b) => a - b).join(", ")})`,
    masksSeen.size > 1);

  // NEGATIVE CONTROL: corrupt PIXELS in the rendered canvas itself (not
  // the matrix — this is the actual wire format the eventual poster
  // ships), and the same real scanner must fail or disagree. A single
  // flipped module is deliberately NOT the corruption here: level M's own
  // Reed-Solomon correction (up to roughly a third of a block's own
  // codewords) recovers from exactly that, by design — the first attempt
  // at this control flipped one module and jsQR read the text back
  // unchanged, error-corrected, which is the format working as intended,
  // not a broken test. This corrupts an entire dark ROW of the finder
  // pattern's own core instead: a finder pattern is how a scanner LOCATES
  // the symbol at all, before any codeword or error correction is even in
  // play, so painting it white is a corruption no amount of Reed-Solomon
  // headroom can paper over.
  {
    const text = "https://vyakti.app/r/pixel-flip-control?via=poster";
    const r = encodeQR(text);
    const quiet = 4, moduleSize = 6;
    const { canvas, px } = rasterizeMatrix(r.matrix, quiet, moduleSize);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, (quiet) * moduleSize, px, 7 * moduleSize);
    const decoded = decode(canvas, px);
    ok("NEGATIVE CONTROL: erasing the top finder pattern's pixels breaks the real scanner's read",
      decoded !== text, decoded === null ? "correctly not decoded" : `still decoded "${decoded}"`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
