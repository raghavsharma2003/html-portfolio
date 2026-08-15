// evals/candidate/generate.mjs — WS-CANDGEN
//
// Generates the swap-test candidate arm: gpt-5.6-terra (Azure Foundry)
// replaying turns under the compiled context the INCUMBENT saw, from the
// archived bake-offs in evals/archives/. Output is a candidate-arm transcript
// in the {lane, beat, rep, turn, text} shape evals/archives/load.mjs and
// evals/dbattery/common.mjs already consume, plus a manifest documenting
// sampling params and — the load-bearing number — how many of those turns
// carry a byte-identical served prompt vs a reconstructed one.
//
// ── THE BYTE-IDENTICAL FINDING (read this before trusting any output here) ─
//
// docs/SWAP-TEST-PREREG.md's "context premise" and context/decisions.md's
// `swap-prereg-1` both name this script's job precisely: report exactly how
// many archived turns carry a full served prompt, mark the rest
// "reconstructed", and exclude reconstructed turns from any byte-identical
// claim. Verified against the raw archive files (not the load.mjs-normalized
// shape, which drops the fields this check needs — see NOTE ON load.mjs
// below):
//
//   charm-grok  turn keys: user, reply, finish, ms, cost, in, out, cached, reasoning
//   charm-luna  turn keys: user, reply, ms, cost, in, out
//   realtime-azure: no per-turn user/persona at all (register.json is
//     {s,i,firstAudioMs,said,heard,devanagari,hinglishHits,words,...}) —
//     not chat-lane, not replayable, excluded outright.
//
// NO archive has a field that is, or claims to be, the literal request
// payload sent to the model. What charm-grok/charm-luna DO store, verbatim:
// a single top-level `personaText`/`personaVoice` string reused for every
// turn/beat/rep in that file, plus each turn's `user` stimulus and the
// model's own `reply`. That is enough to ASSEMBLE {system, history, user} —
// every component byte-identical to what the archive recorded — but it is
// not itself a stored serving prompt: these bake-off rigs are, per
// evals/archives/README.md, "three rigs' native dialects", not
// src/engine/compiler.ts, and nothing here confirms the persona string was
// the model's ENTIRE system content (compiler.ts's real CompileInput also
// carries messageCount/relBundle/herLife/innerThread/ageGates/etc. that no
// archive records — see src/engine/__fixtures__/compiler.fixtures.ts).
// scripts/replay.mjs's own SCOPE GAP note reaches the same conclusion
// independently, from the live-DB side: `compile.manifest` (SPEC §3.3) was
// never wired, so no versioned per-turn record of a served prompt exists
// ANYWHERE in this codebase, archives or production.
//
// Conclusion, stated as the rule this file codes: BYTE-IDENTICAL COUNT = 0.
// Every generated turn is marked context:"reconstructed" and excluded from
// the byte-identical tally in the manifest, per the brief's explicit
// instruction not to call an assembly-from-verbatim-components "byte-
// identical" just because its parts are individually verbatim.
//
// ── POOL SIZE (the second finding) ──────────────────────────────────────
//
// Chat-lane (text-lane; docs/SWAP-TEST-PREREG.md scopes this run to chat
// only) incumbent conversations available to replay:
//   charm-grok  (pb-merged1/2, google/gemini-3.6-flash, lane=text): 144 turns
//   charm-luna  (pb-raw/pb-raw2, google/gemini-3.6-flash, lane=text): 144 turns
//   total unique reconstructed chat-lane units: 288
//
// evals/dbattery/d1.mjs's own header already says this in different words:
// "SPEC §14.2 wants '≥2,000 turns/arm from replayed manifests' of a LIVE
// candidate... What this file delivers today is the archive-scale recompute
// (≤300 turns/arm, the data that exists)." 288 matches that ≤300 ceiling.
// The archives structurally CANNOT supply 2,000 turns, byte-identical or
// reconstructed — reaching 2,000 requires either repeated temperature=1
// sampling of these same 288 contexts (more DRAWS, not more DISTINCT
// contexts — labelled as such below) or scripts/replay.mjs's live-session
// path, which needs compile.manifest wired first (ticketed, not this file's
// job). This is exactly context/decisions.md `swap-prereg-1`'s named
// reversal condition; report it to the coordinator, do not paper over it.
//
// ── NOTE ON load.mjs ────────────────────────────────────────────────────
// The brief says "via load.mjs". loadFixtureIndex() is used below for the
// reference-band/usable_for_d0 metadata. But loadFixture()'s public shape
// (evals/archives/load.mjs `batteryTurns`) flattens turns to
// {lane,beat,rep,turn,text:reply} — it drops `user` and never exposes
// personaText/personaVoice at all, because its only documented consumers
// (D0/D1) need reply text, not prompts. That shape cannot support prompt
// replay. This file reads the same raw archive files load.mjs reads
// (evals/archives/<id>/*.json) directly, for exactly the two fields
// load.mjs's normalizer discards. Nothing here duplicates or rewrites
// load.mjs's own logic; archives are still read read-only, never modified.
//
//   node evals/candidate/generate.mjs                 → plan + cost projection, no network call
//   WSCAND_RUN=1 node evals/candidate/generate.mjs --limit 20   → smoke run, ~20 calls
//   WSCAND_RUN=1 node evals/candidate/generate.mjs --limit 2000 → full run (NOT fired by this task)
//
// ── --corpus: WS-CORPUS integration (Amendment 1) ───────────────────────
// Everything above this note describes the ORIGINAL archive-replay design,
// which Amendment 1 (docs/SWAP-TEST-PREREG.md, context/decisions.md
// `swap-prereg-amend-1`) superseded: archive replay caps at 288 pool
// positions (72 distinct texts — see evals/candidate/corpus-generate.mjs's
// header) and was never byte-identical to anything. Passing `--corpus`
// switches the context SOURCE for both arms to
// evals/candidate/corpus/corpus.jsonl — ≥2,000 distinct (stimulus,
// compiled-state) pairs compiled fresh through the REAL
// src/engine/compiler.ts (byte-identical ACROSS ARMS by construction: the
// same compiled bytes go to both models). This does not change what this
// file DOES with a unit once it has one (still calls Terra, still verifies
// with common.mjs's counters, still resumable) — only where the
// {system, user} pair for each unit comes from. Every existing mode
// (no flag) is unchanged; corpus.jsonl and its regeneration script
// (corpus-lib.mjs) are read-only from here.
//
//   node evals/candidate/generate.mjs --corpus                       → plan, corpus mode, no network call
//   WSCAND_RUN=1 node evals/candidate/generate.mjs --corpus --limit 20     → smoke run against the corpus
//   WSCAND_RUN=1 node evals/candidate/generate.mjs --corpus --limit 2000  → full corpus run (NOT fired by this task)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const ARCHIVES = join(ROOT, "evals", "archives");
const OUT = join(HERE, "out");

