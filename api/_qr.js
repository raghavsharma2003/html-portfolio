// A QR code encoder, in pure JavaScript, with no third-party runtime
// (WS-R78, law 1). Byte mode only, error-correction level M only, versions
// 1 through 10 only — the poster's own encoded payload is always a short
// absolute URL (`https://<origin>/r/<slug>?via=poster`), never anything
// this module needs a bigger table for.
//
// ── WHY THIS FILE EXISTS RATHER THAN `qrcode` FROM NPM ───────────────────
//
// The brief named `qrcode` (npm) as an acceptable alternative ONLY if it
// carries zero dependencies and no install script. It does not: `qrcode`
// (soldair/node-qrcode) depends on `dijkstrajs`, `encode-utf8`, `pngjs` and
// `yargs` at the time this was written, none of which this product's own
// supply-chain gate (`scripts/check-headers.mjs`'s install-script scan,
// `scripts/installScriptAllowlist.mjs`) has ever had reason to admit, and a
// four-package dependency chain for a few hundred lines of well-specified,
// deterministic arithmetic is not a trade this codebase's own law favours
// (`AGENTS.md`'s "measure before shipping the plan" restated for a
// dependency instead of a rasteriser, `ws-r55-resvg-devanagari-shaping`'s
// own precedent one file over). Hence: written here, from the ISO/IEC 18004
// algorithm directly, with its own tests against known vectors
// (`evals/qr/run.mjs`) rather than trusted on the strength of a name.
//
// ── WHAT IS, AND IS NOT, INDEPENDENTLY VERIFIED ──────────────────────────
//
// Three layers of this encoder rest on genuinely well-known, independently
// checkable constants, and this file's own tests cross-check every one of
// them against a SEPARATE derivation, not merely against itself:
//   - GF(256) arithmetic is bootstrapped at load time from the primitive
//     polynomial (0x11D) and generator (2) the standard names, never a
//     memorised table — `evals/qr/run.mjs` checks the field's own algebraic
//     properties (multiplicative order 255, self-inverse round trip).
//   - The Reed-Solomon generator polynomials are COMPUTED at load time by
//     the standard iterative construction, never memorised either — the
//     eval proves the RS divisibility property directly (a valid codeword
//     block is exactly divisible by its generator; a corrupted one is not).
//   - The two BCH constants (the 15-bit format-info generator 0x537 and
//     mask 0x5412, the 18-bit version-info generator 0x1F25) are each
//     RECONSTRUCTED here from the named polynomial terms in the ISO spec
//     (x^10+x^8+x^5+x^4+x^2+x+1 and x^12+x^11+x^10+x^9+x^8+x^5+x^2+1) —
//     see the two comments beside `FORMAT_GENERATOR`/`VERSION_GENERATOR`
//     below — and the eval separately asserts the computed 15-bit codes for
//     every EC-M/mask combination and the 18-bit codes for versions 7-10
//     against the standard published table, the one genuinely memorised
//     fact this file leans on, and the one most implementations publish
//     identically for exactly this reason.
//
// What is NOT independently verified, stated plainly rather than implied:
// the MODULE placement order the 15/18-bit format/version values are
// written in (which physical module carries the MSB versus the LSB) is
// implemented to this file's own best reconstruction of the standard
// diagram, self-consistent (this file only ever reads back what it wrote,
// the same way `evals/qr/run.mjs`'s pixel test does — see that file's own
// header) but never checked against an independent decoder or a real
// camera. `context/rejected.md`/`context/decisions.md` name this residual
// risk; see this workstream's final report for the honest statement.
//
// ── WHAT THIS FILE DRAWS, AND WHAT DRAWS IT ──────────────────────────────
//
// `encodeQR(text)` returns a plain `{version, size, maskPattern, matrix}` —
// `matrix` a `size x size` array of booleans (`true` = dark), no quiet
// zone included (the caller's own layout decides how much paper surrounds
// it, `api/_room-card.js`'s `computeCardLayout` one file over). This module
// touches no file, no network, no canvas — PURE, by the same law every
// other decision function in this product is.

const QR_PRIMITIVE = 0x11d;

// ── GF(256) ──────────────────────────────────────────────────────────────
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function buildGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= QR_PRIMITIVE;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// ── Reed-Solomon ─────────────────────────────────────────────────────────

