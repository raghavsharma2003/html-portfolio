// Pure, bounded membership ordering for already-authorized private-memory
// rows. This module never queries storage, changes a row or infers a fact.
// The caller remains responsible for scope, consent, correction and erasure.

export interface PrivateMemorySelectionCandidate {
  readonly body: string;
  readonly communication_support?: unknown;
}

const MAX_QUERY_TOKENS = 128;
const MAX_BODY_TOKENS = 512;
// A one-letter label such as Section X is useful only while it remains rare
// inside this already-bounded pool. This frequency guard keeps generic
// one-letter words from turning every matching row into "relevant".
const MAX_SINGLE_LETTER_DOCUMENT_FREQUENCY = 2;
const TOKEN = /[\p{L}\p{M}\p{N}]+/gu;

function isSingleLetter(token: string): boolean {
  return Array.from(token).length === 1 && /^\p{L}$/u.test(token);
}

function tokens(value: string, limit: number): string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const matches = normalized.match(TOKEN) ?? [];
  const unique = new Set<string>();
  for (const token of matches) {
    unique.add(token);
    if (unique.size === limit) break;
  }
  return [...unique];
}

/**
 * Returns candidate indices in the order a bounded selector should try them.
 * Communication-support rows remain reserved first. Relevant rows are ranked
 * only by overlap between bounded Unicode tokens from the current question
 * and each row body. Candidate recency order is the stable tie-breaker and
 * fills every remaining slot when there is no usable match.
 */
export function privateMemorySelectionOrder<T extends PrivateMemorySelectionCandidate>(
  candidates: readonly T[],
  question?: string,
): number[] {
  const support: number[] = [];
  const ordinary: number[] = [];
  candidates.forEach((row, index) => {
    (row.communication_support === true ? support : ordinary).push(index);
  });

  const queryTokens = tokens(question ?? "", MAX_QUERY_TOKENS);
  if (!queryTokens.length) return [...support, ...ordinary];

  const querySet = new Set(queryTokens);
  const bodyTokens = new Map<number, Set<string>>();
  const frequency = new Map<string, number>();
  for (const index of ordinary) {
    const rowTokens = new Set(tokens(candidates[index].body, MAX_BODY_TOKENS));
    bodyTokens.set(index, rowTokens);
    for (const token of querySet) {
      if (rowTokens.has(token)) frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }

  const relevant = ordinary.map(index => {
    const rowTokens = bodyTokens.get(index) ?? new Set<string>();
    const matched = queryTokens.filter(token => rowTokens.has(token)
      && (!isSingleLetter(token)
        || (frequency.get(token) ?? 0) <= MAX_SINGLE_LETTER_DOCUMENT_FREQUENCY));
    const weighted = matched.reduce((score, token) => score + ordinary.length + 1 - (frequency.get(token) ?? 0), 0);
    return { index, matched: matched.length, weighted };
  }).filter(row => row.matched > 0)
    .sort((a, b) => b.weighted - a.weighted || b.matched - a.matched || a.index - b.index);

  const ranked = new Set(relevant.map(row => row.index));
  return [...support, ...relevant.map(row => row.index), ...ordinary.filter(index => !ranked.has(index))];
}
