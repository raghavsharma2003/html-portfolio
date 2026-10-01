# Portable turn checkpoints

`checkpoints.js` is a dependency-free ESM module for binding one operation to
an immutable scope, policy version, authority receipt and source receipt. It
can be reused by another project without a chat platform, model provider,
database, framework, Node API or Vyakti configuration.

## Reuse in your own projects

The folder is a private local package, `@vyakti/turn-checkpoints` version
`0.1.0`. Its manifest has no dependencies or lifecycle scripts. Existing
callers may keep importing the ESM file directly:

```js
import { createTurnCheckpoints } from "./path/to/_group-runtime/checkpoints.js";
```

For a separate project you own, add a local dependency pointing to this folder
in that project's `package.json` (the path is relative to that manifest):

```json
{
  "dependencies": {
    "@vyakti/turn-checkpoints": "file:../your-checkout/api/_group-runtime"
  }
}
```

Once you deliberately install that project's dependencies, use the public
package entry point; TypeScript declarations resolve from the same export:

```js
import { createTurnCheckpoints, CHECKPOINT_LIMITS } from "@vyakti/turn-checkpoints";
```

No other project is installed or modified by this package. The files whitelist
contains only `checkpoints.js`, `checkpoints.d.ts` and this README; npm also
includes the manifest. The package remains `private: true` to prevent accidental
registry publication. `UNLICENSED` does not grant an external open-source
license: external distribution or publication requires the owner's license
and release review. Local reuse does not expand the guarantees below.

## Checkpoint guarantee

The guarantee is **checkpointed**, not atomic. Before an effect, the host asks
the module to re-read authority and sources in this order:

```
authority -> sources -> authority -> sources
```

The second authority read catches authority changes observed after an awaited
source read. The second source read catches source changes observed after the
second awaited authority read. Every observed mismatch or reader failure
permanently invalidates this turn. State returning to its earlier value does
not revive an invalidated turn.

## Host adapter contract

```js
import { createTurnCheckpoints } from "./checkpoints.js";

const turn = await createTurnCheckpoints({
  scope: { workspace: "design-team", document: "brief-7" },
  policyVersion: "coedit/share-v2",
  async readAuthority({ scope, policyVersion }) {
    // Host responsibility: authorize this exact scope and policy, fail closed
    // on missing consent/access, and return every relevant revision/witness.
    return readValidatedDocumentAccess(scope, policyVersion);
  },
});

const readSources = ({ scope, policyVersion }) =>
  readValidatedDocumentSources(scope, policyVersion);
const sourceSnapshot = await readSources(turn);
turn.bindSources(readSources, sourceSnapshot);

// Assemble the requested result using only sourceSnapshot.
const result = assemblePreview(sourceSnapshot);
await turn.assertCurrent();
await writePreview(result);
```

The last two lines still contain a race window. An effect requiring atomic
authorization must use a host-enforced transaction, fenced write or delivery
capability that checks the same authority at its own commit boundary. Repeated
reads are not a substitute.

- `createTurnCheckpoints` performs one fresh authority read. Scope and policy
  are detached before that read starts. Authority must be a nonempty record;
  `null`, `{}` or a scalar cannot initialize a turn.
- `scope`, `policyVersion`, `authority` and the returned handle are immutable.
  The scope and authority are recursively frozen copies, not references to the
  caller's objects. `guarantee` is always `"checkpointed"`.
- Both readers receive the same frozen `{ scope, policyVersion }` context.
  Readers must use that context rather than mutable ambient request state.
- `bindSources(reader, sourceSnapshot)` is synchronous and exactly once. Its
  baseline is detached. A second binding attempt, even an identical one,
  invalidates the entire turn. Empty source arrays are valid.
- `assertCurrent()` returns `Promise<void>`. It refuses an unbound turn at
  invocation time; binding after the call cannot rescue it. Concurrent calls
  serialize complete four-read sequences. Queued calls cannot revive a failed
  turn. More than 64 outstanding calls invalidates the turn.