const { AZURE_ENDPOINT, AZURE_KEY } = await import(join(ROOT, "api", "_config.js"));
const { loadFixtureIndex } = await import(join(ARCHIVES, "load.mjs"));
const { wordCountStats, questionShare, mediaTagRate, rawWords } = await import(
  join(ROOT, "evals", "dbattery", "common.mjs")
);

// process.env override mirrors every other api/*.js Azure caller's pattern
// (api/memory.js, api/consolidate.js, api/_embed.js) — never logged, either form.
const AZ_ENDPOINT = process.env.AZURE_ENDPOINT || AZURE_ENDPOINT;
const AZ_KEY = process.env.AZURE_API_KEY || AZURE_KEY;

// ── Terra deployment quirks (context/measurements.md `d2-credits`, baked in) ─
// rejects max_tokens (wants max_completion_tokens); rejects temperature!=1;
// silently burns the whole budget on hidden reasoning and returns EMPTY
// completions unless reasoning_effort:"none".
const TERRA_MODEL = "gpt-5.6-terra";
const TERRA_PARAMS = { max_completion_tokens: 400, temperature: 1, reasoning_effort: "none" };

const CHAT_LANE = "text"; // docs/SWAP-TEST-PREREG.md: "Scope: the CHAT lane only."

// ── archive sources for chat-lane incumbent conversations ──────────────────
// Both give the INCUMBENT's own multi-turn conversation (its own replies
// feeding its own next-turn history) — the actual context it saw — not the
// candidate arm's conversation, which is a different sequence of replies.
const SOURCES = [
  {
    archive: "charm-grok",
    files: ["pb-merged1.json", "pb-merged2.json"],
    incumbentModel: "google/gemini-3.6-flash",
  },
  {
    archive: "charm-luna",
    files: ["pb-raw.json", "pb-raw2.json"],
    incumbentModel: "google/gemini-3.6-flash",
  },
  // realtime-azure deliberately excluded: no persona/system field, no `user`
  // stimulus, no lane=text data at all (register.json is call-lane only) —
  // see file header. Not in scope (chat-lane-only run) even if it were replayable.
];

