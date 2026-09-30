from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services" / "indicf5-runtime"))

from pronunciation_normalizer import (  # noqa: E402
    CONTRACT,
    MAX_SOURCE_CODEPOINTS,
    NormalizationError,
    normalize_pronunciation,
)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def verify_audit(source: str, result: dict[str, object]) -> None:
    assert result["contract"] == CONTRACT
    assert result["source_text"] == source
    assert result["source_sha256"] == sha256(source)
    assert result["synthesis_sha256"] == sha256(result["synthesis_text"])
    core = dict(result)
    audit_hash = core.pop("audit_sha256")
    assert audit_hash == sha256(canonical(core))

    rebuilt: list[str] = []
    cursor = 0
    transformations = result["transformations"]
    assert result["transformation_count"] == len(transformations)
    for expected_sequence, transformation in enumerate(transformations, start=1):
        start = transformation["source_start_codepoint"]
        end = transformation["source_end_codepoint"]
        original = source[start:end]
        assert transformation["sequence"] == expected_sequence
        assert transformation["source_text"] == original
        assert transformation["source_sha256"] == sha256(original)
        assert transformation["synthesis_sha256"] == sha256(transformation["synthesis_text"])
        rebuilt.extend((source[cursor:start], transformation["synthesis_text"]))
        cursor = end
    rebuilt.append(source[cursor:])
    assert "".join(rebuilt) == result["synthesis_text"]


def expect_error(code: str, action) -> None:
    try:
        action()
        raise AssertionError(f"accepted {code}")
    except NormalizationError as error:
        assert error.code == code


frozen_mixed = (
    "यह एआई से बनाई गई आवाज़ की प्रतिकृति है। "
    "दो H two और O two मिलकर दो H two O बनाते हैं। "
    "अब reactant और product side के atoms check करो।"
)
frozen_mixed_expected = (
    "यह एआई से बनाई गई आवाज़ की प्रतिकृति है। "
    "दो एच टू और ओ टू मिलकर दो एच टू ओ बनाते हैं। "
    "अब reactant और product side के atoms check करो।"
)
mixed = normalize_pronunciation(frozen_mixed)
verify_audit(frozen_mixed, mixed)
assert mixed["synthesis_text"] == frozen_mixed_expected
assert mixed["coverage"] == {
    "chemical_symbol_units": 4,
    "numeral_units": 3,
    "operator_units": 0,
}
assert mixed["transformation_count"] == 4

# This is the sister prompt from the same frozen public corpus.  It already
# carries Devanagari pronunciations and therefore must remain byte-identical.
frozen_devanagari = (
    "यह एआई से बनाई गई आवाज़ की प्रतिकृति है। "
    "दो एच टू और ओ टू मिलकर दो एच टू ओ बनाते हैं। "
    "अब दोनों तरफ परमाणुओं की संख्या जाँचो।"
)
devanagari = normalize_pronunciation(frozen_devanagari)
verify_audit(frozen_devanagari, devanagari)
assert devanagari["synthesis_text"] == frozen_devanagari
assert devanagari["transformation_count"] == 0

equation_source = "समीकरण 2H2 + O2 -> 2H2O है।"
equation = normalize_pronunciation(equation_source)
verify_audit(equation_source, equation)
assert equation["synthesis_text"] == "समीकरण दो एच टू प्लस ओ टू से बनता है दो एच टू ओ है।"
assert equation["coverage"] == {
    "chemical_symbol_units": 4,
    "numeral_units": 5,
    "operator_units": 2,
}

notation_source = "यह Fe(III), SO4^2-, Cl- और Fe3+ हैं।"
notation = normalize_pronunciation(notation_source)
verify_audit(notation_source, notation)
assert notation["synthesis_text"] == (
    "यह एफ ई ऑक्सीकरण अवस्था तीन, एस ओ फोर दो ऋण आवेश, "
    "सी एल ऋण आवेश और Fe3+ हैं।"
)
assert notation["coverage"] == {
    "chemical_symbol_units": 4,
    "numeral_units": 3,
    "operator_units": 0,
}
# Fe3+ is intentionally retained because plain-text magnitude/subscript is
# ambiguous.  Explicit Fe^3+ and Fe³⁺ are accepted instead.
for explicit_charge in ("यह Fe^3+ है।", "यह Fe³⁺ है।"):
    explicit = normalize_pronunciation(explicit_charge)
    verify_audit(explicit_charge, explicit)
    assert explicit["changed"] is True
    assert explicit["coverage"]["chemical_symbol_units"] == 1

calendar_source = "तारीख 2026-08-28 है और तापमान 25.50 है।"
calendar = normalize_pronunciation(calendar_source)
verify_audit(calendar_source, calendar)
assert calendar["synthesis_text"] == (
    "तारीख अट्ठाईस अगस्त दो हज़ार छब्बीस है और तापमान "
    "पच्चीस दशमलव पाँच शून्य है।"
)
assert calendar["coverage"] == {
    "chemical_symbol_units": 0,
    "numeral_units": 4,
    "operator_units": 0,
}

# Ambiguous dates, versions, addresses, arithmetic and element-like English
# words are negative controls.  Unknown words remain exactly as authored.
for retained_source in (
    "I have two apples and He has one.",
    "यह He, In, As, At, I, No, Am, AI और IIT की सूची है।",
    "यह vitamin B two है।",
    "तारीख 03/04/2026 है, version v2.1.0 और IP 10.0.0.1 है।",
    "the formula hai",
):
    retained = normalize_pronunciation(retained_source)
    verify_audit(retained_source, retained)
    assert retained["synthesis_text"] == retained_source, retained_source

arithmetic_source = "यह A -> B और 2 + 2 का उदाहरण है।"
arithmetic = normalize_pronunciation(arithmetic_source)
verify_audit(arithmetic_source, arithmetic)
assert arithmetic["synthesis_text"] == "यह A -> B और दो + दो का उदाहरण है।"
assert arithmetic["coverage"] == {
    "chemical_symbol_units": 0,
    "numeral_units": 2,
    "operator_units": 0,
}

# A rewritten output is idempotent and does not invent a second audit trail.
second_pass = normalize_pronunciation(mixed["synthesis_text"])
verify_audit(mixed["synthesis_text"], second_pass)
assert second_pass["changed"] is False

expect_error("pronunciation_source_required", lambda: normalize_pronunciation(""))
expect_error("pronunciation_domain_unsupported", lambda: normalize_pronunciation("यह पाठ है।", domain="general"))
expect_error("pronunciation_locale_unsupported", lambda: normalize_pronunciation("यह पाठ है।", locale="en-IN"))
expect_error("pronunciation_source_too_large", lambda: normalize_pronunciation("क" * (MAX_SOURCE_CODEPOINTS + 1)))
expect_error("pronunciation_source_control_character", lambda: normalize_pronunciation("यह\x00पाठ है।"))
expect_error(
    "pronunciation_too_many_transformations",
    lambda: normalize_pronunciation("यह " + " ".join("1.1" for _ in range(65))),
)

print("indicf5-pronunciation-normalizer-pass")
