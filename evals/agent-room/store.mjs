// A deliberately small SQL-shaped store for evals/agentroom.mjs. It is not a
// SQL validator; every accepted route asserts the shipping statement carries
// the agent predicate/write column that separates the two fixture agents.
import assert from "node:assert/strict";
import { disclosurePredicate, NEGATIVE_AFFECT_TAGS } from "../../api/_disclosure.js";

export const AGENT_A = "a0000000-0000-4000-8000-0000000000a1";
export const AGENT_B = "a0000000-0000-4000-8000-0000000000b2";
export const PERSON_A = "11111111-1111-4111-8111-111111111111";
export const PERSON_B = "22222222-2222-4222-8222-222222222222";
export const ROOM_A = 101;
export const ROOM_B = 202;
export const CHAT_KEY = "shared-room-77";
export const CONSENT_AT = "2026-09-29T00:00:00.000Z";
export const LINKED_AT = "2026-09-29T00:00:01.000Z";
export const SOURCE_SENT_AT = "2026-09-29T00:00:02.000Z";

const now = () => new Date().toISOString();
let nextLog = 1;
let nextEpisode = 1;
let nextAction = 1;

export const state = {
  unsupported: [],
  personDevices: [],
  logs: [],
  episodes: [],
  participants: [],
  actions: [],
  hiddenSourceIds: new Set(),
  currentHumanLogByScope: new Map(),
  candidateReads: [],
  expectedCandidateMode: "recency",
  temporalWrites: [],
  identities: [
    { surface: "discord", surface_user_id: "student-1", person_id: PERSON_A, handle: "student one" },
    { surface: "discord", surface_user_id: "student-2", person_id: PERSON_B, handle: "student two" },
  ],
  groups: [
    {
      id: ROOM_A,
      agent_id: AGENT_A,
      name: "agent A room",
      kind: "friend_group",
      surface: "discord",
      surface_chat_id: CHAT_KEY,
      tg_chat_id: null,
      room_device_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      read_consent_at: CONSENT_AT,
      quiet_level: "normal",
      member_cap: 6,
      created_at: now(),
    },
    {
      id: ROOM_B,
      agent_id: AGENT_B,
      name: "agent B room",
      kind: "friend_group",
      surface: "discord",
      surface_chat_id: CHAT_KEY,
      tg_chat_id: null,
      room_device_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      read_consent_at: CONSENT_AT,
      quiet_level: "normal",
      member_cap: 6,
      created_at: now(),
    },
  ],
  members: [
    { agent_id: AGENT_A, group_id: ROOM_A, person_id: PERSON_A, surface: "discord", surface_user_id: "student-1", handle: "student one", honorific: "tum", quiet_level: "normal", linked_at: LINKED_AT, left_at: null },
    { agent_id: AGENT_A, group_id: ROOM_A, person_id: PERSON_B, surface: "discord", surface_user_id: "student-2", handle: "student two", honorific: "aap", quiet_level: "normal", linked_at: LINKED_AT, left_at: null },
    { agent_id: AGENT_B, group_id: ROOM_B, person_id: PERSON_A, surface: "discord", surface_user_id: "student-1", handle: "student one", honorific: "tu", quiet_level: "normal", linked_at: LINKED_AT, left_at: null },
    { agent_id: AGENT_B, group_id: ROOM_B, person_id: PERSON_B, surface: "discord", surface_user_id: "student-2", handle: "student two", honorific: "tum", quiet_level: "normal", linked_at: LINKED_AT, left_at: null },
  ],
  facts: [
    { id: 11, agent_id: AGENT_A, person_id: PERSON_A, group_id: null, name: "a-dm", body: "A private algebra preference", kind: "user", citations: null, created_at: now() },
    { id: 12, agent_id: AGENT_A, person_id: PERSON_A, group_id: ROOM_A, name: "a-room", body: "A room remembers vectors", kind: "world", citations: null, created_at: now() },
    { id: 21, agent_id: AGENT_B, person_id: PERSON_A, group_id: null, name: "b-dm", body: "B private poetry preference", kind: "user", citations: null, created_at: now() },
    { id: 22, agent_id: AGENT_B, person_id: PERSON_A, group_id: ROOM_B, name: "b-room", body: "B room remembers metaphors", kind: "world", citations: null, created_at: now() },
  ],
};