function readArchiveFile(archive, file) {
  return JSON.parse(readFileSync(join(ARCHIVES, archive, file), "utf8"));
}

// Build the fixed pool of replay units. Each unit is one incumbent turn plus
// everything needed to reconstruct — never claim byte-identical — its input.
function buildPool() {
  const pool = [];
  const evidence = [];
  for (const src of SOURCES) {
    src.files.forEach((file, rep) => {
      const doc = readArchiveFile(src.archive, file);
      evidence.push({
        archive: src.archive,
        file,
        turnKeysSeen: Array.from(
          new Set(
            doc.results.flatMap((r) => r.turns.flatMap((t) => Object.keys(t))),
          ),
        ).sort(),
        hasPromptField: false, // verified false — see header; recomputed defensively below
      });
      const convs = doc.results.filter((r) => r.model === src.incumbentModel && r.lane === CHAT_LANE);
      for (const conv of convs) {
        conv.turns.forEach((t, i) => {
          pool.push({
            archive: src.archive,
            lane: CHAT_LANE,
            beat: conv.beat,
            rep,
            turn: i,
            system: doc.personaText, // verbatim, file-wide constant
            history: conv.turns.slice(0, i).map((h) => ({ user: h.user, assistant: h.reply })),
            user: t.user, // verbatim stimulus
            incumbentReply: t.reply, // verbatim, kept for the manifest's reference only
            context: "reconstructed", // see header — never "byte-identical"
          });
        });
      }
    });
  }
  // defensive re-verification, not a trust-the-comment assertion: fail loud
  // if a future archive edit ever adds a literal prompt/servedPrompt field
  const promptFieldFound = evidence.some((e) =>
    e.turnKeysSeen.some((k) => /prompt|servedcontext|compiled/i.test(k)),
  );
  return { pool, evidence, promptFieldFound };
}

