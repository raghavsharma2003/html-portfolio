// The synthetic question set — WS-R4, item (d).
//
// Before launch there are no follower conversations, so the review queue would
// open empty on the one screen whose whole promise is "thirty seconds a card".
// This module generates the questions the audience will actually ask FROM THE
// REPLICA'S OWN SOURCES, behind the same provider seam
// `api/_claim-extraction/registry.js` uses.
//
// ── the seam, and why the factory throws ─────────────────────────────────
// `createProductionQuestionGenerator` REFUSES when the deployment is not
// configured rather than returning a generator that yields nothing.
// `plausible-return-hides-a-dead-pipeline`: an empty question list from an
// unconfigured deployment is byte-identical to a replica with nothing to ask
// about, and the studio would report "nothing to review" for a platform
// failure. The handler turns that refusal into an honest "waiting on us" line.
//
// ── the question is a QUESTION, and the answer must be cited ─────────────
// The generator may only return a question plus the source ids the question is
// about. IT DOES NOT WRITE THE ANSWER. The answer on a card is what THIS
// replica said, produced by the ordinary reply path, so the owner grades their
// own AI rather than grading a second model's guess at it. A generated answer
// on a card would be `unclaimed-text-is-not-evidence-of-how-you-write` with a
// button under it.
//
// ── nothing sentence-shaped goes near a persona ──────────────────────────
// The output of this module reaches a studio screen and a database column. It
// never reaches a compiled prompt (`recited-prompt`).

export const REVIEW_QUESTION_PROMPT = "vyakti.review-question.v1";

export const REVIEW_QUESTION_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "source_ids"],
        properties: {
          question: { type: "string", minLength: 8, maxLength: 300 },
          source_ids: { type: "array", maxItems: 4, items: { type: "string" } },
        },
      },
    },
  },
});

