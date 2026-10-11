// WS-R134. THE SHARED SOURCE-SCANNING TOKENIZER.
//
// Five waves of workstreams tripped a static scanner with PROSE, not code: a
// comment naming a person-lane table by name (room-leak, twice —
// `context/rejected.md#ws-r28-leak-battery-scanner-matches-prose-not-only-sql`,
// `#ws-r129-no-follower-level-timezone-or-quiet-hours-column`), a short
// backtick-quoted identifier in a comment desynchronising a paired-delimiter
// regex onto an unrelated, much-later span (readiness, twice —
// `#ws-r113-a-short-backtick-quoted-word-in-a-comment-desynced-a-source-
// scanning-regex-onto-a-pre-existing-comment`, `#ws-r122-readiness-comment-
// backtick-cascade-tripped-banned-word-scan`), and a scanner's own header
// comment explaining what it does NOT do tripping the identical banned-
// substring check a real violation would
// (`#ws-r127-own-eval-static-scan-tripped-by-its-own-prose`). Every one of
// these was a scanner reading the RAW file text — comments included — as if
// it were the code whose shape it claims to check. This module is the one
// place that distinction gets made, so every scanner that needs it asks
// here instead of re-deriving its own (wrong) answer.
//
// Pure, offline, no dependencies. Every scanner named in this workstream's
// brief (evals/room-leak/run.mjs, evals/readiness/run.mjs,
// evals/incidents/run.mjs, evals/room-doors/run.mjs and
// evals/room-doors/shapes.mjs) reads its `api/`/`src/` source through
// `stripComments` (or one of the derived helpers below) before pattern-
// matching it, so a comment can no longer masquerade as code to any of them.
// `evals/source-scan/run.mjs` is this file's own test suite: a self-test of
// the tokenizer plus one frozen fixture per historical trap above, each
// built to fail under the OLD (raw-text) behaviour and pass under this one.
//
// ONE TOKENIZER, walked ONCE per call (`tokenize`, below) — every derived
// helper (`stripComments`, `sqlTextOf`, `opLiteralsOf`, `importsOf`) reads
// its result rather than re-scanning the source with its own regex-context
// heuristic, so the cost of understanding "am I inside a string/comment/
// regex literal right now" is paid exactly once no matter how many helpers
// a scanner calls against the same file.
//
// WHAT "regex-literal-aware enough for this repo" MEANS (law 2's own
// phrase). A perfect JS tokenizer needs a full parser to disambiguate `/` as
// division from `/` opening a regex literal in every case; this repo does
// not need perfection, because every regex literal any scanner here has ever
// had to step over follows the ordinary pattern of sitting where a VALUE is
// expected (after `(`, `,`, `=`, `return`, `!`, a boolean operator, or at the
// start of an expression) — never immediately after an identifier, a closing
// `)`/`]`, a number, or a string/template literal, which is the shape of a
// division instead. `regexAllowedAfter` below is exactly that heuristic,
// tracked incrementally (the last code TOKEN emitted) rather than by
// re-scanning everything emitted so far, so a large file costs one linear
// pass rather than one per `/` encountered. Where the heuristic is wrong
// (rare, and only inside an expression shape this repo does not write), the
// failure mode is contained by design: a misjudged `/` is re-tried as plain
// division, and a misjudged regex-open that finds no closing `/` before the
// end of its own LINE is abandoned and the `/` is re-emitted as an ordinary
// character — a regex literal cannot span a newline unescaped, so this never
// eats the rest of the file the way the bug class in the header above did.

const REGEX_CONTEXT_PUNCT = new Set("([{,;:=!&|?+-*%^~<>".split(""));
const REGEX_CONTEXT_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "yield", "await", "else", "do",
]);

/** `tail` is either "" (start of file / start of an expression), a single
 *  punctuation character, or an identifier/number word — whichever code
 *  token was most recently emitted, ignoring whitespace and comments. */
function regexAllowedAfter(tail) {
  if (tail === "") return true;
  if (tail.length === 1 && REGEX_CONTEXT_PUNCT.has(tail)) return true;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tail)) return REGEX_CONTEXT_KEYWORDS.has(tail);
  return false; // a number, or a token ending in `)`/`]`/`}`/a string or
  // template's own closing delimiter — every one of those is the shape a
  // DIVISION follows, never a regex literal, in code this repo writes.
}

