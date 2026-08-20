// ROTATION BEHAVIOUR — does a `goAway` still change her voice?
//
// Drives the REAL src/voice/liveCall.ts (transpiled by build.mjs) through a
// simulated Gemini Live server that sends `goAway` the way the real one does.
// Nothing here is an acoustic measurement — exp1.mjs owns the audio floor. This
// asks the one question the floor harness cannot: when the server announces a
// rotation, does the call STAY on the live model, and does it stay on the model
// and voice it started with?
//
// Every assertion is observed from outside liveCall.ts — sockets constructed,
// setup frames sent, onEnded calls — so none of it is the module agreeing with
// itself.
import { installWorld, clock, FakeWS } from "./world.mjs";

installWorld();
const { startLiveCall } = await import("./build/voice/liveCall.js");

// Every socket the module opens, in order. FakeWS.last only remembers one.
const sockets = [];
const RealWS = globalThis.WebSocket;
globalThis.WebSocket = class extends RealWS {
  constructor(url) {
    super(url);
    sockets.push(this);
  }
};
globalThis.WebSocket.OPEN = 1;

const yieldJobs = () => new Promise((r) => setImmediate(r));
const pump = async (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    clock.advanceTo(Math.min(end, Date.now() + 1));
    await yieldJobs();
  }
};

/** 24k PCM16 base64 of `sec` seconds — enough for playChunk to schedule it. */
const chunk = (sec) => {
  const n = Math.round(24000 * sec);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 12) * 8000), i * 2);
  return b.toString("base64");
};

const setupOf = (sock) => {
  if (!sock) return null;
  const f = sock.sent.find((s) => s.includes('"setup"'));
  return f ? JSON.parse(f).setup : null;
};

async function newCall() {
  sockets.length = 0;
  globalThis.__DIAG = [];
  globalThis.__ctxs.length = 0;
  const ended = [];
  let sess = null;
  const started = startLiveCall({
    base: "",
    system: "s",
    onState: () => {},
    onMyText: () => {},
    onHerText: () => {},
    onEnded: (r) => ended.push(r),
  }).then((s) => (sess = s));
  started.catch(() => {});
  await pump(20);
  sockets[0]?.recv({ setupComplete: {} });
  await pump(20);
  await started;
  if (!sess) throw new Error("session never started");
  return { sess, ended };
}

