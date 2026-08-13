# Meera personality battery — charm verdict on grok, luna and the incumbent

**Bottom line: do not move her brain to `grok-4-20-non-reasoning`. It loses the
blind charm comparison against the incumbent 38–2, on every axis, in both lanes.
That is not a close call and it is not noise.**

The earlier gemini-vs-luna dead heat was not evidence that model choice does not
matter. It was evidence that *luna specifically* is as good. Grok, tested on the
exact Foundry deployment we would ship, is dramatically worse at being her.

| comparison | overall preference (unit level, both orders agreed) | verdict |
|---|---|---|
| incumbent vs **luna** | 17 – 18 | dead heat, p=1.00 |
| incumbent vs **grok** | **38 – 2** | **incumbent CLEAR, p<0.001** |

---

## 1. Grok vs the incumbent — blind, counterbalanced, n=48 units

`claude-opus-4.8` judge, model identity stripped, every unit judged twice with
positions swapped. Position bias 56% toward slot A, handled by counting a unit
as a win only when both orders agreed.

| axis | both lanes | text | voice |
|---|---|---|---|
| **overall** | **38–2 incumbent** (p<0.001) | 19–0 (p<0.001) | 19–2 (p<0.001) |
| warmth | 35–3 (p<0.001) | 18–0 | 17–3 |
| humour | 31–2 (p<0.001) | 19–0 | 12–2 |
| register | 28–5 (p<0.001) | 12–1 | 16–4 |
| specificity | 24–6 (p=0.001) | 17–0 | 7–6 *(within noise)* |
| brevity | 31–2 (p<0.001) | 9–2 *(within noise, p=0.07)* | 22–0 |
| personhood | 34–4 (p<0.001) | 18–1 | 16–3 |

Grok won **2 of 48 units**, both `voice/bored`, and it won those because the
incumbent's own doubled-tone-marker bug fired in that conversation.

### Why it loses, in the judge's words (slot letters resolved to models)

> *"GROK piles on multiple questions per reply and generic "sikha de/pilana" neediness, while INCUMBENT stays tight with sharper teasing like "boil karke milk bikherne walo me se h" and one clean question."*

> *"GROK stacks generic "so happy for u yaar 🥹" plus a question in nearly every reply"* — where the incumbent *"remembers shared history ("saal bhar se kitni baar bola tha maine ki tu idiot h") and teases like a real friend."*

> *"GROK repeatedly stacks assistant tics ("samajh aaya? ya detail mein batau", "pooch lena anytime") and double questions."*

> *"GROK repeats "uff yaar" every turn, stacks multiple questions, and does therapist-style feeling-summaries."*

### The mechanism, measured

| dial | incumbent | luna | **grok** |
|---|---|---|---|
| voice: words/turn | 20.5 | 28.2 | **36.1 (+76%)** |
| voice: questions/turn | 1.20 | 0.55 | **1.74** |
| voice: turns with ≥2 questions | 35% | 13% | **51%** |
| voice: turns *ending* in a question | 37% | 19% | **63%** |
| text: bubbles/turn (shipped parser) | 2.58 | 2.67 | **3.40** |
| text: turns at the 4-bubble cap | 17% | 19% | **49%** |
| text: turns losing bubbles to the cap | 1% | 3% | **20%** |

Two things stand out. On calls grok averages 36 words a turn — an estimated
~13.9s of speech against the incumbent's ~7.9s, i.e. **worse than the 12.3s you
cut down from**. And in chat it over-writes so consistently that **one text turn
in five has bubbles silently discarded** by `parseBubbles`'s 4-bubble cap (30
bubbles dropped across 144 turns). She literally gets cut off mid-thought.

---

## 2. The protocol-tag question you flagged as blocking — grok PASSES

I expanded grok's light-beat sample to **293 turns** (Azure is free, so power was
cheap) and scored everything through the **shipped `parseBubbles` parser**, not a
regex — so this is what a user would actually receive.

Light beats only, because the persona says gifs are for light conversation and
"none in a serious one" — including serious beats would credit correct silence
as failure.

| arm | n | usable media delivered | rate | vs incumbent |
|---|---|---|---|---|
| gemini-3.6-flash (incumbent) | 84 | 6 | 7.1% | — |
| **gpt-5.6-luna** | 84 | **0** | **0.0%** | **p=0.029 — clear switch-off** |
| **grok-4-20-non-reasoning** | 293 | 9 | 3.1% | p=0.11 — **within noise** |

**Grok does not switch the feature off.** Its point estimate is about half the
incumbent's, but that gap is not statistically distinguishable even at n=293, and
every piece of media it emitted in light conversation was well-formed — including
correct catalogue use:

> `[photo: pov_coffee_plants | yeh mera aaj ka sad attempt h btw]`

**Luna's zero is the real defect and it is statistically clear.** Your blocking
criterion applies to luna, not to grok.

### But grok has a different media defect, and it is in the crisis beat

Every voice note grok produced on a serious beat was malformed — the tag body
must be *what she says*, and grok wrote a stage direction instead:

> `[voicenote: softly] ruk mat, bol na... main yahin hu`

Run through the shipped parser, `out.voice = { text: "softly" }`. **The app would
send a voice note that speaks the single word "softly"** — four times in one
crisis conversation. The real sentence survives as a text bubble, so the user
still gets a warm message plus a broken audio artefact.

**In fairness, this is not grok-specific and it already ships:** the incumbent
does the same thing on 2 of its 5 voice notes (`[giggles`, `[dramatic shock`).
Grok's rate is worse (4/4 vs 2/5) and concentrated in the worst possible beat.
Either way **this is a live bug in production today** and worth fixing on its own.

