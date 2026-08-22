# STORIES beat-lint failures — decision needed (#80)

**Do not act on this without the owner.** No entries were changed and no lint
rule was touched preparing this brief — it is diagnosis and options only.

## What's failing

`src/engine/storyCatalog.ts`'s `STORIES` array feeds `seedFromStoryCatalog()`
in `src/engine/life.ts`, which lints every `desc` as a life "beat" via
`lintBeat()` before it can be seeded as `approved`. Both current entries in
`STORIES` fail that lint and are seeded as `pending` instead of `approved`
(`src/engine/life.ts` ~line 512: `lint.clean ? "approved" : "pending"`) —
meaning as things stand today, neither of her two story captions can reach a
prompt as a told life-beat without a human shortening it first.

## The two entries, quoted verbatim

From `src/engine/storyCatalog.ts`:

```
id: "2026-08-09-1"
desc: "golden-hour POV from your bed — open book in hand, sun on the pages, plants and your photo wall behind"
```

```
id: "2026-08-09-2"
desc: "mirror selfie sitting cross-legged on the bed in the same golden light, oversized black tee, hair in a messy bun, notebook and book open in front of you"
```

## The lint rule they fail

`src/engine/shapelint.ts`'s `lintLine()`, the rule `lintBeat()` runs every
beat through (`src/engine/life.ts` line 439, `reasons.push(...lintLine(trimmed).reasons)`):

```js
const MAX_WORDS = 14;
...
const words = wordsOf(trimmed);
if (words.length > MAX_WORDS) reasons.push(`too long: ${words.length} words (cap ${MAX_WORDS})`);
```

Plus `lintBeat()`'s own character cap (`src/engine/life.ts` line 143 / 436):

```js
export const MAX_BEAT_CHARS = 110;
...
if (trimmed.length > MAX_BEAT_CHARS) {
  reasons.push(`too long: ${trimmed.length} chars (cap ${MAX_BEAT_CHARS})`);
}
```

Measured against the two entries as written:

| id | words (cap 14) | chars (cap 110) | violations |
|---|---|---|---|
| `2026-08-09-1` | 20 | 102 | too long: 20 words (cap 14) |
| `2026-08-09-2` | 28 | 152 | too long: 28 words (cap 14); too long: 152 chars (cap 110) |

Neither trips the other two `lintBeat`/`lintLine` checks (sentence-shaped
capital-start-plus-terminal-punctuation, first-person-line-initial, or
quoted speech) — this is purely a length problem, both entries were written
as full descriptive captions, not as telegraphic beat notes.

## Why this rule exists (context, not up for relitigating here)

`shapelint.ts`'s header: this guards the `recited-prompt` law — "anything
sentence-shaped in a prompt gets recited back verbatim," measured on this
exact codebase (example quotes recited 4/5 turns; authored taste written as
English sentences recited twice 8 turns apart, 13/96 turns of register
defection). The 14-word cap specifically targets AUTHORED-DATA rows destined
for the volatile tail — the same category `desc` falls into once it becomes
a beat.

Worth noting, since it bears on option 2 below: these `desc` strings were
NOT originally written as life beats. `src/engine/life.ts`'s own comment on
`seedFromStoryCatalog` (line ~491): *"These descs were written as IMAGE
CAPTIONS for `storyContext()`, not as life beats, and both of the current
entries fail the shape lint... a dirty beat is seeded as `pending`, not
rejected."* In other words: this is a known, already-designed-around
tension, not a bug nobody anticipated — the pending-not-rejected behavior
exists specifically because this collision was expected. What's undecided is
whether these two beats are worth fixing into `approved` shape, or whether
`pending` is where they should permanently stay.

`desc` is doing double duty today: the same string is also injected
verbatim into `storyContext()` for her own system-prompt awareness of what's
on her story (`storyCatalog.ts` line 90-92), where the 14-word cap does NOT
apply — that call site isn't a life-beat lint target, it's the
"instructional English" category `shapelint.ts`'s own header carves out.

## Options

### 1. Fix the two entries — shorten `desc` to telegraphic beat shape

Rewrite each `desc` under 14 words / 110 chars, e.g. (illustrative only, not
a proposed final copy — the owner's voice, not this brief's):
- `2026-08-09-1`: "golden-hour, in bed with a book, plants and photo wall behind" (11 words)
- `2026-08-09-2`: "mirror selfie on the bed, golden light, notebook and book open" (11 words)

**Tradeoff:** `desc` is shared with `storyContext()`'s injected-awareness
string, which reads better as a fuller caption ("mirror selfie sitting
cross-legged on the bed in the same golden light...") than as a clipped
beat note. Shortening in place changes what she's told she posted, not just
what passes the life-beat lint. Splitting the field (a separate
`beatDesc`/`storyDesc` pair) avoids that tradeoff but is a real schema
change to `Story`/`SeedStory`, not a copy edit.

### 2. Relax the rule for this call site

Give `seedFromStoryCatalog` (or `STORIES` generally) an explicit exemption —
e.g. treat story captions as `allowlist` the way `lintBlock()` already
exempts `CRISIS_LINES` and phrase-ledger rows for "this is THEIR line /a
fixed line, not something written for her to recite."

**Tradeoff:** story captions are NOT the same category as those two
allowlisted exceptions — CRISIS_LINES must ship verbatim by regulatory
requirement, and phrase-ledger rows are the user's own words. A story
`desc` is authored prose about to become a life-beat exactly like any other
row `recited-prompt` was written to guard, so a bespoke exemption here needs
its own argument, not a borrowed one. Weakest option unless someone can
articulate why story beats are structurally different from every other
life-beat source.

### 3. Leave them `pending`, accept the current (designed-for) behavior

Do nothing. The two beats stay unpublished forever — `pending` beats are
excluded from what gets told (`src/engine/life.ts` line 161: `l.status
='approved'`), so today's actual runtime effect is simply that these two
story-post events never surface as a life beat elsewhere in her prompt.
`storyContext()` still injects the full `desc` on its own separate path
regardless of lint status, so the story ring itself is unaffected either
way — this option only forfeits a *second* use of the same content (as a
told life-beat, e.g. "she mentioned reading in bed a few days ago").

## Recommendation

**Option 1, but only for future entries, and only if a second, shorter
field is worth adding.** Retroactively rewriting these two already-posted
captions changes what she's on record having said she posted — safer to add
a second short field (e.g. `beat?: string`) that authors fill in going
forward when a story is meant to double as a told life-beat, and to leave
these two as `pending`/caption-only (option 3, by default, for the existing
two) unless the owner specifically wants them surfaced as beats. This keeps
the rule intact (it is doing its documented job — see #2's tradeoff), avoids
retroactively rewriting what already shipped, and doesn't force every future
caption to be beat-length just because the field is shared today.
