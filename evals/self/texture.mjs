// WS-TEXTURE gates — src/engine/texture.ts (SPEC-SELF-LAYER §6, T11).
//
//   node evals/self/texture.mjs           pure suite, no network, no DB, $0
//   node evals/self/texture.mjs --live    + a seeded round trip and a residue
//                                           check against the real database
//
// WHAT THIS SUITE IS FOR. Texture's failure modes are quiet ones: a band
// computed over six turns still renders as a personality; a raw ratio in the
// prompt still reads as a number the model reasons about; an avoid topic with
// no citation still reads as authoritative. None of those throw. So every
// gate below asserts an ABSENCE, and an absence-only suite is worth nothing
// unless it can be shown to detect the presence — which is what the NEGATIVE
// CONTROL section does: the same three checkers are run against a renderer
// broken on purpose, and the suite fails if they come back clean.
//
// The gates, in order:
//   G1  n_turns floor        0 renders below the floor, across the fixture set
//   G2  no raw number        no digit anywhere in any rendered block
//   G3  budget               every rendered block <= 600 chars
//   G4  determinism          same input twice, byte-identical output
//   G5  avoid fails closed   an uncited avoid entry cannot be rendered
//   G6  register withheld    the axes persona.ts governs never render (§11)
//   G7  G1 starvation        the scan projects content and names no clock
//   G8  mirror drift         MEDIA_RE and the teasing markers vs their sources
//   G9  NEGATIVE CONTROL     the checkers catch a deliberately broken renderer
//   G10 live round trip      seeded, asserted, torn down, residue verified
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { MEDIA_RE } from "../dbattery/common.mjs";
import {
  TEX_TAG, TEX_AGENT, TEX_PERSON, TEX_LEGACY_PERSON, TEX_DEVICE,
  TEX_TURNS, TEX_NEAR_MISSES, TEX_ROWS, texRow,
} from "./_fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const LIVE = process.argv.includes("--live");

const tmp = mkdtempSync(join(tmpdir(), "wstex-"));
const bundle = (rel, name) => {
  const out = join(tmp, name);
  execSync(
    `npx esbuild ${join(ROOT, rel)} --bundle --format=esm --platform=node --outfile=${out} --log-level=error`,
    { stdio: "inherit", cwd: ROOT },
  );
  return out;
};

const T = await import(pathToFileURL(bundle("src/engine/texture.ts", "texture.bundle.mjs")).href);
const M = await import(pathToFileURL(bundle("src/engine/moment.ts", "moment.bundle.mjs")).href);
const SOURCE = readFileSync(join(ROOT, "src/engine/texture.ts"), "utf8");

let failed = 0;
let checks = 0;
const ok = (name) => {
  checks++;
  console.log(`  ok  ${name}`);
};
const fail = (name, detail) => {
  checks++;
  failed++;
  console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
};
const assert = (cond, name, detail) => (cond ? ok(name) : fail(name, detail));
const eq = (name, got, want) =>
  assert(JSON.stringify(got) === JSON.stringify(want), name, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

/** The body rows of a rendered block, header excluded — every content
 *  assertion runs against these, never against the header, because the
 *  header legitimately names the axes it promises NOT to change. */
const bodyLines = (text) =>
  text.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));

// ══════════════════════════════════════════════════════════════════════════
// The three checkers. Written as functions of a RENDER FUNCTION so the
// negative control can run the identical logic against a broken one.
// ══════════════════════════════════════════════════════════════════════════

/** Renders every fixture at every count from 0 to floor-1 and returns how
 *  many produced output. Must be 0. Note this ignores each fixture's own
 *  n_turns and sweeps the whole sub-floor range: the guarantee is about the
 *  floor, not about the particular numbers someone happened to write down. */
function countSubFloorRenders(render) {
  let renders = 0;
  let attempts = 0;
  for (const f of TEX_ROWS) {
    for (let n = 0; n < T.TEXTURE_N_TURNS_FLOOR; n++) {
      attempts++;
      if (render({ ...f.row, n_turns: n }).text !== "") renders++;
    }
  }
  return { renders, attempts };
}

/** Every digit that reaches a rendered block, from any source. */
function countDigitLeaks(render) {
  let leaks = 0;
  let rendered = 0;
  for (const f of TEX_ROWS) {
    const text = render(f.row).text;
    if (!text) continue;
    rendered++;
    if (/\d/.test(text)) leaks++;
  }
  return { leaks, rendered };
}

