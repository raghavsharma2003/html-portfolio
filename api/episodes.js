// Episode boundary + live-lane writers — SPEC §4.1 "Live-lane writers (NEW,
// small, v0 deterministic)" and the shared segmentation primitive the in-turn
// provisional tier (api/memory.js opRemember delta) and the nightly pass
// (api/consolidate.js) both need. One boundary rule, one place it lives.
//
// Boundary = channel change OR a gap > GAP_MS (45 min, SPEC's own number for
// both the deterministic backfill boundaries and the live-lane writers) OR an
// explicit close (call hangup). No LLM anywhere in this file — deterministic
// by construction, which is what "v0" means in the spec text.
//
// meera_log is ground truth for chat/call (channel + timestamps already
// there); watch has no meera_log rows at all (confirmed against the live
// database — 0 watch-channel rows exist today), so a watch episode's
// log_from/log_to stay null. That is an anticipated shape, not a gap: the
// forget cascade (api/memory.js purgeRelational, frozen to this workstream)
// already carries the comment "provisional episodes may not carry a log span
// yet" and falls back to a time-window overlap for exactly this case.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { personIdFor } from "./memory.js";
import { MEERA_AGENT_ID } from "./_agentscope.js";

export const GAP_MS = 45 * 60_000;

/**
 * Find the open provisional episode for (person, channel), or open a new one.
 * Returns { id, extended } or null if nothing could be written.
 *
 * "Open" = the newest not-yet-superseded provisional episode on this channel
 * whose last activity is inside the gap window. Nightly finalize supersedes
 * every provisional row it re-segments, so an episode that has already been
 * finalized is never picked up here (superseded_by is not null by then).
 */
// GAP 1 (WS-FELT) trace note: `participation` here is a caller-supplied
// parameter, but every live caller (the `call_end`/`watch_visual`/
// `watch_moment` ops in the handler below) omits it, so this default is
// what actually ships. That is correct, not an oversight to "fix" by
// wiring WE_TOKEN_RE in here too: the insert below always writes
// `summary: ''` (a provisional row has no summary yet — nothing has been
// derived from its content), so a regex classification at THIS point would
// only ever see an empty string and could never legitimately produce 'we'.
// Real classification needs the telegraphic summary a model derives, and
// that only exists once api/consolidate.js's finalizePerson (or the
// backfill script) writes the FINAL episode — see that file's own
// WE_TOKEN_RE port for the classification this file cannot honestly do.
export async function openOrExtendEpisode(person, device, channel, { gapMs = GAP_MS, participation = "user", agentId = MEERA_AGENT_ID } = {}) {
  const open = await q(
    `select id, ended_at, started_at from vy_episode
      where person_id = $1 and agent_id = ($3)::uuid and provisional = true
        and superseded_by is null and channel = $2
      order by started_at desc limit 1`,
    [person, channel, agentId],
  ).catch(() => []);
  const now = Date.now();
  if (open[0]) {
    const last = new Date(open[0].ended_at ?? open[0].started_at).getTime();
    if (Number.isFinite(last) && now - last <= gapMs) return { id: open[0].id, extended: true };
  }

  // ground truth log span, only for channels meera_log actually carries
  let logFrom = null;
  let logTo = null;
  let startedAt = new Date(now);
  if (channel === "chat" || channel === "call") {
    const bounds = await q(
      `select min(id) as lo, max(id) as hi, min(at) as lo_at from meera_log
        where device_id = $1 and channel = $2 and at >= now() - ($3 || ' milliseconds')::interval`,
      [device, channel, String(gapMs)],
    ).catch(() => []);
    if (bounds[0]?.hi != null) {
      logFrom = bounds[0].lo;
      logTo = bounds[0].hi;
      startedAt = new Date(bounds[0].lo_at);
    }
  }
  const reason = open[0] ? "channel" : "gap";
  const ins = await q(
    `insert into vy_episode
       (person_id, agent_id, device_id, channel, participation, started_at, ended_at,
        boundary_reason, log_from, log_to, summary, provisional)
     values ($1,($9)::uuid,$2,$3,$4,$5,now(),$6,$7,$8,'',true)
     returning id`,
    [person, device, channel, participation, startedAt.toISOString(), reason, logFrom, logTo, agentId],
  ).catch(() => []);
  return ins[0] ? { id: ins[0].id, extended: false } : null;
}

