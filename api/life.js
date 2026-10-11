// The owner-facing life queue — SPEC-SELF-LAYER §3. WS-LIFE, exclusive owner.
//
// This endpoint is the ONLY way a life beat enters `vy_agent_life` over the
// network, and its entire design is one rule made unbreakable:
//
//   HER LIFE IS AUTHORED OR OWNER-APPROVED. NEVER MODEL-GENERATED.
//
// That is G7's reasoning (src/engine/inner.ts: "a view she improvises is a
// view she can contradict tomorrow") applied one step worse. Taste that
// drifts is an inconsistency. A LIFE that drifts has DATES in it: a flatmate
// who exists on Tuesday and not on Friday, a job she started twice. And
// because `vy_agent_life` is agent-scoped — that being the whole point, see
// `life-per-person` in context/rejected.md — a bad beat is not wrong for one
// user, it is wrong for everyone at once. The blast radius of this table is
// the reason its write path is the most restricted in the repo.
//
// ── HOW "NEVER MODEL-GENERATED" IS ENFORCED STRUCTURALLY ─────────────────
//
// Not by convention, not by a comment asking nicely. Three properties, each
// checkable by a machine and each checked by evals/self/life.mjs:
//
//  1. THIS FILE CANNOT PRODUCE MODEL TEXT. It imports no model client, holds
//     no API key, and makes no outbound `fetch` of any kind. There is no
//     expression anywhere in it that evaluates to generated text, so "text
//     produced by a model in the same request" is not a thing that can
//     happen here — the eval asserts this by scanning the source.
//
//  2. TEXT AND APPROVAL CAN NEVER ARRIVE IN THE SAME REQUEST. `propose` and
//     `edit` accept text and can only ever produce a `pending` row; `approve`
//     and `retire` accept NO text at all and reject any body carrying a
//     `beat` field outright. Publishing therefore always costs a second,
//     separate HTTP request made after a human has read the row. A pipeline
//     that generated a beat and published it would have to do so in two
//     deliberate steps, which is not an accident anyone has.
//
//  3. APPROVAL RE-LINTS THE STORED TEXT. `approve` shape-lints what is in the
//     database at approval time, not what someone submitted, so a row cannot
//     be published dirty even if it entered dirty (which the one-time story
//     seed deliberately allows — see src/engine/life.ts's `seedFromStories`).
//
// Seeding has NO HTTP SURFACE on purpose. The one-time import of
// storyCatalog.ts's STORIES runs code-side through
// `src/engine/life.ts#seedFromStoryCatalog`, reading a checked-in constant
// reviewed at commit time. An endpoint that accepts beat text in bulk is
// exactly the hole rule (2) closes; adding one here would reopen it.
//
// ── AUTHORING RULES FOR A BEAT (all four are load-bearing) ───────────────
//  L1  TELEGRAPHIC, NOT A SENTENCE. `recited-prompt` is measured twice on
//      this codebase (example quotes recited 4/5 turns; polished taste
//      sentences read out verbatim twice, eight turns apart, plus 13/96
//      register defection). A beat is the most sentence-shaped row in the
//      self layer and therefore the most likely to be read out word for word.
//      "sneha's cat knocked the tulsi pot off the sill" — not "My flatmate's
//      cat knocked over my plant today."
//  L2  AN EVENT, NOT A FEELING. G5 forbids an accumulating sad period. A
//      beat records something that HAPPENED; how she felt about it is hers to
//      improvise at the time, in her own words, in context. A beat that is
//      only an emotion is a mood with a date on it, which is the exact state
//      inner.ts's whole design makes unrepresentable.
//  L3  NO QUOTED SPEECH. A quote is a phrase bank with a timestamp. Rejected
//      by the lint below, not by review.
//  L4  DATES MUST COMPOSE. `at` is the day it happened to her. Two beats
//      under one `arc_key` are a thread over weeks and they will be read
//      together, so they have to be true together — this is the column where
//      a careless date becomes a contradiction a user can catch.
//
//   GET  /api/life?status=pending|approved|retired  → owner listing
//   POST /api/life {op:"propose", beat, at, kind, arc_key, media}
//                                                            → pending row
//   POST /api/life {op:"edit",    id, beat}                 → pending only
//   POST /api/life {op:"approve", id}                       → publish
//   POST /api/life {op:"retire",  id}                       → withdraw
// Every op above carries the owner secret in the `x-owner-secret` header,
// never in the query string or the body — WS-R93. It used to be `?secret=`
// on GET and `body.secret` on POST, which lands in access logs, proxies and
// browser history, the same leak class WS-R89 already closed for
// `api/consolidate-sweep.js`'s cron secret
// (`context/rejected.md#ws-r89-consolidate-sweep-secret-in-query-or-body-found-out-of-scope`).
// No caller in this repo ever sent it any other way.
//
// Gated exactly like api/culture.js gates its `force` param and
// api/taste-queue.js gates its owner ops: no secret configured means this
// capability is simply OFF, never open by accident.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";