/** Every avoid line that rendered without a 1:1 citation behind it. */
function countUncitedAvoid(render) {
  let bad = 0;
  const cases = TEX_ROWS.filter((f) => (f.row.avoid ?? []).length);
  for (const f of cases) {
    const lines = bodyLines(render(f.row).text).filter((l) => l.startsWith("avoid: "));
    const cites = (f.row.avoid_cites ?? []).filter((c) => Number.isFinite(c) && c > 0);
    const paired = (f.row.avoid ?? []).length === (f.row.avoid_cites ?? []).length;
    if (!paired || cites.length === 0) bad += lines.length;
    else if (lines.length > cites.length) bad += lines.length - cites.length;
  }
  return { bad, cases: cases.length };
}

// ══════════════════════════════════════════════════════════════════════════
// G1 — the n_turns floor
// ══════════════════════════════════════════════════════════════════════════
console.log("\n── G1  n_turns floor ──");
{
  const { renders, attempts } = countSubFloorRenders(T.renderTexture);
  assert(renders === 0, `0 renders below the floor (${renders}/${attempts} sub-floor attempts rendered)`);
  assert(T.TEXTURE_N_TURNS_FLOOR === 40, `floor is 40 (${T.TEXTURE_N_TURNS_FLOOR})`);
  assert(T.renderTexture(null).text === "", "a null row renders nothing");
  for (const f of TEX_ROWS) {
    const text = T.renderTexture(f.row).text;
    assert(
      f.renders === (text !== ""),
      `fixture ${f.name} renders=${f.renders}`,
      f.why ? `reason: ${f.why}` : `got ${JSON.stringify(text.slice(0, 60))}`,
    );
  }
  // exactly at the floor is INSIDE, one below is OUTSIDE — the off-by-one
  assert(T.renderTexture(texRow({ n_turns: 40, teasing: 0.3 })).text !== "", "n_turns=40 renders");
  assert(T.renderTexture(texRow({ n_turns: 39, teasing: 0.3 })).text === "", "n_turns=39 does not");
}

// ══════════════════════════════════════════════════════════════════════════
// G2 — no raw number, anywhere
// ══════════════════════════════════════════════════════════════════════════
console.log("\n── G2  no raw number ──");
{
  const { leaks, rendered } = countDigitLeaks(T.renderTexture);
  assert(leaks === 0, `no digit in any rendered block (${leaks} leaks over ${rendered} blocks)`);
  // and the specific leak a naive renderer would produce
  const loud = T.renderTexture(texRow({ n_turns: 137, teasing: 0.34, humour: 0.61, profanity: 0.22 })).text;
  assert(!/0\.|\d/.test(loud), "a row of awkward ratios still renders only band words", loud);
  assert(loud.includes("teasing: constant"), "…and the band itself is a word", loud);
  // bands are total: every ratio in [0,1] maps to a non-empty band word
  let banded = 0;
  for (let i = 0; i <= 100; i++) {
    const r = i / 100;
    if (T.bandTeasing(r) && T.bandHumour(r)) banded++;
  }
  assert(banded === 101, `every ratio 0.00–1.00 has a band (${banded}/101)`);
}

// ══════════════════════════════════════════════════════════════════════════
// G3 — budget
// ══════════════════════════════════════════════════════════════════════════
console.log("\n── G3  budget ──");
{
  let worst = 0;
  let worstName = "";
  for (const f of TEX_ROWS) {
    const { text, lint } = T.renderTexture(f.row);
    if (text.length > worst) {
      worst = text.length;
      worstName = f.name;
    }
    if (text) assert(lint.clean, `fixture ${f.name} lints clean`, JSON.stringify(lint));
  }
  assert(worst <= T.TEXTURE_BUDGET, `worst-case block ${worst} <= ${T.TEXTURE_BUDGET} (${worstName})`);
  assert(T.TEXTURE_BUDGET === 600, `budget is the §8 number, 600 (${T.TEXTURE_BUDGET})`);
}

