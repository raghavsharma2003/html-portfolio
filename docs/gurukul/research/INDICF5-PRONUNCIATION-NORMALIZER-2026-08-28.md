# IndicF5 chemistry pronunciation normalizer

Status: integrated into the isolated IndicF5 evaluation runtime and still
offline. It is not deployed and no production route uses it.

## Why this exists

The private IndicF5 objective report measured six disagreements across eight
chemical-symbol units and four across eleven numeral units. The mixed-script
breakdown accounts for four of the symbol disagreements and three of the
numeral disagreements. No audio was played for this diagnosis, and provider
ASR is not a human intelligibility verdict.

The bounded hypothesis is that IndicF5 handles the same classroom notation
more reliably when formula letters and subscript numerals are presented as
reviewed Devanagari pronunciation tokens. This does not justify transliterating
arbitrary English, rewriting prose, or using an LLM before synthesis.

## Contract

`services/indicf5-runtime/pronunciation_normalizer.py` accepts only the
`chemistry` domain and `hi-IN` locale. It requires a Devanagari context and
returns:

- the exact source text and SHA-256;
- separate synthesis text and SHA-256;
- ordered source-codepoint spans, source and synthesis text, per-span hashes,
  rule ids, and covered-unit counts;
- a canonical audit SHA-256 over the complete result.

The rules cover repeated spoken formula fragments, unambiguous formulae,
coefficients, reaction plus/arrow operators, explicit charge and oxidation
notation, ISO dates, decimals, and standalone integers. They are fixed tables
and parsers. There is no model or network dependency.

Hard stops are 1,000 source codepoints, 3,000 synthesis codepoints, 64
transformations, and a 4x expansion ratio. Unsupported domain or locale,
control characters, excessive input, transformation count, or expansion fail
with a named refusal.

## Ambiguity policy

The normalizer leaves pure English unchanged. It does not treat English-like
element spellings such as `He`, `In`, `As`, `At`, `I`, `No`, or `Am` as formula
symbols. One spoken fragment is insufficient equation evidence, so phrases
like `vitamin B two` remain unchanged. Uppercase acronym shapes such as `IP`,
`AI`, and `IIT` are not parsed as multi-element formulae.

Only ISO `YYYY-MM-DD` dates are expanded. Ambiguous slash dates, semantic
versions, IP addresses, and malformed dates remain unchanged. Plain `Fe3+` is
retained because the `3` can be a subscript or charge magnitude; `Fe^3+` and
`Fe³⁺` are deterministic and supported. Operators are changed only with parsed
formula evidence on both sides.

## Pre-registered expectation

The executable frozen-corpus fixture transforms four symbol units and three
subscript-number units in the mixed equation text. Its already-Devanagari
sister fixture is byte-identical. If, and only if, all covered baseline ASR
disagreements resolve with no regression, the exact conditional result is:

- chemical-symbol disagreements: 6/8 to 2/8, a 50 percentage-point reduction;
- numeral disagreements: 4/11 to 1/11, a 27.2727 percentage-point reduction.

Those are coverage-derived expectations, not observed results. A new sealed
resynthesis plus the same objective method is required before reporting any
gain. Human listening remains required for pronunciation, naturalness,
Indian accent, and owner likeness.

The machine-readable pre-registration is
`evals/indicf5-pronunciation/expected-impact.v1.json`. It includes no blind id,
clip id, transcript, candidate identity mapping, credential, or audio.

## Verification

Run:

```text
node evals/indicf5-pronunciation/run.mjs
```

The suite reconstructs synthesis text from the ordered audit spans, verifies
every hash, exercises the frozen expected coverage, checks idempotence, and
includes the ambiguity and hard-cap negative controls above.

## Reversal conditions

Expand a rule only when a reviewed domain fixture and a negative confusable
control are added together. Remove or narrow a rule if sealed resynthesis shows
no improvement, creates a new unit disagreement, or human listening finds the
spoken notation less natural. Deployment and any quality claim remain blocked
until the sealed before/after arm passes provenance, watermark, objective, and
human listening checks.