function endOfBlockComment(src, start) {
  const n = src.length;
  let j = start + 2;
  while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
  return Math.min(j + 2, n);
}

function endOfLineComment(src, start) {
  const n = src.length;
  let j = start + 2;
  while (j < n && src[j] !== "\n") j++;
  return j; // stops AT the newline, which the next token emits normally
}

function endOfStringLiteral(src, start) {
  const n = src.length;
  const quote = src[start];
  let j = start + 1;
  while (j < n && src[j] !== quote) {
    if (src[j] === "\\") j++;
    j++;
  }
  return Math.min(j + 1, n);
}

/** Index just past the closing backtick of the template literal starting at
 *  `start` (which must be a backtick). Tracks `${...}` interpolation depth so
 *  a `}` or a nested backtick inside an interpolation is not mistaken for the
 *  literal's own end, and tracks nested strings/templates inside an
 *  interpolation — enough for every real statement in this repo (a template
 *  literal built from other template literals, or containing a comment
 *  inside its own `${...}`), without a full recursive-descent parser. */
function endOfTemplateLiteral(src, start) {
  const n = src.length;
  let j = start + 1;
  let depth = 0;
  while (j < n) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (depth === 0) {
      if (c === "`") return j + 1;
      if (c === "$" && src[j + 1] === "{") { depth = 1; j += 2; continue; }
      j++;
      continue;
    }
    if (c === "{") { depth++; j++; continue; }
    if (c === "}") { depth--; j++; continue; }
    if (c === '"' || c === "'") { j = endOfStringLiteral(src, j); continue; }
    if (c === "`") { j = endOfTemplateLiteral(src, j); continue; }
    if (c === "/" && src[j + 1] === "/") { j = endOfLineComment(src, j); continue; }
    if (c === "/" && src[j + 1] === "*") { j = endOfBlockComment(src, j); continue; }
    j++;
  }
  return n;
}

/** Index just past the closing `/` (and any trailing flags) of the regex
 *  literal starting at `start`, or -1 if no valid regex literal is found
 *  before end of line/file — the caller falls back to treating `/` as an
 *  ordinary character (division) in that case, per this module's header. */
