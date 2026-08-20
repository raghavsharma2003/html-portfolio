// T-H1 — the self layer's DELIVERY gate. `selfbundle-never-set`, closed.
//
//   node evals/self/wiring.mjs          pure half only (offline, DB-free, $0)
//   node evals/self/wiring.mjs --live   + the real gate: real rows, real
//                                         op:"recall", real prompts, both lanes
//
// ── WHY THIS SUITE EXISTS, AND WHY IT IS NOT LIKE THE OTHER FOUR ──────────
//
// evals/self/{texture,arc,life,observation}.mjs all ask the same question:
// does this module do the right thing when it is invoked. All four were green
// for the whole period in which T11 `rel.texture`, T12 `self.arc` and T13
// `life.untold` rendered zero bytes on every lane, always — because nothing
// invoked them. compiler.ts's manifest even carried `sourceStatus: "wired"`
// for all three, a string set by hand and checked by nothing.
//
// So the rule this file enforces is the one that entry ends on, and it is
// deliberately not a rule about code:
//
//   A SLOT IS NOT WIRED WHEN A RENDER FUNCTION EXISTS. IT IS WIRED WHEN A
//   REAL PROMPT CONTAINS ITS BYTES, FOR A PERSON WITH REAL ROWS IN THE
//   DATABASE, ON BOTH LANES.
//
// Every clause there is load-bearing and each one is a gate below:
//   real prompt      §3/§4 drive `think()` and read the system string that is
//                    actually handed to the model, not a compile() the suite
//                    arranged for itself.
//   real rows        §2 seeds vy_rel_texture through the REAL deriver over
//                    real meera_log turns, and seeds the arc and the life
//                    beats under the REAL agent id, so §3/§4 retrieve them
//                    through the real op:"recall" and not a fixture.
//   both lanes       §3 is chat, §4 is the call lane.
//
// ── WHAT THIS SUITE CANNOT PROVE, STATED UP FRONT ─────────────────────────
//
// The REALTIME lane compiles inside useCallEngine.ts's `tryStartLive`, a React
// hook that cannot run headless. §5 measures that lane by compiling the
// identical input object and separately asserting, against the file's source,
// that its two call sites read the ring-fetched bundle rather than the literal
// `null` they held before this ticket. That is weaker than §3/§4 and it is
// labelled as such rather than folded in silently.
//
// ── COST AND BLAST RADIUS ────────────────────────────────────────────────
//
// $0 — no model call is made. The model call is intercepted, which is also how
// the prompt is captured. The database is real: two `wsself-test-` persons are
// created and destroyed, and vy_self_arc / vy_agent_life are AGENT-scoped, so
// the seeded arc and beats are visible to every person for the seconds the
// suite runs (api/memory.js's opRecall hardcodes MEERA_AGENT_ID, correctly).
// Teardown is in a `finally` and residue is asserted by agent, by id and by
// text prefix.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SELF_TAG, SELF_AGENT, SELF_P1, SELF_P2, SELF_D1, SELF_D2, SELF_ARC_KEY,
  SELF_HER_TURNS, SELF_ARC_ROW, SELF_BEATS, SELF_TOLD_TO_P1, SELF_TURN,
  SELF_HEADERS, daysAgo,
} from "./_fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const LIVE = process.argv.includes("--live");

const tmp = mkdtempSync(join(tmpdir(), "wsself-"));
const bundlePath = join(tmp, "wiring.bundle.mjs");
execSync(
  `npx esbuild ${join(ROOT, "evals/self/_wiring-entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${bundlePath} --log-level=error ` +
    `--alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(bundlePath);

let failed = 0;
let passed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? `  ${detail}` : ""}`);
  return Boolean(cond);
};
const section = (t) => console.log(`\n── ${t} ──`);

