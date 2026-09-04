// The copy law, mechanised. DESIGN-LAW.md §1 (the purge) and §5 (enforcement).
//
// WHAT CHANGED, AND WHY IT HAD TO
// ---------------------------------------------------------------------------
// This file used to do one thing: strip comments from `src/components/` and
// `site/*.html`, and fail on any em-dash that survived. That was right, and it
// was also half a gate — it never looked at `src/studio/`, which is where the
// audit counted 73 em-dashes, and it had no opinion at all about the rest of
// the "nonsense written on it" the owner named: version stamps, numbered
// eyebrows, scroll cues, filler verbs, and the OTHER product's codename sitting
// in this product's sign-in copy.
//
// THE ONE HARD PROBLEM: WHAT COUNTS AS COPY
// ---------------------------------------------------------------------------
// A naive regex over whole files is a useless gate here, and provably so: this
// repo's prose and comments use em-dashes freely and correctly, and identifiers
// legitimately contain the banned words (a variable named `elevation`, a path
// containing `beta`, an import of `../engine/meera`). A gate that fires on
// those gets switched off within a week, and a gate that is switched off is
// worse than no gate because it looks like coverage.
//
// So there are TWO passes, with deliberately different reach:
//
//   PASS 1 (broad, em-dash only). Comments are blanked, line numbers kept, and
//   any dash that survives is flagged. This is safe to run broadly because in
//   .ts/.tsx an em-dash outside a comment is inside a string literal or a JSX
//   text node by construction — there is nowhere else for it to be. This is the
//   old gate, unchanged in behaviour, and it is the single highest-value check.
//
//   PASS 2 (targeted, everything else). The banned WORDS and PATTERNS can occur
//   in code, so they only run against strings this file has actually proven are
//   user-visible: JSX text nodes, string/template literals bound to a
//   visible-prop name (label, title, placeholder, aria-label, alt, ...), HTML
//   text nodes and visible HTML attributes, and every literal in a designated
//   copy-constants module. Extraction is done by a small scanner rather than a
//   regex, so a `//` inside a URL string is not a comment and a quote inside a
//   comment does not open a string.
//
// NEGATIVE CONTROL. A gate nobody has watched fail is a gate nobody knows is
// wired. `selfTest()` runs FIRST, on every invocation, over inline fixtures:
// one that must produce exactly the expected rule ids, and one clean fixture
// that must produce nothing. If a rule stops biting, this file fails before it
// ever reaches the tree and says which rule went quiet.
//
// ESCAPE HATCH. `copy-ok: <reason>` on the same line (in any comment syntax)
// exempts that line. `emdash-ok: <reason>` is kept as an alias so the existing
// exemptions in the tree keep working.
import { readFileSync, readdirSync, statSync } from "fs";
import { isRoomsVocabAllowed } from "./roomsVocabAllowlist.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

/* ═══ 1. SCOPE ══════════════════════════════════════════════════════════════
 *
 * `full` scope gets every rule. `dash` scope gets PASS 1 only, which is exactly
 * what this file enforced before today: `src/components/` is Meera's app, a
 * different product with its own voice, and widening the word bans onto it in
 * the same change that widened the dash ban would be two changes wearing one
 * coat. It is a deliberate hold, not an oversight.
 *
 * There is no `src/student/`. The student surface is `src/gurukul/` (the
 * practice/surface modules) plus `src/replica/` (the student-facing contracts);
 * `src/components/` is the companion app's UI and stays out of `full` for the
 * reason above.
 */
const SCOPES = [
  { dir: "src/studio/", rules: "full", codename: true, roomsVocab: true },
  // WS-R1, the Room. On the `full` list from its first commit, and it is the
  // scope where the word rules matter most: this is the only surface a person
  // who is not a customer of this platform ever reads, so a version stamp, a
  // filler verb or the other product's codename lands in front of a stranger.
  { dir: "src/room/", rules: "full", codename: true, roomsVocab: true },
  { dir: "src/gurukul/", rules: "full", codename: true },
  { dir: "src/replica/", rules: "full", codename: true },
  { dir: "site/", rules: "full", codename: false },
  { dir: "src/components/", rules: "dash", codename: false },
];

