// What the two of them are DOING together right now.
//
// The owner's intent, and it is an architectural instruction rather than a
// feature request: *"There should be continuity and proper flow between chat,
// call, screen sharing, and chess... It should be a whole continuous thing
// only. Nothing should be broken in between... it should be continuous
// personality like a real human. ... we will integrate more and more games and
// more and more activities so all this should be handled."*
//
// ── why this file exists at all ──────────────────────────────────────────
//
// Screen-share was built as a one-off. Chess could be built as a second
// one-off. The third activity would be a third. That is exactly the shape
// `age-tier-never-realtime` records: a second implementation loses the rules
// added AFTER the fork, silently, and is discoverable only by diffing two
// things nobody thinks of as the same thing. In that incident the thing lost
// was a minor's romance-register refusal.
//
// So the seam is generic from the start. An activity is not a mode she enters;
// it is a fact about the present moment that rides the SAME prompt, the SAME
// memory and the SAME relationship as everything else. Adding the next game
// means writing an adapter that produces `ActivityState`, not touching the
// call lane, the compiler, or the persona.
//
// ── the shape of the contract ────────────────────────────────────────────
//
// Every activity answers three questions and nothing else:
//
//   1. what are we doing, and since when          → `kind`, `startedAt`
//   2. where does it stand right now              → `facts`
//   3. what am I allowed to name out loud         → `nameable`
//
// (3) is not bureaucracy. `honesty-provenance-allowlist` treats an identifier
// she emits that was not in her input as INVENTED, and a chess move like `Nf3`
// is identifier-shaped. Without an explicit nameable set, the honesty gate
// correctly flags moves that really were played. Every activity that has
// identifier-shaped content — a move, a card, a word, a score — has to declare
// it for the same reason.
//
// ── what does NOT belong here ────────────────────────────────────────────
//
// No dialogue. Not one line she could say. `recited-prompt` is the most
// expensive law in this repo: her own example quotes were recited on 4 of 5
// turns, and taste written as polished English came back verbatim twice, eight
// turns apart. Facts are telegraphic and shapelint-clean; what she does with
// them is hers.
//
// No FEN, no board array, no engine evaluation in centipawns. She emits the
// characters she speaks on the live lane, and a number she can read aloud is a
// number that makes her sound like a computer.

/** Activities that exist today. A new game adds a member and an adapter. */
export type ActivityKind = "chess" | "watch" | "wyr" | "ttt";