const flat = (sql) => String(sql).replace(/\s+/g, " ").trim().toLowerCase();
const requireAgent = (s, operation) => {
  if (!s.includes("agent_id")) throw new Error(`${operation} omitted agent_id`);
};
const membersFor = (groupId, agentId) =>
  state.members.filter(
    (m) => m.group_id === Number(groupId) && m.agent_id === agentId && m.left_at == null,
  );
const audienceFor = (groupId, agentId) => membersFor(groupId, agentId)
  .filter((m) => m.linked_at).map((m) => m.person_id).sort();
const scopeKey = (groupId, agentId) => JSON.stringify([String(groupId), agentId]);
const SOURCE_BIND = { recipients: "$1", isGroup: "$2", roomId: "$3", negTags: "$4", agentId: "$5" };
const requireSourceScope = (s, params, kind) => {
  assert(s.includes(flat(disclosurePredicate(kind, SOURCE_BIND))), `full shipping ${kind} disclosure predicate`);
  assert.deepEqual(params.slice(0, 4), [audienceFor(params[2], params[4]), true, params[2], NEGATIVE_AFFECT_TAGS]);
  assert(state.groups.some((g) => g.id === Number(params[2]) && g.agent_id === params[4]), "source read uses owning agent/group pair");
};
const requireTemporalFences = (s, sourceBind) => {
  assert(s.includes(`and g.read_consent_at < ${sourceBind}::timestamptz`),
    "source event must strictly postdate group read consent");
  assert(s.includes("and not exists (select 1 from vy_group_member cm where cm.group_id = g.id and cm.agent_id = g.agent_id"),
    "temporal member fence retains the same owning group and agent");
  assert(s.includes(`and cm.left_at is null and cm.linked_at is not null and cm.linked_at >= ${sourceBind}::timestamptz)`),
    "source event must strictly postdate every current linked participant");
};

