// Shared fixture world for the Room's offline suites (WS-R1's `evals/room/run.mjs`
// and WS-R8's `evals/room-leak/run.mjs`).
//
// Extracted rather than duplicated: `evals/mp/fixtures.mjs` is the precedent
// (one scenario generator feeding both `gate0.mjs` and `withdraw.mjs`), and the
// alternative — two suites each hand-rolling their own fake `db` for the same
// migration — is exactly the drift `dead-writers`' sibling risk warns about: two
// fakes that quietly stop agreeing about what the real SQL text says.
//
// `fakeDb` honours migration 071's laws because those are what both suites
// exist to check and a fake that ignored them would be checking itself: the
// (room, person) uniqueness on a follower, the conditional-increment semantics
// of the cap UPDATE, and — the one that matters most for WS-R8 — the SCOPE
// PREDICATES, read off the SQL TEXT rather than hardcoded, so a negative
// control can strike a clause out of the shipping string and this fake honours
// the strike.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const SLUG = "anjali";
export const ROOM_ID = "d0000000-0000-4000-8000-000000000001";
export const AGENT_ID = "b1000000-0000-4000-8000-000000000001";
export const REPLICA_ID = "c1000000-0000-4000-8000-000000000001";
export const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";
export const PERSON_A = "aa111111-1111-4111-8111-111111111111";
export const PERSON_B = "bb222222-2222-4222-8222-222222222222";

/**
 * Builds the REAL sheet -> module path via the shipping `sheetToModule`, and
 * an `openRoom`/`joinRoom`/`roomSay`-compatible `loadAgent`. Bundled from the
 * real source on every call (`CLAUDE.md`'s reason: a frozen copy of a sheet
 * passes forever while the source rots) so `compile()` downstream does exactly
 * what it does in production.
 */
export async function loadFixtureAgent(REPO) {
  const engine = await import(pathToFileURL(join(REPO, "api/_engine.gen.js")).href);
  const OUT = mkdtempSync(join(tmpdir(), "room-eval-"));
  const ENTRY = join(OUT, "entry.ts");
  writeFileSync(
    ENTRY,
    `export { DEMO_TEACHER } from ${JSON.stringify(join(REPO, "src/engine/agents/characters/demoTeacher"))};\n`,
  );
  const BUNDLE = join(OUT, "room.bundle.mjs");
  execSync(
    `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error ` +
      `--alias:@capacitor/core=${join(REPO, "evals/stubs/capacitor.mjs")}`,
    { cwd: REPO, stdio: "inherit" },
  );
  const { DEMO_TEACHER } = await import(pathToFileURL(BUNDLE).href);
  const SHEET = { ...DEMO_TEACHER, name: "Anjali", slug: SLUG };
  const loadAgent = async (slug) => {
    if (slug !== SLUG) throw new Error("teacher_sheet_unavailable");
    return { module: engine.sheetToModule(SHEET), sheet: SHEET, row: {} };
  };
  return { engine, loadAgent, SHEET };
}

export function freshState() {
  return {
    rooms: [
      {
        room_id: ROOM_ID,
        slug: SLUG,
        replica_id: REPLICA_ID,
        agent_id: AGENT_ID,
        owner_user_id: OWNER,
        display_name: "Anjali",
        free_monthly_messages: 20,
        // WS-R19 (migration 081): the paid tier's own two ceilings, the plan's
        // own defaults - present on every room fixture from here on so a cap
        // UPDATE for a paid follower always has a real column to read rather
        // than `undefined`.
        paid_monthly_messages: 500,
        paid_monthly_voice_seconds: 1800,
        published_at: "2026-09-01T00:00:00.000Z",
        paused_at: null,
      },
    ],
    accounts: [],
    persons: [],
    followers: [],
    threads: [],
    consent: [],
    devices: [],
    facts: [],
    contextItems: [
      { source_name: "Class 12 mechanics notes", status: "mined", created_at: "2026-08-01" },
      { source_name: "Doubt session transcript", status: "routed", created_at: "2026-07-01" },
      { source_name: "Not yet processed", status: "received", created_at: "2026-06-01" },
    ],
  };
}

