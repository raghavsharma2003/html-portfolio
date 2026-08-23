// Session-clock substrate + age-tier plumbing (SPEC §9.3 / §9.4).
//
// The server side of one timer with three consumers: the disclosure/break
// card (app-voiced, rendered by the client), the T9 compiler note, and the
// dependency circuit-breaker. THIS ENDPOINT IS NOT THE GUARANTEE — the client
// mirror is (a safety mechanism that dies with the network is decoration).
// What lives here is the auditable half:
//
//   op:beat       vy_session accumulation. The server accumulates on its own
//                 wall clock (delta since last_activity, reset on 30-min
//                 gaps) and keeps GREATEST(own, client-claimed): every
//                 disagreement resolves toward MORE elapsed time, i.e. toward
//                 disclosing. Over-claiming is harmless (an early card);
//                 under-claiming is the direction a regulator cares about and
//                 it cannot win here.
//   op:disclosed  the compliance ledger: bumps vy_session.disclosures and
//                 event-logs the fire to meera_events ('clock.disclosed' /
//                 'clock.break') so timed-disclosure compliance is a QUERY
//                 (§2.6), not an assertion.
//   op:tier       read/write vy_person.age_tier. Writes may only move TOWARD
//                 restriction (tierChangeAllowed below): no verification lane
//                 exists yet, so a client asking to become 'adult_verified'
//                 is refused by construction — §9.4's fail-safe direction.
//                 The row is created on demand ('unverified' default; §0.3:
//                 unverified structurally receives the minor-safe config).
//
// Fail-soft like api/telemetry.js: a storage outage answers 200 {ok:false} —
// the mirror keeps firing, and a clock outage must never surface as a product
// failure. The ONLY 4xx are a structurally invalid request.
//
// Auth posture matches api/memory.js: possession of the device uuid is the
// identity; person scoping goes through personIdFor (an unmapped device IS
// its person, §2.1).

import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { personIdFor } from "./memory.js";
import { MEERA_AGENT_ID } from "./_agentscope.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SESSION = 96; // same cap as the telemetry session id
const DAY_MS = 86_400_000; // sanity ceiling on a client-claimed stretch

const TIERS = ["unverified", "adult_verified", "minor"];
// restrictiveness rank. Higher = more protected.
const RESTRICT = { adult_verified: 0, unverified: 1, minor: 2 };

/** §9.4 direction lock, exported for the eval gate: a tier may move toward
 *  restriction (or stay), never away from it through this endpoint. The day
 *  a real verification lane exists, IT gets its own audited path; this one
 *  stays one-way regardless. */
