import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHeldRequestBarrier } from './held-request.mjs';

export async function runBarrierControls() {
  let count = 0;
  const check = async (name, fn) => { await fn(); count++; console.log('PASS fixture barrier ' + name); };
  const clock = () => {
    let callback = null;
    return { schedule(fn) { callback = fn; return fn; }, cancel(fn) { if (callback === fn) callback = null; }, fire() { assert(callback); const fn = callback; callback = null; fn(); } };
  };
  await check('click completion cannot stand in for actual matching request arrival', async () => {
    const barrier = createHeldRequestBarrier(), arrived = barrier.expect('publication-post');
    let seen = false, releases = 0;
    void arrived.then(() => { seen = true; });
    await Promise.resolve();
    assert.equal(seen, false); assert.equal(barrier.size, 0);
    barrier.hold('publication-post', barrier.generation, () => { releases++; });
    const request = await arrived;
    assert.equal(seen, true); assert.equal(barrier.size, 1); assert.equal(releases, 0);
    barrier.release(request); assert.equal(releases, 1); assert.equal(barrier.size, 0);
    assert.throws(() => barrier.release(request), /invalid_release/);
  });
  await check('all three exact request kinds work and wrong kind cannot fulfill an expectation', async () => {
    for (const kind of ['publication-read', 'publication-post', 'draft-load']) {
      const barrier = createHeldRequestBarrier(), arrived = barrier.expect(kind);
      assert.throws(() => barrier.hold(kind === 'draft-load' ? 'publication-post' : 'draft-load', barrier.generation, () => {}), /unexpected_held_request/);
      assert.equal(barrier.size, 0);
      barrier.hold(kind, barrier.generation, () => {});
      const request = await arrived;
      assert.equal(request.kind, kind); assert.equal(request.generation, 0);
      assert.throws(() => barrier.hold(kind, barrier.generation, () => {}), /unexpected_held_request/);
      barrier.release(request);
    }
  });
  await check('generation reset rejects waiting and old-scope requests cannot resolve new waiting', async () => {
    const barrier = createHeldRequestBarrier(), oldGeneration = barrier.generation;
    const old = barrier.expect('publication-post'); barrier.reset();
    await assert.rejects(old, /generation_reset/);
    const current = barrier.expect('publication-post');
    assert.throws(() => barrier.hold('publication-post', oldGeneration, () => {}), /unexpected_held_request/);
    barrier.hold('publication-post', barrier.generation, () => {});
    const request = await current; barrier.release(request);
  });
  await check('missing request fails at a deterministic deadline instead of passing as zero pending', async () => {
    const time = clock(), barrier = createHeldRequestBarrier(time), arrived = barrier.expect('publication-read');
    time.fire(); await assert.rejects(arrived, /held_request_timeout/);
    assert.equal(barrier.size, 0);
    assert.throws(() => barrier.hold('publication-read', barrier.generation, () => {}), /unexpected_held_request/);
  });
  await check('held identity and exact one-request invariant reject fabricated releases and overlapping arms', async () => {
    const barrier = createHeldRequestBarrier(), arrived = barrier.expect('draft-load');
    assert.throws(() => barrier.assertIdle(), /unreleased_request/);
    assert.throws(() => barrier.expect('draft-load'), /invalid_expectation/);
    assert.throws(() => barrier.hold('draft-load', barrier.generation, null), /unexpected_held_request/);
    barrier.hold('draft-load', barrier.generation, () => {}); const request = await arrived;
    assert.throws(() => barrier.assertIdle(), /unreleased_request/);
    assert.throws(() => barrier.release({ ...request }), /invalid_release/);
    assert.throws(() => barrier.expect('publication-read'), /invalid_expectation/);
    barrier.release(request); barrier.assertIdle();
  });
  await check('cleanup releases exactly once and cancels the already satisfied deadline', async () => {
    const time = clock(), barrier = createHeldRequestBarrier(time), arrived = barrier.expect('publication-post');
    let releases = 0;
    barrier.hold('publication-post', barrier.generation, () => { releases++; });
    await arrived; assert.throws(() => time.fire());
    barrier.reset(); barrier.reset(); assert.equal(releases, 1); assert.equal(barrier.generation, 2);
  });
  const mounted = readFileSync(new URL('./mounted.mjs', import.meta.url), 'utf8');
  const host = readFileSync(new URL('./host.tsx', import.meta.url), 'utf8');
  await check('safe source/build modes precede HTTP and browser imports', () => {
    const sourceExit = mounted.indexOf("if (process.argv.includes('--source-only'))"), buildExit = mounted.indexOf("if (process.argv.includes('--build-only'))");
    assert(sourceExit >= 0 && buildExit > sourceExit);
    for (const dependency of ['node:http', 'playwright']) {
      assert(!new RegExp(`^import .*from ['"]${dependency}['"]`, 'm').test(mounted));
      assert(mounted.indexOf(`await import('${dependency}')`) > buildExit);
    }
    assert(mounted.indexOf("process.env.GITHUB_ACTIONS !== 'true'") > buildExit);
  });
  await check('host commit witness is written by an effect rather than the scope setter', () => {
    assert.match(host, /useEffect\(\(\)=>\{committed\.current=/);
    assert.match(host, /committed:\(\)=>committed\.current/);
    assert.match(mounted, /committed\.generation>before\.generation/);
    assert.match(mounted, /await mutateCommitted\('scope'\);await releaseHeld\(held\)/);
    assert.match(mounted, /heldRequests\.assertIdle\(\);heldRequests\.reset\(\)/);
    assert.doesNotMatch(mounted, /pending\.length|pending\.shift/);
  });
  return count;
}
