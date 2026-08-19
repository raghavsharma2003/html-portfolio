# Continuity — one conversation, four channels, no seam

The owner's directive, verbatim:

> the continuity should be handled perfectly from text and then call and then
> lets say the text then call with screen share — everything should function in
> continuity like human so that there are no gaps at all and no inconsistency.

This document names every seam between channels, measured against the code
rather than guessed, and specifies the fix for each. It is written after the
Phase E2 self layer landed, so "continuity" now has more to carry than it did:
texture, arc and untold life are per-relationship state that a channel change
must not drop.

---

## 0. The finding

The call lane does not use the compiler.

`src/components/useCallEngine.ts` hand-assembles its prompt as
`buildSystemPromptParts(...) + buildSpeechStyle("live") + parts.tail`. It never
calls `compile()`. `src/engine/brain.ts:747` then makes it explicit on the
other side:

```ts
const relBundle =
  mode === "call" || isDirective || !keys.deviceId ? null : takeRelBundle(keys.deviceId);
```

The comment above that line is honest about what it is: a **scope deferral**,
not a decision — *"the call lane's memory lookup happens once at pickup in
useCallEngine.ts, outside this function, and is out of scope for this seam
(§13 collision contract — useCallEngine.ts is a different ticket)"*.

That ticket was never picked up. The consequence is the largest continuity hole
in the product, and it is not subtle:

| slot | chat | call |
|---|---|---|
| T2 `rel.snapshot` — honorific, trust, repair | ✅ | ❌ |
| T3 `india.dynamic` — rituals, festivals, currency | ✅ | ❌ |
| T4 `dyadic.active` — her patterns with you | ✅ | ❌ |
| T6 `we.callbacks` — shared episodes, your phrases | ✅ | ❌ |
| T11 `rel.texture` — how she talks to *you* | ✅ | ❌ |
| T12 `self.arc` — how she has changed | ✅ | ❌ |
| T13 `life.untold` — what she hasn't told you | ✅ | ❌ |

**She is structurally a shallower person on the phone**, and the gap widened
with every relational feature shipped since, because each one landed in the
compiler and the call lane does not read the compiler.

This also means there are **two prompt assembly paths** in the repo, which is
precisely the failure `src/engine/serverEntry.ts` was created to prevent one
level up: *"a mirrored persona is a SECOND persona, and it would drift within a
week."* It has drifted. Not in persona text — `buildSystemPromptParts` is
shared — but in everything the compiler adds around it.

---

## 1. The four seams, and what each costs

### Seam 1 — the call lane bypasses the compiler `CRITICAL`

Described above. Everything relational and everything self is missing on a
call.

**Why the latency argument does not hold.** The apparent reason to keep the
call lane thin is `live-floor`: the realtime lane compiles once at pickup and
the reply floor is 1.4–1.5 s. But the bundle fetch does not have to be on that
path. **The ring is free time** — `rejected.md#murmur-timbre` already
established the principle for a different feature: clips should be *"fetched
during the ring where there is already idle time and no call-path cost."* The
same applies here. A relational bundle fetched during the ring costs the call
nothing.

And the compile itself is ~40 ms of pure function over already-fetched state.
The thing that costs 1.4 s is the model, not the assembly.

**Fix.** Route the call lane through `compile({ medium: "voice", … })` with a
`relBundle` and `selfBundle` fetched during the ring. `medium: "voice"` already
exists and is already honoured by the compiler and by `buildSpeechStyle`.

**What must not regress:** the live prompt is frozen at connect (correct, and
load-bearing — a mid-call prompt change is a different person mid-sentence);
the audio floor is untouched; first audio does not move.

### Seam 2 — pickup counts as a gap entry unconditionally `HIGH`

`useCallEngine.ts` injects the carried thread at pickup, reasoning *"a pickup
IS a gap entry"*. That is right when you call after a day. It is wrong when you
were texting her sixty seconds ago: she re-enters a carried feeling she may
have **just voiced in text**, and G5's own rule is that a thread retires
permanently once voiced.

So the failure is not merely a repeat — it is a *retired* thread coming back,
which is the one state the interior model says cannot exist.

