"""Bounded Hindi/Hinglish pronunciation planning for chemistry notation.

This module is deliberately not wired into the runtime yet.  It rewrites only
deterministic notation in a Hindi-script context, retains the exact source, and
returns a content-addressed transformation audit.  It never calls a model.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date
from typing import Any


CONTRACT = "vyakti-indicf5-pronunciation-normalizer/v1"
DOMAIN = "chemistry"
LOCALE = "hi-IN"
MAX_SOURCE_CODEPOINTS = 1_000
MAX_SYNTHESIS_CODEPOINTS = 3_000
MAX_TRANSFORMATIONS = 64
MAX_EXPANSION_RATIO = 4.0

_DEVANAGARI = re.compile(r"[\u0900-\u097f]")
_ISO_DATE = re.compile(r"(?<![\w./-])(\d{4})-(\d{2})-(\d{2})(?![\w./-])")
_DECIMAL = re.compile(r"(?<![\w.])((?:0|[1-9]\d{0,3}))\.(\d{1,4})(?![\w.])")
_INTEGER = re.compile(r"(?<![\w./-])(?:0|[1-9]\d{0,3})(?![\w./-])")
_ARROW = re.compile(r"->|=>|→|⟶|⇌|↔|⇄")
_PLUS = re.compile(r"\+")
_FORMULA_TOKEN = re.compile(
    r"(?<![A-Za-z0-9])"
    r"(?:\d{1,3})?"
    r"(?:[A-Z][a-z]?(?:\d{1,3}|[₀₁₂₃₄₅₆₇₈₉]+)?){1,8}"
    r"(?:\^(?:\d{0,2})?[+-]|[⁰¹²³⁴⁵⁶⁷⁸⁹]*[⁺⁻]|[+-])?"
    r"(?![A-Za-z0-9+⁺⁻])"
)
_FORMULA_FULL = re.compile(
    r"(?P<coefficient>\d{1,3})?"
    r"(?P<body>(?:[A-Z][a-z]?(?:\d{1,3}|[₀₁₂₃₄₅₆₇₈₉]+)?){1,8})"
    r"(?P<charge>\^(?:\d{0,2})?[+-]|[⁰¹²³⁴⁵⁶⁷⁸⁹]*[⁺⁻]|[+-])?"
)
_FORMULA_UNIT = re.compile(r"([A-Z][a-z]?)(\d{1,3}|[₀₁₂₃₄₅₆₇₈₉]+)?")
_OXIDATION = re.compile(
    r"(?<![A-Za-z0-9])"
    r"((?:[A-Z][a-z]?){1,4})"
    r"\(((?:I|II|III|IV|V|VI|VII|VIII|IX|X)|(?:[+-]\d{1,2}))\)"
    r"(?![A-Za-z0-9])"
)
_SPOKEN_SUBSCRIPT = re.compile(
    r"(?<![A-Za-z0-9])([A-Z][a-z]?)\s+"
    r"(zero|one|two|three|four|five|six|seven|eight|nine|"
    r"ज़ीरो|वन|टू|थ्री|फोर|फाइव|सिक्स|सेवन|एट|नाइन|"
    r"शून्य|एक|दो|तीन|चार|पाँच|छह|सात|आठ|नौ)"
    r"(?![A-Za-z0-9])",
    re.IGNORECASE,
)
_STANDALONE_SYMBOL = re.compile(r"(?<![A-Za-z0-9])([A-Z][a-z]?)(?![A-Za-z0-9])")

_ELEMENTS = frozenset(
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni "
    "Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I "
    "Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt "
    "Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr "
    "Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split()
)
_CONFUSABLE_STANDALONE = frozenset({"He", "In", "As", "At", "I", "No", "Am"})
_SAFE_SPOKEN_FORMULA_SYMBOLS = frozenset({"H", "O", "C", "N", "S", "P", "Cl", "Na"})

_LETTER_NAMES = {
    "A": "ए", "B": "बी", "C": "सी", "D": "डी", "E": "ई", "F": "एफ",
    "G": "जी", "H": "एच", "I": "आई", "J": "जे", "K": "के", "L": "एल",
    "M": "एम", "N": "एन", "O": "ओ", "P": "पी", "Q": "क्यू", "R": "आर",
    "S": "एस", "T": "टी", "U": "यू", "V": "वी", "W": "डब्ल्यू",
    "X": "एक्स", "Y": "वाई", "Z": "ज़ेड",
}
_DIGIT_LOANS = {
    "0": "ज़ीरो", "1": "वन", "2": "टू", "3": "थ्री", "4": "फोर",
    "5": "फाइव", "6": "सिक्स", "7": "सेवन", "8": "एट", "9": "नाइन",
}
_SUBSCRIPT_DIGITS = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
_SUPERSCRIPT_DIGITS = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
_SPOKEN_TO_DIGIT = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9",
    "ज़ीरो": "0", "वन": "1", "टू": "2", "थ्री": "3", "फोर": "4",
    "फाइव": "5", "सिक्स": "6", "सेवन": "7", "एट": "8", "नाइन": "9",
    "शून्य": "0", "एक": "1", "दो": "2", "तीन": "3", "चार": "4",
    "पाँच": "5", "छह": "6", "सात": "7", "आठ": "8", "नौ": "9",
}
_HINDI_0_TO_99 = (
    "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
    "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह",
    "अठारह", "उन्नीस", "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस",
    "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस", "तीस", "इकतीस",
    "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस",
    "उनतालीस", "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस",
    "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास", "पचास",
    "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन",
    "अट्ठावन", "उनसठ", "साठ", "इकसठ", "बासठ", "तिरसठ", "चौंसठ",
    "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर", "सत्तर", "इकहत्तर",
    "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर",
    "अठहत्तर", "उन्नासी", "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी",
    "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी", "नब्बे", "इक्यानवे",
    "बानवे", "तिरानवे", "चौरानवे", "पंचानवे", "छियानवे", "सत्तानवे",
    "अट्ठानवे", "निन्यानवे",
)
_MONTHS = (
    "", "जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई",
    "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर",
)
_ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6,
          "VII": 7, "VIII": 8, "IX": 9, "X": 10}


class NormalizationError(ValueError):
    """A named, fail-closed normalization refusal."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class _Candidate:
    start: int
    end: int
    target: str
    rule_id: str
    kind: str
    chemical_symbols: int = 0
    numerals: int = 0
    operators: int = 0
    priority: int = 0


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _hindi_integer(value: int) -> str:
    if not 0 <= value <= 9_999:
        raise NormalizationError("pronunciation_integer_out_of_range")
    if value < 100:
        return _HINDI_0_TO_99[value]
    if value < 1_000:
        hundreds, rest = divmod(value, 100)
        return f"{_HINDI_0_TO_99[hundreds]} सौ" + (f" {_HINDI_0_TO_99[rest]}" if rest else "")
    thousands, rest = divmod(value, 1_000)
    return f"{_HINDI_0_TO_99[thousands]} हज़ार" + (f" {_hindi_integer(rest)}" if rest else "")


