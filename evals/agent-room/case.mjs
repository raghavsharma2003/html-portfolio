import { dispatch, makeCtx, roomForChat } from "../../api/_surface.js";
import { disclosurePredicate } from "../../api/_disclosure.js";
import { splitSql } from "../../db/migrations/apply.mjs";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  AGENT_A,
  AGENT_B,
  CHAT_KEY,
  PERSON_A,
  PERSON_B,
  ROOM_A,
  ROOM_B,
  state,
} from "./store.mjs";

let pass = 0;
const failures = [];
const ok = (name, condition, detail = "") => {
  if (condition) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? `  ${detail}` : ""}`);
  }
};

const adapter = {
  surface: "discord",
  render: (text) => (text ? [{ text }] : []),
  send: async () => ({ ok: true }),
};

const compileInputs = [];
const engine = {
  compile(input) {
    compileInputs.push(input);
    return { core: "fixture safety core", tail: input.memories || "", sections: {} };
  },
  decideParticipation: () => ({ action: "speak", addressed: true, reason: "fixture-addressed" }),
  parseBubbles: (text) => ({ bubbles: [String(text)] }),
  stripTextingDashes: (text) => text,
  guardReply: (reply) => ({ reply, findings: [] }),
  openCommitments: () => [],
  hisVocabulary: () => [],
  sharedVocabulary: () => [],
};

const sent = [];
const modelInputs = [];
// This is an injected synthetic complete-audience capability, not evidence
// that the production Discord adapter implements one. Its audience is
// declared independently of the server roster passed to the capability.
const audienceWitness = async (event, { roomId, agentId }) => {
  assert.equal(event.surface, "discord");
  assert.equal(event.chatKey, CHAT_KEY);
  assert.equal(roomId, agentId === AGENT_A ? ROOM_A : ROOM_B);
  return { complete: true, recipients: [PERSON_A, PERSON_B], revision: "a".repeat(64) };
};
const ctxFor = (agentId, displayName, { witness = audienceWitness, duringReply } = {}) =>
  makeCtx(adapter, {
    agentId,
    agent: { id: agentId, displayName },
    engine,
    groupAudienceWitness: witness,
    reply: async (compiled, turns) => {
      modelInputs.push({ agentId, compiled, turns });
      await duringReply?.();
      return `reply from ${displayName}`;
    },
    send: async (chatKey, message) => {
      sent.push({ agentId, chatKey, message });
      return { ok: true };
    },
    botHandle: displayName,
  });

const dmEvent = {
  surface: "discord",
  kind: "message",
  chatKey: "student-1",
  chatName: "",
  isGroup: false,
  surfaceUserId: "student-1",
  handle: "student one",
  text: "what do you remember?",
  caption: "",
  fromBot: false,
};

const groupEvent = {
  ...dmEvent,
  chatKey: CHAT_KEY,
  chatName: "shared room",
  isGroup: true,
  text: "teacher, what did this room decide?",
  messageId: "m-1",
};

console.log("\n—— two-agent DM dispatch ——");
const dmA = await dispatch(dmEvent, ctxFor(AGENT_A, "agent A"));
const dmB = await dispatch(dmEvent, ctxFor(AGENT_B, "agent B"));
ok("both agents dispatch the same person's DM", dmA.said === true && dmB.said === true);
ok("agent A recalls only A rows", dmA.recalled === 2 && compileInputs[0].memories.includes("A private"));
ok("agent A receives no B memory", !compileInputs[0].memories.includes("B private"));
ok("agent B recalls only B rows", dmB.recalled === 2 && compileInputs[1].memories.includes("B private"));
ok("agent B receives no A memory", !compileInputs[1].memories.includes("A private"));

const dmLogs = state.logs.filter((l) => l.group_id == null && l.speaker_person_id === PERSON_A);
ok("both DM turns and replies persist", dmLogs.length === 4, `${dmLogs.length} rows`);
ok(
  "DM persistence is split 2/2 by agent_id",
  dmLogs.filter((l) => l.agent_id === AGENT_A).length === 2 &&
    dmLogs.filter((l) => l.agent_id === AGENT_B).length === 2,
);

const scopedPredicate = disclosurePredicate("fact", { agentId: "$5" });
ok(
  "the disclosure boundary scopes subject, episode and grant reads",
  ["f", "de", "ae", "g", "se", "g6"].every((alias) =>
    scopedPredicate.includes(`${alias}.agent_id = ($5)::uuid`),
  ),
);

console.log("\n—— two-agent room dispatch on one surface/chat key ——");
const foundA = await roomForChat("discord", CHAT_KEY, undefined, AGENT_A);
const foundB = await roomForChat("discord", CHAT_KEY, undefined, AGENT_B);
ok("the same wire address resolves to agent A's room", foundA?.id === ROOM_A);
ok("the same wire address resolves to agent B's room", foundB?.id === ROOM_B);

const roomA = await dispatch(groupEvent, ctxFor(AGENT_A, "agent A"));
const roomB = await dispatch(groupEvent, ctxFor(AGENT_B, "agent B"));
ok("both room events dispatch and speak", roomA.action === "speak" && roomB.action === "speak");
ok("room dispatch persisted into different room ids", roomA.room === ROOM_A && roomB.room === ROOM_B);
ok(
  "room A compile recalls only A room memory",
  compileInputs[2].memories.includes("A room remembers") && !compileInputs[2].memories.includes("B room remembers"),
);
ok(
  "room B compile recalls only B room memory",
  compileInputs[3].memories.includes("B room remembers") && !compileInputs[3].memories.includes("A room remembers"),
);

const roomLogs = state.logs.filter((l) => l.group_id != null);
ok("room turns and replies persist under their owning agent", roomLogs.length === 4, `${roomLogs.length} rows`);
ok(
  "no room log crosses the agent/group pair",
  roomLogs.every(
    (l) =>
      (l.agent_id === AGENT_A && l.group_id === ROOM_A) ||
      (l.agent_id === AGENT_B && l.group_id === ROOM_B),
  ),
);
ok(
  "episode and action writers carry the same agent",
  state.episodes.length === 2 &&
    state.actions.length === 2 &&
    state.episodes.every((e) => e.agent_id === (e.group_id === ROOM_A ? AGENT_A : AGENT_B)) &&
    state.actions.every((a) => a.agent_id === (a.group_id === ROOM_A ? AGENT_A : AGENT_B)),
);
ok("every SQL route used by dispatch was understood", state.unsupported.length === 0, state.unsupported.join(" | "));
ok("four replies reached the injected wire", sent.length === 4, `${sent.length} sends`);
ok("both room logs retain the owning episode", roomLogs.every((log) => state.episodes.some((episode) =>
  episode.id === log.episode_id && episode.agent_id === log.agent_id && episode.group_id === log.group_id)));
ok("both immutable episodes retain the complete audience", state.episodes.every((episode) =>
  JSON.stringify(episode.recipients) === JSON.stringify([PERSON_A, PERSON_B]) &&
  state.participants.filter((participant) => participant.episode_id === episode.id).length === 2));

console.log("\n—— group authority refusal controls ——");
const effects = () => [compileInputs.length, modelInputs.length, sent.length,
  state.logs.length, state.episodes.length, state.actions.length];
for (const [label, witness] of [
  ["missing complete-audience capability", null],
  ["incomplete audience", async () => ({ complete: false, recipients: [PERSON_A, PERSON_B], revision: "a".repeat(64) })],
  ["linked subset instead of complete audience", async () => ({ complete: true, recipients: [PERSON_A], revision: "a".repeat(64) })],
  ["malformed witness revision", async () => ({ complete: true, recipients: [PERSON_A, PERSON_B], revision: "not-a-revision" })],
]) {
  const before = effects();
  const result = await dispatch(groupEvent, ctxFor(AGENT_A, "agent A", { witness }));
  ok(`${label} refuses before compile, model, wire or persistence`,
    result.action === "lurk" && result.reason === "group_audience_unverified" &&
    JSON.stringify(effects()) === JSON.stringify(before));
}

const group = state.groups.find((row) => row.id === ROOM_A);
const initialConsent = group.read_consent_at;
try {
  group.read_consent_at = null;
  const before = effects();
  const result = await dispatch(groupEvent, ctxFor(AGENT_A, "agent A"));
  ok("missing current read consent refuses without side effects", result.reason === "group_audience_unverified" &&
    JSON.stringify(effects()) === JSON.stringify(before));
} finally {
  group.read_consent_at = initialConsent;
}

for (const [label, invalidate, restore] of [
  ["authority revoked during generation", () => { group.read_consent_at = null; }, () => { group.read_consent_at = initialConsent; }],
  ["source withdrawn during generation", () => state.hiddenSourceIds.add(12), () => state.hiddenSourceIds.delete(12)],
]) {
  const sendsBefore = sent.length;
  const modelsBefore = modelInputs.length;
  const assistantLogsBefore = state.logs.filter((log) => log.role === "her").length;
  try {
    await assert.rejects(dispatch(groupEvent, ctxFor(AGENT_A, "agent A", { duringReply: invalidate })),
      { code: "group_authority_unavailable" });
    ok(`${label} refuses delivery and assistant persistence after one model call`,
      modelInputs.length === modelsBefore + 1 && sent.length === sendsBefore &&
      state.logs.filter((log) => log.role === "her").length === assistantLogsBefore);
  } finally {
    restore();
  }
}
ok("assistant audit rows are not recalled on subsequent group turns", modelInputs.slice(4).length === 2 &&
  modelInputs.slice(4).every((input) => input.turns.length > 1 && input.turns.every((turn) => turn.role !== "assistant")));
ok("all negative controls use understood SQL routes", state.unsupported.length === 0, state.unsupported.join(" | "));

const migration = readFileSync(
  new URL("../../db/migrations/064_agent_room_binding.sql", import.meta.url),
  "utf8",
);
const migrationStatements = splitSql(migration);
ok("migration 064 is four independently rerunnable statements", migrationStatements.length === 4);
ok(
  "migration 064 keys both authoritative and legacy room bindings by agent",
  /on vy_group \(agent_id, surface, surface_chat_id\)/.test(migration) &&
    /on vy_group \(agent_id, tg_chat_id\)/.test(migration),
);
const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
ok("db/schema.sql mirrors migration 064", schema.includes("-- Migration 064 - room addresses are unique per agent"));

console.log(
  failures.length
    ? `\n${failures.length} of ${pass + failures.length} AGENT ROOM CHECKS FAILED:\n` +
        failures.map((f) => `  - ${f}`).join("\n")
    : `\nALL ${pass} AGENT ROOM CHECKS PASS`,
);
console.log(
  "\nSCOPE: real dispatch/_surface/_room/_disclosure control flow with api/_db.js " +
    "replaced at its module boundary and a synthetic audience capability; no network, real model, filesystem write or live database. " +
    "This does not prove PostgreSQL semantics or a production Discord audience witness.",
);
process.exitCode = failures.length ? 1 : 0;