const SECRET = process.env.LIFE_SECRET || "";

// Meera's agent id — mirrored, asserted by scripts/verify-agent-id.mjs.
// Migration 010 dropped the transitional agent_id defaults, so a writer that
// forgets it fails loudly rather than filing another agent's life under hers.
const MEERA_AGENT_ID = "a0000000-0000-4000-8000-000000000001";

// migration 011's CHECK constraints, mirrored so a bad value is a 400 here
// rather than a 500 from Postgres.
const KINDS = ["work", "family", "health", "social", "place", "small"];
const STATUSES = ["pending", "approved", "retired"];

// ── the shape lint, deliberately duplicated ──────────────────────────────
//
// This is src/engine/shapelint.ts's content lint plus src/engine/life.ts's
// two additions, copied rather than imported — same reason
// api/taste-queue.js duplicates `checkTasteEligibility` and
// api/consolidate.js declines to import shapelint.ts: src/engine/*.ts is
// bundled into the CLIENT by Vite, this is a Vercel/Node function outside
// that build graph, and cross-bundling a TS engine file into a serverless
// function is an untested dependency path this repo does not otherwise
// exercise. (api/_engine.gen.js exists for exactly this problem but is
// generated from src/engine/serverEntry.ts, which WS-LIFE does not own.)
//
// The duplication is NOT left to good intentions. evals/self/life.mjs runs
// this implementation and the real `lintBeat` over the same corpus and fails
// if they ever disagree on a single case — a copied predicate guarded by a
// test is a copy that cannot drift, which is the only kind worth having.
const MAX_WORDS = 14;
// src/engine/life.ts's MAX_BEAT_CHARS. Set by budget arithmetic, not taste:
// two beats this long plus T13's header must fit 700 chars.
const MAX_CHARS = 110;
const SENTENCE_SHAPED_RE = /^[A-Z][^.?!]*[.?!]$/;
const FIRST_PERSON_LINE_INITIAL_RE = /^(i\b|i'm\b|i've\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i;
const QUOTED_SPEECH_RE = /["“”']\s*\w[^"“”']*["“”']/;
const SAID_RE = /\bsaid\s*[:,]/i;

export function lintBeat(beat) {
  const trimmed = String(beat ?? "").trim();
  const reasons = [];
  if (!trimmed) reasons.push("empty");
  if (trimmed.length > MAX_CHARS) reasons.push(`too long: ${trimmed.length} chars (cap ${MAX_CHARS})`);
  if (trimmed) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length > MAX_WORDS) reasons.push(`too long: ${words.length} words (cap ${MAX_WORDS})`);
    if (SENTENCE_SHAPED_RE.test(trimmed)) reasons.push("sentence-shaped (capital start + terminal punctuation)");
    if (FIRST_PERSON_LINE_INITIAL_RE.test(trimmed)) reasons.push("first-person-Meera voice, line-initial");
  }
  if (QUOTED_SPEECH_RE.test(trimmed) || SAID_RE.test(trimmed)) {
    reasons.push("quoted speech: a beat is a shape, not a line she could recite");
  }
  return { clean: reasons.length === 0, reasons };
}

