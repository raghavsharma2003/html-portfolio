# Audit: games + state integrity (2026-08-22, opus, measured)

I have what I need. Here is the audit.

---

**SEVERITY:** HIGH
**TITLE:** Tic-tac-toe is single-use — there is no rematch control anywhere, so the finished board is a dead end
**WHERE:** `/home/user/html-portfolio/src/components/TicTacToeActivity.tsx:242-253` (no `footer` prop) and `:121-128` (entry effect); contrast `/home/user/html-portfolio/src/components/ChessActivity.tsx:251-257`, `:259`, `:274-279`
**EVIDENCE:** `ChessActivity` passes a `footer` containing `newGame_` (`showNew = Boolean(over || session?.closedAt)`). `TicTacToeActivity` passes no `footer` at all — `grep -n "footer" src/components/*Activity.tsx` returns only `ChessActivity.tsx:267` and `WouldYouRatherActivity.tsx:219`. The entry effect is `if (session) return;` (`:122`) with an inner guard `s.game ? s : {…newTttGame()…}` (`:124-127`), and `session` is `state.game?.kind === "ttt" ? state.game : null` (`:115`) — truthy for a *closed* session too. `exit` (`:204-207`) only nulls the slot when `!s.game.game.played.length`. No other writer resets a ttt session: `grep -rn closedAt src/` shows the only ttt writer is the auto-close at `:186-200`.
**SYMPTOM:** He plays one round of tic-tac-toe. It ends. Re-opening the row from GamesHub renders the finished board — the same three-in-a-row, `legalCells` empty, no button — forever. The only escape is to open Chess and press *its* "New game" (which overwrites the shared `AppState.game` slot), or to clear the chat. Meanwhile `GamesHub` still lists the row as `ready` with the blurb "Thirty seconds, no thinking required."
**FIX:** Give `TicTacToeActivity` the same `footer` chess has: a "New game" button shown when `over || session?.closedAt`, whose handler replaces the slot with `{ kind: "ttt", game: newTttGame(), herSide: "o", startedAt: Date.now() }`. (Do this *after* fixing the tally-loss below, or the rematch button inherits chess's bug.)

---

**SEVERITY:** HIGH
**TITLE:** "New game" pressed inside the 25 s close window silently drops the finished game from the lifetime tally
**WHERE:** `/home/user/html-portfolio/src/components/ChessActivity.tsx:161-184` (the close/tally effect) against `:251-257` (`newGame_`) and `:259` (`showNew`)
**EVIDENCE:** `showNew = Boolean(over || session?.closedAt)` — the "New game" button appears the instant the game ends, i.e. `CLOSE_AFTER_END_MS = 25_000` (`:48`) *before* the close effect's timer fires. `newGame_` (`:252-257`) unconditionally replaces `s.game` with a fresh session. Two things then both prevent the tally write: the effect's dep array `[over, session, setState]` (`:184`) sees a new `session` with `over === false`, so its cleanup runs `clearTimeout(t)` (`:183`); and even if the timer survived, its updater's guard `if (!(s.game?.kind === "chess" && !s.game.closedAt && s.game.game.status.over)) return s;` (`:165`) fails against the fresh board. The comment at `:166-168` — *"the lifetime tally is written here and nowhere else"* — is exactly why nothing else recovers it.
**SYMPTOM:** The rematch-happy player is the one who gets counted least. Checkmate → tap "New game" (the natural next action, offered immediately) → `chessGames`, `chessWinsHim`, `chessWinsHer` never move. Ten back-to-back games can leave `tally` at zero. Downstream: the Us screen shows no chess row (`UsScreen.tsx:452`, `r.chessGames > 0`), and `detectMoments` never fires `first-game`, `chess-first-win-him`/`-her`, or any `chess-N` tier (`milestones.ts:149-175`) — so the celebration system is silent for the heaviest user of the feature.
**FIX:** Write the tally at the moment the game *becomes over*, not 25 s later. Split the two concerns the effect currently fuses: a `tallied?: true` flag (or a `resultRecordedAt`) written synchronously in the same updater that first observes `status.over`, and keep the 25 s timer for `closedAt` alone. Both stay idempotent under their existing in-updater guards.

---

**SEVERITY:** HIGH
**TITLE:** The close/tally write only exists while a board is mounted — leaving within 25 s leaves the game permanently unclosed and untallied, and with sync it can arrive on another device already `status.over` and never tally anywhere
**WHERE:** `/home/user/html-portfolio/src/components/ChessActivity.tsx:161-184`; `/home/user/html-portfolio/src/components/TicTacToeActivity.tsx:186-200`; `/home/user/html-portfolio/src/state/merge.ts:33-48`; `/home/user/html-portfolio/src/App.tsx:276-302`
**EVIDENCE:** The effect returns a cleanup that clears the 25 s timer, so unmounting the activity (back button, call chip, tab close, app kill) inside the window cancels the only writer. Nothing outside these two components ever sets `closedAt` or increments the tally — verified by `grep -rn "closedAt" src/` (writers: `ChessActivity.tsx:173`, `:247`, `TicTacToeActivity.tsx:194`, `WouldYouRatherActivity.tsx:173` only). On the second device, `mergeGame` (`merge.ts:33-48`) copies the remote session verbatim; the receiving device has no board mounted, so nothing fires there either. `activityOf` bounds only *closed* sessions with `RECENT_END_MS` (`state/game.ts:121`) — an unclosed one is unbounded.

Measured with the real engine and the real `activityOf`/`renderActivity` (`scratchpad/draws.mjs`), a checkmated-but-unclosed session seen two days later renders:

```
YOU TWO JUST FINISHED A GAME OF CHESS — it ended about 2880 min ago. …
- she won, by checkmate
- she is playing white
- she played Qg7#, that ends it
- 1 move in
```

(2880 min is derived from `startedAt`, the game's *start*, because the `closedAt` branch at `state/game.ts:108-135` — the one that re-bases `startedAt` to the close time — never ran.)

Aggravating: the effect's `session` dep is a fresh object identity on every `state.game` change, so a sync merge landing mid-window (`App.tsx:263`, `:290`) restarts the 25 s clock from zero.
**SYMPTOM:** Two distinct failures from one cause. (1) She announces a finished game as just-finished on every single turn, indefinitely, with a nonsense elapsed number — precisely the `never-scheduled` failure the `CLOSE_AFTER_END_MS` comment at `ChessActivity.tsx:38-48` says it exists to prevent. (2) The game is invisible to the record and the milestone detector on every device, permanently, unless he happens to re-open that board.
**FIX:** Same structural fix as above — make the result write a property of the state transition, not of a mounted component. Concretely: an app-level effect (in `App.tsx`, which is always mounted) that observes `state.game?.game.status.over && !state.game.tallied` and writes the tally + `closedAt`, with the activity components keeping only the 25 s *presentation* delay. That also closes the cross-device hole, because the receiving device runs the same always-mounted effect.

---

**SEVERITY:** HIGH
**TITLE:** WYR `avoid` is capped at DECK−8, so a returning player is re-asked cards inside the same sitting — and 1 in 8 sessions deals the same card twice in a row
**WHERE:** `/home/user/html-portfolio/src/engine/wyr/session.ts:103` (`const avoid = carrySeen.slice(-(DECK_IDS.length - 8));`), `:141-152` (`advance`), `/home/user/html-portfolio/src/engine/wyr/pick.ts:87-97` (`nextCardId`)
**EVIDENCE:** The deck is 80 unique cards (`deck.ts`, counted: 80 ids, 80 unique), so the cap is 72. `advance` excludes `[...avoid, ...seen]`; once that set covers the deck, `nextCardId` falls back to `const base = pool.length ? pool : deckIds` (`pick.ts:94`) — the *full* deck, including cards already answered this session and including the current card. For a player who has seen 72+ cards, exhaustion begins at card 9 of every subsequent session.

Simulated against the real modules (`scratchpad/wyrsim2.mjs`, n = 300 salts, each with 20 prior 5-card sessions then one 20-card session):

```
sessions with an in-session repeat within 20 cards: 266 (89%)
mean card # of first repeat:                        13.4
sessions where the SAME card was dealt twice in a row: 35 (11.7%)
```

A single trace (`wyrsim.mjs`) shows `de-keepmemory-losepain` dealt at position 1 and again at position 13 of the same sitting.
**SYMPTOM:** Mid-session she asks a question she asked ten minutes ago — and because `herPick` is a pure function of `(cardId, salt)` (`pick.ts:56-58`), she gives the *identical* answer, word for word. In the 11.7% case, "Next card" visibly does nothing: the same two options re-render. This is the same defect `session.ts:89-97` records having already shipped and fixed once ("same questions are coming"); the cap reintroduced a bounded version of it.
**FIX:** Two independent changes. (a) In `advance`, when the pool is empty, exclude at minimum the current session's `seen` before falling back — `nextCardId` should take a *hard* exclusion (never repeat within this session) separate from the *soft* one (`avoid`). (b) Raise or remove the DECK−8 cap and instead drop the oldest carried ids only when `avoid.length + seen.length` would actually exhaust the deck. The 8-card floor is the wrong knob: it guarantees only the first 8 cards of a session are fresh.

---

**SEVERITY:** HIGH
**TITLE:** Clear-chat and "forget everything" keep `tally` and `momentsFired` — the record contradicts the wipe, and the milestone system is permanently dead afterwards
**WHERE:** `/home/user/html-portfolio/src/components/Chat.tsx:981-1023` (`tearDownLocally`), `:1062-1083` (`undoClear`); `/home/user/html-portfolio/src/components/UsScreen.tsx:269-273`, `:291-309`, `:452-477`; `/home/user/html-portfolio/src/engine/milestones.ts:149-181`; contrast `/home/user/html-portfolio/src/App.tsx:246-257`
**EVIDENCE:** The snapshot (`Chat.tsx:982-989`) captures `messages, herLife, inner, clearedAt, game, callback`. The wipe (`:1002-1021`) clears exactly those. Neither touches `tally` or `momentsFired`. `undoClear` (`:1073-1081`) restores the same six — consistent, because they were never cleared, so there is no clear→undo divergence. The defect is the omission itself.

The teardown comment at `:1009-1018` argues the game had to die because *"a person who claims to have forgotten you while remembering your unfinished match is not forgetting, she is lying about forgetting"* — and `account.ts:114-119` states the standing rule that a new `AppState` field decides its fate at teardown *on the day it is added*. `tally` and `momentsFired` were added to `syncableState` (`account.ts:123-124`) and to `mergeStates` (`merge.ts:58-74`) but never to the teardown. `App.tsx:254-255` resets both on an account switch, so the requirement is understood in one code path and missed in the other.

Two symptoms, and the second is the worse one:
- **Honesty.** `UsScreen` derives `chessGames/chessHim/chessHer/tttGames/wyrCards` straight off `state.tally` (`:269-273`) and renders "12 games of chess" (`:452-457`) plus `chessAside` — "She's ahead, 7 to 5." (`:315-321`) — on a record whose `firstAt` is now today and whose `dayNo` is 1.
- **The ledger.** `detectMoments` suppresses on id membership: `!fired.has("first-game")`, `!fired.has("chess-first-win-him")`, and `latestOnly(TIERS, n, fired, …)` (`milestones.ts:149-181`). Every id already in `momentsFired` is dead forever. A brand-new post-forget relationship can never fire "Your first game together", "You beat her at chess", `days-1`, `msgs-100`, or `calls-1`. Additionally `UsScreen.tsx:300` dates surviving entries as `r.firstAt + N * DAY` — after a wipe that is a **future** timestamp, and `:306` sorts dated entries newest-first, so "One year of you two", dated next year, sits at the top of the timeline.
**FIX:** Add `tally` and `momentsFired` to both the `Snapshot` and the teardown updater in `tearDownLocally`, and to the restore in `undoClear`. Clear them to `null` / `[]`. Then add a line to the teardown-discipline comment naming the rule, the way `account.ts:114-119` does for sync.

---

**SEVERITY:** MEDIUM
**TITLE:** A chess game ended by hand never counts toward `chessGames`, however long it was
**WHERE:** `/home/user/html-portfolio/src/components/ChessActivity.tsx:243-250` (`endGame`), `:161-184` (the only tally writer)
**EVIDENCE:** `endGame` writes `closedAt` and `endedEarly` directly into the session and touches `tally` not at all. The auto-close effect is gated `if (!over || !session || session.closedAt) return;` (`:162`) — for an early end `over` is false, so it was never armed; and `showEnd` requires `!over` (`:258`), so the button is only reachable on a live position. Nothing recovers it afterwards: the effect's inner guard requires `s.game.game.status.over` (`:165`).
**SYMPTOM:** Two people play forty moves, he taps "End game" because dinner is ready, and as far as the record and the milestone detector are concerned they never played. `UsScreen`'s "12 games of chess" undercounts by every abandoned game; `first-game` may never fire for someone who never finishes one.
**FIX (with the decision):** An early-ended game **should** count in `chessGames` and must **not** touch `chessWinsHim`/`chessWinsHer` — the two facts are already distinguished by `endedEarly` (`state/game.ts:68-74`) and `chessActivity` correctly refuses to name a winner. Gate it on real play rather than on a tap: increment `chessGames` when `s.game.game.played.length >= 10` (five moves each — past the opening, past a mis-tap, and the same order of magnitude as the `showEnd` guard's existing `played.length > 0`). Below that threshold, treat it as the mis-tap the `exit` handler at `:189-192` already treats it as.

---

**SEVERITY:** MEDIUM
**TITLE:** `tttActivity` never sets `over`, so a finished-but-unclosed ttt game is rendered as in-progress while its own facts announce the winner
**WHERE:** `/home/user/html-portfolio/src/engine/tttTalk.ts:124-130` against `/home/user/html-portfolio/src/engine/chessTalk.ts:482-489`
**EVIDENCE:** `chessActivity` returns `over: Boolean(game.status?.over)`; `tttActivity` returns only `kind, startedAt, facts, nameable, waitingOnHer`. `activityOf` forces `over: true` only inside the `s.closedAt` branch (`state/game.ts:135`); the live branch at `:138` passes `tttActivity` through untouched. `renderActivity` (`activity.ts:107-113`) and `activityPickupLine` (`state/game.ts:162-164`) both branch on `a.over`.
**SYMPTOM:** During the 25 s window — and permanently in the unclosed case above — she is handed `RIGHT NOW YOU TWO ARE IN THE MIDDLE OF A GAME OF TIC TAC TOE — 4320 min in` immediately followed by the fact `- he won that one`. A single prompt block contradicting itself, on the lane where she has to speak from it.
**FIX:** `over: game.status.over` in `tttActivity`'s return. One line, and it makes the ttt adapter honour the same contract `ActivityState.over` documents at `activity.ts:73-81`.

---

**SEVERITY:** MEDIUM
**TITLE:** The call chip is a second exit route that bypasses every activity's `exit`, so WYR's `closedAt` is never written and an empty chess/ttt board is never discarded
**WHERE:** `/home/user/html-portfolio/src/App.tsx:425`, `:442`, `:458` (`onOpenCall={() => setActivity(null)}`); `/home/user/html-portfolio/src/components/ActivityShell.tsx:203-211`; `/home/user/html-portfolio/src/components/WouldYouRatherActivity.tsx:169-176`; `ChessActivity.tsx:189-192`; `TicTacToeActivity.tsx:204-207`
**EVIDENCE:** `ActivityShell` calls `onExit` from the back button (`:160`) and from Escape-outside-the-stage (`:132-136`); it calls `call.onOpen` from the live-call chip (`:209`). App wires `onOpenCall` straight to `setActivity(null)` — the component unmounts without its `exit` callback ever running. The WYR close is *only* in `exit` (`:169-176`); the "an opened board with no moves is not a game" discard is *only* in chess's and ttt's `exit`.

To be clear on what the brief asked: the WYR exit handler **is** correct — `:173` reads `game: isEmpty(cur) ? null : asGameSession({ ...cur, closedAt: Date.now() })`, and `isEmpty` is `rounds.length === 0` (`session.ts:163-165`), so ≥1 answered card does set `closedAt`. It is the *route* that is missing, not the handler.
**SYMPTOM:** He is on a call, playing would-you-rather, and taps the chip to go back to the call screen — the single most likely exit on this surface, since the feature exists for playing while she talks. The session stays open with no terminal state and no staleness bound, so she carries "you two are in the middle of a round of would-you-rather right now" indefinitely. On the chess/ttt side, opening a board and leaving via the chip leaves her convinced they are mid-match on an empty board, and `GamesHub` tags the row `resume — your move`.
**FIX:** Have the components own their teardown regardless of route: move the body of each `exit` into an unmount cleanup (`useEffect(() => () => { … }, [])` reading the latest state through a ref), and let `onExit`/`onOpenCall` both just unmount. That is route-proof, where adding a call to `exit` at each of App's three call sites is not.

---

**SEVERITY:** MEDIUM
**TITLE:** The sync effect's dependency list omits `game`, `tally` and `momentsFired` — the exact three fields `merge.ts` was written to carry
**WHERE:** `/home/user/html-portfolio/src/App.tsx:276-302`, dep array at `:302`; `/home/user/html-portfolio/src/engine/account.ts:104-127`
**EVIDENCE:** The array is `[state.messages.length, state.user, state.onboarded, state.auth?.accessToken, state.inner?.at]`. `saveStateRemote` has exactly one call site (`:285`) — `grep -rn "saveStateRemote|beforeunload" src/` confirms no unload or visibility push. `syncableState` sends `game`, `tally` and `momentsFired` (`account.ts:122-124`) and `mergeStates` merges all three (`merge.ts:60-74`), but no change to any of them can schedule the push. The comment at `App.tsx:300-301` documents adding `state.inner?.at` for precisely this reason and stops there — while `merge.ts:1-10` opens by recording that the previous instance of this drift ("the push list predated the fields") is what made half the merge dead code.
**SYMPTOM:** A complete chess game — forty moves, the close, the tally write — produces zero sync pushes, because none of them changes `messages.length`. If he closes the tab without sending another message, the game and its tally never leave the device. On the second device: no game, no record, and (per the finding above) no way for the tally to be reconstructed there either.
**FIX:** Add a progress projection to the deps rather than the objects themselves, so it does not fire on every unrelated write — e.g. a `gameSig` memo of `[kind, startedAt, closedAt, progress].join("|")` plus `state.momentsFired?.length` and a `tally` signature. Then extend the module's eval to assert dep-list coverage against `syncableState`'s key list, which is the thing that would have caught both instances.

---

**SEVERITY:** MEDIUM
**TITLE:** `loadState` discards the entire state on any parse or migration failure, then immediately overwrites the blob with defaults
**WHERE:** `/home/user/html-portfolio/src/state/store.ts:198-208` (`loadState`), `:175-196` (`migrateMessages`), `:240-242` (`useEffect(() => saveState(state), [state])`)
**EVIDENCE:** The whole body is inside one `try`, and the `catch` returns `{ ...defaultState }` (`:206`) with no telemetry and no preservation of the original bytes. `parsed.messages = migrateMessages(parsed.messages)` (`:203`) is *inside* that try and is unguarded — any non-array `messages` throws on `.map`, and any `null` entry throws on `m.kind`. `useAppState` then persists the defaults on mount, so the corrupt (and possibly partially recoverable) blob is gone on the first render.

Measured against a replica of the real functions (`scratchpad/load.mjs`):

```
truncated blob             onboarded=false  msgs=0   <-- ENTIRE STATE SILENTLY DISCARDED
messages: null             onboarded=false  msgs=0   <-- ENTIRE STATE SILENTLY DISCARDED
messages: object           onboarded=false  msgs=0   <-- ENTIRE STATE SILENTLY DISCARDED
messages has null entry    onboarded=false  msgs=0   <-- ENTIRE STATE SILENTLY DISCARDED
```

Three of those four have a perfectly good `onboarded`, `user`, `tally` and `momentsFired` sitting in the parsed object.
**SYMPTOM:** One bad byte and the user is dropped into Onboarding with an empty conversation, no explanation, and no second chance — the anonymous-device case has no server copy to restore from (`deviceId` survives under its own key by `:135-145`, but the state does not). No event reaches `track`, so this is invisible in analytics.
**FIX:** Narrow the recovery. Guard the migration independently — `parsed.messages = Array.isArray(parsed.messages) ? migrateMessages(parsed.messages).filter(Boolean) : []` — so a bad message list costs the message list and nothing else. In the outer `catch`, copy the raw string to `meera.state.v1.broken` before returning defaults, and fire a `track(…, "state_corrupt", …)`.

---

**SEVERITY:** MEDIUM
**TITLE:** `game` is the one `AppState` field accepted unvalidated from the network and dereferenced deeply — inside a `setState` updater, with no error boundary in the tree
**WHERE:** `/home/user/html-portfolio/src/state/merge.ts:28-31` (`progressOf`), `:91`; `/home/user/html-portfolio/src/App.tsx:253`, `:263`, `:290`; `/home/user/html-portfolio/src/engine/chessTalk.ts:415`
**EVIDENCE:** Every other field in `mergeStates` is defensively coerced — `Number(remote?.clearedAt) || 0`, `Array.isArray(remote?.messages) ? … : []`, `Number(rt.chessGames) || 0`. `game` is not: `mergeGame(local.game, remote?.game)` (`:91`) reaches `g.game.played.length` through `progressOf` (`:30`) with no shape check, and `App.tsx:253` assigns `r?.game as AppState["game"]` with a bare cast. `chessActivity` reads `game.played.length` unguarded at `chessTalk.ts:415` (only `lastAssessment` has a `try`/`catch`, `state/game.ts:88-93`). `grep -rn "ErrorBoundary|componentDidCatch|getDerivedStateFromError" src/` returns nothing.

Reproduced (`scratchpad/load.mjs`) with a session that survives `loadState` intact:

```
survivor game: {"kind":"chess","startedAt":1,"herSide":"b"}
chessActivity(game.played.length) -> TypeError: Cannot read properties of undefined (reading 'played')
merge.ts progressOf()             -> TypeError: Cannot read properties of undefined (reading 'played')
```

`mergeStates` is invoked from inside `setState` updaters (`App.tsx:263`, `:290`), which React runs during render — an uncaught throw there unmounts the tree.
**SYMPTOM:** A malformed `game` from a schema change, a partial write, or a truncated sync payload takes the whole app to a blank screen on every load, and because the bad object is persisted locally the blank screen survives reloads. Lower-blast-radius variants throw inside `brainKeys()` (`Chat.tsx:243`) killing a send, or inside the call-connect compile (`useCallEngine.ts:670`) killing a pickup.
**FIX:** One `isGameSession(g): g is GameSession` narrowing predicate in `state/game.ts`, applied at the two boundaries where a `game` enters from outside: `loadState` and `mergeStates`/`adoptSession`. Anything that fails it becomes `null`. Give `merge.ts`'s eval a corrupt-payload case, since that module exists to keep this class of drift caught.

---

**SEVERITY:** LOW
**TITLE:** The `endedEarly` "no result" row is emitted last, and `renderActivity` drops from the end — 19 bytes of margin protect the one fact that stops her inventing a winner
**WHERE:** `/home/user/html-portfolio/src/state/game.ts:129-135`; `/home/user/html-portfolio/src/engine/activity.ts:114-128`
**EVIDENCE:** `activityOf` appends `"he ended the game early, no result"` to the *end* of the filtered fact list (`:133`). `renderActivity` pops rows off the end while over `ACTIVITY_BUDGET = 420` (`activity.ts:125-128`), and its own comment states the policy the emitters must honour: *"Facts are therefore emitted least-important-last."* This row is the most important one in the block — `state/game.ts:70-74` says conflating the two endings *"would have her gloating over a game nobody won."*

Measured (`scratchpad/early2.mjs`, n = 399 ended-early positions inside `OPENING_FACT_PLY`): largest rendered block **401 bytes against a 420 budget**, and **0 cases** where the row was actually dropped. So this is latent, not live — but the margin is 19 bytes, and the header alone is 225.
**SYMPTOM:** None today. One extra threat fact, one longer opening name, or any future widening of the header and she is handed "YOU TWO JUST FINISHED A GAME OF CHESS" over a fact list ending in "she played Qxf7+, a bad one" with nothing saying nobody won.
**FIX:** Insert the row at index 0 of the filtered list rather than appending it. It is the head fact of an ended-early game, exactly as "she won, by checkmate" is the head fact of a finished one (`chessTalk.ts:425-434`).

---

**SEVERITY:** LOW
**TITLE:** All four non-checkmate terminals collapse to one phrase, so she can never say *how* a game drew
**WHERE:** `/home/user/html-portfolio/src/engine/chessTalk.ts:425-434`
**EVIDENCE:** `if (r === "checkmate") { … } else { facts.push("it ended in a draw"); }` — the `else` swallows `stalemate`, `insufficient_material`, `threefold_repetition` and `fifty_move`, all four of which `types.ts:36-42` declares separately and `board.ts:55-67` detects separately. Verified end-to-end with the real engine (`scratchpad/draws.mjs`, `draws2.mjs`):

```
stalemate               result: stalemate              over: true   "it ended in a draw"
insufficient material   result: insufficient_material  over: true   "it ended in a draw"
threefold repetition    result: threefold_repetition   over: true   "it ended in a draw"
fifty-move              result: fifty_move             over: true   "it ended in a draw"
```
**SYMPTOM:** Correct but flat. A stalemate he walked into and a fifty-move grind are different stories to a person, and she has no way to tell them apart — including the case where *she* was stalemated with a winning position, which is the one a real player would actually have something to say about.
**FIX:** Map the four results to four short third-person facts ("nobody could move, stalemate" / "not enough left to mate" / "same position three times" / "fifty moves, no pawn, no capture"). This is `chessTalk.ts`'s job by charter — the enums are already there and no other file changes.

---

**SEVERITY:** LOW
**TITLE:** GamesHub offers "resume — your move" on a finished board
**WHERE:** `/home/user/html-portfolio/src/App.tsx:385-393` (chess), `:394-404` (ttt)
**EVIDENCE:** The `resume` tag is gated on `state.game?.kind === "chess" && !state.game.closedAt` and the detail on `state.game.game.status.turn === state.game.herSide ? "her move" : "your move"`. `status.turn` remains meaningful after `over` by design (`ttt/types.ts:16-17`, `chess/types.ts:51-52`), and `closedAt` is unset for the whole 25 s window — and permanently in the unclosed case above.
**SYMPTOM:** The hub row reads "Chess — your move · resume" on a board where he has been checkmated.
**FIX:** Add `&& !state.game.game.status.over` to both `resume` conditions. Falls away on its own once the close is no longer component-scoped.

---

**SEVERITY:** LOW
**TITLE:** `saveState` gives up silently after its four-step ladder
**WHERE:** `/home/user/html-portfolio/src/state/store.ts:223-238`
**EVIDENCE:** Five `catch` blocks, all empty but for a comment; after `keep = 50` fails the function simply returns. No telemetry, no in-memory flag, no signal to the caller.
**SYMPTOM:** Under sustained quota pressure the app stops persisting and behaves normally until the next reload, when the session silently reverts to the last successful write. Low likelihood given the headroom measured below, but the failure is invisible when it happens.
**FIX:** `track(…, "state_persist_failed", { keep })` on final failure, and set a module flag the settings sheet can surface.

---

**SEVERITY:** INFO (measurement)
**TITLE:** Serialized `AppState` is ~4% of a 5 MB quota — but `state/game.ts`'s "about 1KB at move 40" understates a chess session by ~35×
**WHERE:** `/home/user/html-portfolio/src/state/game.ts:22-26`; `/home/user/html-portfolio/src/state/store.ts:212-238`; `/home/user/html-portfolio/src/engine/chess/types.ts:73-79`
**EVIDENCE:** Two measurements. First, a synthetic 500-message history (realistic mix: quote-replies, callmarks, voice notes, photos with vision `desc` and storage URLs, reactions, call-channel turns) plus an 80-ply chess session plus a 19-entry `momentsFired` and a full `tally` (`scratchpad/size.mjs`):

```
messages(500)        70.7 KB utf8 | 141.1 KB utf16
chess game(80 ply)   36.4 KB utf8 |  72.7 KB utf16
  .played            31.2 KB
  .positions          4.9 KB
momentsFired(19)      0.2 KB
tally                 0.1 KB
FULL AppState       110.1 KB utf8 | 219.9 KB utf16
quota 5 MB (utf16) -> headroom 23.3x
```

Second, the same session built by the **real** engine (`newGame`/`play`, 80 plies, `scratchpad/realgame.mjs`): **35.5 KB utf8, `played` 30.2 KB, 387 bytes/ply**. The cause is `PlayedMove extends LegalMove` with `fenBefore` *and* `fenAfter` per ply (`chess/types.ts:73-79`) — two ~60-byte FENs plus the full `LegalMove` on every half-move.

Verdict on quota: **not a risk.** 220 KB utf16 is ~4% of the conservative 5 MB budget, with 23× headroom. The one path that gets close is failed photo uploads persisted as `data:` URLs — 13 of them takes the blob to 4.79 MB (94% of 5 MB) — and `saveState`'s ladder handles it correctly, recovering to 189 KB at `keep=400`.

Two things the number does invalidate: (a) `state/game.ts:25-26` states *"A `Game` is a FEN, a move list and a position list — about 1KB at move 40, next to a message history already measured in tens of KB"* — it is 35.5 KB, i.e. **half** the size of a 500-message history, not a rounding error beside it; and (b) `syncableState`'s POST body for this state measures **94.5 KB**, sent on a 4 s debounce.
**SYMPTOM:** No user-visible failure. The risk is decision-making: `game.ts:26` explicitly invites a future activity to reason from that figure ("would become one only if an activity wanted to persist media"), and the true per-ply cost is what makes the 94.5 KB sync payload worth knowing about.
**FIX:** Correct the comment with the measured figure and method, and log it to `context/measurements.md` with n and date per CLAUDE.md's rule. If the payload ever matters, `fenBefore` is derivable from the previous ply's `fenAfter` for all but the first move — dropping it would cut `played` roughly in half — but that is a real trade against `types.ts:64`'s stated reason for carrying it ("so any move can be re-assessed later, standalone") and should not be done on size grounds alone at 4% of quota.

---

## NON-FINDINGS — suspects that checked out

**Pawn-promotion cancel on touch** (`ChessBoard.tsx:393-422`, `:443-515`, `:748-828`). Traced both entry paths and the cancel. Tap-to-promote: `onDown` sets `gesture.commit` (`:461`), `onUp` clears `gesture.current` *before* committing (`:489`) and calls `commit` → `setPromo` + `setSel(null)` (`:397-401`). Drag-to-promote: `onUp` runs `setDrag(null)` before `commit` (`:496-499`). Cancel via the scrim (`:797-803`) sets `promo = null`, leaving `sel`, `drag` and `gesture.current` all already null and the position untouched, so the pawn renders from the unchanged FEN and is immediately re-selectable. The scrim's `onPointerDown` `stopPropagation` is belt-and-braces (`.cb-board` has no `onPointerDown`); its `pointerup` bubbles to `onUp`, which early-returns on the null gesture, and `releasePointerCapture` on an active-but-uncaptured pointer is a spec no-op, not a throw. `.cb-board` correctly sets `touch-action: none` (`chess.css:249`) so a drag never becomes a scroll-and-`pointercancel`. Both invalidation effects (`:355-362` on `interactive`, `:365-370` on `fen`) clear `promo`. No defect found.

**Do the draw facts say "draw" correctly?** Yes, for all four terminals — verified by driving the real engine into each (`scratchpad/draws.mjs`, `draws2.mjs`, table quoted in the LOW finding above). `board.ts:55-67` detects stalemate, insufficient material, threefold and fifty-move; `types.ts:50-51` guarantees `winner` is set only for checkmate; `chessTalk.ts:425-434` reaches `"it ended in a draw"` for every one, with `over: true` propagating correctly through `activityOf`. The only issue is the loss of *which* draw, filed as LOW. (My first two probe FENs were wrong and produced a false positive on "stalemate not detected" — corrected and re-run before reporting.)

**StrictMode double-invocation of the tally writers.** All three are idempotent, and the guards that matter are already in place. React invokes a state updater twice with the *same* base state and keeps the second result, so an updater that is deterministic in `s` produces an identical value both times. `ChessActivity.tsx:164-181` reads `s.tally`, adds 1, and is fenced by `!s.game.closedAt` (`:165`) — same base, same output; the `Date.now()` inside differs by under a millisecond and is not read back. `TicTacToeActivity.tsx:189-197` is the same shape. The WYR bump compares `next.rounds.length > cur.rounds.length` where both derive from the same `s` (`WouldYouRatherActivity.tsx:141-152`), and `answerCurrent` itself no-ops on an already-answered card (`session.ts:132`), so double-invoke and a doubled tap are both covered. The one writer where a naive updater *would* break is `momentsFired`, which appends to an array — and it is explicitly guarded with a comment naming the reason (`useMoments.ts:161-168`).

**WYR `closedAt` set on exit with ≥1 answered card.** Correct. `WouldYouRatherActivity.tsx:169-176` writes `closedAt: Date.now()` unless `isEmpty(cur)`, and `isEmpty` is `rounds.length === 0` (`session.ts:163-165`). The spec is honoured by the handler; only the *route* to it is incomplete, filed separately.

**Tally double-counting when two devices close the same game.** Correct by construction. Both devices increment from their own base to the same value, and `mergeStates` takes a per-field `Math.max` (`merge.ts:60-69`), so the shared game counts once. The documented undercount when two devices close *different* games before syncing (`merge.ts:16-19`) is a stated, reasoned trade, not a defect.

**`mergeGame` session-identity logic.** `merge.ts:40-47` is sound: different sessions resolve by `startedAt`, a close beats an open, and same-session ties resolve by progress. Chess/ttt `played.length` and wyr `rounds.length` are both monotonic, so `progressOf` is a valid comparator.

**`answerCurrent` double-tap protection.** `session.ts:131-136` no-ops via `isAnswered`, and the component additionally gates on `answered || pending` in both `onPick` (`:132`) and the buttons' `disabled` (`:246`, `:260`).

**`TicTacToeBoard` input gating.** `legalCells` is `[]` whenever `!mine` (`TicTacToeActivity.tsx:136`), and the board takes no input on an empty set (`TicTacToeBoard.tsx:70`, `:106`). A finished board cannot be played into. The draw wording is also correct end to end: `"the board filled up, nobody won"` (`tttTalk.ts:102`) and `"that draws it"` (`:76`).

**`migrateMessages` and the `persistable` `data:` strip.** Both behave as documented; the ladder recovers a 4.79 MB blob to 189 KB (measured above).

**Entry effects under StrictMode's double-mount.** All three re-check inside the updater — `s.game ? s : …` (`ChessActivity.tsx:68-72`, `TicTacToeActivity.tsx:123-127`) and `if (cur && !cur.closedAt) return s` (`WouldYouRatherActivity.tsx:94-98`) — so a doubled mount cannot deal two boards.

No files were edited and nothing was committed. Scratch scripts are in `/tmp/claude-0/-home-user-html-portfolio/1ba94af4-9738-526a-a464-53a4a3882724/scratchpad/` (`size.mjs`, `realgame.ts`, `wyrsim.ts`, `wyrsim2.ts`, `draws.ts`, `draws2.ts`, `early.ts`, `early2.ts`, `load.mjs`) if you want to re-run any measurement.
