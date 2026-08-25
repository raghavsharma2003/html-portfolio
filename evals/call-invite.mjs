// WS-SHECALLS — "call me", as a predicate (src/engine/callInvite.ts).
//
// The defect this suite exists for is one screenshot:
//
//     him: "U can call me"
//     her: "call button click kar na, main thodi kar sakti hu"
//
// She has been able to ring him since #107. So the POSITIVE half of this
// suite is a regression test on a lie she told, and every line in block 1 is
// a sentence that must end in a phone ringing.
//
// The NEGATIVE half is bigger, and deliberately so — more than twice as many
// negative assertions as positive ones, for a harder version of the reason
// `game-invite.mjs` gives. A missed game invite costs one trip to a menu; a
// missed call invite costs one tap on a call button that is on every screen
// in the product. A SPURIOUS one is a full-screen ring, with sound and
// haptics, over whatever he was doing — and, if he is away, a notification on
// his lock screen. The four ways to be wrong each get their own block:
// direction (he is the one dialling), tense (the call already happened),
// capability (a question about her, not a request), and deferral (a time he
// named that is not now).
//
// Offline, deterministic, $0, no model call. Run via `node evals/run.mjs
// callinvite` or on its own.
import * as C from "./.bundle.mjs";

let fails = 0;
const ok = (name, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) fails++;
};

let pos = 0;
let neg = 0;

const T0 = Date.UTC(2026, 7, 23, 18, 0, 0);
let seq = 0;
const m = (from, text, dt = 0, extra = {}) => ({
  id: `c${++seq}`,
  from,
  kind: "text",
  text,
  at: T0 + dt,
  ...extra,
});

/** his ask, her ordinary reply — the whole flow, end to end. */
const flow = (text, herLine = "achha ruk") =>
  C.detectCallInvite([m("me", text), m("her", herLine, 4000)], T0 + 5000);

// ═══ 1. HIS CLEAR ASK FIRES ════════════════════════════════════════════════
//
// The first entry is the owner's own sentence. If this suite ever fails, it
// should fail on that line first.
{
  console.log("\n── 1. his clear ask ──");
  const ASKS = [
    "U can call me",
    "u can call me",
    "you can call me",
    "call me",
    "call me na",
    "call me please",
    "call me back",
    "call me abhi",
    "call me yaar",
    "you should call me",
    "u should ring me",
    "ring me",
    "buzz me",
    "give me a call",
    "give me a ring",
    "why don't you call me",
    "can you call me?",
    "kya tu mujhe call kar sakti hai",
    "mujhe call karo",
    "mujhe call kar do",
    "mujhe phone karo",
    "mereko call kar",
    "call kar na",
    "call karo na",
    "call karo",
    "call karle",
    "call kar de",
    "call kro",
    "phone kar na",
    "phone karo",
    "phone lagao",
    "call laga",
    "abhi call kar",
    "tu call kar",
    "tum call karo",
    "aap call karo na",
    "ek call kar na",
    "video call kar na",
  ];
  for (const text of ASKS) {
    pos++;
    ok(`ask fires: "${text}"`, C.callAskIn(text) === true);
    pos++;
    const inv = flow(text);
    ok(
      `invite fires end to end: "${text}"`,
      inv !== null && inv.via === "his-ask",
      JSON.stringify(inv),
    );
  }
}

// ═══ 2. HE IS THE ONE DIALLING ═════════════════════════════════════════════
//
// Every line here is a person reaching for the call button, which is one tap
// away on home, in the chat header and in the games sheet. A ring arriving
// because he said "can i call you" is the app answering a question nobody
// asked, and it takes the screen to do it.
{
  console.log("\n── 2. direction: HE dials ──");
  const HIS_OWN = [
    "can i call you?",
    "can i call you real quick",
    "may i call you",
    "shall i call you",
    "should i call you",
    "i'll call you",
    "ill call you in a bit",
    "im calling you",
    "i want to call you",
    "i wanna call you",
    "i would like to call you",
    "i am going to call you",
    "let me call you",
    "main call karta hu",
    "main tumhe call karta hu",
    "main call karunga",
    "mai phone karta hu",
  ];
  for (const text of HIS_OWN) {
    neg++;
    ok(`no ask: "${text}"`, C.callAskIn(text) === false);
    neg++;
    ok(`no invite: "${text}"`, flow(text) === null);
  }
}

