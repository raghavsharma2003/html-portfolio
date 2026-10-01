# Native Group AI identity: existing authority and the missing bridge

Date: 1 October 2026. Audited source: `8ad3af260fd57dc09a9026b8d339a6f3846895ac` on `codex/multimodal-layer-20260927`. This report complements [Group AI readiness](GROUPAI-READINESS-20260929.md) and [the delivery audit](GROUP-DELIVERY-DURABILITY-20261001.md).

Status: **read-only source audit and unimplemented design**, not a working native group feature or live account-link demonstration. No browser/server, database, provider, external account, private data, migration or deployment was used. The one executed probe below runs actual extracted functions against synthetic in-memory dependencies. Whole Group AI remains unfinished.

## Result

The authenticated web account-to-person bridge exists. The platform account-to-person bridge also exists. Their production callers do not currently prove that an authenticated web account and a Telegram account belong to the same person. Sharing a person table is not the same as linking the accounts.

A member-only status/control surface should start with that missing proof, not with a creator-owned list of groups. Owning the AI does not establish membership in its groups. The private follower Room product is a separate scope and its session cannot stand in for common-friend group membership.

## Source authority map

Line numbers below refer to the audited source; function names are the stable reference after subsequent edits.

| Question | Existing object and actual caller behavior |
| --- | --- |
| Who is signed in on the web? | `api/_auth.js:requireUser` (32) uses the Authorization bearer and `userFromToken` to obtain Supabase's verified user. A user ID, person ID or device ID supplied in JSON is not identity proof. `api/room.js:requiredUser` uses the same verifier. |
| Which person belongs to that account? | `api/_room-surface.js:personForAccount` (601) maps the verified auth ID through `vy_account_person`. Missing mappings cause a new `vy_person` and bridge row to be created under an advisory-lock CTE. `api/_replica.js:createSelfReplica` contains the other account-bridge writer. `db/migrations/015_replica_core.sql` gives the bridge an auth-user primary key and a unique person ID. This proves account binding, not real-world identity/liveness. |
| Which person belongs to a platform account? | `api/_room.js:personForSurfaceUser` (104) reads `vy_surface_identity(surface, surface_user_id)`, with Telegram's legacy `vy_tg_person` fallback/backfill. `linkSurfacePerson` (144) creates a person when needed and writes the platform binding. Identity is deliberately agent-independent. |
| Can the platform writer reuse a known account person? | `linkSurfacePerson` accepts a server-supplied `personId`, and `_surface.js:linkIdentity` (777) forwards it. However, common-friend `onLinkTap` calls `linkIdentity(ctx, ev)` without that option. `_room-telegram.js` calls its linker with a handle, not an authenticated web person. No connected production caller establishing the account-to-platform match was found. |
| What names a shared group? | `vy_group.id` is a bigint. Its `agent_id`, `surface` and `surface_chat_id` are the scope. `_surface.js:roomForChat` (866) and `ensureRoomForSurfaceChat` (904) bind reads/writes to the agent. A display name, chat ID or agent ownership is not membership proof. |
| Who is a member? | `vy_group_member(group_id, person_id)` records agent, platform address, `linked_at`, `left_at` and quiet level. `_surface.js:upsertRoomMember` (948) clears prior linked consent when a departed person rejoins. `_room.js:linkMember`, `markMemberLeft` and `recipientSet` implement the stored-state transitions/read. |
| Is that membership current on the platform? | `_group-audience.js:createTelegramGroupAuthority` (152) provides `verifyGroupMembership` and a complete `groupAudienceWitness`, bound to the bot/agent. These inspect current platform state; a stored membership row alone is insufficient. The existing hooks also require the reviewed private-chat/read-consent conditions. They cannot simply be weakened to make a status screen load. |
| What authorizes a group turn? | `_room.js:groupTurnAuthority` (513) returns current group/member/recipient state. `_surface.js:createGroupTurnGuard` combines this with the complete transport witness and source checkpoints. This is internal authority material, not a safe browser response DTO. |
| Do device bindings solve account linking? | No. `vy_person_device` and deterministic DM/thread device IDs support storage partitioning, recall and erasure. A browser-supplied device ID is not proof of ownership of another person or platform account. |

## Private Rooms are not shared groups

`api/room.js` calls `_room-surface.js` for the private follower product. Its objects are `vy_room`, `vy_room_follower` and `vy_room_thread`, not `vy_group` and `vy_group_member`. `followerRow` checks Room, person and agent together. The signed Room session identifies that private relationship; export, forget and explicit memory controls additionally match a verified bearer account to its person.

`api/_room-telegram.js` transports the same private follower operations over Telegram. Its comment that web and Telegram enter the same shared person table does not demonstrate that two existing account identities have been reconciled.

