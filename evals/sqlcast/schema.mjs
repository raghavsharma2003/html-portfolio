// Parse the checked-in DDL (db/schema.sql + db/migrations/*.sql) into a
// table.column -> Postgres type map, entirely offline.
//
// Why parse rather than query information_schema: this map is used by a GATE
// that has to run in CI and on a clean checkout with no database and no
// credentials. A gate that needs the live DB is a gate that gets skipped, and
// a skipped gate looks exactly like a passing one.
import fs from "node:fs";
import path from "node:path";

// Normalize a declared SQL type to the identity that matters for casting:
// "is a bound text parameter accepted here without a cast?"
export function normType(raw) {
  let t = raw.trim().toLowerCase();
  t = t.replace(/\s+/g, " ");
  // strip length/precision, e.g. numeric(10,2), varchar(64)
  t = t.replace(/\([^)]*\)/g, "");
  t = t.trim();
  const arr = /\[\s*\]$/.test(t);
  t = t.replace(/\[\s*\]$/, "").trim();
  const alias = {
    "character varying": "text",
    varchar: "text",
    character: "text",
    char: "text",
    "timestamp with time zone": "timestamptz",
    "timestamp without time zone": "timestamp",
    timestamp: "timestamp",
    "time with time zone": "timetz",
    "time without time zone": "time",
    halfvec: "halfvec",
    vector: "vector",
    int: "int4",
    integer: "int4",
    int4: "int4",
    smallint: "int2",
    int2: "int2",
    bigint: "int8",
    int8: "int8",
    serial: "int4",
    bigserial: "int8",
    "double precision": "float8",
    real: "float4",
    boolean: "bool",
    bool: "bool",
    numeric: "numeric",
    decimal: "numeric",
    uuid: "uuid",
    jsonb: "jsonb",
    json: "json",
    text: "text",
    bytea: "bytea",
    date: "date",
    inet: "inet",
    interval: "interval",
  };
  const norm = alias[t] || t;
  return arr ? norm + "[]" : norm;
}

// Types a TEXT-bound parameter can be compared to / inserted into without a
// cast. Everything else is a cast site.
const TEXTY = new Set(["text", "json", "unknown", "citext"]);
export function needsCast(type) {
  if (!type) return false;
  return !TEXTY.has(type);
}

const TYPE_WORDS =
  "(?:timestamptz|timetz|timestamp(?:\\s+with(?:out)?\\s+time\\s+zone)?|time(?:\\s+with(?:out)?\\s+time\\s+zone)?|double\\s+precision|character\\s+varying|character|varchar|char|bigserial|serial|smallint|bigint|integer|int8|int4|int2|int|numeric|decimal|boolean|bool|uuid|jsonb|json|text|bytea|date|inet|interval|float8|float4|real|citext|halfvec|vector)";

// Split a "create table (...)" body on top-level commas.
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

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, "");
}

const CONSTRAINT_START =
  /^(primary\s+key|unique|check|foreign\s+key|constraint|exclude|like)\b/i;

export function parseDDL(sql) {
  const map = {};
  const src = stripComments(sql);

  // create table [if not exists] <name> ( <body> )
  const ct =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_.]*)\s*\(/gi;
  let m;
  while ((m = ct.exec(src))) {
    const table = m[1].split(".").pop();
    // walk to the matching close paren
    let i = ct.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    const body = src.slice(ct.lastIndex, i - 1);
    const cols = (map[table] ||= {});
    for (const part of splitTop(body)) {
      const line = part.trim();
      if (!line || CONSTRAINT_START.test(line)) continue;
      const cm = line.match(
        new RegExp(`^"?([a-z_][a-z0-9_]*)"?\\s+(${TYPE_WORDS}(?:\\s*\\[\\s*\\])?)`, "i"),
      );
      if (cm) cols[cm[1].toLowerCase()] = normType(cm[2]);
    }
  }

  // alter table <name> add column [if not exists] <col> <type>
  const at = new RegExp(
    `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?([a-z_][a-z0-9_.]*)\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?"?([a-z_][a-z0-9_]*)"?\\s+(${TYPE_WORDS}(?:\\s*\\[\\s*\\])?)`,
    "gi",
  );
  while ((m = at.exec(src))) {
    const table = m[1].split(".").pop();
    (map[table] ||= {})[m[2].toLowerCase()] = normType(m[3]);
  }

  // alter table <name> alter column <col> type <type>
  const alt = new RegExp(
    `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?([a-z_][a-z0-9_.]*)\\s+alter\\s+column\\s+"?([a-z_][a-z0-9_]*)"?\\s+(?:set\\s+data\\s+)?type\\s+(${TYPE_WORDS}(?:\\s*\\[\\s*\\])?)`,
    "gi",
  );
  while ((m = alt.exec(src))) {
    const table = m[1].split(".").pop();
    (map[table] ||= {})[m[2].toLowerCase()] = normType(m[3]);
  }

  return map;
}

export function loadSchema(root) {
  const files = [path.join(root, "db/schema.sql")];
  const migDir = path.join(root, "db/migrations");
  if (fs.existsSync(migDir)) {
    for (const f of fs.readdirSync(migDir).sort()) {
      if (f.endsWith(".sql")) files.push(path.join(migDir, f));
    }
  }
  const map = {};
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const part = parseDDL(fs.readFileSync(f, "utf8"));
    for (const [t, cols] of Object.entries(part)) {
      Object.assign((map[t] ||= {}), cols);
    }
  }
  return map;
}
