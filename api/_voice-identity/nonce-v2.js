export const IDENTITY_NONCE_V2 = Object.freeze({
  version: "voice-identity-nonce/v2",
  max_recognized_code_units: 4000,
  issued_digits: 6,
  recognized_digit_scripts: Object.freeze(["ASCII", "Devanagari-after-NFKC"]),
  digit_separator: "whitespace-or-one-ASCII-comma-with-optional-whitespace",
  extra_numeric_tokens: "reject",
});

// No phrase matching or word-to-number conversion. This is a future v2 lexical
// prerequisite, not a liveness verdict or a change to the legacy decision.
// The entire transcript must contain exactly six supported digits. They form
// either one six-digit token or six single-digit tokens; intermediate chunks
// such as 01 23 45 are not accepted. An unrelated extra number also rejects.
// Between single-digit tokens only Unicode White_Space and at most one ASCII comma are
// allowed. Periods, hyphens, slashes, colons and words cannot join digit runs.
// Outer boundaries are an explicit punctuation/whitespace allowlist, preventing
// letters, combining marks, joiners or identifier punctuation touching digits.
// A bare six-digit date/identifier cannot be distinguished from a nonce by this
// lexical check alone. No semantic date recognition or ASR accuracy is claimed.
export function matchesIssuedNonceV2(nonce, recognizedText) {
  if (typeof nonce !== "string" || nonce.length !== 11 || !/^[0-9]( [0-9]){5}$/.test(nonce) ||
      typeof recognizedText !== "string" || !recognizedText.length ||
      recognizedText.length > IDENTITY_NONCE_V2.max_recognized_code_units) return false;
  const normalized = recognizedText.normalize("NFKC");
  if (normalized.length > IDENTITY_NONCE_V2.max_recognized_code_units) return false;
  const text = normalized.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));
  // Reject unsupported number scripts rather than silently ignoring an extra
  // number or letting it masquerade as a token boundary around ASCII digits.
  if (/[^0-9]/u.test(text.replace(/[^\p{N}]/gu, ""))) return false;
  const tokens = [...text.matchAll(/[0-9]+/g)];
  if (tokens.length !== 1 && tokens.length !== 6) return false;
  if (tokens.length === 1 ? tokens[0][0].length !== 6 : tokens.some((token) => token[0].length !== 1)) return false;
  const first = tokens[0].index;
  const last = tokens.at(-1).index + tokens.at(-1)[0].length;
  const before = first === 0 ? "" : text[first - 1];
  const after = last === text.length ? "" : text[last];
  if (before && !/[\p{White_Space}("'“‘\[:]/u.test(before)) return false;
  if (after && !/[\p{White_Space}).!?"'”’\],;:।॥]/u.test(after)) return false;
  for (let index = 1; index < tokens.length; index++) {
    const previous = tokens[index - 1];
    const separator = text.slice(previous.index + previous[0].length, tokens[index].index);
    if (!/^(?:\p{White_Space}+|\p{White_Space}*,\p{White_Space}*)$/u.test(separator)) return false;
  }
  return tokens.map((token) => token[0]).join("") === nonce.split(" ").join("");
}
