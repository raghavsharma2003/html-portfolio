// The milestones engine — the OS half of "gamify the whole experience".
//
// The assertions guard the three properties that make celebration trustworthy
// rather than manipulative: a moment fires ONCE ever; an imported history
// fires only the largest crossed tier per family (no stale confetti
// fusillade); and nothing here is time-scheduled — eligibility comes from the
// record alone, so a detector run at two different times with the same record
// agrees except where real time crossed a day tier.
import { detectMoments, momentFact } from "./.bundle.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) { fail++; console.log(`FAIL ${name}${extra ? " — " + extra : ""}`); }
};

const NOW = Date.UTC(2026, 7, 22, 12, 0);
const DAY = 86_400_000;
const msg = (at) => ({ id: String(at), from: "me", kind: "text", text: "hi", at });
const msgs = (n, firstAt) => Array.from({ length: n }, (_, i) => msg(firstAt + i * 60_000));

// ── fire-once is the whole contract ───────────────────────────────────────
{
  const inp = { messages: msgs(120, NOW - 8 * DAY), fired: [], tally: null, nowMs: NOW };
  const first = detectMoments(inp);
  ok("a week + 100 messages fires", first.length >= 2, JSON.stringify(first.map((m) => m.id)));
  const after = detectMoments({ ...inp, fired: first.map((m) => m.id) });
  ok("nothing fires twice", after.length === 0, JSON.stringify(after.map((m) => m.id)));
}

// ── imported history: largest tier only, per family ───────────────────────
{
  const inp = { messages: msgs(1200, NOW - 120 * DAY), fired: [], tally: null, nowMs: NOW };
  const got = detectMoments(inp);
  const dayIds = got.filter((m) => m.kind === "days-known").map((m) => m.id);
  const msgIds = got.filter((m) => m.kind === "messages").map((m) => m.id);
  ok("one day-tier only, the largest", dayIds.length === 1 && dayIds[0] === "days-100", dayIds.join(","));
  ok("one msg-tier only, the largest", msgIds.length === 1 && msgIds[0] === "msgs-1000", msgIds.join(","));
}

// ── game moments come from the tally, written at close ────────────────────
{
  const inp = {
    messages: msgs(5, NOW - DAY), fired: [],
    tally: { chessGames: 1, chessWinsHer: 1 }, nowMs: NOW,
  };
  const ids = detectMoments(inp).map((m) => m.id);
  ok("first game fires", ids.includes("first-game"), ids.join(","));
  ok("her first win fires", ids.includes("chess-first-win-her"), ids.join(","));
  ok("his first win does NOT (he hasn't won)", !ids.includes("chess-first-win-him"));
}

// ── empty record, empty result — the common case costs nothing ────────────
ok("empty record fires nothing",
  detectMoments({ messages: [], fired: [], tally: null, nowMs: NOW }).length === 0);

// ── determinism ───────────────────────────────────────────────────────────
{
  const inp = { messages: msgs(600, NOW - 40 * DAY), fired: [], tally: { wyrCards: 30 }, nowMs: NOW };
  ok("same input, same moments",
    JSON.stringify(detectMoments(inp)) === JSON.stringify(detectMoments(inp)));
}

// ── momentFact obeys the activity-facts shapelint ─────────────────────────
{
  const all = detectMoments({
    messages: msgs(1200, NOW - 400 * DAY), fired: [],
    tally: { chessGames: 30, chessWinsHim: 1, chessWinsHer: 1, tttGames: 2, wyrCards: 120 },
    nowMs: NOW,
  });
  ok("a rich record yields several", all.length >= 5, String(all.length));
  for (const m of all) {
    const f = momentFact(m);
    ok(`fact <=14 words: ${m.id}`, f.trim().split(/\s+/).length <= 14, f);
    ok(`fact not sentence-shaped: ${m.id}`, !/^[A-Z][^.?!]*[.?!]$/.test(f), f);
    ok(`fact not first-person: ${m.id}`, !/^(i|main|mai)\b/i.test(f), f);
  }
}