export interface ActivityState {
  kind: ActivityKind;
  /** epoch ms, so "we have been at this a while" is derivable, not asserted */
  startedAt: number;
  /**
   * Telegraphic rows about where this stands. Each must survive shapelint:
   * ≤14 words, not sentence-shaped (no capital-start + terminal punctuation),
   * never first-person — those three rules are what stop a fact becoming a
   * line she recites.
   */
  facts: readonly string[];
  /**
   * Identifier-shaped tokens she is permitted to say — moves, names, codes.
   * Feeds the honesty allowlist. Anything not here, she may not name.
   */
  nameable: readonly string[];
  /**
   * WHAT WILL STILL BE TRUE NEXT WEEK. `facts` is the present moment and
   * expires with it ("it is his move"); this is the half a person still
   * carries a month later — the opening they played, who had which colour,
   * how it ended, which choices came up.
   *
   * It exists because the record that reached her memory USED to be `facts`
   * alone, and `facts` is deliberately a snapshot of a moment. A finished
   * chess game therefore became "he ended the game early; she is playing
   * black; 6 moves in" — no moves, no opening past ply 16, nothing a person
   * would actually recall. Asked about his opening two days later she had
   * nothing to answer from and invented one (the 2026-08-23 tester report:
   * "D4 tak sahi tha fir made up moves"). A gate can refuse an invented
   * specific; only a record can supply the real one.
   *
   * NOT rendered by `renderActivity` — the live block is unchanged, byte for
   * byte, because during a game the board is on screen and a move list in the
   * prompt is the scoresheet failure `chessTalk.ts` opens by refusing. Its
   * two consumers are the EPISODE (`activityEpisodeSummary`, which puts these
   * rows first because they are the durable half) and the honesty gate's
   * activity vocabulary, which is what lets her name a real move and stops
   * her naming one that was never played.
   *
   * Same three shape rules as `facts`: telegraphic, ≤14 words, never a line
   * she could say. Optional — an adapter that has nothing durable to say
   * omits it and every byte downstream is what it was.
   */
  record?: readonly string[];
  /**
   * BOARD TRUTH, MACHINE-DERIVED. One line, read straight off the adapter's
   * own engine evaluation of the position — never off prose, never off a fact
   * row, never off anything a model wrote.
   *
   * Two shapes only: `in progress, move N` and `<how it ended>`. The renderer
   * lifts it out of `facts` and into the UNDROPPABLE part of the block,
   * beside `STATE_LAW`, because the whole point of it is that it survives the
   * drop policy — a fence whose subject can fall off the end of the block is
   * not a fence.
   *
   * Why it exists (tester report, 2026-08-25): she declared checkmate in the
   * middle of a live game. The block she was holding said whose move it was
   * and what had just been played, and nothing in it said, as a fact she
   * could not talk past, THIS IS NOT OVER. `facts` could not be that thing:
   * every row in it is droppable by construction, and "it is his move" is a
   * fact about a turn rather than about the game's status.
   *
   * Optional. An adapter that does not set it renders exactly what it
   * rendered before this field existed, `STATE_LAW` included — the law is
   * about the line, so with no line there is nothing to state.
   */
  state?: string;
  /**
   * HER PLAN, in one telegraphic clause — "the italian game, quick
   * development toward their king".
   *
   * Derived by the adapter from her OWN moves, never from prose and never
   * from a model. The tester asked her what her idea behind the opening was
   * and got "mai bhul gayi", because the block carried the board and not one
   * byte about what she was trying to do with it. A gate can refuse an
   * invented plan; only a substrate supplies a real one.
   *
   * Same three shape laws as `facts`: telegraphic, ≤14 words, never a line
   * she could say. Optional, and absent renders nothing.
   */
  idea?: string;
  /** true when it is HER turn to act. Drives nothing on its own; she decides. */
  waitingOnHer?: boolean;
  /**
   * The activity has ENDED and she is carrying the ending, not the game.
   * Rendering changes with it: "in the middle of" becomes "just finished",
   * because the owner hit the gap this closes — she checkmated him, he called
   * two minutes later, and she asked him what move she should play. A
   * finished game that vanishes from her context the moment it closes is a
   * shared moment she has already forgotten by the time it matters most.
   */
  over?: boolean;
}

/**
 * The tail block's DROPPABLE half — the head plus the fact rows. "" when
 * nothing is going on, which is most of the time.
 *
 * DELIBERATELY UNCHANGED at 420 through WS-GAMEFEEL, and that is the decision
 * rather than an oversight. `ttt-t15-bytes` measured the head at 307 (ttt) /
 * 301 (chess), so a live board has ~113 bytes of fact room, and the row ORDER
 * in both adapters is written against that number — `tttActivity`'s comment
 * calls it "nearly the whole design". Folding the undroppable block below into
 * this cap would have paid for the fence out of the rows (the drop policy
 * takes them from the END, which is where the threat row and the opening name
 * sit); raising it would have let MORE rows through than either adapter's row
 * order was designed for, which is the commentator failure `chessTalk.ts`
 * opens by refusing. So the cap on this half is the cap it always was, the
 * rows that survive are the rows that survived, and the fence is paid for on
 * top of it.
 */
export const ACTIVITY_BUDGET = 420;

/**
 * And the ceiling on the UNDROPPABLE half — `state`, `idea` and `STATE_LAW`.
 *
 * `STATE_LAW` is a fixed string and the two adapter lines are telegraphic and
 * word-capped, so this is slack rather than a squeeze. It exists because a
 * cap that is only ever satisfied by convention is `dead-writers` waiting to
 * happen: a future adapter emitting a paragraph as its `idea` would push the
 * whole block past what anyone has measured, silently. Over it, the IDEA goes
 * — it is the one line here that is nice to have rather than load bearing.
 * `state` and the law are never dropped and never sliced; that is the entire
 * property they exist for.
 */
