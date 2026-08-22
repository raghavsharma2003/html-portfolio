# Audit: continuity + call lane (2026-08-22, opus, verified findings only)

I have everything I need. Here are the verified findings.

---

**SEVERITY:** critical
**TITLE:** Opening chess or tic-tac-toe while the other kind owns `state.game` renders a blank board with no explanation
**WHERE:** `/home/user/html-portfolio/src/components/ChessActivity.tsx:66-73` and `:289`; `/home/user/html-portfolio/src/components/TicTacToeActivity.tsx:121-128` and `:254`
**EVIDENCE:** `AppState.game` is one slot. The entry effect is `if (session) return; setState(s => s.game ? s : {…fresh board…})` — `session` narrows by kind, so with a wyr (or ttt) session in the slot `session` is null, and the updater's `s.game ? s` guard refuses to create the board. `g` stays null, and the stage renders `{g ? <ChessBoard/> : null}` — nothing. The header still computes `line: over ? "good game" : hers ? "her move" : "your move"` from a null game, so it confidently says **"your move"**.
**SYMPTOM:** He answers a would-you-rather card, backs out, taps Chess from the hub: an empty dark rectangle under a header that says "Chess — your move". No board, no message, no button, no way to understand it. Same for tic-tac-toe. It reads as the app being broken, not as a conflict.
**FIX:** Both entry effects need the third branch wyr already has: if `s.game` exists and is a foreign kind, render a real blocked state with an action ("Put the chess game away and start this" → sets `closedAt`/null, then deals). At minimum never let the header assert "your move" when `g === null`.

---

**SEVERITY:** critical
**TITLE:** Would-you-rather is permanently blocked by any surviving chess/ttt session — including a finished one — and offers no way out
**WHERE:** `/home/user/html-portfolio/src/components/WouldYouRatherActivity.tsx:87`, message at `:233-236`, footer at `:219-231`
**EVIDENCE:** `const blocked = Boolean(raw && !session)` — `raw` is `state.game`, and the test does **not** consult `closedAt`. A chess session is nulled only by `ChessActivity`'s `exit` when `played.length === 0` (`ChessActivity.tsx:190`) or by clear-chat (`Chat.tsx:1019`); `endGame` and the auto-close both keep the row and only set `closedAt` (`:243-250`, `:161-184`). So one chess move, ever, means `state.game` is a chess session forever. WYR then renders "Finish or leave the game already on the board before starting this one." with `footer={session ? … : undefined}` → no footer, and the shell's only control is "‹ Chat".
**SYMPTOM:** After his first game of chess, "Would you rather" is dead for the life of the install. The one instruction on screen is unfollowable: he finished the game, he left the game, and the message still says to finish or leave it. He taps back, taps the row again, gets the same sentence.
**FIX:** `blocked` must ignore closed sessions (`raw && !raw.closedAt && !session`), and the blocked panel must carry the action that resolves it — one button that closes/discards the occupying session and deals the first card. A refusal with no remedy is a dead end, not a guard.

---

**SEVERITY:** high
**TITLE:** Tic-tac-toe is one game per lifetime — the finished board has no "New game"
**WHERE:** `/home/user/html-portfolio/src/components/TicTacToeActivity.tsx:242-266` (no `footer` prop passed to `ActivityShell`), entry effect `:121-128`
**EVIDENCE:** Chess ships `showNew` → an "End game"/"New game" footer (`ChessActivity.tsx:251-282`). TicTacToe passes no footer at all. Once a ttt game ends, the session stays in the slot (`closedAt` set at `:186-200`, never nulled), the entry effect returns early because `session` is truthy, and `mine`/`cells` are empty because `over` is true. Re-entering shows the finished, inert board.
**SYMPTOM:** "Thirty seconds, no thinking required" — and then never again. He taps Tic tac toe from the hub and gets the same finished board with the winning line drawn on it, permanently, with no control anywhere to start another.
**FIX:** Give ttt the same footer contract as chess: `showNew = Boolean(over || session?.closedAt)` → a button that writes a fresh `newTttGame()` session. (An `endGame` equivalent is worth having too, for the same standing-up-from-the-table reason chess has one.)

---

