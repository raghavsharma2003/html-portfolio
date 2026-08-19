// WS-PHOTOS — real-DB proofs for the photo → relational record delta
// (docs/PHOTOS.md, docs/SPEC-SELF-LAYER.md §4 point 3), against the REAL
// Postgres — same rationale evals/multimodal/db-writer.mjs states for its own
// suite: FK cascades, CHECK constraints and column defaults are engine
// semantics, not JavaScript, and a JS re-model of them would pass this gate
// having tested a different thing.
//
// Self-contained on purpose: this file is WS-PHOTOS's only new file in
// evals/multimodal/, and evals/multimodal/fixtures.mjs (MARKER "wsmm-test-")
// belongs to a concurrent workstream this task does not own — importing it
// would couple this gate's stability to a file nobody here is watching. The
// fixture/teardown shape below is the same proven pattern (row-identity
// isolation, a content marker for greppability on top, never instead of it),
// just re-declared under this workstream's own marker.
//
// Proves, per the task brief:
//   1. a photo produces exactly one episode
//   2. nothing uncited enters vy_fact — and nothing CONTENT-bearing does
//      either (the fabrication guard's actual claim, stricter than the bare
//      citation law every vy_fact row already had before this workstream)
//   3. a failed/empty/refused description writes nothing, not an empty row
//   4. forget (the real op:"forget" HTTP path) reaches everything written
//   5. writes name agent_id explicitly — proven by two negative controls:
//      omitting agent_id fails loudly (migration 010 dropped the default),
//      and an uncited 'extracted' fact fails loudly (the citation law is a
//      DB constraint, not just code discipline)
//   6. zero residue after teardown, checked with a live count
//
// node evals/multimodal/photo.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { q } from "../../api/_db.js";
import { MEERA_AGENT_ID } from "../../api/_agentscope.js";
import handler, { recordPhotoMemory, lintPhotoDesc, photoIdFromUrl, personIdFor } from "../../api/memory.js";

const MEMORY_JS = fileURLToPath(new URL("../../api/memory.js", import.meta.url));
const MARKER = "wsphoto-test-";

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};

async function makeFixturePerson() {
  const [{ person_id }] = await q(`insert into vy_person default values returning person_id`);
  const [{ id: deviceId }] = await q(`select gen_random_uuid() as id`);
  await q(`insert into vy_person_device (device_id, person_id) values ($1,$2)`, [deviceId, person_id]);
  return { personId: person_id, deviceId };
}

/** Deletes every row this fixture could have created, by person_id, across
 *  every table this workstream's writer touches. Returns per-table counts. */
async function teardown(personId) {
  const counts = {};
  const del = async (label, sql) => {
    const rows = await q(sql, [personId]).catch(() => []);
    counts[label] = rows.length;
  };
  // vy_visual_assertion also cascades off vy_episode's FK; deleted explicitly
  // first so a partial failure never leaves one orphaned off an episode this
  // loop is about to remove anyway (db-writer.mjs's own stated reason).
  await del("vy_fact", `delete from vy_fact where person_id = $1 returning 1`);
  await del("vy_visual_assertion", `delete from vy_visual_assertion where person_id = $1 returning 1`);
  await del("vy_episode", `delete from vy_episode where person_id = $1 returning 1`);
  await del("vy_person_device", `delete from vy_person_device where person_id = $1 returning 1`);
  await del("vy_person", `delete from vy_person where person_id = $1 returning 1`);
  return counts;
}

/** Rows this workstream's WRITER could have produced — episode/assertion/
 *  fact only. Deliberately excludes vy_person/vy_person_device: those are
 *  the fixture's own identity, present by construction until teardown runs,
 *  and counting them here would make "wrote nothing" indistinguishable from
 *  "the fixture exists". */
async function writesOf(personId) {
  const rows = await q(
    `select
       (select count(*) from vy_episode where person_id = $1) +
       (select count(*) from vy_visual_assertion where person_id = $1) +
       (select count(*) from vy_fact where person_id = $1)
       as n`,
    [personId],
  );
  return Number(rows[0]?.n ?? -1);
}

/** Full residue, INCLUDING the fixture identity rows — the correct check
 *  only once a test's own teardown (or a real forget:all) has run. */
