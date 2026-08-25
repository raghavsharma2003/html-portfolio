// THE SILENT NOTE — is a running memory note context, or is it a cue?
//
// WS-CALLMEM's answer to the tester's *"Hallucinating over long lasting
// conversations and forgetting what … I told her early on"* is to say the head
// of the call again, on a period, as context. The whole thing turns on ONE
// bit: `turnComplete`. Sent as `true` (the only shape `direct()` had) the note
// is a hard turn commit — she would answer it, out loud, every four minutes,
// which is a worse defect than the one being fixed. Sent as `false` it is
// appended to the session and never answered.
//
// A source regex can say the bit is written. Only this can say it reaches the
// wire. Same harness as rotatesim.mjs: the REAL src/voice/liveCall.ts,
// transpiled by build.mjs, driven against a simulated server, with every
// assertion observed from OUTSIDE the module — the frames the socket actually
// received.
//
//   node evals/echosim/build.mjs && node evals/echosim/notesim.mjs
//
// Run by hand, like rotatesim.mjs: it needs the transpile, and exp1.mjs is
// what verify-release cares about on this lane. The BEHAVIOURAL half that
// belongs in CI is in evals/callmem/run.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installWorld, clock } from "./world.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

installWorld();

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

/** Every clientContent frame this socket has been handed, parsed. */
const notesOn = (sock) =>
  (sock?.sent || []).filter((s) => s.includes('"clientContent"')).map((s) => JSON.parse(s).clientContent);

async function newCall(startLiveCall) {
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

const { startLiveCall } = await import("./build/voice/liveCall.js");

/* ── 1. the two shapes on the wire ───────────────────────────────────────── */
{
  console.log("\n── 1. a cue commits the turn; a note does not ──");
  const { sess } = await newCall(startLiveCall);
  sess.direct("<context: pick up the phone>");
  sess.direct("<context: your own memory of this call>", { silent: true });
  await pump(50);
  const notes = notesOn(sockets[0]);
  check("both frames reached the socket", notes.length === 2, `${notes.length}`);
  check("the CUE commits the turn", notes[0]?.turnComplete === true);
  check("the NOTE does not", notes[1]?.turnComplete === false, JSON.stringify(notes[1]?.turnComplete));
  check(
    "…and is otherwise the identical frame shape (one user text part)",
    notes[1]?.turns?.length === 1 &&
      notes[1].turns[0].role === "user" &&
      typeof notes[1].turns[0].parts?.[0]?.text === "string",
    JSON.stringify(notes[1]?.turns),
  );
  check("the note's text is carried verbatim", notes[1]?.turns?.[0]?.parts?.[0]?.text?.includes("your own memory"));
  check("no other frame kind was invented", notes.every((n) => Object.keys(n).sort().join() === "turnComplete,turns"));
}

/* ── 2. a note never guillotines her ─────────────────────────────────────── */
{
  console.log("\n── 2. a note sent mid-sentence waits for her, like every other note ──");
  const { sess } = await newCall(startLiveCall);
  sockets[0]?.recv({ serverContent: { modelTurn: { parts: [{ inlineData: { data: chunk(2) } }] } } });
  await pump(100);
  sess.direct("<context: mid-sentence note>", { silent: true });
  await pump(200);
  check("nothing was written into her sentence", notesOn(sockets[0]).length === 0, `${notesOn(sockets[0]).length}`);
  await pump(1400); // past direct()'s 1.2s cap
  check("it lands once the wait is over", notesOn(sockets[0]).length === 1);
  check("…still as context, not as a cue", notesOn(sockets[0])[0]?.turnComplete === false);
}

/* ── 3. a dead session swallows the note rather than throwing ────────────── */
{
  console.log("\n── 3. a note after the call is over is a no-op ──");
  const { sess } = await newCall(startLiveCall);
  sess.stop();
  await pump(20);
  const before = notesOn(sockets[0]).length;
  sess.direct("<context: too late>", { silent: true });
  await pump(50);
  check("no frame after teardown", notesOn(sockets[0]).length === before);
}

/* ── 4. THE NEGATIVE CONTROL ─────────────────────────────────────────────
   A check nobody has shown can fail is not a check. Patch the ONE bit back
   to the shape that shipped (`turnComplete: true`) in the transpiled build,
   re-import it, and confirm section 1 goes red — i.e. these assertions are
   measuring liveCall.ts and not themselves. */
{
  console.log("\n── 4. negative control: the bit put back the way it shipped ──");
  const src = join(HERE, "build/voice/liveCall.js");
  const code = readFileSync(src, "utf8");
  const anchor = "turnComplete: !opts?.silent";
  if (!code.includes(anchor)) {
    console.log(`  FAIL  the silent-note anchor is gone from the build — this control is measuring nothing`);
    fails++;
  } else {
    const patched = join(HERE, "build/voice/liveCall.nc.js");
    writeFileSync(patched, code.replace(anchor, "turnComplete: true"));
    const nc = await import("./build/voice/liveCall.nc.js");
    const { sess } = await newCall(nc.startLiveCall);
    sess.direct("<context: note>", { silent: true });
    await pump(50);
    const notes = notesOn(sockets[0]);
    check(
      "with the bit reverted, a silent note commits a turn — she would answer it out loud",
      notes[0]?.turnComplete === true,
      JSON.stringify(notes[0]?.turnComplete),
    );
    check("…which is exactly what section 1 asserts must not happen", notes.length === 1);
  }
}

console.log(fails ? `\n${fails} FAILED` : "\nnotesim ok");
process.exit(fails ? 1 : 0);
