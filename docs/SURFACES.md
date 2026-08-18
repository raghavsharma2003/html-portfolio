# Adding a surface

*WS-SURFACE. The implementation of SPEC-AGENT-LAYER §4 (Law E3).*

A surface is a **transport**. It is not a tenant, it is not a relationship, and
it scopes nothing. Read the next section before writing a line of code — it is
the only part of this document that is expensive to learn the hard way.

---

## 0. The separation, stated once so nobody re-keys memory by surface

```
   PERSON            ×          AGENT           ×        SURFACE
   who the human is        which AI person         how bytes arrive
   ─────────────           ───────────────         ────────────────
   vy_person               vy_agent                vy_surface_identity
   vy_person_device        persona module          api/_surface.js
   surface identities      register config         tg / discord / wa / web

        └──────────── the relationship lives at (agent × person) ────────────┘
```

**Person is shared. Agent scopes the relationship. Surface scopes nothing.**

Three consequences you cannot design around:

1. **`vy_surface_identity` has no `agent_id` column and must never gain one.**
   Identity resolution is agent-independent: the same human, whoever they are
   talking to. The agent enters at *retrieval*, not at *identification*.
   `evals/surface/identity.mjs` asserts the absence against the live catalog,
   not against the migration file.

2. **Nothing keyed by surface may hold memory.** Episodes, facts, rel-state,
   phrases, rituals — all of it hangs off `(agent_id, person_id)`. A user who
   talks to her on Telegram and then on the web is the *same relationship*; a
   surface is a phone line, not a different friend. Anything that keys memory
   by surface reintroduces the amnesia the relational layer exists to delete.

3. **A second agent starts from zero with a user Meera knows well, and that is
   correct.** Law E1. It is not a limitation to engineer around. A surface
   never widens it.

The one thing a surface legitimately owns is a **synthetic device id**, and
even that is surface-*qualified* rather than surface-*scoped*:
`surfaceDeviceId(surface, key)` is uuid-v5 over `<seed>:<key>`, so Telegram
user `9001` and Discord user `9001` can never collide into one device and merge
two strangers' histories. The `tg` seed is frozen — every device id already in
the database depends on it.

---

## 1. The four functions

An adapter is one file in `api/` that exports exactly these, plus an HTTP
handler. Everything else is `api/_surface.js`'s.

| function | job |
|---|---|
| `verify(req)` | authenticate the webhook. Returns `{ok, reason, payload?, respond?}` |
| `parse(payload)` | normalize to `InboundEvent[]` |
| `send(chatKey, msg)` | put one `OutboundMessage` on the wire |
| `render(text)` | `text` → this surface's own fragments, inside its own limits |

```js
export const adapter = { surface: "myplace", verify, parse, send, render };
```

`evals/surface/contract.mjs` asserts that the adapter object holds **exactly**
those five keys. A fifth function would be a behaviour the engine cannot call
and therefore a behaviour only one surface has — which is how the contract dies.

### `InboundEvent`

```js
{
  surface,        // 'telegram'|'discord'|'whatsapp'|'web'
  kind,           // 'message'|'bot_membership'|'member_change'|'join'|'leave'|'ignore'
  chatKey,        // opaque conversation address; the ONLY thing handed to send()
  chatName,       // room title, '' if none
  isGroup,        // room semantics vs 1:1 semantics
  surfaceUserId,  // the speaker, as the surface numbers them (STRING)
  handle,         // display name, clamped to 64
  text,           // the message body, '' if none
  caption,        // media caption, '' if none — kept separate on purpose
  messageId,      // native id, for threading and reactions
  replyToSelf,    // is this a reply to HER message
  fromBot,        // did a bot send it
  reason,         // why an 'ignore' event is ignored — always named, never silent
  adminBits,      // { selfStatus, subjectStatus, subjectUserId, subjectHandle,
                  //   subjectIsBot, joined[], left }
  raw,            // the native object. ADAPTERS ONLY — the engine never reads it.
}
```

`parse()` returns an **array** because one POST is not one event on every
surface: a WhatsApp Cloud API delivery carries `entry[].changes[].value.
messages[]` and may hold several. Telegram's is always length 0 or 1.

`text` and `caption` are separate because the shipped Telegram lane treats
`text` and `text || caption` differently in two places, and that difference is
measured behaviour rather than noise.