Existing web collectors in `_clonechat.js` and `_room-surface.js` collect one HTTP response. They are not native shared-group audience adapters. Production shared-group dispatch callers were found in `tg.js`, `discord.js` and `whatsapp.js`; no connected native common-friend group HTTP endpoint or frontend caller was found.

Creator/agent ownership must remain distinct from member authority:

- Do not return group names, platform chat IDs, rosters, quotes, history or member controls because `vy_replica.owner_user_id` matches the caller.
- Existing private-Room count readers and Pulse are separate product contracts. Pulse uses explicit opt-in and a minimum cohort of five; `roomStats` is a different existing count-only operation. Neither grants a creator access to shared-group records.
- A future owner operational aggregate needs a separately reviewed, content-free contract. It must not silently become a per-group discovery API, especially for small groups.

## Command path: source observation, not an assumed permission policy

At the audited source, `_surface.js:onGroupMessage` resolves the room and platform identity, then dispatches a recognized command to `onCommand` **before** calling `createGroupTurnGuard` (approximately lines 1417-1426).

`onCommand` has materially different effects:

- `/chup me` changes the identified speaker's personal quiet level. `/chup` changes the whole group's quiet level even when the resolved speaker is null.
- `/bolo me` changes personal quiet level; `/bolo` re-enables the whole group's normal setting. Neither path invokes the ordinary turn guard.
- `/bhool` calls `withdrawSharedRows(speaker, { agentId })`. That helper withdraws the person's shared participation, grants and memberships across the agent's groups, not only the current group. A native button labelled "Forget this group" would misrepresent that scope.
- `/kya` and `/kaise` post app-authored transparency/help text; they are not the same authority class as enabling group processing or disclosing history.

The existing source treats muting as a privacy control. The audit does **not** establish that allowing an unlinked but actual platform member to mute the bot is a policy violation. A real member may reasonably need a mute/opt-out before onboarding. Conversely, unmuting must not be assumed to have the same eligibility as muting, and a delayed event is not proof that the sender is still a member now.

What the observation does establish is narrower: `onCommand` is not a current-membership authorization boundary. A native browser handler must not call it with a request-supplied speaker, or treat it as a substitute for authenticated membership. Any repair of the platform command lane should preserve legitimate privacy opt-out while explicitly deciding who may re-enable group behavior. The existing transport ingress verification was not bypassed or tested live by this audit.

### Executed read-only probe

Method: read the current `_surface.js`, extract its two actual functions into a Node VM, and provide synthetic room/identity/write dependencies. No source was rewritten, and no application imports or network calls ran. `resolveIdentity` returns null. The group guard is poisoned so reaching it would fail the probe.

The following is the compact equivalent of the executed script, suitable for `node --input-type=module` without creating a file:

```js
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("api/_surface.js", "utf8");
const readFunction = (name) => {
  const start = source.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error("missing function");
  const end = source.indexOf("\n}", start) + 2;
  return source.slice(start, end).replace("export ", "");
};
const writes = [];
const box = {
  roomForChat: async () => ({ id: "17" }),
  resolveIdentity: async () => null,
  commandOf: () => ({ name: "chup", arg: "" }),
  setQuiet: async (...args) => writes.push({
    kind: "quiet", group: args[0], level: args[1], agent: args[3],
  }),
  deliver: async () => writes.push({ kind: "send" }),
  createGroupTurnGuard: () => { throw new Error("unexpected guard call"); },
};
vm.createContext(box);
vm.runInContext(readFunction("onGroupMessage") + "\n" +
  readFunction("onCommand"), box);
const result = await box.onGroupMessage({
  surface: "telegram", chatKey: "-17", surfaceUserId: "404", text: "/chup",
}, { engine: {}, agentId: "synthetic-agent", adapter: {}, t: (x) => x });
console.log(JSON.stringify({ result, writes }));
```

Observed result:

```json
{"result":{"ok":true,"room":"17","quiet":"room"},"writes":[{"kind":"quiet","group":"17","level":"quiet","agent":"synthetic-agent"},{"kind":"send"}]}
```

This proves branch ordering and mocked effect invocation for the synthetic inputs, not SQL execution, ingress authenticity, a live exploit, or actual platform membership. `/bolo` and withdrawal scope above are source observations, not additional executed command probes. The function extraction is specific to the audited source layout; it is not a release-gate parser.

## Missing pieces before a native member surface

No connected production writers/readers were found for:

1. Authenticated web-account-to-platform-account proof and collision-safe linking.
2. Native shared-group invitations, explicit acceptance and server-owned membership authority.
3. A member-only shared-group status/control HTTP door.
4. A private-to-group `vy_disclosure_grant` creation flow. Existing production code reads grants and deletes them during withdrawal/erasure; it does not supply a reviewed grant-creation UI or writer.

The first vertical slice should manage an existing linked platform group from the web. Creating native shared groups is a subsequent product slice with its own invitations, membership changes, history boundaries and audience contract, not a side effect of displaying status.

