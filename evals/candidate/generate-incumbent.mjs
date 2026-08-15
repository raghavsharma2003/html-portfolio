// evals/candidate/generate-incumbent.mjs — WS-INCARM
//
// Generates the swap-test INCUMBENT arm: google/gemini-3.6-flash replies for
// the same 2,304 corpus contexts evals/candidate/generate.mjs's --corpus
// path (WS-CANDGEN, terra arm) already served. Mirrors that script's corpus
// pool construction exactly (same corpus.jsonl ids, same corpus-lib.mjs
// sha256 verification, same single-turn {system,user} row shape) so
// {system,user} bytes are byte-identical across arms BY CONSTRUCTION — see
// docs/SWAP-TEST-PREREG.md Amendment 1. Like the terra arm, this does not
// send `full.tail`: corpus rows are single-turn stimuli and the terra pool
// build (generate.mjs buildCorpusPool()) never read `tail` either, so
// omitting it here is consistency with the already-generated arm, not a
// new deviation.
//
// ── production call shape, mirrored from api/chat.js (read-only import;
//    this file does not modify api/chat.js or api/_gkeys.js) ──────────────
//   DEFAULT_MODEL             api/chat.js:24   "google/gemini-3.6-flash"
//   SYSTEM_MAX (core cap)     api/chat.js:46   64_000
//   GEMINI_OPENAI_URL         api/chat.js:48
//   effort selection          api/chat.js:144  no_think ? "minimal" : "low"
//     — this run is the CHAT lane (no_think never set), so effort = "low".
//     config/models.json models["google/gemini-3.6-flash"].effort_map.chat
//     confirms: low = correct (21.0-22.8 words, 0 empty), minimal = BROKEN
//     (2.2 words, 4/5 EMPTY). "low" is required, not a default guess.
//   request body (model/messages/max_tokens)   api/chat.js:145-150
//   system content array + cache_control       api/chat.js:90-96
//   free-model name stripping "google/"        api/chat.js:178
//   free-pool call + reasoning_effort field     api/chat.js:181-186
//   empty-200-is-actually-exhausted guard        api/chat.js:197-208
//   paid OpenRouter fallback, reasoning:{effort} api/chat.js:226-246
//
// No temperature field is sent by production on EITHER lane (chat.js never
// sets one) — provider default. Recorded as such in the manifest rather
// than invented.
//
// ── HARD CONSTRAINTS (owner directive `judge-grant-only`, $0 cash) ────────
// 1. Free Gemini pool (api/_gkeys.js) ONLY by default. --allow-cash opts
//    into the OpenRouter cash fallback, mirroring api/chat.js's own
//    fallback shape; absent the flag, whole-pool exhaustion PAUSES the run.
// 2. --daily-cap N (default 1200) paces calls against the pool production
//    also uses live, every day. Counted per corpus unit dispatched (i.e.
//    per incumbent reply generated) — matches how a "call" reads to a
//    human operator; the up-to-3 key retries a single unit may need
//    internally (api/_gkeys.js MAX_TRIES) are that module's own existing
//    safety valve, not separate budget spend. Per-key cooldown on 429 is
//    inherited unmodified from api/_gkeys.js (COOL_MS=5min, SICK_MS=30s).
//    State is resumable (evals/candidate/out/incumbent-state.json) across
//    days/containers, tracked by UTC date.
// 3. Never print a raw key. Only an 8-hex sha256 prefix is ever logged.
// 4. Output shape matches the terra arm's corpus-candidate-transcript.json
//    rows exactly: {lane, beat, rep, turn, text, context}.
// 5. Read-only on api/*, evals/dbattery/*, the corpus/ dir, and every terra
//    output file (candidate-transcript.json, manifest.json,
//    corpus-candidate-transcript.json, corpus-manifest.json,
//    corpus-state.json, state.json) — this script only ever writes
//    corpus-incumbent-transcript.json, incumbent-manifest.json and
//    incumbent-state.json.
//
//   node evals/candidate/generate-incumbent.mjs                        → plan, no network call
//   WSINC_RUN=1 node evals/candidate/generate-incumbent.mjs --limit 20 → smoke run (~20 calls)
//   WSINC_RUN=1 node evals/candidate/generate-incumbent.mjs --limit 2304
//     → full run (coordinator's call, not fired by this task); re-running
//       the same command resumes from incumbent-state.json automatically.
//   add --daily-cap N to change the pool-pacing cap (default 1200).
//   add --allow-cash to permit the OpenRouter cash fallback on pool exhaustion
//     (absent by default per the owner directive).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "out");
const CORPUS_DIR = join(HERE, "corpus");