// Owner secret, header only, constant-time compare — api/self-check.js's
// own `authorized` shape, api/consolidate-sweep.js's own `secretMatches`.
// A short or unset SECRET can never match, so an unconfigured deploy is
// simply closed rather than open-by-accident.
function authorized(req) {
  const expected = Buffer.from(String(SECRET));
  const actual = Buffer.from(String(req.headers?.["x-owner-secret"] || ""));
  return expected.length >= 16 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** `approve` and `retire` are TEXT-FREE ops. A body that carries beat text
 *  alongside a publish op is not a mistake to normalize away — it is the
 *  exact shape rule (2) above exists to forbid, so it is refused loudly. */
function rejectsText(body) {
  return ["beat", "text", "desc", "note"].some((k) => body[k] !== undefined);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!allow(ipOf(req), "life", 30)) return res.status(429).json({ error: "slow down" });

  try {
    if (req.method === "GET") {
      if (!authorized(req)) return res.status(403).json({ error: "owner review only" });
      const status = STATUSES.includes(req.query?.status) ? req.query.status : "pending";
      const agentId = req.query?.agent || MEERA_AGENT_ID;
      const rows = await q(
        `select id, agent_id, at, beat, kind, arc_key, media, status, created_at,
                (select count(*) from vy_agent_life_told t
                  where t.agent_id = l.agent_id and t.life_id = l.id) as told_count
           from vy_agent_life l
          where l.agent_id = ($1)::uuid and l.status = $2
          order by l.at desc limit 200`,
        [agentId, status],
      );
      return res.status(200).json({ status, rows });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });

    const body = req.body || {};
    const { op } = body;
    if (!authorized(req)) return res.status(403).json({ error: "owner review only" });

    // ── propose: text in, ALWAYS pending. Never publishes. ──────────────
    if (op === "propose") {
      // A caller naming a status is a caller trying to publish in the same
      // request that carries the text. Refused rather than ignored, so the
      // attempt is visible in a log instead of silently downgraded.
      if (body.status !== undefined) {
        return res.status(400).json({
          error: "propose cannot set status — a beat is published by a separate approve request",
        });
      }
      const beat = String(body.beat ?? "").trim();
      const lint = lintBeat(beat);
      if (!lint.clean) return res.status(400).json({ error: "shape-lint", reasons: lint.reasons });

      const kind = KINDS.includes(body.kind) ? body.kind : "small";
      const at = body.at ? new Date(body.at) : new Date();
      if (!Number.isFinite(at.getTime())) return res.status(400).json({ error: "at must be a date" });
      const arcKey = String(body.arc_key ?? "").trim().slice(0, 80);
      const media = Array.isArray(body.media) ? body.media.slice(0, 8) : [];
      const agentId = body.agent || MEERA_AGENT_ID;

      const rows = await q(
        `insert into vy_agent_life (agent_id, at, beat, kind, arc_key, media, status)
         values (($1)::uuid, ($2)::timestamptz, $3, $4, $5, ($6)::jsonb, 'pending')
         returning id, at, beat, kind, arc_key, status`,
        [agentId, at.toISOString(), beat, kind, arcKey, JSON.stringify(media)],
      );
      return res.status(200).json({ ok: true, row: rows[0] });
    }

    // ── edit: text in, pending rows ONLY. Never publishes either. ───────
    if (op === "edit") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "id required" });
      const beat = String(body.beat ?? "").trim();
      const lint = lintBeat(beat);
      if (!lint.clean) return res.status(400).json({ error: "shape-lint", reasons: lint.reasons });
      // `status = 'pending'` in the WHERE is the guard: an APPROVED beat is
      // one people have already been told, and rewriting it retroactively
      // makes her a liar about a thing she already said. Retire it and
      // propose a new one instead.
      const rows = await q(
        `update vy_agent_life set beat = $2
          where id = $1 and status = 'pending'
          returning id, beat, status`,
        [id, beat],
      );
      if (!rows.length) return res.status(404).json({ error: "not found, or not pending" });
      return res.status(200).json({ ok: true, row: rows[0] });
    }

    // ── approve: NO text. Re-lints what is stored. ──────────────────────
    if (op === "approve") {
      if (rejectsText(body)) {
        return res
          .status(400)
          .json({ error: "approve carries no text — edit the pending row first, then approve it" });
      }
      const id = Number(body.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "id required" });

      // Lint the row as it exists in the database, not as anyone described
      // it. This is what stops a dirty seeded row reaching a prompt.
      const found = await q(`select id, beat, status from vy_agent_life where id = $1`, [id]);
      if (!found.length) return res.status(404).json({ error: "not found" });
      if (found[0].status !== "pending") {
        return res.status(409).json({ error: `already ${found[0].status}` });
      }
      const lint = lintBeat(found[0].beat);
      if (!lint.clean) {
        return res.status(422).json({
          error: "stored beat fails shape-lint — edit it before publishing",
          reasons: lint.reasons,
          beat: found[0].beat,
        });
      }
      const rows = await q(
        `update vy_agent_life set status = 'approved'
          where id = $1 and status = 'pending'
          returning id, at, beat, kind, arc_key, status`,
        [id],
      );
      if (!rows.length) return res.status(409).json({ error: "already reviewed" });
      return res.status(200).json({ ok: true, row: rows[0] });
    }

    // ── retire: NO text. Withdraws from the render, keeps the history. ──
    if (op === "retire") {
      if (rejectsText(body)) return res.status(400).json({ error: "retire carries no text" });
      const id = Number(body.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "id required" });
      const rows = await q(
        `update vy_agent_life set status = 'retired'
          where id = $1 and status in ('pending','approved')
          returning id, beat, status`,
        [id],
      );
      if (!rows.length) return res.status(404).json({ error: "not found, or already retired" });
      // vy_agent_life_told rows are deliberately LEFT ALONE. She did tell
      // them; retiring the beat stops her telling anyone else, it does not
      // un-say it to the people who heard it. Deleting the told-rows would
      // make the anti-join offer it to them again, which is the repetition
      // this whole mechanism exists to prevent.
      return res.status(200).json({ ok: true, row: rows[0] });
    }

    return res.status(400).json({ error: "unknown op" });
  } catch {
    return res.status(500).json({ error: "life queue failure" });
  }
}
