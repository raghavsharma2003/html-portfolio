// WS-R161 (wave twenty-two). The `./_dialogue/registry.js` seam
// `evals/rehearsal/loader.mjs`'s own `SUFFIX_REDIRECT` map now redirects
// here (`_dialogue/registry.js`, matched on its trailing TWO path
// segments, exactly the way `_provenance/registry.js` already is — that
// map's own header explains why a basename-only match is unsafe for a
// literal "registry.js", which eight files in this repo share).
//
// `api/_dialogue/registry.js`'s REAL `createProductionDialogueGenerator`
// throws `dialogue_generator_unavailable` (503) whenever `AZURE_FOUNDRY_*`
// is unset, which this environment always is — an honest refusal needing
// no fixture at all. This stub exists for the ONE thing that honest
// refusal cannot prove: that a text-ready turn actually COMPLETES. It
// answers with a small, injectable fake reply — `evals/rehearsal/
// personal.mjs`'s own `setFakeDialogueReply`, the exact shape
// `stubs/surface-with-fake-model.mjs`'s `setFakeReply` already
// established for the Room's own gatedReply seam.
let fakeReply = null;

/** `fn(prompt) => { reply, delivery }`, or `null` to restore the honest
 *  `dialogue_generator_unavailable` refusal (this stub's own default —
 *  never a fabricated success unless a caller opts in). */
export function setFakeDialogueReply(fn) {
  fakeReply = typeof fn === "function" ? fn : null;
}

function fakeGenerator() {
  return {
    family: "rehearsal",
    name: "fake-dialogue",
    version: "v1",
    model: "rehearsal-fake",
    // No `billing` field: `api/_provider-budget.js#reserveFoundrySpend`
    // returns `null` immediately for an adapter with no recognised
    // `billing.meter`, so this fixture never needs to answer a spend/
    // reservation query at all.
    async generate({ prompt }) {
      const produced = fakeReply ? fakeReply(prompt) : {
        reply: "This is a rehearsal reply, standing in for a real model call.",
        delivery: { mode: "grounded", pace: "natural", intensity: 0.4, language_hint: "", nonverbals: [] },
      };
      return { output: { reply: produced.reply, delivery: produced.delivery }, usage: null };
    },
  };
}

export function createProductionDialogueGenerator() {
  if (!fakeReply) {
    throw Object.assign(new Error("dialogue_generator_unavailable"), { code: "dialogue_generator_unavailable", status: 503 });
  }
  return fakeGenerator();
}

export function createProductionComparisonGenerator() {
  throw Object.assign(new Error("comparison_provider_revision_required"), { code: "comparison_provider_revision_required", status: 503 });
}