// ── WS-CORPUS integration (Amendment 1) — pool built from
// evals/candidate/corpus/corpus.jsonl instead of the archives. corpus.jsonl
// holds only the COMPACT index ({id, stimulus_ref, state_variant_ref,
// sha256} — see corpus-generate.mjs's header for why: the full corpus is
// ~134MB); this function calls corpus-lib.mjs's deterministic regeneration
// to reconstruct each row's full {system, messages} and checks the
// recomputed sha256 against the committed one before trusting it. Never
// writes to evals/candidate/corpus/ — read-only from here, same as
// buildPool() is read-only on evals/archives/. */
async function buildCorpusPool(limit) {
  const corpusPath = join(HERE, "corpus", "corpus.jsonl");
  if (!existsSync(corpusPath)) {
    throw new Error(
      "--corpus requires evals/candidate/corpus/corpus.jsonl — run: node evals/candidate/corpus-generate.mjs",
    );
  }
  const { getRowsByIds } = await import(join(HERE, "corpus-lib.mjs"));
  const compact = readFileSync(corpusPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const wanted = limit ? compact.slice(0, limit) : compact;

  const { found, missing } = await getRowsByIds(wanted.map((r) => r.id));
  if (missing.length) {
    throw new Error(
      `corpus integrity: ${missing.length} id(s) in corpus.jsonl did not regenerate — corpus.entry.ts, ` +
        `corpus.seeds.ts, or evals/archives/ changed since corpus-generate.mjs last ran. Re-run it. ` +
        `First missing: ${missing.slice(0, 5).join(", ")}`,
    );
  }
  const byId = new Map(found.map((r) => [r.id, r]));
  let mismatched = 0;
  const pool = wanted.map((idx) => {
    const full = byId.get(idx.id);
    if (full.sha256 !== idx.sha256) mismatched++;
    return {
      archive: "corpus",
      lane: CHAT_LANE,
      beat: idx.stimulus_ref,
      rep: 0,
      turn: idx.state_variant_ref,
      system: full.system,
      history: [], // corpus rows are single-turn stimuli — see corpus-generate.mjs's row-shape note
      user: full.messages[full.messages.length - 1].content,
      // NOT "reconstructed" (archive-replay's label — assembled from
      // verbatim components, never a stored served prompt) and NOT a
      // literal archived prompt (none exist anywhere in this codebase —
      // see the byte-identical finding above). This is Amendment 1's own
      // claim: freshly compiled through the real engine, the SAME bytes
      // served to both arms — byte-identical ACROSS ARMS by construction.
      context: "compiled",
      corpusId: idx.id,
      corpusSha256: idx.sha256,
    };
  });
  if (mismatched) {
    console.error(
      `WARNING: ${mismatched} row(s) regenerated with a DIFFERENT sha256 than corpus.jsonl recorded — ` +
        `corpus-lib.mjs's output has drifted from what was committed. Re-run corpus-generate.mjs before trusting this run.`,
    );
  }
  return pool;
}

const unitKey = (u) => `${u.archive}|${u.beat}|${u.rep}|${u.turn}${u.sample ? `|s${u.sample}` : ""}`;

function toMessages(u) {
  const messages = [{ role: "system", content: u.system }];
  for (const h of u.history) {
    messages.push({ role: "user", content: h.user });
    messages.push({ role: "assistant", content: h.assistant });
  }
  messages.push({ role: "user", content: u.user });
  return messages;
}

// ── resumable state ─────────────────────────────────────────────────────
// filename param: corpus mode writes to corpus-state.json / corpus-*.json,
// never sharing a file with the archive-replay mode's own runs, even
// though both would resume correctly either way (unitKey namespaces by
// `archive`, "corpus" vs the real archive names) — kept separate so the
// two arms' provenance never mixes in one output file.
function loadState(filename = "state.json") {
  const p = join(OUT, filename);
  if (!existsSync(p)) return { completed: {} };
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { completed: {} };
  }
}
function saveState(state, filename = "state.json") {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, filename), JSON.stringify(state, null, 1));
}

// ── Azure call, retried with exponential backoff on 429 ────────────────
async function callTerra(messages) {
  const maxAttempts = 6;
  const startedAt = Date.now();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let r;
    try {
      r = await fetch(`${AZ_ENDPOINT}/chat/completions`, {
        method: "POST",
        headers: { "api-key": AZ_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: TERRA_MODEL, messages, ...TERRA_PARAMS }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      if (attempt === maxAttempts - 1) throw new Error(`network failure, exhausted retries: ${e.message}`);
      await sleep(1500 * 2 ** attempt);
      continue;
    }
    if (r.status === 429) {
      if (attempt === maxAttempts - 1) throw new Error("429, exhausted retries");
      const retryAfter = Number(r.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1500 * 2 ** attempt);
      continue;
    }
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`upstream ${r.status}: ${body.slice(0, 300)}`);
    }
    const j = await r.json();
    const text = j?.choices?.[0]?.message?.content ?? "";
    const usage = j?.usage ?? null;
    const ms = Date.now() - startedAt; // wall-clock, includes any retries this call needed
    return { text, usage, ms };
  }
  throw new Error("callTerra: unreachable");
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// small concurrency pool, <=4 in flight
async function runPool(units, worker, concurrency = 4) {
  const results = [];
  let idx = 0;
  async function lane() {
    while (idx < units.length) {
      const my = idx++;
      results[my] = await worker(units[my], my);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, units.length) }, lane));
  return results;
}