// ═══ 3. THE CALL ALREADY HAPPENED ══════════════════════════════════════════
//
// Past, progressive and third person. All three contain a call and a verb and
// none of them is a request for one — this is `gameInvite.ts`'s NOT_NOW block
// translated into the tense system that actually matters for phones.
{
  console.log("\n── 3. tense: a call that already happened ──");
  const REPORTED = [
    "usne call kiya tha",
    "papa ka call aaya tha",
    "mummy ne call kiya",
    "i called you yesterday",
    "you called me twice",
    "you never called back",
    "she rang me at 3am",
    "call cut gaya",
    "call disconnect ho gaya",
    "call kar raha hu papa se",
    "abhi call kar rahi hai wo",
    "missed call dekha tera",
    "we were on a call with priya",
    "last call was so good",
  ];
  for (const text of REPORTED) {
    neg++;
    ok(`reported: "${text}"`, C.isReportedCall(text) === true || C.callAskIn(text) === false);
    neg++;
    ok(`no ask: "${text}"`, C.callAskIn(text) === false);
    neg++;
    ok(`no invite: "${text}"`, flow(text) === null);
  }
}

// ═══ 4. CAPABILITY — THE JUDGMENT, WRITTEN AS TESTS ════════════════════════
//
// The rule is the RECIPIENT, not the modal. "Can you call me?" names him and
// is an invitation wearing a question mark; "can you call?" asks what she is
// and gets an answer in words (possibly ending in her offering, which is
// shape B's first half).
//
// This block is the one place in the suite where the two halves of a single
// grammatical form are asserted to land on opposite sides, so a future
// tightening of the rule fails here loudly instead of quietly changing what
// the product does.
{
  console.log("\n── 4. capability questions ──");
  const BARE = [
    "can you call?",
    "can you even call",
    "can u call",
    "are you able to call",
    "kya tu call kar sakti hai",
    "tum call kar sakti ho kya",
    "call kar sakti ho?",
    "kya call possible hai",
  ];
  for (const text of BARE) {
    neg++;
    ok(`bare capability question: "${text}"`, C.isBareCapabilityQuestion(text) === true);
    neg++;
    ok(`no ask: "${text}"`, C.callAskIn(text) === false);
    neg++;
    ok(`no invite: "${text}"`, flow(text) === null);
  }
  const WITH_ME = ["can you call me?", "can u call me na", "kya tu mujhe call kar sakti hai"];
  for (const text of WITH_ME) {
    pos++;
    ok(`capability + recipient IS an invite: "${text}"`, C.callAskIn(text) === true);
    pos++;
    ok(`…and rings: "${text}"`, flow(text) !== null);
  }
}

// ═══ 5. A TIME HE NAMED THAT IS NOT NOW ════════════════════════════════════
//
// "call me later" arms nothing, and that is the honest reading rather than a
// limitation: he named a time, and a ring two seconds after he named a
// different one is the app not listening. She answers in words.
//
// `abhi` and `now` are the control: the same sentence with the opposite
// adverb has to reach the ring.
{
  console.log("\n── 5. deferral ──");
  const LATER = [
    "call me later",
    "call me back later",
    "call me tonight",
    "call me tomorrow",
    "kal call karna",
    "baad me call kar",
    "thodi der me call karna",
    "call me in 5 min",
    "call me in an hour",
    "call me after dinner",
    "call me when you're free",
    "jab free ho tab call karna",
    "raat ko call karna",
    "shaam ko call kar lena",
    "call me sometime",
  ];
  for (const text of LATER) {
    neg++;
    ok(`deferred: "${text}"`, C.isDeferred(text) === true);
    neg++;
    ok(`no ask: "${text}"`, C.callAskIn(text) === false);
    neg++;
    ok(`no invite: "${text}"`, flow(text) === null);
  }
  for (const text of ["call me now", "abhi call kar", "call me right now"]) {
    pos++;
    ok(`the control fires: "${text}"`, C.callAskIn(text) === true);
  }
}

