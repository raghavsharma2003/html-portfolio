import { dispatch, makeCtx, roomForChat } from "../../api/_surface.js";
import { disclosurePredicate } from "../../api/_disclosure.js";
import { splitSql } from "../../db/migrations/apply.mjs";
import { readFileSync } from "node:fs";
import {
  AGENT_A,
  AGENT_B,
  CHAT_KEY,
  PERSON_A,
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
const ctxFor = (agentId, displayName) =>
  makeCtx(adapter, {
    agentId,
    agent: { id: agentId, displayName },
    engine,
    reply: async () => `reply from ${displayName}`,
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
    "replaced at its module boundary; no network, model, filesystem write or live database.",
);
process.exitCode = failures.length ? 1 : 0;
