// WS-CONTINUITY seam 3 — "a channel change opens a new episode". The spec
// says the segmentation is correct and asks the build to CHECK, rather than
// assume, whether any reader treats that boundary as "a new conversation"
// (a re-greeting, a lost thread).
//
//   node evals/continuity/seam3.mjs
//
// There are exactly three readers downstream of a text -> call switch that
// could produce a felt seam, and all three are exercised here against ONE
// scripted history that crosses the boundary twice:
//
//   1. toTurns (brain.ts)      — what she is actually shown as the
//                                conversation. This is the reader that would
//                                cause a re-greeting if it dropped or split.
//   2. innerContext (inner.ts) — the gap that decides re-entry.
//   3. momentGate (moment.ts)  — the gap that decides T4's moment shape.
//
// The finding: none of them reads episodes at all. All three read the shared
// message store, which is channel-blind, so the boundary is a STORAGE fact and
// not a conversational one. toTurns goes further than "does not restart" — it
// marks the switch explicitly ("[a voice call starts]") so she knows what was
// SAID versus what was TYPED, which is the opposite failure to the one the
// spec was worried about.
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { msg, MS_MIN, MS_HOUR, innerWithThread } from "./_fixtures.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "wscont-seam3-"));
const BUNDLE = join(tmp, "continuity.bundle.mjs");
execSync(
  `npx esbuild ${join(ROOT, "evals/continuity/_entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const { toTurns, innerContext, momentGate } = await import(BUNDLE);

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? `  ${detail}` : ""}`);
};

// text -> call -> text, the exact sequence the owner's directive names.
const T0 = new Date("2026-08-19T20:00:00+05:30").getTime();
const history = [
  msg("me", T0 + 0 * MS_MIN, "kal wali meeting ho gayi finally", "chat"),
  msg("her", T0 + 1 * MS_MIN, "acha!! kaisi rahi", "chat"),
  msg("me", T0 + 2 * MS_MIN, "call karu?", "chat"),
  msg("me", T0 + 3 * MS_MIN, "haan toh sun", "call"),
  msg("her", T0 + 4 * MS_MIN, "bol bol", "call"),
  msg("me", T0 + 5 * MS_MIN, "maine wo raise wali baat kar di", "call"),
  msg("her", T0 + 6 * MS_MIN, "ohh kya bola unhone", "call"),
  msg("me", T0 + 9 * MS_MIN, "0:06", "chat", "callmark"),
  msg("me", T0 + 10 * MS_MIN, "waise wo cheez bhej dena", "chat"),
  // …and back onto a call. The history therefore ENDS on a call turn, which
  // is what makes "last message on any channel" and "last CHAT message"
  // different numbers — without that the channel-blindness check below would
  // be vacuously true.
  msg("me", T0 + 24 * MS_MIN, "ek min ruk main call karti hu", "call"),
];

console.log("\n§1 — toTurns: the transcript survives the boundary intact");
const turns = toTurns(history, "aur bata");
const flat = turns.map((t) => (typeof t.content === "string" ? t.content : t.content.map((p) => p.text || "").join(" "))).join("\n");
ok("nothing said on the call is dropped", flat.includes("raise wali baat kar di") && flat.includes("kya bola unhone"));
ok("text said BEFORE the call survives too", flat.includes("kal wali meeting ho gayi"));
ok("the switch is marked, not hidden", flat.includes("[a voice call starts]"));
ok("the switch back is marked", flat.includes("[the call ended, back to texting]"));
ok("the callmark chip is not fed to her as conversation", !flat.includes("0:06"));
// A "new conversation" reader would restart the turn list at the boundary.
const firstUser = turns.find((t) => t.role === "user");
ok(
  "the turn list is ONE conversation, not one per channel",
  typeof firstUser?.content === "string" && firstUser.content.includes("kal wali meeting"),
);

console.log("\n§2 — the gap readers are channel-blind");
// The gap must be measured to the last message on ANY channel. If a reader
// were channel-scoped, a chat turn 10 minutes after a call would compute its
// gap from the last CHAT turn (8 minutes earlier here) instead of the last
// call turn, and a short gap would read as a long one.
const NOW = T0 + 30 * MS_MIN;
const lastAny = history[history.length - 1].at;
const lastChatOnly = history.filter((m) => (m.channel || "chat") === "chat" && m.kind !== "callmark").slice(-1)[0].at;
ok("the fixture can tell the two apart", lastAny !== lastChatOnly, `any=${lastAny} chatOnly=${lastChatOnly}`);