/* Root-level HTML entry points. Not under any SCOPES dir, so they need their
 * own list, walked the same way as a directory scope. */
const EXTRA_FILES = [
  { file: "studio.html", rules: "full", codename: false, roomsVocab: true },
  { file: "room.html", rules: "full", codename: false, roomsVocab: true },
];

/* `site/index.html` and `site/privacy.html` ARE the Meera product's pages, so
 * the codename rule cannot bind there — it would be flagging a product for
 * being named. It binds on the Vyakti surfaces, where the name is a leak.
 * WS-R45 adds the creator directory: also a Vyakti surface, also a page a
 * stranger reads first. */
const CODENAME_FILES = /^site\/(vyakti|creators)\.html$/;

/* The Rooms vocabulary rule (WS-R10, docs/gurukul's Rooms plan): "not clone,
 * in front of anyone." `site/` is `full` scope for everything else in it
 * (privacy pages, the delete-account pages), but the Rooms word bans apply
 * only to the pages that tell the Rooms story: the landing page, and (WS-R45)
 * the directory a stranger reaches from search before they are anyone's
 * follower — not to legal pages that were not part of either rewrite. */
const ROOMS_VOCAB_FILES = /^site\/(vyakti|creators)\.html$/;

/* Files whose entire purpose is copy. Every literal in them is on its way to a
 * screen, so the visible-prop heuristic is skipped and all of them are read. */
const COPY_FILES = /(errorCopy|copy|strings|messages|labels)\.tsx?$/i;

/* Never scanned: generated bundles. */
const SKIP_FILE = /\.(gen|bundle)\.[jt]sx?$/;

/* ── THE WAIVER, AND WHY IT EXPIRES ITSELF ──────────────────────────────────
 *
 * `src/studio/StudioApp.tsx` is owned by another workstream that is doing its
 * own copy purge in the same window. Editing it here would be a merge conflict
 * on the most contended file in the repo; leaving the gate red would mean
 * landing a check that nobody can go green against, which is how a gate becomes
 * a `--no-verify` habit.
 *
 * So a waived file's offences are PRINTED IN FULL and do not fail the build.
 * The waiver is not a mute. And it is not permanent either: if a waived file
 * comes back CLEAN, this gate FAILS, telling whoever fixed it to delete the
 * waiver. A waiver that survives the condition that justified it is how a
 * temporary exception becomes permanent, so this one cannot.
 */
// Empty, and the check above keeps it that way: a waiver whose file has become
// clean is itself a failure, so a temporary exemption cannot quietly become
// permanent. Both original entries (StudioApp.tsx, VideoEnrollPanel.tsx) were
// retired when their owning workstreams merged and their copy came back clean.
const WAIVED = new Map([]);

/* ═══ 2. THE RULES ══════════════════════════════════════════════════════════
 *
 * Each rule is (id, test, why). `pass` says which extraction it runs against:
 * "line" = PASS 1, the comment-stripped raw line; "visible" = PASS 2, a string
 * this file has proven renders.
 */