## Proposed minimal vertical slice: design only

### 1. Establish both account controls

Use a verified web bearer and a server-verified platform identity to complete a short-lived, single-use link challenge. Bind it to the authenticated account, purpose, intended platform identity and expiry. The platform identity must come from the verified channel interaction, not from a web JSON field. Present an explicit account-link confirmation; linking must not imply private-memory sharing.

The writer must consume the challenge and establish the mapping atomically or through an equivalently tested conditional protocol. A replay, concurrent second consumption or different account/platform subject must fail. Neither token possession alone nor a matching display name/phone hint establishes both controls.

If the two identities already map to different people, fail closed and ask for a separately reviewed reconciliation flow. Do not update `person_id` opportunistically: doing so can combine private histories, grants and erasure scopes. Existing `linkSurfacePerson` also returns an existing mapping before considering its `personId` option, so blindly passing that option would not solve a conflict.

### 2. Read only the authenticated member's status

A new thin HTTP door can use the existing bearer verifier, but no such route is implemented by this report. Resolve the existing account bridge through a read-only query rather than calling `personForAccount` just to display status. A missing bridge is an honest unlinked state, not permission to infer one from a device ID.

For a requested group, join the caller's person to active, linked membership and the exact group/agent in the authority query. Treat request IDs only as selectors. Obtain fresh requester membership through the matching server-held platform capability before returning group-specific status. If current proof is unsupported or unavailable, return an unavailable state; do not label stored membership as freshly verified.

Initially return only minimal operational state and the caller's own linked/quiet state. No roster, other members' IDs, historical content, private sources or full `groupTurnAuthority` receipt should reach the browser. Group read-consent revocation must fail closed under the current verifier; displaying a richer stopped-state view would need its own reviewed membership-only proof, not removal of existing conditions.

### 3. Add one carefully scoped control

An authenticated own-quiet control is the smallest mutation after status. Bind person/group/agent to verified server state and repeat those conditions in the SQL mutation. A stale browser state must not authorize a new write. Keep group-wide enable/mute and broad withdrawal out of this first control until their distinct eligibility and visible scope are specified.

Privacy-reducing actions can require a different policy from enabling processing. Do not require full conversational consent merely to ask for privacy, and do not conflate "withdraw my shared participation across this AI" with "leave this group" or "forget this group's data."

### 4. Preserve disclosure boundaries

Current membership does not admit a late joiner to old episodes. A later history view must use the source/episode participant predicates, not just the status authorization. Account linking and group joining must not create private-to-group grants. Any future grant flow must show the exact material, recipients, purpose, policy version and revocation/dependency behavior before recording explicit consent.

## Required verification before promotion

All cases below are planned, not executed by this audit:

- Actual HTTP auth boundary: missing/forged bearer; client-supplied user/person/device ignored or rejected; a private follower Room session rejected as group authority.
- Exact scope: guessed group, wrong agent, same platform ID on another surface, mismatched account/surface mapping, and an agent owner who is not a member reveal no group data and perform no mutation.
- Membership freshness: unlinked, departed, withdrawn and rejoined members; missing platform proof; platform departure after a stored membership read; revocation between status and mutation; unavailable proof is not an empty-success state.
- Linking: expired, replayed, cross-account and cross-platform challenge; two concurrent consumers; existing conflicting person mappings; no automatic memory/grant merge; no privileged body-selected person ID.
- Command policy: privacy opt-out for an actual member remains possible under the adopted policy; stale events cannot silently re-enable processing; `/bolo` authorization is tested independently of mute; broad withdrawal is labelled and tested at its actual scope.
- Disclosure: owner-not-member, late joiner and private-to-group paths cannot read unsupported content; status responses contain no roster, source text or raw internal authority snapshot.
- Refusal and race controls: write-poisoned negative cases, predicate-removal mutants, actual hosted PostgreSQL statements, concurrent link consumption, and a final fresh-account browser flow with synthetic server responses before any approved live trial.

Mock/source checks cannot establish live account control, PostgreSQL race behavior or user value. Hosted synthetic SQL can verify the conditional database contract, but a consenting non-production participant group and explicitly approved environment/budget are still required for a real end-to-end demonstration. No such authority was assumed or consumed here.

## Decision and reversal condition

Proposed decision: prioritize explicit account linking and member-only status before native group control UI, and keep creator operational views separate. Do not create a frontend that relies on invented scope or endpoints.

Revisit this ordering if a connected, tested production account-link caller is found, or if the user explicitly chooses a new native-only group identity/invitation model. Either alternative still needs actual caller tests and cannot treat ownership, device possession or a private Room session as group membership.

Sources for this report are the named local source/schema files and the one synthetic execution above. No external primary documentation or live service was consulted for this bounded audit.
