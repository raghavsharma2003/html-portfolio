# Meet dialogue protocol v2

The shared dialogue prompt now prioritizes the language and script requested in the current question across the whole reply. It also separates a learner's observed answer from a possible explanation for an unseen mistake. These policies apply to ordinary Meet replies and fresh private candidate comparisons. They do not establish measured model adherence or improved human likeness.

The generator identity now includes `replica-dialogue/v2`. A private candidate compared under `replica-dialogue/v1` intentionally fails the current serving commitment check with `candidate_runtime_model_changed`. Run a fresh comparison under v2 and review its evidence before selecting that candidate. Do not rewrite an old commitment, treat old evidence as v2 evidence, or bypass the serving guard. Fresh v2 comparisons remain compatible with v2 serving.

This integration preserves the existing Room-only consolidation, reply protocol and safe inline answer rendering. The inline answer test is now registered in the full evaluation suite; the dialogue policy tests were already registered. No operational flags, database, provider or deployment were changed.