// ═══ 6. NEGATION ═══════════════════════════════════════════════════════════
{
  console.log("\n── 6. negation ──");
  const NOS = [
    "mat call kar",
    "call mat karna",
    "abhi mat call karna",
    "don't call me",
    "dont call me please",
    "do not call me",
    "no need to call",
    "mujhe call nahi karna",
    "never call me again",
    "call karne ki koi zarurat nahi",
  ];
  for (const text of NOS) {
    neg++;
    ok(`refusal: "${text}"`, C.isCallRefusal(text) === true);
    neg++;
    ok(`no ask: "${text}"`, C.callAskIn(text) === false);
    neg++;
    ok(`no invite: "${text}"`, flow(text) === null);
  }
  // …and the two nos that are yeses, which the refusal guard must not eat
  for (const text of ["why not, call me", "kyun nahi, call kar na", "why don't you call me"]) {
    pos++;
    ok(`a no-shaped yes still fires: "${text}"`, C.callAskIn(text) === true);
  }
}

// ═══ 7. "CALL ME <NAME>" AND THE OTHER WORDS THAT ARE NOT ASKS ═════════════
//
// The naming idiom is the sharpest false positive this feature has, because
// it is character-for-character the owner's sentence plus one word. The
// closed tail list is what separates them, and this block is its test.
{
  console.log("\n── 7. naming, idioms and near misses ──");
  const NOT_ASKS = [
    "you can call me sam",
    "u can call me rj",
    "call me krishna",
    "everyone calls me chotu",
    "call me crazy but i liked it",
    "what do you call this in hindi",
    "lets call it a day",
    "so called best friend",
    "i work at a call center",
    "call center wale roz call karte hai",
    "mera phone kharab hai",
    "phone dekh raha tha bas",
    "phone pe recharge karna hai",
    "call quality kharab thi",
    "video call pe dekha tha usko",
    "your call bro",
    "it's your call",
    "good call",
    "call drop ho gaya tha",
    "phone silent pe hai",
    "call log check kar liya",
    "koi call nahi aaya",
    "uska call ignore kar diya",
    "tera call miss ho gaya",
  ];
  for (const text of NOT_ASKS) {
    neg++;
    ok(`no ask: "${text}"`, C.callAskIn(text) === false, JSON.stringify(C.callAskIn(text)));
    neg++;
    ok(`no invite: "${text}"`, flow(text) === null);
  }
}

