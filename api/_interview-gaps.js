// The interview gap model — WS-R5.
//
// "An archive is a monologue; the product is a conversation." The Mirror Call
// today is a CALIBRATION call: the owner talks, the platform mines phrase
// habits out of what they happened to say, and the owner taps the chips they
// agree with. It never decides what to ASK. This file is the half that does.
//
// ═════════════════════════════════════════════════════════════════════════
// WHAT THIS FILE IS, PRECISELY
// ═════════════════════════════════════════════════════════════════════════
//
// A PURE function over already-read rows. No database handle, no clock it did
// not get passed, no network, no model call. `api/mirror-call.js` reads the
// rows; this decides what is missing from them. That split is the same one
// `api/_clonechat.js` established over `api/clone-chat.js` and it exists so a
// fake database in `evals/interview/run.mjs` can reach every decision.
//
// It produces GAPS, ranked. A gap is a question the platform does not have an
// answer to, with the evidence count that says why, and a question SHAPE.
//
// ═════════════════════════════════════════════════════════════════════════
// A SHAPE, NEVER A QUESTION
// ═════════════════════════════════════════════════════════════════════════
//
// `context/rejected.md#recited-prompt`, measured twice on this codebase: her
// own example quotes acted as a phrase bank and were recited on 4 of 5 turns;
// taste written as polished English sentences was read out verbatim twice,
// eight turns apart. The law is "write shapes, never lines she could say".
//
// A ready-made interview question is the single most recitable object this
// feature could produce — it is literally a line, written for the clone, that
// the clone is being handed immediately before it speaks. So no question text
// exists in this file. A gap carries `shape`: an `about` and a list of
// telegraphic `notes`, each one of which is asserted by
// `evals/interview/run.mjs` to pass `src/engine/shapelint.ts`'s own line lint
// (word cap, not sentence-shaped, not first-person-line-initial). The QUESTION
// is rendered by the engine lane at call time, out of the owner's own sheet,
// through `gatedReply` — `mirror-call-reply-is-the-one-door`.
//
// The one place the owner's own words ride into the ask is a contradiction's
// two cited values, and they ride as FRAGMENTS: `citationFragment` caps them at
// nine words and 80 characters and strips terminal punctuation, so the block a
// model reads still contains no sentence. That cap is the whole mitigation and
// it is stated rather than implied — a contradiction question that cannot name
// what it is contradicting is not a question.
//
// ═════════════════════════════════════════════════════════════════════════
// A DETECTOR THAT COULD NOT RUN SAYS SO
// ═════════════════════════════════════════════════════════════════════════
//
// The contradiction detector needs `validityOverlaps` from
// `src/engine/validity.ts`, reached through the engine bundle exactly as
// `api/consolidate.js` reaches it, and this module will not re-implement it:
// a second definition of "do these two intervals overlap" is the mirrored-logic
// mistake that file's header already names once.
//
// So the predicate is INJECTED. When it is absent the result carries
// `detectors.contradiction === false` and NO contradiction gaps, and those are
// different facts from "there are no contradictions" — which is the shape
// `plausible-return-hides-a-dead-pipeline` warns about. Every caller that
// renders a gap list renders `detectors` beside it.
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";

/** The four gap kinds, closed. There is deliberately no "other": a gap nobody
 *  can name the source of is a question nobody can justify asking. */
export const INTERVIEW_GAP_KINDS = Object.freeze([
  "contradiction",
  "sheet_field",
  "thin_topic",
  "readiness",
]);

/** How many gaps an interview opens with. The spec's own number, and the reason
 *  it is small is `mirror-learning.md` §3 (Cakmak & Thomaz, HRI 2012): feature
 *  queries are the preferred kind of question and people do not enjoy a
 *  constant stream of them. Five in twenty minutes is four minutes a question. */
export const INTERVIEW_OPENING_GAPS = 5;

/** The interview's own length, in ms. It stops ITSELF at this point rather than
 *  waiting to be ended, because a session that runs until the owner gets bored
 *  has no bounded claim to make about what it collected. */
export const INTERVIEW_LENGTH_MS = 20 * 60 * 1000;

/** Claims (plus spans plus items) at or above this on a topic and the topic is
 *  not thin. A STARTING POINT, not a measurement: nobody has run an
 *  answer-quality study against this number, and `context/measurements.md`
 *  says so rather than this comment implying otherwise. */
