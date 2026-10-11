// The Context Locker endpoint — the HTTP half of Gurukul WS-AB.
//
//   GET    /api/context-items?replica_id=…            the owner's own locker
//   POST   /api/context-items {op:"add_files"}        1..N files, one pass each
//   POST   /api/context-items {op:"add_links"}        1..N links, one pass each
//   POST   /api/context-items {op:"remine"}           re-run with a declared
//                                                     speaker / authorship
//   DELETE /api/context-items {item_id, replica_id}   remove an item + its text
//
// Thin by construction: cors, rate limit, auth, dispatch, error shape — every
// decision lives in `api/_context-locker.js`, where a fake `db` can reach it.
// `api/teacher-sheet.js` over `api/_teacher-sheet-draft.js` is the house shape
// this copies, and `dead-writers` is the reason: the DB is absent in this
// environment, so logic in the handler is logic no eval can ever run.
//
// ── MULTIPLE files and MULTIPLE links, and each one answers for itself ───
// The brief's verb is plural: an owner drags in a folder. So the ops take
// arrays, and each element gets its OWN outcome — accepted, deduped, refused
// with a reason, or routed to another lane. One bad PDF in a batch of nine must
// not fail the batch, and a batch that reported a single aggregate status would
// hide exactly the information the owner needs (which file, and why). The
// response is therefore a per-item array in request order, always.
//
// ── the response never carries the extracted text ───────────────────────
// A locker list renders on a screen; the extracted body is the person's own
// documents, and a browser network log is not where they belong. Citations
// travel on the PROPOSAL, which the review surface fetches deliberately.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import {
  createPendingSource,
  discardUnboundContextSource,
  finalizeOwnedContextSource,
  markOwnedSourceDeleting,
} from "./_replica-source.js";
import {
  REPLICA_STORAGE_WRITE_BUCKET,
  ensurePrivateReplicaBucket,
  writeImmutableReplicaSource,
} from "./_replica-storage.js";
import {
  acquireContextSourceStorageWriter,
  releaseSourceStorageWriter,
  renewSourceStorageWriter,
} from "./_replica-storage-writer.js";
import { bootstrapSelfTestReplica } from "./_replica-processing/self-test.js";
import {
  ContextItemError,
  MAX_ITEM_BYTES,
  addContextFile,
  addContextLink,
  listContextItems,
  remineContextItem,
  removeContextItem,
} from "./_context-locker.js";

/** How many items one request may carry. A drag-drop of a whole folder is the
 *  normal case and 20 is a comfortable one; past that the client sends a second
 *  request, which is bounded work per invocation on a serverless function
 *  rather than one invocation that gets killed halfway through a batch. */
const MAX_BATCH = 20;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

const notFound = (res) => res.status(404).json({ error: "replica_not_found" });

/** base64 in, Buffer out, with the size checked BEFORE the decode. A 40 MB
 *  base64 string decoded and then measured is 40 MB of memory spent to learn it
 *  was too big. */
function bytesOf(value) {
  const text = String(value ?? "");
  if (!text) throw new ContextItemError("file_content_required", 400);
  // 4 base64 chars per 3 bytes; the check is deliberately generous by one
  // block, because the exact size is re-checked on the decoded Buffer.
  if (text.length > Math.ceil((MAX_ITEM_BYTES * 4) / 3) + 8) {
    throw new ContextItemError("file_too_large", 413, { max: MAX_ITEM_BYTES });
  }
  const buffer = Buffer.from(text, "base64");
  if (!buffer.length) throw new ContextItemError("file_content_unparseable", 400, { note: "content_base64 did not decode to any bytes" });
  return buffer;
}

/** One element's failure is that element's answer, not the batch's. A thrown
 *  ContextItemError becomes a row in the results array with its code; anything
 *  else rethrows, because an unexpected error is not something to report as a
 *  per-file verdict. */
async function settle(entries, run) {
  const out = [];
  for (const entry of entries) {
    try {
      out.push(await run(entry));
    } catch (error) {
      if (!(error instanceof ContextItemError)) throw error;
      out.push({
        item: null,
        error: error.code,
        ...(error.details ? { details: error.details } : {}),
        source_name: entry?.filename ?? entry?.url ?? "",
      });
    }
  }
  return out;
}