export function tierChangeAllowed(from, to) {
  if (RESTRICT[from] === undefined || RESTRICT[to] === undefined) return false;
  return RESTRICT[to] >= RESTRICT[from];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // one beat a minute plus fires plus tier reads: generous for a real
  // client, bounded enough that a loop cannot mine vy_session
  if (!allow(ipOf(req), "clock", 60)) return res.status(429).json({ error: "slow down" });

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const device = String(body.device || "");
  if (!UUID.test(device)) return res.status(400).json({ error: "device uuid required" });
  const op = String(body.op || "");

  if (op === "beat") {
    const session = String(body.session || "").slice(0, MAX_SESSION);
    if (!session) return res.status(400).json({ error: "session required" });
    const claimed = Math.min(DAY_MS, Math.max(0, Math.round(Number(body.continuous_ms) || 0)));
    try {
      const person = await personIdFor(device);
      // ONE statement (SQL-over-HTTP has no transactions — §0.2.3 discipline):
      // upsert the session, accumulate server-side, resolve toward more time,
      // and read the tier in the same round trip.
      const rows = await q(
        `with s as (
           insert into vy_session (agent_id, session_id, person_id, continuous_ms)
           values (($4)::uuid, $1, $2, $3)
           on conflict (agent_id, session_id) do update set
             continuous_ms = greatest(
               case when now() - vy_session.last_activity > interval '30 minutes'
                    then 0
                    else vy_session.continuous_ms
                         + (extract(epoch from (now() - vy_session.last_activity)) * 1000)::bigint
               end,
               $3::bigint),
             last_activity = now()
           returning person_id, continuous_ms, disclosures, last_disclosure_at
         )
         select s.continuous_ms, s.disclosures, s.last_disclosure_at,
                coalesce(p.age_tier, 'unverified') as age_tier
         from s left join vy_person p on p.person_id = s.person_id`,
        [session, person, claimed, MEERA_AGENT_ID],
        5_000,
      );
      const r = rows[0] || {};
      return res.status(200).json({
        ok: true,
        continuous_ms: Number(r.continuous_ms) || claimed,
        disclosures: Number(r.disclosures) || 0,
        age_tier: TIERS.includes(r.age_tier) ? r.age_tier : "unverified",
      });
    } catch {
      return res.status(200).json({ ok: false }); // the mirror carries it
    }
  }

  if (op === "disclosed") {
    const session = String(body.session || "").slice(0, MAX_SESSION);
    if (!session) return res.status(400).json({ error: "session required" });
    const kind = body.kind === "break" ? "break" : "disclosure";
    const n = Math.max(1, Math.round(Number(body.n) || 1));
    const cms = Math.min(DAY_MS, Math.max(0, Math.round(Number(body.continuous_ms) || 0)));
    try {
      const person = await personIdFor(device);
      // greatest(), not assignment: fires can arrive out of order after an
      // offline stretch, and the ledger must never count backwards
      await q(
        `insert into vy_session (agent_id, session_id, person_id, disclosures, last_disclosure_at)
         values (($4)::uuid, $1, $2, $3, now())
         on conflict (agent_id, session_id) do update set
           disclosures = greatest(vy_session.disclosures, $3::integer),
           last_disclosure_at = now(),
           last_activity = now()`,
        [session, person, n, MEERA_AGENT_ID],
        5_000,
      );
      // the audit event (§2.6): compliance is a query over meera_events
      await q(
        `insert into meera_events (device_id, event, props) values ($1, $2, $3)`,
        [
          device,
          kind === "break" ? "clock.break" : "clock.disclosed",
          JSON.stringify({ session, n, continuous_ms: cms, person }),
        ],
        5_000,
      );
      return res.status(200).json({ ok: true });
    } catch {
      return res.status(200).json({ ok: false }); // card already shown; ledger catches up
    }
  }

  if (op === "tier") {
    const set = body.set === undefined ? null : String(body.set);
    try {
      const person = await personIdFor(device);
      const cur = await q(`select age_tier from vy_person where person_id = $1`, [person], 5_000);
      const from = TIERS.includes(cur[0]?.age_tier) ? cur[0].age_tier : "unverified";
      if (set === null) return res.status(200).json({ ok: true, age_tier: from });

      if (!TIERS.includes(set)) return res.status(400).json({ error: "bad tier" });
      if (!tierChangeAllowed(from, set)) {
        // refusal is a RESULT, not an error: the client learns the standing
        // tier and applies it. Escalation waits for a verification lane.
        return res.status(200).json({ ok: false, refused: true, age_tier: from });
      }
      await q(
        `insert into vy_person (person_id, age_tier) values ($1, $2)
         on conflict (person_id) do update set age_tier = $2`,
        [person, set],
        5_000,
      );
      await q(
        `insert into meera_events (device_id, event, props) values ($1, 'clock.tier_changed', $2)`,
        [device, JSON.stringify({ from, to: set, person })],
        5_000,
      ).catch(() => {}); // the tier write above is the load-bearing one
      return res.status(200).json({ ok: true, age_tier: set });
    } catch {
      // fail-safe default: an unreachable store reports the minor-safe tier
      return res.status(200).json({ ok: false, age_tier: "unverified" });
    }
  }

  return res.status(400).json({ error: "unknown op" });
}