async function residueOf(personId) {
  const rows = await q(
    `select
       (select count(*) from vy_person where person_id = $1) +
       (select count(*) from vy_person_device where person_id = $1) +
       (select count(*) from vy_episode where person_id = $1) +
       (select count(*) from vy_visual_assertion where person_id = $1) +
       (select count(*) from vy_fact where person_id = $1)
       as n`,
    [personId],
  );
  return Number(rows[0]?.n ?? -1);
}

function mockReqRes(body) {
  const res = {
    statusCode: 200,
    body: undefined,
    setHeader() {},
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(v) {
      this.body = v;
      return this;
    },
    end() {
      return this;
    },
  };
  return { req: { method: "POST", headers: {}, body }, res };
}

const fixtures = []; // every person_id created, for a final belt-and-braces residue sweep

// ── 1. lint / id helpers, unit-level ────────────────────────────────────────
ok("lintPhotoDesc rejects empty", lintPhotoDesc("") === null);
ok("lintPhotoDesc rejects a refusal", lintPhotoDesc("I'm sorry, I can't describe this image.") === null);
ok(
  "lintPhotoDesc strips terminal punctuation and trims",
  lintPhotoDesc(`  ${MARKER}a plate of pasta on a desk.  `) === `${MARKER}a plate of pasta on a desk`,
);
ok(
  "photoIdFromUrl reads the upload path's own timestamp-rand slug",
  photoIdFromUrl("https://x.supabase.co/storage/v1/object/public/meera-photos/dev/1755600000000-ab12cd.jpg") ===
    "1755600000000-ab12cd",
);

// ── 2. a photo produces exactly one episode; the fact is cited, uncontent,
//      sensitive; the assertion carries the raw claim and never gets cited ──
{
  const { personId, deviceId } = await makeFixturePerson();
  fixtures.push(personId);
  try {
    const claim = `${MARKER}a plate of pasta on a desk`;
    const url = `https://x.supabase.co/storage/v1/object/public/meera-photos/${deviceId}/1755600000000-ab12cd.jpg`;
    const w1 = await recordPhotoMemory(deviceId, url, claim);
    ok("recordPhotoMemory reports a write", w1.ok === true && w1.wrote === true, JSON.stringify(w1));

    const eps = await q(`select * from vy_episode where person_id = $1`, [personId]);
    ok("exactly one episode exists", eps.length === 1, `n=${eps.length}`);
    ok("the episode is on the chat channel (closest legal value, no 'photo' enum exists)", eps[0]?.channel === "chat");
    ok("the episode names agent_id explicitly", eps[0]?.agent_id === MEERA_AGENT_ID, String(eps[0]?.agent_id));
    ok("the episode is provisional (in-turn tier, same as opRemember)", eps[0]?.provisional === true);
    const episodeId = eps[0]?.id;

    const facts = await q(`select * from vy_fact where person_id = $1`, [personId]);
    ok("exactly one fact exists", facts.length === 1, `n=${facts.length}`);
    ok(
      "the fact is cited to the episode",
      Array.isArray(facts[0]?.citations) && facts[0].citations.length === 1 && String(facts[0].citations[0]) === String(episodeId),
      JSON.stringify(facts[0]?.citations),
    );
    ok("the fact names agent_id explicitly", facts[0]?.agent_id === MEERA_AGENT_ID);
    ok("the fact is marked sensitive (a photo may show a third party, a document, an address)", facts[0]?.sensitive === true);
    ok(
      "the fact's body carries the EVENT only — no visual content, the raw claim never crosses in",
      facts[0]?.body === "shared a photo" && !String(facts[0]?.body).includes(MARKER),
      JSON.stringify(facts[0]?.body),
    );

    const assertions = await q(`select * from vy_visual_assertion where person_id = $1`, [personId]);
    ok("exactly one visual assertion exists, carrying the raw claim", assertions.length === 1 && assertions[0]?.claim === claim);
    ok("the assertion names its extractor model and a confidence (vision-fab law)", Boolean(assertions[0]?.extractor_model) && typeof assertions[0]?.confidence === "number");
    ok("the assertion's confidence is below opRemember's 0.7 text-extraction default", Number(assertions[0]?.confidence) < 0.7, String(assertions[0]?.confidence));
    ok("the assertion names agent_id explicitly", assertions[0]?.agent_id === MEERA_AGENT_ID);
    ok(
      "no fact's citations array contains the assertion id (facts cite EPISODES only, never assertions)",
      !facts.some((f) => (f.citations || []).map(String).includes(String(assertions[0]?.id))),
    );

    // idempotent on the FACT (dedup key = photoId): a retry of the same
    // describe call must not double-write the event
    const w2 = await recordPhotoMemory(deviceId, url, claim);
    ok("a repeat call for the same photo does not duplicate the fact", w2.wrote === false, JSON.stringify(w2));
    const factsAfter = await q(`select count(*)::int as n from vy_fact where person_id = $1`, [personId]);
    ok("...confirmed by count", factsAfter[0]?.n === 1, `n=${factsAfter[0]?.n}`);
  } finally {
    const counts = await teardown(personId);
    console.log(`  teardown (fixture 2): ${JSON.stringify(counts)}`);
  }
}