const DASH = /[—–]|&(?:mdash|ndash|#8212|#8211|#x2014|#x2013);/i;

const RULES = [
  {
    id: "dash",
    pass: "line",
    why: "em-dash or en-dash in UI copy; restructure with a comma, colon, full stop or parentheses",
    test: (s) => DASH.test(s),
  },
  {
    id: "version-stamp",
    pass: "visible",
    why: "version or build stamp; a teacher does not ship this product and cannot act on its build number",
    test: (s) =>
      /\bv\d+\.\d+(?:\.\d+)?\b/.test(s) ||
      /\b(?:BETA|ALPHA|PREVIEW BUILD|EARLY ACCESS)\b/.test(s) ||
      /\bbuild\s+\d+/i.test(s) ||
      /\blast sync(?:ed)?\b/i.test(s),
  },
  {
    id: "section-number",
    pass: "visible",
    why: "section-numbering eyebrow (01 / INDEX); number a list with a list, not with decoration",
    test: (s) => /(?:^|\s)\d{2,3}\s*[/·|]\s*[A-Za-z]/.test(s),
  },
  {
    id: "scroll-cue",
    pass: "visible",
    why: "scroll cue; the scrollbar already says this and says it better",
    test: (s) => /(?:^|[\s↓])scroll(?:\s+(?:down|to explore|for more))?\s*$/i.test(s.trim()) || /↓/.test(s),
  },
  {
    id: "locale-strip",
    pass: "visible",
    why: "locale, clock or weather strip; it is not this product's information and it dates the screenshot",
    test: (s) =>
      /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?\s*(?:IST|GMT|UTC|PST|EST|CET)\b/i.test(s) ||
      /°\s*[CF]\b/.test(s) ||
      /\b(?:IST|GMT|UTC)\s*[+-]\s*\d/.test(s),
  },
  {
    id: "poetic-filler",
    pass: "visible",
    why: "poetic filler label; it says nothing and it costs a line a real label could have used",
    test: (s) =>
      // NOTE: `beautifully` was in this list for one run and is deliberately
      // out. It fired on `site/index.html`'s "Beautifully human in how she
      // talks", which is the OTHER product's real claim about its real
      // subject, not filler — and it is not one of the shapes DESIGN-LAW §1
      // actually names. A gate that invents bans beyond its law gets argued
      // with, and a gate that gets argued with gets turned off.
      /\b(?:from the field|field notes?|quietly trusted by|trusted by|loved by|crafted with|made with love|the future of|reimagin\w*)/i.test(
        s,
      ),
  },
  {
    id: "filler-verb",
    pass: "visible",
    why: "filler verb; say the thing the product does instead",
    test: (s) =>
      /\b(?:elevate[sd]?|elevating|seamless(?:ly)?|unleash(?:e[sd]|ing)?|next[- ]gen(?:eration)?|revolutioniz\w*|revolutionis\w*|supercharg\w*|effortless(?:ly)?|cutting[- ]edge|game[- ]chang\w*|leverag\w*\s+(?:the|our|your)\b)/i.test(
        s,
      ),
  },
  {
    id: "placeholder-identity",
    pass: "visible",
    why: "generic placeholder identity; use a real example or an honestly empty state",
    test: (s) => /\b(?:John Doe|Jane Doe|Acme|SmartFlow|Lorem ipsum)\b/i.test(s),
  },
  {
    id: "middot-run",
    pass: "visible",
    why: "more than one middle dot on a line; the second one is decoration, not punctuation",
    test: (s) => (s.match(/·/g) || []).length > 1,
  },
  {
    id: "codename",
    pass: "visible",
    codenameOnly: true,
    why: "the internal codename of the OTHER product, in copy a teacher or student reads",
    test: (s) => /\bMeera\b/.test(s),
  },
  {
    id: "rooms-vocabulary",
    pass: "visible",
    roomsVocabOnly: true,
    why:
      'Rooms vocabulary (the Rooms plan\'s binding rule): "not clone, in front of anyone." ' +
      'A creator sees "your AI"; a follower sees "<Name> AI". Never clone, replica, model, ' +
      "fine-tune, train/training, weights, embedding, LoRA, or genome (say \"your voice\") " +
      "in ANY language this product ships copy in - WS-R24 adds the Hindi equivalents for " +
      "the Devanagari scope (क्लोन/मॉडल/प्रतिकृति) rather than leaving the ban English-only.",
    test: (s) =>
      /\bclon(?:e[sd]?|ing)\b/i.test(s) ||
      /\breplica[s]?\b/i.test(s) ||
      /\bfine[- ]?tun(?:e[sd]?|ing)\b/i.test(s) ||
      /\btrain(?:ed|ing|s)?\b/i.test(s) ||
      /\bmodel(?:s|ing|ed)?\b/i.test(s) ||
      /\bweights?\b/i.test(s) ||
      /\bembedding[s]?\b/i.test(s) ||
      /\bLoRA\b/i.test(s) ||
      /\bgenome[s]?\b/i.test(s) ||
      // WS-R24, Hindi (Devanagari): क्लोन "clone", मॉडल "model", प्रतिकृति
      // "replica". No word boundaries here - Devanagari is not covered by
      // `\b` the way ASCII is (`\b` is defined over `\w`, which does not
      // include the Devanagari block), so these match the bare substring,
      // which is safe for the same reason the English list is safe: none of
      // the three is a legitimate substring of an unrelated Hindi word this
      // product's own copy would ever use.
      /क्लोन/.test(s) ||
      /मॉडल/.test(s) ||
      /प्रतिकृति/.test(s),
  },
];

/* ═══ 3. EXTRACTION ═════════════════════════════════════════════════════════ */

/** Blank a span to spaces, preserving newlines so line numbers survive. */
const blank = (m) => m.replace(/[^\n]/g, " ");

/**
 * Blank comments in JS/TS/TSX source, tracking string and template state so a
 * `//` inside a URL literal is not treated as a comment and an apostrophe
 * inside a comment does not open a string. Regex literals are not tracked; the
 * only cost of that is a regex containing `//` or `/*`, which does not occur
 * here and would over-blank rather than under-blank if it did.
 */
function stripJsComments(src) {
  let out = "";
  let i = 0;
  let mode = "code"; // code | line | block | sq | dq | tpl
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      out += c; i++; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += "\n"; } else out += " ";
      i++; continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") { mode = "code"; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " "; i++; continue;
    }
    // inside a string of some kind
    if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
    if ((mode === "sq" || mode === "dq") && c === "\n") mode = "code"; // unterminated; recover
    out += c; i++; continue;
  }
  return out;
}