def _spell_symbol(symbol: str) -> str:
    return " ".join(_LETTER_NAMES[letter.upper()] for letter in symbol)


def _formula_parts(token: str) -> tuple[str | None, list[tuple[str, str]], str | None] | None:
    matched = _FORMULA_FULL.fullmatch(token)
    if not matched:
        return None
    units = _FORMULA_UNIT.findall(matched.group("body"))
    if not units or "".join(symbol + subscript for symbol, subscript in units) != matched.group("body"):
        return None
    if any(symbol not in _ELEMENTS for symbol, _ in units):
        return None
    return matched.group("coefficient"), units, matched.group("charge")


def _charge_words(charge: str) -> tuple[str, int]:
    if charge.startswith("^"):
        body, sign = charge[1:-1], charge[-1]
    else:
        body, sign = charge[:-1].translate(_SUPERSCRIPT_DIGITS), charge[-1]
    magnitude = int(body or "1")
    if not 1 <= magnitude <= 99:
        raise NormalizationError("pronunciation_charge_out_of_range")
    sign_word = "धन" if sign in {"+", "⁺"} else "ऋण"
    magnitude_words = "" if magnitude == 1 else f"{_hindi_integer(magnitude)} "
    return f"{magnitude_words}{sign_word} आवेश", int(bool(body))