// ═════════════════════════════════════════════════════════════════════════
section("§1 · the manifest is not evidence (the mechanism that failed)");
// `selfbundle-never-set`'s own diagnosis: "a manifest that describes intent
// rather than observed behaviour is a comment with better syntax." This
// section makes that concrete so nobody re-adds a manifest check believing it
// covers what the sections below cover.
const manifest = Object.fromEntries(E.TAIL_MANIFEST.map((r) => [r.id, r]));
for (const [id] of SELF_HEADERS) {
  ok(
    `${id} is declared in the tail manifest`,
    Boolean(manifest[id]),
    manifest[id] ? `budget ${manifest[id].budget}, dropPriority ${manifest[id].dropPriority}` : "MISSING",
  );
}
ok(
  "the manifest says \"wired\" for all three — and said so throughout the outage",
  SELF_HEADERS.every(([id]) => manifest[id]?.sourceStatus === "wired"),
  "which is why §3-§4 exist and this assertion proves nothing on its own",
);
// Drop priority is the other half of the budget contract: these three are the
// FIRST things shed under pressure, ahead of everything Phase C proved it
// needs. If someone protects them, the relational core pays for it.
ok(
  "T11/T12/T13 hold drop priorities 1/2/3 — least protected, by design",
  manifest.T11?.dropPriority === 1 && manifest.T12?.dropPriority === 2 && manifest.T13?.dropPriority === 3,
  `${manifest.T11?.dropPriority}/${manifest.T12?.dropPriority}/${manifest.T13?.dropPriority}`,
);

// ═════════════════════════════════════════════════════════════════════════
section("§1b · the tail budget, worst case, as numbers");
// The compiler NEVER slices. Every block it cannot fit is DROPPED whole, in
// drop-priority order, so the number that matters is whether the declared
// budgets still fit the cap after the self layer took its three slots.
const tailBudgets = E.TAIL_MANIFEST.reduce((n, r) => n + (Number(r.budget) || 0), 0);
const TAIL_CAP = 24_000;
const selfBudgets = SELF_HEADERS.reduce((n, [id]) => n + (Number(manifest[id]?.budget) || 0), 0);
console.log(
  `      declared tail total ${tailBudgets}b of ${TAIL_CAP}b cap ` +
    `(${((tailBudgets / TAIL_CAP) * 100).toFixed(1)}%), self layer ${selfBudgets}b of that ` +
    `(${((selfBudgets / TAIL_CAP) * 100).toFixed(1)}% of cap)`,
);
ok("declared tail budgets fit the 24,000b cap", tailBudgets <= TAIL_CAP, `${TAIL_CAP - tailBudgets}b headroom`);

if (!LIVE) {
  console.log(
    "\nOFFLINE ONLY — §2-§6 need the database and are the actual gate.\n" +
      "Run: node evals/self/wiring.mjs --live\n",
  );
  console.log(failed ? `${failed} FAILURE(S) — ${passed} passed` : `all ${passed} offline checks passed`);
  process.exit(failed ? 1 : 0);
}

// ═════════════════════════════════════════════════════════════════════════
// LIVE. Everything below touches the real database and the real op:"recall".
// ═════════════════════════════════════════════════════════════════════════
const { q } = await import("../../api/_db.js");
const memoryHandler = (await import("../../api/memory.js")).default;
const ENGINE = await import("../../api/_engine.gen.js");

// ── the interception layer ───────────────────────────────────────────────
// Two jobs, and only two:
//   /api/memory  → the REAL handler, in-process. Not a stub: this is
//                  api/memory.js's own opRecall, hitting the real Neon rows
//                  seeded below. Intercepted rather than served over a socket
//                  because a socket would add a moving part without adding a
//                  single thing to what is being asserted.
//   /api/chat    → the model call. Intercepted so the suite costs $0 AND so
//                  the exact `system` string handed to the model can be
//                  captured. THAT CAPTURE IS THE GATE. Everything else here
//                  is scaffolding around reading one string.
// Neon's own SQL endpoint passes straight through — the rows have to be real.
// Anything else (telemetry, clock) gets an empty 200 so a background beat can
// never fail a run or reach the network.
const realFetch = globalThis.fetch;
const captured = [];
/** When true, the memory response has its `self` key stripped on the way out —
 *  i.e. EXACTLY the server this ticket found in production. Used by the
 *  negative controls in §6, never by the gates. */