/**
 * Every string literal in comment-stripped JS/TS source, with the ~72
 * characters of code that preceded it. The preceding context is how a literal
 * is classified: it is what distinguishes `label="Continue"` from
 * `import x from "./continue"`.
 */
function jsLiterals(src) {
  const out = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      const startLine = line;
      const before = src.slice(Math.max(0, i - 72), i);
      let j = i + 1;
      let text = "";
      while (j < src.length) {
        if (src[j] === "\\") { text += src[j + 1] ?? ""; j += 2; continue; }
        if (src[j] === quote) break;
        if (src[j] === "\n") { line++; if (quote !== "`") break; }
        // a `${...}` hole in a template is not static copy; skip its contents
        if (quote === "`" && src[j] === "$" && src[j + 1] === "{") {
          let depth = 1; j += 2;
          while (j < src.length && depth > 0) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            else if (src[j] === "\n") line++;
            j++;
          }
          text += " ";
          continue;
        }
        text += src[j]; j++;
      }
      out.push({ text, line: startLine, before });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/** Names of props/keys whose string value is read by a human on a screen. */
const VISIBLE_KEY =
  /\b(?:label|title|placeholder|alt|heading|subheading|subtitle|caption|hint|help|helpText|description|summary|message|body|text|cta|note|blurb|prompt|confirmLabel|cancelLabel|actionLabel|emptyLabel|errorText|status|detail|explain|reason|children)$/i;
const ARIA_KEY = /\b(?:aria-label|aria-description|aria-valuetext|aria-placeholder|aria-roledescription)$/i;