/**
 * The fake db. See the module header for why this is shared rather than
 * duplicated. `unknownUserFallback` is exercised whenever `authUserId` is
 * neither `USER_A` nor `USER_B` — WS-R8 relies on it to run N > 2 followers
 * through the identical fake without touching this function.
 */
export function fakeDb(state) {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push(sql);
    const has = (s) => sql.includes(s);

    if (has("from vy_room r") && has("join vy_agent a")) {
      const row = state.rooms.find(
        (r) =>
          r.slug.toLowerCase() === String(params[0]) &&
          // the two gate clauses, read off the shipping text
          (!has("r.published_at is not null") || r.published_at != null) &&
          (!has("r.paused_at is null") || r.paused_at == null),
      );
      return row ? [{ ...row, agent_slug: row.slug }] : [];
    }

    if (has("insert into vy_account_person")) {
      const uid = String(params[0]);
      let bridge = state.accounts.find((a) => a.auth_user_id === uid);
      if (!bridge) {
        const pid = uid === USER_A ? PERSON_A : uid === USER_B ? PERSON_B : `pp${uid.slice(2)}`;
        state.persons.push({ person_id: pid, age_tier: "unverified" });
        bridge = { auth_user_id: uid, person_id: pid };
        state.accounts.push(bridge);
      }
      return [{ person_id: bridge.person_id }];
    }

    if (has("from vy_room_follower f") && has("select f.follower_id")) {
      const [roomId, personId, agentId] = params.map(String);
      const row = state.followers.find(
        (f) => f.room_id === roomId && f.person_id === personId && f.agent_id === agentId,
      );
      return row ? [{ ...row }] : [];
    }

    if (has("insert into vy_room_follower")) {
      const [followerId, roomId, personId, agentId, ageAt, memAt, monthKey] = params;
      const found = state.followers.find(
        (f) => f.room_id === String(roomId) && f.person_id === String(personId),
      );
      if (found) {
        found.age_attested_at = found.age_attested_at ?? ageAt;
        found.memory_consent_at = memAt;
        found.last_seen_at = new Date().toISOString();
        return [{ ...found }];
      }
      const row = {
        follower_id: String(followerId),
        room_id: String(roomId),
        person_id: String(personId),
        agent_id: String(agentId),
        joined_at: new Date().toISOString(),
        age_attested_at: ageAt,
        memory_consent_at: memAt,
        tier: "free",
        month_key: String(monthKey),
        month_message_count: 0,
        // WS-R19 (migration 081): the paid tier's own spend counter and its
        // OWN rollover key, always present from here on. A SEPARATE key from
        // `month_key` on purpose - see migration 081's own header for the
        // real cross-counter rollover defect a shared key causes. `''`
        // mirrors the column's own DB default (`joinRoom`'s INSERT never
        // names either voice column), not the join month - the first
        // `roomSpeak` call still rolls it over exactly like any other month.
        voice_seconds_month: 0,
        voice_month_key: "",
        last_seen_at: new Date().toISOString(),
      };
      state.followers.push(row);
      return [{ ...row }];
    }

    // THE CAP. The predicate is read off the shipping SQL rather than
    // restated, so a strike lands here too. WS-R19: the free/paid CASE is
    // matched by its two branch columns rather than by the whole expression
    // text, so this fake keeps working whichever way the CASE is formatted -
    // what a negative control strikes is one of these two column names, not
    // whitespace.
    if (has("update vy_room_follower f") && has("month_message_count") && !has("voice_seconds_month")) {
      const [roomId, personId, agentId, monthKey] = params.map(String);
      const f = state.followers.find(
        (x) => x.room_id === roomId && x.person_id === personId && x.agent_id === agentId,
      );
      if (!f) return [];
      if (has("f.age_attested_at is not null") && f.age_attested_at == null) return [];
      const r = state.rooms.find((x) => x.room_id === roomId);
      const paidCase = has("r.paid_monthly_messages") && has("r.free_monthly_messages");
      const ceiling = paidCase
        ? (f.tier === "paid" ? r.paid_monthly_messages : r.free_monthly_messages)
        : r.free_monthly_messages;
      const capped =
        (paidCase || f.tier === "free") &&
        f.month_key === monthKey &&
        f.month_message_count >= ceiling;
      if (capped) return [];
      f.month_message_count = f.month_key === monthKey ? f.month_message_count + 1 : 1;
      f.month_key = monthKey;
      f.last_seen_at = new Date().toISOString();
      return [
        {
          month_key: f.month_key,
          month_message_count: f.month_message_count,
          tier: f.tier,
          free_monthly_messages: r.free_monthly_messages,
          paid_monthly_messages: r.paid_monthly_messages,
        },
      ];
    }

    // WS-R19's voice cap - the identical shape one column over. `roomSpeak`
    // spends `voice_seconds_month` against `r.paid_monthly_voice_seconds`,
    // paid tier only, rolled over on its OWN `voice_month_key` (migration
    // 081's header: a key shared with the message counter would let
    // whichever op runs first in a new month strand the other unreset).
    if (has("update vy_room_follower f") && has("voice_seconds_month") && has("set voice_month_key")) {
      const [roomId, personId, agentId, monthKey, clipSeconds] = params;
      const [rId, pId, aId, mKey] = [roomId, personId, agentId, monthKey].map(String);
      const seconds = Number(clipSeconds);
      const f = state.followers.find(
        (x) => x.room_id === rId && x.person_id === pId && x.agent_id === aId,
      );
      if (!f) return [];
      if (has("f.age_attested_at is not null") && f.age_attested_at == null) return [];
      if (has("f.tier = 'paid'") && f.tier !== "paid") return [];
      const r = state.rooms.find((x) => x.room_id === rId);
      const nextSeconds = f.voice_month_key === mKey ? f.voice_seconds_month + seconds : seconds;
      if (f.voice_month_key === mKey && nextSeconds > r.paid_monthly_voice_seconds) return [];
      f.voice_seconds_month = nextSeconds;
      f.voice_month_key = mKey;
      f.last_seen_at = new Date().toISOString();
      return [
        {
          voice_month_key: f.voice_month_key,
          voice_seconds_month: f.voice_seconds_month,
          paid_monthly_voice_seconds: r.paid_monthly_voice_seconds,
        },
      ];
    }

    if (has("insert into vy_person_device")) {
      const [device, personId] = params.map(String);
      if (!state.devices.some((d) => d.device_id === device)) {
        state.devices.push({ device_id: device, person_id: personId });
      }
      return [];
    }

    if (has("insert into meera_consent")) {
      state.consent.push({
        device_id: String(params[0]),
        user_id: params[1] == null ? null : String(params[1]),
        kind: String(params[2]),
        granted: params[3] === true,
        version: params[4],
        at: String(params[5]),
      });
      return [];
    }

    if (has("insert into vy_room_thread")) {
      const [threadId, roomId, personId, agentId, title] = params.map(String);
      const clash = state.threads.some(
        (t) =>
          t.room_id === roomId &&
          t.person_id === personId &&
          t.title.toLowerCase() === title.toLowerCase() &&
          t.archived_at == null,
      );
      if (clash) return [];
      const row = {
        thread_id: threadId,
        room_id: roomId,
        person_id: personId,
        agent_id: agentId,
        title,
        created_at: new Date().toISOString(),
        last_message_at: null,
        archived_at: null,
      };
      state.threads.push(row);
      return [{ ...row }];
    }

    // THE THREAD SCOPE PREDICATE, and the reason this fake reads the SQL text.
    // `ownedThread` selects two columns; `listThreads` selects four. Both are
    // filtered by exactly the clauses that are PRESENT in the string.
    if (has("from vy_room_thread t")) {
      const byId = has("t.thread_id = ($1)::uuid");
      const p = params.map(String);
      const [threadId, roomId, personId, agentId] = byId ? p : [null, p[0], p[1], p[2]];
      const rows = state.threads.filter(
        (t) =>
          (!byId || t.thread_id === threadId) &&
          (!sql.includes("t.room_id = ") || t.room_id === roomId) &&
          // THE CLAUSE THE NEGATIVE CONTROL STRIKES
          (!sql.includes("t.person_id = ") || t.person_id === personId) &&
          (!sql.includes("t.agent_id = ") || t.agent_id === agentId) &&
          t.archived_at == null,
      );
      return rows.map((t) => ({ ...t }));
    }

    if (has("update vy_room_thread") && has("last_message_at = now()")) {
      const t = state.threads.find((x) => x.thread_id === String(params[0]));
      if (t) t.last_message_at = new Date().toISOString();
      return [];
    }

    if (has("from vy_context_item c")) {
      return state.contextItems
        .filter((c) => ["mined", "routed"].includes(c.status) && c.source_name)
        .map((c) => ({ source_name: c.source_name }));
    }

    if (has("count(*)::int as n") && has("vy_room_follower")) {
      const roomId = String(params[0]);
      return [{ n: state.followers.filter((f) => f.room_id === roomId).length }];
    }

    if (has("delete from vy_room_thread")) {
      const [roomId, personId, agentId] = params.map(String);
      const gone = state.threads.filter(
        (t) => t.room_id === roomId && t.person_id === personId && t.agent_id === agentId,
      );
      state.threads = state.threads.filter((t) => !gone.includes(t));
      return gone.map(() => ({ gone: 1 }));
    }

    if (has("delete from vy_room_follower")) {
      const [roomId, personId, agentId] = params.map(String);
      const gone = state.followers.filter(
        (f) => f.room_id === roomId && f.person_id === personId && f.agent_id === agentId,
      );
      state.followers = state.followers.filter((f) => !gone.includes(f));
      return gone.map(() => ({ gone: 1 }));
    }

    // The manifest lanes. One fixture table (vy_fact) stands in for all of
    // them: what this suite checks is that the statement is AGENT-SCOPED and
    // person-scoped, not that Postgres can delete a row.
    if (has("delete from vy_fact")) {
      const person = params[0];
      const agentId = params[params.length - 1];
      if (!sql.includes("agent_id = ")) throw new Error("forget statement is not agent-scoped");
      const gone = state.facts.filter((f) => f.person_id === person && f.agent_id === agentId);
      state.facts = state.facts.filter((f) => !gone.includes(f));
      return gone.map(() => ({ gone: 1 }));
    }
    if (has("select * from vy_fact")) {
      const person = params[0];
      const agentId = params[params.length - 1];
      if (!sql.includes("agent_id = ")) throw new Error("export statement is not agent-scoped");
      return state.facts.filter((f) => f.person_id === person && f.agent_id === agentId);
    }

    return [];
  };
  db.calls = calls;
  return db;
}

/** The memory seam, counted. What this suite proves about it is WHETHER it is
 *  called and with WHAT, which is the whole question for a consent gate. It
 *  proves nothing about whether the real statements parse — that is
 *  `offline-mocks-cannot-type-check-sql`, and it is stated in the report. */
export function fakeMemory(log) {
  return {
    openEpisode: async (person, device, agentId) => {
      log.push({ call: "openEpisode", person, device, agentId });
      return { id: 1, extended: false };
    },
    logTurn: async (args) => {
      log.push({ call: "logTurn", ...args });
    },
    history: async (device, agentId) => {
      log.push({ call: "history", device, agentId });
      return log
        .filter((e) => e.call === "logTurn" && e.device === device)
        .map((e) => ({ role: e.role === "her" ? "assistant" : "user", content: e.content }));
    },
    recall: async (person, agentId) => {
      log.push({ call: "recall", person, agentId });
      return [];
    },
  };
}