**SEVERITY:** high
**TITLE:** A game left unfinished is "RIGHT NOW you two are in the middle of…" forever — `RECENT_END_MS` only ages out CLOSED sessions
**WHERE:** `/home/user/html-portfolio/src/state/game.ts:106-140` (the `if (s.closedAt)` branch is the only one with an age test, `:121`); `/home/user/html-portfolio/src/engine/activity.ts:101-113`
**EVIDENCE:** `activityOf` gates the two-hour window exclusively inside the `closedAt` branch. An open session falls through to `chessActivity(s.game, s.herSide, s.startedAt, …)` with no clock check at all, and `renderActivity` derives `mins` from `startedAt` (`activity.ts:104-106`), emitting `RIGHT NOW YOU TWO ARE IN THE MIDDLE OF A GAME OF CHESS — 4320 min in`. The chat lane passes `nowMs: Date.now()` (`brain.ts:993`), so that number is real and rendered; both lanes read the same derivation (`Chat.tsx:243`, `useCallEngine.ts:670`, `:2480`).
**SYMPTOM:** He plays four moves on Tuesday and closes the tab. On Friday she texts and picks up the phone convinced they are mid-game — "3 days in" — and asks whose move it is. This is the exact failure `activityOf`'s own comment says the close-window exists to prevent, arriving from the other side.
**FIX:** Age out open sessions too, on a longer clock than the closed one (a board untouched for, say, >6h stops being the present moment and becomes memory). Derive staleness from the last move's timestamp rather than `startedAt`, so an active long game is not punished.

---

**SEVERITY:** high
**TITLE:** `closedAt` only lands while the board is mounted — leaving within 25s of the ending loses the close AND the lifetime tally
**WHERE:** `/home/user/html-portfolio/src/components/ChessActivity.tsx:161-184`; `/home/user/html-portfolio/src/components/TicTacToeActivity.tsx:186-200`
**EVIDENCE:** The close is a `setTimeout(…, CLOSE_AFTER_END_MS = 25_000)` inside a component effect whose cleanup is `clearTimeout(t)`. Unmount the activity (back to chat, tap the call chip, a re-render that drops the overlay) inside those 25 seconds and the timer dies. `closedAt` is never written, and because that same updater is the **only** writer of `tally.chessGames`/`chessWinsHim`/`chessWinsHer`/`tttGames` ("written here and nowhere else", `:169-179`), the game is never counted either.
**SYMPTOM:** He is checkmated, says "ugh", backs out immediately — the natural reaction. Result: she now carries a live "middle of a game" activity that says *"she won, by checkmate"* (the `status.over` branch of `chessActivity`, `chessTalk.ts:425-434`) under the header "RIGHT NOW YOU TWO ARE IN THE MIDDLE OF a game of chess". The Us screen and every milestone never learn the game happened.
**FIX:** The close belongs where the game ends, not where it is watched. Either write `closedAt` on the transition to `status.over` and let the surface render the 25s afterglow locally, or run the close/tally from a place that outlives the board (App, or a reconciliation pass at mount: "a session whose game is over and `closedAt` is unset gets closed now").

---

**SEVERITY:** high
**TITLE:** A closed or ended-early game stays fully playable — pieces keep moving inside a session she has been told is over
**WHERE:** `/home/user/html-portfolio/src/components/ChessActivity.tsx:77-79`, `:117-145`, `:243-250`, `:258`
**EVIDENCE:** `over`, `hers` and `mine` are computed from `g.status.over` only; `closedAt` is nowhere in the interactivity path. `endGame` sets `closedAt` (+`endedEarly`) and leaves the board live, and `showEnd` then hides the "End game" button, so the control disappears while the board it was meant to end keeps accepting moves. Her auto-move effect (`:117`) also only checks `hers && g`, so she keeps answering. Meanwhile `activityOf` reports the session as `over: true` with the fact `"he ended the game early, no result"` (`state/game.ts:130-135`), and the move poke refuses to fire (`useCallEngine.ts:2532`, `!cur.closedAt`).
**SYMPTOM:** He taps "End game", then idly keeps playing — and she does too, silently, for two hours, at which point `RECENT_END_MS` expires and she goes completely blind to a board they are both visibly still using. On a call she says the game ended early with no result while a piece she just played lands on the board.
**FIX:** `closedAt` must make the board read-only (`mine`/`hers` gated on `!session.closedAt`), with "New game" as the only forward action — which it already renders (`showNew`). Same guard in the ttt equivalent.