function isVisibleLiteral(before, isCopyFile) {
  const tail = before.replace(/\s+$/, "");
  // imports/requires/module paths are never copy
  if (/(?:\bfrom|\bimport|\brequire\s*\(|\bURL\s*\()$/.test(tail)) return false;
  if (/(?:\bimport|\bexport)\b[^;]*$/.test(tail) && /\bfrom$/.test(tail)) return false;
  if (isCopyFile) return true;
  // `label="..."` / `aria-label={"..."}` / `label: "..."` / `label = "..."`
  const m = tail.match(/([A-Za-z_$][\w$-]*)\s*[:=]\s*\{?\s*$/);
  if (m) return VISIBLE_KEY.test(m[1]) || ARIA_KEY.test(m[1]);
  return false;
}

/** A run of letters in ANY script this product ships copy in, not only ASCII
 *  - `[A-Za-z]` alone missed every text node written purely in Devanagari
 *  (WS-R24: a Hindi sentence with no embedded Latin word, e.g. no "AI"/name
 *  placeholder, has zero `A-Za-z` characters and was previously invisible to
 *  this extractor entirely, so a banned word inside one could never trip the
 *  gate). `ऀ-ॿ` is the Devanagari block. */
const LETTER_RUN = /[A-Za-zऀ-ॿ]/;

/** JSX/HTML text nodes: what sits between a `>` and the next `<`. */
function textNodes(src, offsetLines = null) {
  // blank string literals first so a `>` inside a string cannot open a node
  const noStrings = src.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (m) => blank(m));
  const out = [];
  let line = 1;
  const re = />([^<>{}]*)</g;
  let last = 0;
  let m;
  while ((m = re.exec(noStrings))) {
    for (let k = last; k < m.index; k++) if (noStrings[k] === "\n") line++;
    last = m.index;
    // recover the REAL text from src (strings were blanked in the copy)
    const real = src.slice(m.index + 1, m.index + 1 + m[1].length);
    const t = real.replace(/\s+/g, " ").trim();
    if (t && LETTER_RUN.test(t)) out.push({ text: t, line });
  }
  return out;
}

/** HTML attributes whose value renders or is announced. */
const HTML_VISIBLE_ATTR =
  /\b(?:title|alt|placeholder|aria-label|aria-description|aria-roledescription|value|content)\s*=\s*"([^"]*)"/gi;

/* ═══ 4. THE SCAN ═══════════════════════════════════════════════════════════ */

const EXEMPT = /(?:copy-ok|emdash-ok)\s*:/;

/**
 * Scan one file's source. Returns offences as
 * `{ rule, line, text, why }`. Exported shape is what selfTest() asserts on.
 */
export function scanSource(rel, src, opts = {}) {
  const { rules = "full", codename = false, roomsVocab = false } = opts;
  const isHtml = /\.html?$/.test(rel);
  const offences = [];
  const rawLines = src.split("\n");
  const exempt = (ln) => EXEMPT.test(rawLines[ln - 1] ?? "");

  /* ── PASS 1: the dash, broadly, on comment-stripped lines ── */
  const stripped = isHtml
    ? src.replace(/<!--[\s\S]*?-->/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(?<!:)\/\/.*$/gm, blank)
    : stripJsComments(src);
  stripped.split("\n").forEach((l, i) => {
    if (exempt(i + 1)) return;
    if (DASH.test(l)) {
      offences.push({ rule: "dash", line: i + 1, text: l.trim().slice(0, 100), why: RULES[0].why });
    }
  });

  if (rules !== "full") return offences;

  /* ── PASS 2: the word and pattern bans, on proven-visible strings ── */
  const visible = [];
  if (isHtml) {
    // drop <style> and <script> bodies: CSS selectors and JS identifiers are
    // not copy, and a `>` in a CSS child selector would forge a text node.
    const body = stripped
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, blank)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, blank);
    visible.push(...textNodes(body));
    let line = 1;
    let last = 0;
    let m;
    HTML_VISIBLE_ATTR.lastIndex = 0;
    while ((m = HTML_VISIBLE_ATTR.exec(body))) {
      for (let k = last; k < m.index; k++) if (body[k] === "\n") line++;
      last = m.index;
      if (m[1].trim()) visible.push({ text: m[1], line });
    }
  } else {
    const isCopyFile = COPY_FILES.test(rel);
    for (const lit of jsLiterals(stripped)) {
      if (!lit.text.trim()) continue;
      if (isVisibleLiteral(lit.before, isCopyFile)) visible.push({ text: lit.text, line: lit.line });
    }
    visible.push(...textNodes(stripped));
  }

  for (const v of visible) {
    if (exempt(v.line)) continue;
    for (const r of RULES) {
      if (r.pass !== "visible") continue;
      if (r.codenameOnly && !codename) continue;
      if (r.roomsVocabOnly) {
        if (!roomsVocab) continue;
        if (isRoomsVocabAllowed(rel, v.text)) continue;
      }
      if (r.test(v.text)) {
        offences.push({ rule: r.id, line: v.line, text: v.text.slice(0, 100), why: r.why });
      }
    }
  }
  return offences;
}

