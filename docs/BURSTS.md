# Bursts — when he sends more than one message

> "there will be thousands of cases... multiple messages can be different
> conversations and different topics also. Everything has to be handled...
> exactly like human behavior, not AI or robotic."
>
> "This should not be like multiple messages from her and then a single message
> from me. I can also send multiple messages and that can have so many
> complexities."

Her side of this — one reply, several bubbles — has been built for a long time.
**His** side had one mechanism: a 1300 ms timer. That is why he could send three
messages and get an answer to the first, and why she said hello three times in
one conversation.

This document is the case space, what now covers each case, and where each case
is checked. A taxonomy with no checks is prose, so every row names a test.

---

## The four mechanisms

Everything below is one of these, or a composition of them.

| | mechanism | where | what it knows |
|---|---|---|---|
| **M1** | the breath | `burst.ts` `burstWaitMs` + `followUpRate` | how often he doubles, and how fast |
| **M2** | the engagement hold | `burst.ts` `burstDecide` + `Chat.tsx` | whether he is at the keyboard at all |
| **M3** | continuation | `burst.ts` `likelyMore` | whether his words are finished |
| **M4** | the interjection ceiling | `burst.ts` `BURST_INTERJECT_MS` | when waiting has become stalling |
| **M9** | the handoff | `burst.ts` `handedOver` | whether he gave HER the floor |

Plus two things that are not timing at all:

| | mechanism | where |
|---|---|---|
| **M5** | the burst reaches the model as ONE user turn | `brain.ts` `toTurns` |
| **M6** | greet once per sitting | `greeting.ts`, wired in `brain.ts`'s `gate()` |

And the machinery that was already here and still does the work it always did:

| | mechanism | where |
|---|---|---|
| **M7** | supersede — a newer message throws away an in-flight generation | `Chat.tsx` `replyPass` seq check |
| **M8** | dirty — messages that land mid-delivery get a follow-up pass | `Chat.tsx` `replyPass` → `replyCycle`'s loop |

### The constants, and why each is that number