---

**SEVERITY:** high
**TITLE:** Screen sharing keeps running with no indicator and no look-away once a board is on screen
**WHERE:** `/home/user/html-portfolio/src/components/CallVoice.tsx:172-220` (the only render of the watch chip / "Look away"); `/home/user/html-portfolio/src/components/ActivityShell.tsx:47-61` (`ActivityCall` has no watch fields); `/home/user/html-portfolio/src/state/callStatus.ts:34-42` (`CallStatus` carries no `watching`)
**EVIDENCE:** The activity overlay is a sibling above `.call` (`games.css:325` z-22 vs `global.css:1797` z-20), so the call — and the live share — continue underneath, by design. But every screen-share affordance lives inside `CallVoice`: the chip that says "She can see your screen", the frame-freshness line, and the one-tap "Look away". The published `CallStatus` the board subscribes to has no notion of `watching`, so `ActivityShell` cannot show it even in principle. Getting back to the curtain costs a tap on the call chip, which unmounts the board (`App.tsx:458`).
**SYMPTOM:** Share the screen, open chess, and the single most privacy-sensitive state in the product becomes invisible. The look-away's own comment says the moment it is needed is a moment of mild panic — an OTP, a bank app, someone else's message. Behind a board it is not one tap; it is a tap into an unlabelled chip, a screen change, and then a hunt.
**FIX:** Add `watching`/`watchPaused` + `onLookAway` to `CallStatus` and `ActivityCall`, and render a compact share pill with the look-away in `ActivityShell`'s header (`as-end`), next to the mic. It is the same argument the shell already makes for mute in point 3 of its own header comment.

---

**SEVERITY:** high
**TITLE:** An armed hangup never disarms — `disarmHangup` has no caller, so "chal bye" ends the call 9 seconds later no matter what happens next
**WHERE:** `/home/user/html-portfolio/src/components/useCallEngine.ts:2306-2348` (the comment at `:2310-2312`), `disarmHangup` at `:2331-2336`, exported at `:2716`
**EVIDENCE:** The block's own contract: *"it self-cancels: any further speech from either side disarms it, so a phrase said mid-conversation cannot end a call three sentences later."* Nothing implements that. `disarmHangup` is called exactly once in the tree, from inside `endCall` (`:2373`), and grepping the rest of `src/` for it returns nothing — `CallVoice.tsx` receives it and never calls it. No speech handler on either lane (`onMyText` `:702`, `onHerText` `:723`, `handleUser` `:2096`) touches it. `armHangup` also early-returns if already armed, so the countdown cannot even be restarted.
**SYMPTOM:** Mid-game, mid-story, he says "chal baad me baat karte hai" as a figure of speech, she answers, he answers back — and nine seconds later the line drops mid-sentence with no warning, no countdown, no way to stop it. On a board this is worse: nothing on the activity screen hints a hangup is armed.
**FIX:** Call `disarmHangup()` from every point that observes further speech — both lanes' user-text handlers and her own speech-start — as the comment describes, and surface the armed state (the call chip / state label can say "ending…") so the countdown is visible where the user is looking.

---

**SEVERITY:** high
**TITLE:** A hangup he explicitly asked for arms the "she calls you back" flow, because `hangupArmed` is cleared before `endCall` reads it
**WHERE:** `/home/user/html-portfolio/src/components/useCallEngine.ts:2342-2347` vs `:2364-2372`
**EVIDENCE:** `armHangup`'s timer body sets `hangupArmed.current = null` as its **first** statement, then calls `endCall(done)`. `endCall` computes `const asked = hangupArmed.current !== null` — which is now always `false` on this path. The other suppressor, `midSentence = speakingRef.current`, is *likely true* precisely here: the 9s grace exists so she can deliver a goodbye, so the timer usually fires while she is still speaking it. Both suppressors therefore fail together, and `state.callback` is armed for +25s.
**SYMPTOM:** He asks her to hang up. She says bye. The line ends correctly — and then she rings him back, subtitled "calling back · call cut at 2:14", as if the call he ended had dropped. That inverts the one signal the whole callback feature is built on, and it is exactly the case the code's comment claims to exclude ("A hangup he ASKED for is not a drop even if it lands mid-word").
**FIX:** Read the flag before clearing it — pass `asked: true` into `endCall`, or clear `hangupArmed.current` after `endCall` returns. A one-line ordering fix; the reasoning above it is already right.