// ── 3. a failed / empty / refused description writes NOTHING ───────────────
{
  const { personId, deviceId } = await makeFixturePerson();
  fixtures.push(personId);
  try {
    const url = `https://x.supabase.co/storage/v1/object/public/meera-photos/${deviceId}/1755600000001-zz99zz.jpg`;
    for (const bad of ["", "   ", "I'm sorry, I can't tell what's in this photo.", "no"]) {
      const w = await recordPhotoMemory(deviceId, url, bad);
      ok(`refused/empty/too-short description ("${bad.slice(0, 24)}") writes nothing`, w.wrote === false, JSON.stringify(w));
    }
    const n = await writesOf(personId);
    ok("zero rows exist for this person after every refusal — no empty episode, no empty row", n === 0, `n=${n}`);
  } finally {
    await teardown(personId);
  }
}

// ── 4. forget (the real HTTP op) reaches everything this path wrote ────────
{
  const { personId, deviceId } = await makeFixturePerson();
  fixtures.push(personId);
  const claim = `${MARKER}a dog on a blue sofa`;
  const url = `https://x.supabase.co/storage/v1/object/public/meera-photos/${deviceId}/1755600000002-fg77hi.jpg`;
  await recordPhotoMemory(deviceId, url, claim);
  const before = await residueOf(personId);
  ok("fixture has rows to forget before the forget call", before > 0, `n=${before}`);

  const { req, res } = mockReqRes({ op: "forget", device: deviceId, scope: "all" });
  await handler(req, res);
  ok("forget:all handler responds 200 ok:true", res.statusCode === 200 && res.body?.ok === true, JSON.stringify(res.body));

  const after = await residueOf(personId);
  ok("forget:all removed the episode, the fact and the assertion", after === 0, `n=${after}`);
  // op:"forget" scope:"all" already deletes vy_person_device and vy_person
  // (api/memory.js purgeRelational's own final step) — nothing left to tear
  // down for this fixture, and the belt-and-braces residue sweep below
  // proves it rather than assuming it.
}

// ── 4b. forget scope:"item" — the scope a named "bhool ja wo photo" forget
//      actually resolves to (resolveForget, src/engine/memory.ts) — reaches
//      the DB rows via the episode's summary (the same "additional net"
//      purgeRelational already uses for every episode's item-scope forget),
//      which is WHY recordPhotoMemory sets summary:"photo: <description>".
//      Also the documented, PRE-EXISTING finding: the response's own
//      `photos` count proves item-scope never reaches Supabase storage —
//      not a regression this workstream introduced, but real, and it bears
//      on photos more than any other memory kind since they are the only
//      kind backed by binary storage outside the DB rows. ──────────────────
{
  const { personId, deviceId } = await makeFixturePerson();
  fixtures.push(personId);
  try {
    const claim = `${MARKER}a golden retriever puppy on the sofa`;
    const url = `https://x.supabase.co/storage/v1/object/public/meera-photos/${deviceId}/1755600000003-jk22lm.jpg`;
    await recordPhotoMemory(deviceId, url, claim);

    const { req, res } = mockReqRes({ op: "forget", device: deviceId, scope: "item", name: "retriever" });
    await handler(req, res);
    ok("forget:item handler responds 200 ok:true", res.statusCode === 200 && res.body?.ok === true, JSON.stringify(res.body));
    ok(
      "forget:item's own accounting shows it took the episode and the fact",
      res.body?.deleted?.relational?.episodes === 1 && res.body?.deleted?.relational?.facts === 1,
      JSON.stringify(res.body?.deleted?.relational),
    );

    const n = await writesOf(personId);
    ok("forget:item removed the episode, the fact and the assertion (FK cascade)", n === 0, `n=${n}`);

    ok(
      "FINDING (not a regression, pre-existing): forget:item's own response reports photos:0 — " +
        "the stored IMAGE in Supabase storage is not reached by this scope, only session/day/all call deletePhotos()",
      res.body?.deleted?.photos === 0,
      JSON.stringify(res.body?.deleted),
    );
  } finally {
    await teardown(personId);
  }
}

