// Read one turn back, end to end — docs/TRACE.md.
//
// This file exists because of `dead-writers`: "correct code with no caller is
// indistinguishable from absent code". A trace nobody can query is not a trace,
// it is a table. So the query path ships in the same change as the writer, and
// the eval in evals/trace/ proves it against a real turn rather than a fixture.
//
// It is also the ONLY read path into meera_turn / meera_turn_leg. There is no
// endpoint, no op, no admin page — reading requires the NEON_URL in the
// gitignored api/_config.js, i.e. an operator on their own machine. That is the
// access rule (docs/TRACE.md L3), and it is a missing code path rather than a
// promise about who looks.
//
//   node scripts/trace.mjs --list [--device D] [--person P] [--flagged] [-n 20]
//   node scripts/trace.mjs --last [--device D]
//   node scripts/trace.mjs --turn <turn_id> [--content]
//   node scripts/trace.mjs --flags [--days 7]
//   node scripts/trace.mjs --recheck [-n 500]
//   node scripts/trace.mjs --residue <prefix> [--purge]
//
// `--content` is OPT-IN and prints what was actually said, resolved from
// meera_log by the row ids the trace stored. That separation is the design: the
// trace holds the reference, the operator decides to follow it, and a person
// who asked to be forgotten has no rows to follow to.
import { q } from "../api/_db.js";
import { deriveFlags } from "../api/_trace.js";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const num = (f, d) => Number(val(f, null) ?? d);

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

const ms = (n) => (n == null ? dim("—") : `${n}ms`);
const bytes = (n) => (n == null ? dim("—") : `${n}b`);

function stamp(t) {
  return t ? new Date(t).toISOString().replace("T", " ").slice(0, 19) : "—";
}

// ── --list ────────────────────────────────────────────────────────────────
async function list() {
  const where = [];
  const params = [];
  if (val("--device")) {
    params.push(val("--device"));
    where.push(`device_id = $${params.length}`);
  }
  if (val("--person")) {
    params.push(val("--person"));
    where.push(`person_id = $${params.length}::uuid`);
  }
  if (has("--flagged")) where.push(`flags <> '{}'::jsonb`);
  const limit = Math.min(200, num("-n", 20) || 20);
  const rows = await q(
    `select turn_id, started_at, surface, channel, lane, served_by, model,
            in_chars, out_bubbles, core_bytes, tail_bytes, recall_bytes,
            latency_ms, legs, flags
       from meera_turn
      ${where.length ? "where " + where.join(" and ") : ""}
      order by started_at desc limit ${limit}`,
    params,
  );
  if (!rows.length) return console.log(dim("no turns"));
  console.log(
    bold(
      "turn_id".padEnd(24) +
        "when".padEnd(21) +
        "ch".padEnd(6) +
        "served".padEnd(14) +
        "in".padEnd(6) +
        "out".padEnd(5) +
        "tail".padEnd(8) +
        "recall".padEnd(8) +
        "lat".padEnd(8) +
        "flags",
    ),
  );
  for (const r of rows) {
    const f = Object.keys(r.flags || {});
    console.log(
      String(r.turn_id).padEnd(24) +
        stamp(r.started_at).padEnd(21) +
        String(r.channel ?? "—").padEnd(6) +
        String(r.served_by ?? r.lane ?? "—").padEnd(14) +
        String(r.in_chars ?? "—").padEnd(6) +
        String(r.out_bubbles ?? "—").padEnd(5) +
        String(r.tail_bytes ?? "—").padEnd(8) +
        String(r.recall_bytes ?? "—").padEnd(8) +
        String(r.latency_ms ?? "—").padEnd(8) +
        (f.length ? red(f.join(",")) : dim("—")),
    );
  }
}

