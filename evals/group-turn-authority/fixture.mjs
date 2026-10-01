// Offline control flow, not PostgreSQL proof. Execute the complete current
// production modules with ONLY I/O dependencies replaced. The query double
// checks shipping disclosure clauses/bindings, then returns declared authority
// results; it does not reimplement a SQL evaluator or infer who may see a row.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as disclosure from "../../api/_disclosure.js";
import * as neverRules from "../../api/_never-rules.js";
import * as engine from "../../api/_engine.gen.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
export const SOURCE = { room: read("api/_room.js"), surface: read("api/_surface.js"), checkpoints: read("api/_group-runtime/checkpoints.js"),
  selection: read("api/_group-recall/selection.js") };
export const AGENT = "a0000000-0000-4000-8000-000000000001";
export const P1 = "b0000000-0000-4000-8000-000000000001";
export const P2 = "b0000000-0000-4000-8000-000000000002";
export const P3 = "b0000000-0000-4000-8000-000000000003";
export const DEVICE = "c0000000-0000-4000-8000-000000000001";
const BIND = { recipients: "$1", isGroup: "$2", roomId: "$3", negTags: "$4", agentId: "$5" };
export const clone = (value) => JSON.parse(JSON.stringify(value));
const flat = (text) => text.replace(/\s+/g, " ").trim();
const failIO = () => { throw new Error("offline_unexpected_io"); };

function loadModule(source, filename, imports, env = {}) {
  const exports = {};
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(output, { exports, require(name) {
    assert(Object.hasOwn(imports, name), `unapproved import ${name}`);
    return imports[name];
  }, console, Buffer, URL, process: { env }, fetch: failIO }, { filename, timeout: 5000 });
  return exports;
}