**Fix.** Pickup takes the same gap test the chat lane takes, against
`lastMsgAt` across **all** channels. A pickup inside the gap window is a
continuation, not a re-entry: no thread, because there is no gap to re-enter
after. A pickup outside it behaves exactly as today.

### Seam 3 — a channel change opens a new episode `MEDIUM, partly correct`

`api/episodes.js` boundaries on channel change: text → call ends one episode
and opens another. For *segmentation* this is right — an episode is a stretch
of talk on one channel, and the WE-classifier and citation spans depend on it.

What needs checking rather than assuming: whether anything user-visible reads
the boundary as "a new conversation". `gapSinceLastMs` is computed from the
shared message store, so it is already cross-channel; if that holds, the felt
continuity is fine and only the storage is split. **The build must verify this
rather than take this paragraph's word for it**, and if a re-greeting or a
lost thread does occur at the boundary, fix the *reader*, not the segmentation.

### Seam 4 — screen share requires a call `LOW, product constraint`

`brain.ts:725`: `const watching = Boolean(watchFrame) && mode === "call"`.
Screen share only exists inside a call. That is a coherent product decision
(watching together is a synchronous act) and this document does not propose
changing it — it records it so nobody reads its absence from text mode as a
bug.

---

## 2. The rule this all serves

**A channel is a transport, not a relationship.** The same law Phase E applied
to surfaces — Telegram and web are the same relationship because a surface is a
phone line, not a different friend — applies one level down to channels. Text,
call and watch are three ways of being in one conversation.

Concretely, three invariants:

1. **State is channel-blind.** Everything derived reads the same rows on every
   channel. Only *rendering* differs: `medium: "voice"` shortens her, it does
   not make her forget.
2. **The interior does not restart on a channel change.** The carried thread,
   the rupture state and the repair arc survive a switch; they are properties
   of the relationship, not of the socket.
3. **Nothing is said twice across a boundary.** A thread voiced in text is
   retired for the call. A life beat told on a call is told, and the anti-join
   in T13 already handles that — provided `markTold` fires from the call lane
   too, which it currently cannot, because the call lane has no T13.

---

## 3. Gates

| gate | bar |
|---|---|
| G-C1 call parity | every relational and self slot that renders in chat renders on a call for the same person and turn |
| G-C2 latency | first audio does not regress against the measured 1.4–1.5 s floor; bundle fetch completes inside the ring |
| G-C3 no double-voicing | a thread voiced in text is not re-entered at a pickup inside the gap window, n≥20 scripted switches |
| G-C4 frozen prompt | the live prompt is still assembled exactly once, at connect |
| G-C5 byte-identity | 83/83 — the chat lane must not move |
| G-C6 one assembly path | no second hand-assembled prompt survives; the call lane's system string comes from `compile()` |
| G-C7 register | voice-medium word count and question rate stay inside their measured bands — adding seven slots must not make her longer on a call |

G-C7 is the one to watch. `realtime-azure` was declined at 41–53 words/turn
against her 20.5, and `brain-model` declined a model at 36.1. Adding relational
context to the call lane is exactly the kind of change that could push her
long, and the whole point of the voice medium is that she is *shorter* on the
phone, not better-informed and more verbose.

---

## 4. What this does not do

- **Does not change the audio floor.** `liveCall.ts` is the most delicate code
  in the repo and nothing here touches it.
- **Does not unfreeze the live prompt.** Compiled once, at connect, unchanged.
- **Does not merge episodes across channels.** Segmentation stays; only the
  readers are examined.
- **Does not add a new tail slot.** Everything needed already exists; the call
  lane simply has to read it.

---

## 5. Reversal conditions

- **Seam 1's fix reverses if** call-lane parity measurably moves her voice
  register out of band (G-C7) and cannot be brought back by the medium
  parameter alone — in which case the call lane takes a *subset* of slots,
  chosen by measurement, rather than all of them, and the subset is logged.
- **Seam 2's fix reverses if** the gap test makes pickups feel cold — i.e. the
  thread is the thing that made a pickup feel like being known, and suppressing
  it on a warm pickup costs more than the double-voicing it prevents. That is
  an ear judgment, and the owner's ear has overruled measurement before on
  exactly this kind of question.