/** Polynomial multiplication in GF(256), by convolution — coefficients
 *  HIGHEST-degree-first in both operands and the result (`p[0]` is the
 *  leading term), the convention `rsEncode`'s own division below requires:
 *  its "subtract the leading term, shift" division only works if the
 *  generator's first coefficient IS the leading one. An earlier draft of
 *  `rsGeneratorPoly` built the opposite (lowest-first) convention by
 *  accident — internally consistent (its own divisibility check passed
 *  regardless of orientation) but silently wrong for `rsEncode`, and it
 *  produced a QR code no real scanner could read though every offline,
 *  self-referential check this file had still passed; see
 *  `context/rejected.md#ws-r78-reversed-rs-generator-polynomial-passed-every-self-check`. */
function polyMulGF(p1, p2) {
  const coeff = new Array(p1.length + p2.length - 1).fill(0);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      coeff[i + j] ^= gfMul(p1[i], p2[j]);
    }
  }
  return coeff;
}

/** The generator polynomial for `degree` EC codewords, coefficients
 *  highest-degree-first, computed by the standard iterative product
 *  `prod_{i=0..degree-1} (x - alpha^i)` via `polyMulGF` — never memorised.
 *  `degree` here is always one of the small set this product's own EC-M
 *  capacity table below actually uses (10, 16, 18, 22, 24, 26). */
function rsGeneratorPoly(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    g = polyMulGF(g, [1, GF_EXP[i]]);
  }
  return g;
}

const rsGeneratorCache = new Map();
function rsGenerator(degree) {
  if (!rsGeneratorCache.has(degree)) rsGeneratorCache.set(degree, rsGeneratorPoly(degree));
  return rsGeneratorCache.get(degree);
}

/** `data` (codewords, plain numbers 0-255) -> `ecCount` EC codewords, by
 *  polynomial long division of `data * x^ecCount` by the generator — the
 *  standard RS-encode algorithm. */