// Candidate-mode fixtures deliberately opt in; separate controls below prove
// that an unset deployment stays on recency and request fields cannot opt in.
export function fixture({ sources = SOURCE, audience = [P1, P2], split = false, useDefaultSend = false,
  env = { GROUP_SOURCE_RECALL_MODE: "lexical_recency" } } = {}) {
  const declaredCandidateLimit = env.GROUP_SOURCE_RECALL_MODE === "lexical_recency" ? 160 : 20;
  const state = {
    room: { id: "91", agent_id: AGENT, surface: "telegram", surface_chat_id: "-100001",
      read_consent_at: "2026-09-29T00:00:00Z", quiet_level: "normal", member_cap: 6,
      room_device_id: DEVICE, entitled: true },
    audience: [...audience], memberActive: true, linked: true, unknownIdentity: false,
    witnessComplete: true, witnessRevision: "a".repeat(64), witnessRecipients: null,
    membershipVerified: false, authorityError: false, historyError: false,
    allowedHistory: [], facts: [], words: [], grantValid: true, sinceHerLast: 90000,
    beforeCompile: null, duringModel: null, afterSend: null, onAuthority: null, onWitness: null, onSources: null,
    returnedRoom: null, compiledOverride: null, memberQuiet: "normal",
    historyTransform: (rows) => rows,
    rosterTransform: (rows) => rows,
  };
  const lookupRoom = clone(state.room);
  const calls = { sql: [], model: [], sent: [], episodes: [], logs: [], authority: 0, sources: 0, witnesses: 0,
    witnessInputs: [], redirected: [], defaultReceivers: [], candidateReads: [], humanVocabulary: [], commitments: [], compiledDimensions: [], commandMutations: [] };
  const assertSourceQuery = (sql, args, kind) => {
    assert(sql.includes(disclosure.disclosurePredicate(kind, BIND)), `full shipping ${kind} disclosure predicate`);
    assert.deepEqual(clone(args.slice(0, 5)), [state.audience, true, "91", disclosure.NEGATIVE_AFFECT_TAGS, AGENT]);
  };
  const q = async (sql, args = []) => {
    calls.sql.push({ sql, args: clone(args) });
    const s = flat(sql);
    if (s.startsWith("select person_id, handle from vy_surface_identity"))
      return state.unknownIdentity ? [] : [{ person_id: P1, handle: "Ada" }];
    if (s.startsWith("select person_id, username from vy_tg_person")) return [];
    if (s.startsWith("update vy_group_member set quiet_level = 'quiet'")) {
      assert(s.includes("where group_id = $1 and person_id = $2 and agent_id = $3::uuid"));
      assert.deepEqual(clone(args), ["91", P1, AGENT]);
      state.memberQuiet = "quiet";
      calls.commandMutations.push({ groupId: args[0], personId: args[1], agentId: args[2], quiet: "quiet" });
      return [];
    }
    if (s.startsWith("select quiet_level, linked_at from vy_group_member")) {
      assert(s.includes("and left_at is null") && s.includes("surface=$4 and surface_user_id=$5"));
      assert.deepEqual(clone(args), ["91", P1, AGENT, "telegram", "101"]);
      return state.memberActive ? [{ quiet_level: "normal", linked_at: state.linked ? "2026-09-29T00:00:00Z" : null }] : [];
    }
    if (s.includes("as linked_members")) {
      calls.authority++;
      await state.onAuthority?.(calls.authority);
      if (state.authorityError) throw new Error("authority read failed");
      assert.deepEqual(clone(args), ["91", AGENT]);
      assert(s.includes("g.id = $1::bigint and g.agent_id = $2::uuid"));
      return [{ ...clone(state.room), recipients: [...state.audience], linked_members: state.audience.map((id, i) => ({
        person_id: id, surface: "telegram", surface_user_id: String(101 + i),
        linked_at: id === P1 && !state.linked ? null : "2026-09-29T00:00:00Z",
        left_at: id === P1 && !state.memberActive ? "2026-09-29T01:00:00Z" : null, quiet_level: "normal",
      })) }];
    }
    if (s.startsWith("select") && s.includes("from vy_group ") && !s.includes("from vy_group_member")) {
      state.returnedRoom = clone(lookupRoom);
      return [state.returnedRoom];
    }
    if (s.includes("extract(epoch from")) return [{ ms: state.sinceHerLast }];
    if (s.startsWith("select f.phrase from vy_phrase")) {
      assertSourceQuery(sql, args, "phrase"); return [];
    }
    if (s.startsWith("with made as (insert into vy_episode")) {
      assert(s.includes("'audience_turn'") && !s.includes("update vy_episode"));
      assert(s.includes("insert into vy_episode_participant") && s.includes("unnest($4::uuid[])"));
      assert(s.includes("and m.left_at is null and m.linked_at is not null"));
      assert(s.includes("and $4::uuid[] = (select array_agg"));
      assert.deepEqual(clone(args), ["91", DEVICE, AGENT, state.audience]);
      const row = { id: String(200 + calls.episodes.length), recipients: clone(args[3]) };
      calls.episodes.push(row); return [{ id: row.id }];
    }
    if (s.startsWith("insert into meera_log")) {
      assert(s.includes("group_id, episode_id") && s.includes("e.id=$8::bigint"));
      assert(s.includes("e.disclosure_scope='participants'") && s.includes("cardinality(e.disclosure_deny)=0"));
      assert(s.includes("p.episode_id=e.id") && s.includes("m.left_at is null and m.linked_at is not null"));
      assert.deepEqual(clone([args[0], args[5], args[6], args[8]]), [DEVICE, "91", AGENT, state.audience]);
      assert(calls.episodes.some((ep) => ep.id === args[7] && JSON.stringify(ep.recipients) === JSON.stringify(args[8])));
      const row = { id: String(300 + calls.logs.length), role: args[1], content: args[3],
        speaker_person_id: args[4], episode_id: args[7], at: null };
      calls.logs.push(clone(row)); return [{ id: row.id }];
    }
    if (s.startsWith("insert into vy_group_turn")) return [{ id: "400" }];
    if (s.startsWith("select f.id, f.body")) {
      assertSourceQuery(sql, args, "fact");
      if (s.includes("f.kind")) return [];
      calls.sources++;
      await state.onSources?.(calls.sources);
      return state.grantValid ? clone(state.facts) : [];
    }
    if (s.startsWith("select f.id, f.phrase, f.origin_episode")) {
      assertSourceQuery(sql, args, "phrase"); return clone(state.words);
    }
    if (s.startsWith("select f.id, f.phrase")) {
      assertSourceQuery(sql, args, "phrase"); return [];
    }
    if (s.startsWith("select m.person_id, m.quiet_level")) {
      assert(s.includes("m.agent_id = $2::uuid and m.left_at is null"));
      return state.rosterTransform(state.audience.map((id, i) => ({ person_id: id, username: `person${i + 1}`,
        quiet_level: "normal", linked_at: "2026-09-29T00:00:00Z", honorific: "tum" })));
    }
    if (s.startsWith("select l.id, l.role")) {
      assertSourceQuery(sql, args, "episode");
      assert(s.includes("join vy_episode f on f.id = l.episode_id"));
      assert(s.includes("f.agent_id = l.agent_id and f.group_id = l.group_id"));
      assert(s.includes("where l.group_id = $3::bigint and l.agent_id = $5::uuid"));
      assert(s.includes("and l.role = 'me' and l.speaker_person_id is not null"));
      assert(s.includes("f.superseded_by is null"));
      assert(s.indexOf("disclosure predicate") < s.indexOf("order by l.id desc"));
      if (state.historyError) throw new Error("history authority unavailable");
      // Declared DB authority result. NOT a copied ACL policy evaluator.
      const rows = state.historyTransform([...clone(calls.logs.slice(-1)), ...clone(state.allowedHistory)]);
      if (s.includes("l.at")) {
        assert(s.includes("l.id <= $6::bigint") && s.includes("limit $7::integer"), "candidate query keeps fixed cutoff and bounded limit");
        assert.equal(args[5], calls.logs.filter((row) => row.role === "me").at(-1).id, "candidate cutoff is the persisted human turn, not current max");
        assert.equal(args[6], declaredCandidateLimit, "candidate pool has its fixed deployment-mode ceiling");
        calls.candidateReads.push(clone(args));
        return rows
          .filter((row) => BigInt(row.id) <= BigInt(args[5]))
          .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0).slice(0, args[6]);
      }
      return rows.reverse();
    }
    if (s.startsWith("select count(*)") && s.includes("vy_group_member")) return [{ n: 2 }];
    if (s.includes("vy_person_device")) return [];
    throw new Error(`unexpected query: ${s.slice(0, 140)}`);
  };
  const room = loadModule(sources.room, "api/_room.js", {
    "node:crypto": crypto, "./_db.js": { q }, "./_agentscope.js": { MEERA_AGENT_ID: AGENT },
    "./_disclosure.js": disclosure,
  });
  const checkpoints = loadModule(sources.checkpoints, "api/_group-runtime/checkpoints.js", {});
  const selection = loadModule(sources.selection, "api/_group-recall/selection.js", {});
  const surface = loadModule(sources.surface, "api/_surface.js", {
    "./_db.js": { q }, "./_config.js": {}, "./_agentscope.js": { MEERA_AGENT_ID: AGENT },
    "./_room.js": room, "./_never-rules.js": neverRules,
    "./_reply-engine-capability.js": { replyEngineCapability: failIO },
    "./_azure-surface-reply.js": { azureSurfaceReply: failIO },
    "./_model-serving-policy.js": { resolveReplyServingProvider: failIO },
    "./_group-runtime/checkpoints.js": checkpoints,
    "./_group-recall/selection.js": selection,
  }, env);
  const adapter = { surface: "telegram", receiverMarker: "original-adapter", render: (text) => split
    ? [{ text: text.slice(0, 3) }, { text: text.slice(3) }] : [{ text }],
    async send(chat, msg) {
      calls.defaultReceivers.push({ marker: this.receiverMarker, frozen: Object.isFrozen(this) });
      calls.sent.push(clone({ chat, msg })); await state.afterSend?.(); return { ok: true };
    },
  };
  const ctx = surface.makeCtx(adapter, {
    agentId: AGENT,
    engine: { ...engine,
      compile(input) {
        state.beforeCompile?.();
        const compiled = state.compiledOverride || engine.compile(input);
        calls.compiledDimensions.push({ core: compiled.core?.length, tail: compiled.tail?.length,
          utf8Bytes: Buffer.byteLength(JSON.stringify(compiled), "utf8") });
        return compiled;
      },
      hisVocabulary(history) { calls.humanVocabulary.push(clone(history)); return engine.hisVocabulary(history); },
      openCommitments(history) { calls.commitments.push(clone(history)); return engine.openCommitments(history); },
    },
    reply: async (compiled, turns) => {
      calls.model.push(clone({ compiled, turns })); await state.duringModel?.(); return "haan bilkul";
    },
    send: useDefaultSend ? undefined : async (chat, msg) => { calls.sent.push(clone({ chat, msg })); await state.afterSend?.(); return { ok: true }; },
    groupAudienceWitness: async (event, scope) => {
      calls.witnessInputs.push(clone({ event, scope }));
      calls.witnesses++; await state.onWitness?.(calls.witnesses);
      return { complete: state.witnessComplete,
        recipients: [...(state.witnessRecipients || state.audience)], revision: state.witnessRevision };
    },
    verifyGroupMembership: async ({ surfaceUserId }) => ({ verified: state.membershipVerified,
      surfaceUserId, revision: "verified-membership" }),
  });
  const ev = { kind: "message", surface: "telegram", chatKey: "-100001", isGroup: true,
    surfaceUserId: "101", handle: "Ada", text: "Can we discuss the painting?", replyToSelf: true,
    messageId: "17", fromBot: false };
  return { state, calls, surface, room, ctx, ev, run: () => surface.dispatch(ev, ctx) };
}
