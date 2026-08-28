// ── OFFLINE, DETERMINISTIC CONTEXT COMPILATION FOR THE FELT BATTERY ───────
//
// Structured after evals/candidate/corpus-lib.mjs (WS-CORPUS, the harness
// docs/SWAP-TEST-PREREG.md Amendment 1 built): compile every probe's context
// LOCALLY, for free, deterministically, and treat generation + judging as a
// separate, paid, explicitly-flagged step. Two reasons, both learned here:
//
//   1. A judged run that recompiles its own contexts cannot tell a context
//      difference from a sampling difference. The compiled bytes are this
//      battery's independent variable, so they are produced once, hashed, and
//      handed to both arms.
//   2. The offline half then costs nothing and can be a CI gate — which is
//      the whole of item 3 in this workstream's brief and the reason
//      `dead-writers` does not get another member.
//
// ── THE DATE PIN ──────────────────────────────────────────────────────────
// compile() is pure in its own signature, but persona.ts's nowContext(),
// relstate.ts's honorificAgeLabel and india.ts's dueRituals all default a
// `now` parameter to a live clock read that CompileInput cannot override.
// Left alone, two compiles a minute apart differ. The workaround is
// corpus-lib.mjs's, reproduced here rather than imported so this battery owns
// its own determinism story (and so importing it cannot install someone
// else's pin as a side effect): the REAL Date, subclassed, with no-arg
// construction and Date.now() pinned to a literal instant.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as F from "./fixtures/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
const NPX_COMMAND = process.platform === "win32" ? process.execPath : "npx";
const NPX_ARGS = process.platform === "win32"
  ? [join(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js")]
  : [];

// ── the pin ───────────────────────────────────────────────────────────────
const RealDate = globalThis.Date;
let fixedMs = null;
class PinnedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0 && fixedMs !== null) super(fixedMs);
    else super(...args);
  }
  static now() {
    return fixedMs !== null ? fixedMs : RealDate.now();
  }
}
export function setPin(ms) {
  fixedMs = ms == null ? null : Number(ms);
}
if (globalThis.Date !== PinnedDate) globalThis.Date = PinnedDate;

