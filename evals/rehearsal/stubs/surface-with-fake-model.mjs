// WS-R94. The model seam. `api/_room-surface.js`'s `roomSay` and
// `api/_room-taste.js`'s `roomTaste` both default `deps.reply` to
// `(compiled, turns) => think(engine, compiled, turns)` — and `api/room.js`
// calls both with NO third argument, so the real HTTP door always takes that
// default path. `think` (api/_surface.js) is a real `fetch()` to
// openrouter.ai, which this workstream's brief forbids ("no paid API calls,
// no network beyond 127.0.0.1 and npm"). This file is what `../loader.mjs`
// resolves every relative `./_surface.js` import to instead: the REAL file,
// loaded by an absolute `file://` URL so `loader.mjs`'s own basename match
// never catches THIS import and redirects it back to itself (`.startsWith(".")`
// is false for an absolute URL) — infinite self-redirection was the first
// thing tried and rejected here, see
// `context/rejected.md#ws-r94-relative-reexport-of-the-redirect-target-self-redirects`.
//
// Every OTHER export of the real file is re-exported unchanged (the full
// list, read off `api/_surface.js`'s own `export` statements — Meera's
// surfaces (`api/whatsapp.js`, `api/tg.js`, `api/discord.js`) are also on
// this module's transitive import graph through shared code paths this
// harness never calls but Node still has to LINK, and ESM has no "export
// everything from a dynamically-imported namespace" syntax to lean on
// instead — `context/rejected.md#ws-r94-partial-reexport-of-surfacejs-broke-
// unrelated-surfaces-at-link-time` has the failure this replaced). `think`
// is the ONE name deliberately overridden below.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_surface.js")).href;
const REAL = await import(REAL_URL);

export const {
  ROOM_CARD, withdrawReceipt, NOTICED_EMOJI, loadEngine, honestyContextFor, hasGate, gateReply,
  gatedReply, deliver, splitForLimit, resolveIdentity, linkIdentity, legacyChatId, legacyUserId,
  roomForChat, ensureRoomForSurfaceChat, upsertRoomMember, dispatch, onBotMembership, onMemberChange,
  onJoin, onLeave, onDirectMessage, logDmTurn, dmHistory, onGroupMessage, sinceHerLast, roomHistory,
  commandOf, onCommand, makeCtx,
} = REAL;

let replyFn = null;

/** Called by `harness.mjs` (or a scenario) to swap the fake reply text.
 *  `null` restores the default. */
export function setFakeReply(fn) {
  replyFn = typeof fn === "function" ? fn : null;
}

/** The fixed default: deliberately bland, Hinglish-toned, and free of any
 *  factual claim, name, number or promise — so `gateReply`'s honesty gate
 *  (family checks over `trustedText`/`openItems`/`hisVocab`/`sharedVocab`)
 *  has nothing to catch, the same property `evals/room-taste/run.mjs`'s own
 *  `"hi."`/`"a taste answer."` fixtures already rely on (proven passing on
 *  every existing gate run this workstream did not have to re-derive).
 */
function defaultReply() {
  return "Achha sawaal — chalo isse step by step dekhte hain.";
}

/** Same call shape as the real `think(engine, compiled, turns)` — never
 *  reaches `fetch`, never reaches openrouter.ai, deterministic. */
export async function think(engine, compiled, turns) {
  if (replyFn) return replyFn(engine, compiled, turns);
  return defaultReply();
}