`adminBits.selfStatus` is normalized to `'member' | 'admin' | 'left' |
'kicked' | null`. **`admin` is the room's read consent.** On Telegram that is
per-room bot promotion with privacy mode left ON globally; on Discord the
closest analogue is `MANAGE_GUILD`. The generalization is deliberate: on every
surface, consent should be a deliberate, visible, revocable act by whoever runs
the room — never a checkbox we ship enabled.

### `OutboundMessage`

```js
{
  kind,     // 'text' | 'reaction'
  text,     // the body (kind 'text')
  emoji,    // the reaction (kind 'reaction')
  replyTo,  // native message id to thread to, or null
  buttons,  // [{text, url}] — a surface without them DROPS them
  native,   // set by deliver(): the render() fragment being delivered
}
```

Deliberately poorer than any real surface. It names an **intent**; `render()`
and `send()` decide what that intent is on your wire. Threading rides the first
fragment, buttons ride the last — both decided once, in `deliver()`.

---

## 2. Write a fifth surface

1. **`api/myplace.js`.** Read `api/discord.js` first — it is the shortest
   complete example.

2. **`verify(req)` — fail closed.** No configured secret means refuse
   *everything*. That is the state a half-configured deploy is in, and a
   webhook that "defaults open" is simply open. Compare in constant time and
   never log the secret or the token.

   If your surface signs the **raw body** (Discord's Ed25519, WhatsApp's
   `X-Hub-Signature-256`), you need the untouched bytes:
   `export const config = { api: { bodyParser: false } }`, and read the stream.
   `JSON.stringify(req.body)` is **not** what was signed — key order, unicode
   escaping and number formatting all differ — so a re-serialized verify either
   fails at random or gets "fixed" later by someone who disables it. If the raw
   body is unavailable, **refuse**; never guess.

3. **`parse(payload)`** → `InboundEvent[]`. Every ignored payload gets a
   `reason` string. A silent drop is a bug you find six weeks later.

4. **`send(chatKey, msg)`** — fail closed without credentials. This is where
   your wire's rules live: rate limits, windows, template requirements,
   attachment shapes. Return `{ok:false, error}`; never swallow a refusal and
   never substitute different content for what she meant to say. That is
   `silent-truncation` wearing a different hat: it returns success and she is
   quietly someone else.

5. **`render(text)`** → fragments. Use `splitForLimit(text, YOUR_LIMIT)` from
   `api/_surface.js`. What differs between surfaces is the *number*; a number
   is not a reason for a second splitting algorithm.