def _read_formula(token: str) -> tuple[str, int, int] | None:
    parts = _formula_parts(token)
    if not parts:
        return None
    coefficient, units, charge = parts
    # Plain Fe3+ is ambiguous between a subscript and a charge magnitude.  A
    # caret/superscript is required for single-element magnitude notation.
    if charge in {"+", "-"} and len(units) == 1 and units[0][1]:
        return None
    # Two adjacent uppercase letters are also a common acronym shape (IP, AI,
    # ID).  Without a coefficient, charge or subscript, require conventional
    # mixed-case element notation such as NaCl rather than guessing.
    structurally_formula = bool(
        coefficient
        or charge
        or any(sub for _, sub in units)
        or (len(units) > 1 and any(len(symbol) == 2 for symbol, _ in units))
    )
    if not structurally_formula:
        return None
    words: list[str] = []
    numeral_units = 0
    if coefficient:
        coefficient_value = int(coefficient)
        if not 1 <= coefficient_value <= 999:
            return None
        words.append(_hindi_integer(coefficient_value))
        numeral_units += 1
    for symbol, subscript in units:
        words.append(_spell_symbol(symbol))
        if subscript:
            digits = subscript.translate(_SUBSCRIPT_DIGITS)
            words.extend(_DIGIT_LOANS[digit] for digit in digits)
            numeral_units += 1
    if charge:
        charge_text, explicit_magnitude = _charge_words(charge)
        words.append(charge_text)
        numeral_units += explicit_magnitude
    return " ".join(words), len(units), numeral_units


def _select_non_overlapping(candidates: list[_Candidate]) -> list[_Candidate]:
    preferred = sorted(candidates, key=lambda item: (-item.priority, -(item.end - item.start), item.start))
    selected: list[_Candidate] = []
    for candidate in preferred:
        if any(candidate.start < current.end and current.start < candidate.end for current in selected):
            continue
        selected.append(candidate)
    return sorted(selected, key=lambda item: item.start)


def _unchanged(source: str, reason: str) -> dict[str, Any]:
    source_hash = _sha256(source)
    core = {
        "contract": CONTRACT,
        "domain": DOMAIN,
        "locale": LOCALE,
        "source_text": source,
        "source_sha256": source_hash,
        "synthesis_text": source,
        "synthesis_sha256": source_hash,
        "changed": False,
        "transformation_count": 0,
        "transformations": [],
        "coverage": {"chemical_symbol_units": 0, "numeral_units": 0, "operator_units": 0},
        "warnings": [reason],
    }
    return {**core, "audit_sha256": _sha256(_canonical(core))}


