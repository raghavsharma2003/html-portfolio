/**
 * Portable, in-memory turn checkpoints. The host supplies authoritative readers.
 * This is not a lock, transaction, durable receipt, or atomic egress barrier.
 * No application, provider, database, filesystem, or runtime dependency belongs here.
 */

export const CHECKPOINT_LIMITS = Object.freeze({
  policyVersionCharacters: 128,
  pendingChecks: 64,
  scope: Object.freeze({ depth: 8, nodes: 256, entries: 64, stringCharacters: 2048, serializedCharacters: 16384 }),
  snapshot: Object.freeze({ depth: 32, nodes: 32768, entries: 4096, stringCharacters: 262144, serializedCharacters: 1048576 }),
});

const OBJECT_SOURCE = Function.prototype.toString.call(Object);
const ERROR_CODE = "turn_checkpoint_unavailable";

function checkpointError(reason) {
  return Object.freeze(Object.assign(new Error(ERROR_CODE), {
    name: "TurnCheckpointError", code: ERROR_CODE, reason,
  }));
}

function plainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return true;
  if (Object.getPrototypeOf(prototype) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  return Boolean(constructor && "value" in constructor &&
    typeof constructor.value === "function" &&
    Function.prototype.toString.call(constructor.value) === OBJECT_SOURCE);
}

/** Copy and encode only own JSON data properties; never read getters/toJSON.
 * Limits are UTF-16 code units, not bytes/tokens. Key order is insignificant;
 * array order matters. Shared acyclic references copy as JSON would. -0 = 0.
 * Executable proxies are outside the DTO contract (standard JS cannot reliably
 * identify them without invoking their traps). Readers must return inert DTOs.
 */
function snapshot(value, limits, requireRecord = false) {
  const chunks = [];
  const ancestors = new WeakSet();
  let characters = 0;
  let nodes = 0;
  const reject = () => { throw new Error("invalid_dto"); };
  const write = (text) => {
    characters += text.length;
    if (characters > limits.serializedCharacters) reject();
    chunks.push(text);
  };
  const string = (text) => {
    if (text.length > limits.stringCharacters) reject();
    write(JSON.stringify(text));
  };
  const visit = (input, depth) => {
    if (++nodes > limits.nodes || depth > limits.depth) reject();
    if (input === null) { write("null"); return null; }
    if (typeof input === "string") { string(input); return input; }
    if (typeof input === "boolean") { write(input ? "true" : "false"); return input; }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) reject();
      write(JSON.stringify(input));
      return Object.is(input, -0) ? 0 : input;
    }
    if (typeof input !== "object" || ancestors.has(input)) reject();
    const array = Array.isArray(input);
    if (!array && !plainRecord(input)) reject();
    const keys = Reflect.ownKeys(input);
    if (keys.length > limits.entries + (array ? 1 : 0) || keys.some((key) => typeof key !== "string")) reject();
    ancestors.add(input);
    let copy;
    if (array) {
      const length = Object.getOwnPropertyDescriptor(input, "length");
      if (!length || !("value" in length) || !Number.isSafeInteger(length.value) ||
          length.value < 0 || length.value > limits.entries || keys.length !== length.value + 1) reject();
      copy = [];
      write("[");
      for (let index = 0; index < length.value; index++) {
        const entry = Object.getOwnPropertyDescriptor(input, String(index));
        if (!entry || !("value" in entry) || !entry.enumerable) reject();
        if (index) write(",");
        copy.push(visit(entry.value, depth + 1));
      }
      write("]");
    } else {
      copy = {};
      write("{");
      keys.sort();
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index];
        const entry = Object.getOwnPropertyDescriptor(input, key);
        if (!entry || !("value" in entry) || !entry.enumerable) reject();
        if (index) write(",");
        string(key);
        write(":");
        Object.defineProperty(copy, key, {
          value: visit(entry.value, depth + 1), enumerable: true, writable: false, configurable: false,
        });
      }
      write("}");
    }
    ancestors.delete(input);
    return Object.freeze(copy);
  };
  if (requireRecord && (!plainRecord(value) || Reflect.ownKeys(value).length === 0)) reject();
  return { value: visit(value, 0), receipt: chunks.join("") };
}

/**
 * Initialize from a fresh host-validated authority DTO. Reader success is not
 * authorization by itself: the adapter must enforce consent, scope and policy.
 * Scope and policy are detached before the first await and are passed to every
 * reader. A new authority/policy/source set always needs a new turn instance.
 */
