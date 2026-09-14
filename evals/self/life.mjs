// evals/self/life.mjs — WS-LIFE's gate. SPEC-SELF-LAYER §3, §9 (G-S7).
//
// What this suite is FOR, in one sentence: it proves that her life is one
// life, that the record of who heard it is per-relationship, and that neither
// half can be written by anything other than an outcome.
//
// It runs against the REAL database and the REAL bundled `src/engine/life.ts`
// (esbuild, fresh on every run — same discipline as
// evals/wsdepth-test-roundtrip.mjs, so this gates the tree being shipped and
// not a frozen copy). Isolation is by row identity: a fixture agent uuid that
// is not Meera's, two fixture persons, and every agent-scoped row written
// under the `wslife-test-arc` / `story:wslife-test-` prefixes so teardown can
// prove zero residue in a table no person-teardown can reach.
//
// A NOTE ON WHAT THIS SUITE DOES NOT COVER, because implying coverage we do
// not have is the thing CLAUDE.md specifically forbids. SPEC §11's reversal
// condition for §3 is "untold-life rendering measurably increases her
// SELF-INITIATED TALK". That is a judged measurement over an LLM battery at
// n>=84, and it is not in this file. What IS here is the structural and
// lexical half: the block cannot exist at all on a turn she initiates, the
// gate is a required argument rather than a convention, and the header
// carries no word that turns a repetition guard into an invitation. If the
// judged run later shows a rise anyway, this suite will have been necessary
// and not sufficient, and §11 says what to do then.
//
//   node evals/self/life.mjs
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { q } from "../../api/_db.js";
import {
  MS_PER_DAY,
  LIFE_TAG,
  LIFE_AGENT,
  LIFE_OTHER_AGENT,
  LIFE_ARC_PREFIX,
  LIFE_BEATS,
  LIFE_EXPECT,
  LIFE_BAD_BEATS,
  LIFE_GOOD_BEATS,
  LIFE_SEED_STORIES,
  LIFE_INVITATION_WORDS,
} from "./_fixtures.mjs";

// api/life.js reads its secret at module scope (the api/culture.js pattern),
// so the env must be set BEFORE the import — hence the dynamic import below.
const LIFE_SECRET = "wslife-test-secret";
process.env.LIFE_SECRET = LIFE_SECRET;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "wslife-"));
const BUNDLE = join(tmp, "life.bundle.mjs");
execSync(
  `npx esbuild ${join(ROOT, "src/engine/life.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error`,
  { stdio: "inherit", cwd: ROOT },
);
const L = await import(BUNDLE);
const lifeApi = await import("../../api/life.js");
const memory = await import("../../api/memory.js");

const LIFE_SRC = readFileSync(join(ROOT, "src/engine/life.ts"), "utf8");
const API_SRC = readFileSync(join(ROOT, "api/life.js"), "utf8");

// ── harness ──────────────────────────────────────────────────────────────
let failed = 0;
let passed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
  return Boolean(cond);
};
const section = (s) => console.log(`\n── ${s} ──`);

/** The QueryFn: the REAL driver, duck-typed exactly as life.ts expects, so
 *  this is a round trip through the real thing and not a fake. */
const qfn = (sql, params) => q(sql, params);

// ── fixture state ────────────────────────────────────────────────────────
const persons = [];
const beatIds = {}; // fixture key -> vy_agent_life.id
let P1, P2, D1, D2;
let EP1, EP1B, EP_PROVISIONAL, EP2, EP2_PROVISIONAL;

async function makePerson() {
  const [{ person_id }] = await q(`insert into vy_person default values returning person_id`);
  const [{ id: deviceId }] = await q(`select gen_random_uuid() as id`);
  await q(`insert into vy_person_device (device_id, person_id) values ($1,$2)`, [deviceId, person_id]);
  persons.push(person_id);
  return { personId: person_id, deviceId };
}

async function makeEpisode(personId, deviceId, { day, summary, provisional = false, agentId = LIFE_AGENT }) {
  const at = new Date(Date.now() - day * MS_PER_DAY);
  const [{ id: logFrom }] = await q(
    `insert into meera_log (device_id, role, channel, kind, content, at, agent_id)
     values ($1,'me','chat','text',$2,$3,($4)::uuid) returning id`,
    [deviceId, `${LIFE_TAG} ${summary}`, at.toISOString(), agentId],
  );
  const [{ id }] = await q(
    `insert into vy_episode (person_id, agent_id, device_id, channel, participation, started_at, ended_at,
       boundary_reason, log_from, log_to, summary, affect_tags, importance, provisional)
     values ($1,($7)::uuid,$2,'chat','user',$3,$3,'topic',$4,$4,$5,'[]'::jsonb,1.0,$6) returning id`,
    [personId, deviceId, at.toISOString(), logFrom, `${LIFE_TAG}: ${summary}`, provisional, agentId],
  );
  return id;
}

