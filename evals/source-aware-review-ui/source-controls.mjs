import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { activityFixture } from './activity-fixture.mjs';
import { ITEM, OTHER_ITEM, RID, OTHER_RID, SOURCE, EXCERPT, SOURCE_NAME, citation, transcript, claims, personStatus, extractionStatus } from './fixtures.mjs';

const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const moduleFrom = async source => import('data:text/javascript;base64,' + Buffer.from(transpile(source)).toString('base64'));
function nodeMatching(source, predicate) {
  const ast = ts.createSourceFile('actual.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const walk = node => { if (predicate(node)) { assert.equal(found, undefined, 'unique actual source node'); found = node; } ts.forEachChild(node, walk); };
  walk(ast); assert(found, 'actual production node exists'); return found.getText(ast);
}
function changeOnce(source, before, after) { assert.equal(source.split(before).length - 1, 1, `one mutation site: ${before}`); return source.replace(before, after); }

export async function sourceControls(root) {
  const groups = [];
  const check = (name, fn) => { fn(); groups.push(name); console.log('PASS source ' + name); };
  const activityScope = { token: 'synthetic-review-a', replicaId: RID };
  const activityRequest = { method: 'GET', url: new URL(`http://synthetic-fixture/api/replica-activity?replica_id=${RID}&unchanged=0`), authorization: 'Bearer synthetic-review-a' };
  check('inert activity fixture accepts only the current authenticated replica', () => {
    for (const scope of [activityScope, { ...activityScope, token: 'synthetic-review-b' }, { ...activityScope, replicaId: OTHER_RID }]) {
      const url = new URL(activityRequest.url); url.searchParams.set('replica_id', scope.replicaId);
      const view = activityFixture({ ...activityRequest, url, authorization: `Bearer ${scope.token}` }, scope);
      assert.deepEqual(view, { replica_id: scope.replicaId, generated_at: '2026-09-29T00:00:00Z', jobs: [], lanes: [], in_flight: false, next_poll_ms: null });
    }
    for (const authorization of [undefined, 'Bearer not-a-fixture-token', 'Bearer synthetic-review-b']) {
      assert.throws(() => activityFixture({ ...activityRequest, authorization }, activityScope), /authorization/);
    }
    const other = new URL(activityRequest.url); other.searchParams.set('replica_id', OTHER_RID);
    assert.throws(() => activityFixture({ ...activityRequest, url: other }, activityScope), /replica matches/);
    assert.throws(() => activityFixture(activityRequest, { ...activityScope, replicaId: OTHER_RID }), /replica matches/);
  });
  check('activity fixture leaves unknown routes/methods rejected and fails malformed reads', () => {
    for (const method of ['POST', 'DELETE', 'PATCH', 'OPTIONS']) assert.equal(activityFixture({ ...activityRequest, method }, activityScope), null);
    for (const path of ['/api/replica-activity/other', '/api/unknown']) {
      const url = new URL(activityRequest.url); url.pathname = path;
      assert.equal(activityFixture({ ...activityRequest, url }, activityScope), null);
    }
    for (const query of [`replica_id=${RID}`, `replica_id=${RID}&unchanged=0&unexpected=1`, `replica_id=${RID}&replica_id=${OTHER_RID}&unchanged=0`,
      `replica_id=${RID}&unchanged=-1`, `replica_id=${RID}&unchanged=NaN`, `replica_id=${RID}&unchanged=0&unchanged=1`, `replica_id=${RID}&unchanged=9007199254740992`]) {
      assert.throws(() => activityFixture({ ...activityRequest, url: new URL(`http://synthetic-fixture/api/replica-activity?${query}`) }, activityScope));
    }
    assert.throws(() => activityFixture({ ...activityRequest, raw: '{}' }, activityScope), /no request body/);
    const runner = readFileSync(join(root, 'evals/source-aware-review-ui/run.mjs'), 'utf8');
    assert(runner.includes('unknownRequests.push({ path: url.pathname, method: req.method })'));
    assert(runner.includes('assert.deepEqual(unknownRequests, []); assert.deepEqual(errors, []);'));
  });
  const activityApi = readFileSync(join(root, 'src/studio/activityApi.ts'), 'utf8');
  const replicaApi = readFileSync(join(root, 'src/studio/replicaApi.ts'), 'utf8');
  const activityRead = nodeMatching(activityApi, node => ts.isFunctionDeclaration(node) && node.name?.text === 'fetchActivity');
  const replicaRead = nodeMatching(replicaApi, node => ts.isFunctionDeclaration(node) && node.name?.text === 'replicaRequest');
  const wireRequests = [];
  const wire = { AbortSignal, encodeURIComponent, fetch: async (path, init) => {
    wireRequests.push({ path, init });
    const view = activityFixture({ method: init.method || 'GET', url: new URL(path, 'http://synthetic-fixture'), authorization: init.headers.Authorization, raw: init.body || '' }, activityScope);
    assert(view); return { ok: true, status: 200, json: async () => view };
  } };
  runInNewContext(transpile(`${replicaRead.replace(/^export /, '')}\n${activityRead.replace(/^export /, '')}\nglobalThis.readActivity = fetchActivity;`), wire);
  const view = await wire.readActivity(activityScope.token, activityScope.replicaId);
  check('actual activityApi and replicaRequest serialize into the inert direct-view contract', () => {
    assert.equal(wireRequests.length, 1); assert.equal(view.replica_id, RID);
    assert.equal(view.next_poll_ms, null); assert.equal(view.in_flight, false);
    assert.deepEqual(view.jobs, []); assert.deepEqual(view.lanes, []);
    assert.equal(Object.hasOwn(view, 'activity'), false);
  });
  const source = readFileSync(join(root, 'src/studio/sourceAwareReview.ts'), 'utf8');
  const helper = await moduleFrom(source);
  check('exact Hindi, emoji and CRLF preserved in typed document citation', () => {
    const result = helper.reviewCitation(citation()); assert(result); assert.equal(result.excerpt, EXCERPT);
    assert.equal(result.citation.end_char - result.citation.start_char, EXCERPT.length);
    assert.equal(result.source_locator.start_char, 103); assert.equal(result.source_locator.page_mapping, 'unavailable');
  });
  check('document and transcription coordinate spaces stay distinct', () => {
    for (const modality of ['audio', 'video']) {
      const value = helper.reviewCitation(transcript(modality)); assert(value);
      assert.equal(value.source_locator.relative_to, 'transcription_input'); assert.equal(value.source_locator.start_ms, 1200);
      assert(value.limitations.includes('original_source_time_mapping_unavailable'));
      assert.equal(value.limitations.includes('visual_content_not_observed'), modality === 'video');
    }
  });
  check('legacy excerpt remains explicitly untyped', () => {
    const legacy = { excerpt: EXCERPT, entailment: 0.8 };
    assert.deepEqual(helper.reviewCitation(legacy), legacy); assert.equal(helper.isSourceAwareCitation(legacy), false);
    assert.equal(helper.claimMatchesReviewSource({ citation_previews: [legacy] }, ITEM), false);
  });
  check('malformed or partially typed evidence never downgrades to legacy', () => {
    const patches = [{ modality: 'image' }, { source_id: '' }, { context_item_id: 'bad' }, { format: 'png' }, { evidence_type: 'unknown' },
      { entailment: NaN }, { excerpt: '' }, { interpretation: 'visual_inference' }, { limitations: [] }, { private_path: '/not-for-output' }];
    for (const patch of patches) assert.equal(helper.reviewCitation(citation(patch)), null, JSON.stringify(patch));
    for (const key of ['source_id', 'evidence_id', 'citation', 'source_locator', 'interpretation']) { const row = citation(); delete row[key]; assert.equal(helper.reviewCitation(row), null, key); }
    for (const patch of [{ relative_to: 'original_recording' }, { start_ms: -1 }, { end_ms: 1200 }]) {
      const row = transcript(); Object.assign(row.source_locator, patch); assert.equal(helper.reviewCitation(row), null);
    }
  });
  check('actual selection uses context item identity, never source ID or unrelated evidence', () => {
    assert.notEqual(SOURCE, ITEM); const rows = claims();
    assert.equal(helper.claimMatchesReviewSource(rows[0], ITEM), true);
    assert.equal(helper.claimMatchesReviewSource(rows[0], SOURCE), false);
    assert.equal(helper.claimMatchesReviewSource(rows[1], ITEM), false);
    assert.equal(helper.claimMatchesReviewSource(rows[0], 'invalid'), false);
    assert.equal(helper.claimMatchesReviewSource(rows[6], ITEM), false);
  });
  check('fifth verified citation still matches selected item', () => {
    const fifth = claims()[2]; assert.equal(fifth.citation_previews.length, 5);
    assert(fifth.citation_previews.slice(0, 4).every(row => row.context_item_id === OTHER_ITEM));
    assert.equal(helper.claimMatchesReviewSource(fifth, ITEM), true);
  });
  check('labels do not expose raw IDs, URLs or control characters', () => {
    assert.equal(helper.reviewSourceLabel(SOURCE_NAME), SOURCE_NAME);
    for (const bad of [null, ITEM, 'https://private.invalid/token', 'www.private.invalid/path']) assert.equal(helper.reviewSourceLabel(bad), 'Selected source');
    assert.equal(helper.reviewSourceLabel('  A\u202eB\nC  '), 'A B C');
    assert.equal(Array.from(helper.reviewSourceLabel('🙂'.repeat(200))).length, 160);
  });
  const wrongId = await moduleFrom(changeOnce(source, 'citation.context_item_id?.toLowerCase()', 'citation.source_id?.toLowerCase()'));
  const firstFour = await moduleFrom(changeOnce(source, 'claim.citation_previews.some(value => {', 'claim.citation_previews.slice(0, 4).some(value => {'));
  check('negative mutations detect source-ID confusion and fifth-citation truncation', () => {
    assert.equal(wrongId.claimMatchesReviewSource(claims()[0], ITEM), false);
    assert.equal(firstFour.claimMatchesReviewSource(claims()[2], ITEM), false);
    assert.equal(helper.claimMatchesReviewSource(claims()[0], ITEM), true);
    assert.equal(helper.claimMatchesReviewSource(claims()[2], ITEM), true);
  });

  const clone = readFileSync(join(root, 'src/studio/CloneExperience.tsx'), 'utf8');
  const callbackAttr = nodeMatching(clone, node => ts.isJsxAttribute(node) && node.name.getText() === 'onTeachSource');
  const callback = callbackAttr.slice(callbackAttr.indexOf('{') + 1, -1);
  function runTeach(text, patch = {}) {
    const selections = [], rooms = [];
    const env = { identity: 'owner-a', accountScope: 'account-a', ownerUserId: 'user-a', reviewOwnerScope: 'review-owner-a', accessToken: 'token-a',
      selected: { replica_id: RID }, reissueMounted: { current: true },
      reissueCurrent: { current: { identity: 'owner-a', accountScope: 'account-a', ownerUserId: 'user-a', accessToken: 'token-a', selected: { replica_id: RID } } },
      isPrivateTextId: value => /^[0-9a-f-]{36}$/i.test(value), reviewSourceLabel: helper.reviewSourceLabel,
      setReviewSource: value => selections.push(value), chooseRoom: value => rooms.push(value), ...patch };
    runInNewContext(transpile(`globalThis.teach = ${text};`), env);
    env.teach(patch.input ?? { replicaId: RID, itemId: ITEM, label: SOURCE_NAME });
    return { selections, rooms };
  }
  check('real CloneExperience Teach callback preserves chosen item and label', () => {
    const result = runTeach(callback); assert.equal(result.selections.length, 1); assert.equal(result.selections[0].itemId, ITEM);
    assert.equal(result.selections[0].label, SOURCE_NAME); assert.equal(result.selections[0].replicaId, RID);
    assert.deepEqual(result.rooms, ['evolve']);
  });
  const transitions = [
    ['identity', 'owner-b', 'reissueCurrent.current.identity !== identity'],
    ['accountScope', 'account-b', 'reissueCurrent.current.accountScope !== accountScope'],
    ['ownerUserId', 'user-b', 'reissueCurrent.current.ownerUserId !== ownerUserId'],
    ['accessToken', 'token-b', 'reissueCurrent.current.accessToken !== accessToken'],
    ['selected', { replica_id: OTHER_RID }, 'reissueCurrent.current.selected?.replica_id !== source.replicaId'],
  ];
  check('actual Teach callback refuses stale identity, account, user, token and replica', () => {
    for (const [key, value] of transitions) {
      const current = { identity: 'owner-a', accountScope: 'account-a', ownerUserId: 'user-a', accessToken: 'token-a', selected: { replica_id: RID }, [key]: value };
      assert.equal(runTeach(callback, { reissueCurrent: { current } }).selections.length, 0, key);
    }
    assert.equal(runTeach(callback, { reissueMounted: { current: false } }).selections.length, 0);
    assert.equal(runTeach(callback, { input: { replicaId: OTHER_RID, itemId: ITEM } }).selections.length, 0);
    assert.equal(runTeach(callback, { input: { replicaId: RID, itemId: 'bad' } }).selections.length, 0);
  });
  check('five scope guard removal mutations each expose the forbidden callback', () => {
    for (const [key, value, guard] of transitions) {
      const mutated = changeOnce(callback, guard, 'false');
      const current = { identity: 'owner-a', accountScope: 'account-a', ownerUserId: 'user-a', accessToken: 'token-a', selected: { replica_id: RID }, [key]: value };
      assert.equal(runTeach(mutated, { reissueCurrent: { current } }).selections.length, 1, key);
    }
  });
  const selectedDecl = nodeMatching(clone, node => ts.isVariableDeclaration(node) && node.name.getText() === 'currentReviewSource');
  const selectedExpression = selectedDecl.slice(selectedDecl.indexOf('=') + 1);
  function retainedSelection(text, patch = {}) {
    const env = { reviewSource: { itemId: ITEM, ownerScope: 'owner-a', token: 'token-a', replicaId: RID },
      reviewOwnerScope: 'owner-a', accessToken: 'token-a', selected: { replica_id: RID }, ...patch };
    runInNewContext(transpile(`globalThis.result = ${text};`), env); return env.result;
  }
  check('actual parent render refuses retained selected item across owner, token and replica replacement', () => {
    assert.equal(retainedSelection(selectedExpression).itemId, ITEM);
    for (const [patch, guard] of [
      [{ reviewOwnerScope: 'owner-b' }, 'reviewSource.ownerScope === reviewOwnerScope'],
      [{ accessToken: 'token-b' }, 'reviewSource.token === accessToken'],
      [{ selected: { replica_id: OTHER_RID } }, 'reviewSource.replicaId === selected?.replica_id'],
    ]) {
      assert.equal(retainedSelection(selectedExpression, patch), null);
      assert.equal(retainedSelection(changeOnce(selectedExpression, guard, 'true'), patch).itemId, ITEM);
    }
  });
  const panel = readFileSync(join(root, 'src/studio/PersonModelStudio.tsx'), 'utf8');
  const loadDecl = nodeMatching(panel, node => ts.isVariableDeclaration(node) && node.name.getText() === 'load');
  const loadAst = ts.createSourceFile('load.tsx', `const ${loadDecl};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const load = loadAst.statements[0].declarationList.declarations[0].initializer.arguments[0].getText(loadAst);
  async function delayedRead(text, stop) {
    let resolveRead; const emitted = []; const scope = { current: true };
    const env = { mounted: { current: true }, readRevision: { current: 0 }, extractionRevision: { current: 0 }, replicaId: RID, token: 'synthetic',
      scopeIsCurrent: () => scope.current, setLoading: () => {}, setError: () => {}, setExtractionError: () => {}, setExtraction: () => {},
      setStatus: value => emitted.push(value), onAuthError: () => {}, ReplicaApiError: class extends Error {},
      readPersonModel: () => new Promise(resolve => { resolveRead = resolve; }), readClaimExtraction: async () => extractionStatus(RID) };
    runInNewContext(transpile(`globalThis.load = ${text};`), env);
    const pending = env.load(); stop(env, scope); resolveRead(personStatus()); await pending; return emitted;
  }
  assert.equal((await delayedRead(load, () => {})).length, 1);
  for (const stop of [(_env, scope) => { scope.current = false; }, env => { env.mounted.current = false; }, env => { env.readRevision.current++; }]) assert.equal((await delayedRead(load, stop)).length, 0);
  groups.push('actual async read rejects retired scope, unmount and superseded request'); console.log('PASS source ' + groups.at(-1));
  const noWitness = changeOnce(load, 'scopeIsCurrent() && ', '');
  assert.equal((await delayedRead(noWitness, (_env, scope) => { scope.current = false; })).length, 1);
  groups.push('negative scope-witness mutation admits stale read and is detected'); console.log('PASS source ' + groups.at(-1));
  return groups;
}