- A new scope, policy or source set requires a new instance. Instances are
  private to a single operation and must not be cached/shared between turns.

Reader callbacks are trusted authorization adapters, not untrusted executable
input. They may return an inert JSON DTO directly or a native Promise resolving
to one. Arbitrary thenables are unsupported. Synchronous DTOs are validated
before async assimilation, so an accessor named `then` is not executed.
Native Promise results from other realms are supported without consulting an
overridden `.then` property. Promise construction/settlement belongs to the
trusted reader: a Promise may have assimilated a thenable before returning to
the kernel. Standard JavaScript also cannot reliably identify transparent
proxies without running proxy traps, so executable proxies are outside the
inert DTO contract.

## Receipt semantics and resource limits

Receipts use a canonical encoding, not a probabilistic hash. Object-key order
is ignored; array order is significant. Inputs are copied using own property
descriptors, so getters and `toJSON` methods are not evaluated. Supported values
are `null`, booleans, finite numbers, strings, dense arrays and plain records
(including cross-realm and null-prototype records). Negative zero equals zero.
Repeated acyclic references copy as JSON would.

Accessors, functions, symbols, `undefined`, bigint, nonfinite numbers, sparse
arrays, extra array properties, nonenumerable data, cycles and non-plain
objects are rejected. Nothing is silently truncated or dropped. Keep Dates,
binary data, raw provider objects and database-specific classes in the adapter;
convert them explicitly to the small, meaningful receipt DTO before returning.

Limits are fixed exports in `CHECKPOINT_LIMITS`; a boundary change is a contract
change requiring corresponding tests. Character limits count UTF-16 code units,
not UTF-8 bytes or model tokens. Serialized size includes JSON escapes and keys.
The root has depth zero; nodes count each visited value, including repeated
references, not property names. Entries count own fields or array positions.

| Bound | Scope | Authority or source snapshot |
| --- | ---: | ---: |
| Maximum depth | 8 | 32 |
| Maximum visited values | 256 | 32,768 |
| Maximum entries per container | 64 | 4,096 |
| Maximum string or key length | 2,048 | 262,144 |
| Maximum serialized length | 16,384 | 1,048,576 |

Scope must be a nonempty record. Policy versions must be nonblank strings of
at most 128 code units without ASCII control characters. Tests cover twenty
4,000-character history messages plus 100 synthetic fact receipts inside the
snapshot envelope. This is a resource-bound fixture, not a prompt-budget claim.

## Failures and host responsibilities

Errors are frozen and carry only fixed `name`, `message`, `code` and `reason`
fields plus the standard JavaScript stack. The code/message is
`turn_checkpoint_unavailable`; `checkpoints.d.ts` lists the reason union.
Adapter exceptions, causes, scope and source values are never copied into an
error. Hosts should return/log only appropriate fixed codes, not expose internal
stacks. Later checks preserve the first invalidating reason.

The host remains responsible for authorization rules, policy version freshness,
source lineage/erasure, row-level isolation, platform audience verification,
reader deadlines/cancellation, bounded data acquisition and atomic effects.
Passing a stable but incorrect authority receipt does not authorize anything.
This module cannot observe a revoke-and-restore that occurs entirely between
reads, and provides no durable idempotency, deduplication, outbox, delivery
acknowledgment, retries, persistence or exactly-once guarantee. Hung readers
block progress; they never produce a successful checkpoint.

## Verification

Run `node evals/turn-checkpoints/run.mjs` from the repository root. The suite
uses real callbacks, controlled Promise interleavings, malformed DTOs, exact
resource boundaries, and independent document-coediting and warehouse-approval
adapters. It performs no network, server, database or provider operation.

To inspect the packaging file list without installing or publishing anything,
run `npm pack --dry-run --json --ignore-scripts` from this folder. This dry run
does not create a tarball and is separate from the unit-contract suite.

These are unit-contract tests. Production caller integration, real database
authorization, transport delivery and a consented group trial require their own
evidence. No external library implementation was copied into this module.