// ── --turn: the reconstruction ────────────────────────────────────────────
async function turn(id) {
  const [t] = await q(`select * from meera_turn where turn_id = $1`, [id]);
  if (!t) return console.log(red(`no such turn: ${id}`));
  const legs = await q(
    `select leg, seq, t_ms, payload, at from meera_turn_leg where turn_id = $1 order by seq, id`,
    [id],
  );

  const H = (s) => console.log("\n" + bold(`── ${s} ` + "─".repeat(Math.max(0, 62 - s.length))));

  console.log(bold(`\nTURN ${t.turn_id}`));
  console.log(
    `  ${stamp(t.started_at)} → ${stamp(t.ended_at)}   ` +
      `${t.surface ?? "?"}/${t.channel ?? "?"}   agent ${String(t.agent_id).slice(0, 8)}…`,
  );
  console.log(`  device ${t.device_id}   person ${t.person_id ?? red("none")}   session ${t.session_id ?? "—"}`);
  if (Object.keys(t.flags || {}).length) {
    console.log("  " + red("FLAGS ") + JSON.stringify(t.flags));
  }

  H("1. INGRESS");
  console.log(
    `  msg ${t.in_msg_id ?? "—"}   kind ${t.in_kind ?? "—"}   ${t.in_chars ?? "?"} chars` +
      `   meera_log #${t.in_log_id ?? red("unlinked")}`,
  );
  printLeg(legs, "ingress");

  H("2. RETRIEVAL");
  const rl = legs.find((l) => l.leg === "retrieval");
  if (!rl) {
    console.log("  " + dim("no retrieval leg — the turn made no lookup, or the lane does not report one"));
  } else {
    const p = rl.payload;
    console.log(`  query ${p.q_chars ?? "?"} chars, ${p.q_words_n ?? "?"} signal words   ${ms(p.ms_total)}`);
    console.log(
      `  keyword    matched ${idsOf(p.keyword?.matched_ids)}  background ${idsOf(p.keyword?.background_ids)}`,
    );
    console.log(
      `  semantic   ok=${p.semantic?.ok}  embed ${ms(p.semantic?.embed_ms)}  facts ${idsOf(p.semantic?.fact_ids)}` +
        (p.semantic?.skipped ? dim(`  (skipped: ${p.semantic.skipped})`) : ""),
    );
    console.log(`  observations ${idsOf(p.observations?.ids)}`);
    console.log(`  relbundle  ${JSON.stringify(p.relbundle)}`);
    console.log(`  selfbundle ${JSON.stringify(p.selfbundle)}`);
    console.log(
      `  → ${p.memories_bytes === 0 ? red("0 bytes of memory reached the prompt") : green(`${p.memories_bytes} bytes`)}` +
        `   blocks: ${(p.blocks || []).join(" | ") || dim("none")}`,
    );
  }

  H("3. INTERIOR (inner.ts — shape only, by charter)");
  printLeg(legs, "interior") || console.log("  " + dim("not recorded on this turn"));

  H("4. ASSEMBLY");
  console.log(
    `  core ${bytes(t.core_bytes)} (hash ${t.core_hash ?? "—"})   tail ${bytes(t.tail_bytes)}` +
      `   manifest ${t.manifest_hash ?? "—"}`,
  );
  const sections = t.sections && Object.keys(t.sections).length ? t.sections : null;
  if (!sections) {
    console.log(
      "  " +
        dim("per-slot bytes absent — brain.ts throttles the full compile.manifest record to core_hash changes"),
    );
  } else {
    // TAIL_MANIFEST order, not lexical: T10 sorting between T1 and T2 makes the
    // one thing this block is for — reading down the assembled tail — harder
    // than reading the code it describes.
    const rank = (k) => {
      const m = /^T(\d+)$/.exec(k);
      return m ? Number(m[1]) : 100;
    };
    const ids = Object.keys(sections).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const wide = Math.max(...ids.map((i) => i.length));
    for (const id of ids) {
      const n = sections[id];
      const bar = "█".repeat(Math.min(40, Math.round(n / 60)));
      console.log(
        `  ${id.padEnd(wide + 2)}${String(n).padStart(6)}b  ${n === 0 ? red("ZERO") : green(bar || "▏")}`,
      );
    }
    const zero = ids.filter((i) => !sections[i]);
    if (zero.length) console.log("  " + red(`zero-byte slots: ${zero.join(", ")}`));
  }
  if ((t.dropped || []).length) console.log(`  dropped: ${JSON.stringify(t.dropped)}`);

  H("5. MODEL");
  console.log(
    `  requested ${t.model ?? "—"}   served_by ${t.served_by ?? dim("unreported")}   lane ${t.lane ?? "—"}`,
  );
  console.log(
    `  tokens in ${t.tokens_in ?? "—"} / out ${t.tokens_out ?? "—"} / cached ${t.tokens_cached ?? "—"}` +
      `   ${ms(t.latency_ms)}   retries ${t.retries}`,
  );
  if ((t.fallbacks || []).length) {
    for (const f of t.fallbacks) console.log("  " + red(`fallback ${f.from} → ${f.to} — ${f.why}`));
  }
  printLeg(legs, "model");
  printLeg(legs, "route");

  H("6. EGRESS");
  console.log(
    `  ${t.out_bubbles ?? "?"} bubbles, ${t.out_chars ?? "?"} chars   msg ${t.out_msg_id ?? "—"}` +
      `   meera_log ${logIds(t.out_log_ids).length ? "#" + logIds(t.out_log_ids).join(", #") : red("unlinked")}`,
  );
  printLeg(legs, "egress");
  for (const l of legs.filter((x) => /^search|forget|error/.test(x.leg))) {
    console.log(`  ${l.leg}: ${JSON.stringify(l.payload)}`);
  }

  H("7. CONSOLIDATION (what the derivers did later)");
  await consolidation(t);

  H("LEGS");
  for (const l of legs) {
    console.log(`  ${String(l.seq).padStart(3)}  +${String(l.t_ms).padStart(6)}ms  ${l.leg}`);
  }

  if (has("--content")) {
    H("CONTENT (resolved from meera_log — opt-in)");
    const ids = [Number(t.in_log_id), ...logIds(t.out_log_ids)].filter(Boolean);
    if (!ids.length) return console.log("  " + dim("no log ids on this turn"));
    const rows = await q(
      `select id, role, kind, channel, content, at from meera_log where id = any($1) order by id`,
      [ids],
    );
    for (const r of rows) console.log(`  #${r.id} ${r.role.padEnd(4)} ${r.kind.padEnd(6)} ${r.content}`);
    if (rows.length < ids.length) {
      console.log("  " + dim(`${ids.length - rows.length} row(s) gone — forgotten, or pruned`));
    }
  }
}