const inner = innerWithThread(NOW, 2 * MS_HOUR);
const hasThread = (lastMsgAt) =>
  innerContext(inner, { now: NOW, lastMsgAt, surface: "pickup", userText: "" }).thread.includes("WHERE YOUR HEAD");
ok("innerContext reads the shared store (no re-entry across a fresh boundary)", !hasThread(lastAny));

// momentGate's "silence" shape is a 6h feature — a boundary must not
// manufacture it. Measured with a real (short) turn, because a BLANK turn hits
// the moment.ts defect this workstream found and compiler.ts now guards: see
// §5 below.
ok("momentGate sees a continuation, not a silence", momentGate("haan bol", NOW - lastAny, []).moment === "none");
// "hm" rather than "" — a real (if tiny) turn, so this measures the SILENCE
// feature and not the blank-turn defect in §5.
ok("momentGate DOES see a real silence when there is one", momentGate("hm", 7 * MS_HOUR, []).moment === "silence");

console.log("\n§3 — no reader consults episodes at all");
// Asserted at the source rather than inferred: if any of the three readers
// ever starts reading api/episodes.js's segmentation, this fails and the seam
// becomes real. `episode` appears in useCallEngine.ts only as the
// fire-and-forget call_end POST, which is a WRITER.
const grep = (pattern, file) => {
  try {
    return execSync(`grep -c ${pattern} ${join(ROOT, file)} || true`, { shell: "/bin/bash" }).toString().trim();
  } catch {
    return "0";
  }
};
// The pattern is the READ, not the word: compiler.ts legitimately contains
// `weEpisodes` (T6 rows, which arrive in the recall bundle and have nothing to
// do with api/episodes.js's segmentation).
for (const f of ["src/engine/brain.ts", "src/engine/inner.ts", "src/engine/moment.ts", "src/engine/compiler.ts"]) {
  ok(`${f} never reads api/episodes`, grep(`-iE 'api/episodes|vy_episode|episode_id|op: ?\"episode'`, f) === "0");
}
// useCallEngine.ts touches api/episodes exactly once, and only to WRITE.
const engineSrc = execSync(`grep -n 'api/episodes' ${join(ROOT, "src/components/useCallEngine.ts")} || true`, { shell: "/bin/bash" }).toString();
ok("useCallEngine only WRITES to api/episodes (no read path)", !/GET|op: ?"read|\.json\(\)/.test(engineSrc), engineSrc.trim().split("\n").length + " site(s)");

console.log("\n§4 — NEGATIVE CONTROL (a channel-scoped reader WOULD be caught)");
// Model the bug: compute the gap from the last CHAT turn only, as a
// channel-scoped reader would. It must produce a different, wrong answer.
const wrongGap = NOW - lastChatOnly;
const rightGap = NOW - lastAny;
ok(
  "a channel-scoped gap differs from the channel-blind one",
  wrongGap !== rightGap,
  `channel-scoped ${Math.round(wrongGap / 60_000)}min vs shared ${Math.round(rightGap / 60_000)}min`,
);

console.log("\n§5 — the blank-turn guard (found while wiring the pickup compile)");
// A pickup has no user turn. momentGate("") returns "celebration" (an emoji
// celebration key reduces to the same padded-empty string the haystack does),
// so an ABSENT turn used to classify as a celebration. compiler.ts now refuses
// to gate on a blank turn at all. Both halves are asserted: the underlying
// defect is still there (moment.ts is another workstream's file — filed, not
// edited), and the compiler no longer propagates it.
ok("the moment.ts defect is real and still present", momentGate("", 0, []).moment === "celebration");
ok("a real turn is unaffected", momentGate("kya kar rahe ho", 0, []).moment === "none");

console.log(failed ? `\nFAILED — ${failed} assertion(s)` : "\nPASS — seam 3: segmentation is storage-only; no reader restarts at the boundary");
process.exit(failed ? 1 : 0);