const { withGeminiKey, isQuota, isTransient, poolSize, poolHealth } = await import(
  join(ROOT, "api", "_gkeys.js")
);
const { OPENROUTER_KEY } = await import(join(ROOT, "api", "_config.js"));
const { getRowsByIds } = await import(join(HERE, "corpus-lib.mjs"));
const { wordCountStats, questionShare, mediaTagRate, devanagariHits } = await import(
  join(ROOT, "evals", "dbattery", "common.mjs"),
);

// ── production call shape (see header for line refs) ───────────────────
const MODEL = "google/gemini-3.6-flash"; // api/chat.js:24
const FREE_MODEL = "gemini-3.6-flash"; // api/chat.js:178 strips "google/"
const GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"; // api/chat.js:48
const EFFORT = "low"; // api/chat.js:144, chat lane (no_think unset)
const MAX_TOKENS = 800; // api/chat.js:148 default
const SYSTEM_MAX = 64_000; // api/chat.js:46
const CHAT_LANE = "text";

const OUT_TRANSCRIPT = join(OUT, "corpus-incumbent-transcript.json");
const OUT_MANIFEST = join(OUT, "incumbent-manifest.json");
const STATE_FILE = join(OUT, "incumbent-state.json");

const keyHash = (k) => createHash("sha256").update(k, "utf8").digest("hex").slice(0, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayKey = () => new Date().toISOString().slice(0, 10); // UTC date

// ── corpus pool (mirrors generate.mjs's buildCorpusPool exactly, minus
// terra-specific fields) — read-only on corpus/ ──────────────────────────
async function buildPool(limit) {
  const corpusPath = join(CORPUS_DIR, "corpus.jsonl");
  if (!existsSync(corpusPath)) {
    throw new Error(
      "evals/candidate/corpus/corpus.jsonl missing — run: node evals/candidate/corpus-generate.mjs",
    );
  }
  const compact = readFileSync(corpusPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const wanted = limit ? compact.slice(0, limit) : compact;

  const { found, missing } = await getRowsByIds(wanted.map((r) => r.id));
  if (missing.length) {
    throw new Error(
      `corpus integrity: ${missing.length} id(s) in corpus.jsonl did not regenerate. ` +
        `First missing: ${missing.slice(0, 5).join(", ")}`,
    );
  }
  const byId = new Map(found.map((r) => [r.id, r]));
  let mismatched = 0;
  const pool = wanted.map((idx) => {
    const full = byId.get(idx.id);
    if (full.sha256 !== idx.sha256) mismatched++;
    return {
      id: idx.id,
      lane: CHAT_LANE,
      beat: idx.stimulus_ref,
      rep: 0,
      turn: idx.state_variant_ref,
      system: full.system,
      user: full.messages[full.messages.length - 1].content,
      context: "compiled",
    };
  });
  if (mismatched) {
    console.error(
      `WARNING: ${mismatched} row(s) regenerated with a DIFFERENT sha256 than corpus.jsonl recorded — ` +
        `corpus-lib.mjs output has drifted. Re-run corpus-generate.mjs before trusting this run.`,
    );
  }
  return pool;
}

function buildFreeBody(u) {
  const sys = String(u.system);
  const systemContent = [
    { type: "text", text: sys.slice(0, SYSTEM_MAX), cache_control: { type: "ephemeral" } },
  ]; // api/chat.js:90-96
  return {
    model: FREE_MODEL,
    messages: [{ role: "system", content: systemContent }, { role: "user", content: u.user }],
    max_tokens: MAX_TOKENS,
    reasoning_effort: EFFORT, // api/chat.js:186
  };
}

// ── one unit's call: free pool first, optional cash fallback ───────────
async function callUnit(u, allowCash) {
  const started = Date.now();
  const body = buildFreeBody(u);
  let usedKeyHash = null;

  const got = await withGeminiKey(async (gkey) => {
    let r;
    try {
      r = await fetch(GEMINI_OPENAI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${gkey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      return { ok: false, retry: true, error: "network: " + (e?.message || "fetch failed") };
    }
    if (r.ok) {
      const text = await r.text();
      let content = "";
      let usage = null;
      try {
        const j = JSON.parse(text);
        content = j?.choices?.[0]?.message?.content ?? "";
        usage = j?.usage ?? null;
      } catch {
        content = "";
      }
      // api/chat.js:197-208 — a 200 with empty content is the worst outcome;
      // treat as exhausted so the next key is tried rather than recorded as
      // a real (empty) reply.
      if (!content.trim()) return { ok: false, exhausted: true };
      usedKeyHash = keyHash(gkey);
      return { ok: true, value: { text: content, usage } };
    }
    if (isQuota(r.status)) return { ok: false, exhausted: true };
    if (isTransient(r.status)) return { ok: false, retry: true, error: `gemini ${r.status}` };
    return { ok: false, error: `gemini ${r.status}` }; // our request is malformed — no point retrying
  });

  if (got.value) {
    return {
      text: got.value.text,
      usage: got.value.usage,
      ms: Date.now() - started,
      keyHash: usedKeyHash,
      via: "free",
    };
  }
  if (!got.triedAll) {
    // a genuine request error, not pool exhaustion — will fail identically
    // on every key/day, so this unit is marked errored, not paused-for-retry
    return { text: "", error: got.error || "request rejected", ms: Date.now() - started, via: "free-error" };
  }

  // whole free pool exhausted (or every key sick) for this attempt
  if (!allowCash) {
    return { text: "", error: "POOL_EXHAUSTED", ms: Date.now() - started, via: "paused" };
  }
  // ── --allow-cash: OpenRouter fallback, production's paid-lane shape (api/chat.js:226-246) ──
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Meera-WSINCARM",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: body.messages,
        max_tokens: MAX_TOKENS,
        reasoning: { effort: EFFORT },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) return { text: "", error: `openrouter ${r.status}`, ms: Date.now() - started, via: "cash-error" };
    const j = await r.json();
    return {
      text: j?.choices?.[0]?.message?.content ?? "",
      usage: j?.usage ?? null,
      ms: Date.now() - started,
      via: "cash",
    };
  } catch (e) {
    return { text: "", error: "openrouter network: " + (e?.message || "failed"), ms: Date.now() - started, via: "cash-error" };
  }
}

// ── resumable state ──────────────────────────────────────────────────────
function loadState() {
  if (!existsSync(STATE_FILE)) return { completed: {}, dailyCounts: {} };
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (!s.dailyCounts) s.dailyCounts = {};
    return s;
  } catch {
    return { completed: {}, dailyCounts: {} };
  }
}
function saveState(state) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
}