/* ═══ 5. THE NEGATIVE CONTROL ═══════════════════════════════════════════════
 *
 * Runs before the tree does. Each fixture names the rule it must trip; if any
 * of them stops tripping, this file exits non-zero and says which rule went
 * quiet, rather than sailing past a tree it is no longer checking.
 */
const FIXTURES = [
  ["dash", "bad.tsx", 'const a = <p>Recorded — nothing owed.</p>;'],
  ["dash", "bad.html", "<p>Recorded &mdash; nothing owed.</p>"],
  // WS-R24: the same rule bites Devanagari copy exactly as it bites English -
  // the dash pass never looked at script, but this proves it against a real
  // Hindi sentence rather than only asserting that from the rule's shape.
  ["dash", "bad.tsx", 'const dashHi = { label: "यह रुका — फिर शुरू होगा।" };'],
  ["version-stamp", "bad.tsx", 'const x = <span>Studio v1.4.2</span>;'],
  ["version-stamp", "bad.html", "<p>Build 0048</p>"],
  ["section-number", "bad.html", "<p>01 / INDEX</p>"],
  ["scroll-cue", "bad.html", "<p>Scroll</p>"],
  ["locale-strip", "bad.html", "<p>Bengaluru 31°C</p>"],
  ["poetic-filler", "bad.html", "<p>Quietly trusted by teachers</p>"],
  ["filler-verb", "bad.tsx", 'const b = <p>Elevate your seamless workflow</p>;'],
  ["placeholder-identity", "bad.html", "<p>John Doe</p>"],
  ["middot-run", "bad.html", "<p>One · two · three</p>"],
  ["codename", "bad.html", "<p>Sign in to Meera</p>"],
  ["version-stamp", "bad.tsx", 'const c = { label: "BETA" };'],
  ["codename", "bad.tsx", 'const d = <input aria-label="Meera password" />;'],
  // WS-R10, the Rooms vocabulary rule: "not clone, in front of anyone."
  ["rooms-vocabulary", "bad.tsx", 'const g = <p>Your AI clone learns from you.</p>;'],
  ["rooms-vocabulary", "bad.html", "<p>Train your replica on your archive.</p>"],
  ["rooms-vocabulary", "bad.tsx", 'const h = { label: "Fine-tune your voice model" };'],
  // WS-R24: the same rule in Hindi. Each of these must fail exactly the way
  // its English counterpart above does.
  ["rooms-vocabulary", "bad.tsx", 'const i = <p>यह आपका AI क्लोन है।</p>;'],
  ["rooms-vocabulary", "bad.html", "<p>अपने वॉइस मॉडल को ट्रेन करें।</p>"],
  ["rooms-vocabulary", "bad.tsx", 'const j = { label: "अपनी प्रतिकृति बनाएं" };'],
];

/* Must produce NOTHING. Every line here is a shape the gate must not punish:
 * house prose in comments, technical identifiers, module paths, one middot,
 * and (WS-R10) the actual replacement phrase the Rooms vocabulary rule exists
 * to allow through clean. */