function endOfRegexLiteral(src, start) {
  const n = src.length;
  let j = start + 1;
  let inClass = false;
  while (j < n) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "\n") return -1;
    if (c === "[") { inClass = true; j++; continue; }
    if (c === "]") { inClass = false; j++; continue; }
    if (c === "/" && !inClass) {
      j++;
      while (j < n && /[a-zA-Z]/.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

/** The one tokenizer pass. Returns an array of `{ kind, start, end }`
 *  segments covering the whole of `src` end to end, in order —
 *  `kind` is one of "comment", "string", "template", "regex" or "code" (a
 *  maximal run of everything else: identifiers, punctuation, whitespace,
 *  numbers). O(n): the regex-context check is a constant-time comparison
 *  against the last CODE TOKEN already seen, never a re-scan of prior
 *  output. */
function tokenize(src) {
  const n = src.length;
  const tokens = [];
  let i = 0;
  let tail = ""; // last code token emitted, for regex-context only
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";

    if (c === "/" && c2 === "/") {
      const end = endOfLineComment(src, i);
      tokens.push({ kind: "comment", start: i, end });
      i = end;
      continue;
    }
    if (c === "/" && c2 === "*") {
      const end = endOfBlockComment(src, i);
      tokens.push({ kind: "comment", start: i, end });
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = endOfStringLiteral(src, i);
      tokens.push({ kind: "string", start: i, end });
      tail = src.slice(i, end); // a string's own text never matches the
      // identifier/keyword shape below, so this only ever disables regex
      // context for whatever follows — correct, `"x" / 2` is division.
      i = end;
      continue;
    }
    if (c === "`") {
      const end = endOfTemplateLiteral(src, i);
      tokens.push({ kind: "template", start: i, end });
      tail = src.slice(i, end);
      i = end;
      continue;
    }
    if (c === "/" && regexAllowedAfter(tail)) {
      const end = endOfRegexLiteral(src, i);
      if (end !== -1) {
        tokens.push({ kind: "regex", start: i, end });
        tail = src.slice(i, end);
        i = end;
        continue;
      }
    }

    // Plain code: one run of contiguous "uninteresting" characters — an
    // identifier/number, one punctuation character, or whitespace — pushed
    // as its own token so `tail` tracking stays correct without rescanning.
    if (/[A-Za-z0-9_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      tokens.push({ kind: "code", start: i, end: j });
      tail = src.slice(i, j);
      i = j;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      let j = i + 1;
      while (j < n && (src[j] === " " || src[j] === "\t" || src[j] === "\r" || src[j] === "\n")) j++;
      tokens.push({ kind: "code", start: i, end: j });
      // whitespace never changes `tail` — context looks past it.
      i = j;
      continue;
    }
    tokens.push({ kind: "code", start: i, end: i + 1 });
    tail = c;
    i++;
  }
  return tokens;
}

/** Blanks out `//` line comments and `/* *\/` block comments in JS/TS
 *  source — every OTHER character, including every character inside a
 *  string, a template literal (its `${...}` interpolations included) or a
 *  regex literal, survives byte for byte in the SAME position. Length and
 *  newline positions are always preserved (a comment's non-newline
 *  characters become spaces, its newlines stay newlines), so any caller
 *  that used to run `.indexOf(...)`/`.slice(...)`/`.split("\n")` against the
 *  raw source keeps working unmodified against the result — a comment can
 *  no longer read as a live table name, op literal, banned word or import,
 *  but every real offset a caller already computed off the raw text still
 *  lands on the same real code. */
export function stripComments(src) {
  const tokens = tokenize(src);
  let out = "";
  for (const tok of tokens) {
    if (tok.kind === "comment") out += src.slice(tok.start, tok.end).replace(/[^\n]/g, " ");
    else out += src.slice(tok.start, tok.end);
  }
  return out;
}

/** Every string- and template-literal CONTENT in `src` (delimiters
 *  stripped, comments never entered at all) — the surface every scanner
 *  here means when it says "the actual SQL text", "the actual op literal"
 *  or "the actual rendered copy", as opposed to a comment merely discussing
 *  one. Returns an array in source order; a template literal's `${...}`
 *  interpolations are NOT included (they are code, not literal content) and
 *  are skipped rather than spliced in — a template literal with N
 *  interpolations contributes N+1 pieces, the text between and around them. */
export function sqlTextOf(src) {
  const tokens = tokenize(src);
  const out = [];
  for (const tok of tokens) {
    if (tok.kind === "string") {
      const raw = src.slice(tok.start, tok.end);
      out.push(unescapeSimple(raw.slice(1, Math.max(1, raw.length - 1))));
    } else if (tok.kind === "template") {
      out.push(...templateLiteralContentPieces(src.slice(tok.start, tok.end)));
    }
  }
  return out;
}

function unescapeSimple(s) {
  return s.replace(/\\(.)/g, (_, ch) => (ch === "n" ? "\n" : ch === "t" ? "\t" : ch));
}

/** Splits one template literal's OWN text (delimiters included, as sliced
 *  straight from source) into its literal-content pieces, dropping every
 *  `${...}` interpolation and recursing into any nested template literal
 *  found inside one. */
function templateLiteralContentPieces(literalText) {
  const pieces = [];
  const n = literalText.length;
  let i = 1; // past the opening backtick
  let cur = "";
  while (i < n) {
    const c = literalText[i];
    if (c === "`" && i === n - 1) break; // the closing backtick
    if (c === "\\") { cur += literalText[i + 1] || ""; i += 2; continue; }
    if (c === "$" && literalText[i + 1] === "{") {
      pieces.push(cur);
      cur = "";
      const innerStart = i + 2;
      const innerEnd = endOfInterpolation(literalText, innerStart);
      const inner = literalText.slice(innerStart, innerEnd);
      for (const innerTok of tokenize(inner)) {
        if (innerTok.kind === "template") {
          pieces.push(...templateLiteralContentPieces(inner.slice(innerTok.start, innerTok.end)));
        } else if (innerTok.kind === "string") {
          const raw = inner.slice(innerTok.start, innerTok.end);
          pieces.push(unescapeSimple(raw.slice(1, Math.max(1, raw.length - 1))));
        }
      }
      i = innerEnd + 1; // past the closing `}`
      continue;
    }
    cur += c;
    i++;
  }
  pieces.push(cur);
  return pieces;
}

function endOfInterpolation(text, start) {
  let depth = 1;
  let j = start;
  while (j < text.length && depth > 0) {
    if (text[j] === "{") depth++;
    else if (text[j] === "}") depth--;
    if (depth === 0) return j;
    j++;
  }
  return text.length;
}

/** Every `<field> === "<name>"` (optionally `body.<field> === "<name>"`)
 *  literal in `src`, comment-stripped first — the shape `evals/room-doors/
 *  run.mjs`'s own op- and format-dispatch discovery (SECTION §18) reads.
 *  Returns `[{ name, index }]` in source order; `index` is the offset of the
 *  MATCH inside the comment-stripped text, which — because `stripComments`
 *  preserves length and every newline position — is the same offset a
 *  caller would already be using against the raw source for a nearest-
 *  preceding-literal comparison or a `.slice(...)` window. */
export function opLiteralsOf(src, field = "op") {
  const clean = stripComments(src);
  const re = new RegExp(`(?:body\\.)?${field}\\s*===\\s*"([a-zA-Z0-9_]+)"`, "g");
  const hits = [];
  for (const m of clean.matchAll(re)) hits.push({ name: m[1], index: m.index });
  return hits;
}

/** The one-file-away `import { a, b } from "./file.js"` graph edge list —
 *  comment-stripped first, so a comment mentioning an import path or a
 *  named export never adds a phantom edge. Mirrors `evals/room-leak/
 *  run.mjs`'s own original (pre-WS-R134) `importsOf`, which this module
 *  supersedes byte-for-byte on real, uncommented import statements — the
 *  parity check in `evals/source-scan/run.mjs` proves that equivalence on
 *  the real tree. */
export function importsOf(src) {
  const clean = stripComments(src);
  const files = [];
  const names = [];
  for (const m of clean.matchAll(/import\s*\{([^}]*)\}\s*from\s+"\.\/(_?[\w.-]+\.js)"/g)) {
    files.push(m[2]);
    for (const n of m[1].split(",")) {
      const name = n.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return { files, names };
}

/** Self-test, run directly (`node evals/lib/source-scan.mjs`) or from
 *  `evals/source-scan/run.mjs`. Returns `{ pass, fail, log }` rather than
 *  printing, so the suite file owns its own `ok()` bookkeeping and exit
 *  code; this function is the assertions, not the runner. */
export function selfTest() {
  const cases = [];
  const t = (name, cond) => cases.push({ name, cond: Boolean(cond) });

  t("line comment removed, code before it kept",
    stripComments('const x = 1; // vy_room_follower\nconst y = 2;').includes("const y = 2;")
    && !stripComments('const x = 1; // vy_room_follower\nconst y = 2;').includes("vy_room_follower"));

  t("block comment removed, spans multiple lines, newlines preserved",
    (() => {
      const src = "a\n/* vy_room_thread\nline two */\nb";
      const clean = stripComments(src);
      return !clean.includes("vy_room_thread") && clean.split("\n").length === src.split("\n").length;
    })());

  t("stripComments preserves total length",
    (() => {
      const src = 'const s = `select * from vy_room_follower`; // a comment\nconst t = "x // not a comment";';
      return stripComments(src).length === src.length;
    })());

  t("a double-slash inside a string is not treated as a comment",
    stripComments('const u = "http://example.com"; const after = 1;').includes("after = 1"));

  t("a double-slash inside a template literal is not treated as a comment",
    stripComments("const u = `http://example.com`; const after = 1;").includes("after = 1"));

  t("a block-comment-looking span inside a string survives",
    stripComments('const s = "/* not a comment */ still here";').includes("still here"));

  t("a regex literal containing escaped slashes does not truncate the rest of the file",
    stripComments('const re = /https:\\/\\//; const after = 2;').includes("after = 2"));

  t("division right after a closing paren is not misread as a regex opener",
    stripComments("const r = (a + b) / 2; // c\nconst after = 1;").includes("after = 1")
    && !stripComments("const r = (a + b) / 2; // c\nconst after = 1;").includes("// c"));

  t("a short backtick-quoted word inside a REMOVED comment cannot desync a later backtick scan",
    (() => {
      // The exact ws-r113/ws-r122 shape: a short backtick pair in a comment,
      // far from a later, unrelated backtick-quoted word that must not be
      // swept into a bogus span once the comment is gone.
      const src = 'function f() {\n  // uses `has` to check\n  return 1;\n}\nconst LABEL = `clone`;';
      const clean = stripComments(src);
      const spans = clean.match(/`[^`]{4,}`/g) || [];
      return spans.length === 1 && spans[0] === "`clone`";
    })());

  t("a table name mentioned only in a comment does not survive stripComments",
    !stripComments("// never reads vy_room_follower directly\nconst x = 1;").includes("vy_room_follower"));

  t("a table name mentioned in a real backtick SQL statement survives",
    stripComments("const q = `select count(*) from vy_room_follower`;").includes("vy_room_follower"));

  t("a comment matching a banned-word regex is blanked, a real string match is not",
    (() => {
      const clean = stripComments('// no fetch, no SMTP client\nconst label = "a replica";');
      return !/SMTP/.test(clean) && /replica/.test(clean);
    })());

  t("sqlTextOf returns a real template literal's content, not a comment's",
    (() => {
      const pieces = sqlTextOf('// from vy_room_follower\nconst q = `select 1 from vy_room_thread`;');
      return pieces.some((p) => p.includes("vy_room_thread")) && !pieces.some((p) => p.includes("vy_room_follower"));
    })());

  t("sqlTextOf drops ${...} interpolation but keeps the literal text around it",
    (() => {
      const pieces = sqlTextOf("const q = `select ${cols} from vy_room_follower`;");
      return pieces.join("|").includes("from vy_room_follower") && !pieces.join("|").includes("cols");
    })());

  t("sqlTextOf ignores a string inside a comment",
    sqlTextOf('// const label = "a replica"\nconst x = 1;').length === 0);

  t("opLiteralsOf ignores an op literal written only inside a comment",
    opLiteralsOf('// old code: if (op === "legacy_delete")\nif (op === "join") {}').length === 1
    && opLiteralsOf('if (op === "join") {} // if (op === "legacy_delete")')[0].name === "join");

  t("opLiteralsOf finds a body.op literal and a bare op literal alike",
    opLiteralsOf('if (body.op === "a") {}\nif (op === "b") {}').map((h) => h.name).join(",") === "a,b");

  t("opLiteralsOf's index lines up with the comment-stripped text length (offsets stay slice-compatible)",
    (() => {
      const src = '// if (op === "ghost")\nif (op === "join") {}';
      const clean = stripComments(src);
      const hit = opLiteralsOf(src)[0];
      return clean.slice(hit.index, hit.index + 14) === 'op === "join")';
    })());

  t("importsOf ignores a named import mentioned only in a comment",
    importsOf('// import { dangerousWrite } from "./_x.js"\nimport { safeRead } from "./_y.js";').names.join(",") === "safeRead");

  t("importsOf finds a real import's file and names",
    (() => {
      const r = importsOf('import { a, b as c } from "./_z.js";');
      // The ORIGINAL (exported) name, "b" — the same thing the pre-WS-R134
      // `importsOf` in evals/room-leak/run.mjs tracked, because what matters
      // for that scanner is which SYMBOL a creator-material file exports as
      // dangerous, not what a caller chose to call it locally.
      return r.files.join(",") === "_z.js" && r.names.join(",") === "a,b";
    })());

  const pass = cases.filter((c) => c.cond).length;
  const fail = cases.length - pass;
  const log = cases.map((c) => `${c.cond ? "  ok  " : "FAIL  "}${c.name}`).join("\n");
  return { pass, fail, log, cases };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pass, fail, log } = selfTest();
  console.log(log);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
