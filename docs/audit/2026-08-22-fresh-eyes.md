# Fresh-eyes product audit — 2026-08-22, tree d77a68b (re-verified at 0f21f54)

Method: real build + preview, Playwright, seeded realistic states; shipping
honesty detectors driven through a bundle of the real source; compile()
from a pristine git-archive export. ALL existing gates green on HEAD —
every finding sits in the gates' blind spot. Status: FIXED marks added as
the fix wave lands.

## CRITICAL
1. TTT never got the foreign-kind fix chess/wyr got: after ONE chess game,
   Tic tac toe opens an empty stage under "your move", forever, surviving
   reload. Entry effect still `s.game ? s`, her.line has no !g branch.
   (TicTacToeActivity.tsx:118-121, :261-267)
2. A game passing isGameSession with incomplete move records (played rows
   without from/to/fenAfter) unmounts the WHOLE app (rootKids=0), persisted
   locally = white screen forever. Account-switch path (App.tsx:373) casts
   r?.game with NO guard (merge.ts guards; this sibling doesn't). No
   ErrorBoundary anywhere in src/.

## HIGH
3. Every "Put it away and play X" takeover DELETES the occupying game —
   no closedAt, no tally, no episode; the comment claims the opposite.
   (ChessActivity.tsx:80-89, WYR:263-272; T1/T2 proof: NO op:"activity")
4. "New game" within the reconciler's 3s window loses the finished game
   from tally AND record (+200ms → tally=null; the replace route re-runs
   the effect and cleanup clears the pending timer). Unmount route is
   fixed; replace route is not.
5. recentMoment SURVIVES "make her forget you" and account switch — she
   brings up your 100-day milestone in the conversation that starts by
   not knowing you, and momentLine feeds sharedVocab so family 4 calls it
   supported. (Chat.tsx teardown list, App.tsx account reset)
6. Family 2/5 missing tense: her PAST-TENSE out-of-band send claim is
   ungated 0/10 both lanes ("maine tujhe email kar diya", "i sent you the
   file on whatsapp"). Future 3/5, receipt 3/3 (controls fine).
7. Two tabs: second tab's next write erases the first tab's game (whole-
   blob last-writer-wins; no storage listener anywhere).
8. user adopted from network unguarded; Object.entries(user.facts) throws
   in buildSystemPromptParts → she types forever, never replies, every
   send, on that device. (persona.ts:112, merge.ts:78-82, App.tsx:361)

## MEDIUM
9. Cascade call lane's brainKeys() carries neither activity nor moment —
   mid-call turns on the fallback lane are blind to the board (T15 block
   371 bytes/turn missing) and #117 never reaches a call.
10. "email kar dungi" invisible to family 5: verb list has `mail` but \b
    refuses to match inside `email`. One alternation: e-?mail.
11. Family 5 OOB misses natural English word order: "i'll send you the
    file on whatsapp" ungated in chat (object phrase pushes channel past
    NEAR_WORDS=4; Hinglish order survives). Measure object-phrase out of
    the gap; do NOT raise NEAR_WORDS (bought with a real generation).
12. Presence row + !g header guard landed on chess only; ttt/wyr rooms
    still read unoccupied off-call.

## LOW
13. Games-hub sheet is the one aria-modal overlay ignoring Escape (and
    has no initial focus). Copy MoreSheet's effect or hoist a <Sheet>.

## NON-FINDINGS (verified healthy — do not re-hunt)
- 80-row window walks to full history (280/280, separators correct);
  first probe that suggested a cap was auditor error, corrected.
- holdScroll anchoring holds (viewport-anchor measurement, not raw
  scrollTop); quote-jump extends and lands.
- Resume tags gate on !status.over correctly; sheet shadows inherited by
  games hub; clear-chat -> undo round-trip exact incl. tally/ledger.
- Rapid open/close of a finished board during the window is safe (the
  UNMOUNT route is truly fixed; only the replace route, #4).
- Chess SAN never trips findActionable — call lane's missing nameable
  allowlist is a content gap, not a safety one.
- Episode emission retries on next boot (per-mount ref + persisted closed
  session); permanent loss only via #3/#4.
- Topic chips land in both seedCurrencyChips and user.facts.topics.