/** The backward join: episodes whose log span contains this turn's rows. */
async function consolidation(t) {
  const ids = [Number(t.in_log_id), ...logIds(t.out_log_ids)].filter(Boolean);
  if (!ids.length) return console.log("  " + dim("no log ids — nothing to join back to"));
  const lo = Math.min(...ids);
  const hi = Math.max(...ids);
  const eps = await q(
    `select id, kind, log_from, log_to, created_at from vy_episode
      where log_from <= $2 and log_to >= $1 order by id limit 10`,
    [lo, hi],
  ).catch(() => []);
  if (!eps.length) return console.log("  " + dim("no episode covers these rows yet"));
  for (const e of eps) {
    const facts = await q(`select id, kind, name from vy_fact where $1 = any(citations) limit 8`, [
      e.id,
    ]).catch(() => []);
    console.log(
      `  episode #${e.id} (${e.kind}, log ${e.log_from}..${e.log_to}) → ` +
        (facts.length ? facts.map((f) => `fact #${f.id} ${f.kind}`).join(", ") : dim("no facts cited")),
    );
  }
}

/**
 * MEASURED QUIRK, and it will bite the next reader too: Neon's SQL-over-HTTP
 * endpoint returns a bigint[] as an array of STRINGS, and returns an EMPTY
 * array as `[""]` — one empty string, not zero elements. So
 * `(row.out_log_ids || []).length` is 1 for a turn that linked nothing, and a
 * reader that trusts it prints "#" and looks linked. Verified against the live
 * database, 2026-08-20. Everything that reads an id column goes through here.
 */
function logIds(v) {
  if (!Array.isArray(v)) return [];
  return v.map(Number).filter((n) => Number.isFinite(n) && n > 0);
}

function idsOf(a) {
  return Array.isArray(a) && a.length ? `[${a.join(",")}] (${a.length})` : dim("none");
}
function printLeg(legs, name) {
  const l = legs.find((x) => x.leg === name);
  if (!l) return false;
  console.log(`  ${dim(name)} ${JSON.stringify(l.payload)}`);
  return true;
}