// ═══ 8. HER OFFER + HIS YES ════════════════════════════════════════════════
{
  console.log("\n── 8. she offers, he agrees ──");
  const OFFERS = [
    "call karu?",
    "call kar lu?",
    "main call karun kya",
    "should i call you?",
    "can i call you?",
    "want me to call?",
    "let me call you",
  ];
  for (const text of OFFERS) {
    pos++;
    ok(`her offer: "${text}"`, C.herCallOfferIn(text) === true);
  }
  const YESES = ["haan", "haa", "ok", "okay", "sure", "yes", "yeah", "chalo", "bilkul", "kar na", "why not", "👍"];
  for (const yes of YESES) {
    pos++;
    const inv = C.detectCallInvite(
      [
        m("me", "bore ho raha hu"),
        m("her", "call karu?", 2000),
        m("me", yes, 4000),
        m("her", "ruk", 6000),
      ],
      T0 + 7000,
    );
    ok(`her offer + "${yes}"`, inv !== null && inv.via === "her-proposal", JSON.stringify(inv));
  }
  const NOS = ["nahi", "not now", "abhi nahi", "baad me", "later", "no", "rehne de"];
  for (const no of NOS) {
    neg++;
    const inv = C.detectCallInvite(
      [m("her", "call karu?"), m("me", no, 2000), m("her", "okk", 4000)],
      T0 + 5000,
    );
    ok(`her offer + "${no}" does not fire`, inv === null, JSON.stringify(inv));
  }

  // A DECLARATIVE FUTURE OF HERS IS NOT AN OFFER, and this is the property
  // that makes one ring per agreement structural rather than guarded. Her
  // PRE-RING line is exactly this shape ("achha ruk, karti hu"), and his
  // perfectly ordinary "ok" after it must not mint a second invite.
  for (const line of ["achha ruk karti hu", "abhi call karti hu", "i'll call you", "call karungi"]) {
    neg++;
    ok(`her promise is not a fresh offer: "${line}"`, C.herCallOfferIn(line) === false);
    neg++;
    const inv = C.detectCallInvite(
      [m("her", line), m("me", "ok", 2000), m("her", "haan", 4000)],
      T0 + 5000,
    );
    ok(`…and his "ok" after it does not ring again: "${line}"`, inv === null, JSON.stringify(inv));
  }

  // a bare yes with nothing behind it
  neg++;
  ok(
    "a bare yes with no offer does not fire",
    C.detectCallInvite([m("her", "khana kha liya?"), m("me", "haan", 2000), m("her", "good", 4000)], T0 + 5000) === null,
  );
  // his yes has to answer THAT offer, not one from four turns ago
  neg++;
  ok(
    "a stale offer is not revived by a later yes",
    C.detectCallInvite(
      [
        m("her", "call karu?"),
        m("me", "hmm", 1000),
        m("her", "kya kar rahe ho", 2000),
        m("me", "kuch nahi", 3000),
        m("her", "achha", 4000),
        m("me", "haan", 5000),
        m("her", "okk", 6000),
      ],
      T0 + 7000,
    ) === null,
  );
}