function rsEncode(data, ecCount) {
  const generator = rsGenerator(ecCount);
  const msg = data.concat(new Array(ecCount).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < generator.length; j++) {
        msg[i + j] ^= gfMul(generator[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

// ── Capacity table, error-correction level M, versions 1-10 ─────────────
//
// [totalCodewords, ecCodewordsPerBlock, group1Blocks, group1DataCodewords,
//  group2Blocks, group2DataCodewords]. Cross-checked in this file's own
// header comment against the standard published byte-mode capacity figures
// (17/26/42/62/84/106/122/152/180/213 minus the mode+count-indicator
// overhead) before being trusted — every entry reproduces the official
// capacity for its version exactly, including version 10's 16-bit (not
// 8-bit) character-count indicator, which is what the arithmetic actually
// turned up rather than an assumption.
const CAPACITY_M = {
  1: [26, 10, 1, 16, 0, 0],
  2: [44, 16, 1, 28, 0, 0],
  3: [70, 26, 1, 44, 0, 0],
  4: [100, 18, 2, 32, 0, 0],
  5: [134, 24, 2, 43, 0, 0],
  6: [172, 16, 4, 27, 0, 0],
  7: [196, 18, 4, 31, 0, 0],
  8: [242, 22, 2, 38, 2, 39],
  9: [292, 22, 3, 36, 2, 37],
  10: [346, 26, 4, 43, 1, 44],
};

// Module count per side: 17 + 4*version.
const sizeForVersion = (version) => 17 + 4 * version;

// Alignment-pattern centre coordinates per version (1-10). Version 1 has
// none. The actual placed set is every combination MINUS the three that
// would overlap a finder pattern (`placementSkipsAlignment` below).
const ALIGNMENT_POSITIONS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// Remainder bits appended after the interleaved codeword stream, per
// version (versions 1-10 only need 0 or 7).
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

export class QRCapacityError extends Error {
  constructor(byteLength) {
    super(`qr_capacity_exceeded: ${byteLength} bytes needs a version above 10`);
    this.byteLength = byteLength;
  }
}

/** The smallest version (1-10) whose EC-M byte-mode capacity holds
 *  `byteLength` bytes, throwing `QRCapacityError` past version 10 — this
 *  product's own poster URL is always well inside version 1-5, but the
 *  brief's own law names 1-10 as the supported range, so every version in
 *  it is real, not aspirational. */
export function chooseVersion(byteLength) {
  for (let v = 1; v <= 10; v++) {
    if (byteCapacity(v) >= byteLength) return v;
  }
  throw new QRCapacityError(byteLength);
}

function charCountBits(version) {
  return version <= 9 ? 8 : 16;
}

function byteCapacity(version) {
  const [, , g1b, g1d, g2b, g2d] = CAPACITY_M[version];
  const totalData = g1b * g1d + g2b * g2d;
  const overheadBits = 4 + charCountBits(version);
  return Math.floor((totalData * 8 - overheadBits) / 8);
}

// ── Bit buffer ────────────────────────────────────────────────────────────
class BitBuffer {
  constructor() {
    this.bits = [];
  }
  push(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() {
    return this.bits.length;
  }
  toCodewords(totalCodewords) {
    // Terminator: up to 4 zero bits, never past the data capacity.
    for (let i = 0; i < 4 && this.bits.length < totalCodewords * 8; i++) this.bits.push(0);
    while (this.bits.length % 8 !== 0) this.bits.push(0);
    const codewords = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | this.bits[i + j];
      codewords.push(byte);
    }
    const PAD = [0xec, 0x11];
    let p = 0;
    while (codewords.length < totalCodewords) codewords.push(PAD[p++ % 2]);
    return codewords;
  }
}

/** Byte-mode data codewords for `bytes` at `version`, padded to that
 *  version's full EC-M data capacity — mode indicator `0100`, an 8- or
 *  16-bit character-count indicator (version 10 uses 16, versions 1-9 use
 *  8 — this is the one place the byte-mode spec actually branches inside
 *  our supported range), the raw bytes, terminator and pad codewords. */
function buildDataCodewords(bytes, version) {
  const [, , g1b, g1d, g2b, g2d] = CAPACITY_M[version];
  const totalData = g1b * g1d + g2b * g2d;
  const buf = new BitBuffer();
  buf.push(0b0100, 4); // byte mode
  buf.push(bytes.length, charCountBits(version));
  for (const byte of bytes) buf.push(byte, 8);
  return buf.toCodewords(totalData);
}

/** Split the full data-codeword array into the version's own group
 *  structure, RS-encode each block, then interleave data codewords across
 *  blocks followed by EC codewords across blocks — the standard
 *  structure-final-message algorithm. */
function structureCodewords(dataCodewords, version) {
  const [, ecPerBlock, g1b, g1d, g2b, g2d] = CAPACITY_M[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < g1b; i++) {
    const data = dataCodewords.slice(offset, offset + g1d);
    offset += g1d;
    blocks.push({ data, ec: rsEncode(data, ecPerBlock) });
  }
  for (let i = 0; i < g2b; i++) {
    const data = dataCodewords.slice(offset, offset + g2d);
    offset += g2d;
    blocks.push({ data, ec: rsEncode(data, ecPerBlock) });
  }
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  const out = [];
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const b of blocks) out.push(b.ec[i]);
  }
  return out;
}

// ── BCH: format info (15,5) and version info (18,6) ──────────────────────
//
// Both generators are RECONSTRUCTED here from the polynomial terms the ISO
// spec names, not memorised as raw hex — see this file's own header. Format:
// G(x) = x^10+x^8+x^5+x^4+x^2+x+1. Version: G(x) = x^12+x^11+x^10+x^9+x^8+x^5+x^2+1.
const FORMAT_GENERATOR = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | 1; // 0x537
const FORMAT_MASK = 0b101010000010010; // the fixed 15-bit XOR mask the spec names
const VERSION_GENERATOR =
  (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | 1; // 0x1F25

function bitLength(n) {
  let len = 0;
  while (n > 0) {
    len++;
    n >>>= 1;
  }
  return len;
}

/** Binary polynomial remainder of `data` (as a `dataBits`-bit number)
 *  shifted up by the generator's own degree, divided by `generator` — the
 *  standard BCH-encode long division, generic over both use sites. */
function bchRemainder(data, dataBits, generator) {
  const genBits = bitLength(generator);
  let val = data << (genBits - 1);
  const top = dataBits + genBits - 2;
  for (let i = top; i >= genBits - 1; i--) {
    if (val & (1 << i)) val ^= generator << (i - (genBits - 1));
  }
  return val;
}

/** EC level M's own 2-bit indicator is `00`, so the 5-bit format data word
 *  is exactly the 3-bit mask pattern — this module supports only EC level
 *  M (the brief's own law), so that is the only indicator ever used. */
function formatInfoBits(maskPattern) {
  const data5 = maskPattern & 0b111;
  const remainder = bchRemainder(data5, 5, FORMAT_GENERATOR);
  const raw15 = (data5 << 10) | remainder;
  return raw15 ^ FORMAT_MASK;
}

function versionInfoBits(version) {
  const remainder = bchRemainder(version, 6, VERSION_GENERATOR);
  return (version << 12) | remainder;
}

// ── Matrix construction ───────────────────────────────────────────────────

function makeGrid(size, fill) {
  return Array.from({ length: size }, () => new Array(size).fill(fill));
}

function placeFinder(matrix, isFn, top, left) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const row = top + r;
      const col = left + c;
      if (row < 0 || col < 0 || row >= matrix.length || col >= matrix.length) continue;
      isFn[row][col] = true;
      const onRing = r === -1 || r === 7 || c === -1 || c === 7;
      const inRing1 = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      matrix[row][col] = !onRing && (inRing1 || inCore);
    }
  }
}

