// Two STATEMENT-SHAPE defect classes that Postgres rejects at PARSE time, so
// the statement can never execute — not once, not for anybody. WS-M's EXPLAIN
// sweep found three of them sitting in shipped erasure and voice-holdout paths.
//
//   0A000  FOR UPDATE cannot be applied to the nullable side of an outer join
//   0A000  WITH query "x" does not have a RETURNING clause
//
// These are strictly worse than the type errors sqlcast already gates. A type
// error needs the wrong VALUE to show up; these need nothing at all — the very
// first call fails, and the offline suites cannot see it because they mock the
// database and never ask Postgres to parse anything.
//
// Both are decidable from the SQL text alone, which is what this file does.
// Same conservatism as scan.mjs: flag only what can be resolved, because a gate
// that cries wolf gets deleted.

function matchParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") d++;
    else if (s[i] === ")") {
      d--;
      if (d === 0) return i;
    }
  }
  return -1;
}

// Blank to equal-length spaces so every offset still indexes the original.
const blank = (n) => " ".repeat(n);

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, (m) => blank(m.length));
}

/**
 * Every parenthesised `<name> as ( ... )` body in the statement, plus the
 * statement's own outer text. Each block's text has its NESTED blocks blanked,
 * so a FOR UPDATE in one CTE never sees a LEFT JOIN in another.
 */
export function queryBlocks(sql) {
  const spans = [];
  const re = /(?:^|[,(\s])([a-z_][a-z0-9_]*)\s+as\s*(?:not\s+)?(?:materialized\s+)?\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(sql, open);
    if (close < 0) continue;
    spans.push({ name: m[1].toLowerCase(), open, close });
  }
  const own = (from, to) => {
    let t = sql.slice(from, to);
    for (const s of spans) {
      if (s.open <= from || s.close >= to) continue; // not strictly inside
      // blank only blocks nested one level down; deeper ones are inside those
      if (spans.some((o) => o !== s && o.open > from && o.close < to && o.open < s.open && o.close > s.close)) continue;
      t = t.slice(0, s.open - from) + blank(s.close + 1 - s.open) + t.slice(s.close + 1 - from);
    }
    return t;
  };
  const blocks = spans.map((s) => ({
    name: s.name,
    start: s.open + 1,
    end: s.close,
    text: own(s.open + 1, s.close),
  }));
  blocks.push({ name: null, start: 0, end: sql.length, text: own(0, sql.length) });
  return blocks;
}

const LOCK = /\bfor\s+(update|no\s+key\s+update|share|key\s+share)\b(\s+of\s+([a-z_][a-z0-9_,\s]*?))?(?=\s*(?:nowait|skip\s+locked|limit|\)|$|\n))/gi;
const OUTER_JOIN = /\b(left|right|full)\s+(?:outer\s+)?join\s+(?:only\s+)?([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi;

const JOIN_KEYWORD = new Set(["on", "using", "lateral", "as"]);

/**
 * Rule C — a row lock that reaches the nullable side of an outer join.
 *
 * A bare `for update` locks EVERY relation in the FROM clause, the outer-joined
 * one included, and Postgres refuses that outright. `for update of a,b` locks
 * only what it names, so the fix is to name the non-nullable relations — which
 * is also the honest statement of what the lock is actually for.
 */
export function lockJoinSites(sql) {
  const out = [];
  for (const block of queryBlocks(stripComments(sql))) {
    const joins = [...block.text.matchAll(OUTER_JOIN)];
    if (!joins.length) continue;
    // Aliases Postgres treats as nullable. LEFT JOIN nulls the joined relation;
    // FULL JOIN nulls both sides, so any lock in such a block is unsafe.
    const nullable = new Map();
    let full = false;
    for (const j of joins) {
      const kind = j[1].toLowerCase();
      if (kind === "full") full = true;
      if (kind === "right") continue; // the nullable side is everything BEFORE — not resolved here
      const table = j[2].toLowerCase();
      const alias = j[3] && !JOIN_KEYWORD.has(j[3].toLowerCase()) ? j[3].toLowerCase() : null;
      nullable.set(alias || table, table);
      if (alias) nullable.set(table, table);
    }
    for (const l of block.text.matchAll(LOCK)) {
      const clause = l[0].trim().replace(/\s+/g, " ");
      if (!l[3]) {
        out.push({
          at: block.start + l.index,
          block: block.name,
          detail:
            `"${clause}" in ${block.name ? `CTE "${block.name}"` : "the outer query"} ` +
            `applies to every relation in its FROM, including the outer-joined ` +
            `${joins.map((j) => j[2]).join(", ")} — 0A000, the statement can never execute. ` +
            `Name the non-nullable relations: for update of <alias>,…`,
        });
        continue;
      }
      const named = l[3].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const hit = named.filter((n) => nullable.has(n));
      if (hit.length || (full && named.length)) {
        out.push({
          at: block.start + l.index,
          block: block.name,
          detail:
            `"${clause}" locks ${hit.length ? hit.join(", ") : named.join(", ")}, which ` +
            `${full && !hit.length ? "a FULL JOIN makes" : "an outer join makes"} nullable — ` +
            `0A000, the statement can never execute.`,
        });
      }
    }
  }
  return out;
}

const DML_START = /^\s*(insert|update|delete|merge)\b/i;

function blankNested(text) {
  let out = "";
  let d = 0;
  for (const ch of text) {
    if (ch === "(") d++;
    if (d === 0) out += ch;
    else out += " ";
    if (ch === ")") {
      d--;
      if (d === 0) out = out.slice(0, -1) + " ";
    }
  }
  return out;
}

/**
 * Rule D — a data-modifying CTE with no RETURNING that something references.
 *
 * Postgres executes every data-modifying CTE exactly once whether or not it is
 * referenced, so `(select count(*) from x) >= 0` never had to exist to force
 * the write. But once written it IS a reference, and a data-modifying CTE with
 * no RETURNING has no output relation to reference — the whole statement is
 * rejected at parse time. The fix is a RETURNING clause, not deleting the
 * reference: the reference documents an ordering dependency a reader would
 * otherwise have to know Postgres's execution rules to see.
 */
export function unreturnedCteRefs(sql) {
  const clean = stripComments(sql);
  const out = [];
  const blocks = queryBlocks(clean).filter((b) => b.name);
  for (const b of blocks) {
    if (!DML_START.test(b.text)) continue;
    if (/\breturning\b/i.test(blankNested(b.text))) continue;
    // Referenced anywhere OUTSIDE its own body, the way a CTE is referenced.
    const outside = clean.slice(0, b.start) + blank(b.end - b.start) + clean.slice(b.end);
    const ref = new RegExp(`\\b(from|join|using)\\s+${b.name}\\b`, "i");
    const m = outside.match(ref);
    if (!m) continue;
    out.push({
      at: b.start,
      cte: b.name,
      detail:
        `data-modifying CTE "${b.name}" has no RETURNING clause but is referenced ` +
        `by "${m[0]}" — 0A000, WITH query "${b.name}" does not have a RETURNING clause. ` +
        `The statement can never execute; give the CTE a RETURNING.`,
    });
  }
  return out;
}

export function statementShapeDefects(sql) {
  return [...lockJoinSites(sql), ...unreturnedCteRefs(sql)];
}