export async function createTurnCheckpoints(options) {
  let scope;
  let policyVersion;
  let readAuthority;
  try {
    if (!plainRecord(options)) throw new Error();
    const keys = Reflect.ownKeys(options);
    if (keys.length !== 3 || !["scope", "policyVersion", "readAuthority"].every((key) => keys.includes(key))) throw new Error();
    const fields = Object.getOwnPropertyDescriptors(options);
    if (keys.some((key) => !("value" in fields[key]) || !fields[key].enumerable)) throw new Error();
    policyVersion = fields.policyVersion.value;
    readAuthority = fields.readAuthority.value;
    if (typeof policyVersion !== "string" || !policyVersion.trim() ||
        policyVersion.length > CHECKPOINT_LIMITS.policyVersionCharacters || /[\u0000-\u001f\u007f]/u.test(policyVersion) ||
        typeof readAuthority !== "function") throw new Error();
    scope = fields.scope.value;
  } catch { throw checkpointError("invalid_configuration"); }
  try { scope = snapshot(scope, CHECKPOINT_LIMITS.scope, true).value; }
  catch { throw checkpointError("invalid_scope"); }
  const readerContext = Object.freeze({ scope, policyVersion });
  let invalidReason = null;
  let sourceReader = null;
  let sourceReceipt = null;
  let queue = Promise.resolve();
  let pending = 0;
  const fail = (reason) => {
    invalidReason ??= reason;
    throw checkpointError(invalidReason);
  };
  const assertActive = () => { if (invalidReason !== null) fail(invalidReason); };
  const read = async (reader, readFailure, shapeFailure, requireRecord) => {
    assertActive();
    let result;
    try { result = reader(readerContext); }
    catch { fail(readFailure); }
    const normalize = (value) => {
      // A concurrent rejected rebind must invalidate an already-awaiting check.
      assertActive();
      try { return snapshot(value, CHECKPOINT_LIMITS.snapshot, requireRecord); }
      catch { fail(shapeFailure); }
    };
    // Do not blindly await a synchronous DTO: await would read a hostile
    // `then` getter before descriptor validation can reject it.
    try { return snapshot(result, CHECKPOINT_LIMITS.snapshot, requireRecord); }
    catch { /* A native promise is the only supported non-DTO reader result. */ }
    return new Promise((resolve, reject) => {
      try {
        // Intrinsic then brand-checks without reading result.then and supports
        // other realms. Reader-created promise infrastructure remains trusted;
        // it may already have assimilated thenables before returning to us.
        Promise.prototype.then.call(result,
          (value) => { try { resolve(normalize(value)); } catch (error) { reject(error); } },
          () => { try { fail(readFailure); } catch (error) { reject(error); } });
      } catch {
        try { fail(shapeFailure); } catch (error) { reject(error); }
      }
    });
  };
  const initial = await read(readAuthority, "authority_read_failed", "invalid_authority_snapshot", true);
  const checkAuthority = async () => {
    const current = await read(readAuthority, "authority_read_failed", "invalid_authority_snapshot", true);
    if (current.receipt !== initial.receipt) fail("authority_changed");
  };
  const checkSources = async () => {
    const current = await read(sourceReader, "source_read_failed", "invalid_source_snapshot", false);
    if (current.receipt !== sourceReceipt) fail("sources_changed");
  };
  return Object.freeze({
    guarantee: "checkpointed",
    scope,
    policyVersion,
    authority: initial.value,
    bindSources(reader, sourceSnapshot) {
      assertActive();
      if (sourceReader !== null) fail("sources_already_bound");
      if (typeof reader !== "function") fail("invalid_source_reader");
      let bound;
      try { bound = snapshot(sourceSnapshot, CHECKPOINT_LIMITS.snapshot); }
      catch { fail("invalid_source_snapshot"); }
      sourceReceipt = bound.receipt;
      sourceReader = reader;
    },
    assertCurrent() {
      try {
        assertActive();
        // Check at invocation too: binding later must not rescue an unbound
        // effect check that was already requested.
        if (sourceReader === null) fail("sources_unbound");
        if (pending >= CHECKPOINT_LIMITS.pendingChecks) fail("too_many_pending_checks");
      } catch (error) { return Promise.reject(error); }
      pending++;
      // Serialize whole checks, not individual readers: no concurrent caller
      // can interleave the A/S/A/S sequence or revive a failed turn.
      const check = queue.then(async () => {
        assertActive();
        if (sourceReader === null) fail("sources_unbound");
        await checkAuthority();
        await checkSources();
        await checkAuthority();
        await checkSources();
        assertActive();
      });
      queue = check.then(() => { pending--; }, () => { pending--; });
      return check;
    },
  });
}
