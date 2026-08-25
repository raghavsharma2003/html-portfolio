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
import {
  mergeStates,
  mergeGame,
  MERGE_MESSAGE_CAP,
  SYNC_MESSAGE_CAP,
  syncableState,
} from "./.bundle.mjs";

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
  // `herNow` joined this list on the day it was added, which is the rule the
  // comment in syncableState states: her present moment is the same present
  // moment on the phone and on the laptop, or she is reading on one device
  // and doing something else on the other — the reported bug, arriving over
  // the wire instead of over a re-roll.
  for (const f of ["herLife", "herNow", "inner", "game", "activities", "tally", "momentsFired", "followup"]) {
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
  for (const f of ["herLife", "herNow", "inner", "game", "activities", "tally", "momentsFired", "callback", "recentMoment"]) {
    ok(`account switch resets ${f}`, upto.includes(`${f}:`), f);
  }
  // the game arrives from the same server row merge.ts shape-guards, and this
  // branch is the sibling that used to cast it straight in — a malformed
  // session adopted here is a white screen that then SYNCS
  ok("account switch shape-guards the game", /game:\s*isGameSession\(/.test(upto));
  ok("account switch coerces the user", /user:\s*safeUser\(/.test(upto));
}

// ── THE PULL (WS-SYNC) ────────────────────────────────────────────────────
//
// App.tsx now READS the account's copy on focus and on a gentle period, not
// only at boot. That turns `mergeStates` from a thing that runs on a 409 into
// a thing that runs every 90 seconds on every open device, so the properties
// below stopped being merge trivia and became the safety case for the pull.
// Each one is a way the pull could destroy a local write, and each one is
// answered in `mergeStates` rather than in the effect — the effect adds no
// merge semantics of its own, which is the point of it having none.
{
  const msg = (id, at, extra = {}) => ({ id, from: "me", kind: "text", text: id, at, ...extra });

  // 1. A LOCAL UNSENT MESSAGE. He typed on this device; the server copy is
  //    from before he did. The union is by id, so the pull cannot erase it.
  {
    const local = { ...base, messages: [msg("a", NOW - 2000), msg("unsent", NOW)] };
    const m = mergeStates(local, { messages: [msg("a", NOW - 2000)] });
    ok("pull keeps a local message the server has never seen",
      m.messages.some((x) => x.id === "unsent"), JSON.stringify(m.messages.map((x) => x.id)));
  }

  // 2. THE CLEAR-CHAT TOMBSTONE vs A STALE PEER. The other device still holds
  //    the whole pre-clear history and has no idea the chat was wiped. A pull
  //    must not resurrect it — in either direction.
  {
    const cleared = { ...base, clearedAt: NOW, messages: [msg("after", NOW + 10)] };
    const stalePeer = { messages: [msg("old1", NOW - 5000), msg("old2", NOW - 4000)] };
    const m = mergeStates(cleared, stalePeer);
    ok("pull cannot resurrect a cleared chat",
      m.messages.length === 1 && m.messages[0].id === "after",
      JSON.stringify(m.messages.map((x) => x.id)));
    ok("the tombstone survives the merge", m.clearedAt === NOW, String(m.clearedAt));
    // the reverse: THEY cleared, we are the stale one — their tombstone wins
    const m2 = mergeStates(
      { ...base, messages: [msg("old1", NOW - 5000)] },
      { clearedAt: NOW, messages: [msg("after", NOW + 10)] },
    );
    ok("a peer's newer tombstone clears us too",
      m2.clearedAt === NOW && m2.messages.length === 1 && m2.messages[0].id === "after",
      JSON.stringify(m2.messages.map((x) => x.id)));
  }

  // 3. A MERGE MAY ADD MESSAGES, NEVER SUBTRACT THEM. `slice(-500)` over the
  //    union read as "keep the last 500" and behaved as "delete the front of
  //    any longer history" — on a device where local history is deliberately
  //    unbounded. Rare while merges were rare; routine the moment a pull runs
  //    every 90 seconds, which is what makes this the pull's assertion.
  {
    const long = Array.from({ length: 2000 }, (_, i) => msg(`L${i}`, NOW - (2000 - i) * 1000));
    const m = mergeStates({ ...base, messages: long }, { messages: [msg("R", NOW + 1)] });
    ok("a merge never shortens the local history",
      m.messages.length === 2001, String(m.messages.length));
    ok("and the front of it is still there", m.messages[0].id === "L0", m.messages[0].id);
  }

  // 4. …while REMOTE growth stays bounded, or the floor would be a hole.
  {
    const remote = Array.from({ length: 900 }, (_, i) => msg(`R${i}`, NOW - (900 - i) * 1000));
    const m = mergeStates({ ...base, messages: [] }, { messages: remote });
    ok("remote-only growth is capped", m.messages.length === MERGE_MESSAGE_CAP, String(m.messages.length));
  }

  // 5. The wire can never overflow the floor: if the cap on what is SENT
  //    exceeded the floor a merge keeps, a pull could still truncate.
  ok("SYNC_MESSAGE_CAP <= MERGE_MESSAGE_CAP", SYNC_MESSAGE_CAP <= MERGE_MESSAGE_CAP,
    `${SYNC_MESSAGE_CAP} vs ${MERGE_MESSAGE_CAP}`);
  {
    const many = Array.from({ length: 1200 }, (_, i) => msg(`S${i}`, NOW - (1200 - i) * 1000));
    ok("syncableState honours the cap",
      syncableState({ ...base, messages: many }).messages.length === SYNC_MESSAGE_CAP);
  }

  // 6. TWO COPIES OF ONE MESSAGE: this device's is the newer truth about it
  //    (its status ticked to read here), so local is applied last.
  {
    const m = mergeStates(
      { ...base, messages: [msg("a", NOW, { status: "read" })] },
      { messages: [msg("a", NOW, { status: "sent" })] },
    );
    ok("local wins on a message both sides have", m.messages[0].status === "read", m.messages[0].status);
  }
}

// ── the pull's own wiring, read off the source ────────────────────────────
{
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const num = (name) => Number(new RegExp(`const ${name} = ([0-9_]+);`).exec(app)?.[1].replace(/_/g, ""));
  const period = num("PULL_PERIOD_MS");
  const gap = num("PULL_MIN_GAP_MS");
  const debounce = num("PULL_DEBOUNCE_MS");
  ok("the pull period is >= the 60s floor", period >= 60_000, String(period));
  ok("the min gap is below the period", gap > 0 && gap < period, `${gap} / ${period}`);
  ok("the debounce is below the min gap", debounce > 0 && debounce < gap, `${debounce} / ${gap}`);

  const eff = app.slice(app.indexOf("THE OTHER HALF OF SYNC: THE PULL"));
  const body = eff.slice(0, eff.indexOf("frontTick]"));
  ok("the pull merges, never adopts wholesale", /mergeStates\(s, remote\.state\)/.test(body));
  ok("a hidden tab reads nothing", /visibilityState !== "visible"/.test(body));
  ok("no pull while a call is up", /if \(!token \|\| inCall\) return;/.test(body));
  ok("the pull re-bases the revision", /serverRev\.current = remote\?\.updated_at/.test(body));
  ok("a dead token is surfaced, not retried", /authFailed\(e\)/.test(body));
  ok("boot's own load stamps the pull clock", /lastPullAt\.current = Date\.now\(\)/.test(app));
}

// ── what is NOT synced, and why — asserted rather than assumed ────────────
//
// The audit noted `recentMoment` and `callback` absent from `syncableState`.
// That is the DESIGN (`last-message-wins-cross-tab`'s leftover half): both are
// armed by something that just happened in ONE place — a call that dropped, a
// milestone that crossed — and neither is relational history. A pull that
// carried them would let a device that never saw the event clear the one that
// did. Exempt WITH A REASON, in the same spirit evals/teardown.mjs demands.
{
  const acct = readFileSync(new URL("../src/engine/account.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("../src/state/store.ts", import.meta.url), "utf8");
  for (const [f, why] of [
    ["recentMoment", "present-moment, 12h, armed by a crossing this device saw"],
    ["callback", "armed by a call that dropped on this device"],
    ["theme", "a phone on dark and a laptop on light is a feature"],
  ]) {
    ok(`syncableState deliberately omits ${f} (${why})`, !new RegExp(`\\n\\s*${f}: s\\.${f}`).test(acct), f);
  }
  // and the cross-tab handler, which sees the same two fields, keeps the copy
  // held by the tab that armed it
  ok("cross-tab keeps the armed callback", /callback: cur\.callback \?\? incoming\.callback/.test(store));
  ok("cross-tab keeps the armed recentMoment", /recentMoment: cur\.recentMoment \?\? incoming\.recentMoment/.test(store));
}

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