export const THIN_TOPIC_FLOOR = 3;

/** Evidence at or above this on a sheet field and the field is not a gap. Two
 *  rather than one because one piece of evidence for "how they handle not
 *  knowing" is an anecdote, and the whole point of the interview is that the
 *  archive is thin exactly here. */
export const SHEET_FIELD_FLOOR = 2;

/**
 * The longest a cited value may be before it stops being a fragment and starts
 * being a line. Both caps bind; whichever bites first wins.
 *
 * Nine, not fourteen, and the three words of difference are the whole margin:
 * `shapelint.ts`'s own line cap is 14 words and a cited value is rendered as
 * `- later (march 2026): <value>`, which spends three words before the value
 * starts. A twelve-word cap here would produce a fifteen-word line and the
 * shape lint would be failing on the one line this file exists to keep clean.
 */
export const CITATION_MAX_WORDS = 9;
export const CITATION_MAX_CHARS = 80;

/**
 * Every authored note and `about` is capped here too, for the same arithmetic:
 * `- about: ` spends two words, so twelve leaves the line at the lint's cap
 * rather than one past it.
 *
 * THESE ARE LAYERED, NOT REDUNDANT, and the layering was measured rather than
 * assumed: raising either pair alone leaves `evals/interview/run.mjs`'s
 * shapelint assertion green, because a contradiction note is a citation INSIDE
 * an authored note and both caps apply to it. Only removing all four produces a
 * line the lint rejects. Two independent caps for a property whose failure is a
 * recited line is the house rule, and the eval's mutation record is why this
 * comment can say so.
 */
export const NOTE_MAX_WORDS = 12;
export const NOTE_MAX_CHARS = 90;

/**
 * The sheet fields an interview can actually fill, and where their evidence
 * would already be if the archive had it.
 *
 * These four are the brief's own list — how they comfort, how they handle not
 * knowing, their boundaries, what they refuse — and they are the four that a
 * monologue almost never contains: an uploaded lecture is a person explaining,
 * not a person being unsure or saying no.
 *
 * `evidence` names (domain, key) pairs in `vy_replica_claim`. A null key means
 * the whole domain counts. `field` is the TeacherSheet field an answer would
 * eventually inform; NOTHING in this file writes it, and nothing downstream of
 * this file writes it either — an interview answer becomes a SOURCE, and a
 * source becomes a claim only through the ordinary mining and review lane.
 */
export const INTERVIEW_SHEET_FIELDS = Object.freeze([
  Object.freeze({
    field: "exComfort",
    topic: "comforting someone",
    why: "Nothing in what you gave us shows you comforting anyone. It is the first thing a person needs from you and the last thing a lecture contains.",
    about: "comforting someone who is struggling",
    notes: Object.freeze(["what you say first", "what you never say", "an example from last month"]),
    evidence: Object.freeze([["habit", "emotional_regulation"], ["relationship", "repair"]]),
  }),
  Object.freeze({
    field: "exDontKnow",
    topic: "not knowing",
    why: "We have not heard you be unsure. An AI that never says it does not know is the one people stop trusting first.",
    about: "being asked something you do not know",
    notes: Object.freeze(["how you say you are unsure", "what you do next", "whether you guess"]),
    evidence: Object.freeze([["habit", "disagreement"], ["delivery", "turn_shape"]]),
  }),
  Object.freeze({
    field: "boundaryParagraph",
    topic: "boundaries",
    why: "No boundary of yours is on record. Without one, your AI has to invent where you stop.",
    about: "where you stop with the people who follow you",
    notes: Object.freeze(["what you keep private", "how close is too close", "what you do when asked anyway"]),
    evidence: Object.freeze([["boundary", null]]),
  }),
  Object.freeze({
    field: "outOfScopePolicy",
    topic: "what you refuse",
    why: "We do not know what you would refuse to answer. Your AI will answer it instead.",
    about: "what you refuse to answer",
    notes: Object.freeze(["the subject you stay out of", "how you turn it down", "who you send them to"]),
    evidence: Object.freeze([["boundary", "refusal"], ["value", null]]),
  }),
]);

/** Readiness parts an interview can move, and what it would ask about. A part
 *  outside this map produces NO gap: an interview cannot fix a missing voice
 *  reference by asking a question, and a gap that pretends otherwise is a
 *  question that wastes one of the five. */
