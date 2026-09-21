// WS-R175 (the calibration erasure hazard). The offline FK-graph model
// context/rejected.md#ws-r170-calibration-generation-fk-graph-has-an-
// unverified-erasure-ordering-hazard asked for: parse db/schema.sql's own
// foreign keys (never a hand-typed list, the schema-mirror gate's own
// precedent - scripts/check-schema-mirror.mjs's header), compute which
// tables a full replica erasure reaches, and PROVE that every table holding
// a Postgres NO ACTION (or RESTRICT - Postgres enforces both identically at
// delete time) foreign key into another reached table is deleted, by name,
// STRICTLY BEFORE the table it references. A table reached only through
// vy_replica's own cascade and never named is modeled as being deleted at
// the very end - a real risk, since Postgres does not promise this file any
// particular firing order between two independent cascade paths hanging off
// the SAME deleted vy_replica row.
//
// Every function here is PURE (text/data in, data out) so evals/erasure-
// order/run.mjs's negative controls can drive it with a deliberately wrong
// input without ever touching a real file.
import { readFileSync } from "node:fs";

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, "");
}

/** Split a "(...)" body on top-level commas - db/schema.sql's own convention
 *  a foreign key or a check constraint can itself contain parens, so a naive
 *  split on every comma would cut a clause in half. Identical algorithm to
 *  evals/sqlcast/schema.mjs's own `splitTop`, duplicated rather than
 *  imported: that module returns column TYPES, this one needs the full
 *  clause text (a references/on-delete tail) that module throws away. */
function splitTop(body) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const ON_DELETE_RE = /\son\s+delete\s+(cascade|restrict|no\s+action|set\s+null|set\s+default)/i;

/** Postgres's own real behaviour, not the SQL-standard fiction: RESTRICT and
 *  the unspecified default are both NO ACTION (checked at end of statement,
 *  never earlier - Postgres does not implement the standard's "RESTRICT is
 *  immediate" distinction at all). SET NULL / SET DEFAULT never block a
 *  parent delete (the child row survives with its FK column rewritten), so
 *  they are modeled as non-blocking, the same as CASCADE, for the one
 *  question this model asks: "does deleting the parent row succeed?" */
function normalizeAction(raw) {
  if (!raw) return "no_action";
  const a = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (a === "cascade" || a === "set null" || a === "set default") return "cascade";
  return "no_action";
}

/**
 * Every foreign key `db/schema.sql`'s own text declares - column-level
 * (`col uuid references parent(pk)`), inline table-level (`constraint name
 * foreign key (...) references parent(...)`), and `alter table ... add
 * constraint ... foreign key ...` (bare or wrapped in a `do $$ ... $$`
 * block - both use the identical literal ALTER TABLE syntax this scans for,
 * so wrapping changes nothing about what matches).
 *
 * Returns `{ child, childCols, parent, parentCols, action, name }[]`.
 * `action` is `"cascade"` (does not block the parent's deletion) or
 * `"no_action"` (blocks it while a referencing row exists - RESTRICT and an
 * unspecified ON DELETE fold into this one bucket, `normalizeAction`'s own
 * header explains why).
 */
export function parseForeignKeys(schemaText) {
  const src = stripComments(schemaText);
  const edges = [];

  // 1. Foreign keys declared INSIDE a `create table (...)` body - both the
  //    column-level shape and the inline `constraint ... foreign key ...`
  //    shape share one clause-level scan once the body is isolated.
  const ct = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_.]*)\s*\(/gi;
  let m;
  while ((m = ct.exec(src))) {
    const table = m[1].split(".").pop();
    let i = ct.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    const body = src.slice(ct.lastIndex, i - 1);
    for (const part of splitTop(body)) {
      const line = part.trim();
      if (!/references/i.test(line)) continue;
      const ref = line.match(/references\s+"?([a-z_][a-z0-9_]*)"?\s*\(([^)]*)\)/i);
      if (!ref) continue;
      const actionMatch = line.match(ON_DELETE_RE);
      const fk = line.match(/foreign\s+key\s*\(([^)]*)\)/i);
      let childCols;
      if (fk) {
        childCols = fk[1].split(",").map((s) => s.trim());
      } else {
        const col = line.match(/^"?([a-z_][a-z0-9_]*)"?\s+/i);
        childCols = col ? [col[1]] : [];
      }
      const nameMatch = line.match(/^constraint\s+"?([a-z_][a-z0-9_]*)"?/i);
      edges.push({
        child: table,
        childCols,
        parent: ref[1],
        parentCols: ref[2].split(",").map((s) => s.trim()),
        action: normalizeAction(actionMatch && actionMatch[1]),
        name: nameMatch ? nameMatch[1] : null,
      });
    }
  }

  // 2. `alter table <child> add constraint <name> foreign key (...)
  //    references <parent>(...) [on delete ...]` - the shape every
  //    calibration_version FK this workstream is about actually uses,
  //    inside a `do $$ ... $$` block (WS-R170's own quote: "all three added
  //    by migration 025 itself"). `[\s\S]*?` rather than `.` between tokens
  //    because these statements are always broken across lines and a plain
  //    `.` does not match a newline.
  const alterRe =
    /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?"?([a-z_][a-z0-9_]*)"?\s+add\s+constraint\s+"?([a-z_][a-z0-9_]*)"?\s+foreign\s+key\s*\(([^)]*)\)\s*references\s+"?([a-z_][a-z0-9_]*)"?\s*\(([^)]*)\)(\s+on\s+delete\s+(cascade|restrict|no\s+action|set\s+null|set\s+default))?/gi;
  while ((m = alterRe.exec(src))) {
    edges.push({
      child: m[1],
      childCols: m[3].split(",").map((s) => s.trim()),
      parent: m[4],
      parentCols: m[5].split(",").map((s) => s.trim()),
      action: normalizeAction(m[7]),
      name: m[2],
    });
  }

  return edges;
}