export async function route(sql, params = []) {
  const s = flat(sql);
  try {
    if (s.includes("from vy_surface_identity") && s.startsWith("select person_id")) {
      const row = state.identities.find(
        (x) => x.surface === params[0] && x.surface_user_id === String(params[1]),
      );
      return row ? [{ person_id: row.person_id, handle: row.handle }] : [];
    }

    if (s.startsWith("insert into vy_person_device")) {
      state.personDevices.push({ device_id: params[0], person_id: params[1] });
      return [];
    }

    if (s.startsWith("select id, agent_id") && s.includes("from vy_group")) {
      requireAgent(s, "room lookup");
      const row = state.groups.find(
        (g) =>
          g.surface === params[0] &&
          g.surface_chat_id === String(params[1]) &&
          g.agent_id === params[2],
      );
      return row ? [{ ...row }] : [];
    }

    if (s.startsWith("select g.id, g.agent_id") && s.includes("as linked_members")) {
      assert(s.includes("g.id = $1::bigint and g.agent_id = $2::uuid"), "current authority uses owning agent/group pair");
      const group = state.groups.find((g) => g.id === Number(params[0]) && g.agent_id === params[1]);
      if (!group) return [];
      return [{ ...group, entitled: true, recipients: audienceFor(params[0], params[1]),
        linked_members: membersFor(params[0], params[1]).map((member) => ({ ...member })) }];
    }

    if (s.startsWith("insert into vy_group_member")) {
      requireAgent(s, "member write");
      const [agentId, groupId, personId, surface, surfaceUserId] = params;
      const group = state.groups.find((g) => g.id === Number(groupId) && g.agent_id === agentId);
      if (!group) throw new Error("member write crossed room owner");
      let row = state.members.find(
        (m) => m.group_id === Number(groupId) && m.person_id === personId,
      );
      if (!row) {
        row = { agent_id: agentId, group_id: Number(groupId), person_id: personId };
        state.members.push(row);
      }
      if (row.agent_id !== agentId) throw new Error("member write changed agent");
      Object.assign(row, {
        surface: surface || row.surface || null,
        surface_user_id: surfaceUserId || row.surface_user_id || null,
        quiet_level: row.quiet_level || "normal",
        linked_at: row.linked_at || now(),
        left_at: null,
      });
      return [];
    }

    if (s.startsWith("select quiet_level, linked_at from vy_group_member")) {
      requireAgent(s, "member read");
      const row = state.members.find(
        (m) => m.group_id === Number(params[0]) && m.person_id === params[1] && m.agent_id === params[2],
      );
      return row ? [{ quiet_level: row.quiet_level, linked_at: row.linked_at }] : [];
    }

    if (s.startsWith("select coalesce(array_agg(m.person_id)")) {
      requireAgent(s, "recipient read");
      return [{ recipients: membersFor(params[0], params[1]).filter((m) => m.linked_at).map((m) => m.person_id) }];
    }

    if (s.startsWith("select 1 from vy_group_entitlement")) {
      requireAgent(s, "entitlement read");
      return [];
    }

    if (s.startsWith("select f.phrase from vy_phrase")) {
      requireAgent(s, "room word read");
      return [];
    }

    if (s.startsWith("select extract(epoch") && s.includes("from meera_log")) {
      requireAgent(s, "room cooldown read");
      const rows = state.logs.filter(
        (l) => l.group_id === Number(params[0]) && l.agent_id === params[1] && l.role === "her",
      );
      return [{ ms: rows.length ? 0 : null }];
    }

    if (s.startsWith("select id, ended_at, started_at from vy_episode")) {
      requireAgent(s, "episode read");
      const row = state.episodes
        .filter((e) => e.group_id === Number(params[0]) && e.agent_id === params[1] && e.provisional)
        .at(-1);
      return row ? [{ id: row.id, ended_at: row.ended_at, started_at: row.started_at }] : [];
    }

    if (s.startsWith("with made as (insert into vy_episode")) {
      requireAgent(s, "episode write");
      assert(s.includes("'audience_turn'") && s.includes("insert into vy_episode_participant"));
      assert(s.includes("unnest($4::uuid[])") && s.includes("and $4::uuid[] = (select array_agg"));
      assert(s.includes("and m.left_at is null and m.linked_at is not null"));
      assert.deepEqual(params[3], audienceFor(params[0], params[2]), "episode binds the complete current audience");
      assert.equal(params.length, 5, "episode receives the source-event time as its fifth binding");
      assert.equal(params[4], SOURCE_SENT_AT, "episode source time comes from the admitted event, not receipt time");
      requireTemporalFences(s, "$5");
      state.temporalWrites.push({ operation: "episode", sourceSentAt: params[4] });
      const row = {
        id: nextEpisode++,
        agent_id: params[2],
        group_id: Number(params[0]),
        device_id: params[1],
        started_at: now(),
        ended_at: now(),
        provisional: true,
        recipients: [...params[3]],
      };
      const group = state.groups.find((g) => g.id === row.group_id && g.agent_id === row.agent_id);
      if (!group) throw new Error("episode write crossed room owner");
      state.episodes.push(row);
      state.participants.push(...row.recipients.map((personId) => ({
        episode_id: row.id, person_id: personId, role: "participant",
      })));
      return [{ id: row.id }];
    }

    if (s.startsWith("insert into vy_episode_participant")) {
      requireAgent(s, "participant write");
      const episode = state.episodes.find((e) => e.id === Number(params[0]) && e.agent_id === params[3]);
      if (episode && !state.participants.some((p) => p.episode_id === episode.id && p.person_id === params[1])) {
        state.participants.push({ episode_id: episode.id, person_id: params[1], role: params[2] });
      }
      return [];
    }

    if (s.startsWith("insert into meera_log")) {
      requireAgent(s, "log write");
      const isRoom = s.includes("group_id, episode_id)");
      if (isRoom) {
        assert.equal(params.length, 10, "human and assistant logs retain the source-event time as binding ten");
        assert.equal(params[9], SOURCE_SENT_AT, "log source time comes from the admitted event, not receipt time");
        requireTemporalFences(s, "$10");
        state.temporalWrites.push({ operation: params[1] === "her" ? "assistant_log" : "human_log", sourceSentAt: params[9] });
        assert(s.includes("e.id=$8::bigint") && s.includes("e.disclosure_scope='participants'"));
        assert(s.includes("cardinality(e.disclosure_deny)=0") && s.includes("$9::uuid[] = (select array_agg"));
        const episode = state.episodes.find((e) => e.id === params[7] && e.agent_id === params[6] && e.group_id === Number(params[5]));
        assert(episode, "log binds an episode belonging to this agent and group");
        assert.deepEqual(params[8], episode.recipients, "log retains its immutable episode audience");
        assert.deepEqual(params[8], audienceFor(params[5], params[6]), "log binds current audience");
      }
      const row = isRoom
        ? {
            id: nextLog++,
            agent_id: params[6],
            device_id: params[0],
            role: params[1],
            content: params[3],
            speaker_person_id: params[4],
            group_id: Number(params[5]),
            episode_id: params[7],
            at: now(),
          }
        : {
            id: nextLog++,
            agent_id: params[4],
            device_id: params[0],
            role: params[1],
            content: params[2],
            speaker_person_id: params[3],
            group_id: null,
          };
      state.logs.push(row);
      if (isRoom && row.role === "me") state.currentHumanLogByScope.set(scopeKey(row.group_id, row.agent_id), String(row.id));
      return s.includes("returning id") ? [{ id: row.id }] : [];
    }

    if (s.startsWith("insert into vy_group_turn")) {
      requireAgent(s, "room action write");
      state.actions.push({
        id: nextAction++,
        group_id: Number(params[0]),
        episode_id: params[1],
        log_id: params[2],
        action: params[3],
        agent_id: params[6],
      });
      return [{ id: state.actions.at(-1).id }];
    }

    if (s.startsWith("select f.id, f.body, f.name") && s.includes("from vy_fact f")) {
      requireAgent(s, "fact recall");
      const [recipients, isGroup, groupId, _neg, agentId] = params;
      if (isGroup) requireSourceScope(s, params, "fact");
      return state.facts.filter(
        (f) =>
          !state.hiddenSourceIds.has(f.id) &&
          f.agent_id === agentId &&
          (isGroup ? f.group_id === Number(groupId) : recipients.includes(f.person_id) || f.group_id != null),
      );
    }

    if (s.startsWith("select f.id, f.body, f.kind") && s.includes("from vy_fact f")) {
      requireAgent(s, "bridge recall");
      requireSourceScope(s, params, "fact");
      const agentId = params[4];
      return state.facts.filter(
        (f) => !state.hiddenSourceIds.has(f.id) && f.agent_id === agentId && f.group_id === Number(params[2]),
      );
    }

    if (s.startsWith("select f.id, f.phrase")) {
      requireAgent(s, "phrase recall");
      requireSourceScope(s, params, "phrase");
      return [];
    }

    if (s.startsWith("select l.id, l.role, l.content")) {
      requireSourceScope(s, params, "episode");
      assert(s.includes("join vy_episode f on f.id = l.episode_id"));
      assert(s.includes("f.agent_id = l.agent_id and f.group_id = l.group_id"));
      assert(s.includes("l.group_id = $3::bigint and l.agent_id = $5::uuid"));
      assert(s.includes("l.role = 'me' and l.speaker_person_id is not null"));
      assert(s.includes("f.superseded_by is null"));
      const isCandidateRead = s.includes("l.at,");
      if (isCandidateRead) {
        assert(s.includes("and l.id <= $6::bigint"), "candidate read has a fixed current-log boundary");
        assert(s.includes("order by l.id desc limit $7::integer"), "candidate read has bounded newest-first order");
        assert(s.indexOf(flat(disclosurePredicate("episode", SOURCE_BIND))) < s.indexOf("order by l.id desc"),
          "disclosure applies before candidate order and limit");
        assert.equal(params.length, 7, "candidate query has exactly seven typed bindings");
        assert(["recency", "lexical_recency"].includes(state.expectedCandidateMode), "fixture has a declared captured server mode");
        assert.equal(params[6], state.expectedCandidateMode === "lexical_recency" ? 160 : 20,
          "candidate read limit matches the explicitly captured server mode");
        assert.equal(String(params[5]), state.currentHumanLogByScope.get(scopeKey(params[2], params[4])),
          "all candidate reads retain this turn's persisted human-log cutoff");
      }
      // Declared authoritative fixture rows, not a simulation of PostgreSQL's
      // disclosure/withdrawal semantics. The full predicate is checked above.
      const rows = state.logs.filter((l) => l.group_id === Number(params[2]) && l.agent_id === params[4] &&
        l.role === "me" && l.speaker_person_id != null && l.episode_id != null &&
        (!isCandidateRead || BigInt(l.id) <= BigInt(params[5])))
        .sort((a, b) => b.id - a.id).slice(0, isCandidateRead ? params[6] : params[5])
        .map(({ id, role, content, at, episode_id, speaker_person_id }) => ({ id, role, content,
          ...(isCandidateRead ? { at } : {}), episode_id, speaker_person_id }));
      if (isCandidateRead) state.candidateReads.push({ groupId: params[2], agentId: params[4],
        throughLogId: String(params[5]), limit: params[6], ids: rows.map((row) => String(row.id)) });
      return rows;
    }

    if (s.startsWith("select m.person_id, m.quiet_level, m.linked_at")) {
      requireAgent(s, "roster read");
      return membersFor(params[0], params[1]).map((m) => ({
        person_id: m.person_id,
        quiet_level: m.quiet_level,
        linked_at: m.linked_at,
        username: m.handle || m.person_id.slice(0, 8),
        honorific: m.honorific,
      }));
    }

    if (s.startsWith("select role, content from meera_log")) {
      requireAgent(s, "history read");
      const isRoom = s.includes("where group_id = $1");
      return state.logs
        .filter((l) =>
          isRoom
            ? l.group_id === Number(params[0]) && l.agent_id === params[1]
            : l.device_id === params[0] && l.agent_id === params[1] && l.group_id == null,
        )
        .sort((a, b) => b.id - a.id)
        .map(({ role, content }) => ({ role, content }));
    }

    throw new Error(`unsupported fixture SQL: ${s.slice(0, 140)}`);
  } catch (error) {
    state.unsupported.push(error.message);
    throw error;
  }
}

// A declared concurrent source fixture, not a second production write path.
// It must not update the current dispatched turn's immutable cutoff witness.
export function appendLaterHumanSource(groupId, agentId, content) {
  const group = state.groups.find((row) => row.id === groupId && row.agent_id === agentId);
  assert(group, "concurrent fixture uses an existing owning group");
  const episode = { id: nextEpisode++, group_id: groupId, agent_id: agentId,
    device_id: group.room_device_id, started_at: now(), ended_at: now(), provisional: true,
    recipients: audienceFor(groupId, agentId) };
  state.episodes.push(episode);
  state.participants.push(...episode.recipients.map((person_id) => ({
    episode_id: episode.id, person_id, role: "participant",
  })));
  const row = { id: nextLog++, agent_id: agentId, device_id: group.room_device_id,
    group_id: groupId, episode_id: episode.id, role: "me", content, at: now(), speaker_person_id: PERSON_B };
  state.logs.push(row);
  return row;
}