let stripSelf = false;
const jsonResponse = (obj) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });

async function callMemoryHandler(body) {
  let payload;
  const res = {
    statusCode: 200,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(v) { payload = v; return this; },
    end() { return this; },
  };
  await memoryHandler({ method: "POST", headers: {}, body }, res);
  return payload;
}

globalThis.fetch = async (input, init) => {
  const url = String(input?.url ?? input ?? "");
  if (url.includes("/sql")) return realFetch(input, init); // Neon — must be real
  if (url.includes("/api/memory")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const out = (await callMemoryHandler(body)) ?? {};
    if (stripSelf) delete out.self;
    return jsonResponse(out);
  }
  // The embedding call opRecall's semantic pre-filter makes is deliberately
  // NOT served: it costs credits, and it is documented fail-soft ("any failure
  // here degrades silently to the keyword-only behaviour"). Excluded by name
  // rather than by luck, because it shares a host with the chat completion and
  // would otherwise be captured as a model call with an empty system string.
  if (url.includes("/embeddings")) return jsonResponse({});
  if (url.includes("/api/chat") || url.includes("openrouter.ai") || url.includes("anthropic.com")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    // proxyThink sends { system, system_tail }; openrouterThink sends
    // { messages:[{role:"system",content}] }. Both are captured whole so the
    // suite is not silently measuring only one of the two paths.
    const system =
      typeof body.system === "string"
        ? `${body.system}${body.system_tail || ""}`
        : String(body.messages?.[0]?.content ?? "");
    captured.push({ url, system, tail: String(body.system_tail ?? "") });
    return jsonResponse({ text: "haan bol" });
  }
  return jsonResponse({});
};

const lastPrompt = () => captured[captured.length - 1] ?? { system: "", tail: "" };

const USER = { name: "Arjun", vibe: ["someone to talk to"], facts: { city: "Bengaluru" } };
const msg = (from, at, text, channel = "chat") => ({
  id: `${from}-${at}`, from, kind: "text", text, at, channel,
});
const HISTORY = Array.from({ length: 60 }, (_, i) =>
  msg(i % 2 ? "me" : "her", Date.now() - (60 - i) * 60_000, `${SELF_TAG} turn ${i}`),
);

let beatIds = {};
let arcId = null;