/** Every table reachable from `root` by following CASCADE edges only - the
 *  identical walk `scripts/relcheck.mjs`'s own live "owner-lane erasure
 *  reach" check runs against `pg_constraint`, run here offline against the
 *  parsed schema text instead. This is "what a full replica erasure removes
 *  even if `api/_replica-full-erasure.js` never names it by name." */
export function cascadeReach(edges, root) {
  const children = new Map();
  for (const e of edges) {
    if (e.action !== "cascade") continue;
    if (!children.has(e.parent)) children.set(e.parent, []);
    children.get(e.parent).push(e.child);
  }
  const reached = new Set([root]);
  const stack = [root];
  while (stack.length) {
    const t = stack.pop();
    for (const c of children.get(t) || []) {
      if (!reached.has(c)) {
        reached.add(c);
        stack.push(c);
      }
    }
  }
  return reached;
}

/** Every `delete from <table>` an erasure source names, in the TEXTUAL
 *  order they appear - this file's own established convention (restated at
 *  nearly every block of `api/_replica-full-erasure.js`) is that order IS
 *  the enforced order, either because nothing else depends on it or because
 *  a later CTE's WHERE clause forces a real data dependency on an earlier
 *  one's output (`(select count(*) from earlier_cte)>=0`, the file's own
 *  idiom). A table can be named more than once (a `using` join in a later
 *  CTE, say) - only the FIRST occurrence's position is kept, since that is
 *  the earliest moment its rows are known to be gone. */
export function explicitDeleteOrder(sourceText) {
  const stripped = sourceText.replace(/\/\/[^\n]*/g, "");
  const re = /\bdelete\s+from\s+(vy_[a-z_]+|meera_[a-z_]+)\b/gi;
  const order = new Map();
  let m;
  let i = 0;
  while ((m = re.exec(stripped))) {
    const t = m[1].toLowerCase();
    if (!order.has(t)) order.set(t, i++);
  }
  return order;
}

/**
 * The effective position of every table in `reach`: its own explicit
 * position if `explicitOrder` names it, else the MINIMUM effective
 * position of any table it cascades FROM (a table cascade-deleted as a side
 * effect of an explicitly-deleted ancestor is gone at that ancestor's own
 * moment, not merely "eventually") - else `Infinity` (removed only by the
 * final, un-forced `delete from vy_replica` cascade, with no proof of
 * ordering relative to any sibling cascade).
 */
export function effectivePositions(edges, reach, explicitOrder) {
  const cascadeParents = new Map();
  for (const e of edges) {
    if (e.action !== "cascade") continue;
    if (!cascadeParents.has(e.child)) cascadeParents.set(e.child, []);
    cascadeParents.get(e.child).push(e.parent);
  }
  const memo = new Map();
  const resolving = new Set();
  function positionOf(table) {
    if (memo.has(table)) return memo.get(table);
    if (explicitOrder.has(table)) {
      const p = explicitOrder.get(table);
      memo.set(table, p);
      return p;
    }
    if (resolving.has(table)) return Infinity; // defensive: no real cycle expected
    resolving.add(table);
    let best = Infinity;
    for (const parent of cascadeParents.get(table) || []) {
      if (!reach.has(parent)) continue;
      const p = positionOf(parent);
      if (p < best) best = p;
    }
    resolving.delete(table);
    memo.set(table, best);
    return best;
  }
  const out = new Map();
  for (const t of reach) out.set(t, positionOf(t));
  return out;
}

/**
 * Every `(child, parent)` pair where a full erasure's own reach set
 * contains BOTH tables, a NO_ACTION/RESTRICT edge points child -> parent,
 * and `positions` does NOT prove child is deleted strictly before parent.
 * `edges` may be pre-filtered by the caller (evals/erasure-order/run.mjs
 * scopes this to edges whose parent is vy_replica_calibration or
 * vy_replica_generation - this workstream's own named scope); this
 * function itself makes no assumption about which edges it is handed.
 */
export function findOrderingViolations(edges, reach, positions) {
  const problems = [];
  for (const e of edges) {
    if (e.action !== "no_action") continue;
    if (e.child === e.parent) continue; // a self-reference orders nothing
    if (!reach.has(e.child) || !reach.has(e.parent)) continue;
    const childPos = positions.get(e.child);
    const parentPos = positions.get(e.parent);
    if (!(childPos < parentPos)) {
      problems.push({ child: e.child, parent: e.parent, name: e.name, childPos, parentPos });
    }
  }
  return problems;
}

export function loadSchemaText(repoRoot) {
  return readFileSync(new URL("db/schema.sql", `file://${repoRoot}/`), "utf8");
}