export class QuestionGeneratorError extends Error {
  constructor(code, { retryable = false, status = 0 } = {}) {
    super(code);
    this.name = "QuestionGeneratorError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

const error = (code, options) => new QuestionGeneratorError(code, options);

/**
 * The messages, as a pure function of the excerpts, so the eval can assert what
 * is sent without a network.
 *
 * Excerpts are the replica's own material, already PII-scrubbed upstream and
 * bounded here as well: a generator prompt that grows with the corpus is a
 * silent-truncation defect waiting for a long lecture.
 */
export function questionMessages(excerpts, count = 12) {
  const bounded = [];
  let characters = 0;
  for (const excerpt of Array.isArray(excerpts) ? excerpts : []) {
    const text = String(excerpt?.text || "").slice(0, 1_200);
    if (!text) continue;
    if (characters + text.length > 18_000 || bounded.length >= 20) break;
    bounded.push({ source_id: String(excerpt?.source_id || ""), text });
    characters += text.length;
  }
  if (!bounded.length) throw error("review_question_input_empty");
  return [
    {
      role: "system",
      content: [
        "You read excerpts from one person's own recorded material.",
        "Return the questions that the people who follow this person are most likely to ask them.",
        "Each question must be answerable from the excerpts and must cite the source ids it came from.",
        "Ask what a real person would type. Do not answer the questions.",
        "Do not invent topics the excerpts do not cover.",
        `Return at most ${Math.max(1, Math.min(30, Number(count) || 12))} questions.`,
      ].join("\n"),
    },
    { role: "user", content: JSON.stringify({ excerpts: bounded }) },
  ];
}

/**
 * Validate what came back. PURE, and strict: a question that cites a source id
 * the batch did not contain is DROPPED rather than stored, because an uncited
 * derived row must not exist (the citation law this platform enforces on
 * vy_fact, vy_pattern and vy_mirror_delta).
 */
export function validateQuestionOutput(content, excerpts) {
  let parsed;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    throw error("review_question_output_invalid");
  }
  const known = new Set((Array.isArray(excerpts) ? excerpts : []).map((row) => String(row?.source_id || "")));
  const rows = Array.isArray(parsed?.questions) ? parsed.questions : null;
  if (!rows) throw error("review_question_output_invalid");
  const questions = [];
  const rejected = [];
  for (const row of rows.slice(0, 30)) {
    const question = String(row?.question || "").trim();
    const sourceIds = [...new Set((Array.isArray(row?.source_ids) ? row.source_ids : []).map(String))]
      .filter((id) => known.has(id));
    if (question.length < 8 || question.length > 300 || !sourceIds.length) {
      rejected.push(question.slice(0, 80));
      continue;
    }
    questions.push({ question, source_ids: sourceIds, origin_ref: `question:${sourceIds[0]}` });
  }
  return Object.freeze({ questions: Object.freeze(questions), rejected: Object.freeze(rejected) });
}

const AZURE_FOUNDRY_INFERENCE_API_VERSION = "2024-05-01-preview";

function endpointUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw error("review_question_endpoint_invalid"); }
  if (url.protocol !== "https:" || !/\.services\.ai\.azure\.com$/i.test(url.hostname) || url.username || url.password) {
    throw error("review_question_endpoint_invalid");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/models/chat/completions`.replace(/\/+/g, "/");
  url.search = new URLSearchParams({ "api-version": AZURE_FOUNDRY_INFERENCE_API_VERSION }).toString();
  return url;
}

export function createAzureFoundryQuestionGenerator(options = {}) {
  const url = endpointUrl(options.endpoint);
  const model = String(options.model || "").trim();
  if (!model || model.length > 120) throw error("review_question_model_required");
  const apiKey = String(options.apiKey || "");
  if (apiKey.length < 16) throw error("review_question_auth_config_invalid");
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Math.max(5_000, Math.min(55_000, Number(options.timeoutMs) || 45_000));
  return Object.freeze({
    family: "review-question",
    name: "azure-foundry-structured-output",
    version: `${AZURE_FOUNDRY_INFERENCE_API_VERSION}:${REVIEW_QUESTION_PROMPT}`,
    model,
    // The shape `api/_provider-budget.js` reserves against. Present so this
    // call is metered by the same ledger as every other model call in the
    // product rather than spending outside it.
    billing: Object.freeze({ meter: "azure_foundry_tokens", max_output_tokens: 2_000 }),
    async generate({ excerpts, count, signal }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("review-question-timeout")), timeoutMs);
      const abort = () => controller.abort(signal?.reason || new Error("review-question-aborted"));
      signal?.addEventListener?.("abort", abort, { once: true });
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "api-key": apiKey },
          body: JSON.stringify({
            model,
            messages: questionMessages(excerpts, count),
            temperature: 0,
            max_tokens: 2_000,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "vyakti_review_questions",
                description: "Questions this person's audience will ask, cited to their own material",
                strict: true,
                schema: REVIEW_QUESTION_JSON_SCHEMA,
              },
            },
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const status = Number(response.status) || 0;
          throw error(`review_question_http_${status || "unknown"}`, {
            retryable: status === 408 || status === 429 || status >= 500,
            status,
          });
        }
        const payload = await response.json();
        const choice = payload?.choices?.[0];
        if (!choice || choice.finish_reason !== "stop" || typeof choice.message?.content !== "string") {
          throw error("review_question_response_incomplete", { retryable: choice?.finish_reason === "length" });
        }
        return validateQuestionOutput(choice.message.content, excerpts);
      } catch (cause) {
        if (cause instanceof QuestionGeneratorError) throw cause;
        if (signal?.aborted) throw error("review_question_aborted");
        throw error("review_question_network_error", { retryable: true });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", abort);
      }
    },
  });
}

/**
 * The production factory. Throws `review_question_generator_unavailable` (503)
 * when the deployment is not configured, which is the honest "waiting on us"
 * state, never an empty list.
 */
export function createProductionQuestionGenerator(env = process.env) {
  const endpoint = env.AZURE_FOUNDRY_ENDPOINT;
  const model = env.AZURE_FOUNDRY_REVIEW_QUESTION_MODEL || env.AZURE_FOUNDRY_CLAIM_MODEL;
  const apiKey = env.AZURE_FOUNDRY_API_KEY;
  if (!endpoint || !model || !apiKey) {
    throw Object.assign(new Error("review_question_generator_unavailable"), {
      code: "review_question_generator_unavailable",
      status: 503,
    });
  }
  return createAzureFoundryQuestionGenerator({ endpoint, model, apiKey });
}
