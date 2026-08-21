// "cut the call" — src/engine/hangup.ts, against the CURRENT source.
//
// The MUST-NOT-FIRE half is the important half and it is deliberately the
// longer one. Missing a request costs him one tap on a button already on
// screen; a false fire drops him mid-sentence and there is no undo. So the
// cases below are weighted the way the risk is.
import { asksToHangUp } from "./.bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};

// ── he is asking to end the call ──────────────────────────────────────────
const ASKS = [
  "cut the call",
  "cut the call yaar",
  "end the call",
  "ok hang up",
  "hangup now",
  "disconnect the call",
  "phone rakh de",
  "call kaat de",
  "rakh de yaar",
  "rakh do na",
  "main rakhta hu",
  "chal rakhta hu",
  "baad me baat karte hai",
  "lets talk later",
  "call cut kar do",
];
for (const t of ASKS) ok(`asks: "${t}"`, asksToHangUp(t));

// ── NEGATIVE CONTROLS — ordinary call speech that must never end a call ───
// "bye" and "ok" are absent from the pattern list on purpose: people say both
// constantly in the middle of a conversation.
const NOT_ASKS = [
  "bye",
  "byee",
  "ok",
  "ok bye",              // said mid-call all the time before carrying on
  "acha theek hai",
  "haan bol",
  "call aa raha hai kisi ka",
  "mera phone hang ho raha hai",   // "hang" but about the device
  "yaar call quality kharab hai",
  "kal call karte hai",             // planning a FUTURE call, not ending this one
  "tera call kaat gaya tha kal",    // past tense, about a previous call
  "rakhi ka scene kya hai",         // "rakh" inside an unrelated word
  "baat karte rehna",
  "later dekhte hai",
  "mujhe kuch kaam hai",            // he may be leading up to it; not a request yet
  "",
  "  ",
  "no",
];
for (const t of NOT_ASKS) ok(`does NOT ask: "${t}"`, !asksToHangUp(t), JSON.stringify(t));

console.log(fail ? `${fail} FAILURES` : `ALL ${ASKS.length + NOT_ASKS.length} PASS`);
process.exit(fail ? 1 : 0);
