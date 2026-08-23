// WS-GAMEPLAY — the chat-initiated game invite, as a predicate.
//
// The feature is "he says chalo chess khelte h and the board is one tap from
// that sentence". The risk the feature carries is the opposite one: a chip
// appearing because somebody mentioned chess. So this suite is deliberately
// lopsided — twice as many NEGATIVE cases as positive ones — because a missed
// invite costs one trip to the games menu and a spurious one is the app
// interrupting a conversation to sell a board.
//
// Offline, deterministic, $0, no model call. Run via `node evals/run.mjs
// gameinvite` or on its own.
import * as C from "./.bundle.mjs";

let fails = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) fails++;
};

const T0 = Date.UTC(2026, 7, 23, 18, 0, 0);
let seq = 0;
const m = (from, text, dt = 0, extra = {}) => ({
  id: `g${++seq}`,
  from,
  kind: "text",
  text,
  at: T0 + dt,
  ...extra,
});

// ═══ 1. HIS CLEAR ASK fires ════════════════════════════════════════════════
{
  console.log("\n── 1. his clear ask ──");
  const ASKS = [
    ["chalo chess khelte h", "chess"],
    ["chalo chess khelte hain", "chess"],
    ["chess khelein?", "chess"],
    ["let's play chess", "chess"],
    ["lets play some chess na", "chess"],
    ["wanna play chess?", "chess"],
    ["do you want to play chess", "chess"],
    ["play chess?", "chess"],
    ["up for a game of chess?", "chess"],
    ["ek game shatranj ka ho jaye", "chess"],
    ["rematch chess", "chess"],
    ["chalo tic tac toe khelte hain", "tic-tac-toe"],
    ["let's play tic-tac-toe", "tic-tac-toe"],
    ["zero kaata khelein?", "tic-tac-toe"],
    ["tictactoe khelo", "tic-tac-toe"],
    ["let's play would you rather", "would-you-rather"],
    ["wyr khelte hain", "would-you-rather"],
  ];
  for (const [text, kind] of ASKS) {
    ok(`playAskIn fires: "${text}"`, C.playAskIn(text) === kind, String(C.playAskIn(text)));
    const inv = C.detectGameInvite([m("me", text), m("her", "haan chalo!", 4000)], T0 + 5000);
    ok(`invite fires end to end: "${text}"`, inv?.kind === kind && inv?.via === "his-ask", JSON.stringify(inv));
  }
}

// ═══ 2. CHIT-CHAT DOES NOT FIRE ════════════════════════════════════════════
//
// Every line here names a game. None of them is an ask. This is the half of
// the suite the feature actually lives or dies on.
{
  console.log("\n── 2. chit-chat, and the near misses ──");
  const NOT_ASKS = [
    "chess is fun",
    "i love chess",
    "chess is so boring honestly",
    "my dad plays chess every sunday",
    "mera bhai chess khelta hai",
    "i used to play chess in school",
    "we played chess yesterday remember",
    "kal chess khela tha na",
    "bachpan me chess khelte the",
    "do you play chess?",
    "tum chess khelti ho?",
    "chess sikha do mujhe",
    "magnus carlsen is the chess goat",
    "abhi chess khel raha hu bhai ke saath",
    "that tic tac toe game was rigged",
    "tic tac toe is for kids",
    "kal tic tac toe khelenge",
    "chess tomorrow?",
    "chess baad me khelte hain",
    "abhi nahi yaar chess baad me",
    "nahi chess nahi khelna",
    "i don't want to play chess",
    "let's play music",
    "wanna play a song",
    "shall we play badminton",
    "game of thrones dekha?",
  ];
  for (const text of NOT_ASKS) {
    ok(`no ask: "${text}"`, C.playAskIn(text) === null, String(C.playAskIn(text)));
    const inv = C.detectGameInvite([m("me", text), m("her", "haha okk", 4000)], T0 + 5000);
    ok(`no invite: "${text}"`, inv === null, JSON.stringify(inv));
  }
}

// ═══ 3. HER PROPOSAL + HIS YES ═════════════════════════════════════════════
{
  console.log("\n── 3. she proposes, he agrees ──");
  const YESES = ["haan", "haa", "chalo", "ok", "okay", "sure", "yes", "yeah", "done", "bilkul", "kyu nahi", "why not", "haan chalo khelte hain", "👍"];
  for (const yes of YESES) {
    const inv = C.detectGameInvite(
      [
        m("me", "boring lag raha hai"),
        m("her", "chess khelein?", 2000),
        m("me", yes, 4000),
        m("her", "yesss board khol", 6000),
      ],
      T0 + 7000,
    );
    ok(`her proposal + "${yes}"`, inv?.kind === "chess" && inv?.via === "her-proposal", JSON.stringify(inv));
  }

  const NOS = ["nahi", "nah", "not now", "abhi nahi", "baad me", "later", "no"];
  for (const no of NOS) {
    const inv = C.detectGameInvite(
      [
        m("her", "chess khelein?"),
        m("me", no, 2000),
        m("her", "okk", 4000),
      ],
      T0 + 5000,
    );
    ok(`her proposal + "${no}" does not fire`, inv === null, JSON.stringify(inv));
  }

  // a yes with no proposal behind it is just a yes
  {
    const inv = C.detectGameInvite(
      [m("her", "khana kha liya?"), m("me", "haan"), m("her", "good", 2000)],
      T0 + 3000,
    );
    ok("a bare yes with no proposal does not fire", inv === null, JSON.stringify(inv));
  }
  // his yes has to answer THAT proposal, not one from three turns ago
  {
    const inv = C.detectGameInvite(
      [
        m("her", "chess khelein?"),
        m("me", "hmm", 1000),
        m("her", "kya kar rahe ho", 2000),
        m("me", "kuch nahi", 3000),
        m("her", "achha", 4000),
        m("me", "haan", 5000),
        m("her", "okk", 6000),
      ],
      T0 + 7000,
    );
    ok("a stale proposal is not revived by a later yes", inv === null, JSON.stringify(inv));
  }
}