// ── --flags ───────────────────────────────────────────────────────────────
async function flags() {
  const days = num("--days", 7) || 7;
  const rows = await q(
    `select key as flag, count(*)::int as n
       from meera_turn, lateral jsonb_object_keys(flags) as key
      where started_at > now() - ($1 || ' days')::interval
      group by key order by n desc`,
    [String(days)],
  );
  const [tot] = await q(
    `select count(*)::int n from meera_turn where started_at > now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  console.log(`${tot.n} turns in the last ${days} day(s)`);
  if (!rows.length) return console.log(green("no flags"));
  for (const r of rows) {
    console.log(`  ${red(r.flag.padEnd(16))} ${String(r.n).padStart(6)}  ${((100 * r.n) / (tot.n || 1)).toFixed(1)}%`);
  }
}

// ── --recheck ─────────────────────────────────────────────────────────────
// Flags are derived at write time and merged with `||`, so a flag set from a
// partial spine can outlive the evidence for it when a turn's legs arrive
// across two batches. This recomputes them from the stored row, which is the
// complete one. Named rather than automatic: a job that has to run is a job
// that will not (`never-scheduled`).
async function recheck() {
  const limit = Math.min(5000, num("-n", 500) || 500);
  const rows = await q(
    `select turn_id, recall_bytes, tail_bytes, core_bytes, sections, served_by, lane,
            fallbacks, person_id, retrieval, out_bubbles, flags
       from meera_turn order by started_at desc limit ${limit}`,
    [],
  );
  // KEY-ORDER-INSENSITIVE. Postgres returns jsonb with its own key order, which
  // is not the order deriveFlags() built them in, so a naive stringify compare
  // reports every row as changed and then "corrects" it to the identical value
  // — a rewrite loop that looks like a finding.
  const canon = (o) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(o || {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]),
      ),
    );
  let changed = 0;
  for (const r of rows) {
    const want = deriveFlags(r);
    if (canon(want) === canon(r.flags)) continue;
    await q(`update meera_turn set flags = $2::jsonb where turn_id = $1`, [
      r.turn_id,
      JSON.stringify(want),
    ]);
    changed++;
    console.log(`  ${r.turn_id}  ${JSON.stringify(r.flags)} → ${JSON.stringify(want)}`);
  }
  console.log(`${changed} of ${rows.length} turn(s) corrected`);
}

// ── --residue ─────────────────────────────────────────────────────────────
async function residue(prefix) {
  const [a] = await q(`select count(*)::int n from meera_turn where turn_id like $1 or device_id like $1`, [
    prefix + "%",
  ]);
  const [b] = await q(`select count(*)::int n from meera_turn_leg where turn_id like $1 or device_id like $1`, [
    prefix + "%",
  ]);
  console.log(`meera_turn: ${a.n}   meera_turn_leg: ${b.n}`);
  if (has("--purge")) {
    await q(`delete from meera_turn_leg where turn_id like $1 or device_id like $1`, [prefix + "%"]);
    await q(`delete from meera_turn where turn_id like $1 or device_id like $1`, [prefix + "%"]);
    const [c] = await q(`select count(*)::int n from meera_turn where turn_id like $1 or device_id like $1`, [
      prefix + "%",
    ]);
    const [d] = await q(
      `select count(*)::int n from meera_turn_leg where turn_id like $1 or device_id like $1`,
      [prefix + "%"],
    );
    console.log(`after purge — meera_turn: ${c.n}   meera_turn_leg: ${d.n}`);
    if (c.n || d.n) process.exit(1);
  }
  return a.n + b.n;
}

// ── main ──────────────────────────────────────────────────────────────────
if (has("--turn")) await turn(val("--turn"));
else if (has("--last")) {
  const where = val("--device") ? `where device_id = $1` : "";
  const [r] = await q(
    `select turn_id from meera_turn ${where} order by started_at desc limit 1`,
    val("--device") ? [val("--device")] : [],
  );
  if (!r) console.log("no turns");
  else await turn(r.turn_id);
} else if (has("--flags")) await flags();
else if (has("--recheck")) await recheck();
else if (has("--residue")) await residue(val("--residue") || "wstrace-test-");
else await list();
