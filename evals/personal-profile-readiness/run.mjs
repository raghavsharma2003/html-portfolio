// Focused owner-profile readiness fencing. Vite loads the real TSX module;
// no browser, database, provider, or cloud operation is involved.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../", import.meta.url));
const vite = await createServer({
  root,
  logLevel: "silent",
  appType: "custom",
  server: { middlewareMode: true },
});

let count = 0;
async function check(name, work) {
  await work();
  count += 1;
  console.log(`PASS ${name}`);
}

try {
  const { recheckPersonalSheetRuntime } = await vite.ssrLoadModule("/src/studio/StudioApp.tsx");
  const base = {
    operation: 4,
    accountRevision: 8,
    userId: "11111111-1111-4111-8111-111111111111",
    accessToken: "account-a-token",
    replicaId: "33333333-3333-4333-8333-333333333333",
  };
  const runtime = { replica_id: base.replicaId, active: false, text_ready: true };

  await check("current server runtime result replaces readiness", async () => {
    const commits = [];
    const committed = await recheckPersonalSheetRuntime({
      scope: base,
      currentScope: () => ({ ...base }),
      read: async () => runtime,
      commit: value => commits.push(value),
    });
    assert.equal(committed, true);
    assert.deepEqual(commits, [runtime]);
  });

  await check("account switch drops an old runtime response", async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let current = { ...base };
    const commits = [];
    const result = recheckPersonalSheetRuntime({
      scope: base,
      currentScope: () => current,
      read: () => pending,
      commit: value => commits.push(value),
    });
    current = {
      ...base,
      accountRevision: base.accountRevision + 1,
      userId: "22222222-2222-4222-8222-222222222222",
      accessToken: "account-b-token",
    };
    release(runtime);
    assert.equal(await result, false);
    assert.deepEqual(commits, []);
  });

  await check("newer profile operation drops an older same-account response", async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let current = { ...base };
    const commits = [];
    const result = recheckPersonalSheetRuntime({
      scope: base,
      currentScope: () => current,
      read: () => pending,
      commit: value => commits.push(value),
    });
    current = { ...base, operation: base.operation + 1 };
    release(runtime);
    assert.equal(await result, false);
    assert.deepEqual(commits, []);
  });

  console.log(`${count}/${count} focused personal-profile readiness checks passed`);
} finally {
  await vite.close();
}
