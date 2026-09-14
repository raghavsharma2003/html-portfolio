import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const lockerSource = readFileSync(root + "src/studio/ContextLockerPanel.tsx", "utf8");
const lockerAst = ts.createSourceFile("ContextLockerPanel.tsx", lockerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const predicate = lockerAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "isTeachableContextSource");
assert(predicate, "actual teachable-source predicate");
const predicateCode = ts.transpileModule(`${predicate.getText(lockerAst).replace(/^export /, "")}\nglobalThis.teachable=isTeachableContextSource;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const predicateContext = {};
runInNewContext(predicateCode, predicateContext);

const source = {
  item_id: "30000000-0000-4000-8000-000000000001",
  kind: "file",
  status: "extracted",
  extracted_chars: 240,
  consent_scope: "own_context",
  authorship: "mine",
  format: "text",
  proposal: null,
};
for (const status of ["extracted", "mined"])
  assert.equal(predicateContext.teachable({ ...source, status }), true, `${status} own writing is teachable without a phrase-proposal count`);
for (const patch of [
  { kind: "link" }, { status: "pending" }, { extracted_chars: 0 }, { consent_scope: "own_turns_only" },
  { authorship: "unknown" }, { authorship: "not_mine" }, { format: "image" },
]) assert.equal(predicateContext.teachable({ ...source, ...patch }), false, `ineligible source ${JSON.stringify(patch)}`);

const cloneSource = readFileSync(root + "src/studio/CloneExperience.tsx", "utf8");
const cloneAst = ts.createSourceFile("CloneExperience.tsx", cloneSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(cloneAst) === "onTeachSource"
    && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) callback = node.initializer.expression;
  ts.forEachChild(node, visit);
}
visit(cloneAst);
assert(callback, "actual CloneExperience teach callback");
const callbackCode = ts.transpileModule(`globalThis.teach=${callback.getText(cloneAst)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const RID = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000002", ITEM = source.item_id;
const rooms = [];
const callbackContext = {
  reissueMounted: { current: true }, identity: "owner-a", accessToken: "token-a", selected: { replica_id: RID },
  reissueCurrent: { current: { identity: "owner-a", accessToken: "token-a", selected: { replica_id: RID } } },
  isPrivateTextId: (value) => /^[0-9a-f-]{36}$/.test(value), chooseRoom: (room) => rooms.push(room),
};
runInNewContext(callbackCode, callbackContext);
callbackContext.teach({ replicaId: RID, itemId: ITEM });
assert.deepEqual(rooms, ["evolve"], "current saved source opens explicit extraction and review");
for (const stale of [
  () => callbackContext.teach({ replicaId: OTHER, itemId: ITEM }),
  () => callbackContext.teach({ replicaId: RID, itemId: "bad" }),
  () => { callbackContext.reissueCurrent.current.identity = "owner-b"; callbackContext.teach({ replicaId: RID, itemId: ITEM }); },
  () => { callbackContext.reissueCurrent.current.identity = "owner-a"; callbackContext.reissueCurrent.current.accessToken = "token-b"; callbackContext.teach({ replicaId: RID, itemId: ITEM }); },
  () => { callbackContext.reissueCurrent.current.accessToken = "token-a"; callbackContext.reissueCurrent.current.selected = { replica_id: OTHER }; callbackContext.teach({ replicaId: RID, itemId: ITEM }); },
  () => { callbackContext.reissueCurrent.current.selected = { replica_id: RID }; callbackContext.reissueMounted.current = false; callbackContext.teach({ replicaId: RID, itemId: ITEM }); },
]) stale();
assert.deepEqual(rooms, ["evolve"], "stale account, token, replica, item, and unmounted callbacks cannot navigate");
assert.match(lockerSource, /onTeachSource && teachableSource/);
// WS-R166 moved the button's own default label into the studio copy
// registry (src/studio/copy.ts's EN_CONTEXT_LOCKER_PANEL.teachYourAi, byte
// identical to the pre-conversion default "Teach your AI"); the button now
// renders `resolvedTeachSourceLabel` (the `teachSourceLabel` prop override,
// falling back to the registry value) rather than the raw prop directly.
// This freezes the PROPERTY (an override-or-registry-default label renders
// inside the button), not the exact variable name
// (context/rejected.md#frozen-file-merge-controls-break-on-the-next-change).
assert.match(lockerSource, /const resolvedTeachSourceLabel = teachSourceLabel \?\? copy\.teachYourAi;/);
assert.match(lockerSource, />\{resolvedTeachSourceLabel\}<\/button>/);
const copySource = readFileSync(root + "src/studio/copy.ts", "utf8");
assert.match(copySource, /teachYourAi: "Teach your AI",/);
console.log("PASS 16 teach-path source and scope controls; no browser, API, database, or provider claim.");
