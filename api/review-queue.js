// The review queue's HTTP shape, and nothing else — WS-R4.
//
//   GET  /api/review-queue?replica_id=…            the open cards, the counts and (WS-R67) flags
//   POST /api/review-queue { op: 'generate' }      fill the queue
//   POST /api/review-queue { op: 'decide' }        one card, one decision
//   POST /api/review-queue { op: 'dictate' }       a signed upload for a correction
//   POST /api/review-queue { op: 'flag_never' }    "Never say this" off a flagged reply (WS-R67)
//
// THIN, in `api/clone-chat.js` over `api/_clonechat.js`'s sense: every decision
// lives in `api/_review-queue.js` where a fake database can reach it, and this
// file only maps HTTP onto it. `evals/review-queue/run.mjs` drives the module
// directly for that reason.
//
// `dictate` is the fix-it composer's byte lane and it does exactly one thing:
// mint the ordinary signed upload for a correction source. The client PUTs the
// bytes and finalizes through the EXISTING `api/replica-source.js?op=finalize`,
// which queues the SAME processing DAG a lecture goes through. Nothing is
// transcribed inside this handler: an ASR call on the decision path turns a
// thirty-second card into a forty-second one, and a second transcription lane
// is a second lane to keep in step with the first.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
  ReviewQueueError,
  collectReviewInputs,
  decideReviewCard,
  generateReviewCards,
  generateSyntheticQuestions,
  openCorrectionUpload,
  persistReviewCards,
  readReviewQueue,
  readFlaggedReplies,
  neverRuleFromFlaggedReply,
} from "./_review-queue.js";
import { createProductionQuestionGenerator } from "./_review-queue/questions.js";
import { clientSource } from "./_replica-source.js";
import {
  ReplicaStorageError,
  REPLICA_STORAGE_WRITE_BUCKET,
  createSignedReplicaUpload,
  ensurePrivateReplicaBucket,
} from "./_replica-storage.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
}

/**
 * Fill the queue.
 *
 * The synthetic question set is the ONLY part that can cost money, and it is
 * the only part allowed to be absent: (a), (b) and (c) come from rows this
 * deployment already has. When the generator is not configured the response
 * says so by name instead of returning a shorter list, because "nothing to
 * review" for a platform failure is the honest-states law broken in the
 * direction that blames the owner.
 */
async function generate(user, body, signal) {
  const inputs = await collectReviewInputs(q, user.id, body.replica_id);
  if (!inputs) return { status: 404, payload: { error: "replica_not_found" } };
  let questions = [];
  let questionsUnavailable = "";
  // OPT IN, because this is the one branch that spends. (a), (b) and (c) are
  // rows this deployment already has and cost nothing, so a plain "fill my
  // queue" tap never bills the owner for a model call they did not ask for.
  if (body.include_questions === true) {
    try {
      const generator = createProductionQuestionGenerator(process.env);
      questions = await generateSyntheticQuestions(q, user.id, inputs.replica_id, generator, {
        count: 12,
        signal,
      });
    } catch (error) {
      // NAMED, and the rest of the generation still runs. A question set this
      // deployment cannot produce must not take the mined claims down with it.
      questionsUnavailable = String(error?.code || error?.message || "review_question_generator_unavailable");
    }
  }
  const generated = generateReviewCards({
    claims: inputs.claims,
    deltas: inputs.deltas,
    followerEvents: Array.isArray(body.follower_events) ? body.follower_events : [],
    questions,
    existing: inputs.existing,
    openCount: inputs.openCount,
  });
  const written = await persistReviewCards(q, user.id, inputs.replica_id, generated.cards);
  return {
    status: 200,
    payload: {
      written: written.length,
      dropped: generated.dropped,
      room: generated.room,
      // "waiting on us", named. Never an empty list wearing a green tick.
      ...(questionsUnavailable ? { questions_unavailable: questionsUnavailable } : {}),
      queue: await readReviewQueue(q, user.id, inputs.replica_id),
    },
  };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "review_queue", 60)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "review_queue_user", 120)) return res.status(429).json({ error: "slow_down" });

    if (req.method === "GET") {
      const queue = await readReviewQueue(q, user.id, req.query?.replica_id);
      if (!queue) return res.status(404).json({ error: "replica_not_found" });
      // WS-R67 (migration 116). A SEPARATE key, never folded into `queue`
      // itself: `readFlaggedReplies` is its own read (see that function's
      // own header for why a flag is not a `vy_review_card` row). Caught
      // rather than left to throw: a failure reading flags must not take
      // the ordinary queue down with it, and `readFlaggedReplies` already
      // returns `[]` on an unmigrated database - this catch is for anything
      // else, an honest "waiting on us" the client can still show alongside
      // a queue that DID load.
      const flags = await readFlaggedReplies(q, user.id, req.query?.replica_id).catch(() => null);
      return res.status(200).json({ queue, ...(flags ? { flags } : { flags_unavailable: true }) });
    }

    const body = req.body || {};
    if (body.op === "flag_never") {
      // "Never say this," off a flagged reply rather than an open card - the
      // creator's OTHER way into the same never-rule table, WS-R67's own
      // addition. `neverRuleFromFlaggedReply` reads the pattern back from
      // `vy_room_reply_flag` itself, never off `body.reply_text` - the SAME
      // boundary law `flagReply` enforces one surface over.
      const result = await neverRuleFromFlaggedReply(q, user.id, body);
      const flags = await readFlaggedReplies(q, user.id, body.replica_id).catch(() => null);
      return res.status(200).json({ ...result, ...(flags ? { flags } : { flags_unavailable: true }) });
    }
    if (body.op === "generate") {
      const controller = new AbortController();
      req.on?.("close", () => controller.abort(new Error("client_closed")));
      const result = await generate(user, body, controller.signal);
      return res.status(result.status).json(result.payload);
    }
    if (body.op === "decide") {
      const card = await decideReviewCard(q, user.id, body);
      return res.status(200).json({ card, queue: await readReviewQueue(q, user.id, body.replica_id) });
    }
    if (body.op === "dictate") {
      const source = await openCorrectionUpload(q, user.id, body);
      await ensurePrivateReplicaBucket(source.storage_bucket || REPLICA_STORAGE_WRITE_BUCKET);
      const upload = await createSignedReplicaUpload({
        storageBucket: source.storage_bucket,
        objectPath: source.object_path,
      });
      return res.status(201).json({
        source: clientSource(source),
        upload: {
          method: upload.method,
          url: upload.url,
          headers: { ...upload.headers, "content-type": source.mime },
          ...(upload.resumable ? { resumable: upload.resumable } : {}),
          expires_at: upload.expires_at,
        },
      });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof ReplicaStorageError) {
      return res.status(error.status || 503).json({ error: String(error.code || error.message) });
    }
    const status = error instanceof ReviewQueueError
      ? error.status
      : (Number.isInteger(error?.status) ? error.status : 500);
    return res.status(status).json({
      error: status === 500 ? "review_queue_failure" : String(error.code || error.message),
      ...(status < 500 && error?.details ? { details: error.details } : {}),
    });
  }
}