// Kept outside the HTTP adapter so the provider-timeout interleaving is an
// executable contract. In particular, once a durable writer authority has
// been acquired, no error path is allowed to hard-delete the source manifest:
// an acknowledged timeout can still become a late provider commit.
export async function createStoredContextSource(db, ownerUserId, replicaId, input, deps = {}) {
  const createSource = deps.createSource || createPendingSource;
  const acquireWriter = deps.acquireWriter || acquireContextSourceStorageWriter;
  const renewWriter = deps.renewWriter || renewSourceStorageWriter;
  const releaseWriter = deps.releaseWriter || releaseSourceStorageWriter;
  const writeSource = deps.writeSource || writeImmutableReplicaSource;
  const finalizeSource = deps.finalizeSource || finalizeOwnedContextSource;
  const markDeleting = deps.markDeleting || markOwnedSourceDeleting;
  const discardSource = deps.discardSource || discardUnboundContextSource;
  let source = null;
  let storageWriter = null;
  try {
    source = await createSource(db, ownerUserId, replicaId, {
      kind: input.kind,
      mime: input.mime,
      byte_size: input.bytes.length,
      sha256: input.contentSha256,
      contains_third_parties: input.containsThirdParties,
      purpose: "context_item",
    });
    if (!source) throw new ContextItemError("context_source_permissions_required", 409);
    storageWriter = await acquireWriter(db, {
      sourceId: source.source_id,
      replicaId,
      ownerUserId,
    });
    const stored = await writeSource({
      storageBucket: source.storage_bucket,
      objectPath: source.object_path,
      mime: input.mime,
      body: input.bytes,
      expectedSha256: input.contentSha256,
      ifNoneMatch: "*",
    }, {
      maxBytes: MAX_ITEM_BYTES,
      beforeWriteRequest: async () => {
        storageWriter = await renewWriter(db, storageWriter);
      },
    });
    const ready = await finalizeSource(db, ownerUserId, replicaId, source.source_id, stored);
    if (!ready || ready.state !== "ready") {
      throw new ContextItemError(ready?.rejection_code || "context_source_finalize_failed", 409);
    }
    // A release failure is fail-closed: its active row delays erasure until
    // not-after, but a complete context item remains usable.
    await releaseWriter(db, storageWriter).catch(() => false);
    return ready;
  } catch (error) {
    if (source) {
      try {
        if (storageWriter) {
          await markDeleting(db, ownerUserId, replicaId, source.source_id);
        } else {
          await discardSource(db, ownerUserId, replicaId, source.source_id);
        }
      } catch { /* the retained source manifest remains cleanup authority */ }
    }
    if (error instanceof ContextItemError) throw error;
    throw new ContextItemError(String(error?.code || "context_private_storage_failed"), Number(error?.status || 503));
  }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    return res.status(405).json({ error: "GET, POST or DELETE only" });
  }
  if (!allow(ipOf(req), "context_items", 20)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "context_items_user", 60)) return res.status(429).json({ error: "slow_down" });

    if (req.method === "GET") {
      const view = await listContextItems(q, user.id, req.query?.replica_id);
      return view ? res.status(200).json(view) : notFound(res);
    }

    const body = req.body || {};
    const replicaIdValue = body.replica_id ?? req.query?.replica_id;

    if (req.method === "DELETE") {
      const removed = await removeContextItem(q, user.id, replicaIdValue, body.item_id ?? req.query?.item_id);
      return removed ? res.status(200).json(removed) : res.status(404).json({ error: "context_item_not_found" });
    }

    const op = String(body.op || "");

    if (op === "add_files") {
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) return res.status(400).json({ error: "files_required" });
      if (files.length > MAX_BATCH) return res.status(413).json({ error: "batch_too_large", details: { files: files.length, max: MAX_BATCH } });
      await bootstrapSelfTestReplica(q, {
        ownerUserId: user.id,
        replicaId: replicaIdValue,
        env: process.env,
      });
      const bucketReady = ensurePrivateReplicaBucket(REPLICA_STORAGE_WRITE_BUCKET);
      const sourceDeps = {
        createCanonicalSource: async (input) => {
          await bucketReady;
          return createStoredContextSource(q, user.id, replicaIdValue, input);
        },
        discardCanonicalSource: async (source) => {
          // This source has already crossed the provider boundary. Even an
          // acknowledged exact DELETE is not a proof that a timed-out earlier
          // write cannot land later, so retain the manifest and let the
          // authority-aware prefix sweeper retire it.
          await markOwnedSourceDeleting(q, user.id, replicaIdValue, source.source_id);
        },
      };
      let denied = false;
      const results = await settle(files, async (file) => {
        const result = await addContextFile(q, user.id, replicaIdValue, {
          filename: file?.filename,
          bytes: bytesOf(file?.content_base64),
          authorship: file?.authorship,
          owner_speaker: file?.owner_speaker,
          third_party_acknowledged: file?.third_party_acknowledged === true,
        }, sourceDeps);
        if (!result) { denied = true; return { item: null, error: "replica_not_found" }; }
        return result;
      });
      if (denied) return notFound(res);
      // COUNTS AND LABELS ONLY. `_obs.js`'s law — never a filename, never a
      // fragment, never a byte of the person's own documents.
      obsBestEffort("context_locker.add_files", {
        files: results.length,
        refused: results.filter((r) => r.item?.status === "refused").length,
        routed: results.filter((r) => r.item?.status === "routed").length,
        mined: results.filter((r) => r.item?.status === "mined").length,
      });
      return res.status(200).json({ results });
    }

    if (op === "add_links") {
      const links = Array.isArray(body.links) ? body.links : [];
      if (!links.length) return res.status(400).json({ error: "links_required" });
      if (links.length > MAX_BATCH) return res.status(413).json({ error: "batch_too_large", details: { links: links.length, max: MAX_BATCH } });
      let denied = false;
      const results = await settle(links, async (link) => {
        const result = await addContextLink(q, user.id, replicaIdValue, {
          url: typeof link === "string" ? link : link?.url,
        });
        if (!result) { denied = true; return { item: null, error: "replica_not_found" }; }
        return result;
      });
      if (denied) return notFound(res);
      obsBestEffort("context_locker.add_links", {
        links: results.length,
        refused: results.filter((r) => r.item?.status === "refused").length,
        routed: results.filter((r) => r.item?.status === "routed").length,
      });
      return res.status(200).json({ results });
    }

    if (op === "remine") {
      const result = await remineContextItem(q, user.id, replicaIdValue, body.item_id, {
        authorship: body.authorship,
        owner_speaker: body.owner_speaker,
      });
      if (!result) return res.status(404).json({ error: "context_item_not_found" });
      obsBestEffort("context_locker.remine", { proposed: result.proposal?.proposed ?? 0 });
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof ContextItemError) {
      return res.status(error.status).json({
        error: error.code,
        ...(error.details ? { details: error.details } : {}),
      });
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "context_locker_failure" : String(error.code || error.message),
      ...(status < 500 && error?.details ? { details: error.details } : {}),
    });
  }
}