const CLEAN = `
// A comment — with an em-dash — is house prose and is exempt.
/* So is a block comment — see DESIGN-LAW.md §1. */
import { beta } from "./elevate/v1.2.3";
const buildId = "build 0048";
const cls = "panel · row";
const el = <p>Recorded, nothing owed. Vyakti · teacher studio</p>;
const f = { key: "seamless-migration", label: "Add one recording" };
const g = <p>Meet your AI. Give it your material and it learns.</p>;
const h = { label: "आप {name} AI से बात कर रहे हैं। यह {name} नहीं है।" };
`;

function selfTest() {
  const dead = [];
  for (const [rule, name, src] of FIXTURES) {
    const hits = scanSource(name, src, { rules: "full", codename: true, roomsVocab: true }).map((o) => o.rule);
    if (!hits.includes(rule)) dead.push(`${rule} did not fire on: ${src.trim()}`);
  }
  const noise = scanSource("clean.tsx", CLEAN, { rules: "full", codename: true, roomsVocab: true });
  for (const o of noise) dead.push(`false positive [${o.rule}] on clean fixture line ${o.line}: ${o.text}`);
  return dead;
}

/* ═══ 6. RUN ════════════════════════════════════════════════════════════════ */

function walk(dir, acc = []) {
  for (const e of readdirSync(ROOT + dir)) {
    const rel = dir + e;
    if (statSync(ROOT + rel).isDirectory()) { walk(rel + "/", acc); continue; }
    if (!/\.(tsx?|html?)$/.test(e) || SKIP_FILE.test(e)) continue;
    acc.push(rel);
  }
  return acc;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dead = selfTest();
  if (dead.length) {
    console.log(`FAIL  check-copy self-test: the gate is not biting (${dead.length}):`);
    for (const d of dead) console.log("  " + d);
    process.exit(1);
  }

  const offences = [];
  const waived = [];
  const waiverClean = [];
  for (const scope of SCOPES) {
    for (const rel of walk(scope.dir)) {
      const src = readFileSync(ROOT + rel, "utf8");
      const codename = scope.codename || CODENAME_FILES.test(rel);
      const roomsVocab = scope.roomsVocab || ROOMS_VOCAB_FILES.test(rel);
      const found = scanSource(rel, src, { rules: scope.rules, codename, roomsVocab }).map((o) => ({ ...o, file: rel }));
      if (WAIVED.has(rel)) {
        if (found.length === 0) waiverClean.push(rel);
        waived.push(...found);
      } else {
        offences.push(...found);
      }
    }
  }
  for (const extra of EXTRA_FILES) {
    const rel = extra.file;
    const src = readFileSync(ROOT + rel, "utf8");
    const codename = extra.codename || CODENAME_FILES.test(rel);
    const roomsVocab = extra.roomsVocab || ROOMS_VOCAB_FILES.test(rel);
    const found = scanSource(rel, src, { rules: extra.rules, codename, roomsVocab }).map((o) => ({ ...o, file: rel }));
    offences.push(...found);
  }

  if (waived.length) {
    console.log(`  --  waived (printed, not failing): ${waived.length}`);
    for (const o of waived) console.log(`      ${o.file}:${o.line}  [${o.rule}]  ${o.text}`);
    for (const [f, why] of WAIVED) console.log(`      waiver: ${f} ${why}`);
  }
  if (waiverClean.length) {
    console.log("FAIL  a waived file is now clean; delete its entry from WAIVED in this file:");
    for (const f of waiverClean) console.log("  " + f);
    process.exit(1);
  }

  if (offences.length) {
    const byRule = new Map();
    for (const o of offences) byRule.set(o.rule, (byRule.get(o.rule) ?? 0) + 1);
    console.log(`FAIL  copy law (DESIGN-LAW.md §1): ${offences.length} in user-visible strings`);
    console.log("      " + [...byRule].map(([r, n]) => `${r}:${n}`).join("  "));
    for (const o of offences) {
      console.log(`  ${o.file}:${o.line}  [${o.rule}]  ${o.text}`);
      console.log(`      ${o.why}`);
    }
    process.exit(1);
  }
  console.log(`  ok  copy law: ${SCOPES.length} scopes clean, ${FIXTURES.length} negative controls bit`);
}