export const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// ── bundling the engine (from ANY tree, which is what makes arms possible) ─
//
// `root` is a repo root: the working tree for the `current` arm, a materialized
// pre-wave tree for the `prewave` arm (see arms.mjs). The entry file is copied
// in when the tree predates this battery, so both arms are bundled through the
// same declared surface rather than through whatever each tree happened to
// export.
export async function loadEngine({ root = ROOT, label = "current" } = {}) {
  const entry = join(root, "evals", "feltmem", ".entry.ts");
  if (!existsSync(entry)) copyFileSync(join(HERE, ".entry.ts"), entry);
  const out = join(mkdtempSync(join(tmpdir(), `feltmem-${label}-`)), "engine.bundle.mjs");
  execFileSync(
    NPX_COMMAND,
    [
      ...NPX_ARGS, "esbuild",
      entry,
      "--bundle",
      "--format=esm",
      "--platform=node",
      `--outfile=${out}`,
      "--log-level=error",
      `--alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
    ],
    { stdio: "inherit", cwd: root },
  );
  return { engine: await import(`${pathToFileURL(out).href}?t=${RealDate.now()}`), bundlePath: out };
}

// ── the four lanes, each mirroring its real compile site ──────────────────
// Lifted from evals/lanes/run.mjs's lane table, which is itself pinned against
// the source at src/components/useCallEngine.ts and src/engine/brain.ts by that
// suite's mirror check. This file deliberately does NOT re-do that mirror
// check: two suites asserting the same thing about the same source is one
// suite's worth of protection and two suites' worth of maintenance. What this
// battery adds is the BEHAVIOUR under those lanes.
function laneInput(E, d, probe, ctx) {
  const { history, now, memoriesChat, memoriesCall, innerFor } = ctx;
  const lastAt = history[history.length - 1].at;
  const base = {
    user: d.user,
    messageCount: history.length,
    isDirective: false,
    watching: false,
    herLife: d.herLife,
    relBundle: ctx.relBundle,
    selfBundle: ctx.selfBundle,
    gapSinceLastMs: Math.max(0, now - lastAt),
    ageGates: undefined,
    nowMs: now,
    recentTurns: history,
    herCommitments: E.herCommitments(history, now),
  };
  const chatish = {
    ...base,
    memories: memoriesChat,
    latestUserText: probe.stimulus,
    activity: E.activityOf(ctx.game, now),
  };
  switch (probe.lane) {
    case "chat":
      return {
        ...chatish,
        medium: "text",
        mode: "chat",
        voiceEngine: "device",
        innerThread: innerFor("chat").thread,
        innerWants: innerFor("chat").wants,
        cultureNoteText: ctx.cultureNoteText,
      };
    case "cascade":
      return {
        ...chatish,
        medium: "voice",
        mode: "call",
        voiceEngine: "gemini",
        innerThread: innerFor("pickup").thread,
        innerWants: innerFor("pickup").wants,
        cultureNoteText: ctx.cultureNoteText,
      };
    case "live":
      return {
        ...chatish,
        medium: "voice",
        mode: "call",
        voiceEngine: "live",
        innerThread: innerFor("pickup").thread,
        innerWants: innerFor("pickup").wants,
        cultureNoteText: "",
        memories: memoriesCall,
      };
    case "watch":
      // the watch lane's four written exemptions, reproduced exactly as the
      // real call site sets them up: latestUserText "" (the T4/T12 budget
      // decision), no `activity` (T15), no culture note, watching true.
      return {
        ...base,
        medium: "voice",
        mode: "call",
        voiceEngine: "live",
        watching: true,
        innerThread: innerFor("watch").thread,
        innerWants: innerFor("watch").wants,
        cultureNoteText: "",
        memories: memoriesCall,
        latestUserText: "",
      };
    default:
      throw new Error(`unknown lane "${probe.lane}" on probe ${probe.id}`);
  }
}

/** Everything a dyad contributes, derived ONCE per dyad by the real functions. */
function dyadContext(E, d, now, arm) {
  const history = d.history(now);
  // the memory block is SERVER-rendered and the wave changed its format, so it
  // is rendered per arm — see fixtures/dyads.mjs renderMemories()
  const memories = F.renderMemories(d, arm);
  const ledger = d.id === "d01-exam-day" ? F.chessLedger : [];
  const memoriesChat = [E.formatActivityLedger(ledger, now), memories].filter(Boolean).join("\n\n");
  const memoriesCall = E.callMemories(
    E.callGraphBlocks(
      // WS-SHARENOW: no share/game/call inside the just-happened window on any
      // felt-memory dyad — these are long-horizon fixtures, and the block's
      // render-nothing default is what keeps them byte-identical.
      "",
      E.formatActivityLedgerForCall(ledger, now),
      E.formatSharedHistory(history, now),
      memories,
    ),
    E.formatChatTail(history, now),
  );
  const innerState = F.inner(
    d.id === "d08-her-day"
      ? { threadText: "sneha ke jaane ke baad flat khaali lag raha hai" }
      : d.id === "d09-her-told-ledger"
        ? { threadText: "review ki date bhejni thi", wantText: "tell him her review date" }
        : {},
  );
  return {
    history,
    now,
    memoriesChat,
    memoriesCall,
    relBundle: F.relBundle(
      d.rupture ? { state: { rupture_open: true, repair_state: "repairing", trust: 0.48 } } : {},
    ),
    selfBundle: F.selfBundle(),
    game: d.id === "d01-exam-day" ? F.liveBoard : null,
    cultureNoteText: "a festival weekend is coming up in her city",
    innerFor: (surface) =>
      E.innerContext(innerState, { now, lastMsgAt: F.GAP_ENTRY_LAST_MSG_AT, surface }),
  };
}

/**
 * Compiles every probe's context through the engine at `root`.
 * Deterministic: same tree + same fixtures -> byte-identical rows, always.
 * Returns { arm, rows, caps }, rows = one per probe, in PROBES order.
 */
export async function compileProbes({ root = ROOT, arm = "current", engine } = {}) {
  const E = engine ?? (await loadEngine({ root, label: arm })).engine;
  const byId = new Map(F.DYADS.map((d) => [d.id, d]));
  const rows = [];
  setPin(F.NOW);
  try {
    const ctxCache = new Map();
    for (const probe of F.PROBES) {
      const d = byId.get(probe.dyad);
      if (!d) throw new Error(`probe ${probe.id} names unknown dyad ${probe.dyad}`);
      if (!ctxCache.has(d.id)) ctxCache.set(d.id, dyadContext(E, d, F.NOW, arm));
      const ctx = ctxCache.get(d.id);
      const input = laneInput(E, d, probe, ctx);
      const compiled = E.compile(input);
      rows.push({
        arm,
        probeId: probe.id,
        dyadId: d.id,
        law: probe.law,
        lane: probe.lane,
        kind: probe.kind,
        stimulus: probe.stimulus,
        system: compiled.system,
        core: compiled.core,
        tail: compiled.tail,
        sections: compiled.sections ?? {},
        historyTurns: ctx.history.length,
        sha256: sha256(JSON.stringify({ system: compiled.system, user: probe.stimulus })),
      });
    }
  } finally {
    setPin(null);
  }
  return {
    arm,
    rows,
    caps: { core: E.OPERATIONAL_CORE_CAP, tail: E.OPERATIONAL_TAIL_CAP },
  };
}