export const ACTIVITY_TRUTH_MAX = 480;

/** What the whole block can be, at most. One number for the callers (and the
 *  evals) that need to bound the thing that actually reaches the prompt. 900
 *  of the compiler's 24,000-byte tail cap. */
export const ACTIVITY_BLOCK_MAX = ACTIVITY_BUDGET + ACTIVITY_TRUTH_MAX;

/**
 * THE TERMINAL FENCE. Structural, not a hint — the same shape as the honesty
 * gates, and here for the same measured reason (`gate0-structural`: a prompt
 * instruction leaked 57–98%, a predicate leaked 0 of 31,122). This is the
 * prompt half; what makes it work is that the thing it points AT is a machine
 * number rather than another sentence.
 *
 * Two claims, both from the 2026-08-25 tester wave:
 *
 *  1. FALSE CHECKMATE. She announced the game over in the middle of it. The
 *     only thing that may decide that question is the engine's own reading of
 *     the board, and the `state:` line above is that reading verbatim.
 *  2. CROSS-GAME BLEED. She replayed the previous game's content as though it
 *     were the position in front of them. An earlier game is a MEMORY and has
 *     its own place in the prompt (the activity ledger); it is never the
 *     board, and the board is only ever the one this line describes.
 *
 * Not a line she could say: it is addressed to her about her own limits,
 * carries no Hinglish, and names no move. Exported so the eval asserts the
 * shipping string rather than a hand-written twin of it.
 */
export const STATE_LAW =
  "`state:` is read off the board by the engine and is the only thing that says whether this is finished — unless it says the game ended, you may not claim checkmate, stalemate, a win or a loss, and if it names no winner there is none. Any earlier game between you is MEMORY, never the board in front of you now.";

export const LABEL: Record<ActivityKind, string> = {
  chess: "a game of chess",
  watch: "watching their screen",
  wyr: "a round of would-you-rather",
  ttt: "a game of tic tac toe",
};

/**
 * Renders the activity into the prompt tail.
 *
 * Deliberately NOT a description of the activity's rules — she is a person who
 * knows what chess is, not a program being briefed. It is only the state, and
 * only the part a person across the table would actually have in their head.
 */
export function renderActivity(a: ActivityState | null | undefined, nowMs?: number): string {
  if (!a || !a.facts.length) return "";
  const mins =
    nowMs && a.startedAt && nowMs > a.startedAt
      ? Math.floor((nowMs - a.startedAt) / 60_000)
      : null;
  const head = a.over
    ? `YOU TWO JUST FINISHED ${LABEL[a.kind].toUpperCase()}` +
      (mins !== null && mins >= 1 ? ` — it ended about ${mins} min ago` : " — moments ago") +
      `. It already happened; carry it the way a person carries a game they just played — a mention if it comes up, an afterglow or a grudge if it fits, never a replay:`
    : `RIGHT NOW YOU TWO ARE IN THE MIDDLE OF ${LABEL[a.kind].toUpperCase()}` +
      (mins !== null && mins >= 1 ? ` — ${mins} min in` : "") +
      `. This is something you are doing WHILE you talk, not the only thing to talk about; the conversation can wander off it and come back the way it does with anyone. React when something actually strikes you, and be quiet when nothing does:`;
  // Over budget, whole facts are DROPPED FROM THE END — never sliced. The
  // compiler's own rule, for the reason it gives: "a sliced block is a lie."
  // The first version of this sliced at the byte cap and cut a fact mid-word,
  // which silently ate "it is his move" — the single most useful thing in the
  // block. `silent-truncation` is a law here precisely because truncation eats
  // the end, where the newest and most important text sits.
  //
  // Facts are therefore emitted least-important-last, so what goes is what can
  // afford to go.
  const rows = a.facts.map((f) => `- ${f}`);
  let text = `${head}\n${rows.join("\n")}`;
  while (text.length > ACTIVITY_BUDGET && rows.length > 1) {
    rows.pop();
    text = `${head}\n${rows.join("\n")}`;
  }
  // THE UNDROPPABLE BLOCK, added AFTER the drop loop and never inside it.
  //
  // `state`, `idea` and `STATE_LAW` sit between the head and the rows and are
  // never popped — that is the entire reason they are not `facts`. A fence the
  // budget can delete is a fence that is absent exactly when the block is
  // busiest, which is exactly when a false terminal claim is most likely
  // (tester, 2026-08-25: checkmate declared mid-game).
  //
  // Outside the loop, so which rows survive is decided by the SAME arithmetic
  // it always was and this seam cannot cost a fact row. See ACTIVITY_BUDGET.
  return `${head}${truthBlock(a)}\n${rows.join("\n")}`;
}