// ── plan / cost projection ──────────────────────────────────────────────
function planReport(pool, evidence) {
  const byArchive = {};
  for (const u of pool) byArchive[u.archive] = (byArchive[u.archive] || 0) + 1;

  console.log("── WS-CANDGEN plan (no network call — set WSCAND_RUN=1 to fire) ──\n");
  console.log("Byte-identical served-prompt fields found in any archive: NONE.");
  for (const e of evidence) {
    console.log(`  ${e.archive}/${e.file} turn keys: [${e.turnKeysSeen.join(", ")}]`);
  }
  console.log(
    "  (personaText/personaVoice is a single top-level constant per file, not a per-turn record;",
  );
  console.log("   realtime-azure has no persona/user field at all. See file header for the full argument.)\n");

  console.log(`Chat-lane reconstructed replay pool: ${pool.length} turns`);
  for (const [a, n] of Object.entries(byArchive)) console.log(`  ${a}: ${n}`);
  console.log(
    `\nByte-identical turns: 0 / ${pool.length}  (100% marked context:"reconstructed", excluded from any byte-identical claim)`,
  );
  console.log(
    `2,000-turn target vs available pool: pool is ${pool.length} — the archives cannot supply 2,000 distinct`,
  );
  console.log(
    "chat-lane contexts (matches evals/dbattery/d1.mjs's own '≤300 turns/arm, the data that exists' note).",
  );
  console.log(
    "Reaching 2,000 needs either repeated temperature=1 SAMPLES of these 288 contexts (more draws, not more",
  );
  console.log(
    "distinct contexts) or scripts/replay.mjs's live-session path once compile.manifest is wired (not this task).",
  );
  console.log(
    "\nThis is context/decisions.md `swap-prereg-1`'s named reversal condition: the byte-identical corpus is",
  );
  console.log("under 2,000 — report to the coordinator for a pre-registration amendment before any full run.\n");

  const manifestPath = join(OUT, "manifest.json");
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (m.smoke) {
      const { meanPromptTokens, meanCompletionTokens, meanMs, n } = m.smoke;
      console.log(`Cost/time projection (measured from smoke run, n=${n}):`);
      projectTo2000(meanPromptTokens, meanCompletionTokens, meanMs);
      return;
    }
  }
  console.log(
    "No smoke run recorded yet (evals/candidate/out/manifest.json absent or has no `smoke` block).",
  );
  console.log(
    "Run: WSCAND_RUN=1 node evals/candidate/generate.mjs --limit 20   — to measure real tokens/turn first.\n",
  );
  const archTok = archivedTokenPrior(pool);
  console.log(
    `Rough PRIOR (not measured — from archived incumbent \`in\`/\`out\` token fields, same contexts): ` +
      `mean in=${archTok.meanIn.toFixed(0)} out=${archTok.meanOut.toFixed(0)} tokens/turn.`,
  );
  projectTo2000(archTok.meanIn, archTok.meanOut, null, true);
}