// ═══ 9. THE ANCHOR, THE WINDOW, AND ONE RING PER ASK ═══════════════════════
{
  console.log("\n── 9. anchor, freshness, one-at-a-time ──");

  // THE RING FOLLOWS HER REPLY. This is the whole sequencing guarantee, and
  // it is a property of the anchor rather than of a timer: until she has
  // answered in words there is no invite to arm, so nothing can ring over
  // her silence.
  neg++;
  ok(
    "no ring before she has replied",
    C.detectCallInvite([m("her", "hii"), m("me", "call me na", 2000)], T0 + 3000) === null,
  );
  pos++;
  {
    const msgs = [m("me", "call me na"), m("her", "achha ruk", 3000), m("her", "karti hu", 4000)];
    const inv = C.detectCallInvite(msgs, T0 + 5000);
    ok("anchored to her LAST bubble", inv?.msgId === msgs[2].id, JSON.stringify(inv));
  }

  // THE ASK IS THE INVITE'S IDENTITY. Keyed on the anchor instead, the same
  // ask would mint a new invite every time she said anything else — which on
  // this path is a second phone call, not a chip reappearing.
  pos++;
  {
    const ask = m("me", "call me na");
    const one = [ask, m("her", "achha", 3000)];
    const two = [...one, m("her", "ruk 2 sec", 9000)];
    const a = C.detectCallInvite(one, T0 + 10_000);
    const b = C.detectCallInvite(two, T0 + 11_000);
    ok(
      "askId is HIS ask and survives another bubble of hers",
      a?.askId === ask.id && b?.askId === ask.id && a?.msgId !== b?.msgId,
      JSON.stringify([a, b]),
    );
  }

  // her refusal outranks his ask
  neg++;
  ok(
    "her refusal kills the ring",
    C.detectCallInvite(
      [m("me", "call me na"), m("her", "abhi nahi yaar meeting me hu", 3000)],
      T0 + 4000,
    ) === null,
  );

  // …but her DEFERRAL does not, and the asymmetry with his side is
  // deliberate: she has already promised, and silence is the promise
  // abandoned. See the note in detectCallInvite.
  pos++;
  ok(
    "her 'ek min' still rings — the promise is hers to keep",
    C.detectCallInvite([m("me", "call me na"), m("her", "2 min me karti hu", 3000)], T0 + 4000) !== null,
  );

  // FRESHNESS. Short by design: re-opening the app on a thread where he once
  // said "call me" must not ring him. A ring with no live ask behind it is a
  // silence-triggered call, which decisions.md forbids in any form.
  {
    const msgs = [m("me", "call me na"), m("her", "achha ruk", 3000)];
    pos++;
    ok("fresh inside the window", C.detectCallInvite(msgs, T0 + 30_000) !== null);
    neg++;
    ok(
      "gone outside the window",
      C.detectCallInvite(msgs, T0 + C.CALL_INVITE_FRESH_MS + 30_000) === null,
    );
  }

  // ONE pending at a time: two asks in one thread yield exactly one invite,
  // and it is the newest.
  pos++;
  {
    const msgs = [
      m("me", "call me na"),
      m("her", "ruk", 1000),
      m("me", "call kar na yaar", 2000),
      m("her", "haan aa rahi hu", 3000),
    ];
    const inv = C.detectCallInvite(msgs, T0 + 4000);
    ok("the newest ask wins", inv?.askId === msgs[2].id, JSON.stringify(inv));
  }

  // spoken turns are not chat turns — an ask made ON a call is already being
  // answered by the call it was made on
  neg++;
  ok(
    "a spoken ask does not arm a chat ring",
    C.detectCallInvite(
      [m("me", "call me na", 0, { channel: "call" }), m("her", "haan", 2000)],
      T0 + 3000,
    ) === null,
  );

  // her last word being a picture is not an answer in words
  neg++;
  ok(
    "no anchor under a photo",
    C.detectCallInvite([m("me", "call me na"), m("her", "dekh", 2000, { kind: "photo" })], T0 + 3000) === null,
  );

  neg++;
  ok("empty thread", C.detectCallInvite([], T0) === null);
  neg++;
  ok("only her", C.detectCallInvite([m("her", "call karu?")], T0 + 1000) === null);
}

// ═══ 10. THE RING WINDOW ═══════════════════════════════════════════════════
//
// The 2-6s gap is the ONLY promise her pre-ring line is allowed to make, so
// both ends of it are pinned rather than sampled. `ringAt` takes its
// randomness as an argument for exactly this reason.
{
  console.log("\n── 10. the 2-6s ring window ──");
  const now = 1_000_000;
  pos++;
  ok("floor is 2s", C.ringAt(now, 0) === now + C.RING_MIN_MS);
  pos++;
  ok("ceiling is 6s", C.ringAt(now, 1) === now + C.RING_MAX_MS);
  pos++;
  ok("the window is 2-6s", C.RING_MIN_MS === 2000 && C.RING_MAX_MS === 6000);
  pos++;
  ok(
    "every sample lands inside it",
    Array.from({ length: 400 }, () => C.ringAt(now)).every(
      (t) => t >= now + C.RING_MIN_MS && t <= now + C.RING_MAX_MS,
    ),
  );
  pos++;
  ok(
    "out-of-range randomness still lands inside it",
    C.ringAt(now, -3) === now + C.RING_MIN_MS && C.ringAt(now, 7) === now + C.RING_MAX_MS,
  );
}

