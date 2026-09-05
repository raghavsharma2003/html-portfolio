// WS-R124 -- the door battery's FOURTH pass: body-shape fuzzing.
//
// The first three passes (WS-R38, the second door battery, WS-R120) attacked
// WHO a request claims to be -- a forged session, a cross-Room id, a stolen
// bearer. None of them attacked WHAT SHAPE the body itself takes. This file
// is the one, shared, generic hostile-body generator every op in
// evals/room-doors/run.mjs's SECTION 25 drives through -- never a hand-rolled
// fuzz list per door, exactly this workstream's brief law 1.
//
// -- HOW A FIELD LIST IS DERIVED, WITHOUT A HAND LIST --------------------
//
// Every op in run.mjs's own OP_INVOKE table (SECTION 25) is a plain function
// `(db, body) => ...` that reads the body fields it needs -- the SAME
// `body.<field>` shape every door in `api/*.js` already reads them in,
// because each OP_INVOKE entry is a direct transcription of that door's own
// dispatch block (`q` -> `db`, `user.id` -> a fixture identity, everything
// else byte-identical). `bodyFieldsOf` below reads that function BACK AS
// TEXT and collects every `body.<ident>` occurrence in it -- exactly the
// style `run.mjs`'s own `computedOps`/`computedFormats` already use for the
// op and format lists (source-text extraction, never a maintained list that
// can silently drift from the code it describes). A field renamed in the
// OP_INVOKE entry is a field renamed in what this generator fuzzes, with
// nothing else to keep in sync.
export function bodyFieldsOf(fn) {
  const src = fn.toString();
  const names = new Set();
  for (const m of src.matchAll(/\bbody\.([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]);
  return [...names].sort();
}

/** `req.body || {}` -- every door in this repo's own guard, applied here so a
 *  case reaches OP_INVOKE in exactly the shape the real door would ever hand
 *  it: `null`/`undefined`/`0`/`""`/`false` normalise to `{}` (never null, so
 *  a decision fn's own destructuring default gets exercised, not our own
 *  harness's inability to feed it a body a real client could never cause);
 *  a truthy non-object (an array, a string, a number, `{}`) passes through
 *  untouched, because that IS a shape a real client's raw JSON can produce. */
export const normalizeLikeDoor = (x) => x || {};

/** Twelve classes, each named, each a pure function from "the value this
 *  field would otherwise hold" to a hostile replacement. Deliberately
 *  type-confusing rather than domain-aware: the generator does not know or
 *  care whether a field is "supposed to be" a string, a uuid or a count --
 *  the whole point of black-box shape fuzzing is that every one of these
 *  values arrives at a decision function that has to cope with it, and the
 *  claim under test is "every reachable op answers a named 4xx, never a
 *  throw, never a write" for every one of them, regardless of the field's
 *  own semantics. */
const NULL_BYTE_STRING = "abc" + String.fromCharCode(0) + "def";
// Fullwidth Latin small letters spelling "slug" -- NFKC-normalises to
// plain ascii "slug". Built from code points, never typed as a literal,
// so no invisible or lookalike byte survives a copy of this file.
const NFKC_UNSTABLE_STRING = [0xff53, 0xff4c, 0xff55, 0xff47].map((c) => String.fromCodePoint(c)).join("");
// Two U+200B ZERO WIDTH SPACE code points, a space, a tab, a newline, a
// trailing space -- built from code points for the same reason.
const ZERO_WIDTH_STRING = [0x200b, 0x200b].map((c) => String.fromCodePoint(c)).join("") + " \t\n ";

function deeplyNested(depth) {
  let v = "leaf";
  for (let i = 0; i < depth; i++) v = [v];
  return v;
}

export const HOSTILE_CLASSES = [
  {
    name: "arrays-for-scalars",
    valueFor: () => ["hostile", 1, { nested: true }],
    wholeBody: () => ["hostile", 1, { nested: true }],
  },
  {
    name: "objects-for-scalars",
    valueFor: () => ({ a: { b: { c: "hostile" } } }),
    wholeBody: () => ({ a: { b: { c: "hostile" } } }),
  },
  {
    name: "digit-strings-for-numbers",
    valueFor: () => "123456789",
    wholeBody: () => "123456789",
  },
  {
    name: "raw-numbers-for-strings",
    valueFor: () => 123456789,
    wholeBody: () => 123456789,
  },
  {
    name: "booleans-for-scalars",
    valueFor: () => true,
    wholeBody: () => true,
  },
  {
    name: "null-for-required",
    valueFor: () => null,
    // A `null` WHOLE body normalises to `{}` by `normalizeLikeDoor` -- the
    // one class with nothing new to say at the whole-body granularity, kept
    // for the op x class count's own honesty (SECTION 25's own log states
    // this rather than silently reindexing the other eleven).
    wholeBody: () => null,
  },
  {
    name: "oversized-numbers",
    // `1e309` overflows a JS double to `Infinity` -- the exact shape a raw
    // JSON body's digit run does under `JSON.parse` (V8's own documented
    // behaviour), reproduced directly rather than round-tripped through
    // `JSON.parse` for one field.
    valueFor: () => 1e309,
    wholeBody: () => 1e309,
  },
  {
    name: "embedded-null-bytes",
    valueFor: () => NULL_BYTE_STRING,
    wholeBody: () => NULL_BYTE_STRING,
  },
  {
    name: "nfkc-unstable-strings",
    // Fullwidth Latin (U+FF41..) NFKC-normalises to plain ascii -- the shape
    // a slug/locale/contact check that compares raw bytes can miss while one
    // that normalises first would not.
    valueFor: () => NFKC_UNSTABLE_STRING,
    wholeBody: () => NFKC_UNSTABLE_STRING,
  },
  {
    name: "prototype-pollution-keys",
    // Handled specially by `buildHostileBody` below -- a whole-body class,
    // never a per-field one, because the attack is about keys the body
    // carries ALONGSIDE its real fields, not about what a named field holds.
    valueFor: () => "hostile-neighbour",
    wholeBody: () => JSON.parse('{"__proto__":{"polluted1":true},"constructor":{"prototype":{"polluted2":true}}}'),
  },
  {
    name: "deeply-nested-values",
    valueFor: () => deeplyNested(300),
    wholeBody: () => deeplyNested(300),
  },
  {
    name: "zero-width-whitespace",
    valueFor: () => ZERO_WIDTH_STRING,
    wholeBody: () => ZERO_WIDTH_STRING,
  },
];

if (HOSTILE_CLASSES.length !== 12) {
  throw new Error(`HOSTILE_CLASSES must carry exactly twelve classes, found ${HOSTILE_CLASSES.length}`);
}

/** Builds ONE hostile body for (fields, class) -- never one per field, so the
 *  battery's own count is exactly `ops x classes` (SECTION 25 prints and logs
 *  it), law 4's own number. Every field this op reads gets the SAME class's
 *  hostile value simultaneously; a `base` seed (e.g. a real, freshly-minted
 *  `session`) is overridden field-by-field like any other, because
 *  `replica_id`/`session`/`slug` are exactly as much a fuzz target as any
 *  content field -- the brief's own examples ("replica_id is an array",
 *  "a slug carries a null byte") name identity-shaped fields directly. */
const PROTO_POLLUTION_SUFFIX =
  '"__proto__":{"polluted1":true},"constructor":{"prototype":{"polluted2":true}}}';

export function buildHostileBody(fields, cls, base = {}) {
  if (cls.name === "prototype-pollution-keys") {
    const raw = { ...base };
    for (const f of fields) raw[f] = "hostile-neighbour";
    const rawJson = JSON.stringify(raw);
    // `rawJson` is either "{}" (no real fields — nothing to keep a comma
    // for) or "{...real fields...}" (needs a comma before the two marker
    // keys). Building the two shapes explicitly rather than one `.replace`
    // avoids a leading-comma `{,"__proto__":...}` — invalid JSON — for
    // every zero-field op (`org.js`'s "list_mine", `payments.js`'s
    // "payout_statements", ...), found live by this workstream's own first
    // run (`context/rejected.md`).
    const polluted = rawJson === "{}" ? `{${PROTO_POLLUTION_SUFFIX}` : rawJson.replace(/}$/, `,${PROTO_POLLUTION_SUFFIX}`);
    return normalizeLikeDoor(JSON.parse(polluted));
  }
  if (fields.length === 0) {
    return normalizeLikeDoor(cls.wholeBody());
  }
  const out = { ...base };
  for (const f of fields) out[f] = cls.valueFor(f);
  return normalizeLikeDoor(out);
}

/** A parameter is "unsafe" for this check when it is STILL a non-primitive
 *  JS value (an array or a plain object, `null` excepted -- `null` is an
 *  ordinary, intentional SQL NULL, never a shape confusion) at the moment a
 *  write would run, AND it is traceable back to a value THIS hostile body
 *  actually planted (`tainted`, every field value `buildHostileBody` set,
 *  by reference) -- never any other array/object param the query legitimately
 *  binds for its own reasons. `api/_ops.js`'s own `revokeOperatorPush` is
 *  the case that forced this second condition: its `= any($3::text[])`
 *  bind is a real, intentional array (the operator allowlist read off
 *  `process.env`), present and identical for EVERY class including a
 *  perfectly benign body, and flagging it would blame the query's own
 *  ordinary use of a SQL array bind rather than anything the hostile body
 *  caused. A parameter that is a string/number/boolean/null/undefined has
 *  already been coerced or validated into a real column value by the code
 *  above the write, even if the content itself is ugly
 *  (`String(["a","b"])` -> `"a,b"` is still a plain string) -- exactly the
 *  outcome this workstream's own brief wants ("never a row written from a
 *  confused shape"), so a write with only safe params is the CORRECT,
 *  expected success path for a value the code already sanitised, not a
 *  finding. */
export function paramsAreUnsafe(params, tainted) {
  const taintSet = tainted instanceof Set ? tainted : new Set(tainted || []);
  return (params || []).some((p) => p !== null && typeof p === "object" && taintSet.has(p));
}

/** A marker thrown by `withWriteGuard` the instant a hostile case's call
 *  reaches an INSERT/UPDATE/DELETE -- this file's own contract with SECTION
 *  25: a case that throws THIS is "reached a write", never "answered a
 *  domain error", regardless of what SQL text it was about to send.
 *  `unsafe` (see `paramsAreUnsafe` above) is what SECTION 25 actually
 *  scores as a finding; a safe write (every bound param already a
 *  primitive) is logged but never counted as one. Exported so SECTION 25
 *  can `instanceof` it without re-deriving the class from a string. */
export class UnexpectedWriteError extends Error {
  constructor(sql, params, tainted) {
    super("a body-shape fuzz case reached a write -- WS-R124's own poisoned db");
    this.code = "fuzz_reached_write";
    this.sql = sql;
    this.params = params;
    this.unsafe = paramsAreUnsafe(params, tainted);
  }
}

const WRITE_SQL = /\b(insert\s+into|update\s+[a-z_]+|delete\s+from)\b/i;

/** Wraps an existing fixture `db(sql, params)` so ANY write it would run
 *  instead throws `UnexpectedWriteError` before the fixture's own SQL
 *  emulation ever sees it -- reads pass straight through unchanged. This is
 *  the "poisoned db" shape this repo already uses elsewhere to prove a code
 *  path never reaches a write it should not (`evals/room-dormancy/run.mjs`'s
 *  own `poisoned` `db`), specialised here to reads-still-work rather than
 *  everything-throws, because most ops legitimately need to READ (resolve a
 *  room, decode a session) before they can correctly refuse a hostile body --
 *  a db that throws on every call could not tell "refused before touching
 *  the db" apart from "refused while touching the db to check something".
 *
 *  `tainted` -- every non-primitive VALUE this case's own hostile body
 *  carries (by reference) -- lets `UnexpectedWriteError` tell "this write's
 *  array/object param IS the hostile shape" apart from "this write's
 *  array/object param is some other, code-owned array the query always
 *  binds" (`paramsAreUnsafe`'s own header). */
export function withWriteGuard(db, tainted) {
  const wrapped = async (sql, params = []) => {
    if (WRITE_SQL.test(sql)) throw new UnexpectedWriteError(sql, params, tainted);
    return db(sql, params);
  };
  wrapped.calls = db.calls;
  return wrapped;
}

/** The non-primitive VALUES a hostile body carries, for `withWriteGuard`'s
 *  own `tainted` set -- top-level field values (arrays/objects only; a
 *  primitive cannot alias anything) plus, for whole-body classes, the body
 *  itself when it is non-primitive. */
export function taintedValuesOf(body) {
  const values = new Set();
  const walk = (v) => {
    if (v === null || typeof v !== "object" || values.has(v)) return;
    values.add(v);
    for (const child of Object.values(v)) walk(child);
  };
  walk(body);
  return values;
}
