// Static scan of every SQL template literal under api/ for the live-DB bug
// class this suite exists for.
//
// Neon's SQL-over-HTTP endpoint sends bound parameters as TEXT with no type
// OIDs. Postgres will happily resolve an untyped parameter from context in
// SOME positions and refuse in others, and the two refusals are:
//
//   42883  operator does not exist: uuid = text
//   42804  column "x" is of type uuid but expression is of type text
//
// Both are runtime-only. The offline eval suites mock the database, so they
// type-check nothing, and the studio's first live "create replica" click 500'd
// on exactly this. This scanner is the thing that reads the SQL the way
// Postgres will.
//
// It is deliberately CONSERVATIVE: it only flags a site when it can name the
// table, name the column, find that column's type in the checked-in DDL, and
// see a bare `$N` with no cast. Anything it cannot resolve is reported as
// UNRESOLVED (informational) rather than failed, because a gate that cries
// wolf gets deleted.

// ---------------------------------------------------------------- extraction

// Pull every template literal out of a JS source, with its 1-based line number.
// `${...}` interpolations are replaced with a token that cannot match an
// identifier or a parameter, so an interpolated clause is simply opaque rather
// than silently misparsed.
export function templateLiterals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  let line = 1;
  // crude but sufficient: skip line/block comments and quoted strings so a
  // backtick inside them does not open a bogus template.
  while (i < n) {
    const ch = src[i];
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") i++;
        else if (src[i] === "\n") line++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === "`") {
      const startLine = line;
      i++;
      const bodyStart = i;
      let body = "";
      let interpolated = false;
      while (i < n && src[i] !== "`") {
        if (src[i] === "\\") {
          body += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          const interpStart = i;
          // skip a balanced ${ ... }, counting nested braces and backticks
          let depth = 1;
          i += 2;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            else if (src[i] === "`") {
              // nested template: skip to its close
              i++;
              while (i < n && src[i] !== "`") {
                if (src[i] === "\\") i++;
                if (src[i] === "\n") line++;
                i++;
              }
            } else if (src[i] === "\n") line++;
            i++;
          }
          // Blank the interpolation to EQUAL-LENGTH whitespace. Two things fall
          // out of that: the scanner simply cannot resolve whatever the
          // interpolation carried (conservative, which is what we want), and
          // every offset inside `sql` indexes the source file directly, which
          // is what lets a codemod splice a cast in without re-parsing.
          body += " ".repeat(i - interpStart);
          interpolated = true;
          continue;
        }
        if (src[i] === "\n") line++;
        body += src[i];
        i++;
      }
      i++;
      out.push({ sql: body, line: startLine, start: bodyStart, interpolated });
      continue;
    }
    i++;
  }
  return out;
}

const SQL_START =
  /^\s*(?:--[^\n]*\n\s*)*(?:with|select|insert|update|delete)\b/i;
export function looksLikeSql(s) {
  return SQL_START.test(s) && /\$\d/.test(s);
}

// ------------------------------------------------------------------ analysis

// Blank comments to spaces of EQUAL LENGTH so every offset computed on the
// cleaned text still indexes the original — the codemod relies on that.
function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, (m) => " ".repeat(m.length));
}