let fails = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  ok    ${name}`);
  else {
    console.log(`  FAIL  ${name}${detail ? "\n        " + detail : ""}`);
    fails++;
  }
};

/* ── 1. goAway MID-SENTENCE: the rotation waits, then keeps the model ────── */
{
  console.log("\n── 1. goAway arrives while she is speaking ──");
  const { sess, ended } = await newCall();
  // she starts a 3-second turn
  sockets[0]?.recv({
    serverContent: { modelTurn: { parts: [{ inlineData: { data: chunk(3) } }] } },
  });
  await pump(200);
  sockets[0]?.recv({ goAway: { timeLeft: "10s" } });
  await pump(1500); // well inside her turn AND past ROTATE_DELAY_MS, so an
  // immediate rotation would already have opened its replacement socket
  check("no rotation while she is mid-utterance", sockets.length === 1, `sockets=${sockets.length}`);
  await pump(4200); // past her turn AND past ROTATE_WAIT_MAX_MS
  check("a replacement socket was opened", sockets.length === 2, `sockets=${sockets.length}`);
  sockets[1]?.recv({ setupComplete: {} });
  await pump(50);
  check("the call was never handed to the cascade", ended.length === 0, `onEnded=${JSON.stringify(ended)}`);
  check("the session is still active", sess.active() === true);

  const a = setupOf(sockets[0]);
  const b = setupOf(sockets[1]);
  const voice = (s) => s?.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName;
  check("the rotated session names the SAME model", !!a && !!b && a.model === b.model, `${a?.model} vs ${b?.model}`);
  check("the rotated session names the SAME voice", !!voice(a) && !!voice(b) && voice(a) === voice(b), `${voice(a)} vs ${voice(b)}`);
  check(
    "the rotated session carries the SAME system instruction",
    !!b && JSON.stringify(a?.systemInstruction) === JSON.stringify(b?.systemInstruction),
  );

  const d = globalThis.__DIAG.map((x) => x.event);
  check("a live_goaway record exists", d.includes("live_goaway"));
  check("a live_rotate record exists", d.includes("live_rotate"));
  check("a live_rotated record exists", d.includes("live_rotated"));
  check("no live_close was recorded for the rotated socket", !d.includes("live_close"));
  const g = globalThis.__DIAG.find((x) => x.event === "live_goaway");
  check("live_goaway records whether she was speaking", g?.detail?.speaking === true);
  sess.stop();
  await pump(20);
}

/* ── 2. THE WAIT IS BOUNDED: she never stops, the rotation still happens ── */
{
  console.log("\n── 2. she never stops talking — the wait is capped, not open-ended ──");
  const { sess } = await newCall();
  sockets[0]?.recv({
    serverContent: { modelTurn: { parts: [{ inlineData: { data: chunk(60) } }] } },
  });
  await pump(200);
  const t0 = Date.now();
  sockets[0]?.recv({ goAway: {} }); // no timeLeft — the server gave no notice
  await pump(3000);
  check("still waiting at +3.0s", sockets.length === 1, `sockets=${sockets.length}`);
  await pump(1800);
  check(
    "rotated by +4.8s (ROTATE_WAIT_MAX_MS 4000 + ROTATE_DELAY_MS 500)",
    sockets.length === 2,
    `sockets=${sockets.length}`,
  );
  const rot = globalThis.__DIAG.find((x) => x.event === "live_rotate");
  check(
    "the wait it actually spent is recorded",
    rot?.detail?.waitedMs >= 4000 && rot.detail.waitedMs < 4600,
    `waitedMs=${rot?.detail?.waitedMs} (t0=${t0})`,
  );
  sess.stop();
  await pump(20);
}

/* ── 3. timeLeft IS RESPECTED: a short notice rotates immediately ───────── */
{
  console.log("\n── 3. a short timeLeft rotates at once rather than missing the deadline ──");
  const { sess } = await newCall();
  sockets[0]?.recv({
    serverContent: { modelTurn: { parts: [{ inlineData: { data: chunk(60) } }] } },
  });
  await pump(200);
  sockets[0]?.recv({ goAway: { timeLeft: "0.8s" } }); // less than ROTATE_GRACE_MS
  await pump(600); // only the ROTATE_DELAY_MS reconnect gap
  check("rotated inside the server's own notice period", sockets.length === 2, `sockets=${sockets.length}`);
  sess.stop();
  await pump(20);
}

/* ── 4. THE OLD SOCKET'S CLOSE IS NOT THIS CALL'S CLOSE ──────────────────── */
{
  console.log("\n── 4. the replaced socket's onclose must not tear the call down ──");
  const { sess, ended } = await newCall();
  sockets[0]?.recv({ goAway: { timeLeft: "10s" } });
  await pump(700);
  check("rotated (she was silent, so no wait was needed)", sockets.length === 2, `sockets=${sockets.length}`);
  // the real server closes the old socket AFTER we have moved on
  sockets[0]?.onclose?.({ code: 1011, reason: "server rotated" });
  await pump(50);
  check("a stale close did not end the call", ended.length === 0, `onEnded=${JSON.stringify(ended)}`);
  check("the session is still active", sess.active() === true);
  sockets[1]?.recv({ setupComplete: {} });
  await pump(20);
  // and a close on the CURRENT socket still does end it
  sockets[1]?.onclose?.({ code: 1006, reason: "" });
  await pump(50);
  check("a live close still hands the call back", ended.length === 1, `onEnded=${JSON.stringify(ended)}`);
}

/* ── 5. THE BUDGET: MAX_ROTATES = 6, then the cascade ────────────────────── */
{
  console.log("\n── 5. a goAway storm is budgeted, not infinite ──");
  const { ended } = await newCall();
  for (let i = 0; i < 8; i++) {
    const cur = sockets[sockets.length - 1];
    cur?.recv({ goAway: { timeLeft: "10s" } });
    await pump(700);
    const fresh = sockets[sockets.length - 1];
    if (fresh !== cur) fresh.recv({ setupComplete: {} });
    await pump(50);
  }
  check("exactly 6 rotations were taken", sockets.length === 7, `sockets=${sockets.length} (1 + rotations)`);
  const spent = globalThis.__DIAG.filter((x) => x.event === "live_rotate_spent").length;
  check("the exhausted budget is recorded rather than silent", spent >= 1, `live_rotate_spent x${spent}`);
  check("the call has not been dropped yet", ended.length === 0, `onEnded=${JSON.stringify(ended)}`);
  // budget spent: the next close is a real close and the cascade takes over
  sockets[sockets.length - 1]?.onclose?.({ code: 1011, reason: "" });
  await pump(50);
  check("after the budget, a close falls back exactly as before", ended.length === 1, `onEnded=${JSON.stringify(ended)}`);
}

console.log(
  fails ? `\nrotation behaviour NOT proven (${fails} failure${fails > 1 ? "s" : ""})` : "\n  ok  rotation keeps the model, the voice and the call",
);
process.exit(fails ? 1 : 0);