---

**SEVERITY:** high
**TITLE:** Mute is a lie during native watch-together — the UI says "she can't hear you" while the service mic stays hot (Android)
**WHERE:** `/home/user/html-portfolio/src/components/useCallEngine.ts:2078-2094` (`toggleMute`); `/home/user/html-portfolio/src/native/watch.ts:6-33` (the bridge has `setPrivate` but no mute); `/home/user/html-portfolio/src/components/CallVoice.tsx:149-153`
**EVIDENCE:** `startWatchMode` calls `claimVoice("native", "watch_started")` (`:1861`), which stops and nulls `liveSession` (`:540-545`). `toggleMute` then takes the non-live path: it flips `mutedRef`/`setMuted`, stops the JS recognizer (already stopped — `startListening` returns immediately unless the owner is `"cascade"`, `:1316`) and returns. Nothing reaches the native engine, which owns the mic, the STT and the speaking in its own process. There is no native mute API to call.
**SYMPTOM:** Screen sharing on the phone, he taps the mic to mute — the button goes red, the call screen prints "Your mic is off — she can't hear you", and she answers the next thing he says out loud. This is the same class of betrayal the look-away's comment names ("a person who THINKS they closed the curtain and did not"), on the control people trust most.
**FIX:** Add `setMuted` to the `Watch` plugin and route `toggleMute` through it while `voiceOwner === "native"`. Until that ships, the mute button must be disabled (or the state label must say mute is unavailable while the native engine holds the call) rather than reporting a state that is not true.

---

**SEVERITY:** medium
**TITLE:** Nothing tells the user when the live lane drops to the cascade — she just goes silent mid-sentence and then gets slow
**WHERE:** `/home/user/html-portfolio/src/components/useCallEngine.ts:732-746` (`onEnded`); `/home/user/html-portfolio/src/components/CallVoice.tsx:84-101` (`stateLabel`)
**EVIDENCE:** The drop path records `track("live_call_dropped")` and `tel("call.lane_change")`, claims the cascade, and calls `startListening()` + `armReengage()`. Nothing user-visible changes: `phase` stays `"live"`, `listening` is true on both lanes, and the engine returns no lane/quality signal at all, so neither the call screen nor the board header can render one. Her in-flight live audio is cut by `liveSession.stop()` with no replacement utterance — unlike the reverse transition, which sends a "the line just cleared up" context (`adoptLiveLate`, `:811-813`).
**SYMPTOM:** Her voice stops mid-word. Silence. He waits, says "hello?", and gets an answer several seconds later in a noticeably different voice pipeline. It reads as her hanging up on him or the app dying — the one thing a call must never be ambiguous about.
**FIX:** Expose the lane from the engine and give it a beat of chrome: `stateLabel` → "line dropped, reconnecting…" for a couple of seconds after `live_dropped`, mirrored in `ActivityShell`'s call chip. Consider a short spoken recovery on the cascade for a drop that lands while she was speaking, matching what `adoptLiveLate` already does in the other direction.

---

**SEVERITY:** medium
**TITLE:** The End-call button can be double-tapped: two callmarks in the chat, two memory extractions, two episode closes
**WHERE:** `/home/user/html-portfolio/src/components/CallVoice.tsx:290-304`; `/home/user/html-portfolio/src/components/useCallEngine.ts:2350-2435`
**EVIDENCE:** `endCall` has no re-entry guard. It sets `alive.current = false` but every subsequent statement runs unconditionally: `log({kind:"callmark"…})` (`:2403`), `rememberFrom(...)` (`:2407`), `postEpisodeCallEnd` (`:2399`), `diagEnd` (`:2395`), and `setTimeout(onEnd, 400)`. The button stays mounted and enabled for those 400ms — the controls row is not gated on `phase`.
**SYMPTOM:** A firm double-tap on the red button (the most double-tapped button in any phone UI) leaves two "📞 Voice call · 0:23" records back to back in the thread, and sends the last 60 turns to the extractor twice.
**FIX:** Guard on entry — `if (!alive.current) return;` at the top of `endCall` — and/or disable the button once `phase === "ended"`.

