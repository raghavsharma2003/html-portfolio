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

/** The tail block. "" when nothing is going on, which is most of the time. */
export const ACTIVITY_BUDGET = 420;

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
  return text;
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
export function activityNote(fact: string): string {
  const f = fact.trim();
  if (!f) return "";
  // "fold it into whatever you two were talking about" is the fix for a felt
  // defect: mid-conversation, she would abruptly drop the thread and recite a
  // move comment with no interest in it — because the old wording framed the
  // note as a thing to REACT TO rather than a thing that happened in the room.
  // A person mid-story who sees a move plays the move into the story, finishes
  // the sentence first, or says nothing.
  return `<context: ${f}. this happened in the room, not in the conversation — fold it into whatever you two were talking about, finish your thought first, or let it pass. only remark if it genuinely grabs you, short, your own words. never reference this note>`;
}
