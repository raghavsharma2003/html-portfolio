const REFERENCE_MODES = new Set(["devanagari", "mixed", "latin_only", "unknown"]);

export function voiceScriptMode(value) {
  let devanagariChars = 0;
  let latinChars = 0;
  for (const character of String(value || "")) {
    const code = character.codePointAt(0);
    if (code >= 0x0900 && code <= 0x097f) devanagariChars += 1;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latinChars += 1;
  }
  const mode = devanagariChars > 0
    ? (latinChars > 0 ? "mixed" : "devanagari")
    : (latinChars > 0 ? "latin_only" : "unknown");
  return Object.freeze({ mode, devanagariChars, latinChars });
}

export function normalizeReferenceLanguageMode(value) {
  const mode = String(value || "unknown").toLowerCase();
  if (!REFERENCE_MODES.has(mode)) {
    throw Object.assign(new Error("voice_reference_language_mode_invalid"), {
      code: "voice_reference_language_mode_invalid",
      status: 400,
    });
  }
  return mode;
}

// Chatterbox's own multilingual guidance says a prompt-language mismatch can
// transfer the prompt's accent and names cfg_weight=0 as the mitigation. This
// function makes that behavior deterministic and visible. `latin_only` is not
// called English: the transcript may be romanized Hindi, which our current ASR
// lane does not distinguish. `unknown` likewise stays unknown.
export function voiceLanguageConditioning({ languageId, referenceLanguageMode, referenceLanguageEvidenceScope = "unverified", textLanguageMode, requestedCfgWeight, disclosureLanguageId = "en" }) {
  const language = String(languageId || "").toLowerCase();
  const referenceMode = normalizeReferenceLanguageMode(referenceLanguageMode);
  const textMode = normalizeReferenceLanguageMode(textLanguageMode);
  const evidenceScope = String(referenceLanguageEvidenceScope || "unverified").toLowerCase();
  if (!new Set(["source_transcript", "exact_reference", "unverified"]).has(evidenceScope)) {
    throw Object.assign(new Error("voice_reference_language_scope_invalid"), { code: "voice_reference_language_scope_invalid", status: 400 });
  }
  const requested = Number(requestedCfgWeight);
  if (!Number.isFinite(requested) || requested < 0 || requested > 1) {
    throw Object.assign(new Error("voice_cfg_weight_invalid"), { code: "voice_cfg_weight_invalid", status: 400 });
  }
  const warnings = [];
  let effectiveCfgWeight = requested;
  let qualityState = "language_match_not_assessed";
  if (language === "hi") {
    // Today ASR covers the full source while the delivered reference is a
    // selected window whose original timeline is not retained in the artifact
    // manifest. This is therefore a source-level script observation, not a
    // claim that the exact 10-second voice prompt contains that language.
    if (evidenceScope === "source_transcript") warnings.push("reference_script_observed_at_source_scope");
    else if (evidenceScope === "unverified") warnings.push("reference_script_evidence_scope_unverified");
    if (referenceMode === "latin_only") {
      effectiveCfgWeight = 0;
      qualityState = "accent_transfer_mitigation_applied";
      warnings.push("hindi_reference_latin_only_cfg_disabled");
    } else if (referenceMode === "unknown") {
      effectiveCfgWeight = 0;
      qualityState = "reference_language_unverified";
      warnings.push("hindi_reference_language_unverified_cfg_disabled");
    } else if (referenceMode === "mixed") {
      qualityState = "mixed_reference_observed";
      warnings.push("hindi_reference_mixed_script");
    } else {
      qualityState = "script_match_observed";
    }
    if (textMode === "latin_only") warnings.push("hindi_text_latin_only_unverified");
    else if (textMode === "mixed") warnings.push("hindi_text_mixed_script");
    if (String(disclosureLanguageId || "en").toLowerCase() !== "hi") {
      warnings.push("english_disclosure_under_hindi_language");
    }
  }
  return Object.freeze({
    referenceLanguageMode: referenceMode,
    referenceLanguageEvidenceScope: evidenceScope,
    textLanguageMode: textMode,
    requestedCfgWeight: requested,
    effectiveCfgWeight,
    qualityState,
    qualityWarnings: Object.freeze(warnings),
  });
}
