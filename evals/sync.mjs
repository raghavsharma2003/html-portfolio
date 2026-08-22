// The sync merge — the seam the 2026-08-22 audit found half-dead.
//
// syncableState's push list had lagged AppState by five fields: herLife and
// inner were MERGED on receive but never SENT (the merge lines could never
// see data), and game/tally/momentsFired neither pushed nor merged — a second
// device lost the chess game and REPLAYED celebrations, because the
// fired-ledger is precisely the thing that must be a union. These assertions
// hold the push list, the merge semantics, and the account-switch reset to
// the same field inventory, so the next AppState field cannot lag silently.
import { readFileSync } from "node:fs";
import { mergeStates, mergeGame } from "./.bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const NOW = 1_800_000_000_000;
const base = {
  onboarded: true, deviceId: "d1", user: { name: "R" },
  messages: [{ id: "a", from: "me", kind: "text", text: "hi", at: NOW - 1000 }],
  openrouterKey: "", openrouterModel: "", apiKey: "", elevenKey: "", elevenVoiceId: "",
  sarvamKey: "", deviceVoice: "", lastSeen: NOW,
};

// ── the ledger is a UNION — the anti-replay property ──────────────────────
{
  const m = mergeStates(
    { ...base, momentsFired: ["days-7", "msgs-100"] },
    { momentsFired: ["days-7", "first-game"] },
  );
  ok("momentsFired unions", JSON.stringify([...m.momentsFired].sort()) ===
    JSON.stringify(["days-7", "first-game", "msgs-100"]), JSON.stringify(m.momentsFired));
}

// ── tallies take per-field max (monotonic floors) ─────────────────────────
{
  const m = mergeStates(
    { ...base, tally: { chessGames: 3, chessWinsHer: 2 } },
    { tally: { chessGames: 2, chessWinsHer: 4, wyrCards: 10 } },
  );
  ok("tally is per-field max", m.tally.chessGames === 3 && m.tally.chessWinsHer === 4 && m.tally.wyrCards === 10,
    JSON.stringify(m.tally));
}

// ── the game merges wholesale, never field-by-field ───────────────────────
{
  const g1 = { kind: "wyr", salt: "s", startedAt: 100, seen: ["a"], rounds: [] };
  const g2 = { kind: "wyr", salt: "s", startedAt: 200, seen: ["b"], rounds: [] };
  ok("newer sitting wins", mergeGame(g1, g2).startedAt === 200);
  ok("null remote keeps local", mergeGame(g1, null) === g1);
  ok("null local takes remote", mergeGame(null, g2) === g2);
  const same1 = { ...g1, rounds: [{ cardId: "a", his: "a", her: "a" }] };
  ok("same sitting: more progress wins", mergeGame(g1, same1) === same1);
  const closed = { ...g1, closedAt: 500 };
  ok("same sitting: a close beats an open", mergeGame(g1, closed) === closed);
}

// ── the push list carries every relational field ──────────────────────────
{
  const acct = readFileSync(new URL("../src/engine/account.ts", import.meta.url), "utf8");
  for (const f of ["herLife", "inner", "game", "tally", "momentsFired", "followup"]) {
    ok(`syncableState pushes ${f}`, new RegExp(`${f}: s\\.${f}`).test(acct));
  }
  // theme is a device preference by decision — it must NOT sync
  ok("theme does not sync", !/theme: s\.theme/.test(acct));
}

// ── the account switch resets everything relational ───────────────────────
// The bleed the audit caught: a new account inheriting the previous one's
// chess game, ledger, tallies and her inner life.
{
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const branch = app.slice(app.indexOf("lastAccountId && s.lastAccountId !== fresh.userId"));
  const upto = branch.slice(0, branch.indexOf("};"));
  // recentMoment joined this list the second time the same hole was found:
  // it survived BOTH the account switch and "make her forget you", so she
  // brought up a hundred-day milestone in the conversation that starts by not
  // knowing you — and momentLine feeds sharedVocab, so the honesty layer
  // scored that invented history as supported. evals/teardown.mjs now checks
  // this class mechanically; this line is the specific field.
  for (const f of ["herLife", "inner", "game", "tally", "momentsFired", "callback", "recentMoment"]) {
    ok(`account switch resets ${f}`, upto.includes(`${f}:`), f);
  }
  // the game arrives from the same server row merge.ts shape-guards, and this
  // branch is the sibling that used to cast it straight in — a malformed
  // session adopted here is a white screen that then SYNCS
  ok("account switch shape-guards the game", /game:\s*isGameSession\(/.test(upto));
  ok("account switch coerces the user", /user:\s*safeUser\(/.test(upto));
}

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