---

**SEVERITY:** medium
**TITLE:** The callback has no scheduler: `IncomingCall` renders only if App happens to re-render after its due time
**WHERE:** `/home/user/html-portfolio/src/App.tsx:473`
**EVIDENCE:** The gate is `!inCall && state.callback && Date.now() >= state.callback.at`, evaluated during render. `at` is set to `now + 25_000` in `endCall` (`useCallEngine.ts:2369`). Nothing schedules a re-render at `at`: App's own intervals are the OTA check (15 min, no `setState`) and the sync debounce (conditional `setState` only); `useMoments` fires on signature change; Chat's intervals (`Chat.tsx:396`, `:501`, `:549`) all early-return in the common case. The last App re-render is `setInCall(false)` 400ms after hangup, twenty-four seconds too early.
**SYMPTOM:** She "calls back" whenever something unrelated next touches App state — her presence timer dropping to last-seen a minute later, an after-call text, a sync conflict, or his next keystroke-triggered send. Most often it lands attached to something he did, which is the one framing the feature exists to avoid: the ring is supposed to be caused by the drop.
**FIX:** In App, `setTimeout` to `state.callback.at - Date.now()` on a `state.callback` effect and force a re-render when it fires (clear on unmount / when the callback is consumed).

---

**SEVERITY:** medium
**TITLE:** An armed callback never expires and is not cleared when he calls her back himself
**WHERE:** `/home/user/html-portfolio/src/App.tsx:336-344` (his call start) and `:473-491`; `/home/user/html-portfolio/src/state/store.ts:81` (persisted)
**EVIDENCE:** `callback` is written only by `endCall` and cleared only by accept/decline (`:481`, `:487`) or clear-chat (`Chat.tsx:1020`). `onVoiceCall`, and the three activity `onStartCall` handlers, set `inCall` without touching it. It is in `syncableState` and in localStorage, so it survives reloads and days offline, and the render gate is a bare `Date.now() >= at` with no upper bound.
**SYMPTOM:** Two shapes, both bad. (1) The call drops, he immediately calls her back himself, they talk for ten minutes, he hangs up — and she "calls back" about a call that was already resumed, captioned with the old `secs`. (2) He closes the app during the 25s window and opens it three days later: she rings instantly, "calling back · call cut at 1:20", about a drop from Tuesday.
**FIX:** Clear `callback` wherever a call starts by any route (fold it into the same place `setInCall(true)` lives), and add a TTL to the render gate — `Date.now() - at < ~10 min`, dropping it otherwise. A callback that is no longer plausible is not a callback.

---

**SEVERITY:** medium
**TITLE:** Accepting an incoming call leaves the Us screen (or the games sheet) on top of it — and Us shows no sign a call is live
**WHERE:** `/home/user/html-portfolio/src/App.tsx:469` (`usOpen`), `:363-419` (`gamesOpen`), accept handler `:476-482`; `/home/user/html-portfolio/src/components/UsScreen.tsx:198-223` (no `useCallStatus` import anywhere in the file); `us.css:56` (z-26) vs `global.css:1797` (`.call`, z-20)
**EVIDENCE:** `IncomingCall` is `position: fixed; z-index: 60` (`global.css:3418`), so it correctly paints over the sheet and over Us — he can see and answer it. But the accept handler only clears `callback` and sets `inCall`; it dismisses nothing. `CallVoice` then mounts at z-20, underneath a still-open Us screen (z-26) or games sheet (z-31). Unlike `ActivityShell`, `UsScreen` subscribes to no call status and renders no chip, timer, mute or way back.
**SYMPTOM:** He is reading "Us", she rings back, he accepts — and the screen does not change. The ringback stops, she starts talking, and there is no call anywhere on screen: no timer, no mute, no end button, no indication he is on a call at all until he finds the back arrow.
**FIX:** Dismiss the non-activity overlays on accept (`setUsOpen(false)`, `setGamesOpen(false)`; keep `activity`, which is built for this). Independently, `UsScreen` should carry the same call chip `ActivityShell` does — the argument in `ActivityShell`'s header comment ("a call that becomes invisible the moment you open a board") is not specific to boards.

---

