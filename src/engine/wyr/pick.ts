// Her pick, and the deck order — both DETERMINISTIC, both pure functions of
// (card id, salt). Never a model call, for the same reason chess's move is
// code (SPEC-GAMES §0.1): a pick that has to be replayable after a reload, or
// consistent between two tabs, cannot depend on a call that may not land the
// same way twice, and there is no model call cheap enough to make on every
// tap of a two-panel card anyway.
//
// `salt` is the stable per-relationship seed the caller (the component) is
// handed as a prop — it does not change session to session, so her pick on a
// given card is the same fact today as it will be if this exact card ever
// resurfaces months later. That stability is the point: "she picked coffee on
// this one" is allowed to become a thing he remembers about her.
//
// No `Math.random`, no `Date.now()`, nothing time-dependent anywhere in this
// file. A function whose output depends on when it was called cannot be
// tested for determinism and cannot be replayed — both properties `evals/wyr.mjs`
// checks directly.

/**
 * FNV-1a, 32-bit, plus a finalizing mix. Small, dependency-free, and enough
 * entropy for a coin flip and a millisecond offset — this is deck-shuffling,
 * not cryptography.
 *
 * THE FINALIZER IS NOT DECORATION. Plain FNV-1a's bit 0 is linear in the
 * input: `Math.imul(h, odd_prime)` never touches bit 0 (the low bit of a
 * product depends only on the low bits of its factors), so bit 0 of the raw
 * accumulator is nothing but the running XOR-parity of the input's
 * character codes. `herPick` below reads exactly that bit via `% 2`, so
 * without a finalizer, two salts differing in one odd/even character pair
 * (`"...-a"` vs `"...-b"`, say) would flip HER PICK ON EVERY SINGLE CARD in
 * the deck at once — not a spread, a mirror. `evals/wyr.mjs` caught this by
 * asserting the differed-fraction across the deck stays inside 20–80%
 * rather than landing on the deck's full size; it failed at 80/80 before
 * this finalizer existed. The three-step xorshift/multiply below (the
 * standard murmur3 `fmix32`) makes every output bit depend on the whole
 * input nonlinearly, which is what a coin flip actually needs.
 */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export type WyrPick = "a" | "b";

/** Her pick on this card, for this relationship. Stable and replayable: the
 *  same (id, salt) always yields the same letter, forever. */
export function herPick(cardId: string, salt: string): WyrPick {
  return hash32(`pick:${cardId}:${salt}`) % 2 === 0 ? "a" : "b";
}

/** How long after HIS tap her tile flips over, in ms. Seeded so it is stable
 *  per card (a replay looks the same) but varies card to card, which is what
 *  keeps a fixed reveal timer from reading as mechanical. 300–800ms per the
 *  UI spec — long enough to read as "she's deciding", short enough that it
 *  never feels like lag. */
export function herPickDelayMs(cardId: string, salt: string): number {
  const span = hash32(`delay:${cardId}:${salt}`) % 501; // 0..500
  return 300 + span;
}

/**
 * The next card to show, given what has already been seen this session.
 *
 * Pure function of (deckIds, seen, salt) — deliberately not stored anywhere,
 * for the same reason `state/game.ts`'s `lastAssessment` recomputes rather
 * than caches: a stored "next card" is a second source of truth that can
 * disagree with what `seen` and `salt` actually imply. Seeded on `seen.length`
 * so calling it twice without advancing `seen` returns the same card (a
 * re-render must not reshuffle the question under him), and every new length
 * lands on a new pseudo-random pick.
 *
 * Never returns nothing: once the deck is exhausted the pool resets to the
 * full deck rather than the session dead-ending, because "we've asked every
 * question once" is a real thing that happens with an 80-card deck and a long
 * relationship, and stopping the feature outright would be worse than a
 * repeat.
 */
export function nextCardId(
  deckIds: readonly string[],
  seen: readonly string[],
  salt: string,
): string {
  const seenSet = new Set(seen);
  const pool = deckIds.filter((id) => !seenSet.has(id));
  const base = pool.length ? pool : deckIds;
  const idx = hash32(`next:${salt}:${seen.length}`) % base.length;
  return base[idx];
}