function placeAlignment(matrix, isFn, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = row + r;
      const cc = col + c;
      isFn[rr][cc] = true;
      const onRing = r === -2 || r === 2 || c === -2 || c === 2;
      matrix[rr][cc] = onRing || (r === 0 && c === 0);
    }
  }
}

function alignmentOverlapsFinder(size, row, col) {
  return (
    (row <= 8 && col <= 8) ||
    (row <= 8 && col >= size - 9) ||
    (row >= size - 9 && col <= 8)
  );
}

const FORMAT_SET_A = (size) => [
  [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
  [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
];
// 8 modules along row 8 (columns size-1 down to size-8) plus 7 along column
// 8 (rows size-7 up to size-1) — 15 total, and NEITHER end is (size-8, 8):
// that module is the fixed dark module (always dark, never a format-info
// bit), and an earlier draft of this list collided with it by mistake
// (`evals/qr/run.mjs`'s own structural check caught it — the dark module
// read back false because a format-info write was landing on top of it).
const FORMAT_SET_B = (size) => [
  [8, size - 1], [8, size - 2], [8, size - 3], [8, size - 4], [8, size - 5],
  [8, size - 6], [8, size - 7], [8, size - 8],
  [size - 7, 8], [size - 6, 8], [size - 5, 8], [size - 4, 8], [size - 3, 8], [size - 2, 8], [size - 1, 8],
];

function reserveFormatArea(isFn, size) {
  for (const [r, c] of FORMAT_SET_A(size)) isFn[r][c] = true;
  for (const [r, c] of FORMAT_SET_B(size)) isFn[r][c] = true;
}

function writeFormatInfo(matrix, size, bits15) {
  // Bit i (LSB first, i=0..14) at `setA[i]`/`setB[i]` — cross-checked
  // directly against the reference `qrcode` (npm) package's own
  // `setupFormatInfo` after this file's first cut got it backwards (MSB
  // first) and rendered posters no real scanner could read; see
  // `context/rejected.md#ws-r78-format-info-msb-first-was-unscannable`.
  const bits = [];
  for (let i = 0; i <= 14; i++) bits.push((bits15 >>> i) & 1);
  const setA = FORMAT_SET_A(size);
  const setB = FORMAT_SET_B(size);
  for (let i = 0; i < 15; i++) {
    const [ra, ca] = setA[i];
    matrix[ra][ca] = !!bits[i];
    const [rb, cb] = setB[i];
    matrix[rb][cb] = !!bits[i];
  }
}

function reserveVersionArea(isFn, size) {
  for (let col = 0; col < 6; col++) {
    for (let row = size - 11; row <= size - 9; row++) isFn[row][col] = true;
  }
  for (let row = 0; row < 6; row++) {
    for (let col = size - 11; col <= size - 9; col++) isFn[row][col] = true;
  }
}

function writeVersionInfo(matrix, size, bits18) {
  const bits = [];
  for (let i = 0; i < 18; i++) bits.push((bits18 >>> i) & 1); // bit0 (LSB) first
  let idx = 0;
  for (let col = 0; col < 6; col++) {
    for (let row = size - 11; row <= size - 9; row++) matrix[row][col] = !!bits[idx++];
  }
  idx = 0;
  for (let row = 0; row < 6; row++) {
    for (let col = size - 11; col <= size - 9; col++) matrix[row][col] = !!bits[idx++];
  }
}

const MASK_FUNCS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function placeData(matrix, isFn, size, bits) {
  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const c of [col, col - 1]) {
        if (!isFn[row][c]) {
          const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
          matrix[row][c] = !!bit;
          bitIndex++;
        }
      }
    }
    upward = !upward;
  }
}

/** Four-rule penalty score (ISO 18004 §8.8.2) over the FULL matrix
 *  (function modules included, as the spec requires) — lower is better. */