// ── WS-CORPUS plan report — Amendment 1's context source. No archive
// reading here; evals/candidate/corpus/corpus.manifest.json already carries
// the full provenance (stimulus dedup, variant design, determinism proof).
function planReportCorpus(pool) {
  console.log("── WS-CANDGEN plan, --corpus mode (no network call — set WSCAND_RUN=1 to fire) ──\n");
  console.log(
    `Context source: evals/candidate/corpus/corpus.jsonl — ${pool.length} rows loaded` +
      (pool.length !== 2304 ? " (a --limit was applied or the corpus has been regenerated with a different design)" : ""),
  );
  console.log(
    "Every row is compiled fresh through the REAL src/engine/compiler.ts (WS-CORPUS) — byte-identical",
  );
  console.log("ACROSS ARMS by construction: the exact same {system, user} bytes go to both the incumbent and terra.\n");
  const manifestPath = join(HERE, "corpus", "corpus.manifest.json");
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    console.log(
      `corpus.manifest.json: ${m.counts.distinctHashes} distinct pairs (${m.counts.nominalPairs} nominal, ` +
        `${m.counts.collisions} collision(s) excluded), ${m.stimulusPool.distinctStimulusTexts} distinct ` +
        `stimulus texts x ${m.stateVariants.count} state variants.`,
    );
  } else {
    console.log("(no corpus.manifest.json found alongside corpus.jsonl — run corpus-generate.mjs to regenerate it.)");
  }

  const runManifestPath = join(OUT, "corpus-manifest.json");
  if (existsSync(runManifestPath)) {
    const m = JSON.parse(readFileSync(runManifestPath, "utf8"));
    if (m.smoke) {
      const { meanPromptTokens, meanCompletionTokens, meanMs, n } = m.smoke;
      console.log(`\nCost/time projection (measured from smoke run, n=${n}):`);
      projectTo2000(meanPromptTokens, meanCompletionTokens, meanMs);
      return;
    }
  }
  console.log(
    "\nNo smoke run recorded yet (evals/candidate/out/corpus-manifest.json absent or has no `smoke` block).",
  );
  console.log(
    "Run: WSCAND_RUN=1 node evals/candidate/generate.mjs --corpus --limit 20   — to measure real tokens/turn first.",
  );
  console.log(`Full run: WSCAND_RUN=1 node evals/candidate/generate.mjs --corpus --limit ${pool.length}\n`);
}

function archivedTokenPrior(pool) {
  // the archives recorded the INCUMBENT's own in/out token counts for these
  // exact contexts — a legitimate prior for prompt-token scale (same system
  // + history sizes) even though terra's own completion length will differ.
  let inSum = 0,
    outSum = 0,
    n = 0;
  for (const src of SOURCES) {
    src.files.forEach((file) => {
      const doc = readArchiveFile(src.archive, file);
      for (const conv of doc.results) {
        if (conv.model !== src.incumbentModel || conv.lane !== CHAT_LANE) continue;
        for (const t of conv.turns) {
          if (typeof t.in === "number" && typeof t.out === "number") {
            inSum += t.in;
            outSum += t.out;
            n++;
          }
        }
      }
    });
  }
  return { meanIn: n ? inSum / n : NaN, meanOut: n ? outSum / n : NaN, n };
}