// ═══ 4. THE ANCHOR AND THE GUARD RAILS ═════════════════════════════════════
{
  console.log("\n── 4. anchor, freshness, one-at-a-time ──");

  // the chip hangs under HER latest line, never under his
  {
    const msgs = [m("me", "chalo chess khelte hain"), m("her", "haan", 3000), m("her", "chalo", 4000)];
    const inv = C.detectGameInvite(msgs, T0 + 5000);
    ok("anchored to her LAST bubble", inv?.msgId === msgs[2].id, JSON.stringify(inv));
  }

  // THE ASK IS THE INVITE'S IDENTITY, and it must not move when she does.
  // Keyed on the anchor instead, a chip he had already tapped came back the
  // moment her next bubble landed (caught in the browser, not in review).
  {
    const ask = m("me", "chalo chess khelte hain");
    const one = [ask, m("her", "haan", 3000)];
    const two = [...one, m("her", "board khol raha hu?", 9000)];
    const a = C.detectGameInvite(one, T0 + 10_000);
    const b = C.detectGameInvite(two, T0 + 11_000);
    ok("askId is HIS ask", a?.askId === ask.id, JSON.stringify(a));
    ok("askId survives another bubble of hers", b?.askId === ask.id, JSON.stringify(b));
    ok("…while the anchor moves to it", a?.msgId !== b?.msgId && b?.msgId === two[2].id);
  }
  {
    const prop = m("her", "chess khelein?");
    const msgs = [prop, m("me", "haan", 2000), m("her", "chalo", 4000)];
    const inv = C.detectGameInvite(msgs, T0 + 5000);
    ok("askId on the proposal path is HER proposal", inv?.askId === prop.id, JSON.stringify(inv));
  }

  // he asked and she has not answered yet: no chip, because the chip is her
  // offering it back
  {
    const inv = C.detectGameInvite([m("her", "hii"), m("me", "chalo chess khelte hain", 2000)], T0 + 3000);
    ok("no chip before she has replied", inv === null, JSON.stringify(inv));
  }

  // her refusal outranks his ask
  {
    const inv = C.detectGameInvite(
      [m("me", "chalo chess khelte hain"), m("her", "abhi nahi yaar so rahi hu", 3000)],
      T0 + 4000,
    );
    ok("her refusal kills the chip", inv === null, JSON.stringify(inv));
  }

  // stale: past the freshness window there is no pending invite
  {
    const msgs = [m("me", "chalo chess khelte hain"), m("her", "haan chalo", 3000)];
    ok("fresh inside the window", C.detectGameInvite(msgs, T0 + 60_000) !== null);
    ok(
      "gone outside the window",
      C.detectGameInvite(msgs, T0 + C.INVITE_FRESH_MS + 60_000) === null,
    );
  }

  // ONE pending at a time: two asks in one thread yield exactly one invite,
  // and it is the newest
  {
    const msgs = [
      m("me", "chalo chess khelte hain"),
      m("her", "haan", 1000),
      m("me", "actually tic tac toe khelte hain", 2000),
      m("her", "okk chalo", 3000),
    ];
    const inv = C.detectGameInvite(msgs, T0 + 4000);
    ok("the newest ask wins", inv?.kind === "tic-tac-toe" && inv?.msgId === msgs[3].id, JSON.stringify(inv));
  }

  // call turns are not chat turns
  {
    const inv = C.detectGameInvite(
      [m("me", "chalo chess khelte hain", 0, { channel: "call" }), m("her", "haan", 2000)],
      T0 + 3000,
    );
    ok("a spoken ask does not open a chat chip", inv === null, JSON.stringify(inv));
  }

  // her last word being a picture leaves nothing to hang a chip under
  {
    const inv = C.detectGameInvite(
      [m("me", "chalo chess khelte hain"), m("her", "dekho", 2000, { kind: "photo" })],
      T0 + 3000,
    );
    ok("no anchor under a photo", inv === null, JSON.stringify(inv));
  }

  // empty and one-sided threads
  ok("empty thread", C.detectGameInvite([], T0) === null);
  ok("only her", C.detectGameInvite([m("her", "chess khelein?")], T0 + 1000) === null);
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall game-invite checks passed");
process.exit(fails ? 1 : 0);