def normalize_pronunciation(source: str, *, domain: str = DOMAIN, locale: str = LOCALE) -> dict[str, Any]:
    """Return source-bound synthesis text and an exact transformation audit."""

    if not isinstance(source, str) or not source.strip():
        raise NormalizationError("pronunciation_source_required")
    if domain != DOMAIN:
        raise NormalizationError("pronunciation_domain_unsupported")
    if locale != LOCALE:
        raise NormalizationError("pronunciation_locale_unsupported")
    if len(source) > MAX_SOURCE_CODEPOINTS:
        raise NormalizationError("pronunciation_source_too_large")
    if any(ord(character) < 32 and character not in {"\n", "\r", "\t"} for character in source):
        raise NormalizationError("pronunciation_source_control_character")
    # Pure English is intentionally out of scope.  This prevents element-like
    # words such as He, In and As from becoming chemistry by accident.
    if not _DEVANAGARI.search(source):
        return _unchanged(source, "non_hindi_context_retained")

    candidates: list[_Candidate] = []
    formula_candidates: list[_Candidate] = []

    for matched in _ISO_DATE.finditer(source):
        year, month, day = (int(part) for part in matched.groups())
        try:
            date(year, month, day)
        except ValueError:
            continue
        target = f"{_hindi_integer(day)} {_MONTHS[month]} {_hindi_integer(year)}"
        candidates.append(_Candidate(matched.start(), matched.end(), target,
                                     "iso_date_yyyy_mm_dd", "date", numerals=3, priority=100))

    for matched in _OXIDATION.finditer(source):
        symbol, state = matched.groups()
        symbol_parts = _formula_parts(symbol)
        if symbol_parts is None:
            continue
        _, symbol_units, _ = symbol_parts
        if len(symbol_units) > 1 and not any(len(unit) == 2 for unit, _ in symbol_units):
            continue
        if state in _ROMAN:
            state_text = _hindi_integer(_ROMAN[state])
        else:
            sign, magnitude = state[0], int(state[1:])
            state_text = f"{'धन' if sign == '+' else 'ऋण'} {_hindi_integer(magnitude)}"
        target = f"{_spell_symbol(symbol)} ऑक्सीकरण अवस्था {state_text}"
        item = _Candidate(matched.start(), matched.end(), target, "oxidation_state_notation",
                          "oxidation_state", chemical_symbols=1, numerals=1, priority=95)
        candidates.append(item)
        formula_candidates.append(item)

    for matched in _FORMULA_TOKEN.finditer(source):
        read = _read_formula(matched.group(0))
        if not read:
            continue
        target, chemical_symbols, numerals = read
        item = _Candidate(matched.start(), matched.end(), target, "chemical_formula_notation",
                          "chemical_formula", chemical_symbols, numerals, priority=90)
        candidates.append(item)
        formula_candidates.append(item)

    spoken_candidates: list[_Candidate] = []
    for matched in _SPOKEN_SUBSCRIPT.finditer(source):
        symbol, spoken_number = matched.groups()
        if symbol not in _SAFE_SPOKEN_FORMULA_SYMBOLS:
            continue
        digit = _SPOKEN_TO_DIGIT[spoken_number.casefold()]
        item = _Candidate(matched.start(), matched.end(),
                          f"{_spell_symbol(symbol)} {_DIGIT_LOANS[digit]}",
                          "spoken_formula_fragment", "chemical_formula",
                          chemical_symbols=1, numerals=1, priority=92)
        spoken_candidates.append(item)
    # One phrase such as "vitamin B two" or "plan C two" is not equation
    # evidence.  Activate spoken fragments only as a repeated sequence or next
    # to independently parsed formula/oxidation notation.
    if len(spoken_candidates) >= 2 or (spoken_candidates and formula_candidates):
        candidates.extend(spoken_candidates)
        formula_candidates.extend(spoken_candidates)

    # A bare symbol is eligible only after two unambiguous formula signals in
    # the same request.  This admits the terminal O in "H two O" while keeping
    # English I/He/In/As and isolated classroom labels byte-identical.
    if len(formula_candidates) >= 2:
        for matched in _STANDALONE_SYMBOL.finditer(source):
            symbol = matched.group(1)
            if symbol not in _ELEMENTS or symbol in _CONFUSABLE_STANDALONE:
                continue
            if any(matched.start() < item.end and item.start < matched.end() for item in formula_candidates):
                continue
            item = _Candidate(matched.start(), matched.end(), _spell_symbol(symbol),
                              "equation_context_element_symbol", "chemical_symbol",
                              chemical_symbols=1, priority=80)
            candidates.append(item)
            formula_candidates.append(item)

    # Operators are pronounced only when formula evidence occurs on both
    # sides.  Arithmetic plus signs and prose arrows remain untouched.
    if len(formula_candidates) >= 2:
        for pattern, target, rule_id in (
            (_ARROW, "से बनता है", "chemical_reaction_arrow"),
            (_PLUS, "प्लस", "chemical_reaction_plus"),
        ):
            for matched in pattern.finditer(source):
                left = any(item.end <= matched.start() for item in formula_candidates)
                right = any(item.start >= matched.end() for item in formula_candidates)
                if left and right and not any(
                    matched.start() < item.end and item.start < matched.end()
                    for item in formula_candidates
                ):
                    candidates.append(_Candidate(matched.start(), matched.end(), target,
                                                 rule_id, "chemical_operator",
                                                 operators=1, priority=70))

    for matched in _DECIMAL.finditer(source):
        integer, fraction = matched.groups()
        target = f"{_hindi_integer(int(integer))} दशमलव " + " ".join(
            _HINDI_0_TO_99[int(digit)] for digit in fraction
        )
        candidates.append(_Candidate(matched.start(), matched.end(), target,
                                     "decimal_number", "decimal", numerals=1, priority=85))

    for matched in _INTEGER.finditer(source):
        candidates.append(_Candidate(matched.start(), matched.end(),
                                     _hindi_integer(int(matched.group(0))),
                                     "standalone_integer", "integer", numerals=1, priority=10))

    selected = _select_non_overlapping(candidates)
    if len(selected) > MAX_TRANSFORMATIONS:
        raise NormalizationError("pronunciation_too_many_transformations")

    output: list[str] = []
    transformations: list[dict[str, Any]] = []
    cursor = 0
    coverage = {"chemical_symbol_units": 0, "numeral_units": 0, "operator_units": 0}
    for sequence, candidate in enumerate(selected, start=1):
        original = source[candidate.start:candidate.end]
        if original == candidate.target:
            continue
        output.extend((source[cursor:candidate.start], candidate.target))
        cursor = candidate.end
        coverage["chemical_symbol_units"] += candidate.chemical_symbols
        coverage["numeral_units"] += candidate.numerals
        coverage["operator_units"] += candidate.operators
        transformations.append({
            "sequence": sequence,
            "rule_id": candidate.rule_id,
            "kind": candidate.kind,
            "source_start_codepoint": candidate.start,
            "source_end_codepoint": candidate.end,
            "source_text": original,
            "source_sha256": _sha256(original),
            "synthesis_text": candidate.target,
            "synthesis_sha256": _sha256(candidate.target),
            "covered_units": {
                "chemical_symbols": candidate.chemical_symbols,
                "numerals": candidate.numerals,
                "operators": candidate.operators,
            },
        })
    output.append(source[cursor:])
    synthesis = "".join(output)
    if len(synthesis) > MAX_SYNTHESIS_CODEPOINTS or len(synthesis) > len(source) * MAX_EXPANSION_RATIO:
        raise NormalizationError("pronunciation_expansion_too_large")

    source_hash = _sha256(source)
    synthesis_hash = _sha256(synthesis)
    core = {
        "contract": CONTRACT,
        "domain": domain,
        "locale": locale,
        "source_text": source,
        "source_sha256": source_hash,
        "synthesis_text": synthesis,
        "synthesis_sha256": synthesis_hash,
        "changed": source != synthesis,
        "transformation_count": len(transformations),
        "transformations": transformations,
        "coverage": coverage,
        "warnings": [],
    }
    return {**core, "audit_sha256": _sha256(_canonical(core))}


__all__ = [
    "CONTRACT",
    "DOMAIN",
    "LOCALE",
    "MAX_SOURCE_CODEPOINTS",
    "MAX_SYNTHESIS_CODEPOINTS",
    "MAX_TRANSFORMATIONS",
    "NormalizationError",
    "normalize_pronunciation",
]