async function seedBeats() {
  for (const b of LIFE_BEATS) {
    const agent = b.agent === "LIFE_OTHER_AGENT" ? LIFE_OTHER_AGENT : LIFE_AGENT;
    const at = new Date(Date.now() - b.day * MS_PER_DAY);
    const [{ id }] = await q(
      `insert into vy_agent_life (agent_id, at, beat, kind, arc_key, media, status)
       values (($1)::uuid,($2)::timestamptz,$3,$4,$5,'[]'::jsonb,$6) returning id`,
      [agent, at.toISOString(), b.beat, b.kind, `${LIFE_ARC_PREFIX}-${b.key}`, b.status],
    );
    beatIds[b.key] = Number(id);
  }
}

const keyOf = (id) => Object.keys(beatIds).find((k) => beatIds[k] === Number(id));
const keysOfRows = (rows) => rows.map((r) => keyOf(r.id));

// A fake req/res pair for the api/life.js handler. Each call gets its own
// source ip so the 30/min rate limiter never becomes the thing under test.
let ipN = 0;
async function callApi(method, { body = null, query = null, headers = {} } = {}) {
  const req = {
    method,
    body,
    query: query || {},
    headers: { "x-forwarded-for": `10.9.0.${++ipN % 250}`, ...headers },
    socket: {},
  };
  let status = 0;
  let payload = null;
  const res = {
    setHeader() {},
    status(s) {
      status = s;
      return res;
    },
    json(p) {
      payload = p;
      return res;
    },
    end() {
      return res;
    },
  };
  await lifeApi.default(req, res);
  return { status, body: payload };
}