// ── the charter: no anxiety mechanics can even be expressed ───────────────
// Structural, on the real source: the module must contain no streak language,
// no loss framing, no urgency vocabulary. If a future edit adds "don't lose
// your streak", this is what catches it.
import { readFileSync } from "node:fs";
const srcRaw = readFileSync(new URL("../src/engine/milestones.ts", import.meta.url), "utf8");
// Comment-blind: the module's header NAMES the banned mechanics in order to
// ban them, and a check that flags the ban's own wording teaches people to
// write vaguer comments. The check is about CODE — ids, titles, facts.
const src = srcRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
for (const banned of ["streak", "expire", "lose your", "hurry", "last chance", "don't break"]) {
  ok(`charter: no "${banned}" in the code`, !src.toLowerCase().includes(banned));
}
ok("charter: detection is never time-scheduled",
  /FIRES only on the next real interaction/.test(srcRaw));

// ── the human/game boundary (owner, 2026-08-22) ──────────────────────────
// "If the chat is gamified much then the whole intent of her being human is
// lost." Celebration cards may exist ONLY in game mode; relationship moments
// (days/messages/calls) are always silent — Us-timeline only.
{
  const hook = readFileSync(new URL("../src/components/useMoments.ts", import.meta.url), "utf8");
  ok("game kinds are enumerated", /GAME_KINDS = new Set/.test(hook));
  ok("relationship moments are silent by construction",
    /filter\(\(m\) => !GAME_KINDS\.has\(m\.kind\)\)/.test(hook));
  ok("celebration requires game mode", /gameOpen \? all\.find/.test(hook));
  // SUPERSEDED PIN (audit finding #18): the first behaviour BURNED a game
  // moment detected outside game mode into the ledger — combined with the
  // 900ms detection debounce, leaving the board fast consumed the first-win
  // celebration forever. The moment is now left ELIGIBLE (silentIds carries
  // only the relationship moments), so the next board open celebrates it;
  // the boundary holds because the card gate above is still gameOpen-only.
  ok("a game moment caught outside game mode stays eligible, never burned",
    /const silentIds = silent\.map\(\(m\) => m\.id\);/.test(hook));
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  ok("App renders Celebration only in game mode",
    /activity !== null && \(\s*<Celebration/.test(app));
  ok("App passes gameOpen", /useMoments\(state, setState, inCall, activity !== null\)/.test(app));
}

// ── #117: she gets to mention a crossed milestone herself ─────────────────
// The seam is three writes and one render, all structural, all pinnable:
// the detector stamps state.recentMoment with momentFact() at fire time,
// the chat lane hands it to the brain, and the brain renders it ONLY while
// fresh AND joins it to the honesty gate's support set — without that last
// part, "100 din ho gaye humein" would be flagged as an invented shared
// past by the very gate built to catch invented shared pasts.
{
  const { readFileSync } = await import("node:fs");
  const store = readFileSync(new URL("../src/state/store.ts", import.meta.url), "utf8");
  ok("state carries recentMoment", /recentMoment\?: \{ id: string; fact: string; at: number \} \| null;/.test(store));
  const hook = readFileSync(new URL("../src/components/useMoments.ts", import.meta.url), "utf8");
  ok("detector stamps recentMoment with momentFact", (hook.match(/recentMoment: \{ id: [^}]*fact: momentFact\(/g) || []).length >= 2);
  const brain = readFileSync(new URL("../src/engine/brain.ts", import.meta.url), "utf8");
  ok("brain renders the moment only while fresh", /MOMENT_FRESH_MS/.test(brain) && /keys\.moment && Date\.now\(\) - keys\.moment\.at < MOMENT_FRESH_MS/.test(brain));
  ok("the moment joins the family-4 support set", /sharedVocab: sharedVocabulary\(\[[\s\S]*?momentLine[\s\S]*?\]\)/.test(brain));
  ok("the moment joins trustedText", /trustedText: \[[\s\S]*?momentLine[\s\S]*?\]/.test(brain));
  const chat = readFileSync(new URL("../src/components/Chat.tsx", import.meta.url), "utf8");
  ok("chat lane hands it over", /moment: state\.recentMoment \?\? null/.test(chat));

  // every kind's fact is telegraphic: <=14 words, no first person, no "I"
  const inpAll = {
    messages: msgs(1200, NOW - 400 * DAY),
    fired: [],
    tally: { chessGames: 5, chessWinsHim: 1, chessWinsHer: 1, tttGames: 1, wyrCards: 25 },
    nowMs: NOW,
  };
  for (const m of detectMoments(inpAll)) {
    const f = momentFact(m);
    ok(`fact for ${m.id} is telegraphic`, f.split(/\s+/).length <= 14 && !/\bI\b/.test(f), f);
  }
}

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
