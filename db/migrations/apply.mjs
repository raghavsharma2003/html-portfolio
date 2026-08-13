// Apply migrations over Neon SQL-HTTP (api/_db.js q()).
//
//   node db/migrations/apply.mjs            → apply every *.sql, in order
//   node db/migrations/apply.mjs 002 004    → apply only files starting 002/004
//
// Neon's SQL-over-HTTP endpoint accepts exactly ONE statement per request
// (a multi-statement body 400s — verified against the live database), and
// there are no transactions spanning q() calls. So this runner splits each
// file into statements and runs them one by one, and every statement in
// every migration file is REQUIRED to be independently idempotent: an apply
// interrupted between statements is recovered by running the same file
// again, never by manual repair.
import { readFileSync, readdirSync } from "node:fs";
import { q } from "../../api/_db.js";

const DIR = new URL(".", import.meta.url).pathname;

/**
 * Split SQL into statements on top-level semicolons. Quote-aware (single
 * quotes, dollar quotes) and comment-aware (`--` line comments), because a
 * semicolon inside either must not split. No migration here uses functions
 * or DO blocks — plain DDL only — so this stays small and checkable.
 */
export function splitSql(sql) {
  const out = [];
  let cur = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'") {
      // single-quoted string; '' is the escape
      cur += ch;
      i++;
      while (i < sql.length) {
        cur += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") {
          cur += sql[++i];
        } else if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      cur += sql.slice(i, nl < 0 ? sql.length : nl + 1);
      i = nl < 0 ? sql.length : nl + 1;
      continue;
    }
    if (ch === "$") {
      const m = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end < 0 ? sql.length : end + tag.length;
        cur += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ";") {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s.replace(/^(--[^\n]*\n?)+/g, "").trim());
}

const only = process.argv.slice(2);
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .filter((f) => !only.length || only.some((a) => f.startsWith(a)));

if (import.meta.url === `file://${process.argv[1]}`) {
  let statements = 0;
  const t0 = Date.now();
  for (const f of files) {
    console.log(`── ${f}`);
    const stmts = splitSql(readFileSync(DIR + f, "utf8"));
    for (const s of stmts) {
      const head = s.replace(/(--[^\n]*)/g, "").replace(/\s+/g, " ").trim().slice(0, 88);
      const t = Date.now();
      try {
        await q(s, [], 60_000);
        statements++;
        console.log(`   ok  ${Date.now() - t}ms  ${head}`);
      } catch (e) {
        // stop at the first failure: later statements may depend on this one,
        // and idempotency means the fix is "correct the file, run it again"
        console.error(`  FAIL ${head}\n  ${e.message}`);
        process.exit(1);
      }
    }
  }
  console.log(`\napplied ${statements} statements from ${files.length} file(s) in ${Date.now() - t0}ms`);
}