// ══════════════════════════════════════════════════════════════════════════
// G4 — determinism
// ══════════════════════════════════════════════════════════════════════════
console.log("\n── G4  determinism ──");
{
  const contents = [...TEX_TURNS.map((t) => t.text), ...TEX_NEAR_MISSES.map((t) => t.text)];
  const seen = [];
  const fakeQ = async (sql, params) => {
    seen.push({ sql, params });
    return contents.map((content) => ({ content }));
  };
  const a = await T.deriveTexture(fakeQ, TEX_PERSON, TEX_AGENT);
  const b = await T.deriveTexture(fakeQ, TEX_PERSON, TEX_AGENT);
  assert(JSON.stringify(a) === JSON.stringify(b), "deriveTexture: same input twice, byte-identical output");
  eq("the deriver issues exactly one query", seen.length, 2); // once per call
  eq("…with person, scan limit and agent as params", seen[0].params, [TEX_PERSON, T.TEXTURE_SCAN_LIMIT, TEX_AGENT]);

  // permutation invariance: every metric is a count or a median, so row order
  // out of the database cannot change the answer.
  const shuffled = [...contents].reverse();
  eq("textureCounts is permutation-invariant", T.textureCounts(shuffled), T.textureCounts(contents));

  // the deriver never invents the two curated fields
  eq("deriveTexture writes no nickname", a.nickname, "");
  eq("deriveTexture writes no avoid", a.avoid, []);
  eq("deriveTexture writes no avoid citations", a.avoid_cites, []);

  // counts match the fixtures' own declared hits — the expectation is
  // computed FROM the fixture, so it survives a marker-set change
  const expect = (axis) => TEX_TURNS.filter((t) => t.hits.includes(axis)).length;
  const n = contents.length;
  const r3 = (x) => Math.round((x / n) * 1000) / 1000;
  const c = T.textureCounts(contents);
  eq("teasing counted per fixture declaration", c.teasing, r3(expect("teasing")));
  eq("humour counted per fixture declaration", c.humour, r3(expect("humour")));
  eq("media counted per fixture declaration", c.media_rate, r3(expect("media")));
  eq("emoji counted per fixture declaration", c.emoji_rate, r3(expect("emoji")));
  eq("profanity counted per fixture declaration", c.profanity, r3(expect("profanity")));
  eq("n_turns is the scanned row count", c.n_turns, n);

  // the near-misses count for nothing, alone
  const nm = T.textureCounts(TEX_NEAR_MISSES.map((t) => t.text));
  for (const axis of ["teasing", "humour", "media_rate", "emoji_rate", "profanity"]) {
    assert(nm[axis] === 0, `near-misses score 0 on ${axis}`, `got ${nm[axis]}`);
  }
  eq("empty corpus is all zeros", T.textureCounts([]).n_turns, 0);
}

// ══════════════════════════════════════════════════════════════════════════
// G5 — avoid fails closed
// ══════════════════════════════════════════════════════════════════════════
console.log("\n── G5  avoid fails closed ──");
{
  const { bad, cases } = countUncitedAvoid(T.renderTexture);
  assert(bad === 0, `no uncited avoid line rendered (${bad} bad lines over ${cases} avoid fixtures)`);
  const cited = bodyLines(T.renderTexture(texRow({ n_turns: 80, avoid: ["his brother"], avoid_cites: [4021] })).text);
  assert(cited.some((l) => l === "avoid: his brother"), "a properly cited topic DOES render", JSON.stringify(cited));
  const capped = bodyLines(
    T.renderTexture(texRow({ n_turns: 80, avoid: ["a", "b", "c", "d", "e"], avoid_cites: [1, 2, 3, 4, 5] })).text,
  ).filter((l) => l.startsWith("avoid: "));
  assert(capped.length === 3, `avoid is capped at 3 lines (${capped.length})`);
  // the citation is evidence, never content: no episode id reaches the prompt
  assert(!T.renderTexture(texRow({ n_turns: 80, avoid: ["his brother"], avoid_cites: [4021] })).text.includes("4021"),
    "the citation itself never renders");
}