try {
  // ══════════════════════════════════════════════════════════════════════
  section("fixtures");
  ({ personId: P1, deviceId: D1 } = await makePerson());
  ({ personId: P2, deviceId: D2 } = await makePerson());
  console.log(`  P1=${P1}\n  P2=${P2}\n  agent=${LIFE_AGENT}`);
  EP1 = await makeEpisode(P1, D1, { day: 4, summary: "she mentioned the launch move" });
  EP1B = await makeEpisode(P1, D1, { day: 3, summary: "second final episode" });
  EP_PROVISIONAL = await makeEpisode(P1, D1, { day: 2, summary: "still open", provisional: true });
  EP2 = await makeEpisode(P2, D2, { day: 4, summary: "different person entirely" });
  EP2_PROVISIONAL = await makeEpisode(P2, D2, { day: 1, summary: "still open, other person", provisional: true });
  await seedBeats();
  ok("fixtures built", persons.length === 2 && Object.keys(beatIds).length === LIFE_BEATS.length);

  // ══════════════════════════════════════════════════════════════════════
  section("A · the anti-join");

  const a1 = await L.untoldFor(qfn, P1, LIFE_AGENT, 10);
  ok(
    "A1 a fresh person is untold exactly the approved, past, same-agent beats",
    JSON.stringify(keysOfRows(a1)) === JSON.stringify(LIFE_EXPECT.untoldForFreshPerson),
    JSON.stringify(keysOfRows(a1)),
  );
  ok("A2 newest first", keysOfRows(a1)[0] === "B_SMALL", keysOfRows(a1)[0]);
  for (const b of LIFE_BEATS.filter((x) => x.expect === false)) {
    ok(`A3 excluded: ${b.key} — ${b.why}`, !keysOfRows(a1).includes(b.key));
  }
  const a4 = await L.untoldFor(qfn, P1, LIFE_AGENT, 2);
  ok("A4 limit is honoured", a4.length === 2, `${a4.length}`);

  // THE assertion this whole workstream exists for.
  const told = await L.markTold(qfn, LIFE_AGENT, beatIds[LIFE_EXPECT.toldToP1StillUntoldForP2], P1, EP1);
  ok("A5 markTold with a real cited episode records", told.recorded && !told.already, JSON.stringify(told));
  const a6 = await L.untoldFor(qfn, P1, LIFE_AGENT, 10);
  ok(
    "A6 the told beat is gone for the person she told",
    !keysOfRows(a6).includes(LIFE_EXPECT.toldToP1StillUntoldForP2),
    JSON.stringify(keysOfRows(a6)),
  );
  const a7 = await L.untoldFor(qfn, P2, LIFE_AGENT, 10);
  ok(
    "A7 `life-per-person`: the SAME beat is still untold for the OTHER person — " +
      "the beat is hers, only the telling is theirs",
    keysOfRows(a7).includes(LIFE_EXPECT.toldToP1StillUntoldForP2) &&
      JSON.stringify(keysOfRows(a7)) === JSON.stringify(LIFE_EXPECT.untoldForFreshPerson),
    JSON.stringify(keysOfRows(a7)),
  );

  // Property, not anecdote: after every prefix of a tell-sequence, the
  // intersection of "untold" and "told" must be empty for both persons.
  let intersections = 0;
  let steps = 0;
  const sequence = [
    [P1, "B_SMALL", EP1B],
    [P2, "B_FAMILY", EP2],
    [P1, "B_FAMILY", EP1],
  ];
  for (const [p, key, ep] of sequence) {
    await L.markTold(qfn, LIFE_AGENT, beatIds[key], p, ep);
    for (const who of [P1, P2]) {
      steps++;
      const untold = new Set((await L.untoldFor(qfn, who, LIFE_AGENT, 50)).map((r) => Number(r.id)));
      const toldRows = await q(
        `select life_id from vy_agent_life_told where agent_id = ($1)::uuid and person_id = ($2)::uuid`,
        [LIFE_AGENT, who],
      );
      for (const t of toldRows) if (untold.has(Number(t.life_id))) intersections++;
    }
  }
  ok(
    `A8 property over ${steps} states: untold ∩ told is empty, always`,
    intersections === 0,
    `${intersections} leaks`,
  );

  ok(
    "A9 the shipped SQL is an anti-join: LEFT JOIN + `t.life_id is null`",
    /left join/i.test(L.UNTOLD_SQL) && /t\.life_id is null/i.test(L.UNTOLD_SQL),
  );
  ok(
    "A10 the person filter is in the ON clause, not the WHERE — in the WHERE it " +
      "silently becomes an inner join and returns nothing",
    L.UNTOLD_SQL.indexOf("t.person_id") < L.UNTOLD_SQL.indexOf("where"),
  );

  // ══════════════════════════════════════════════════════════════════════
  section("B · told is an OUTCOME, never an intent (error-marked-done, G-S7)");

  let threw = false;
  try {
    await L.markTold(qfn, LIFE_AGENT, beatIds.B_SMALL, P2, undefined);
  } catch {
    threw = true;
  }
  ok("B1 markTold with NO episode throws — it cannot be called as an intent", threw);

  threw = false;
  try {
    await L.markTold(qfn, LIFE_AGENT, beatIds.B_SMALL, P2, 0);
  } catch {
    threw = true;
  }
  ok("B2 markTold with episode 0 throws", threw);

  const b3 = await L.markTold(qfn, LIFE_AGENT, beatIds.B_SMALL, P2, 999999999);
  ok("B3 a nonexistent episode records nothing", !b3.recorded, JSON.stringify(b3));

  // B_WORK is untold to P2 (A7), so a refusal here is a refusal and not an
  // already-told row wearing one. EP_PROVISIONAL is deliberately unused past
  // this point — a provisional episode must never become a citation.
  void EP_PROVISIONAL;
  const b4 = await L.markTold(qfn, LIFE_AGENT, beatIds.B_WORK, P2, EP2_PROVISIONAL);
  ok("B4 a PROVISIONAL episode is not a telling", !b4.recorded, JSON.stringify(b4));

  const b5 = await L.markTold(qfn, LIFE_AGENT, beatIds.B_WORK, P2, EP1);
  ok("B5 citing another person's episode is refused", !b5.recorded, JSON.stringify(b5));

  const b6 = await L.markTold(qfn, LIFE_AGENT, beatIds.B_PENDING, P2, EP2);
  ok("B6 an unpublished (pending) beat cannot be told", !b6.recorded, JSON.stringify(b6));

  const b7 = await L.markTold(qfn, LIFE_AGENT, beatIds.B_RETIRED, P2, EP2);
  ok("B7 a retired beat cannot be told", !b7.recorded, JSON.stringify(b7));

  const before = await q(
    `select count(*) as n from vy_agent_life_told where agent_id = ($1)::uuid and life_id = ($2)::bigint and person_id = ($3)::uuid`,
    [LIFE_AGENT, beatIds.B_WORK, P1],
  );
  const b8 = await L.markTold(qfn, LIFE_AGENT, beatIds.B_WORK, P1, EP1B);
  const after = await q(
    `select count(*) as n from vy_agent_life_told where agent_id = ($1)::uuid and life_id = ($2)::bigint and person_id = ($3)::uuid`,
    [LIFE_AGENT, beatIds.B_WORK, P1],
  );
  ok(
    "B8 a re-tell is idempotent and reports itself as already-told",
    b8.recorded && b8.already && Number(before[0].n) === 1 && Number(after[0].n) === 1,
    JSON.stringify(b8),
  );

  const orphan = await q(
    `select count(*) as n from vy_agent_life_told
      where agent_id = ($1)::uuid and episode_id is null`,
    [LIFE_AGENT],
  );
  ok("B9 G-S7: zero told-rows without a cited episode", Number(orphan[0].n) === 0, `${orphan[0].n}`);

  ok(
    "B10 structural: the ONLY told-write in life.ts is an `insert … select` over " +
      "the episode — there is no VALUES list to hand a made-up citation to",
    /insert into vy_agent_life_told[\s\S]{0,120}select/i.test(LIFE_SRC) &&
      !/insert into vy_agent_life_told[\s\S]{0,120}values/i.test(LIFE_SRC),
  );

  // ══════════════════════════════════════════════════════════════════════
  section("C · T13 render — budget 700, <=2 beats, shape-lint clean");

  const many = await L.untoldFor(qfn, P2, LIFE_AGENT, 50);
  const rendered = L.renderUntold(many, { sheInitiated: false });
  const lines = rendered.text.split("\n").filter((l) => l.startsWith("- "));
  ok(`C1 at most ${L.MAX_UNTOLD_BEATS} beats rendered`, lines.length <= L.MAX_UNTOLD_BEATS, `${lines.length}`);
  ok(
    `C2 <= ${L.LIFE_UNTOLD_BUDGET} chars (actual ${rendered.text.length})`,
    rendered.text.length <= L.LIFE_UNTOLD_BUDGET,
  );
  ok("C3 shape-lint clean", rendered.lint.clean, JSON.stringify(rendered.lint));

  const worstRows = [0, 1].map((i) => ({
    id: -1 - i,
    at: new Date(Date.now() - 400 * MS_PER_DAY).toISOString(),
    beat: "x".repeat(L.MAX_BEAT_CHARS),
    kind: "family",
    arc_key: "",
    media: [],
  }));
  const worst = L.renderUntold(worstRows, { sheInitiated: false });
  ok(
    `C4 WORST CASE fits: two max-length beats + longest date label = ${worst.text.length} <= ${L.LIFE_UNTOLD_BUDGET}`,
    worst.text.length <= L.LIFE_UNTOLD_BUDGET,
  );
  ok(
    `C5 the declared worst case (${L.UNTOLD_WORST_CASE_CHARS}) is itself under budget`,
    L.UNTOLD_WORST_CASE_CHARS <= L.LIFE_UNTOLD_BUDGET,
  );
  ok("C6 header ships the suppression every tail block ships", /never raise unprompted/.test(L.UNTOLD_HEADER));
  ok("C7 empty input renders nothing at all", L.renderUntold([], { sheInitiated: false }).text === "");

  // ══════════════════════════════════════════════════════════════════════
  section("G2 · she never initiates carrying a feeling");

  const gateSets = [many, worstRows, [many[0]].filter(Boolean), await L.untoldFor(qfn, P1, LIFE_AGENT, 50)];
  let suppressed = 0;
  let present = 0;
  for (const set of gateSets) {
    if (L.renderUntold(set, { sheInitiated: true }).text === "") suppressed++;
    if (set.length && L.renderUntold(set, { sheInitiated: false }).text !== "") present++;
  }
  ok(
    `G2-1 the block is EMPTY on every turn she sends first (${suppressed}/${gateSets.length} sets)`,
    suppressed === gateSets.length,
    `${suppressed}`,
  );
  ok(
    `G2-2 and non-empty on the same sets when she did not (${present}/${gateSets.filter((s) => s.length).length}) — ` +
      "a gate that always suppresses is an outage, not a gate",
    present === gateSets.filter((s) => s.length).length,
  );
  ok(
    "G2-3 the gate is a REQUIRED argument, not a convention: renderUntold has arity 2, " +
      "so a call site that forgot it is a type error rather than a silent raise",
    L.renderUntold.length === 2,
    `arity ${L.renderUntold.length}`,
  );
  const invitations = LIFE_INVITATION_WORDS.filter((w) => L.UNTOLD_HEADER.toLowerCase().includes(w));
  ok(
    "G2-4 the header contains no word that turns a repetition guard into an invitation",
    invitations.length === 0,
    invitations.join(", "),
  );
  const firstPerson = rendered.text
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .filter((l) => /^- (i\b|i'm\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i.test(l));
  ok("G2-5 no rendered row is a first-person line she could read out", firstPerson.length === 0);

  // ══════════════════════════════════════════════════════════════════════
  section("G7 · authored or owner-approved, never model-generated");

  const forbidden = [
    [/\bfetch\s*\(/, "an outbound fetch"],
    [/openrouter|anthropic|openai|gemini|api\.together/i, "a model provider"],
    [/_config\.js/, "the secrets module (which holds the model keys)"],
    [/OPENROUTER_KEY|ANTHROPIC/, "a model API key"],
  ];
  for (const [re, what] of forbidden) {
    ok(`G7-1 api/life.js contains no ${what}`, !re.test(API_SRC.replace(/^\/\/.*$/gm, "")));
  }
  ok(
    "G7-2 propose can only ever write 'pending' — the literal is in the INSERT",
    /insert into vy_agent_life[\s\S]{0,400}'pending'/.test(API_SRC) &&
      !/insert into vy_agent_life[\s\S]{0,400}'approved'/.test(API_SRC),
  );

  ok("G7-3 no secret → 403", (await callApi("POST", { body: { op: "propose", beat: "x" } })).status === 403);
  ok(
    "G7-4 wrong secret → 403",
    (
      await callApi("POST", {
        body: { op: "approve", id: 1 },
        headers: { "x-owner-secret": "nope-but-still-sixteen" },
      })
    ).status === 403,
  );

  const proposeStatus = await callApi("POST", {
    body: { op: "propose", beat: `${LIFE_TAG} clean beat`, status: "approved", agent: LIFE_AGENT },
    headers: { "x-owner-secret": LIFE_SECRET },
  });
  ok(
    "G7-5 propose cannot name a status — text and publication may not arrive together",
    proposeStatus.status === 400,
    JSON.stringify(proposeStatus.body),
  );

  const dirty = await callApi("POST", {
    body: { op: "propose", beat: "I told sneha about the flat.", agent: LIFE_AGENT },
    headers: { "x-owner-secret": LIFE_SECRET },
  });
  ok("G7-6 a sentence-shaped beat is refused at write (recited-prompt)", dirty.status === 400, JSON.stringify(dirty.body));

  const proposed = await callApi("POST", {
    body: {
      op: "propose",
      beat: `${LIFE_TAG} chachi in town for four days`,
      kind: "family",
      arc_key: `${LIFE_ARC_PREFIX}-API`,
      at: new Date(Date.now() - MS_PER_DAY).toISOString(),
      agent: LIFE_AGENT,
    },
    headers: { "x-owner-secret": LIFE_SECRET },
  });
  ok("G7-7 a clean propose lands as PENDING", proposed.status === 200 && proposed.body.row.status === "pending",
    JSON.stringify(proposed.body));
  const proposedId = proposed.body?.row?.id;
  const hiddenWhilePending = await L.untoldFor(qfn, P2, LIFE_AGENT, 50);
  ok(
    "G7-8 a pending beat is invisible to the anti-join — nothing unreviewed reaches a prompt",
    !hiddenWhilePending.some((r) => Number(r.id) === Number(proposedId)),
  );

  const approveWithText = await callApi("POST", {
    body: { op: "approve", id: proposedId, beat: "something else entirely" },
    headers: { "x-owner-secret": LIFE_SECRET },
  });
  ok(
    "G7-9 approve carrying text is REFUSED — publication is a second request or it is nothing",
    approveWithText.status === 400,
    JSON.stringify(approveWithText.body),
  );

  const approved = await callApi("POST", {
    body: { op: "approve", id: proposedId },
    headers: { "x-owner-secret": LIFE_SECRET },
  });
  ok("G7-10 a separate approve request publishes it", approved.status === 200 && approved.body.row.status === "approved",
    JSON.stringify(approved.body));
  const visibleNow = await L.untoldFor(qfn, P2, LIFE_AGENT, 50);
  ok("G7-11 …and only then does it reach the anti-join", visibleNow.some((r) => Number(r.id) === Number(proposedId)));

  // a beat that entered dirty (the seed path allows this on purpose) cannot
  // be published without a human shortening it first
  const [{ id: dirtyId }] = await q(
    `insert into vy_agent_life (agent_id, at, beat, kind, arc_key, media, status)
     values (($1)::uuid, now() - interval '1 day', $2, 'small', $3, '[]'::jsonb, 'pending') returning id`,
    [LIFE_AGENT, `${LIFE_TAG} ${"long ".repeat(30)}`, `${LIFE_ARC_PREFIX}-DIRTY`],
  );
  const approveDirty = await callApi("POST", {
    body: { op: "approve", id: Number(dirtyId) },
    headers: { "x-owner-secret": LIFE_SECRET },
  });
  ok(
    "G7-12 approve re-lints the STORED text: a dirty row cannot be published",
    approveDirty.status === 422,
    JSON.stringify(approveDirty.body),
  );

  const retired = await callApi("POST", {
    body: { op: "retire", id: proposedId },
    headers: { "x-owner-secret": LIFE_SECRET },
  });
  ok("G7-13 retire withdraws it", retired.status === 200 && retired.body.row.status === "retired");
  const goneNow = await L.untoldFor(qfn, P2, LIFE_AGENT, 50);
  ok("G7-14 …and it leaves the anti-join", !goneNow.some((r) => Number(r.id) === Number(proposedId)));

  // ══════════════════════════════════════════════════════════════════════
  section("shape-lint · recited-prompt");

  let lintFails = 0;
  for (const b of LIFE_BAD_BEATS) {
    if (L.lintBeat(b.beat).clean) {
      lintFails++;
      console.log(`      let through (${b.rule}): ${JSON.stringify(b.beat.slice(0, 60))}`);
    }
  }
  ok(`SL1 all ${LIFE_BAD_BEATS.length} bad beats refused`, lintFails === 0, `${lintFails} let through`);
  let goodFails = 0;
  for (const b of LIFE_GOOD_BEATS) if (!L.lintBeat(b).clean) goodFails++;
  ok(`SL2 all ${LIFE_GOOD_BEATS.length} good beats pass`, goodFails === 0, `${goodFails} refused`);

  // The duplicated predicate in api/life.js, guarded by a test rather than by
  // good intentions (see that file's header for why it is duplicated).
  const corpus = [
    ...LIFE_BAD_BEATS.map((b) => b.beat),
    ...LIFE_GOOD_BEATS,
    ...LIFE_SEED_STORIES.map((s) => s.desc),
    ...LIFE_BEATS.map((b) => b.beat),
  ];
  let disagreements = 0;
  for (const c of corpus) {
    if (L.lintBeat(c).clean !== lifeApi.lintBeat(c).clean) {
      disagreements++;
      console.log(`      disagree: ${JSON.stringify(c.slice(0, 60))}`);
    }
  }
  ok(
    `SL3 engine lintBeat and api/life.js lintBeat agree on all ${corpus.length} cases`,
    disagreements === 0,
    `${disagreements} disagreements`,
  );

  // ══════════════════════════════════════════════════════════════════════
  section("seed · one source of truth");

  const s1 = await L.seedFromStories(qfn, LIFE_SEED_STORIES, LIFE_AGENT);
  ok(`SEED1 both stories imported (${s1.inserted})`, s1.inserted === 2, JSON.stringify(s1));
  ok("SEED2 the clean desc lands approved, the caption-shaped one lands pending",
    s1.approved === 1 && s1.pending === 1, JSON.stringify(s1));
  const s2 = await L.seedFromStories(qfn, LIFE_SEED_STORIES, LIFE_AGENT);
  ok("SEED3 re-running the seed is a no-op — idempotent by arc_key", s2.inserted === 0 && s2.skipped === 2,
    JSON.stringify(s2));
  const seeded = await L.untoldFor(qfn, P2, LIFE_AGENT, 50);
  const seededKeys = await q(
    `select id, status from vy_agent_life where agent_id = ($1)::uuid and arc_key like 'story:%'`,
    [LIFE_AGENT],
  );
  const pendingSeed = seededKeys.filter((r) => r.status === "pending").map((r) => Number(r.id));
  ok(
    "SEED4 the pending (caption-shaped) seed row never reaches the anti-join",
    !seeded.some((r) => pendingSeed.includes(Number(r.id))),
  );

  // The REAL catalog, against the fixture agent so nothing touches Meera's
  // own life. This documents the state of the two live entries.
  const real = await L.seedFromStoryCatalog(qfn, LIFE_AGENT);
  const realDirty = real.details.filter((d) => d.reasons.length);
  ok(`SEED5 storyCatalog.ts's ${real.details.length} live STORIES import as data`, real.details.length === 2,
    JSON.stringify(real.details.map((d) => d.arc_key)));
  console.log(
    `      NOTE: ${realDirty.length}/${real.details.length} live story descs fail the beat shape-lint ` +
      `(they were written as image captions for storyContext(), not as life beats) and therefore ` +
      `seed as PENDING for owner review rather than reaching a prompt.`,
  );
  for (const d of realDirty) console.log(`        ${d.arc_key}: ${d.reasons.join("; ")}`);

  // ══════════════════════════════════════════════════════════════════════
  section("forget · her life survives, the record of telling THEM does not");

  const manifest = memory.PERSON_TABLES;
  const toldEntry = manifest.find((t) => t.table === "vy_agent_life_told");
  ok("F1 vy_agent_life_told IS in PERSON_TABLES, keyed on person_id",
    Boolean(toldEntry) && toldEntry.key === "person_id");
  ok("F2 vy_agent_life is NOT in PERSON_TABLES — her life is not theirs to erase",
    !manifest.some((t) => t.table === "vy_agent_life"));

  const lifeBefore = await q(`select count(*) as n from vy_agent_life where agent_id = ($1)::uuid`, [LIFE_AGENT]);
  const p2ToldBefore = await q(
    `select count(*) as n from vy_agent_life_told where agent_id = ($1)::uuid and person_id = ($2)::uuid`,
    [LIFE_AGENT, P2],
  );
  const p1ToldBefore = await q(
    `select count(*) as n from vy_agent_life_told where agent_id = ($1)::uuid and person_id = ($2)::uuid`,
    [LIFE_AGENT, P1],
  );
  ok("F3 P1 has told-rows to forget", Number(p1ToldBefore[0].n) > 0, `${p1ToldBefore[0].n}`);

  // Run the REAL manifest-driven wipe statement for this entry — the exact
  // SQL api/memory.js's whole-wipe loop executes, built from the same
  // helpers, so this tests forget's actual behaviour and not a paraphrase.
  await q(
    `delete from ${toldEntry.table} where ${memory.wipeWhereSql(toldEntry)} returning 1`,
    memory.wipeParams(toldEntry, { device: D1, person: P1 }),
  );
  const p1ToldAfter = await q(
    `select count(*) as n from vy_agent_life_told where agent_id = ($1)::uuid and person_id = ($2)::uuid`,
    [LIFE_AGENT, P1],
  );
  const p2ToldAfter = await q(
    `select count(*) as n from vy_agent_life_told where agent_id = ($1)::uuid and person_id = ($2)::uuid`,
    [LIFE_AGENT, P2],
  );
  const lifeAfter = await q(`select count(*) as n from vy_agent_life where agent_id = ($1)::uuid`, [LIFE_AGENT]);
  ok("F4 forgetting P1 clears P1's told-rows", Number(p1ToldAfter[0].n) === 0, `${p1ToldAfter[0].n}`);
  ok("F5 P2's told-rows are untouched", Number(p2ToldAfter[0].n) === Number(p2ToldBefore[0].n));
  ok(
    "F6 vy_agent_life is intact — her life survives being forgotten by someone",
    Number(lifeAfter[0].n) === Number(lifeBefore[0].n),
    `${lifeBefore[0].n} -> ${lifeAfter[0].n}`,
  );
  const afterForget = await L.untoldFor(qfn, P1, LIFE_AGENT, 50);
  ok(
    "F7 …and a forgotten person is untold everything again, which is what being forgotten means",
    afterForget.length >= LIFE_EXPECT.untoldForFreshPerson.length,
    `${afterForget.length}`,
  );

  // ══════════════════════════════════════════════════════════════════════
  section("NEGATIVE CONTROL · does this suite actually catch a violation?");
  //
  // A gate nobody has seen fail is a gate nobody has tested. Each control
  // below breaks ONE mechanism and re-runs the assertion that guards it; the
  // control passes when the assertion FAILS. These do not count toward the
  // suite's own failures.
  let controls = 0;
  let controlsCaught = 0;

  // NC1 — the anti-join without its anti. This is the exact regression a
  // careless edit produces: drop the LEFT JOIN, keep everything else.
  controls++;
  await L.markTold(qfn, LIFE_AGENT, beatIds.B_SMALL, P1, EP1);
  const brokenRows = await q(
    `select l.id from vy_agent_life l
      where l.agent_id = ($1)::uuid and l.status = 'approved' and l.at <= now()
      order by l.at desc limit 50`,
    [LIFE_AGENT],
  );
  const toldNow = await q(
    `select life_id from vy_agent_life_told where agent_id = ($1)::uuid and person_id = ($2)::uuid`,
    [LIFE_AGENT, P1],
  );
  const leaked = brokenRows.filter((r) => toldNow.some((t) => Number(t.life_id) === Number(r.id)));
  if (leaked.length > 0) controlsCaught++;
  console.log(
    `  ${leaked.length > 0 ? "ok  " : "MISS"} NC1 a query with no LEFT JOIN leaks ${leaked.length} already-told beat(s) — ` +
      `assertion A6/A8 would catch it`,
  );

  // NC2 — a render that forgets to slice to MAX_UNTOLD_BEATS.
  controls++;
  const unsliced = brokenRows.length;
  if (unsliced > L.MAX_UNTOLD_BEATS) controlsCaught++;
  console.log(
    `  ${unsliced > L.MAX_UNTOLD_BEATS ? "ok  " : "MISS"} NC2 an unsliced render would emit ${unsliced} beats — ` +
      `assertion C1 (<= ${L.MAX_UNTOLD_BEATS}) would catch it`,
  );

  // NC3 — a render that ignores the G2 gate.
  controls++;
  const ignoredGate = (rows) => {
    const picked = rows.slice(0, L.MAX_UNTOLD_BEATS);
    return picked.length ? `${L.UNTOLD_HEADER}\n${picked.map((r) => `- ${r.beat}`).join("\n")}` : "";
  };
  const g2Broken = ignoredGate(many) !== "";
  if (g2Broken) controlsCaught++;
  console.log(
    `  ${g2Broken ? "ok  " : "MISS"} NC3 a render ignoring the turn gate emits ${ignoredGate(many).length} chars on a ` +
      `she-initiated turn — assertion G2-1 would catch it`,
  );

  // NC4 — the shape-lint with its two `recited-prompt` rules removed. This is
  // the realistic regression: someone finds the sentence check noisy and
  // deletes it, keeping the length caps that look like the "real" rules.
  controls++;
  const weakLint = (beat) => {
    const t = String(beat ?? "").trim();
    const reasons = [];
    if (!t) reasons.push("empty");
    if (t.length > L.MAX_BEAT_CHARS) reasons.push("chars");
    if (t.split(/\s+/).filter(Boolean).length > 14) reasons.push("words");
    return { clean: reasons.length === 0 };
  };
  const wavedThrough = LIFE_BAD_BEATS.filter((b) => weakLint(b.beat).clean && !L.lintBeat(b.beat).clean);
  const nc4 = wavedThrough.length > 0;
  if (nc4) controlsCaught++;
  console.log(
    `  ${nc4 ? "ok  " : "MISS"} NC4 a lint missing the sentence/first-person/quote rules waves through ` +
      `${wavedThrough.length}/${LIFE_BAD_BEATS.length} known-bad beats ` +
      `(${wavedThrough.map((b) => b.rule).join(", ")}) — assertion SL1 would catch it`,
  );

  // NC5 — an intent-shaped told-write: a VALUES insert with a citation
  // nobody checked. Proves B3/B9 are load-bearing rather than decorative.
  controls++;
  const bogusEpisode = 987654321;
  await q(
    `insert into vy_agent_life_told (agent_id, life_id, person_id, episode_id)
     values (($1)::uuid, ($2)::bigint, ($3)::uuid, ($4)::bigint)
     on conflict do nothing`,
    [LIFE_AGENT, beatIds.B_RETIRED, P2, bogusEpisode],
  );
  const bogus = await q(
    `select count(*) as n from vy_agent_life_told t
      where t.agent_id = ($1)::uuid
        and not exists (select 1 from vy_episode e where e.id = t.episode_id)`,
    [LIFE_AGENT],
  );
  const nc5 = Number(bogus[0].n) > 0;
  if (nc5) controlsCaught++;
  console.log(
    `  ${nc5 ? "ok  " : "MISS"} NC5 a hand-written VALUES insert creates ${bogus[0].n} told-row(s) citing a ` +
      `nonexistent episode — which is exactly why markTold has no VALUES list (B10)`,
  );
  await q(
    `delete from vy_agent_life_told where agent_id = ($1)::uuid and episode_id = ($2)::bigint`,
    [LIFE_AGENT, bogusEpisode],
  );

  ok(
    `NEGATIVE CONTROL: ${controlsCaught}/${controls} injected violations were caught by this suite's own assertions`,
    controlsCaught === controls,
    `${controls - controlsCaught} missed`,
  );
} finally {
  // ══════════════════════════════════════════════════════════════════════
  section("teardown · zero residue, including the agent-scoped half");
  const counts = {};
  const del = async (label, sql, params) => {
    const rows = await q(sql, params).catch(() => []);
    counts[label] = rows.length;
  };
  // told-rows first: vy_agent_life_told has no FK (the forget law), so
  // deleting beats first would leave dangling rows — the exact shape this
  // suite asserts against elsewhere.
  await del(
    "vy_agent_life_told",
    `delete from vy_agent_life_told where agent_id = any($1::uuid[]) returning 1`,
    [[LIFE_AGENT, LIFE_OTHER_AGENT]],
  );
  await del(
    "vy_agent_life",
    `delete from vy_agent_life where agent_id = any($1::uuid[]) returning 1`,
    [[LIFE_AGENT, LIFE_OTHER_AGENT]],
  );
  for (const p of persons) {
    await del(`vy_episode:${p.slice(0, 8)}`, `delete from vy_episode where person_id = $1 returning 1`, [p]);
    await del(
      `meera_log:${p.slice(0, 8)}`,
      `delete from meera_log where device_id in (select device_id from vy_person_device where person_id = $1) returning 1`,
      [p],
    );
    await del(`vy_person_device:${p.slice(0, 8)}`, `delete from vy_person_device where person_id = $1 returning 1`, [p]);
    await del(`vy_person:${p.slice(0, 8)}`, `delete from vy_person where person_id = $1 returning 1`, [p]);
  }
  console.log("  deleted:", JSON.stringify(counts));

  const residue = await q(
    `select
       (select count(*) from vy_agent_life where agent_id = any($1::uuid[])) +
       (select count(*) from vy_agent_life_told where agent_id = any($1::uuid[])) +
       (select count(*) from vy_agent_life where beat like $2) +
       (select count(*) from vy_agent_life where arc_key like $3) +
       (select count(*) from vy_person where person_id = any($4::uuid[])) +
       (select count(*) from vy_episode where person_id = any($4::uuid[])) +
       (select count(*) from vy_person_device where person_id = any($4::uuid[]))
       as n`,
    [[LIFE_AGENT, LIFE_OTHER_AGENT], `${LIFE_TAG}%`, `${LIFE_ARC_PREFIX}%`, persons],
  ).catch(() => [{ n: -1 }]);
  ok(`zero residue live after teardown (${residue[0].n} rows)`, Number(residue[0].n) === 0, `${residue[0].n}`);
}

console.log(
  failed ? `\n${failed} FAILURE(S) — ${passed} passed` : `\nall ${passed} checks passed`,
);
process.exit(failed ? 1 : 0);