// ═══ 11. THE OWNER'S SCREENSHOT, END TO END ════════════════════════════════
//
// The permanent fixture. His line, her line in the SHAPE the corrected brief
// asks for, and the assertion that a ring is armed off it.
{
  console.log("\n── 11. the screenshot ──");
  const ask = m("me", "U can call me");
  const inv = C.detectCallInvite([ask, m("her", "achha ruk, karti hu", 3500)], T0 + 4000);
  pos++;
  ok("the owner's exact sentence rings", inv !== null && inv.via === "his-ask", JSON.stringify(inv));
  pos++;
  ok("…anchored on the ask he actually made", inv?.askId === ask.id);
  // and the line she used to say instead — a claim about her own limits — is
  // not something this module can prevent, but the ask underneath it is still
  // an ask, which is the whole point of the predicate arm.
  pos++;
  ok(
    "…and the stale refusal she used to send does not change the reading",
    C.detectCallInvite([ask, m("her", "call button click kar na", 3500)], T0 + 4000) !== null,
  );
}

// ═══ 12. THE WIRING, ASSERTED ON THE SOURCE ════════════════════════════════
//
// `dead-writers`: a predicate nothing calls is indistinguishable from a
// predicate that does not exist, and the specific failure mode this feature
// could have is worse than dead — a SECOND ring path alongside the callback
// one, so that "does she know she called" has two answers that can disagree.
// Read off the real file, like evals/burstwiring.mjs and
// evals/rupture-channel/run.mjs do for the properties they cannot reach.
{
  console.log("\n── 12. the trigger seam ──");
  const { readFileSync } = await import("node:fs");
  const chat = readFileSync(new URL("../src/components/Chat.tsx", import.meta.url), "utf8");
  // The NEGATIVE assertions below read CODE, never prose. The block that
  // wires this feature has to explain the callback seam it rides, so it names
  // `IncomingCall` and `sheCalled` in its comment — and a source assertion
  // that a comment can fail is an assertion that gets weakened until it
  // passes. Strip the line comments and ask the code.
  const uncomment = (s) => s.replace(/^\s*\/\/.*$/gm, "");
  const code = uncomment(chat);
  pos++;
  ok("the thread calls the detector", /detectCallInvite\(/.test(chat));
  pos++;
  ok(
    "…and rings through the CALLBACK seam App already owns",
    /callback:\s*\{\s*at,\s*secs:\s*0\s*\}/.test(chat),
  );
  pos++;
  ok("…with the 2-6s delay from the engine, not a local number", /ringAt\(Date\.now\(\)\)/.test(chat));
  neg++;
  ok("no second ring path: the thread never mounts IncomingCall itself", !/<IncomingCall/.test(code));
  neg++;
  ok(
    "…and never sets the caller direction, which is App's to own",
    !/setCallFrom\(|sheCalled=\{/.test(code),
  );
  neg++;
  ok(
    "a pending ring blocks a repeat ask from stacking",
    /if\s*\(state\.callback\)\s*return;/.test(code),
  );
  neg++;
  ok("an in-progress call blocks it too", /if\s*\(inCall\)\s*return;/.test(code));
  neg++;
  ok(
    "a call that already happened answers the ask",
    /kind === "callmark"/.test(code) && /sheCallArmed/.test(code),
  );
  neg++;
  ok("the taken ask survives a reload", /meera\.shecall\.taken/.test(code));
  // The reply machinery is not ours. If this fails, the wiring has grown a
  // hook into the burst clock and the split this file's header promises is
  // gone.
  const block = uncomment(
    chat.slice(chat.indexOf("── SHE CALLS HIM"), chat.indexOf("── windowing")),
  );
  neg++;
  ok(
    "the wiring touches no reply machinery",
    block.length > 200 && !/deliver\(|armBurst|replyCycle|scheduleReply|think\(/.test(block),
    `block ${block.length} chars`,
  );
}

console.log(
  `\npositive assertions: ${pos} · negative assertions: ${neg} (${(neg / pos).toFixed(2)}x)`,
);
if (neg < pos * 2) {
  console.log("FAIL the negative half must stay at least 2x the positive half");
  fails++;
}
console.log(fails ? `\n${fails} FAILURE(S)` : "\nall call-invite checks passed");
process.exit(fails ? 1 : 0);