export const INTERVIEW_READINESS_PARTS = Object.freeze({
  mind: Object.freeze({
    topic: "how you think",
    about: "how you decide what to say",
    notes: Object.freeze(["what you check first", "what you refuse to guess at", "where you slow down"]),
  }),
  relation: Object.freeze({
    topic: "how you are with people",
    about: "how you are with someone new",
    notes: Object.freeze(["what you ask them first", "how formal you stay", "when that changes"]),
  }),
  memory: Object.freeze({
    topic: "what you carry",
    about: "what you remember about the people you talk to",
    notes: Object.freeze(["what you write down", "what you never forget", "what you let go"]),
  }),
  safety: Object.freeze({
    topic: "where you stop",
    about: "the question you would not answer",
    notes: Object.freeze(["the subject you avoid", "what you say instead", "who you hand it to"]),
  }),
});

// ─────────────────────────────────────────────────────────────────────────
// text handling
// ─────────────────────────────────────────────────────────────────────────

/** Control characters and prompt-fence tags stripped, whitespace collapsed.
 *  The same fence `api/_mirrorcall.js::mirrorClean` puts on transcript text and
 *  for the same reason: everything in this module ends up adjacent to a prompt. */
export function gapClean(value, max = 400) {
  return Array.from(String(value ?? ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** An authored note, capped in words AND characters so the rendered line stays
 *  inside `shapelint`'s cap. Terminal punctuation is stripped for
 *  `citationFragment`'s reason: a note that ends in a full stop is a sentence,
 *  and a sentence in a prompt gets recited. */
export function noteClean(value) {
  const words = gapClean(value, NOTE_MAX_CHARS * 2).split(" ").filter(Boolean);
  let text = words.slice(0, NOTE_MAX_WORDS).join(" ").slice(0, NOTE_MAX_CHARS).trim();
  while (text && /[.!?]$/.test(text)) text = text.slice(0, -1).trim();
  return text;
}

export function gapNormalize(value) {
  return gapClean(value, 400)
    .toLocaleLowerCase("en-IN")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The owner's own words, reduced to a FRAGMENT.
 *
 * Two caps and a strip, all three load-bearing. The word cap and the character
 * cap keep the value under `shapelint`'s own line rules; the terminal-
 * punctuation strip is what stops a stored claim body that happens to be a
 * well-formed sentence from becoming a line in a prompt. `recited-prompt` is
 * measured, not theoretical: this is the only place in this file where the
 * owner's own text reaches the model, and it reaches it as a fragment.
 */
export function citationFragment(value) {
  const words = gapClean(value, CITATION_MAX_CHARS * 2).split(" ").filter(Boolean);
  let text = words.slice(0, CITATION_MAX_WORDS).join(" ").slice(0, CITATION_MAX_CHARS).trim();
  // Strip terminal punctuation repeatedly: "really?!" is two.
  while (text && /[.!?]$/.test(text)) text = text.slice(0, -1).trim();
  // Any interior terminal punctuation means two sentences got joined. Keep the
  // first clause rather than shipping a two-sentence fragment.
  const cut = text.search(/[.!?]/);
  return (cut === -1 ? text : text.slice(0, cut)).trim();
}

// ─────────────────────────────────────────────────────────────────────────
// input normalisation
// ─────────────────────────────────────────────────────────────────────────

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** A claim the owner ACCEPTED and has not superseded. Says nothing about event
 *  time. Restated here rather than imported from `api/_person-model.js` so this
 *  module stays a leaf over plain rows. */
function acceptedClaims(claims) {
  return asArray(claims).filter((row) => {
    if (!row) return false;
    if (row.decision !== undefined && row.decision !== null && row.decision !== "accepted") return false;
    if (row.decision === undefined && row.status && row.status !== "approved") return false;
    return row.status !== "superseded" && row.status !== "rejected";
  });
}

/**
 * An accepted claim that is still CURRENT — `api/_person-model.js`'s predicate.
 *
 * ── WHY THE CONTRADICTION DETECTOR DOES NOT USE THIS ─────────────────────
 * A claim whose event-time horizon has passed is not current evidence, so the
 * coverage and sheet-field detectors must not count it. But a contradiction
 * across time is BY CONSTRUCTION half made of exactly such a claim: "in March
 * you said X" is a statement about a claim whose March horizon is behind us.
 * Filtering the expired half out here would make the contradiction detector
 * structurally incapable of ever finding one, and it would do it silently,
 * returning a perfectly plausible empty list.
 *
 * So this predicate is applied to three detectors and deliberately not to the
 * fourth, and that split is stated rather than left to be rediscovered.
 */
function currentClaims(claims, now) {
  return acceptedClaims(claims).filter((row) => {
    const validTo = toMs(row.t_valid_to);
    return validTo === null || validTo > now;
  });
}

function claimValidity(row) {
  return { validFrom: toMs(row?.t_valid_from), validTo: toMs(row?.t_valid_to) };
}

/** Human-readable "when", for a contradiction note. Month and year only: a
 *  precise timestamp on a claim the person made in conversation is a precision
 *  we do not have, and "on 3 March at 14:22 you said" is a thing no person
 *  would recognise as their own memory. */
function whenLabel(row) {
  const ms = toMs(row?.t_valid_from) ?? toMs(row?.updated_at) ?? toMs(row?.created_at);
  if (ms === null) return "";
  const date = new Date(ms);
  const month = ["january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"][date.getUTCMonth()];
  return `${month} ${date.getUTCFullYear()}`;
}

// ─────────────────────────────────────────────────────────────────────────
// the four detectors
// ─────────────────────────────────────────────────────────────────────────

/**
 * (c) CONTRADICTIONS ACROSS TIME.
 *
 * Two accepted claims on the SAME SUBJECT (`domain:key`) with different bodies
 * whose event-time intervals do NOT overlap. The disjointness is what makes it
 * a question rather than a supersession: `src/engine/validity.ts` exists
 * because two rows named `exam`, one in November and one in May, are two exams
 * and not a contradiction — and the same argument inverted says that two rows
 * on one subject with disjoint horizons and different bodies are a CHANGE the
 * platform cannot date itself. So it asks.
 *
 * `overlaps` is injected. Without it there is no detector and the caller is
 * told so; see the file header.
 */
export function findContradictions(claims, overlaps) {
  if (typeof overlaps !== "function") return [];
  const bySubject = new Map();
  for (const row of claims) {
    const subject = `${row.domain}:${row.key}`;
    if (!bySubject.has(subject)) bySubject.set(subject, []);
    bySubject.get(subject).push(row);
  }
  const found = [];
  for (const [subject, rows] of bySubject) {
    if (rows.length < 2) continue;
    // Oldest first, deterministically. `claim_id` is a bigint identity, so it
    // breaks a same-timestamp tie the same way on every run — an interview that
    // asked about a different pair on a re-open would be an interview nobody
    // could reproduce.
    const ordered = rows.slice().sort((left, right) =>
      (toMs(left.t_valid_from) ?? toMs(left.created_at) ?? 0) - (toMs(right.t_valid_from) ?? toMs(right.created_at) ?? 0) ||
      String(left.claim_id).localeCompare(String(right.claim_id)));
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const earlier = ordered[i];
        const later = ordered[j];
        if (gapNormalize(earlier.body) === gapNormalize(later.body)) continue;
        if (overlaps(claimValidity(earlier), claimValidity(later))) continue;
        found.push({ subject, earlier, later });
      }
    }
  }
  return found;
}

/**
 * (b) SHEET FIELDS WITH NO EVIDENCE.
 *
 * Evidence is counted from two independent places and they are added rather
 * than max-ed: an accepted claim in a mapped domain, and the sheet field itself
 * being non-empty. A filled field with no claim behind it counts ONE, which is
 * the honest number — somebody typed it and nothing in the archive corroborates
 * it.
 */
export function sheetFieldEvidence(sheet, claims) {
  const counts = new Map();
  for (const spec of INTERVIEW_SHEET_FIELDS) {
    let count = 0;
    for (const row of claims) {
      for (const [domain, key] of spec.evidence) {
        if (row.domain === domain && (key === null || row.key === key)) { count += 1; break; }
      }
    }
    const filled = gapClean(sheet && typeof sheet === "object" ? sheet[spec.field] : "", 400);
    counts.set(spec.field, count + (filled ? 1 : 0));
  }
  return counts;
}

/**
 * (a) TOPICS THE AUDIENCE WILL ASK ABOUT THAT THE MATERIAL COVERS THINLY.
 *
 * The topic universe is the owner's OWN declared strands plus the subjects
 * their accepted claims are already about. It is deliberately not a model's
 * guess at what an audience wants: a topic this platform invented and then
 * declared thin would be a gap in a list the owner never wrote.
 *
 * Coverage counts claims, transcript spans and context items that name the
 * topic. Three sources rather than one because a lecture uploaded as a video
 * and the same lecture mined into claims are the same coverage counted twice
 * only if you count rows, and neither alone is the whole archive.
 */
export function topicCoverage({ claims, transcriptSpans, contextItems, sheet }) {
  const topics = new Map();
  const add = (raw) => {
    const topic = gapNormalize(raw);
    if (!topic || topic.length < 3 || topic.length > 60) return;
    if (!topics.has(topic)) topics.set(topic, { topic, label: gapClean(raw, 60), count: 0, declared: false });
  };
  for (const strand of asArray(sheet?.subjectStrands)) add(strand);
  for (const topic of topics.values()) topic.declared = true;
  for (const row of claims) {
    if (!["biography", "event", "preference", "value", "boundary"].includes(row.domain)) continue;
    add(row.key);
  }
  const haystacks = [
    ...claims.map((row) => `${gapNormalize(row.key)} ${gapNormalize(row.body)}`),
    ...asArray(transcriptSpans).map((span) => `${gapNormalize(span?.topic)} ${gapNormalize(span?.title)}`),
    ...asArray(contextItems).map((item) => `${gapNormalize(item?.title)} ${gapNormalize(item?.source_name)}`),
  ];
  for (const entry of topics.values()) {
    const needle = ` ${entry.topic} `;
    for (const hay of haystacks) if (` ${hay} `.includes(needle)) entry.count += 1;
  }
  return [...topics.values()].sort((left, right) =>
    left.count - right.count || left.topic.localeCompare(right.topic));
}

/**
 * (d) THE READINESS SNAPSHOT'S WEAKEST PART.
 *
 * WS-R3 owns `vy_replica_readiness`. This function accepts its ROW and depends
 * on none of its code, because a build-time dependency between two workstreams
 * in flight is how one of them blocks the other. It therefore reads three
 * plausible shapes for "the parts" and, when it recognises NONE of them,
 * returns null rather than guessing — a readiness gap invented off an
 * unrecognised row would be a question asked for a reason that does not exist.
 */
export function weakestReadinessPart(readiness) {
  if (!readiness || typeof readiness !== "object") return null;
  const entries = [];
  const push = (key, score) => {
    const value = Number(score);
    if (!Number.isFinite(value)) return;
    const name = String(key || "").trim().toLowerCase();
    if (name) entries.push({ part: name, score: value });
  };
  const parts = readiness.parts ?? readiness.part_scores ?? readiness.scores ?? null;
  if (Array.isArray(parts)) {
    for (const row of parts) push(row?.part ?? row?.key ?? row?.name, row?.score ?? row?.value);
  } else if (parts && typeof parts === "object") {
    for (const [key, score] of Object.entries(parts)) push(key, score);
  }
  if (!entries.length) return null;
  entries.sort((left, right) => left.score - right.score || left.part.localeCompare(right.part));
  const weakest = entries[0];
  return INTERVIEW_READINESS_PARTS[weakest.part] ? weakest : null;
}

// ─────────────────────────────────────────────────────────────────────────
// the ranked list
// ─────────────────────────────────────────────────────────────────────────

/**
 * Scores, and why they are constants rather than weights.
 *
 * The ordering these produce is the product decision, so it is written as four
 * bands with room inside each rather than as a formula somebody has to solve to
 * predict. A contradiction outranks everything because it is the only gap kind
 * where the archive is actively WRONG rather than merely thin — the platform is
 * holding two answers and will pick one. Everything below it is degrees of
 * absence.
 */
const BAND = Object.freeze({
  contradiction: 100,
  sheet_field: 80,
  thin_topic: 60,
  readiness: 40,
});

function gapId(kind, topic, shapeHash) {
  return sha256Hex(canonicalJson({ kind, topic, shapeHash })).slice(0, 32);
}

function makeGap({ kind, topic, evidenceCount, why, about, notes, score, detail = {} }) {
  const shape = Object.freeze({
    kind,
    about: noteClean(about),
    notes: Object.freeze(asArray(notes).map(noteClean).filter(Boolean)),
  });
  const shapeHash = sha256Hex(canonicalJson(shape));
  return {
    gap_id: gapId(kind, topic, shapeHash),
    kind,
    topic: gapClean(topic, 120),
    evidence_count: Math.max(0, Number(evidenceCount) || 0),
    why: gapClean(why, 240),
    shape,
    shape_hash: shapeHash,
    score: Number(score.toFixed(3)),
    detail,
  };
}

/**
 * THE GAP MODEL.
 *
 * Everything is optional and every absence is REPORTED rather than defaulted.
 * `inputs_present` is on the result for the same reason `detectors` is: a gap
 * list built with no claims and a gap list built from an archive with nothing
 * missing look identical from the outside, and only one of them means the
 * platform is ready.
 *
 * @param input `{ claims, sheet, transcriptSpans, contextItems, contextTexts,
 *   personModel, readiness, answeredShapeHashes, now }`
 * @param deps `{ overlaps }` — `validityOverlaps` from the engine bundle.
 */
export function buildInterviewGaps(input = {}, deps = {}) {
  const now = Number.isFinite(input.now) ? Number(input.now) : Date.now();
  const overlaps = typeof deps.overlaps === "function" ? deps.overlaps : null;
  const rawClaims = asArray(input.claims);
  // Two sets, on purpose. `claims` is what is still true and is what coverage
  // and the sheet fields are counted from; `accepted` includes claims whose
  // horizon has passed, which is the half a contradiction across time is made
  // of. See `currentClaims` for why collapsing them would silently disable the
  // contradiction detector.
  const accepted = acceptedClaims(rawClaims);
  const claims = currentClaims(rawClaims, now);
  const sheet = input.sheet && typeof input.sheet === "object" ? input.sheet : null;
  const answered = new Set(asArray(input.answeredShapeHashes).map((hash) => String(hash || "")));
  const gaps = [];

  // (c) contradictions — first band.
  for (const found of findContradictions(accepted, overlaps)) {
    const earlier = citationFragment(found.earlier.body);
    const later = citationFragment(found.later.body);
    // A contradiction that cannot name both sides is not askable. Dropped
    // rather than asked with one half missing, which would be a question the
    // owner cannot answer and a wasted slot out of five.
    if (!earlier || !later) continue;
    const subject = gapClean(found.later.key || found.subject, 60);
    const earlierWhen = whenLabel(found.earlier);
    const laterWhen = whenLabel(found.later);
    gaps.push(makeGap({
      kind: "contradiction",
      topic: subject,
      evidenceCount: 2,
      why: `Two different answers on ${subject}, and we cannot tell which one is current.`,
      about: `${subject}, two answers`,
      notes: [
        earlierWhen ? `earlier (${earlierWhen}): ${earlier}` : `earlier: ${earlier}`,
        laterWhen ? `later (${laterWhen}): ${later}` : `later: ${later}`,
        "which one is current",
      ],
      score: BAND.contradiction,
      detail: {
        subject: found.subject,
        earlier_claim_id: String(found.earlier.claim_id ?? ""),
        later_claim_id: String(found.later.claim_id ?? ""),
      },
    }));
  }

  // (b) sheet fields with no evidence — second band, zero above some.
  const evidence = sheetFieldEvidence(sheet, claims);
  for (const spec of INTERVIEW_SHEET_FIELDS) {
    const count = evidence.get(spec.field) ?? 0;
    if (count >= SHEET_FIELD_FLOOR) continue;
    gaps.push(makeGap({
      kind: "sheet_field",
      topic: spec.topic,
      evidenceCount: count,
      why: spec.why,
      about: spec.about,
      notes: spec.notes,
      // Zero evidence outranks some, always: the subtraction can never reach
      // the band below because `count` is capped by SHEET_FIELD_FLOOR above.
      score: BAND.sheet_field - count * 8,
      detail: { field: spec.field },
    }));
  }

  // (a) topics covered thinly — third band, thinner above less thin.
  const coverage = topicCoverage({
    claims,
    transcriptSpans: input.transcriptSpans,
    contextItems: input.contextItems,
    sheet,
  });
  for (const entry of coverage) {
    if (entry.count >= THIN_TOPIC_FLOOR) continue;
    gaps.push(makeGap({
      kind: "thin_topic",
      topic: entry.label || entry.topic,
      evidenceCount: entry.count,
      why: entry.count === 0
        ? `People will ask you about ${entry.label || entry.topic} and we have nothing from you on it.`
        : `We have ${entry.count} thing${entry.count === 1 ? "" : "s"} from you on ${entry.label || entry.topic}, which is not enough to answer from.`,
      about: `${entry.label || entry.topic}, in your own words`,
      notes: ["how you explain it", "the mistake people make", "what you say when they are stuck"],
      score: BAND.thin_topic - entry.count * 6,
      detail: { declared: Boolean(entry.declared), coverage: entry.count },
    }));
  }

  // (d) the readiness snapshot's weakest part — fourth band, at most one.
  //
  // Computed ONCE and reused for `detectors.readiness` below. A second call
  // there would be a second chance for the two answers to disagree, and
  // "the detector ran" disagreeing with "the detector produced a gap" is the
  // exact confusion `detectors` exists to remove.
  const weakest = weakestReadinessPart(input.readiness);
  if (weakest) {
    const spec = INTERVIEW_READINESS_PARTS[weakest.part];
    gaps.push(makeGap({
      kind: "readiness",
      topic: spec.topic,
      evidenceCount: 0,
      why: `Readiness is weakest on ${spec.topic}. This is the part an interview can move.`,
      about: spec.about,
      notes: spec.notes,
      score: BAND.readiness,
      detail: { part: weakest.part, part_score: weakest.score },
    }));
  }

  // Already answered in an earlier interview: not asked again. The hash is over
  // the SHAPE, so a re-derived identical gap is recognised and a gap whose
  // shape moved is a new question, which is the behaviour we want in both
  // directions.
  const open = gaps.filter((gap) => !answered.has(gap.shape_hash));
  open.sort((left, right) =>
    right.score - left.score ||
    left.evidence_count - right.evidence_count ||
    left.gap_id.localeCompare(right.gap_id));
  for (let i = 0; i < open.length; i += 1) open[i].rank = i + 1;

  return {
    gaps: open,
    opening: open.slice(0, INTERVIEW_OPENING_GAPS),
    skipped_answered: gaps.length - open.length,
    // Which detectors could run at all. `false` is NOT "found nothing" — it is
    // "this detector was not available", and the two are different facts about
    // the same empty list. The readiness detector is `false` both when no
    // snapshot was supplied and when one was supplied in a shape this module
    // does not recognise, because in both cases the absence of a readiness gap
    // says nothing about readiness.
    detectors: {
      contradiction: Boolean(overlaps),
      sheet_field: true,
      thin_topic: true,
      readiness: weakest !== null,
    },
    // What this list was built from. Rendered beside it, always.
    inputs_present: {
      claims: rawClaims.length,
      accepted_claims: accepted.length,
      current_claims: claims.length,
      sheet: Boolean(sheet),
      transcript_spans: asArray(input.transcriptSpans).length,
      context_items: asArray(input.contextItems).length,
      context_texts: asArray(input.contextTexts).length,
      person_model: Boolean(input.personModel),
      readiness: Boolean(input.readiness),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// the ask block
// ─────────────────────────────────────────────────────────────────────────

/** The header line. Not a question and not a line the clone could read out —
 *  it is an instruction about the SHAPE of the turn, and it ends in a colon so
 *  it is not sentence-shaped under shapelint's own rule. */
export const INTERVIEW_ASK_HEADER = "ASK THEM THIS, in your own words, one short question:";

/** The closing note. Same rules. */
export const INTERVIEW_ASK_FOOTER = "do not read these notes out";

/**
 * Render one gap as the note block the engine lane reads.
 *
 * TELEGRAPHIC BY CONSTRUCTION. Every line but the header is `- ` plus a note
 * that came out of `makeGap`, and `evals/interview/run.mjs` runs
 * `src/engine/shapelint.ts`'s own `lintLine` over every line of every block
 * this function can produce. That is the mechanised half of `recited-prompt`;
 * the unmechanised half is that no line here is a question, so there is nothing
 * for a model to lift verbatim even if it wanted to.
 */
export function renderInterviewAsk(gap) {
  if (!gap || !gap.shape) return "";
  const about = gapClean(gap.shape.about, 90);
  if (!about) return "";
  const lines = [
    INTERVIEW_ASK_HEADER,
    `- about: ${about}`,
    ...asArray(gap.shape.notes).map((note) => `- ${gapClean(note, 90)}`).filter((line) => line !== "- "),
    `- ${INTERVIEW_ASK_FOOTER}`,
  ];
  return lines.join("\n");
}