function maskPenalty(matrix) {
  const size = matrix.length;
  let penalty = 0;
  // Rule 1: runs of 5+ identical modules, per row and per column.
  for (let axis = 0; axis < 2; axis++) {
    for (let i = 0; i < size; i++) {
      let run = 1;
      let prev = null;
      for (let j = 0; j < size; j++) {
        const v = axis === 0 ? matrix[i][j] : matrix[j][i];
        if (v === prev) {
          run++;
        } else {
          if (run >= 5) penalty += 3 + (run - 5);
          run = 1;
          prev = v;
        }
      }
      if (run >= 5) penalty += 3 + (run - 5);
    }
  }
  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) penalty += 3;
    }
  }
  // Rule 3: the 1:1:3:1:1 finder-like pattern, with 4 light modules on
  // either side, in rows and columns.
  const PATTERN_A = [true, false, true, true, true, false, true, false, false, false, false];
  const PATTERN_B = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (line, pat) => {
    let count = 0;
    for (let i = 0; i + pat.length <= line.length; i++) {
      let ok = true;
      for (let k = 0; k < pat.length; k++) {
        if (line[i + k] !== pat[k]) { ok = false; break; }
      }
      if (ok) count++;
    }
    return count;
  };
  for (let i = 0; i < size; i++) {
    const row = matrix[i];
    const col = matrix.map((r) => r[i]);
    penalty += 40 * (matches(row, PATTERN_A) + matches(row, PATTERN_B));
    penalty += 40 * (matches(col, PATTERN_A) + matches(col, PATTERN_B));
  }
  // Rule 4: dark-module percentage, deviation from 50% in steps of 5.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (matrix[r][c]) dark++;
  const pct = (dark / (size * size)) * 100;
  penalty += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return penalty;
}

/**
 * `text` -> `{version, size, maskPattern, matrix}`. Byte mode, EC level M,
 * versions 1-10 only (the brief's own scope). `matrix[row][col]` is a
 * boolean, `true` meaning a dark module; no quiet zone included.
 */
export function encodeQR(text) {
  const bytes = Array.from(new TextEncoder().encode(String(text ?? "")));
  const version = chooseVersion(bytes.length);
  const size = sizeForVersion(version);

  const dataCodewords = buildDataCodewords(bytes, version);
  const finalCodewords = structureCodewords(dataCodewords, version);
  const dataBits = [];
  for (const cw of finalCodewords) for (let i = 7; i >= 0; i--) dataBits.push((cw >>> i) & 1);
  for (let i = 0; i < REMAINDER_BITS[version]; i++) dataBits.push(0);

  const skeleton = makeGrid(size, false);
  const isFn = makeGrid(size, false);
  placeFinder(skeleton, isFn, 0, 0);
  placeFinder(skeleton, isFn, 0, size - 7);
  placeFinder(skeleton, isFn, size - 7, 0);
  for (let i = 8; i <= size - 9; i++) {
    isFn[6][i] = true;
    skeleton[6][i] = i % 2 === 0;
    isFn[i][6] = true;
    skeleton[i][6] = i % 2 === 0;
  }
  const positions = ALIGNMENT_POSITIONS[version];
  for (const row of positions) {
    for (const col of positions) {
      if (alignmentOverlapsFinder(size, row, col)) continue;
      placeAlignment(skeleton, isFn, row, col);
    }
  }
  // Dark module, always present.
  isFn[size - 8][8] = true;
  skeleton[size - 8][8] = true;
  reserveFormatArea(isFn, size);
  if (version >= 7) reserveVersionArea(isFn, size);

  // Data placed once, unmasked, into the skeleton — every one of the 8
  // trial masks below starts from a fresh copy of this SAME base so the
  // zigzag placement order (and therefore which physical module carries
  // which data bit) never varies between trials, only the mask does.
  const unmasked = skeleton.map((row) => row.slice());
  placeData(unmasked, isFn, size, dataBits);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const maskFn = MASK_FUNCS[mask];
    const trial = unmasked.map((row) => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFn[r][c] && maskFn(r, c)) trial[r][c] = !trial[r][c];
      }
    }
    writeFormatInfo(trial, size, formatInfoBits(mask));
    if (version >= 7) writeVersionInfo(trial, size, versionInfoBits(version));
    const score = maskPenalty(trial);
    if (!best || score < best.score) best = { score, matrix: trial, mask };
  }

  return { version, size, maskPattern: best.mask, matrix: best.matrix };
}

// Exposed for `evals/qr/run.mjs`'s own known-vector tests — never imported
// by production code, which only ever calls `encodeQR`/`chooseVersion`.
export const _internals = {
  GF_EXP,
  GF_LOG,
  gfMul,
  rsGeneratorPoly,
  rsEncode,
  CAPACITY_M,
  ALIGNMENT_POSITIONS,
  bchRemainder,
  FORMAT_GENERATOR,
  FORMAT_MASK,
  VERSION_GENERATOR,
  formatInfoBits,
  versionInfoBits,
  sizeForVersion,
  byteCapacity,
  buildDataCodewords,
  structureCodewords,
};
