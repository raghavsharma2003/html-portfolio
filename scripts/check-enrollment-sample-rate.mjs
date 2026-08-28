// The rate every enrollment-grade WAV is EMITTED at and the rate
// `probeEnrollmentWav` DEMANDS are two independent numbers, mirrored across a
// Node/Python boundary with no shared import. They already drifted once:
// `services/voice-evidence/app.py`'s `_enhance` shipped every candidate at
// DeepFilterNet3's native 48 kHz, while `api/_audio/wav.js`'s
// `probeEnrollmentWav` — the hard gate every enrollment reference passes
// through before synthesis, called from the Chatterbox preview provider, the
// Personal Voice provider and Mirror Call's own conditioning probe — has
// always required exactly 24 kHz mono PCM16 and rejected anything else with
// `wav_format_unsupported`. The owner waited ten minutes for a GPU to hear
// that sentence.
//
// Same house pattern `scripts/verify-voice.mjs` already uses for her voice
// name: MIRROR the value everywhere it has to hold, then assert the mirrors
// agree on every `verify-release.mjs` run, by SOURCE-TEXT extraction rather
// than an import, because the four sites here span two languages and three
// independent deploy boundaries (a Vercel serverless function, a browser-
// reachable contract module, and two standalone GPU services) and none of
// them can import from any other.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const at = (p) => join(ROOT, p);

/** Sites that name the enrollment sample rate. Each entry is
 *  (file, regex capturing the integer literal, what it governs) — pure
 *  string in, so this is testable with a negative control that needs no
 *  fixture files. Exported for exactly that. */
export const SITES = [
  {
    file: "api/_audio/wav.js",
    re: /const EXPECTED_SAMPLE_RATE = ([0-9_]+);/,
    governs: "probeEnrollmentWav — the hard gate every enrollment reference passes through before synthesis",
  },
  {
    file: "api/_voice/contracts.js",
    re: /sampleRate:\s*([0-9_]+),/,
    governs: "VOICE_PCM_FORMAT — the provider-neutral PCM contract every voice adapter normalizes to",
  },
  {
    file: "services/open-voice-runtime/app.py",
    re: /TARGET_SAMPLE_RATE = ([0-9_]+)/,
    governs: "the Chatterbox GPU runtime — refuses to start at any other rate",
  },
  {
    file: "services/voice-evidence/app.py",
    re: /ENROLLMENT_SAMPLE_RATE = ([0-9_]+)/,
    governs: "the enhance stage — the service that actually PRODUCES the enrollment reference WAV",
  },
];

/** Pure: given {file: sourceText}, extract each site's rate. Throws with a
 *  named file when a site's literal cannot be found, same as verify-voice.mjs
 *  refusing to switch a lane it cannot locate — a check that silently skips a
 *  site it cannot parse is worse than no check. */
export function extractRates(sources) {
  return SITES.map((site) => {
    const src = sources[site.file];
    if (src == null) throw new Error(`missing source for ${site.file}`);
    const m = src.match(site.re);
    if (!m) throw new Error(`${site.file}: no ${"ENROLLMENT_SAMPLE_RATE/EXPECTED_SAMPLE_RATE/TARGET_SAMPLE_RATE/sampleRate"} literal matched — cannot verify this site agrees`);
    return { file: site.file, governs: site.governs, rate: Number(m[1].replace(/_/g, "")) };
  });
}

/** Pure: returns {ok, mismatches} — never throws, so a negative control can
 *  assert on the return value instead of catching. */
export function checkRatesAgree(entries) {
  const target = entries[0]?.rate;
  const mismatches = entries.filter((e) => e.rate !== target);
  return { ok: mismatches.length === 0, target, mismatches, entries };
}

/** Negative control: a check that has never been proven to fail is not a
 *  check, it is a formality. This drives `extractRates`/`checkRatesAgree`
 *  against SYNTHETIC source text with one site deliberately drifted (the
 *  exact shape of the incident this file exists to catch: the evidence
 *  service emitting a different rate than `probeEnrollmentWav` demands) and
 *  asserts the result is a failure naming the drifted file. Run on every
 *  invocation, before the real files are even read, so a change to this
 *  script that broke its own detection would fail loudly rather than start
 *  passing everything. */
function runNegativeControl() {
  const synthetic = {
    "api/_audio/wav.js": "const EXPECTED_SAMPLE_RATE = 24_000;",
    "api/_voice/contracts.js": "  sampleRate: 24_000,",
    "services/open-voice-runtime/app.py": "TARGET_SAMPLE_RATE = 24_000",
    // Deliberately wrong -- reproduces the real bug this gate exists to catch.
    "services/voice-evidence/app.py": "ENROLLMENT_SAMPLE_RATE = 48_000",
  };
  const entries = extractRates(synthetic);
  const { ok, mismatches } = checkRatesAgree(entries);
  if (ok) {
    throw new Error("negative control did not fail: a drifted rate slipped through checkRatesAgree undetected");
  }
  if (mismatches.length !== 1 || mismatches[0].file !== "services/voice-evidence/app.py") {
    throw new Error(`negative control failed for the wrong reason: ${JSON.stringify(mismatches)}`);
  }
  // And the positive twin: identical rates across all four must NOT trip it,
  // so the control proves the check discriminates rather than always failing.
  const clean = { ...synthetic, "services/voice-evidence/app.py": "ENROLLMENT_SAMPLE_RATE = 24_000" };
  const cleanResult = checkRatesAgree(extractRates(clean));
  if (!cleanResult.ok) {
    throw new Error("positive control failed: four matching rates were reported as a mismatch");
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === at(process.argv[1].replace(ROOT, "")) || process.argv[1]?.endsWith("check-enrollment-sample-rate.mjs");
if (isMain) {
  try {
    runNegativeControl();
  } catch (err) {
    console.log(`  FAIL  negative control: ${err.message}`);
    process.exit(1);
  }
  console.log("  ok    negative control: a synthetic 48 kHz drift on the evidence service is caught; matching rates are not");
  const sources = Object.fromEntries(SITES.map((s) => [s.file, readFileSync(at(s.file), "utf8")]));
  let entries;
  try {
    entries = extractRates(sources);
  } catch (err) {
    console.log(`  FAIL  ${err.message}`);
    process.exit(1);
  }
  const { ok, target, mismatches } = checkRatesAgree(entries);
  for (const e of entries) {
    console.log(`  ${e.rate === target ? "match" : "FAIL "} ${e.file}: ${e.rate} Hz — ${e.governs}`);
  }
  if (!ok) {
    console.log(`\n  FAIL  enrollment sample rate has drifted: ${mismatches.map((m) => `${m.file}=${m.rate}`).join(", ")} disagree with the rest at ${target} Hz.`);
    console.log("        This is exactly the shape of the \"wav format unsupported\" incident: the service that");
    console.log("        PRODUCES the enrollment reference and the gate that VALIDATES it drifted apart silently.");
    process.exit(1);
  }
  console.log(`\n  all ${entries.length} enrollment-sample-rate sites agree at ${target} Hz`);
  process.exit(0);
}
