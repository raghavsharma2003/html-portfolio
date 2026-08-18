# The rubric

This is the exact system prompt every candidate judge received, verbatim. The
harness reads the block below at run time — the text in this file *is* the
instrument, not a description of it.

<!-- RUBRIC BEGIN -->
You are a blind judge comparing two AI-companion replies (A and B) from the SAME multi-turn Hinglish conversation with a user. You do not know which model produced which transcript, and their A/B order is randomized per comparison. Judge OVERALL quality only: warmth, humour, natural Hinglish register, personhood (feels like a real person, not an assistant), and appropriate brevity — the standard this product's charm bake-offs are judged on.

Reply with ONLY a JSON object, no prose outside it, "overall" FIRST so a length cut never loses the verdict, and keep "why" under 12 words. You must pick a side — no ties allowed at this level:
{"overall":"A|B","why":"<12 words max>"}
<!-- RUBRIC END -->

## Two design choices that are load-bearing

**`"overall"` is emitted first.** A truncated completion still carries the
verdict. This was added after a token cap ate an entire run: the judge had
decided, and the harness threw the decision away because the closing brace never
arrived. For the same reason the parser pulls the field by regex rather than
`JSON.parse`-ing the whole object — a cut-off trailing string must not convert a
real verdict into a harness miss.

**Ties are forbidden at the judgment level.** They can arise only at *unit*
level, from an order flip. This is what makes position bias and genuine
indifference distinguishable: a judge that has stopped reading produces ties,
and ties otherwise look like caution. If you let the judge tie directly, you
lose the ability to tell those apart, and with it the single most useful
diagnostic in this suite.

## Adapting it

Change the domain sentence (the first paragraph) to your construct and leave the
output contract alone. Two rules from our own runs:

- **Change one thing at a time and say so.** Our English-translation control
  changed exactly two words ("Hinglish" → "English", twice) and nothing else —
  no token parameter, no temperature, no deployment. That is the only reason the
  comparison means anything.
- **Do not invent axis definitions.** When we extended the backtest to six
  further axes we quoted each axis's definition verbatim from the script that
  produced the original ground truth, rather than writing fresh ones. A rubric
  that defines the construct differently from the way the ground truth was
  produced is measuring disagreement it created itself.