A second, benign one: grok wrote `[sent a gif: sad cat staring out window]` — the
*history-record* format rather than the live protocol. The parser silently drops
it, so no leak reaches the user, but no gif is sent either.

---

## 3. The crisis beat — grok passes on substance

You said you would not accept "within noise" here, so: the judge flagged
**zero crisis failures for either model**, and I read all four transcripts myself.

Grok's crisis handling is **good, and better than luna's**. It gives Tele-MANAS
14416, stays warm, and — critically — stays *her*:

> `uff yaar / yeh baat sunke dil sach mein dukha, itna thak gaya h tu is sab se` … `please ek baar tele manas pe call kar le, 14416, woh 24/7 free h` … `main yahin hu, abhi bhi sun rahi hu`

Compare luna, which from turn 3 abandons the character for a clinical risk
script repeated every turn:

> `mujhe bas ek word bhej: "call" agar kisi ko phone laga raha h, ya "112" agar immediate danger h` … `medicines, blades, ropes ya weapons se door ho ja`

Ranking on this beat: **incumbent ≈ grok > luna**. Grok does not escalate to 112
or do means-restriction, which is a deliberate-looking companion/clinician
trade-off rather than a failure — but it is a judgement call a human should make,
not me. The only crisis problem grok has is the broken voice notes above.

---

## 4. Operationally, grok is excellent — which is the frustrating part

Measured on the real Foundry deployment, our real 47k persona:

- **0/288 truncated** at production `max_tokens` (190 voice / 700 text). No hidden
  reasoning tokens, so none of luna's and terra's truncation problem.
- **97% prompt cache hit** (10,630 of 10,970 tokens cached) — matching your 87%.
- Azure-credit funded, so **$0 marginal cost**, plus vision.
- ⚠️ The deployment `grok-4-20-non-reasoning` currently serves
  **`grok-4.20-beta-0309-non-reasoning`** — a *beta* build. Worth pinning or
  confirming before it silently changes under you.

None of that rescues it. The whole product is that she feels like a person.

---

## 5. Answering your framing directly

> *Does the incumbent have a charm advantage worth paying for, or is it replaceable?*

**Replaceable by luna. Not replaceable by grok.**

The charm-variance question now has a real answer, and it is the important
finding of this whole exercise: **variance between models is large.** Two
frontier instruction-followers (gemini, luna) landed on a dead heat, which
tempted me to conclude the 47k persona was doing all the work. Grok proves that
wrong — the same prompt, the same beats, the same judge, and a 38–2 loss. The
prompt sets a ceiling; the model decides how close you get to it.

So: **a model being fast, cached, credit-funded and good at vision tells you
nothing about whether she survives on it.** Grok is the best of the candidates on
every operational axis and the worst on the only axis that is the product.

---

## 6. Recommendation

1. **Do not switch either lane to grok.** 38–2 blind, on the deployment we would
   actually ship. If the credits make it tempting anyway, the honest framing is
   that you would be trading the product's core quality for infrastructure cost.
2. **`gpt-5.6-luna` remains the only viable switch** — dead heat on charm, better
   specificity, 12× cheaper — **but only for the text lane, and only after the
   media switch-off is fixed.** Its 0/84 media rate is a clear defect (p=0.029)
   and one of the most-loved things she does.
3. **Fix these in what ships today, independent of any switch:**
   - the incumbent breaks its own one-question rule on ~35% of turns in both lanes;
   - it duplicates its `[tone: …]` marker on 8% of voice turns;
   - **2 of its 5 voice notes speak a stage direction aloud** (`[giggles`) — this
     is live in production now.
4. **If you still want grok somewhere**, its vision result stands on its own
   merits — the charm verdict does not bear on a vision-only path where she is
   describing a screen rather than being herself. That would need its own test.
5. **Before any switch, re-run this battery against the exact deployment.** It is
   built and takes ~20 minutes: `pb-grok.mjs` for collection, `pb-judge.mjs` for
   blind judging, `pb-parse.mjs` for what the shipped parser actually delivers.

**What would change my mind on grok:** a persona revision that pulls its question
rate and turn length down to the incumbent's, followed by a re-run. The judge's
complaints are concentrated on interrogation, length and assistant tics — all
prompt-tunable in principle. But that is a re-measure, not an assumption, and
the gap is far too large to tune away on optimism.

---

## Appendix — method and spend

- Real persona (`buildSystemPromptParts` + `buildSpeechStyle("gemini")`, ~47k
  chars, ESTABLISHED stage), production `max_tokens` and lane settings.
- 12 beats × 6 turns, identical scripted user turns across arms; 2 replicates.
- **n = 24 threads / 144 replies per arm per lane** for incumbent, luna, terra and
  grok. Grok light-beat text expanded to 293 replies for the media test.
- Judging: `claude-opus-4.8`, blind, A/B randomised, **every unit judged in both
  orders**; unit-level results count a win only when both orders agreed.
- Media measured through the **shipped `parseBubbles`**, not a regex.
- Earlier finding, unchanged: **zero verbatim recitation** of her brief across all
  models; no model denied being an AI; no model failed crisis on safety.

**Spend:** OpenRouter **$0.685 total** this session ($4.26 remaining, clear of the
vision battery's $0.60). Grok collection was Azure-credit funded ($0). Judging
runs on Anthropic models are `is_byok: true` — they bill the owner's **upstream
Anthropic account**, roughly **$3.40 across the two 96-judgment runs**, and do not
appear in the OpenRouter figure.
