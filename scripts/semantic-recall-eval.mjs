// semantic-recall-eval — WS-CONSOLIDATE (M3) gate: "the semantic-recall eval
// set passes." A small honest set of query/fact pairs, styled on real
// meera_log shapes (Hinglish, casual, the register this product actually
// sees — checked against a live sample of production content before these
// were written), where the QUERY and the stored fact share zero surface
// tokens. This is the repo's own documented failure shape
// (context/decisions.md `spec-c-minimal`: "kaam stress" vs "office
// pressure" — a correct derivation with zero shared words that a lexical
// sweep would systematically retract).
//
// Each pair is written ONLY to vy_fact + vy_embedding for an isolated
// wscons-test- person — never to meera_nodes — so the keyword path (which in
// api/memory.js opRecall only ever reads meera_nodes) is STRUCTURALLY unable
// to find it. A pair only counts as a pass if the semantic path found it
// AND the keyword path's "RELEVANT"/"STANDING BACKGROUND" blocks are absent
// (proving the keyword channel really did fail, not just "wasn't tried").
//
//   node scripts/semantic-recall-eval.mjs         → run the set, exit 1 on any miss
//   node scripts/semantic-recall-eval.mjs --keep  → skip cleanup, for inspection
import { randomUUID } from "crypto";
import { q } from "../api/_db.js";
import { embedOne, toHalfvecLiteral } from "../api/_embed.js";
import memoryHandler from "../api/memory.js";

function mockCall(body) {
  const req = { method: "POST", headers: {}, body };
  return new Promise((resolve) => {
    let status = 200;
    const res = {
      setHeader() {},
      status(s) {
        status = s;
        return this;
      },
      json(j) {
        resolve({ status, json: j });
        return this;
      },
      end() {
        resolve({ status, json: null });
        return this;
      },
    };
    memoryHandler(req, res);
  });
}

// Query, the stored fact's telegraphic body (what a provisional/finalized
// vy_fact actually looks like — third person, no terminal punctuation), and
// a substring that must appear in the recalled text for the pair to count as
// found. Every pair verified below to share zero 4+-letter tokens.
const PAIRS = [
  {
    q: "kaam ka stress kaisa hai",
    body: "wscons-test- office pressure bahut zyada tha, boss deadline pe daal deta",
    mustContain: "boss deadline",
  },
  {
    q: "ghar sab theek hai na",
    body: "wscons-test- maa ki tabiyat kharab thi is hafte, doctor dikhaya unhe",
    mustContain: "doctor dikhaya",
  },
  {
    q: "khaana kya bana tha aaj",
    body: "wscons-test- rajma chawal banaya lunch mein, kaafi accha nikla",
    mustContain: "rajma chawal",
  },
  {
    q: "cricket match dekha kya",
    body: "wscons-test- india ne aakhri gend pe six maar ke jeet liya, ghar mein shor macha",
    mustContain: "aakhri gend",
  },
  {
    q: "padhai kaisi ja rahi hai",
    body: "wscons-test- paper ke liye poori raat jaagi library mein",
    mustContain: "jaagi library",
  },
  {
    q: "naukri mein naya kya",
    body: "wscons-test- manager ne promotion announce kiya sabke saamne",
    mustContain: "promotion announce",
  },
  {
    q: "chutti pe kahin jaa rahe",
    body: "wscons-test- pahaadi ilaake tak dost ke saath trekking karne nikle",
    mustContain: "trekking karne",
  },
  {
    q: "mann kaisa hai abhi tumhara",
    body: "wscons-test- subah se dil bhaari lag raha tha, baat karne ka dil nahi kar raha",
    mustContain: "dil bhaari",
  },
];

function tokens(s) {
  return new Set((s.toLowerCase().match(/[a-z]{4,}/g) || []));
}

// belt-and-braces: fail loudly if a pair was accidentally written with
// shared tokens, which would make it a keyword-recall test in disguise
for (const p of PAIRS) {
  const shared = [...tokens(p.q)].filter((w) => tokens(p.body).has(w));
  if (shared.length) {
    console.log(`FAIL  pair setup invalid, shares tokens ${JSON.stringify(shared)}: "${p.q}" / "${p.body}"`);
    process.exit(1);
  }
}

const keep = process.argv.includes("--keep");
const results = [];
const cleanupDevices = [];

for (const p of PAIRS) {
  const device = randomUUID();
  cleanupDevices.push(device);
  // one citation-anchor episode, shaped like a real provisional row
  const ep = await q(
    `insert into vy_episode (person_id, device_id, channel, participation, started_at, ended_at,
       boundary_reason, summary, provisional)
     values ($1,$1,'chat','user',now(),now(),'gap','wscons-test- eval anchor',true)
     returning id`,
    [device],
  );
  const episodeId = ep[0].id;
  const vec = await embedOne(p.body);
  const fact = await q(
    `insert into vy_fact (person_id, kind, name, body, provenance, confidence, citations, provisional)
     values ($1,'user','wscons-test-eval',$2,'extracted',0.8,$3::bigint[],true)
     returning id`,
    [device, p.body, [episodeId]],
  );
  if (vec) {
    await q(
      `insert into vy_embedding (owner_kind, owner_id, person_id, v) values ('fact',$1,$2,$3::halfvec)`,
      [fact[0].id, device, toHalfvecLiteral(vec)],
    );
  }

  const t0 = Date.now();
  const r = await mockCall({ op: "recall", device, query: p.q });
  const ms = Date.now() - t0;
  const text = String(r.json?.memories || "");
  const keywordFired = /RELEVANT TO WHAT THEY JUST SAID|STANDING BACKGROUND \(the big/.test(text);
  const semanticFired = text.includes(p.mustContain);
  const pass = semanticFired && !keywordFired;
  results.push({ q: p.q, pass, ms, semanticFired, keywordFired, text });
  console.log(
    `${pass ? "  ok " : "FAIL"}  "${p.q}" → semantic=${semanticFired} keywordAlsoFired=${keywordFired} (${ms}ms)`,
  );
  if (!pass) console.log(`      got: ${text.replace(/\n/g, " / ") || "(empty)"}`);
}

if (!keep) {
  for (const device of cleanupDevices) {
    await q(`delete from vy_embedding where person_id = $1`, [device]);
    await q(`delete from vy_fact where person_id = $1`, [device]);
    await q(`delete from vy_episode where person_id = $1`, [device]);
  }
  // zero-residue check
  const residue = await q(
    `select count(*)::int n from vy_fact where person_id = any($1::uuid[])`,
    [cleanupDevices],
  );
  console.log(`cleanup: residue rows = ${residue[0].n}`);
}

const passed = results.filter((r) => r.pass).length;
const p50 = results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)];
console.log(`\n${passed}/${results.length} semantic-recall pairs passed. p50 recall latency ${p50}ms.`);
process.exit(passed === results.length ? 0 : 1);