try {
  // ═══════════════════════════════════════════════════════════════════════
  section("§2 · seed REAL rows (the deriver writes the texture, not the suite)");
  for (const [person, device] of [[SELF_P1, SELF_D1], [SELF_P2, SELF_D2]]) {
    await q(`insert into vy_person (person_id) values (($1)::uuid) on conflict do nothing`, [person]);
    await q(
      `insert into vy_person_device (device_id, person_id) values (($1)::uuid, ($2)::uuid)
       on conflict do nothing`,
      [device, person],
    );
    // vy_rel_state: the relational row. Seeded because compile() computes its
    // moment gate ONLY when a relBundle is present, so T12 is unreachable for
    // a person with no rel-state row — a real coupling, filed as a finding,
    // and not something this suite may paper over by pretending otherwise.
    await q(
      `insert into vy_rel_state (person_id, agent_id, honorific, cs_ratio, cs_on_stress, trust,
                                 rupture_open, repair_state, ritual_density, pacing_gap_s, snapshot_ver)
       values (($1)::uuid, ($2)::uuid, 'tu', 0.65, 'intensify_l1', 0.72, false, 'repaired', 0.6, 9000, 11)
       on conflict (person_id, agent_id) do update set trust = excluded.trust`,
      [person, SELF_AGENT],
    );
  }
  // HER turns, so `deriveTexture` has something real to count.
  for (const [i, text] of SELF_HER_TURNS.entries()) {
    await q(
      `insert into meera_log (device_id, role, channel, kind, content, at)
       values (($1)::uuid, 'her', 'chat', 'text', $2, $3::timestamptz)`,
      [SELF_D1, text, daysAgo(30 - i * 0.5)],
    );
  }
  // THE REAL DERIVER AND THE REAL WRITER. Not an insert: an inserted texture
  // row would prove the reader works and prove nothing about whether anything
  // upstream can produce one, which is the half `selfbundle-never-set` got
  // wrong in the first place.
  const derived = await ENGINE.refreshTexture(q, SELF_P1, SELF_AGENT);
  ok(
    "the real deriver wrote a texture row over the floor",
    derived.n_turns >= E.TEXTURE_N_TURNS_FLOOR,
    `n_turns ${derived.n_turns} (floor ${E.TEXTURE_N_TURNS_FLOOR}), teasing ${derived.teasing}, humour ${derived.humour}`,
  );

  const arcRows = await q(
    `insert into vy_self_arc (agent_id, dim, note, from_note, citations, span_days)
     values (($1)::uuid, $2, $3, $4, $5::bigint[], $6) returning id`,
    [SELF_AGENT, SELF_ARC_ROW.dim, SELF_ARC_ROW.note, SELF_ARC_ROW.from_note,
     SELF_ARC_ROW.citations, SELF_ARC_ROW.span_days],
  );
  arcId = Number(arcRows[0].id);
  ok("an arc row exists that satisfies the table's own >=3-citation / >=42-day CHECKs", arcId > 0, `id ${arcId}`);

  for (const b of SELF_BEATS) {
    const r = await q(
      `insert into vy_agent_life (agent_id, at, beat, kind, arc_key, status)
       values (($1)::uuid, $2::timestamptz, $3, $4, $5, 'approved') returning id`,
      [SELF_AGENT, daysAgo(b.day), b.beat, b.kind, `${SELF_ARC_KEY}-${b.key}`],
    );
    beatIds[b.key] = Number(r[0].id);
  }
  ok("three approved life beats exist", Object.keys(beatIds).length === 3, JSON.stringify(beatIds));

  // ═══════════════════════════════════════════════════════════════════════
  section("§3 · CHAT LANE — a real prompt, from real rows");
  // think() runs the shipping chat path end to end: it awaits recallMemories
  // (→ the real op:"recall" → the real rows), pulls both bundles from the
  // consume-once caches, compiles, and hands the system string to the model.
  // The model call is intercepted; the string is what the model would have
  // received.
  captured.length = 0;
  await E.think(USER, { deviceId: SELF_D1, herLife: "" }, HISTORY, SELF_TURN, "chat", "gemini", false);
  ok(
    "the chat lane reached the model with a prompt",
    captured.length > 0,
    `${captured.length} model call(s): ${captured.map((c) => `${new URL(c.url, "http://x").pathname} ${c.system.length}b`).join(", ")}`,
  );
  const chatPrompt = lastPrompt();
  for (const [id, header] of SELF_HEADERS) {
    ok(`${id}'s bytes are in the REAL CHAT PROMPT`, chatPrompt.system.includes(header), `"${header}"`);
  }
  // The prompt must carry the block CONTENT, not only its header — a header
  // with no rows under it is what a half-wired slot looks like.
  ok(
    "T13's prompt text carries an actual untold beat, not just its header",
    chatPrompt.system.includes(SELF_BEATS[0].beat) || chatPrompt.system.includes(SELF_BEATS[1].beat),
  );
  ok("T12's prompt text carries the arc note", chatPrompt.system.includes(SELF_ARC_ROW.note));
  // T11's own state-leak guard, checked on the SHIPPING prompt rather than on
  // a render fixture: the block renders bands, and no digit may appear in it.
  const t11Block = chatPrompt.system.slice(
    chatPrompt.system.indexOf("HOW YOU TWO TALK"),
    chatPrompt.system.indexOf("HOW YOU TWO TALK") + 600,
  ).split("\n\n")[0];
  ok("T11 leaks no raw number into the real prompt", !/\d/.test(t11Block), JSON.stringify(t11Block.slice(0, 90)));

  // ═══════════════════════════════════════════════════════════════════════
  section("§4 · CALL LANE (cascade) — the same rows, the same headers");
  // The call lane's ONE lookup happens during the ring: recallForCall pulls
  // both bundles in the continuation the fetch resolves in, and the self half
  // lands in memory.ts's call-lane holder because the three call-lane compile
  // sites do not share a call frame. think() in call mode reads it from there.
  captured.length = 0;
  const ring = await E.recallForCall(SELF_D1, SELF_TURN);
  ok("the ring fetch found a relational bundle", Boolean(ring.relBundle));
  ok("the ring fetch filled the call-lane self holder", Boolean(E.callSelfBundle(SELF_D1)));
  ok(
    "the holder is device-keyed — another device gets nothing",
    E.callSelfBundle(SELF_D2) === null,
  );
  await E.think(
    USER,
    { deviceId: SELF_D1, herLife: "", relBundle: ring.relBundle },
    HISTORY, SELF_TURN, "call", "gemini", false, undefined, ring.memories,
  );
  ok("the call lane reached the model with a prompt", captured.length > 0, `${captured.length} model call(s)`);
  const callPrompt = lastPrompt();
  for (const [id, header] of SELF_HEADERS) {
    ok(`${id}'s bytes are in the REAL CALL PROMPT`, callPrompt.system.includes(header), `"${header}"`);
  }
  console.log(
    `      chat prompt ${chatPrompt.system.length}b / tail ${chatPrompt.tail.length}b · ` +
      `call prompt ${callPrompt.system.length}b / tail ${callPrompt.tail.length}b`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  section("§5 · REALTIME LANE — weaker by construction, and labelled so");
  // useCallEngine.ts's tryStartLive is a React hook and cannot run headless.
  // Two things are asserted instead, and together they are the strongest
  // available claim: (a) the file's call sites read the ring-fetched bundle
  // rather than the literal null they held before this ticket, and (b) the
  // same input object compiled through the same compiler renders the blocks.
  const callEngineSrc = readFileSync(join(ROOT, "src/components/useCallEngine.ts"), "utf8");
  const nullSites = (callEngineSrc.match(/selfBundle:\s*null/g) || []).length;
  const wiredSites = (callEngineSrc.match(/selfBundle:\s*callSelfBundle\(/g) || []).length;
  ok("useCallEngine.ts has NO `selfBundle: null` call site left", nullSites === 0, `${nullSites} found`);
  ok("both of its compile sites read the ring-fetched holder", wiredSites === 2, `${wiredSites} found`);
  const liveCompiled = E.compile({
    user: USER,
    messageCount: HISTORY.length,
    medium: "voice",
    mode: "call",
    voiceEngine: "live",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    memories: ring.memories,
    herLife: "",
    cultureNoteText: "",
    relBundle: ring.relBundle,
    selfBundle: E.callSelfBundle(SELF_D1),
    latestUserText: "",
    gapSinceLastMs: 0,
    ageGates: null,
  });
  // A pickup has no user turn, so T12's moment gate is shut — the identical
  // structural limit parity.mjs §5 records for T4, not a wiring failure.
  ok("realtime pickup renders T11", liveCompiled.tail.includes("HOW YOU TWO TALK"), `${liveCompiled.sections.T11 ?? 0}b`);
  ok("realtime pickup renders T13", liveCompiled.tail.includes("YOUR LIFE — WHAT THEY HAVE NOT HEARD"), `${liveCompiled.sections.T13 ?? 0}b`);
  ok("realtime pickup leaves T12 dark (no turn, no moment — same as T4)", (liveCompiled.sections.T12 ?? 0) === 0);
  console.log(`      realtime tail ${liveCompiled.tail.length}b of the 24,000b cap (${((liveCompiled.tail.length / 24_000) * 100).toFixed(1)}%)`);

  // ═══════════════════════════════════════════════════════════════════════
  section("§6 · structural-disclosure — an untold beat told to P1, for P2");
  // `structural-disclosure`: privacy is a WHERE clause, never a prompt rule.
  // The mechanism is life.ts's anti-join with `t.person_id` inside the ON
  // clause. This asserts the PROPERTY through the real retrieval, on both
  // persons, rather than asserting the SQL text.
  const beforeP1 = await ENGINE.untoldFor(q, SELF_P1, SELF_AGENT, 50);
  const beforeP2 = await ENGINE.untoldFor(q, SELF_P2, SELF_AGENT, 50);
  const toldId = beatIds[SELF_TOLD_TO_P1];
  ok("before telling, both persons are untold the same beat",
    beforeP1.some((r) => r.id === toldId) && beforeP2.some((r) => r.id === toldId));
  await q(
    `insert into vy_agent_life_told (agent_id, life_id, person_id) values (($1)::uuid, ($2)::bigint, ($3)::uuid)
     on conflict do nothing`,
    [SELF_AGENT, toldId, SELF_P1],
  );
  // Through the REAL op:"recall", not through untoldFor — the point is that
  // the exclusion survives the whole delivery path, which is where a post-hoc
  // filter would have been added by someone later.
  const recallP1 = await callMemoryHandler({ op: "recall", device: SELF_D1, query: SELF_TURN });
  const recallP2 = await callMemoryHandler({ op: "recall", device: SELF_D2, query: SELF_TURN });
  const idsOf = (r) => (r?.self?.untold ?? []).map((u) => u.id);
  ok(
    "P1's bundle no longer carries the beat P1 was told",
    !idsOf(recallP1).includes(toldId),
    `P1 untold ids ${JSON.stringify(idsOf(recallP1))}`,
  );
  ok(
    "P2's bundle still carries it — the told-ledger is per-person, the life is not",
    idsOf(recallP2).includes(toldId),
    `P2 untold ids ${JSON.stringify(idsOf(recallP2))}`,
  );
  ok(
    "P1 still has untold beats (the exclusion narrowed the set, it did not empty it)",
    idsOf(recallP1).length > 0,
  );
  // The other axis of the same law: texture is (agent, person)-scoped, so P2
  // — who has no texture row — must not receive P1's.
  ok(
    "P2 receives no texture row of P1's",
    !recallP2?.self?.texture,
    `P2 texture ${recallP2?.self?.texture ? "PRESENT" : "null"}`,
  );
  ok("P1 does receive a texture row", Boolean(recallP1?.self?.texture));
  // The arc is agent-scoped and person-blind BY DESIGN — she is one person
  // across every relationship — so both must see it. Asserted so nobody
  // "fixes" it into a per-person store later (`life-per-person`).
  ok(
    "both persons see the same arc — she is ONE person across relationships",
    (recallP1?.self?.arc ?? []).length === 1 && (recallP2?.self?.arc ?? []).length === 1,
  );

  // ═══════════════════════════════════════════════════════════════════════
  section("§7 · NEGATIVE CONTROLS — every one verified to actually fail");
  // A gate nobody has seen fail is a gate nobody has tested. Each control
  // breaks ONE mechanism and re-runs the assertion that guards it; the control
  // passes when the assertion FAILS, and the failure text is printed so the
  // report can quote what was seen rather than that it was seen.
  let controls = 0;
  let caught = 0;
  const control = (name, brokeIt, evidence) => {
    controls++;
    if (brokeIt) caught++;
    console.log(`  ${brokeIt ? "ok  " : "MISS"} ${name} — ${evidence}`);
  };

  // NC1 — THE PRE-FIX SERVER. op:"recall" answers without `self`, which is
  // literally what api/memory.js did before this ticket. The chat lane must go
  // dark, and §3's assertions must be the thing that notices.
  stripSelf = true;
  captured.length = 0;
  await E.think(USER, { deviceId: SELF_D1, herLife: "" }, HISTORY, SELF_TURN, "chat", "gemini", false);
  const nc1 = lastPrompt();
  const nc1Missing = SELF_HEADERS.filter(([, h]) => !nc1.system.includes(h)).map(([id]) => id);
  stripSelf = false;
  control(
    "NC1 a server that omits `self` (the pre-T-H1 production server)",
    nc1Missing.length === 3,
    `§3 would report: ${nc1Missing.map((id) => `FAIL ${id}'s bytes are in the REAL CHAT PROMPT`).join("; ") || "NOTHING — the gate is blind"}`,
  );

  // NC2 — THE PRE-FIX CLIENT. The server ships `self`, the compiler is handed
  // null anyway. This is the state the ticket found: reader alive, producer
  // absent, every gate green.
  const nc2 = E.compile({
    user: USER, messageCount: HISTORY.length, medium: "text", mode: "chat", voiceEngine: "gemini",
    isDirective: false, watching: false, innerThread: "", innerWants: "", memories: "",
    herLife: "", cultureNoteText: "", relBundle: ring.relBundle, selfBundle: null,
    latestUserText: SELF_TURN, gapSinceLastMs: 0, ageGates: null,
  });
  const nc2Missing = SELF_HEADERS.filter(([, h]) => !nc2.tail.includes(h)).map(([id]) => id);
  control(
    "NC2 a compile handed selfBundle:null while the rows exist",
    nc2Missing.length === 3,
    `all three dark: ${nc2Missing.join(", ") || "NOTHING — the gate is blind"}`,
  );

  // NC3 — THE ANTI-JOIN WITH ITS ANTI REMOVED. life.ts's own documented
  // regression: move `t.person_id` from the ON clause to the WHERE and the
  // left join silently becomes an inner join. Run the broken shape and show it
  // returns the told beat for P1.
  const leaked = await q(
    `select l.id from vy_agent_life l
      where l.agent_id = ($1)::uuid and l.status = 'approved' and l.at <= now()
        and l.arc_key like $2
      order by l.at desc`,
    [SELF_AGENT, `${SELF_ARC_KEY}%`],
  );
  const leakedTold = leaked.filter((r) => Number(r.id) === toldId);
  control(
    "NC3 the same query with no anti-join",
    leakedTold.length > 0,
    `returns ${leakedTold.length} already-told beat(s) for P1 — §6's first assertion is what catches it`,
  );

  // NC4 — THE MANIFEST AS EVIDENCE. The exact mistake `selfbundle-never-set`
  // records: `sourceStatus` said "wired" for all three, throughout an outage in
  // which they rendered zero bytes. Proved by pointing the manifest check at
  // NC2's demonstrably dark compile and watching it come back clean.
  const manifestSaysWired = SELF_HEADERS.every(([id]) => manifest[id]?.sourceStatus === "wired");
  control(
    "NC4 the manifest's own `sourceStatus` check",
    manifestSaysWired && nc2Missing.length === 3,
    `reports "wired" for T11/T12/T13 against a compile that rendered ${3 - nc2Missing.length}/3 of them — a comment with better syntax`,
  );

  // NC5 — THE FLOOR. A texture row exists and is delivered, but under the
  // n_turns floor it must still render nothing: wiring must not be able to
  // smuggle a personality assigned at random from a handful of turns.
  const thin = E.compile({
    user: USER, messageCount: HISTORY.length, medium: "text", mode: "chat", voiceEngine: "gemini",
    isDirective: false, watching: false, innerThread: "", innerWants: "", memories: "",
    herLife: "", cultureNoteText: "", relBundle: ring.relBundle,
    selfBundle: { ...recallP1.self, texture: { ...recallP1.self.texture, n_turns: 39 } },
    latestUserText: SELF_TURN, gapSinceLastMs: 0, ageGates: null,
  });
  control(
    "NC5 a delivered texture row one turn under the floor",
    !thin.tail.includes("HOW YOU TWO TALK"),
    `renders ${thin.sections.T11 ?? 0}b — the floor survives the wiring`,
  );

  // NC6 — G2. T13 on a turn SHE started must be suppressed, and the
  // suppression must survive the delivery path rather than living only in the
  // render fixture that never reaches production.
  captured.length = 0;
  await E.think(USER, { deviceId: SELF_D1, herLife: "" }, HISTORY, "", "chat", "gemini", true);
  const nc6 = lastPrompt();
  control(
    "NC6 a directive turn (SHE opened it) reaching T13",
    !nc6.system.includes("YOUR LIFE — WHAT THEY HAVE NOT HEARD"),
    `T13 suppressed on a she-initiated turn, through think(), not just in renderUntold`,
  );

  ok(
    `NEGATIVE CONTROLS: ${caught}/${controls} injected violations were caught`,
    caught === controls,
    `${controls - caught} missed`,
  );
} finally {
  // ═══════════════════════════════════════════════════════════════════════
  section("teardown · zero residue, including the two AGENT-scoped tables");
  globalThis.fetch = realFetch;
  const counts = {};
  const del = async (label, sql, params) => {
    const rows = await q(sql, params).catch((e) => {
      counts[`${label}:ERROR`] = String(e?.message || e).slice(0, 80);
      return [];
    });
    counts[label] = rows.length;
  };
  // told-rows first: vy_agent_life_told has no FK (the forget law), so
  // deleting beats first would leave dangling rows.
  await del(
    "vy_agent_life_told",
    `delete from vy_agent_life_told
      where life_id in (select id from vy_agent_life where arc_key like $1) returning 1`,
    [`${SELF_ARC_KEY}%`],
  );
  await del("vy_agent_life", `delete from vy_agent_life where arc_key like $1 returning 1`, [`${SELF_ARC_KEY}%`]);
  // The arc is deleted BY ID, never by agent: `delete ... where agent_id =
  // MEERA_AGENT_ID` would take out every real arc row this product ever writes.
  if (arcId) await del("vy_self_arc", `delete from vy_self_arc where id = ($1)::bigint returning 1`, [arcId]);
  const persons = [SELF_P1, SELF_P2];
  const devices = [SELF_D1, SELF_D2];
  await del("vy_rel_texture", `delete from vy_rel_texture where person_id = any($1::uuid[]) returning 1`, [persons]);
  await del("vy_rel_state", `delete from vy_rel_state where person_id = any($1::uuid[]) returning 1`, [persons]);
  await del("meera_log", `delete from meera_log where device_id = any($1::uuid[]) returning 1`, [devices]);
  await del("vy_person_device", `delete from vy_person_device where person_id = any($1::uuid[]) returning 1`, [persons]);
  await del("vy_person", `delete from vy_person where person_id = any($1::uuid[]) returning 1`, [persons]);
  console.log("  deleted:", JSON.stringify(counts));

  const RESIDUE_SQL = `select
       (select count(*) from vy_agent_life where arc_key like $1) +
       (select count(*) from vy_agent_life where beat like $2) +
       (select count(*) from vy_agent_life_told where person_id = any($3::uuid[])) +
       (select count(*) from vy_self_arc where note = $4) +
       (select count(*) from vy_rel_texture where person_id = any($3::uuid[])) +
       (select count(*) from vy_rel_state where person_id = any($3::uuid[])) +
       (select count(*) from meera_log where device_id = any($5::uuid[])) +
       (select count(*) from meera_log where content like $2) +
       (select count(*) from vy_person_device where person_id = any($3::uuid[])) +
       (select count(*) from vy_person where person_id = any($3::uuid[]))
       as n`;
  console.log(`  residue query:\n${RESIDUE_SQL.replace(/^/gm, "    ")}`);
  const residue = await q(
    RESIDUE_SQL,
    [`${SELF_ARC_KEY}%`, `${SELF_TAG}%`, persons, SELF_ARC_ROW.note, devices],
  ).catch(() => [{ n: -1 }]);
  ok(`zero residue after teardown (${residue[0].n} rows)`, Number(residue[0].n) === 0, `${residue[0].n}`);
}

console.log(failed ? `\n${failed} FAILURE(S) — ${passed} passed` : `\nall ${passed} checks passed`);
process.exit(failed ? 1 : 0);