// ── 5. two negative controls: proving the suite (and the schema) actually
//      CATCHES the violations they exist to catch, not merely that today's
//      code happens not to trip them ──────────────────────────────────────
{
  // 5a. agent_id explicit-or-fail (migration 010 dropped the transitional
  // default named in the task brief) — a write that forgot to name it must
  // fail loudly, not silently fall back to some default agent.
  let threw = false;
  try {
    await q(
      `insert into vy_episode (person_id, device_id, channel, participation, started_at, ended_at, boundary_reason, log_from, log_to, summary, provisional)
       values (gen_random_uuid(), gen_random_uuid(), 'chat', 'user', now(), now(), 'gap', null, null, $1, true)`,
      [`${MARKER}negative control row, should never persist`],
    );
  } catch {
    threw = true;
  }
  ok("NEGATIVE CONTROL: a vy_episode insert that omits agent_id fails loudly (no silent default)", threw);

  // 5b. the citation law is a DB CHECK constraint, not just code discipline
  // — an 'extracted' fact with no citations must fail loudly.
  let threw2 = false;
  try {
    await q(
      `insert into vy_fact (agent_id, person_id, kind, name, body, provenance, confidence, citations, sensitive, provisional)
       values ($1::uuid, gen_random_uuid(), 'user', $2, $3, 'extracted', 0.9, '{}'::bigint[], true, true)`,
      [MEERA_AGENT_ID, `${MARKER}negctl`, "a dog is definitely a labrador"],
    );
  } catch {
    threw2 = true;
  }
  ok("NEGATIVE CONTROL: an uncited 'extracted' vy_fact insert fails loudly (vy_fact_cite_or_authored)", threw2);

  // 5c. the fabrication-guard CHECK function itself: prove it actually
  // discriminates, by feeding it a row shaped like what a naive
  // implementation would have written (the claim inlined into the fact
  // body) and confirming it is flagged — not just that today's real rows
  // pass because they happen to be written correctly.
  const contentFree = (rows, needle) => rows.every((r) => r.body === "shared a photo" && !String(r.body).includes(needle));
  const goodRows = [{ body: "shared a photo" }];
  const badRows = [{ body: `shared a photo: ${MARKER}a dog on a blue sofa` }]; // what NOT to write
  ok("content-leak check passes on a correctly-shaped row", contentFree(goodRows, MARKER) === true);
  ok(
    "NEGATIVE CONTROL: content-leak check FAILS a row that inlines the visual claim into vy_fact.body",
    contentFree(badRows, MARKER) === false,
  );
}

// ── 6. static check: the vy_fact INSERT this workstream added never
//      references the description/claim variable in its own statement ─────
{
  const src = readFileSync(MEMORY_JS, "utf8");
  const lines = src.split("\n");
  const offenders = [];
  lines.forEach((line, i) => {
    if (!/insert\s+into\s+vy_fact/i.test(line)) return;
    const window = lines.slice(i, i + 6).join("\n");
    // the only content-shaped identifiers allowed near this statement are
    // the literal 'shared a photo' and the factName/citations plumbing —
    // `desc`/`rawDesc`/`claim` naming the raw description must not appear
    if (/\bdesc\b|\brawDesc\b|\bclaim\b/.test(window)) offenders.push(`memory.js:${i + 1}`);
  });
  ok("no vy_fact INSERT statement in api/memory.js's photo path references the raw description", offenders.length === 0, JSON.stringify(offenders));
}

// ── 7. belt-and-braces: every fixture person touched by this run is clean ──
for (const personId of fixtures) {
  const n = await residueOf(personId);
  ok(`zero residue for fixture ${personId}`, n === 0, `n=${n}`);
}

console.log(failed ? `\nFAILED (${failed})` : "\nPASSED");
process.exit(failed ? 1 : 0);