| constant | value | derivation |
|---|---|---|
| `BURST_MIN_MS` | 700 | unchanged; the floor for a check-in ("hello??"), the fastest reply in the product |
| `BURST_GRACE_FLOOR_MS` | **2600** | **WS-BREATH.** The breath every message gets. It must clear the window in which a person REACHES for the keyboard (measured cut-offs began at 1.3s) and stay well under the ~6s app-broke line, because it is charged on every message including the ones with no follow-up |
| `BURST_MAX_MS` | 3200 → **4500** | **WS-BREATH.** The old number priced only "looking left-on-read", which is right for a wait bought on NO evidence and wrong for one bought on the evidence that THIS person doubles. Still under the ~6s line |
| `BURST_HANDOFF_MS` | **1300** | **WS-BREATH.** The one direction the breath may shrink — and deliberately the pre-WS-BREATH default, because the old behaviour was not wrong on a question aimed at her, it was wrong everywhere else |
| `FOLLOWUP_PRIOR` / `_WEIGHT` / `_HALFLIFE` | **0.35 / 3 / 8** | **WS-BREATH.** A stranger is assumed below half (the floor is already the patient answer); the prior is worth three observations so a two-message thread cannot read 1.0; recency half-life of 8 messages so who he is now outranks who he was |
| `BURST_MULTIPLIER` | 1.6 | unchanged judgment: the smallest multiplier that clears a typical gap with margin |
| `COMPOSE_ACTIVE_MS` | 3000 | the typing indicator every messaging app has trained him on drops after a few seconds of stillness, so a longer pause already reads to HIM as having stopped |
| `COMPOSE_PAUSE_MIN_MS` / `_PER_CHAR_MS` | **3500 / 100** | **WS-BREATH.** The mid-thought pause scales with how much of the thought is already on screen: 3500 + 100·len, reaching the 10s ceiling at 65 characters. It replaced a flat budget that gave "aaaa" the same ten seconds as a paragraph |
| `COMPOSE_ABANDON_MS` | 10000 | unchanged, but now the CEILING of that budget rather than the whole of it; past this he has put the phone down |
| `FOCUS_HOLD_MS` | **6000** | **WS-BREATH.** The think-pause BEFORE the first letter. Longer than `COMPOSE_ACTIVE_MS` because reaching a decision takes longer than reaching the next word; under the two continuation ceilings' sum (10s); at the app-broke line, which is the right place for a hold bought on presence rather than content |
| `SETTLE_MS` | **1200** | **WS-BREATH.** Punctuation, not patience: the beat after he lets go of the box, so the far end of the hold is not a cliff either. The shortest hold in the file, by construction |
| `CONTINUATION_WEAK_MS` / `STRONG_MS` | 1100 / 1800 | a hinge word buys about one more fragment; a bare "hello" or "1 sec" buys a whole message |
| `BURST_CONT_MAX_MS` | 5000 | a ceiling bought against near-certainty of a split burst can exceed the no-evidence ceiling, but not past ~6s, where a person starts checking whether the app broke |
| `BURST_INTERJECT_MS` | 15000 | must sit below `BURST_SAMPLE_CEILING_MS` (25s — above that the file's own definition says they are done, so a ceiling up there is dead code) and above two continuation ceilings (10s). Lower-middle of `[10s, 25s]`, biased short: being answered early is a smaller insult than silence |
| `SITTING_GAP_MS` | 4h | `away.ts` treats 10 minutes as the smallest gap worth *remarking* on; a hello is a much bigger act than a remark. Every overnight gap clears it, so "a new day greets fresh" falls out of the constant instead of needing a calendar rule |

### The liveness property

From any message of his with no reply after it at `t0`, a reply cycle starts by
`t0 + BURST_INTERJECT_MS`, for **every** sequence of draft, keystroke, rhythm
and content signals. Three lines make it true and they must not be reordered:

1. the ceiling test is **first** in `burstDecide`, so no later branch can veto it;
2. `firstUnansweredAt` is his *oldest* waiting message and never advances while
   messages are unanswered, so the deadline is fixed rather than sliding;
3. every non-firing return clamps `recheckMs` to the time left to that deadline,
   so the surface's timer is guaranteed to wake at it.

Checked adversarially in `evals/burst.mjs` §4 by a driver that sleeps exactly
the `recheckMs` it is handed and tries to stall her with endless typing,
repeated `likelyMore` bait and a sliding `lastUserAt` — and, since WS-BREATH,
with a composer focused forever, a keyboard that never closes, focus/keyboard
flapping on every tick, and a draft whose LENGTH is chosen adversarially
against the pause budget. `evals/burstgrid.mjs` re-proves it as property P2 on
all 484 cells; `evals/burst-timing-browser.mjs` §7 measures it in the browser
with focus, keyboard and a live draft all held open at once (15.89s, ceiling
15.0s plus her delivery beats).

The freshness gate is part of this proof and not a detail: `lastEngagedAt` is
advanced only by a real event (focus, keyboard-open, keystroke) and only counts
when it postdates his last message, so an adversary who holds focus open
forever buys ONE hold rather than an endless one — and, in the other direction,
the focus every send leaves behind cannot put a six-second floor under every
turn.

The mirror failure — a flag wedged closed so she never speaks again, which this
repo has already shipped once (`rejected.md#busy-held-across-recursion`) — is
prevented structurally rather than carefully: `replyCycle` takes the flags once
and releases them in a `finally`, `replyPass` never releases anything at all,
and the chain is a bounded loop rather than a recursion. `evals/burstwiring.mjs`
asserts all three against the source text, because a missing release is
invisible in a diff that contains no releases.

---

## The case space

`B` = `evals/burst.mjs`, `G` = `evals/greeting.mjs`, `W` = `evals/burstwiring.mjs`,
`X` = `evals/burst-browser.mjs`, `GR` = `evals/burstgrid.mjs` (the property grid,
484 cells), `TB` = `evals/burst-timing-browser.mjs` (the felt numbers).

### His timing

| # | case | what happens now | mechanism | checked |
|---|---|---|---|---|
| 1 | **one message, nothing else** | unchanged from before any of this: the shipped default wait | M1 | B "an ordinary single message is answered at the default wait" |
| 2 | **rapid fragments** — six in four seconds | the wait floors at his own rhythm; each new fragment re-arms it; one reply to all of them | M1 | B "fast typist is answered on rhythm"; X §6 four fragments → one reply, one call |
| 3 | **slow deliberate multi-part** — a fragment every few seconds | the wait scales with HIS median gap, not a constant, so the deliberate typist is not punished for being deliberate | M1 | B "deliberate typist clamps to MAX", "slow deliberate trickle" |
| 4 | **fragment, then a long typed message** | the composing hold: while his draft is alive she does not answer the fragment | M2 | X §2 — zero messages across a 6s live draft, then one reply covering both |
| 5 | **a draft he abandons** | released at 10s of stillness; she answers what he actually sent | M2 | B "an ABANDONED draft releases the hold" |
| 6 | **he types forever** | at 15s she answers what exists — the human "replying to your first messages while you type the rest". Not a special interim lane: it is an ordinary reply to a partial burst | M4 | B "at the ceiling she fires no matter what"; X §5, measured 15.9s |
| 7 | **a fragment that is obviously not finished** — "hello", "wait", "1 sec", "1)" | the wait extends by a bounded bonus, ceiling 5s | M3 | B 22 strong cases |
| 8 | **a sentence that stops on a hinge** — "…gaya aur", "matlab", trailing comma | smaller bonus, same ceiling | M3 | B 11 weak cases |
| 9 | **a finished turn that merely LOOKS unfinished** — "haan" to a yes/no question, "wait for me", "1000 rupay", "matlab?" | nothing extends. This is the case the design is most afraid of: a false positive costs dead air on ordinary sentences, which happens far more often than a split burst | M3 | B 22 negative cases, listed first on purpose |
| 10 | **"hello??"** — him checking whether she is there | the fastest reply in the product: explicitly excluded from both the continuation bonus and the greeting strip | M3, M6 | B "hello?? is him checking"; G "check-in flagged" |
| 11a | **a COMPLETE-looking sentence, then a think-pause** — "U can call me", then he reaches for the keyboard | the breath. Every message gets one, floored at 2.6s and extended by how often he doubles. THIS IS THE ROW THAT DID NOT EXIST, and its absence is the whole of WS-BREATH | M1 | GR P1 over every shape×follower cell; TB §1 (silent through the reach at 2.0s and through the whole message he types) |
| 11b | **the composer focused, or the keyboard up, and not one key pressed** | held like typing, released at `FOCUS_HOLD_MS`. Before WS-BREATH this was byte-identical to a phone face-down on a table (measured: 2.13s either way) | M2 | B "an empty box he is sitting in is NOT nothing"; TB §3 (6.71s), §4 (viewport collapse only, 6.78s) |
| 11c | **typed a few characters and stopped** | the pause budget scales with the draft: 3.5s for one character, 10s for a sentence. It replaced a flat 10s that measured 13.31s of felt silence for a four-character draft | M2 | B `draftPauseMs` cases; GR P6; TB §5 (4.67s, was 13.31s) |
| 11d | **he handed her the floor** — "kya kar rahi ho?", "tum batao" | the ONLY thing that shortens the breath, back to the pre-WS-BREATH 1.3s. A question muttered at nobody ("1000 rupay?") is not a handoff and keeps the full breath | M9 | B `handedOver` positives and negatives; GR P5; TB §6 (2.19s) |
| 11 | **a stale unanswered message, then a new one days later** | the tail is bounded to one burst at 25s, so the ancient message does not become the burst's first and collapse the ceiling to zero | M4 | B "the stale-tail bug"; X §9 |

### His content

| # | case | what happens now | mechanism | checked |
|---|---|---|---|---|
| 12 | **topic switch mid-burst** — a cancelled plan and an unrelated question | both reach the model inside one user turn, each with its own clock stamp; her brief already allows 2–3 bubbles, so one reply can address both | M5 | G "a topic-switch burst presents BOTH topics" |
| 13 | **correction mid-burst** — "chalo kal", "wait no", "parso" | all three in one turn, in order, so she answers the corrected version rather than the retracted one | M5 | X §7 |
| 14 | **question then something unrelated** | same merge; she answers as one thought, which is what the brief already asks for | M5 | X §6/§7 (multi-fragment merge) |
| 15 | **a photo or voice note inside the burst** | counts as waiting (it delays her) but is never read as a text cue | M3 | B "a photo counts as waiting but is not read as a cue" |
| 16 | **a burst that is only a greeting** | strongest continuation signal there is; and if she has already greeted this sitting, her greeting back is removed | M3, M6 | B "greeting-fragment"; G the owner's three-turn sequence |

### Bursts that collide with her

| # | case | what happens now | mechanism | checked |
|---|---|---|---|---|
| 17 | **landing mid-generation** | the answer that comes back is for a question he has moved past: thrown away unread, chain re-reads everything and goes round through the burst clock (so it waits again if he is still typing) | M7 + M2 | X §3 — the stale answer never reaches the screen, one reply, both messages in the re-read |
| 18 | **landing mid-delivery, between her bubbles** | she finishes her burst, then follows up — the way a person does when a message arrives while they are typing | M8 | X §4 — her three bubbles survive and a second reply follows; exactly two model calls |
| 19 | **landing during her proactive opener** | the opener still arrives, then the burst gets its own reply; the crossed order (his messages timestamped before her opener) is what the model sees, correctly | M8 | X §8 |
| 20 | **landing right after reload** | no rhythm in memory beyond what is persisted, so the default wait applies; no opener, because the thread is not empty | M1 | X §9 |
| 21 | **landing during the typing-hold** | the hold is re-evaluated on every tick, so a message he actually sends immediately re-arms the wait from the new message | M2 | X §2 |
| 22 | **landing during an interjection's delivery** | this is case 18 by another name — the interjection is an ordinary reply, so the ordinary follow-up path covers it | M4 + M8 | X §4 (same code path) |
| 23 | **the chat is cleared mid-burst** | the armed timer, the chain timer and `dirty` all die with the conversation that armed them | — | W "a cleared chat cancels an armed burst" |
| 24 | **a call starts mid-burst** | every waiter checks `inCallRef` and stops; spoken timing is a different clock and never feeds the rhythm | M1 | B "call turns are excluded"; W (both waiters stop) |

### Greeting

| # | case | what happens now | mechanism | checked |
|---|---|---|---|---|
| 25 | **her first message of a sitting** | greets, untouched | M6 | G "her first message of a sitting greets" |
| 26 | **her second hello in the same sitting** | the leading greeting is stripped and the sentence survives; a greeting-only bubble is dropped | M6 | G the owner's sequence, turns 2 and 3; X §1 |
| 27 | **a new sitting (4h+, or a new day)** | greets fresh — the come-back beat in her brief depends on this and must never be suppressed | M6 | G "a new sitting greets fresh" |
| 28 | **"hello?? tum ho na"** — her checking in | untouched; stripping it would turn a worried nudge into a non sequitur | M6 | G "her check-in survives" |
| 29 | **a greeting mid-sentence** — "chal hey listen" | untouched, by anchoring at `^` rather than by a rule | M6 | G "a mid-sentence greeting survives" |
| 30 | **his greetings** | irrelevant; he may say hello as often as he likes, and mirroring it is the behaviour being removed | M6 | G "his greetings are irrelevant" |
| 31 | **her whole reply is a greeting and she has already greeted** | one bubble is kept as written and the turn is flagged `degraded`. A duplicated hello is a blemish; an empty reply is a broken product | M6 | G "all-greeting reply is never emptied" |
| 32 | **a spoken hello on a call** | not touched at all — text lane only, the same boundary the dash strip uses | M6 | W "text lane only" |

---

---

## Why it came back — the WS-BREATH post-mortem

The owner reported this defect for the third time: *"she replies too fast. She
won't let me type one, two messages… doesn't give me room to breathe"*, and
*"this feedback I have given some time back also… I don't know why it keeps
happening."* Everything in the tables above had shipped and none of it was
broken. Four things were true at once, and the third and fourth are the ones
worth remembering.

**1. The polarity was wrong, and every wave preserved it.** All three signals
in the shipped system need EVIDENCE: `likelyMore` needs unfinished words, the
composing hold needs a keystroke, `burstWaitMs` needs a rhythm. A complete-
looking sentence with an empty box and no history has none of the three, so it
got `BURST_DEFAULT_MS` — 1300ms — and nothing else. Measured in the browser
against the built app: she fired at **2.05s** whether he started typing at 2s,
4s or 8s, and at **2.17s** when he never typed at all. There was never a race
to lose; the reply was committed before his hand reached the keyboard. Humans
follow complete sentences with more sentences all the time, and no amount of
tuning a signal that does not fire can fix a default that is too short.

**2. Presence was invisible.** `burstDecide`'s hold read `draftLength > 0 &&
lastKeyAt > 0` and nothing else. `Chat.tsx` had an `onFocus` (wired only to
telemetry), no `onBlur` at all, and a `visualViewport` listener already
running for scroll pinning — the keyboard-open signal was ARRIVING and nothing
downstream of it knew what it meant. Measured: focused, keyboard up, zero
keystrokes → 2.13s, identical to a phone lying face-down.

**3. The hold had two settings and nothing between them.** 1.3s with an empty
box; 13.3s of felt silence for a four-character draft, because the abandon
budget was flat. Neither is a thing a person does.

**4. THE INSTRUMENT WAS DEAD AND SAID NOTHING.** `evals/burst-browser.mjs` —
the only thing in the repo that measures FELT burst timing — navigated to
`${B}/chat`. After the home-surface wave landed, `App.tsx` picks its surface
from `location.hash + location.search` only, so the built app boots to
`data-surface="home"` with the thread rendered but `inert`. `waitForSelector(".msg.her")`
still passed (the bubbles are in the DOM behind the home screen) and then every
`send()` timed out on `home.chat` intercepting the click. Because this battery
is deliberately outside `verify-release` — it needs a built app on a port —
nothing anywhere went red. So the third recurrence shipped, and lived, entirely
unmeasured. Two fixes: the entry is `#chat` now, and the numbers this file
existed to produce have their own suite (`burst-timing-browser.mjs`) that
prints every measured millisecond.

**What the Android suspicion turned out to be.** The obvious hypothesis was an
event gap — that the WebView does not deliver the compose events the hold
listens to. It is FALSE and was tested rather than assumed: an Android-shaped
IME commit (a native value set plus an `input` event, with no `keydown`
anywhere) holds her indefinitely, because `onChange` was already the wire and
`onKeyDown` was only the belt to its braces. The real Android gap was the same
as the web one — nothing read the keyboard — and it is fixed by reading the
viewport collapse, which is the only keyboard signal a Capacitor build without
the Keyboard plugin has.

**The structural answer.** Three waves fixed the shapes each wave could think
of, and the shape that recurred is the most ordinary cell in the space. So the
answer to "there will be thousands of cases" is a GRID, not another patch:
`evals/burstgrid.mjs` sweeps first-message shape × follow-up timing × device
shape × his rhythm (484 cells) and checks seven properties on every one of
them — never cut him off, liveness, the floor, no dead air, handoff stays fast,
the think-pause is not a cliff, and web/Android parity. A property holds on
cells nobody thought of, which is the only kind of coverage this feature has
ever actually needed.

---

## Findings from building this

**`toTurns` was already correct.** The suspicion was that a burst reached the
model as several user turns, or that only the last message was emphasised.
Neither is true: `toTurns` has merged consecutive same-role messages into one
newline-joined turn, keeping each message's clock stamp, since before this work,
and `latestUserText` in the compiler is only a *gate* — it is never rendered as
emphasised text. What was wrong was one rung down: `latest` — the string that
feeds the recall query, her taste pull, the culture note and the **read beat** —
was `lastUserText()`, the final fragment alone. So a burst of "kal ka plan cancel
ho gaya" / "ab kya karein" looked up memories for "ab kya karein", and she spent
as long reading three messages as one. That is now `lastUserBurstText()`.

The merge is now pinned by a test, which it was not before. An un-merged shape
would have been invisible in the product — she would simply have seemed to
ignore half of what he said.

**The stale-tail bug was found by the browser battery, not by reasoning.** The
first version walked backwards over every consecutive message of his. On a
thread ending in a message she never answered, that made an ancient "hi" the
burst's first message, its 15s deadline was long past, and she interjected
instantly — the entire hold collapsing to zero on exactly the threads where a
second thought is most likely. It passed every pure test. Row 11.

**Not done, and it should be:** `api/_surface.js`'s `gateReply` is the same
choke point for Telegram, WhatsApp and Discord, and it does not call
`greetOnce`. Those surfaces will still greet twice. `greeting.ts` is pure and
import-free precisely so that wiring is a one-line change; it was out of this
workstream's file ownership. The burst *timing* mechanisms are engine-side
already, so any surface that runs a timer gets them by calling `burstDecide`.