// alias/table names in scope, plus the set of CTE names (whose column types we
// cannot know and therefore never flag).
export function scopeOf(sql) {
  const aliases = new Map(); // alias -> table
  const tables = new Set();
  const ctes = new Set();

  for (const m of sql.matchAll(
    /(?:^|[,(\s])([a-z_][a-z0-9_]*)\s+as\s*\(/gi,
  )) {
    ctes.add(m[1].toLowerCase());
  }

  const rel =
    /\b(from|join|into|update)\s+(?:only\s+)?([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi;
  const KEYWORD = new Set([
    "select",
    "set",
    "where",
    "on",
    "using",
    "values",
    "returning",
    "group",
    "order",
    "limit",
    "left",
    "right",
    "inner",
    "outer",
    "full",
    "cross",
    "join",
    "and",
    "or",
    "as",
    "do",
    "conflict",
    "from",
    "lateral",
  ]);
  for (const m of sql.matchAll(rel)) {
    const table = m[2].toLowerCase();
    if (KEYWORD.has(table)) continue;
    if (!ctes.has(table)) tables.add(table);
    aliases.set(table, table);
    const al = m[3]?.toLowerCase();
    if (al && !KEYWORD.has(al)) aliases.set(al, table);
  }
  return { aliases, tables, ctes };
}

// Resolve a (maybe-qualified) column reference to a type, or null.
function resolveType(schema, scope, qualifier, column) {
  const col = column.toLowerCase();
  if (qualifier) {
    const q = qualifier.toLowerCase();
    if (scope.ctes.has(q)) return null; // CTE output column: unknowable
    const table = scope.aliases.get(q);
    if (!table) return null;
    return schema[table]?.[col] ?? null;
  }
  const found = new Set();
  for (const t of scope.tables) {
    const ty = schema[t]?.[col];
    if (ty) found.add(ty);
  }
  if (found.size === 1) return [...found][0];
  return null; // absent, or ambiguous across joined tables
}

// A bound param is "cast" when the `$N` is immediately followed by `::type`.
const CAST_AFTER = /^\s*::\s*[a-z_][a-z0-9_ ]*(?:\s*\[\s*\])?/i;

/**
 * Comparison sites: `<col> <op> $N`, `$N <op> <col>`, and `<col> = any($N)`.
 * A left-hand side that is itself cast (`col::text = $1`) is already safe.
 */
function comparisonSites(sql) {
  const sites = [];
  // col <op> $N   (op includes the array forms)
  const re =
    /(?:([a-z_][a-z0-9_]*)\s*\.\s*)?([a-z_][a-z0-9_]*)\s*(::\s*[a-z_][a-z0-9_]*\s*)?(=|<>|!=|>=|<=|>|<)\s*(any\s*\(\s*)?\$(\d+)/gi;
  for (const m of sql.matchAll(re)) {
    if (m[3]) continue; // lhs already cast
    const after = sql.slice(m.index + m[0].length);
    sites.push({
      qualifier: m[1],
      column: m[2],
      op: m[4],
      array: !!m[5],
      param: Number(m[6]),
      cast: CAST_AFTER.test(after),
      index: m.index,
      // exact offset of the `$` — the `$N` is always the tail of the match
      at: m.index + m[0].length - (1 + m[6].length),
      kind: "compare",
    });
  }
  // $N <op> col
  const re2 =
    /\$(\d+)\s*(?!::)(=|<>|!=|>=|<=|>|<)\s*(?:([a-z_][a-z0-9_]*)\s*\.\s*)?([a-z_][a-z0-9_]*)\b/gi;
  for (const m of sql.matchAll(re2)) {
    sites.push({
      qualifier: m[3],
      column: m[4],
      op: m[2],
      array: false,
      param: Number(m[1]),
      cast: false,
      index: m.index,
      at: m.index,
      kind: "compare",
    });
  }
  return sites;
}

// Split on top-level commas, keeping each piece's start offset within `s`.
function splitTopSpans(s) {
  const out = [];
  let d = 0,
    q = null,
    start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'") {
      q = ch;
      continue;
    }
    if (ch === "(") d++;
    if (ch === ")") d--;
    if (ch === "," && d === 0) {
      out.push({ text: s.slice(start, i), start });
      start = i + 1;
    }
  }
  const tail = s.slice(start);
  if (tail.trim()) out.push({ text: tail, start });
  return out;
}

function splitTop(s) {
  return splitTopSpans(s).map((p) => p.text);
}

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

const BARE_PARAM = /^\s*\$(\d+)\s*$/;

/**
 * INSERT sites. `insert into T (c1, c2, ...)` followed by either
 * `values (e1, e2, ...)` (possibly several tuples) or `select e1, e2, ... from`.
 * Only a positional expression that is a BARE `$N` is a cast site.
 */
function insertSites(sql) {
  const sites = [];
  const re = /\binsert\s+into\s+([a-z_][a-z0-9_]*)\s*\(/gi;
  for (const m of sql.matchAll(re)) {
    const table = m[1].toLowerCase();
    const open = m.index + m[0].length - 1;
    const close = matchParen(sql, open);
    if (close < 0) continue;
    const cols = splitTop(sql.slice(open + 1, close)).map((c) =>
      c.trim().replace(/^"|"$/g, "").toLowerCase(),
    );
    if (cols.some((c) => !/^[a-z_][a-z0-9_]*$/.test(c))) continue;

    const rest = sql.slice(close + 1);
    const vm = rest.match(/^\s*values\s*\(/i);
    if (vm) {
      // one or more tuples
      let cursor = close + 1 + vm[0].length - 1;
      while (cursor > 0 && cursor < sql.length) {
        const tclose = matchParen(sql, cursor);
        if (tclose < 0) break;
        const exprs = splitTopSpans(sql.slice(cursor + 1, tclose));
        // Positional mapping is only sound when the arity matches. A blanked
        // `${...}` interpolation anywhere in the tuple breaks the count, and a
        // wrong column/expression pairing would put a cast on the wrong site.
        if (exprs.length !== cols.length) break;
        exprs.forEach((e, i) => {
          const pm = e.text.match(BARE_PARAM);
          if (pm && cols[i]) {
            sites.push({
              table,
              column: cols[i],
              param: Number(pm[1]),
              cast: false,
              index: cursor,
              at: cursor + 1 + e.start + e.text.indexOf("$"),
              kind: "insert",
            });
          }
        });
        const nxt = sql.slice(tclose + 1).match(/^\s*,\s*\(/);
        if (!nxt) break;
        cursor = tclose + 1 + nxt[0].length - 1;
      }
      continue;
    }
    const sm = rest.match(/^\s*select\s/i);
    if (sm) {
      const selStart = close + 1 + sm.index + sm[0].length;
      // select list ends at a top-level FROM / WHERE / ON CONFLICT / end
      const tail = sql.slice(selStart);
      let d = 0,
        end = tail.length,
        qt = null;
      for (let i = 0; i < tail.length; i++) {
        const c = tail[i];
        if (qt) {
          if (c === qt) qt = null;
          continue;
        }
        if (c === "'") {
          qt = c;
          continue;
        }
        if (c === "(") d++;
        else if (c === ")") {
          if (d === 0) {
            end = i;
            break;
          }
          d--;
        } else if (d === 0) {
          const w = tail.slice(i).match(/^\s(from|where|on\s+conflict|returning)\b/i);
          if (w) {
            end = i;
            break;
          }
        }
      }
      const exprs = splitTopSpans(tail.slice(0, end));
      if (exprs.length !== cols.length) continue; // see the VALUES note above
      exprs.forEach((e, i) => {
        const pm = e.text.match(BARE_PARAM);
        if (pm && cols[i]) {
          sites.push({
            table,
            column: cols[i],
            param: Number(pm[1]),
            cast: false,
            index: selStart,
            at: selStart + e.start + e.text.indexOf("$"),
            kind: "insert",
          });
        }
      });
    }
  }
  return sites;
}

/** UPDATE ... SET col = $N sites (the lhs is unambiguously the updated table). */
function updateSetSites(sql) {
  const sites = [];
  const re = /\bupdate\s+(?:only\s+)?([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?\s+set\s/gi;
  for (const m of sql.matchAll(re)) {
    const table = m[1].toLowerCase();
    const start = m.index + m[0].length;
    const tail = sql.slice(start);
    let d = 0,
      end = tail.length,
      qt = null;
    for (let i = 0; i < tail.length; i++) {
      const c = tail[i];
      if (qt) {
        if (c === qt) qt = null;
        continue;
      }
      if (c === "'") {
        qt = c;
        continue;
      }
      if (c === "(") d++;
      else if (c === ")") {
        if (d === 0) {
          end = i;
          break;
        }
        d--;
      } else if (d === 0) {
        const w = tail.slice(i).match(/^\s(from|where|returning)\b/i);
        if (w) {
          end = i;
          break;
        }
      }
    }
    for (const assign of splitTopSpans(tail.slice(0, end))) {
      const am = assign.text.match(
        /^\s*(?:[a-z_][a-z0-9_]*\s*\.\s*)?([a-z_][a-z0-9_]*)\s*=\s*(.*)$/is,
      );
      if (!am) continue;
      const pm = am[2].match(BARE_PARAM);
      if (pm) {
        sites.push({
          table,
          column: am[1].toLowerCase(),
          param: Number(pm[1]),
          cast: false,
          index: start,
          at: start + assign.start + assign.text.indexOf("$"),
          kind: "update-set",
        });
      }
    }
  }
  return sites;
}

/**
 * Analyse one SQL string. Returns { violations, unresolved }.
 * `needsCast` decides which declared types a text-bound parameter cannot reach.
 */
export function analyzeSql(sql, schema, needsCast) {
  const clean = stripSqlComments(sql);
  const scope = scopeOf(clean);
  const violations = [];
  const unresolved = [];

  for (const s of comparisonSites(clean)) {
    if (s.cast) continue;
    const type = resolveType(schema, scope, s.qualifier, s.column);
    if (!type) {
      unresolved.push({ ...s, why: "column type unknown" });
      continue;
    }
    if (!needsCast(type)) continue;
    violations.push({
      ...s,
      type,
      want: s.array ? `$${s.param}::${type}[]` : `$${s.param}::${type}`,
      detail: `${s.qualifier ? s.qualifier + "." : ""}${s.column} ${s.op}${
        s.array ? " any(" : ""
      } $${s.param}  — column is ${type}`,
    });
  }

  for (const s of [...insertSites(clean), ...updateSetSites(clean)]) {
    const type = schema[s.table]?.[s.column];
    if (!type) {
      unresolved.push({ ...s, why: `no type for ${s.table}.${s.column}` });
      continue;
    }
    if (!needsCast(type)) continue;
    violations.push({
      ...s,
      type,
      want: `$${s.param}::${type}`,
      detail: `${s.kind === "insert" ? "insert into" : "update"} ${s.table} (${
        s.column
      }) <- $${s.param}  — column is ${type}`,
    });
  }

  return { violations, unresolved, conflicts: conflictSites(clean, schema, scope) };
}

// ------------------------------------------------- the guaranteed-failure rule
//
// Measured against the live database (see the suite header): Neon's HTTP
// endpoint sends parameters UNTYPED, so a bare `$1` against a uuid column is
// deduced as uuid and works fine on its own. What actually breaks is a
// parameter used at TWO sites that demand different types — Postgres deduces
// ONE type per parameter per statement:
//
//   `hashtextextended($1::text, 0)` ... `where auth_user_id = $1`
//        -> deduced text, then `uuid = text`            42883
//   `where display_name = $1 and owner_user_id = $1`
//        -> text vs uuid                                42883
//   `select $1, $1, 'x', 'y', $1, ...` into (uuid, uuid, text, text, text)
//        -> inconsistent types deduced for parameter $1 42P08
//
// That is the shape that 500'd the studio's first live create. Sites that all
// carry an explicit cast never conflict, because the parameter is simply text
// and each site converts — which is why casting every site is the house fix.
export function paramSites(sql, schema, scope) {
  const byParam = new Map();
  const add = (p, kind, type, detail) => {
    if (!byParam.has(p)) byParam.set(p, { bare: new Map(), cast: new Map() });
    if (type) byParam.get(p)[kind].set(type, detail);
  };

  for (const s of comparisonSites(sql)) {
    const type = resolveType(schema, scope, s.qualifier, s.column);
    if (!type) continue;
    const label = `${s.qualifier ? s.qualifier + "." : ""}${s.column} (${type})`;
    if (s.cast) continue; // an explicitly cast comparison is recorded below
    add(s.param, "bare", s.array ? type : type, label);
  }
  for (const s of [...insertSites(sql), ...updateSetSites(sql)]) {
    const type = schema[s.table]?.[s.column];
    if (!type) continue;
    add(s.param, "bare", type, `${s.table}.${s.column} (${type})`);
  }
  // explicit `$N::type` sites
  for (const m of sql.matchAll(/\$(\d+)\s*::\s*([a-z_][a-z0-9_]*)(\s*\[\s*\])?/gi)) {
    const t = normalizeCast(m[2]) + (m[3] ? "[]" : "");
    add(Number(m[1]), "cast", t, `::${t}`);
  }
  return byParam;
}

function normalizeCast(t) {
  const a = {
    integer: "int4",
    int: "int4",
    bigint: "int8",
    smallint: "int2",
    boolean: "bool",
    varchar: "text",
  };
  const l = t.toLowerCase();
  return a[l] || l;
}

// Functions that take `"any"` INDEPENDENTLY PER ARGUMENT. Postgres has nothing
// to infer an untyped parameter from in one of these, so unless the SAME
// parameter is pinned somewhere else in the statement it fails outright with
//
//   42P18  could not determine data type of parameter $N
//
// Found live in completeLivenessVerification: `$15` was only ever
// `jsonb_build_object(..., 'verifier_policy', $15)`, so every call 500'd.
//
// coalesce/greatest/least/nullif are deliberately NOT here. They look similar
// but resolve across their arguments as a group, so `coalesce($4, some_column)`
// infers $4 from the column and is perfectly fine — measured, after this rule
// first flagged two such sites in api/_channel-ingest.js that EXPLAIN then
// planned clean.
const ANY_FUNCTIONS =
  /\b(jsonb_build_object|json_build_object|jsonb_build_array|json_build_array)\s*\(/gi;

function anyArgParams(sql) {
  const found = new Map();
  for (const m of sql.matchAll(ANY_FUNCTIONS)) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(sql, open);
    if (close < 0) continue;
    const inner = sql.slice(open + 1, close);
    for (const a of splitTopSpans(inner)) {
      const pm = a.text.match(BARE_PARAM);
      if (pm) found.set(Number(pm[1]), `${m[1]}(… $${pm[1]} …)`);
    }
  }
  return found;
}

function conflictSites(sql, schema, scope) {
  const out = [];
  const sites = paramSites(sql, schema, scope);
  for (const [param, where] of anyArgParams(sql)) {
    const s = sites.get(param);
    const determined = s && (s.bare.size || s.cast.size);
    if (!determined) {
      out.push({
        param,
        kinds: ["undeterminable"],
        detail: `$${param} has no type-determining site — it is only ever ${where}, which takes "any"`,
      });
    }
  }
  for (const [param, { bare, cast }] of paramSites(sql, schema, scope)) {
    const bareTypes = [...bare.keys()];
    const castTypes = [...cast.keys()];
    if (bareTypes.length > 1) {
      out.push({
        param,
        kinds: bareTypes,
        detail: `$${param} is deduced from incompatible sites: ${bareTypes
          .map((t) => bare.get(t))
          .join(" vs ")}`,
      });
      continue;
    }
    if (bareTypes.length === 1 && castTypes.length) {
      const t = bareTypes[0];
      if (!castTypes.includes(t)) {
        out.push({
          param,
          kinds: [t, ...castTypes],
          detail: `$${param} is pinned by ${castTypes
            .map((c) => cast.get(c))
            .join("/")} but used bare at ${bare.get(t)}`,
        });
      }
    }
  }
  return out;
}