/** Extend an open episode's activity window and, optionally, its cheap
 *  deterministic summary. `close: true` stamps ended_at at the precise
 *  moment (call hangup) instead of the next opRemember pass discovering the
 *  gap up to 45 minutes later — a latency nicety, not a correctness one:
 *  the gap rule alone already closes every episode eventually. */
export async function touchEpisode(id, { logTo, summary, close = false } = {}) {
  const sets = ["ended_at = now()"];
  const params = [id];
  let p = 2;
  if (logTo != null) {
    sets.push(`log_to = greatest(coalesce(log_to, 0), $${p++})`);
    params.push(logTo);
  }
  if (typeof summary === "string") {
    sets.push(`summary = $${p++}`);
    params.push(summary);
  }
  await q(`update vy_episode set ${sets.join(", ")} where id = $1`, params).catch(() => {});
  return { id, closed: close };
}

// ── watch lane: claims and reactions are SEPARATE OBJECTS (vision-fab law) ──
// No new model call here — the extraction already happened in the existing
// vision pipeline (api/chat.js's screen-share call); this only persists its
// structured output as citation-bearing rows.
export async function writeVisualAssertion(person, episodeId, { claim, extractorModel, confidence, illegible }, agentId = MEERA_AGENT_ID) {
  const c = String(claim || "").trim().slice(0, 200);
  if (!c || !extractorModel) return null;
  const ins = await q(
    `insert into vy_visual_assertion
       (episode_id, person_id, agent_id, claim, extractor_model, confidence, declared_illegible)
     values ($1,$2,($7)::uuid,$3,$4,$5,$6) returning id`,
    [episodeId, person, c, String(extractorModel).slice(0, 60), Number(confidence) || 0, illegible === true, agentId],
  ).catch(() => []);
  return ins[0]?.id ?? null;
}

export async function writeSharedMoment(person, episodeId, { assertionId, reaction }, agentId = MEERA_AGENT_ID) {
  const r = String(reaction || "").trim().slice(0, 160);
  if (!r) return null;
  const ins = await q(
    `insert into vy_shared_moment (episode_id, person_id, agent_id, assertion_id, reaction)
     values ($1,$2,($5)::uuid,$3,$4) returning id`,
    [episodeId, person, assertionId ?? null, r, agentId],
  ).catch(() => []);
  return ins[0]?.id ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// HTTP surface for the live-lane writers. Small on purpose (SPEC: "NEW,
// small, v0 deterministic"). INTERFACE TICKET (open, logged in the M3
// report): no client call site posts here yet — src/voice/useCallEngine.ts
// (hangup) and src/watch/scene.ts (scene wake) are outside every §13
// workstream's file list, so wiring them is unclaimed. Until that lands, the
// 45-minute gap rule in openOrExtendEpisode still closes every call episode
// eventually; only the hangup-precision and the watch lane's writes are
// blocked on it.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "episodes", 120)) return res.status(429).json({ error: "slow down" });

  try {
    const { op, device } = req.body || {};
    if (!UUID.test(String(device || ""))) return res.status(400).json({ error: "device uuid required" });
    const person = await personIdFor(device);

    if (op === "call_end") {
      const open = await openOrExtendEpisode(person, device, "call");
      if (!open) return res.status(200).json({ ok: true, closed: false });
      await touchEpisode(open.id, { close: true });
      return res.status(200).json({ ok: true, episode_id: open.id, closed: true });
    }

    if (op === "watch_visual") {
      const { claim, extractorModel, confidence, illegible } = req.body || {};
      const ep = await openOrExtendEpisode(person, device, "watch");
      if (!ep) return res.status(200).json({ ok: false });
      const assertionId = await writeVisualAssertion(person, ep.id, { claim, extractorModel, confidence, illegible });
      return res.status(200).json({ ok: Boolean(assertionId), episode_id: ep.id, assertion_id: assertionId });
    }

    if (op === "watch_moment") {
      const { assertionId, reaction } = req.body || {};
      const ep = await openOrExtendEpisode(person, device, "watch");
      if (!ep) return res.status(200).json({ ok: false });
      const momentId = await writeSharedMoment(person, ep.id, { assertionId, reaction });
      return res.status(200).json({ ok: Boolean(momentId), episode_id: ep.id, moment_id: momentId });
    }

    return res.status(400).json({ error: "unknown op" });
  } catch {
    return res.status(500).json({ error: "episodes failure" });
  }
}