6. **The handler.** Verify, then:

   ```js
   const ctx = makeCtx(adapter, { engine: await loadEngine(), botHandle: NAME });
   for (const ev of parse(payload)) await dispatch(ev, ctx);
   ```

   Optional `ctx` hooks: `linkIntent(ev)` (does this event mean "link me"? —
   Telegram's `/start r<id>` deep link is the shipped instance) and
   `linkFor(roomId)` (a URL for the room card's button; return null and the
   card goes without one).

7. **Tests before credentials.** Add your adapter to `ADAPTERS` in
   `evals/surface/contract.mjs`. It costs nothing and it catches the fifth
   function, the missing fail-closed path, and the render limit.

8. **Run the gates:**

   ```
   node evals/surface/run.mjs      # contract + identity + pipeline
   node evals/mp/gate0.mjs         # the disclosure predicate, unchanged
   node evals/mp/withdraw.mjs      # the multi-owner forget cascade
   node evals/mp/tgbot.mjs         # the Telegram surface, 101 checks
   node scripts/verify-release.mjs # tsc + prompt budget + build + evals
   ```

### What you must NOT do

- **Do not put a `select` in an adapter.** Identity, rooms, roster, recall,
  logging and the commands are `api/_surface.js` and `api/_room.js`. If your
  adapter needs data, the contract is missing a field, not a query.
- **Do not teach the engine your surface.** If `api/_surface.js` or
  `api/_room.js` ever needs `if (surface === 'myplace')`, SPEC §10's E3
  reversal condition has fired: the contract is wrong and adapters go back to
  being bespoke. `evals/surface/contract.mjs` greps the engine half for
  surface-specific limits and URLs to keep that honest.
- **Do not write your own disclosure filter.** Every retrieval goes through
  `api/_disclosure.js`, where every rule is a `WHERE` clause. A second,
  hand-rolled copy is how a rule ends up with two meanings.
- **Do not re-implement a delete.** `/bhool` calls `api/memory.js`'s
  `withdrawSharedRows`, the one gated by `evals/mp/withdraw.mjs`.

---

## 3. The three that exist

### `api/tg.js` — Telegram (SHIPPING, production-probed)

Webhook with `X-Telegram-Bot-Api-Secret-Token`, constant-time. Private chats
are the 1:1 lane, groups/supergroups are rooms. Admin promotion is the room's
read consent. `/start r<id>` deep link links identity, joins the room and
triggers the one-time intro. Commands `/chup /bolo /bhool /kya`. 4,096-char
limit. Blocked on the owner for `TELEGRAM_BOT_TOKEN` /
`TELEGRAM_WEBHOOK_SECRET` / `TELEGRAM_BOT_USERNAME`.

### `api/discord.js` — Discord (NOT WIRED, code + tests only)

Ed25519 over `timestamp || rawBody` with `X-Signature-Ed25519` /
`X-Signature-Timestamp`; PING answered with PONG inside `verify()` because it
is an authentication handshake. 2,000-char limit. Interactions are ACKed with
`DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` (type 5) immediately — the 3-second
deadline is not a budget a compile-plus-model round trip reliably meets — and
the real message is delivered afterwards as an ordinary channel post, which
keeps `send()` a plain "put these bytes in that room". Link buttons are a
component row (type 2, style 5), never a URL pasted into her voice.

Env: `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`,
`DISCORD_BOT_USERNAME`.

### `api/whatsapp.js` — WhatsApp Cloud API (NOT WIRED, code + tests only)

GET `hub.challenge` handshake (plain-text echo, verify token compared in
constant time) and POST `X-Hub-Signature-256` HMAC-SHA256 over the raw body.
4,096-char limit.

**The 24-hour customer-service window lives in `send()` and nowhere else.**
Outside it, only approved templates may be sent, so `send()` returns
`{ok:false, error:'outside 24h window', requiresTemplate:true}`. It does not
drop silently and it does not substitute a template — a template in place of
what she meant to say is a lie that returns 200. The window ledger is wound by
`parse()` (every inbound message refreshes its chat's clock) and read by
`send()`, so the engine never hears about it.

Per `group-distribution` (2026-08-13): the Cloud API's group messaging works
only for groups the **business** creates; joining a group users already have is
infeasible without unofficial-client ban risk. The 1:1 lane is the shipping
path here.

Env: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_DISPLAY_NAME`.

---

## 4. What is NOT verified, and what is owed

Named rather than implied, because an untested adapter reported as untested is
fine and one reported as working is not.

**Untestable without credentials** (Discord and WhatsApp both):

- That the live payload nesting matches the shape `parse()` reads, for every
  message type. What is tested is the shape as documented.
- That Discord's 3-second interaction deadline tolerates our deferral in
  practice, and that an unregistered app's gateway intents deliver message
  content at all.
- That Meta's side of the 24-hour window agrees with our ledger, and template
  approval, which is an account process rather than code.
- Every `send()` path. No outbound call has ever been made; both refuse
  fail-closed without a token, which is all that has been exercised.

What *is* verified offline: the four-function contract (113 checks), the
signature algorithms against locally generated keys, the fail-closed paths, the
render limits, identity resolution against real Postgres (41 checks), and a
full Discord payload driving the entire shared pipeline end to end (30 checks).

**Owed, and named:**

- `vy_group.tg_chat_id` is a `bigint` and `vy_group_member.tg_user_id` is a
  `bigint`. The room binding is therefore still Telegram-shaped: a non-numeric
  chat key cannot be stored, and `roomByChatKey()` returns null for one so the
  room lane refuses fail-closed rather than writing a row that means something
  else. Non-Telegram members are written with a NULL `tg_user_id` and
  identified through `vy_surface_identity`. **Migration 010 should replace both
  with `(surface, surface_chat_id)` / `(surface, surface_user_id)`** — the same
  move `vy_surface_identity` already made for `vy_tg_person`. That is
  WS-AGENT-SCHEMA's file, not this one's.
- WhatsApp's window ledger is a warm-lambda `Map`, so a cold start forgets it
  and `send()` then fails closed (no record = outside the window). The durable
  version reads the last inbound turn from `meera_log`, which is
  `api/memory.js` — another workstream's file.
- `vy_tg_person` still exists. `personForSurfaceUser()` reads
  `vy_surface_identity` first, falls back to it for Telegram, and backfills the
  general table on the way past — so it drains itself under ordinary traffic
  and the day it is dropped is a delete rather than a migration.