function planReport(pool) {
  console.log("── WS-INCARM plan (no network call — set WSINC_RUN=1 to fire) ──\n");
  console.log(`Context source: evals/candidate/corpus/corpus.jsonl — ${pool.length} rows (same ids the terra arm used).`);
  console.log(`Model: ${MODEL}  (free lane bare id: ${FREE_MODEL})  effort: ${EFFORT}  max_tokens: ${MAX_TOKENS}`);
  console.log(`Free pool: ${poolSize()} key(s) configured, health right now: ${poolHealth()}`);
  const state = loadState();
  const done = pool.filter((u) => state.completed[u.id]).length;
  console.log(`Already completed (resumed from incumbent-state.json): ${done}/${pool.length}`);
  const today = todayKey();
  console.log(`Calls made today (${today}) so far: ${state.dailyCounts[today] ?? 0}`);
  console.log(`\nSmoke: WSINC_RUN=1 node evals/candidate/generate-incumbent.mjs --limit 20`);
  console.log(`Full:  WSINC_RUN=1 node evals/candidate/generate-incumbent.mjs --limit ${pool.length}\n`);
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : null;
  const capIdx = args.indexOf("--daily-cap");
  const dailyCap = capIdx >= 0 ? Number(args[capIdx + 1]) : 1200;
  const allowCash = args.includes("--allow-cash");
  const RUN = process.env.WSINC_RUN === "1";

  const pool = await buildPool(limit);

  if (!RUN) {
    planReport(pool);
    process.exit(0);
  }

  const state = loadState();
  const today = todayKey();
  let dailyCount = state.dailyCounts[today] ?? 0;

  const todo = pool.filter((u) => !state.completed[u.id]);
  console.log(
    `── WS-INCARM live run — incumbent, ${pool.length} unit(s) requested, ${pool.length - todo.length} already ` +
      `done (resumed), ${todo.length} to call. Daily cap ${dailyCap}, already used today (${today}): ${dailyCount}. ` +
      `Cash fallback: ${allowCash ? "ALLOWED (--allow-cash)" : "OFF (free pool only)"} ──\n`,
  );

  if (dailyCount >= dailyCap) {
    console.log(
      `PAUSED before any call: today's cap (${dailyCap}) is already used (${dailyCount}). ` +
        `Done ${pool.length - todo.length}/${pool.length}, ${todo.length} remain. ` +
        `Resume tomorrow (UTC) with the same command — state resumes automatically from incumbent-state.json.`,
    );
    process.exit(0);
  }

  let capHit = false;
  let poolExhausted = false;
  const keyHashCounts = {};
  const viaCounts = {};
  let idx = 0;

  async function lane() {
    while (idx < todo.length) {
      if (dailyCount >= dailyCap) {
        capHit = true;
        return;
      }
      if (poolExhausted) return;
      const my = idx++;
      const u = todo[my];
      dailyCount++;
      state.dailyCounts[today] = dailyCount;

      const r = await callUnit(u, allowCash);
      viaCounts[r.via] = (viaCounts[r.via] || 0) + 1;

      if (r.error === "POOL_EXHAUSTED") {
        poolExhausted = true;
        // this attempt genuinely happened (real quota-consuming calls were
        // made against every key before giving up) but produced no reply —
        // do not mark completed, so it is retried on the next invocation.
        saveState(state);
        return;
      }

      if (r.keyHash) keyHashCounts[r.keyHash] = (keyHashCounts[r.keyHash] || 0) + 1;
      state.completed[u.id] = {
        id: u.id,
        lane: u.lane,
        beat: u.beat,
        rep: u.rep,
        turn: u.turn,
        context: u.context,
        reply: r.text,
        usage: r.usage ?? null,
        ms: r.ms,
        error: r.error ?? null,
        keyHash: r.keyHash ?? null,
        via: r.via,
        calledAt: new Date().toISOString(),
      };
      saveState(state);
      process.stdout.write(r.error ? "x" : r.text ? "." : "0");
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, lane));

  const doneNow = pool.filter((u) => state.completed[u.id]).length;
  const remaining = pool.length - doneNow;
  console.log(`\n\nCalls this invocation: ${Object.values(viaCounts).reduce((a, b) => a + b, 0)} (${JSON.stringify(viaCounts)})`);
  console.log(`Per-key call counts this invocation (keyHash -> n, no raw key ever logged): ${JSON.stringify(keyHashCounts)}`);
  console.log(`Pool health now: ${poolHealth()}`);

  if (poolExhausted) {
    console.log(
      `\nPAUSED: the free pool is exhausted (every key quota'd or sick) and --allow-cash was not passed. ` +
        `Done ${doneNow}/${pool.length}, ${remaining} remain. Free-tier quotas are commonly per-day; re-run the ` +
        `same command later today or after 00:00 UTC — state resumes automatically. Pass --allow-cash to overflow ` +
        `to OpenRouter cash instead (owner directive default: off).`,
    );
  } else if (capHit) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    console.log(
      `\nPAUSED: today's daily cap (${dailyCap}) reached. Done ${doneNow}/${pool.length}, ${remaining} remain. ` +
        `Resume at or after ${tomorrow.toISOString()} (next UTC day) with the same command — state resumes ` +
        `automatically from incumbent-state.json. Raise the cap with --daily-cap N if the owner wants a faster pace.`,
    );
  } else if (remaining === 0) {
    console.log(`\nCOMPLETE: ${doneNow}/${pool.length} done.`);
  } else {
    console.log(`\nStopped (limit reached for this invocation). Done ${doneNow}/${pool.length}, ${remaining} remain.`);
  }

  // ── write transcript + manifest, same shape as the terra arm ──────────
  const allDone = pool.map((u) => state.completed[u.id]).filter(Boolean);
  const transcript = allDone.map((u) => ({
    lane: u.lane,
    beat: u.beat,
    rep: u.rep,
    turn: u.turn,
    text: u.reply,
    context: u.context,
  }));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(OUT_TRANSCRIPT, JSON.stringify(transcript, null, 1));

  const withText = transcript.filter((t) => t.text);
  const nonEmpty = allDone.filter((u) => u.reply && u.reply.trim()).length;
  const errors = allDone.filter((u) => u.error).length;
  const stats = wordCountStats(withText);
  const q = questionShare(withText);
  const media = mediaTagRate(withText);
  const deva = devanagariHits(withText);

  console.log(`\n── verification (evals/dbattery/common.mjs counters, independently recomputed) ──`);
  console.log(`non-empty replies: ${nonEmpty}/${allDone.length} (${allDone.length ? ((100 * nonEmpty) / allDone.length).toFixed(1) : "0.0"}%)`);
  console.log(`errors: ${errors}/${allDone.length}`);
  console.log(
    `words/turn: mean=${stats.mean.toFixed(1)} median=${stats.median.toFixed(1)} p90=${stats.p90.toFixed(1)} (n=${stats.n})`,
  );
  console.log(`question share: ${(q * 100).toFixed(1)}%   media-tag rate: ${(media * 100).toFixed(1)}%   Devanagari hits: ${deva}`);

  const prior = existsSync(OUT_MANIFEST) ? JSON.parse(readFileSync(OUT_MANIFEST, "utf8")) : {};
  const manifest = {
    ...prior,
    model: MODEL,
    transportModelId: FREE_MODEL,
    endpoint: "google-ai-studio-free-pool (api/_gkeys.js), OpenRouter cash fallback only with --allow-cash",
    lane: "chat",
    params: {
      reasoning_effort: EFFORT,
      max_tokens: MAX_TOKENS,
      temperature: "not set by production on either lane (provider default) — recorded, not invented",
    },
    productionRefs: {
      "api/chat.js:24": "DEFAULT_MODEL",
      "api/chat.js:46": "SYSTEM_MAX (OPERATIONAL_CORE_CAP mirror)",
      "api/chat.js:48": "GEMINI_OPENAI_URL",
      "api/chat.js:144": 'effort = no_think === true ? "minimal" : "low" — chat lane uses "low"',
      "api/chat.js:145-150": "request body shape (model, messages, max_tokens)",
      "api/chat.js:90-96": "system content array + cache_control, mirrored (tail omitted — see file header)",
      "api/chat.js:178": 'free-model bare id, strips "google/"',
      "api/chat.js:181-224": "free-pool call via api/_gkeys.js withGeminiKey, reasoning_effort field",
      "api/chat.js:197-208": "empty-200-is-exhausted guard, mirrored",
      "api/chat.js:226-246": "paid OpenRouter fallback shape, reasoning:{effort} — only used with --allow-cash",
      "config/models.json": 'models["google/gemini-3.6-flash"].effort_map.chat confirms "low" is correct, "minimal" is BROKEN',
    },
    date: new Date().toISOString(),
    contextSource:
      "evals/candidate/corpus/corpus.jsonl — identical ids/order to the terra arm; every unit's sha256 checked " +
      "against the committed index before use. {system,user} byte-identical across arms by construction " +
      "(tail omitted, matching the terra arm's own pool build).",
    dailyCap,
    allowCash,
    counts: {
      total: pool.length,
      completed: doneNow,
      remaining,
      note: 'ALL turns are context:"compiled" (single-turn corpus stimuli), same as the terra arm.',
    },
    smoke: RUN
      ? {
          n: allDone.length,
          nonEmpty,
          errors,
          nonEmptyRate: allDone.length ? nonEmpty / allDone.length : 0,
          wordsPerTurn: stats,
          questionShare: q,
          mediaTagRate: media,
          devanagariHits: deva,
        }
      : prior.smoke,
  };
  writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 1));
  console.log(`\nWrote evals/candidate/out/corpus-incumbent-transcript.json (${transcript.length} turns)`);
  console.log(`Wrote evals/candidate/out/incumbent-manifest.json`);
}

await main();