function projectTo2000(meanPromptTok, meanCompletionTok, meanMs, isPrior = false) {
  const N = 2000;
  const totalTok = (meanPromptTok + meanCompletionTok) * N;
  console.log(
    `  ${isPrior ? "≈" : ""}${Math.round(meanPromptTok + meanCompletionTok)} tokens/turn × ${N} turns/arm ` +
      `≈ ${(totalTok / 1e6).toFixed(2)}M tokens/arm (Azure credits, $0 cash — Terra is credit-billed).`,
  );
  if (meanMs) {
    const totalMs = (meanMs * N) / 4; // concurrency 4
    const hrs = totalMs / 3_600_000;
    console.log(
      `  ≈${Math.round(meanMs)}ms/call measured, concurrency ≤4 ⇒ ≈${hrs.toFixed(2)}h wall time for ${N} turns.`,
    );
  } else {
    console.log("  (wall-time projection needs a measured smoke run — no ms/call prior available.)");
  }
  if (process.argv.includes("--corpus")) {
    console.log(
      "  NOTE: corpus mode — 2,304 sha-distinct compiled contexts (72 stimulus texts x 32 state variants);",
    );
    console.log(
      "  judged analyses must cluster on the 72 stimulus texts (context/measurements.md `corpus-2304`).\n",
    );
  } else {
    console.log(
      "  NOTE: pool ceiling is 288 distinct reconstructed contexts (see above) — a 2,000-turn run repeats those",
    );
    console.log("  contexts ~7x under temperature=1 resampling, not 2,000 distinct beats.\n");
  }
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : null;
  const RUN = process.env.WSCAND_RUN === "1";
  const CORPUS = args.includes("--corpus"); // WS-CORPUS integration — see file header

  let pool, evidence, promptFieldFound;
  if (CORPUS) {
    pool = await buildCorpusPool(limit);
    evidence = [];
    promptFieldFound = false;
  } else {
    ({ pool, evidence, promptFieldFound } = buildPool());
  }
  if (promptFieldFound) {
    console.error(
      "ARCHIVE-INTEGRITY: a turn key matching /prompt|servedcontext|compiled/i was found — the header's",
    );
    console.error("'byte-identical count = 0' claim needs re-deriving by hand before this script is trusted again.");
    process.exit(1);
  }

  if (!RUN) {
    if (CORPUS) planReportCorpus(pool);
    else planReport(pool, evidence);
    process.exit(0);
  }

  // Repeat-sample wraparound if --limit exceeds the pool (see header). In
  // corpus mode, buildCorpusPool() already truncated to `limit`, so this
  // loop runs pool.length times with sample always 0 — a no-op wraparound.
  let units = [];
  const n = limit ?? pool.length;
  for (let i = 0; i < n; i++) {
    const base = pool[i % pool.length];
    const sample = Math.floor(i / pool.length);
    units.push(sample === 0 ? base : { ...base, sample: sample + 1 });
  }

  const stateFile = CORPUS ? "corpus-state.json" : "state.json";
  const state = loadState(stateFile);
  const todo = units.filter((u) => !state.completed[unitKey(u)]);
  console.log(
    `── WS-CANDGEN live run — terra, ${CORPUS ? "corpus mode, " : ""}${units.length} unit(s) requested, ` +
      `${units.length - todo.length} already done (resumed), ${todo.length} to call ──\n`,
  );

  let calls = 0;
  await runPool(
    todo,
    async (u) => {
      const messages = toMessages(u);
      let result;
      try {
        result = await callTerra(messages);
      } catch (e) {
        result = { text: "", usage: null, ms: 0, error: String(e.message || e) };
      }
      calls++;
      state.completed[unitKey(u)] = { ...u, reply: result.text, usage: result.usage, ms: result.ms, error: result.error };
      saveState(state, stateFile);
      process.stdout.write(result.error ? "x" : result.text ? "." : "0");
      return result;
    },
    4,
  );
  console.log(`\n\n${calls} call(s) made this invocation.`);

  // assemble transcript in the load.mjs / common.mjs turn shape
  const allDone = units.map((u) => state.completed[unitKey(u)]).filter(Boolean);
  const transcript = allDone.map((u) => ({
    lane: u.lane,
    beat: u.beat,
    rep: u.rep,
    turn: u.turn,
    text: u.reply,
    context: u.context, // "reconstructed" — never "byte-identical", see header
  }));

  const transcriptFile = CORPUS ? "corpus-candidate-transcript.json" : "candidate-transcript.json";
  const manifestFile = CORPUS ? "corpus-manifest.json" : "manifest.json";

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, transcriptFile), JSON.stringify(transcript, null, 1));

  // ── verification: non-empty rate + common.mjs counters ──────────────
  const nonEmpty = allDone.filter((u) => u.reply && u.reply.trim()).length;
  const errors = allDone.filter((u) => u.error).length;
  const stats = wordCountStats(transcript.filter((t) => t.text));
  const q = questionShare(transcript.filter((t) => t.text));
  const media = mediaTagRate(transcript.filter((t) => t.text));

  console.log(`\n── verification (evals/dbattery/common.mjs counters) ──`);
  console.log(`non-empty replies: ${nonEmpty}/${allDone.length} (${((100 * nonEmpty) / allDone.length).toFixed(1)}%)`);
  console.log(`errors: ${errors}/${allDone.length}`);
  console.log(
    `words/turn: mean=${stats.mean.toFixed(1)} median=${stats.median.toFixed(1)} p90=${stats.p90.toFixed(1)} (n=${stats.n})`,
  );
  console.log(`question share: ${(q * 100).toFixed(1)}%   media-tag rate: ${(media * 100).toFixed(1)}%`);

  const usages = allDone.map((u) => u.usage).filter(Boolean);
  const meanPromptTokens = usages.length ? usages.reduce((a, b) => a + (b.prompt_tokens || 0), 0) / usages.length : NaN;
  const meanCompletionTokens = usages.length
    ? usages.reduce((a, b) => a + (b.completion_tokens || 0), 0) / usages.length
    : NaN;
  const meanMs = allDone.length ? allDone.reduce((a, b) => a + (b.ms || 0), 0) / allDone.length : NaN;

  // byte-identical-to-historical-traffic is 0 either way (see header) —
  // Amendment 1's actual identity claim for corpus mode is BETWEEN ARMS
  // (same compiled bytes served to both), tracked via corpusByteIdentity
  // below instead of overloading this field's archive-replay meaning.
  const byteIdentical = 0;
  const reconstructed = CORPUS ? 0 : allDone.length;
  const compiled = CORPUS ? allDone.length : 0;

  const manifestPath = join(OUT, manifestFile);
  const prior = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
  const manifest = {
    ...prior,
    model: TERRA_MODEL,
    endpoint: "azure-foundry", // hostname never recorded — see api/_config.js, gitignored
    params: TERRA_PARAMS,
    date: new Date().toISOString(),
    contextSource: CORPUS
      ? "evals/candidate/corpus/corpus.jsonl (WS-CORPUS, Amendment 1) — every unit's sha256 checked against the committed index before use"
      : "evals/archives/{charm-grok,charm-luna} (WS-CANDGEN, archive-replay — superseded by Amendment 1, kept working per that amendment's own note)",
    disclosedConfound:
      "temperature pinned to 1 by Terra's API; incumbent runs production sampling (typically lower/variable temperature) — a real, disclosed confound per docs/SWAP-TEST-PREREG.md, not hidden.",
    counts: CORPUS
      ? {
          byteIdentical,
          compiled,
          total: allDone.length,
          note:
            'ALL turns are context:"compiled" — freshly compiled through the real src/engine/compiler.ts and byte-identical ACROSS ARMS by construction (Amendment 1), never claimed identical to historical/archived traffic (byteIdentical=0 keeps that older, still-true, still-separate claim visible).',
        }
      : {
          byteIdentical,
          reconstructed,
          total: allDone.length,
          note: 'ALL turns are context:"reconstructed" — no archive stores a full served prompt per turn. See generate.mjs file header for the exact evidence (turn keys inspected per archive file).',
        },
    poolCeiling: CORPUS
      ? {
          corpusRows: pool.length,
          note: "evals/candidate/corpus/corpus.manifest.json carries the full corpus provenance (2,304 nominal pairs, 72 distinct stimulus texts x 32 state variants — see corpus-generate.mjs's header for why 72, not 288).",
        }
      : {
          distinctChatLaneContexts: pool.length,
          note: "288 is the hard ceiling from the two replayable archives (charm-grok, charm-luna); realtime-azure excluded (no chat-lane / no persona data). Turns beyond this repeat-sample the same contexts under temperature=1 (see `sample` field on repeated units).",
        },
    smoke: RUN
      ? {
          n: allDone.length,
          nonEmpty,
          errors,
          nonEmptyRate: nonEmpty / allDone.length,
          wordsPerTurn: stats,
          questionShare: q,
          mediaTagRate: media,
          meanPromptTokens,
          meanCompletionTokens,
          meanMs,
        }
      : prior.smoke,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`\nWrote evals/candidate/out/${transcriptFile} (${transcript.length} turns)`);
  console.log(`Wrote evals/candidate/out/${manifestFile}`);

  console.log(`\n── projection for a full 2,000-turn/arm run, from THIS run's measured tokens/ms ──`);
  if (usages.length) projectTo2000(meanPromptTokens, meanCompletionTokens, meanMs);
  else console.log("  no usage data returned this run — cannot project.");

  const corpusFlag = process.argv.includes("--corpus");
  console.log(
    `Exact command for the full run (fires only after the pre-registration amendment is committed):\n` +
      (corpusFlag
        ? `  WSCAND_RUN=1 node evals/candidate/generate.mjs --corpus --limit 2304\n`
        : `  WSCAND_RUN=1 node evals/candidate/generate.mjs --limit 2000\n`),
  );
}

await main();
