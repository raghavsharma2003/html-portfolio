import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
let controls = 0;
const check = (name, test) => { test(); console.log(`PASS ${++controls} ${name}`); };
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
  check(`${status} own writing is teachable without a phrase-proposal count`, () => assert.equal(predicateContext.teachable({ ...source, status }), true));
for (const patch of [
  { kind: "link" }, { status: "pending" }, { extracted_chars: 0 }, { consent_scope: "own_turns_only" },
  { authorship: "unknown" }, { authorship: "not_mine" }, { format: "image" },
]) check(`ineligible source ${JSON.stringify(patch)}`, () => assert.equal(predicateContext.teachable({ ...source, ...patch }), false));

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
const callbackSource = callback.getText(cloneAst);
const reviewHelpers = { exports: {} };
runInNewContext(ts.transpileModule(readFileSync(root + "src/studio/sourceAwareReview.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, reviewHelpers);
const idAst = ts.createSourceFile("privateTextRehearsalApi.ts", readFileSync(root + "src/studio/privateTextRehearsalApi.ts", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const idPredicate = idAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "isPrivateTextId");
assert(idPredicate, "actual source-ID validator");
runInNewContext(ts.transpileModule(idPredicate.getText(idAst), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, reviewHelpers);
const RID = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000002", ITEM = source.item_id;
function fixture(callbackText = callbackSource) {
  const rooms = [], selections = [];
  const context = {
    reissueMounted: { current: true }, identity: "owner-a", accessToken: "token-a", selected: { replica_id: RID },
    accountScope: "account-a", ownerUserId: "owner-user-a",
    reviewOwnerScope: JSON.stringify(["owner-a", "account-a", "owner-user-a"]),
    reissueCurrent: { current: { identity: "owner-a", accessToken: "token-a", selected: { replica_id: RID }, accountScope: "account-a", ownerUserId: "owner-user-a" } },
    isPrivateTextId: reviewHelpers.exports.isPrivateTextId, chooseRoom: (room) => rooms.push(room),
    setReviewSource: (selection) => selections.push(JSON.parse(JSON.stringify(selection))),
    reviewSourceLabel: reviewHelpers.exports.reviewSourceLabel,
  };
  runInNewContext(ts.transpileModule(`globalThis.teach=${callbackText};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText, context);
  return { context, rooms, selections };
}
function assertSelected(f, label = "Selected source") {
  assert.deepEqual(f.rooms, ["evolve"], "current saved source opens explicit extraction and review");
  assert.deepEqual(f.selections, [{ ownerScope: f.context.reviewOwnerScope, token: "token-a", replicaId: RID, itemId: ITEM, label }], "source selection must accompany navigation");
}
check("current source reaches review with its exact owner/token/replica/item selection", () => {
  const f = fixture(); f.context.teach({ replicaId: RID, itemId: ITEM }); assertSelected(f);
});
const staleCases = [
  ["wrong source replica", (_context, selected) => { selected.replicaId = OTHER; }],
  ["malformed item", (_context, selected) => { selected.itemId = "bad"; }],
  ["identity changed", (context) => { context.reissueCurrent.current.identity = "owner-b"; }],
  ["token changed", (context) => { context.reissueCurrent.current.accessToken = "token-b"; }],
  ["selected replica changed", (context) => { context.reissueCurrent.current.selected = { replica_id: OTHER }; }],
  ["unmounted", (context) => { context.reissueMounted.current = false; }],
  ["account scope changed", (context) => { context.reissueCurrent.current.accountScope = "account-b"; }],
  ["owner user changed", (context) => { context.reissueCurrent.current.ownerUserId = "owner-user-b"; }],
];
function assertStaleSuppressed(callbackText, mutate) {
  const f = fixture(callbackText), selected = { replicaId: RID, itemId: ITEM };
  mutate(f.context, selected); f.context.teach(selected);
  assert.deepEqual(f.rooms, [], "stale callback cannot navigate");
  assert.deepEqual(f.selections, [], "stale callback cannot retain a source selection");
}
for (const [name, mutate] of staleCases) check(`${name} cannot navigate or retain source`, () => assertStaleSuppressed(callbackSource, mutate));
for (const [supplied, expected] of [["  Art method.txt  ", "Art method.txt"], ["https://private.example/source", "Selected source"]]) {
  check(`actual label projection for ${JSON.stringify(supplied)}`, () => {
    const f = fixture(); f.context.teach({ replicaId: RID, itemId: ITEM, label: supplied }); assertSelected(f, expected);
  });
}
function mutateCallback(from, to) {
  assert.equal(callbackSource.split(from).length - 1, 1, "unique actual callback mutation anchor");
  return callbackSource.replace(from, to);
}
for (const [name, anchor, stale] of [
  ["account scope", "reissueCurrent.current.accountScope !== accountScope", staleCases[6][1]],
  ["owner user", "reissueCurrent.current.ownerUserId !== ownerUserId", staleCases[7][1]],
]) check(`mutation: missing ${name} guard is rejected`, () => {
  assert.throws(() => assertStaleSuppressed(mutateCallback(anchor, "false"), stale), /stale callback cannot navigate/);
});
check("mutation: navigation without selected-source state is rejected", () => {
  const f = fixture(mutateCallback("setReviewSource(", "void ("));
  f.context.teach({ replicaId: RID, itemId: ITEM });
  assert.throws(() => assertSelected(f), /source selection must accompany navigation/);
});
check("locker teach action remains conditional on a teachable source", () => assert.match(lockerSource, /onTeachSource && teachableSource/));
check("locker teach action keeps its label", () => assert.match(lockerSource, />\{teachSourceLabel\}<\/button>/));
console.log(`PASS ${controls} teach-path source/scope/mutation groups; no browser, API, database, or provider claim.`);