**SEVERITY:** medium
**TITLE:** Game state never schedules a sync push, so the board is stale on the other device until a message happens
**WHERE:** `/home/user/html-portfolio/src/App.tsx:276-302` (dependency array at `:302`); `/home/user/html-portfolio/src/engine/account.ts:104-127` (`game` **is** in the payload)
**EVIDENCE:** The debounced push runs on `[state.messages.length, state.user, state.onboarded, state.auth?.accessToken, state.inner?.at]`. `state.game`, `state.tally`, `state.momentsFired` and `state.callback` are all synced fields but none of them is a trigger. `mergeStates`/`mergeGame` (`merge.ts:33-48`) are only reached at boot, sign-in, or on a 409.
**SYMPTOM:** A whole game of chess played without sending a single message is never pushed. On the laptop she still thinks the board is where it was an hour ago; the cross-device close ("a close beats an open", `merge.ts:44-46`) is correct but never gets the chance to run. The tally that feeds milestones is in the same boat.
**FIX:** Add a cheap projection of the syncable-but-untriggering fields to the dep list — e.g. `state.game?.startedAt`, a progress count, `state.momentsFired?.length`, `state.tally` — rather than the objects themselves, so the 4s debounce covers them without firing on every keystroke.

---

**SEVERITY:** medium
**TITLE:** `publishCallStatus`'s equality check can never pass, so every engine render re-renders the open board — the exact cost the module exists to prevent
**WHERE:** `/home/user/html-portfolio/src/state/callStatus.ts:61-73`; `/home/user/html-portfolio/src/components/useCallEngine.ts:2078` (`function toggleMute()`), published at `:2691-2699`
**EVIDENCE:** The guard's last clause is `current.toggleMute === next.toggleMute`. `toggleMute` is a function declaration inside the hook body, so it is a fresh reference on every render of `useCallEngine`; the comparison is always false, `emit()` always runs, and `useCallStatus`'s `setS(current)` always re-renders every subscriber. The publishing effect has no dependency array, so it runs on every engine render — and the engine re-renders on `speaking`, `listening`, `thinking`, `heard`, `frameAt` and the per-second tick.
**SYMPTOM:** Not visible as a wrong pixel; visible as a chess board (with its `useMemo`'d legal-move generation) re-rendering several times a second for the whole call, on the phone, while a call and possibly a screen share are running. The file's stated contract — "the per-second tick re-renders only the component that asked for it" — is silently not being kept.
**FIX:** Wrap `toggleMute` in `useCallback` (it reads only refs and setters, so `[]` works), or drop `toggleMute` from the equality check and publish it separately. Either restores the guard the file was designed around.

---

**SEVERITY:** low
**TITLE:** On the cascade lane the screen share sends frames nowhere, while the chip says "She can see your screen"
**WHERE:** `/home/user/html-portfolio/src/components/useCallEngine.ts:1696-1727` (`push`), `:1786` (`started = wake("start")`); `/home/user/html-portfolio/src/components/CallVoice.tsx:194-204`
**EVIDENCE:** `push` sets `frameRef.current` and `setFrameAt(at)` **before** attempting delivery, then `const sent = liveSession.current?.sendFrame(...) ?? false`. With no live session (live never connected, or it dropped) `sent` is always false, so `lastSentAt` never advances, `started` never becomes true, and `wake()` — the only thing that can make her look — never fires for the entire share. The chip, keyed on `Date.now() - eng.frameAt < 9000`, reports the happy state throughout.
**SYMPTOM:** He shares his screen on a call that landed on the fallback lane. The UI says she can see it; she never once reacts unprompted, and only "sees" anything at the moment he speaks (via `freshFrame()` on the cascade think). It reads as her ignoring him.
**FIX:** Have the chip reflect delivery rather than capture (report `lastSentAt`, not `frameAt`), and either refuse the watch button when no live session owns the call or say plainly that she can only look when he talks to her.

---

**SEVERITY:** low
**TITLE:** A call started with no network rings normally and answers in the device voice, with no offline indicator on the call surface
**WHERE:** `/home/user/html-portfolio/src/App.tsx:336-344`; `/home/user/html-portfolio/src/components/useCallEngine.ts:1043-1058`; `brain.ts:1168`; `/home/user/html-portfolio/src/voice/speech.ts:1111-1114`
**EVIDENCE:** Nothing gates the call button on connectivity (deliberate for chat — "reported, never enforced", `Chat.tsx:151-153` — but chat has an offline chip and the call screen has none). Offline: `tryStartLive` fails into `live_call_failed`, the 3.5s race times out, and the greet `think` returns `{bubbles: []}` because it is a directive call, so `greet` falls back to the literal `"hello?"` (`:1049`), which `speakCall` then renders through the device-TTS fallback after every clip fetch fails.
**SYMPTOM:** He taps call with no signal, hears a full 1.1-2.4s ring, then a robotic "hello?" in a stranger's voice, then long pauses and "awaaz kat rahi h lagta h". The persona holds up better than expected — but nothing on screen ever says the phone has no line, which is the one fact that would explain all of it.
**FIX:** Reuse Chat's `online` signal on the call surface: an offline pill in `call-top`, and either a pre-call warning or a suppressed ring when `navigator.onLine` is false.

---

**SEVERITY:** low
**TITLE:** Leaving a freshly-dealt board via the call chip skips the empty-board cleanup, stranding a 0-move session she believes is live
**WHERE:** `/home/user/html-portfolio/src/App.tsx:425`, `:442`, `:458` (`onOpenCall={() => setActivity(null)}`) vs `/home/user/html-portfolio/src/components/ChessActivity.tsx:189-192` and `/home/user/html-portfolio/src/components/TicTacToeActivity.tsx:204-207`
**EVIDENCE:** The shell's back button routes through the activity's `exit`, which nulls a board with `played.length === 0` ("Opening the board and leaving without playing is not a game"). The header's call chip does not: App's `onOpenCall` calls `setActivity(null)` directly, bypassing `exit` entirely. The mount effect has already written a fresh session by then.
**SYMPTOM:** He taps Chess while on a call, immediately taps the call chip to go back to her — and a zero-move chess session is now permanent state: she believes they are mid-game (see the stale-activity finding), and would-you-rather is blocked by it (see that finding). Two of the worst bugs above are reachable in two taps that never touched a piece.
**FIX:** Route every exit through the activity's own `exit` — pass `onOpenCall` down as a callback the activity invokes *after* its cleanup, rather than having App bypass it.

---

## NON-FINDINGS (suspected, checked, fine)

- **Games hub open when `IncomingCall` rings.** `.incoming` is `position: fixed; z-index: 60` (`global.css:3418`), above `.sheet` (31), `.clockcard-wrap` (32), `.us` (26), `.as` (22) and `.call` (20). He sees it and can answer it. `IncomingCall` also guards double-taps itself (`IncomingCall.tsx:42-47`) and offers Escape-to-decline. (What follows the accept is the separate finding above.)
- **Mute state consistency between the call screen and the board header.** Both render from the same value — the engine's `muted` state, published once and read by subscription (`useCallEngine.ts:2692-2698` → `ChessActivity.tsx:210`, `TicTacToeActivity.tsx:222`, `WouldYouRatherActivity.tsx:186`). There is one clock and one mute, and the board's button calls the engine's own `toggleMute`. No divergence, on either lane, apart from the native-watch case filed above.
- **`pickupOpts` with no callmark (first call ever).** `lastCallMinAgo` stays `null`; `CALL_OPEN_DIRECTIVE` tests `opts?.lastCallMinAgo != null && <= 15` (`persona.ts:616`), so the null path takes the generic mood clause and never interpolates a number. Correct.
- **Double-tapping the call *start* button.** `setInCall(true)` is idempotent, and `.call` (z-20) covers the chat header the moment the first tap lands, so the second tap cannot reach the button. Worst case is a duplicate `call_started` analytics event. (The *end* button is the one with a real problem — filed above.)
- **Cross-device close semantics.** `mergeGame` (`merge.ts:33-48`) gets the ordering right: different sessions → newer `startedAt` wins; same session → a close beats an open, otherwise more progress wins. The rule is sound; what is missing is the push that would let it run (filed above).
- **Board unmounting on exit.** `App.tsx:363-468` renders the hub sheet, the three activities, `UsScreen` and `IncomingCall` as siblings of `Chat`/`CallVoice`, exactly as the comment claims. Leaving a board unmounts one overlay and touches neither the chat's reply cycle nor the live socket.