/**
 * The undroppable lines, or "". Bounded by `ACTIVITY_TRUTH_MAX`, and over it
 * the IDEA is what goes — whole, never sliced ("a sliced block is a lie", and
 * it does not stop applying because the block is small).
 */
function truthBlock(a: ActivityState): string {
  const state = a.state?.trim();
  const idea = a.idea?.trim();
  if (!state) return idea ? `\nher idea: ${idea}` : "";
  const full = `\nstate: ${state}${idea ? `\nher idea: ${idea}` : ""}\n${STATE_LAW}`;
  if (full.length <= ACTIVITY_TRUTH_MAX) return full;
  return `\nstate: ${state}\n${STATE_LAW}`;
}

/**
 * The out-of-band poke for a single event, mid-call.
 *
 * ANGLE BRACKETS, never square. `<context: …>` is the established input shape
 * on the live lane and is never her output space; a `[move: e4]` protocol
 * would fail the persona invariant that permits exactly three bracket lemmas,
 * and would fail audibly, because bracket text on this lane gets SPOKEN
 * (`ack-bracket-direction`: "[laughs softly]" came back as laughter plus the
 * spoken word "Softly").
 *
 * One event, one note. Never a digest of the last five — she reacts to what
 * just happened or she says nothing, exactly as the screen-share wake does.
 */
/**
 * The board truth that rides a single note. Same two fields as
 * `ActivityState`, passed separately because the note is one EVENT and not a
 * state block — the caller has the live session in hand and derives both from
 * it at the instant the note is drafted, which is what makes them true of the
 * position the note describes rather than of the one it was queued against.
 */
export interface NoteTruth {
  state?: string;
  idea?: string;
}

export function activityNote(fact: string, truth?: NoteTruth): string {
  const f = fact.trim();
  if (!f) return "";
  // THE FENCE TRAVELS WITH THE POKE, not only with the frozen brief.
  //
  // The live prompt is assembled once at connect and never again (G-C4,
  // `liveAssemblies === 1`), so a game that starts, moves and ends inside one
  // call reaches her ONLY through these notes. A terminal fence that lived in
  // the tail block alone would therefore be absent for the entire window in
  // which the false-checkmate defect actually happens. Same string, both
  // paths — `STATE_LAW` is one constant for the reason `warm-count-unscoped`
  // gives: two renderings of one rule drift, invisibly.
  const state = truth?.state?.trim();
  const idea = truth?.idea?.trim();
  const rider = state
    ? ` state: ${state}.${idea ? ` her idea: ${idea}.` : ""} ${STATE_LAW}`
    : idea
      ? ` her idea: ${idea}.`
      : "";
  // "fold it into whatever you two were talking about" is the fix for a felt
  // defect: mid-conversation, she would abruptly drop the thread and recite a
  // move comment with no interest in it — because the old wording framed the
  // note as a thing to REACT TO rather than a thing that happened in the room.
  // A person mid-story who sees a move plays the move into the story, finishes
  // the sentence first, or says nothing.
  return `<context: ${f}.${rider} this happened in the room, not in the conversation — fold it into whatever you two were talking about, finish your thought first, or let it pass. only remark if it genuinely grabs you, short, your own words. never reference this note>`;
}
