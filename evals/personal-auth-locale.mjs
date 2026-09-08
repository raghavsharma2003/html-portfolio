// Offline source contracts. No browser, provider, database or generated audio.
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, transform } from "esbuild";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = await mkdtemp(join(tmpdir(), "personal-auth-locale-"));
const priorWindow = globalThis.window;
const priorStorage = globalThis.localStorage;
let checks = 0;
function check(name, run) { run(); checks++; console.log(`ok ${name}`); }
function leaves(value, prefix = "") {
  return Object.entries(value).flatMap(([key, item]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof item === "object" ? leaves(item, path) : [[path, item]];
  });
}
function functionText(source, name) {
  const tree = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const walk = node => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(tree); ts.forEachChild(node, walk); };
  walk(tree);
  assert.ok(found, `Actual source function ${name} exists`);
  return found;
}
try {
  const entry = join(out, "entry.ts");
  await writeFile(entry, `export * from ${JSON.stringify(join(root, "src/creatorStudio/copy.ts"))};\nexport * from ${JSON.stringify(join(root, "src/creatorStudio/studioLocalePreference.ts"))};\nexport * from ${JSON.stringify(join(root, "src/studio/personalAuthCopyRegistry.ts"))};\nexport { readPersonalAuthLocale } from ${JSON.stringify(join(root, "src/studio/personalAuthLocale.tsx"))};`);
  const bundle = join(out, "entry.mjs");
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, format: "esm", platform: "node", jsx: "automatic", logLevel: "silent" });
  const mod = await import(pathToFileURL(bundle).href);
  check("Hindi personal auth rejects reads before loading", () => assert.throws(() => mod.PERSONAL_AUTH_COPY_TABLE.hi.emailTitle, /personal_auth_copy_hi_not_loaded/));
  check("Hindi personal auth starts unready", () => assert.equal(mod.personalAuthCopyReady("hi"), false));
  await mod.loadPersonalAuthCopy("hi");
  check("Hindi personal auth leaf loads independently", () => {
    assert.equal(mod.personalAuthCopyReady("hi"), true);
    assert.equal(mod.studioAuthCopyReady("hi"), false);
  });
  await mod.loadStudioCopyAuth("hi");
  check("Auth loads independently of signed-in copy", () => { assert.equal(mod.studioAuthCopyReady("hi"), true); assert.equal(mod.studioCopyReady("hi"), false); assert.throws(() => mod.STUDIO_COPY_TABLE.hi.creatorPath, /studio_copy_hi_not_loaded/); });
  const en = mod.PERSONAL_AUTH_COPY_TABLE.en;
  const hi = mod.PERSONAL_AUTH_COPY_TABLE.hi;
  check("Exact nested key parity", () => assert.deepEqual(leaves(en).map(([key]) => key).sort(), leaves(hi).map(([key]) => key).sort()));
  check("Every template preserves its placeholders", () => {
    const hindi = new Map(leaves(hi));
    for (const [key, value] of leaves(en)) assert.deepEqual(value.match(/\{\w+\}/g)?.sort() ?? [], hindi.get(key).match(/\{\w+\}/g)?.sort() ?? [], key);
  });
  check("Only named eyebrows may be blank", () => { for (const [key, value] of [...leaves(en), ...leaves(hi)]) assert.ok(value.trim() || /^variant\.(generic|teacher|test)\.introEyebrow$/.test(key), key); });
  const remembered = new Map();
  globalThis.localStorage = { getItem: key => remembered.get(key) ?? null, setItem: (key, value) => remembered.set(key, value) };
  globalThis.window = { location: { search: "?lang=hi&step=meet" } };
  mod.writeRememberedStudioLocale("en");
  check("Explicit Hindi beats stored English", () => assert.equal(mod.readPersonalAuthLocale(), "hi"));
  window.location.search = "?lang=en";
  mod.writeRememberedStudioLocale("hi");
  check("Explicit English beats stored Hindi", () => assert.equal(mod.readPersonalAuthLocale(), "en"));
  for (const search of ["", "?lang=fr", "?lang="]) {
    window.location.search = search;
    check(`Stored preference survives absent or invalid query ${search}`, () => assert.equal(mod.readPersonalAuthLocale(), "hi"));
  }
  globalThis.localStorage = { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); } };
  check("Denied storage falls back without crashing", () => { assert.equal(mod.readPersonalAuthLocale(), "en"); mod.writeRememberedStudioLocale("hi"); });

  const source = await readFile(join(root, "src/studio/PersonalAuthGate.tsx"), "utf8");
  const personalLocaleSource = await readFile(join(root, "src/studio/personalAuthLocale.tsx"), "utf8");
  const preferenceSource = await readFile(join(root, "src/creatorStudio/studioLocalePreference.ts"), "utf8");
  check("Personal auth entry has no runtime dependency on the full studio copy table", () => {
    assert.doesNotMatch(personalLocaleSource, /creatorStudio\/copy/);
    assert.doesNotMatch(preferenceSource, /from\s+["']\.\/copy["']/);
  });
  const auth = functionText(source, "PersonalAuthGate");
  check("No provider message rendered in auth error state", () => {
    assert.doesNotMatch(auth, /cause\.message|error\.message|replaceAll\("_"/);
    assert.match(auth, /\{(?:String\()?t\[error\]\)?\}/);
  });
  const entrySource = await readFile(join(root, "src/studio/PersonalStudioEntry.tsx"), "utf8");
  const appSource = await readFile(join(root, "src/studio/StudioApp.tsx"), "utf8");
  const mainSource = await readFile(join(root, "src/studio/personalMain.tsx"), "utf8");
  check("Signed-out entry does not statically reach the workspace", () => {
    assert.match(mainSource, /import PersonalStudioEntry from "\.\/PersonalStudioEntry"/);
    assert.doesNotMatch(mainSource, /import StudioApp/);
    assert.match(entrySource, /const loadStudioApp[^\n]*=> import\("\.\/StudioApp"\)/);
    assert.match(entrySource, /useMemo\(\(\) => lazy\(loadWorkspace\)/);
  });
  check("Entry restores once before choosing auth or workspace", () => {
    assert.match(entrySource, /useEffect\(\(\) => \{[\s\S]*restore\(\)\.then[\s\S]*\}, \[restore\]\)/);
    assert.ok(entrySource.indexOf("if (!authChecked)") < entrySource.indexOf("if (!session)"));
    assert.ok(entrySource.indexOf("if (!session)") < entrySource.indexOf("<StudioApp initialSession={session} sessionAlreadyRestored />"));
  });
  check("An adopted session initializes both state and the request authority", () => {
    assert.match(appSource, /useState<StudioSession \| null>\(\(\) => initialSession\)/);
    assert.match(appSource, /useRef<StudioSession \| null>\(initialSession\)/);
    assert.match(appSource, /if \(sessionAlreadyRestored\)[\s\S]*if \(live && initialSession\) void loadReplicas\(initialSession\)/);
    assert.match(appSource, /writeStoredSession\(null\);[\s\S]*setCurrentSession\(null\)/);
  });
  // Bundle the real storage/restore implementation. Stub only the network
  // boundary, preserving actual candidate selection and erasure behavior.
  const sessionBundle = join(out, "session.mjs");
  await build({
    stdin: { contents: `export * from ${JSON.stringify(join(root, "src/studio/session.ts"))}; export { configure, refreshCalls } from ${JSON.stringify(join(root, "src/studio/studioAuth.ts"))};`, resolveDir: root },
    outfile: sessionBundle, bundle: true, format: "esm", platform: "node", logLevel: "silent",
    plugins: [{ name: "session-auth-boundary", setup(builder) {
      builder.onResolve({ filter: /(?:^|[\\/])studioAuth(?:\.ts)?$/ }, () => ({ path: "auth", namespace: "session-test" }));
      builder.onLoad({ filter: /.*/, namespace: "session-test" }, () => ({ contents: `
        let callback = null; let result = null; let failure = null; export const refreshCalls = [];
        export function configure(options) { callback = options.callback ?? null; result = options.result ?? null; failure = options.failure ?? null; refreshCalls.length = 0; }
        export function consumeStudioOAuthCallback() { const value = callback; callback = null; return value; }
        export async function ensureStudioSession(candidate) { refreshCalls.push(candidate); if (failure) throw failure; return result; }
        export function isStudioAuthDead(cause) { return [400, 401, 403].includes(cause?.status); }
      `, loader: "js" }));
    } }],
  });
  const session = await import(pathToFileURL(sessionBundle).href);
  const expired = { userId: "old-user", accessToken: "a".repeat(24), refreshToken: "old-refresh", expiresAt: 1 };
  const fresh = { userId: "fresh-user", accessToken: "b".repeat(24), refreshToken: "fresh-refresh", expiresAt: Date.now() + 60_000 };
  const callbackCandidate = { ...expired, userId: "callback-user", refreshToken: "callback-refresh" };
  let writes = 0;
  const state = new Map();
  globalThis.localStorage = { getItem: key => state.get(key) ?? null, setItem: (key, value) => { writes++; state.set(key, value); } };
  function resetSession(authValue = expired) {
    state.clear(); state.set("meera.state.v1", JSON.stringify({ unrelated: "preserved", ...(authValue ? { auth: authValue } : {}) })); writes = 0;
  }
  resetSession();
  session.configure({ failure: new TypeError("PRIVATE_PROVIDER_PAYLOAD") });
  const defaultResult = await session.restoreSession();
  check("Default restore behavior still clears failed refresh and returns null", () => {
    assert.equal(defaultResult, null); assert.equal(session.readStoredSession(), null); assert.equal(writes, 1);
    assert.equal(JSON.parse(state.get("meera.state.v1")).unrelated, "preserved");
  });
  for (const failure of [new TypeError("offline"), Object.assign(new Error("throttled"), { status: 429 }), Object.assign(new Error("unavailable"), { status: 503 })]) {
    resetSession(); session.configure({ failure });
    let returned = false;
    await assert.rejects(async () => { await session.restoreSession({ reportTransientFailure: true }); returned = true; }, error => error === failure);
    check(`Explicit transient restore ${failure.status ?? "network"} rejects without stale auth or erasure`, () => {
      assert.equal(returned, false); assert.deepEqual(session.readStoredSession(), expired); assert.equal(writes, 0); assert.deepEqual(session.refreshCalls, [expired]);
    });
  }
  for (const status of [400, 401, 403]) {
    resetSession(); session.configure({ failure: Object.assign(new Error("dead"), { status }) });
    const result = await session.restoreSession({ reportTransientFailure: true });
    check(`Terminal auth ${status} clears storage and returns null`, () => { assert.equal(result, null); assert.equal(session.readStoredSession(), null); assert.equal(writes, 1); });
  }
  resetSession();
  const outage = new TypeError("offline");
  session.configure({ callback: callbackCandidate, failure: outage });
  await assert.rejects(session.restoreSession({ reportTransientFailure: true }), error => error === outage);
  check("Consumed callback retry material is saved without authenticating it", () => { assert.deepEqual(session.readStoredSession(), callbackCandidate); assert.deepEqual(session.refreshCalls, [callbackCandidate]); assert.equal(writes, 1); });
  session.configure({ result: fresh });
  const retried = await session.restoreSession({ reportTransientFailure: true });
  check("Retry refreshes retained callback and writes only the fresh session", () => { assert.deepEqual(session.refreshCalls, [callbackCandidate]); assert.deepEqual(retried, fresh); assert.deepEqual(session.readStoredSession(), fresh); });
  resetSession(null); session.configure({ result: fresh });
  const absent = await session.restoreSession({ reportTransientFailure: true });
  check("No candidate yields no authenticated session or refresh", () => { assert.equal(absent, null); assert.equal(session.refreshCalls.length, 0); assert.equal(writes, 0); });

  // Extract the actual useCallback initializer, then execute it with session
  // and state boundaries injected. No copied error-classification logic.
  const authTree = ts.createSourceFile("auth.tsx", auth, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let linkedInitializer;
  function findLinked(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(authTree) === "acceptLinkedSession") linkedInitializer = node.initializer?.getText(authTree);
    ts.forEachChild(node, findLinked);
  }
  findLinked(authTree); assert.ok(linkedInitializer);
  const linkedCode = await transform(`export async function run(status, show = true, linked = null) {
    class StudioAuthError extends Error { constructor(status) { super('PRIVATE_PROVIDER_PAYLOAD'); this.status = status; } }
    const errors = []; const checking = []; const accepted = []; const calls = [];
    const useCallback = fn => fn; const setError = value => errors.push(value); const setCheckingLink = value => checking.push(value); const onAuthed = value => accepted.push(value);
    const restoreSession = async options => { calls.push(options); if (status === 'network') throw new TypeError('PRIVATE_PROVIDER_PAYLOAD'); if (typeof status === 'number') throw new StudioAuthError(status); return linked; };
    const acceptLinkedSession = ${linkedInitializer}; await acceptLinkedSession(show); return { errors, checking, accepted, calls };
  }`, { loader: "ts", format: "esm" });
  const linkedFile = join(out, "linked.mjs"); await writeFile(linkedFile, linkedCode.code);
  const linkedModule = await import(pathToFileURL(linkedFile).href);
  for (const [status, expected] of [["network", "networkError"], [429, "rateLimitError"], [503, "serviceUnavailableError"]]) {
    const result = await linkedModule.run(status);
    check(`Explicit linked-session ${status} reports safe failure and releases busy state`, () => {
      assert.deepEqual(result.errors, [expected]); assert.deepEqual(result.accepted, []); assert.deepEqual(result.checking, [true, false]); assert.deepEqual(result.calls, [{ reportTransientFailure: true }]);
    });
    const silent = await linkedModule.run(status, false);
    check(`Passive linked-session ${status} does not surface an unsolicited error`, () => { assert.deepEqual(silent.errors, []); assert.deepEqual(silent.accepted, []); assert.deepEqual(silent.checking, [true, false]); });
  }
  const notReady = await linkedModule.run(null);
  check("No linked session reports not-ready only", () => { assert.deepEqual(notReady.errors, ["linkNotReadyError"]); assert.deepEqual(notReady.accepted, []); });
  const accepted = await linkedModule.run(null, true, fresh);
  check("Only an actual restored session reaches onAuthed", () => { assert.deepEqual(accepted.accepted, [fresh]); assert.deepEqual(accepted.errors, []); assert.deepEqual(accepted.checking, [true, false]); });
  // Execute the actual network callbacks with their dependencies injected.
  // This tests error classification, not SQL or live authentication.
  for (const name of ["sendCode", "verifyCode"]) {
    const body = functionText(auth, name);
    const text = `export async function run(status) {
      class StudioAuthError extends Error { constructor(status) { super('PRIVATE_PROVIDER_PAYLOAD'); this.status = status; } }
      const errors = []; let cleared = false; const email = 'owner@example.com'; const code = '123456';
      const cause = status === null ? new TypeError('PRIVATE_PROVIDER_PAYLOAD') : new StudioAuthError(status);
      const sendEmailOtp = async () => { throw cause; }; const verifyEmailOtp = sendEmailOtp;
      const setError = v => errors.push(v); const setBusy = () => {}; const setStep = () => {}; const setCode = () => { cleared = true; };
      const writeStoredSession = () => {}; const onAuthed = () => {}; const codeRef = { current: null }; const requestAnimationFrame = fn => fn();
      ${body}
      await ${name}(); return { error: errors.at(-1), cleared };
    }`;
    const transformed = await transform(text, { loader: "ts", format: "esm" });
    const file = join(out, `${name}.mjs`); await writeFile(file, transformed.code);
    const callback = await import(pathToFileURL(file).href);
    for (const [status, expected] of [[null, "networkError"], [429, "rateLimitError"], [503, "serviceUnavailableError"]]) {
      const result = await callback.run(status);
      check(`${name} ${status} uses a localized safe error`, () => assert.equal(result.error, expected));
      if (name === "verifyCode") check(`Verification ${status} preserves the unrejected code`, () => assert.equal(result.cleared, false));
    }
    if (name === "verifyCode") {
      for (const status of [400, 401]) {
        const result = await callback.run(status);
        check(`Verification ${status} resets a rejected code`, () => assert.deepEqual(result, { error: "codeMismatchError", cleared: true }));
      }
      const result = await callback.run(404);
      check("Missing verifier route is a platform error", () => assert.deepEqual(result, { error: "serviceUnavailableError", cleared: false }));
      const forbidden = await callback.run(403);
      check("Forbidden verifier is not a code mismatch", () => assert.deepEqual(forbidden, { error: "serviceUnavailableError", cleared: false }));
    }
  }
  const localeSource = await readFile(join(root, "src/studio/personalAuthLocale.tsx"), "utf8");
  const switchBody = functionText(localeSource, "switchLocale");
  const switchText = await transform(`export function run(href, denyHistory = false) { let chosen; let remembered; let next; const window = { location: { href }, history: { state: { retained: true }, replaceState(state, title, url) { if (denyHistory) throw Error('denied'); next = { state, url: String(url) }; } } }; const writeRememberedStudioLocale = value => { remembered = value; }; const setLocale = value => { chosen = value; }; ${switchBody}; switchLocale('hi'); return { chosen, remembered, next }; }`, { loader: "ts", format: "esm" });
  const switchFile = join(out, "switch.mjs"); await writeFile(switchFile, switchText.code);
  const switchModule = await import(pathToFileURL(switchFile).href);
  const switched = switchModule.run("https://local.example/studio?step=meet&replica=abc&mode=teacher#section");
  check("Denied history write preserves the in-memory language choice", () => {
    const denied = switchModule.run("https://local.example/studio?step=meet", true);
    assert.equal(denied.chosen, "hi"); assert.equal(denied.remembered, "hi"); assert.equal(denied.next, undefined);
  });
  check("Language switch preserves route, workflow, hash and history state", () => {
    const url = new URL(switched.next.url);
    assert.equal(url.pathname, "/studio"); assert.equal(url.searchParams.get("lang"), "hi");
    assert.equal(url.searchParams.get("step"), "meet"); assert.equal(url.searchParams.get("replica"), "abc"); assert.equal(url.searchParams.get("mode"), "teacher"); assert.equal(url.hash, "#section");
    assert.deepEqual(switched.next.state, { retained: true }); assert.equal(switched.chosen, "hi"); assert.equal(switched.remembered, "hi");
  });
  console.log(`personal-auth-locale: ${checks} controls passed`);
} finally {
  if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow;
  if (priorStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = priorStorage;
  assert.equal(dirname(resolve(out)), resolve(tmpdir()), "Cleanup stays inside the temporary directory");
  assert.ok(out.split(/[\\/]/).at(-1).startsWith("personal-auth-locale-"));
  await rm(out, { recursive: true, force: true });
}