// ══════════════════════════════════════════════════════════════════════════
// G6 — the register axes are withheld (§11)
// ══════════════════════════════════════════════════════════════════════════
console.log("\n── G6  register withheld ──");
{
  const row = texRow({ n_turns: 300, media_rate: 0.95, words_median: 44, emoji_rate: 0.9, teasing: 0.3, humour: 0.3 });
  const lines = bodyLines(T.renderTexture(row).text);
  for (const word of ["media", "gif", "voicenote", "photo", "words", "length", "emoji", "turns"]) {
    assert(!lines.some((l) => l.toLowerCase().includes(word)), `no body line mentions "${word}"`, JSON.stringify(lines));
  }
  // and the same row with those three axes at zero renders IDENTICALLY —
  // the strongest form of "they are not in the block"
  const zeroed = T.renderTexture({ ...row, media_rate: 0, words_median: 0, emoji_rate: 0 }).text;
  assert(zeroed === T.renderTexture(row).text, "the withheld axes change nothing about the rendered block");
  // n_turns likewise: a gate, never a value
  const far = T.renderTexture({ ...row, n_turns: 4000 }).text;
  assert(far === T.renderTexture(row).text, "n_turns changes nothing above the floor");
  for (const f of TEX_ROWS) {
    if (!f.mustNotContain) continue;
    const lines2 = bodyLines(T.renderTexture(f.row).text).join(" ").toLowerCase();
    for (const word of f.mustNotContain) {
      assert(!lines2.includes(word), `fixture ${f.name}: body omits "${word}"`, f.why);
    }
  }
  for (const f of TEX_ROWS) {
    if (!f.mustContain) continue;
    const lines2 = bodyLines(T.renderTexture(f.row).text).join(" ").toLowerCase();
    for (const word of f.mustContain) assert(lines2.includes(word), `fixture ${f.name}: body carries "${word}"`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// G7 — G1 starvation, asserted structurally (SPEC §9 G-S4)
// ══════════════════════════════════════════════════════════════════════════
console.log("\n── G7  G1 starvation (structural) ──");
{
  const sql = T.TEXTURE_SCAN_SQL;
  const projection = sql.slice(sql.indexOf("select") + 6, sql.indexOf("from")).trim();
  assert(
    projection === "l.content, l.episode_id",
    `the scan projects only counted content and its drift citation id (got "${projection}")`,
  );
  for (const forbidden of ["l.at", "now(", "interval", "extract(", "lag(", "count(", "started_at", "created_at", "linked_at", "last_seen"]) {
    assert(!sql.includes(forbidden), `the scan never names ${forbidden}`);
  }
  assert(/order by\s+l\.id desc/.test(sql), "the window is ordered by the identity column, not by time");
  assert(sql.includes("l.role = 'her'"), "only HER turns are scanned — the user's turns are never read");
  assert(sql.includes("l.channel = 'chat'"), "call transcripts are excluded (channel mixing would measure how much they call)");
  assert(sql.includes("l.group_id is null"), "group turns are excluded (multiparty v1 is state-inert)");
  assert(sql.includes("l.agent_id = ($3)::uuid"), "the raw scan binds the active agent before its LIMIT");
  // and no clock reaches the module at all
  for (const forbidden of ["new Date", "Date.now", "performance.now", "setTimeout"]) {
    const hits = SOURCE.split("\n").filter((l) => l.includes(forbidden) && !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    assert(hits.length === 0, `texture.ts contains no ${forbidden}`, hits.join(" | "));
  }
  // import STATEMENTS only — the file's prose names api/_db.js repeatedly,
  // explaining why it does not import it, and a check that cannot tell those
  // two apart is a check that would fail for the right file.
  const imports = SOURCE.split("\n").filter((l) => /^\s*import\b/.test(l) || /^\s*}\s*from\s+["']/.test(l));
  assert(!imports.some((l) => l.includes("api/") || l.includes("_db") || l.includes("_config")),
    "texture.ts never imports the db layer", imports.join(" | "));
  // the writer names only the derived columns — it cannot clobber curation
  for (const col of ["nickname", "avoid"]) {
    const setList = SOURCE.slice(SOURCE.indexOf("do update set"), SOURCE.indexOf("updated_at = now()"));
    assert(!setList.includes(col), `the upsert's update set never names ${col}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// G8 — mirror drift
// ══════════════════════════════════════════════════════════════════════════
console.log("\n── G8  mirror drift ──");
{
  assert(T.TEXTURE_MEDIA_RE.source === MEDIA_RE.source && T.TEXTURE_MEDIA_RE.flags === MEDIA_RE.flags,
    "TEXTURE_MEDIA_RE is byte-identical to evals/dbattery/common.mjs's MEDIA_RE",
    `${T.TEXTURE_MEDIA_RE} vs ${MEDIA_RE}`);
  // the word-shaped teasing markers must still be teasing markers upstream.
  // moment.ts's padT strips emoji before matching, so its own emoji keys are
  // unreachable there — those are checked against this module's matcher
  // instead, which preserves them deliberately.
  const wordMarkers = T.TEASING_MARKERS.filter((m) => /^[a-z ]+$/.test(m));
  for (const m of wordMarkers) {
    assert(M.detectMomentShape(m) === "teasing", `moment.ts still classifies "${m}" as teasing`,
      `got ${M.detectMomentShape(m)}`);
  }
  const emojiMarkers = T.TEASING_MARKERS.filter((m) => !/^[a-z ]+$/.test(m));
  for (const m of emojiMarkers) {
    assert(T.textureCounts([`arre ${m}`]).teasing === 1, `this module counts the emoji marker "${m}"`);
    assert(M.detectMomentShape(`arre ${m}`) !== "teasing", `…and moment.ts still cannot (its padT strips it) — reported, not fixed`);
  }
  assert(T.textureCounts(["haha😭"]).humour === 1, "an emoji glued to a word still counts (padTexture separates it)");
  assert(T.textureCounts(["hahahahaha"]).humour === 1, "elongated laughter counts");
  assert(T.textureCounts(["abcde"]).profanity === 0, "'bc' inside a token is not a swear");
}

// ══════════════════════════════════════════════════════════════════════════
// G9 — NEGATIVE CONTROL. A suite of absence assertions is worthless unless it
// can be shown to detect a presence. This renderer is broken three ways on
// purpose; the three checkers above must catch all three.
// ══════════════════════════════════════════════════════════════════════════
console.log("\n── G9  negative control ──");
{
  const brokenRender = (row) => {
    if (!row) return { text: "", lint: { clean: true, violations: 0 } };
    const lines = [
      `teasing: ${row.teasing}`, // BREAK 2: a raw number
      `humour: ${T.bandHumour(row.humour)}`,
    ];
    // BREAK 3: avoid rendered with no citation check at all
    for (const t of (row.avoid ?? []).slice(0, 3)) lines.push(`avoid: ${t}`);
    // BREAK 1: no floor
    return { text: `BROKEN:\n${lines.map((l) => `- ${l}`).join("\n")}`, lint: { clean: true, violations: 0 } };
  };

  const floor = countSubFloorRenders(brokenRender);
  assert(floor.renders > 0, `checker G1 catches the missing floor (${floor.renders}/${floor.attempts} sub-floor renders detected)`);
  const digits = countDigitLeaks(brokenRender);
  assert(digits.leaks > 0, `checker G2 catches the raw numbers (${digits.leaks}/${digits.rendered} blocks leaked a digit)`);
  const uncited = countUncitedAvoid(brokenRender);
  assert(uncited.bad > 0, `checker G5 catches the uncited avoid lines (${uncited.bad} caught over ${uncited.cases} fixtures)`);

  // and the control is only meaningful if the real renderer passes the SAME
  // three checkers on the SAME fixtures — asserted here, together, so the
  // pair reads as one experiment rather than two unrelated numbers.
  assert(
    countSubFloorRenders(T.renderTexture).renders === 0 &&
      countDigitLeaks(T.renderTexture).leaks === 0 &&
      countUncitedAvoid(T.renderTexture).bad === 0,
    "the real renderer passes all three checkers the broken one fails",
  );
}

// ══════════════════════════════════════════════════════════════════════════
// G10 — live round trip. Seeded with `wstex-test-` content, asserted, torn
// down, residue verified. Skipped without --live.
// ══════════════════════════════════════════════════════════════════════════
if (LIVE) {
  console.log("\n── G10  live round trip ──");
  const { q } = await import(join(ROOT, "api/_db.js"));
  const PERSONS = [TEX_PERSON, TEX_LEGACY_PERSON];

  const teardown = async () => {
    await q(`delete from meera_log where content like $1`, [`${TEX_TAG}%`]);
    await q(`delete from vy_rel_texture where person_id = any($1::uuid[])`, [PERSONS]);
    await q(`delete from vy_person_device where device_id = ($1)::uuid`, [TEX_DEVICE]);
    await q(`delete from vy_person where person_id = any($1::uuid[])`, [PERSONS]);
  };

  try {
    await teardown(); // never trust a previous run's exit path
    for (const p of PERSONS) {
      await q(`insert into vy_person (person_id) values (($1)::uuid) on conflict do nothing`, [p]);
    }
    await q(
      `insert into vy_person_device (device_id, person_id) values (($1)::uuid,($2)::uuid)
       on conflict (device_id) do update set person_id = excluded.person_id`,
      [TEX_DEVICE, TEX_PERSON],
    );

    // 48 of her chat turns (the 12 fixtures, four times) — comfortably over
    // the floor of 40 and under the scan limit of 400.
    const seeded = [];
    for (let i = 0; i < 4; i++) for (const t of TEX_TURNS) seeded.push(t.text);
    const agentP = seeded.length + 2;
    const rowsSql = seeded
      .map((_, i) => `(($1)::uuid,'her','chat','text',$${i + 2},null,($${agentP})::uuid)`)
      .join(",");
    await q(
      `insert into meera_log (device_id, role, channel, kind, content, group_id, agent_id) values ${rowsSql}`,
      [TEX_DEVICE, ...seeded, TEX_AGENT],
    );
    // decoys: every one of them matches the person and must NOT be counted.
    await q(
      `insert into meera_log (device_id, role, channel, kind, content, group_id, agent_id) values
         (($1)::uuid,'me','chat','text',$2,null,($5)::uuid),
         (($1)::uuid,'her','call','text',$3,null,($5)::uuid),
         (($1)::uuid,'her','chat','text',$4,7770001,($5)::uuid)`,
      [
        TEX_DEVICE,
        `${TEX_TAG} decoy his own turn haha roast bhenchod`,
        `${TEX_TAG} decoy call turn haha roast bhenchod`,
        `${TEX_TAG} decoy group turn haha roast bhenchod`,
        TEX_AGENT,
      ],
    );
    // the legacy path: log rows keyed by the person id itself, no device row
    await q(
      `insert into meera_log (device_id, role, channel, kind, content, group_id, agent_id)
       values (($1)::uuid,'her','chat','text',$2,null,($3)::uuid)`,
      [TEX_LEGACY_PERSON, `${TEX_TAG} legacy path haha`, TEX_AGENT],
    );

    const derived = await T.deriveTexture(q, TEX_PERSON, TEX_AGENT);
    const expected = T.textureCounts(seeded);
    // compared field by field, in a fixed order — an object-key-order
    // difference is not a measurement difference
    const axes = ["teasing", "humour", "media_rate", "words_median", "emoji_rate", "profanity", "n_turns"];
    eq("live derive matches the pure count over the same turns",
      axes.map((k) => [k, derived[k]]), axes.map((k) => [k, expected[k]]));
    assert(derived.n_turns === seeded.length, `decoys excluded: n_turns=${derived.n_turns}, expected ${seeded.length}`);

    const legacy = await T.deriveTexture(q, TEX_LEGACY_PERSON, TEX_AGENT);
    assert(legacy.n_turns === 1, `the vy_person_device UNION branch resolves (n_turns=${legacy.n_turns})`);

    await T.upsertTexture(q, derived);
    const readBack = await T.readTexture(q, TEX_PERSON, TEX_AGENT);
    eq("stored teasing round-trips", readBack.teasing, derived.teasing);
    eq("stored n_turns round-trips", readBack.n_turns, derived.n_turns);
    eq("stored nickname defaults empty", readBack.nickname, "");
    eq("stored avoid defaults empty", readBack.avoid, []);

    // curation survives a re-derivation — the reason the update set is short
    await q(
      `update vy_rel_texture set nickname = $3, avoid = $4::text[], avoid_cites = $5::bigint[]
        where agent_id = ($1)::uuid and person_id = ($2)::uuid`,
      [TEX_AGENT, TEX_PERSON, `${TEX_TAG}nick`, ["his brother"], [4021]],
    );
    await T.upsertTexture(q, await T.deriveTexture(q, TEX_PERSON, TEX_AGENT));
    const after = await T.readTexture(q, TEX_PERSON, TEX_AGENT);
    eq("a re-derivation cannot clobber a curated nickname", after.nickname, `${TEX_TAG}nick`);
    eq("…nor a curated avoid list", after.avoid, ["his brother"]);
    eq("…nor its citations", after.avoid_cites, [4021]);
  } finally {
    await teardown();
    const residue = {
      meera_log: Number((await q(`select count(*)::int as n from meera_log where content like $1`, [`${TEX_TAG}%`]))[0].n),
      vy_rel_texture: Number((await q(`select count(*)::int as n from vy_rel_texture where person_id = any($1::uuid[])`, [PERSONS]))[0].n),
      vy_person_device: Number((await q(`select count(*)::int as n from vy_person_device where device_id = ($1)::uuid`, [TEX_DEVICE]))[0].n),
      vy_person: Number((await q(`select count(*)::int as n from vy_person where person_id = any($1::uuid[])`, [PERSONS]))[0].n),
    };
    eq("zero residue after teardown", residue, { meera_log: 0, vy_rel_texture: 0, vy_person_device: 0, vy_person: 0 });
  }
} else {
  console.log("\n── G10  live round trip — SKIPPED (pass --live) ──");
}

console.log(`\n${failed ? "FAILED" : "PASSED"}: ${checks - failed}/${checks} checks`);
process.exit(failed ? 1 : 0);
