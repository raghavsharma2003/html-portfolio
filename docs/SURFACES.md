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
   node evals/surface.mjs          # the honesty gate + the binding, statically
   node evals/surface/run.mjs      # contract + identity + pipeline
   node evals/mp/gate0.mjs         # the disclosure predicate, unchanged
   node evals/mp/withdraw.mjs      # the multi-owner forget cascade
   node evals/mp/binding.mjs       # the room binding round trip, 57 checks
   node evals/mp/tgbot.mjs         # the Telegram surface, 101 checks
   node scripts/verify-release.mjs # tsc + prompt budget + build + evals
   ```

### What you get for free, and must not re-implement

**Parse-and-gate.** Since ticket #102 (2026-08-22) every reply on every surface
goes out through `gatedReply()` in `api/_surface.js`. That function is the
only place in the file that calls `ctx.reply` — the raw brain call — and what
it does with the result is the engine's own entry point, reached through the
committed bundle:

```
ctx.reply()  ->  parseBubbles  ->  stripTextingDashes  ->  guardReply  ->  deliver()
                 (protocol         (the em-dash          (honesty families
                  extraction)       predicate)            1–4 + presupposition)
```

Those are the same three calls, in the same order, as `brain.ts`'s own
`gate()`. Your adapter inherits all of it — and every family added to
`honesty.ts` after you write your adapter — with zero code, because the surface
layer routes to the gate instead of copying it. Three consequences for an
adapter author:

1. **`send()` receives gated bytes.** You never gate, never strip a marker,
   never sanitise. If you find yourself wanting to, the contract is missing a
   field.
2. **A `[gif: …]` or `[voicenote: …]` marker no longer reaches your wire as
   literal text** — it is extracted and, since an `OutboundMessage` has no
   media kind yet, dropped. Dropping it is deliberate and is an improvement on
   what shipped before, which was the marker itself arriving as her words. When
   the contract grows a media kind, it grows in `deliver()`, once.
3. **It fails closed.** A stale `api/_engine.gen.js` with no gate in it means
   she sends NOTHING and the log says why. Do not add a fallback that sends the
   ungated text; that is the bug #102 existed to fix, and it returns 200.

The honesty gate needs conversation context, and the surface lanes wire it:
`honestyContextFor()` maps the lane's own history (`assistant` = hers,
everything else = his) into the four fields `guardReply` takes, and each lane
passes the record it just retrieved through the disclosure predicate as
`record` — that is family 4's support set, so a moment she was HANDED is a
moment she may retell and nothing else is. If you add a lane, pass what that
lane retrieved; do not pass the compiled prompt, which mentions half the world
and would make the check vacuous.

Gate: `node evals/surface.mjs` (offline, no DB, no model, ~1s). It proves the
behaviour on a stubbed reply and — the half a future edit actually breaks —
asserts statically that no path in `api/_surface.js` emits model text around
the gate, with three injected defects as its own negative control.

### What you must NOT do

- **Do not put a `select` in an adapter.** Identity, rooms, roster, recall,
  logging and the commands are `api/_surface.js` and `api/_room.js`. If your
  adapter needs data, the contract is missing a field, not a query.
- **Do not teach the engine your surface.** If `api/_surface.js` or
  `api/_room.js` ever needs `if (surface === 'myplace')`, SPEC §10's E3
  reversal condition has fired: the contract is wrong and adapters go back to
  being bespoke. `evals/surface/contract.mjs` greps the engine half for
  surface-specific limits and URLs to keep that honest.
- **Do not write your own honesty gate, and do not deliver around the one that
  is there.** A second gate beside an adapter is `age-tier-never-realtime`
  wearing a different hat: it silently misses every family added to
  `honesty.ts` after the fork while continuing to return 200. Everything
  outbound goes through `deliver()`, and everything from a model reaches
  `deliver()` through `gatedReply()`.
- **Do not write your own disclosure filter.** Every retrieval goes through
  `api/_disclosure.js`, where every rule is a `WHERE` clause. A second,
  hand-rolled copy is how a rule ends up with two meanings.
- **Do not re-implement a delete.** `/bhool` calls `api/memory.js`'s
  `withdrawSharedRows`, the one gated by `evals/mp/withdraw.mjs`.

---

## 2b. Activities — what to do when WhatsApp/Discord/Telegram gets a game

Added 2026-08-21, when the web app got a games centre. Read this BEFORE
building an activity into a surface, because the expensive mistake here is
already made and documented elsewhere in this repo.

**An activity is not a mode.** It is a fact about the present moment
(`src/engine/activity.ts`), and it rides the SAME prompt, the same memory and
the same relationship as an ordinary message. She does not "enter chess mode";
she is a person who happens to be mid-game, and the conversation can wander off
it and come back the way it does with anyone.

The contract is four fields and nothing else:

```ts
interface ActivityState {
  kind: "chess" | "watch";       // add a member for a new activity
  startedAt: number;             // epoch ms
  facts: readonly string[];      // telegraphic rows, <=14 words, third person
  nameable: readonly string[];   // identifier-shaped tokens she may say
  waitingOnHer?: boolean;
}
```

### What a surface has to do

1. **Hold the game where the SESSION can see it, not the message handler.** On
   the web this is `AppState.game`; on a surface it is a row keyed the way
   every other piece of per-conversation state is keyed — never a variable that
   lives as long as one webhook invocation. A board the reply path cannot see
   is a board she cannot talk about.
2. **Derive the `ActivityState` in ONE place** and pass it as `activity` on the
   keys object, exactly as the web lane does. Do not build the block in the
   adapter. `src/state/game.ts`'s `activityOf` is the reference.
3. **Populate `nameable` with every identifier she is allowed to say.** This is
   not optional bookkeeping: `honesty-provenance-allowlist` treats an
   identifier she emits that was not in her input as INVENTED, so a chess move
   like `Nf3` — which is identifier-shaped — gets flagged as a fabrication
   unless it was declared. Every activity with a move, a card, a word or a
   score has the same obligation.
4. **Never render dialogue into `facts`.** `recited-prompt` is the most
   expensive law in this repo — her own example quotes were recited on 4 of 5
   turns. A line she could say, written into this block, is a line she will say
   every single game. Facts are third-person and telegraphic; what she does
   with them is hers.
5. **Never render a FEN, a board array, or a centipawn evaluation.** She emits
   the characters she speaks. A number she can read aloud is a number that
   makes her sound like a computer.

### The two failures already paid for

- **The block must DROP whole facts when over budget, never slice one.**
  Slicing at the byte cap cut a fact mid-word and silently ate "it is his
  move", the most useful row in the block. Same shape as `silent-truncation`,
  which has already cost this project the crisis helplines once.
- **A move fact is at most three clauses.** Six produced *"she played Qxf7+, a
  bad one, it took a piece, it was a check, f7 is hanging, she is losing"* — a
  scoresheet being read aloud, over the row limit, and long enough to push
  whose-turn-it-is off the end.

### The poke's cadence (any surface with out-of-band events)

Measured on the web lane, 2026-08-21, after the owner watched the naive
version destroy her own stories. If your surface pushes activity events into a
live conversation, copy these gates or re-earn them:

1. **Salience** — the event must EARN a word (chess: blunder/capture/check/
   hang/sacrifice/material/ending). Quiet events go unnarrated; the activity
   block still carries full state, so she is never ignorant, only unprompted.
2. **Rate** — one note per ~25s. Endings and checks are exempt: they are the
   "something crazy happened" a person interrupts their own story for.
3. **Breath** — her voice having ended <3s ago is the pause INSIDE a story.
   "Wait until she is quiet" is not politeness, it is a mechanism for
   interrupting at peak vulnerability. Wait out the pause; drop after ~4 tries.
4. **One exchange, one note** — never narrate a half-exchange while her reply
   is pending, and fire near-instantly (~150ms) once it completes, or the lag
   compounds and she narrates history.

### Realtime surfaces only

If your surface has a live voice lane, the prompt is frozen when the call
connects. A move played mid-call travels as ONE out-of-band note —
`activityNote(fact)` — and **angle brackets, never square**: bracket text on a
voice lane gets SPOKEN (`ack-bracket-direction`: `[laughs softly]` came back as
laughter plus the spoken word "Softly"). One event, one note; never a digest of
the last five.

### What a surface must NOT do

- Do not add a per-activity branch to the engine. If `api/_surface.js` needs
  `if (activity.kind === 'chess')`, the contract is wrong.
- Do not send an unprompted message because the other player moved. Her
  unprompted moves are reason-contingent (`never-scheduled`); a move made while
  she is not in the conversation is not a reason.
- Do not let a finished game keep announcing itself. Close it once she has
  reacted, and keep the move list — "you beat me yesterday" is memory, not
  news.

Gate: `node evals/run.mjs activity`.

---

## 2c. Which clone answers — the binding (Gurukul WS-N, migration 055)

Until 055 this whole document described a layer that answered as exactly one
agent. Not by a setting — by a **constant**: `MEERA_AGENT_ID`, named in
`ensureRoomForSurfaceChat` and `upsertRoomMember`, with `compile()` taking no
`agent` at all. That is correct for a product with one persona and it is
precisely why a second clone on Telegram was a code change.

`vy_clone_channel` answers one question and only one: **on this wire, at this
address, which published clone replies?**

```
(kind, external_ref) --vy_clone_channel--> agent_id --vy_agent--> slug
                                                                    |
                                    api/_teachersheet.js loadTeacherAgent
                                                                    v
                                                              AgentModule
```

### §0 is unchanged, and that is the load-bearing half

A surface is still a TRANSPORT. It is still not a tenant. It still scopes
nothing. The binding yields an **agent**, never a person and never a scope, and
the two halves of an inbound event meet without mixing:

| question | table | agent-scoped? |
|---|---|---|
| who is speaking | `vy_surface_identity` | **no**, and it must never gain an `agent_id` |
| who answers | `vy_clone_channel` | it *is* the agent |

The agent then enters at RETRIEVAL, exactly as `api/_agentscope.js` requires. A
binding that also filtered identity would make "she remembers me from Telegram"
false on the web for no reason a user could ever be told.

### What an adapter must do, and it is two things

1. Put the binding address on the event as `channelRef`. It is **not** the
   `chatKey`: the chatKey addresses a human, `channelRef` addresses the bot or
   the business line. WhatsApp reads it from `value.metadata.phone_number_id`;
   Telegram has none in the payload (a token is already one bot) so it rides on
   the webhook URL as `?ch=<bot id>`.
2. Accept an optional `deps.bind`, call it once per event, and **drop the event
   when it returns null**.

Everything else is `makeCtx`'s two new fields, `ctx.agent` and `ctx.agentId`,
both defaulted to Meera's — so an adapter that passes neither behaves exactly
as it did, which is what `evals/mp/*` still measure without edits.

### Fail closed, with ONE indistinguishable error

Unbound address, paused binding, revoked binding, unpublished clone, withdrawn
consent artifact → all five are `clone_unavailable`, flattened in
`api/_clonechannel.js` on purpose. A caller that could tell them apart could
enumerate which teachers had taken their clone down.

And **never toward Meera**: there is no fallback branch. A wrong-agent fallback
is the disaster case — the student asked their physics teacher and reached a
companion persona built for consenting adults, with none of the minor defaults
and none of the clone disclosure, and every log line would look healthy.

### The credential is a REFERENCE

`vy_clone_channel.credentials_ref` is a `uuid`, so a bot token cannot be cast
into it. The value lives in `api/_channel-secrets.js`, whose **default backend
refuses**: a deployment with no configured secret store cannot connect a
credentialed channel at all. See `docs/gurukul/ENV-MANIFEST.md` §15c.

## 2d. `api/embed.js` — the fourth surface, and the only self-serve one

An embeddable `<script>` that mounts a chat bubble on any site, talking to
`api/clone-chat.js`. It is a surface like the others — its reply comes out of
`gatedReply()` — with three properties none of the other three have:

- **Anonymous, and therefore remembers nothing.** No `vy_person` row, no
  episode, no retrieval. §6.4's rule where it bites hardest: the visitor is
  very likely a minor, consented to nothing, and arrived from a page that is
  not ours.
- **The disclosure is bound into the session token, not asked of the page.**
  The widget runs on somebody else's website, so "it renders the card" cannot
  be the mechanism — a fork that deleted the render would still chat. `open`
  mints a token carrying the card's digest; `say` recomputes the card and
  refuses a token whose digest does not match.
- **The transcript is the client's and it is signed.** Every reply mints a new
  token whose digest covers the transcript so far, so an invented `assistant`
  turn — words in a real named teacher's clone's mouth — is refused.

Needs nobody's approval. That is why it was built first and built completely:
it is the only surface where "self-serve, without us writing code per customer"
is true today rather than after somebody else's review queue.

## 3. The three that exist

### Status, stated so a green run is not read as more than it is

Updated 2026-08-22 (tasks #78, #66). Three columns, because "done" has three
different meanings here and conflating them is how an untested adapter gets
reported as working.

| | `api/tg.js` | `api/discord.js` | `api/whatsapp.js` |
|---|---|---|---|
| **the four functions** | code-complete | code-complete | code-complete |
| **the honesty gate** (`gatedReply`) | LIVE — inherited, not copied | inherited | inherited |
| **room binding** `(surface, surface_chat_id)` | LIVE in the schema (mig 013, applied 2026-08-22), dual-read for pre-013 rooms | usable — a snowflake no longer collides with a Telegram chat id | usable — a `…@g.us` key is storable at all for the first time |
| **identity** `vy_surface_identity` | LIVE, `vy_tg_person` draining behind it | resolves or refuses | resolves or refuses |
| **offline proof** | 101 checks (`evals/mp/tgbot.mjs`) + 57 (`evals/mp/binding.mjs`) | 113 contract + 30 pipeline | 113 contract |
| **`verify()` fail-closed** | proven offline | proven offline | proven offline |
| **`send()` ever called** | NO | NO | NO |
| **live-wire proof** | NONE — needs `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME` | NONE — needs the Discord app | NONE — needs a Meta business account |

Read the middle rows as *the schema and the engine half are live*; read the
last two as *no byte has ever left this process on any of the three wires*.
The three `TELEGRAM_*` values are deliberately empty in `api/_config.js`, so
Telegram is **code-complete and untested on the wire**, not shipping traffic.

### `api/tg.js` — Telegram (code-complete; blocked on credentials)

Webhook with `X-Telegram-Bot-Api-Secret-Token`, constant-time. Private chats
are the 1:1 lane, groups/supergroups are rooms. Admin promotion is the room's
read consent. `/start r<id>` deep link links identity, joins the room and
triggers the one-time intro. Commands `/chup /bolo /bhool /kya`. 4,096-char
limit. The room binding is `(surface='telegram', surface_chat_id=chat.id as
text)` since migration 013; this file needed no change for that, because
`parse()` has always emitted an opaque `String(chat.id)` and the address book
is the engine half's.

Blocked on the owner for `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` /
`TELEGRAM_BOT_USERNAME` — all three are empty in `api/_config.js` today. Until
they exist: no webhook is registered, no update has ever arrived, no `send()`
has ever been called, and `vy_group` holds zero rows. Everything else about
this surface is proven offline (101 + 57 checks); the header of `api/tg.js`
enumerates exactly which claims the three secrets are the only way to settle.

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

- ~~`vy_group.tg_chat_id` is a `bigint`, so the room binding is Telegram-shaped~~
  — **CLOSED 2026-08-22 (task #78).** `db/migrations/013_surface_room_binding.sql`
  was promoted out of `drafts/` and **applied to production**: `vy_group` and
  `vy_group_member` gained `(surface, surface_chat_id)` / `(surface,
  surface_user_id)`, both `text`, plus a partial unique index on the room pair
  and a lookup index on the member pair. Additive and idempotent throughout —
  nothing was dropped, and re-applying the file is a no-op (verified by running
  it twice against production).

  The backfill was **held back in the draft on purpose** — it asserts a fact
  about existing rows — and the fact was checked before applying: `vy_group`
  and `vy_group_member` both held **zero rows** (the bot has never run against
  production), so the assumption holds vacuously and both statements matched
  0 rows. They are in the shipped file anyway, guarded by `surface is null`,
  so a replay or an older writer's row is repaired rather than becoming a
  second migration. `evals/mp/binding.mjs` exercises them on the shape they
  were written for, since zero rows proves nothing about what they do to a row.

  The read and write paths moved with it, in `api/_surface.js`
  (`roomForChat` / `ensureRoomForSurfaceChat` / `upsertRoomMember`):
  **dual-read, new-write.** The new key is read first; on a miss the legacy
  Telegram-shaped key is tried, and a row found that way is ADOPTED on the way
  past, so the compatibility read drains itself under ordinary traffic — the
  same shape `personForSurfaceUser()` uses for `vy_tg_person`. Writes always
  set the new columns, on every surface; `tg_chat_id` / `tg_user_id` are
  mirrored for Telegram only. The legacy lookup is now gated on the surface as
  well as the shape, which is what closes the collision the old
  `chatKeyToChatId()` allowed: Discord channel 9001 and Telegram chat 9001 were
  one room, and are now two.

  **THE RETIREMENT CONDITION**, written down so the transition ends rather than
  becomes the architecture. Three things go together, in one follow-up, and
  removing any one of them alone turns every existing room into "unknown room":
  the compatibility read in `roomForChat()`, the mirror write in
  `ensureRoomForSurfaceChat()` / `upsertRoomMember()`, and the index
  `vy_group_tg_chat_ix`. The condition to fire it: `select count(*) from
  vy_group where surface is null` has been 0 for long enough to be believed,
  `surface` / `surface_chat_id` have been made `NOT NULL` (its own statement,
  its own migration — a `NOT NULL` added before the writer deployed would turn
  the next room creation into an error), and only then do `tg_chat_id` /
  `tg_user_id` get dropped. `evals/surface.mjs` §8 asserts statically that the
  legacy column appears in exactly three places in `api/_surface.js`, so a
  fourth — the compat path spreading instead of draining — fails a gate.

  Still deliberately **not** in 013: `NOT NULL`, `DROP COLUMN`, and a
  `check (surface in (…))`. The last is refused permanently, not deferred: the
  surface list is `api/*.js` adapters, and a CHECK there would mean adding a
  fifth surface requires a migration — "do not teach the engine your surface",
  one layer down. The set of surfaces is not a database fact.

  `api/_room.js`'s `chatKeyToChatId` / `roomByChat` / `ensureRoom` /
  `upsertMember` still exist and are still Telegram-shaped. Nothing in the
  surface layer calls them any more; deleting them is that file's owner's
  change, not this one's.

- **`api/_room.js`'s agent-scoped writers do not name `agent_id`, and
  production has had the default dropped since migration 010.** Found while
  applying 013 (2026-08-22), from the live catalog: `vy_group.agent_id` and
  `vy_group_member.agent_id` are `NOT NULL` with **no default** — 010 dropped
  it on all twenty agent-scoped tables precisely so a writer that never heard
  of agents fails loudly instead of filing another agent's memory under Meera.
  `api/_surface.js`'s two room writers name it and are correct. The remaining
  inserts in `api/_room.js` — `openOrExtendGroupEpisode` (`vy_episode`),
  `recordTurnAction` (`vy_group_turn`) — do not, and will raise a NOT NULL
  violation the first time a real room turn is stored. It is invisible today
  because both tables hold zero rows and the bot has no token.

  It is invisible to the suites too, and that is named rather than papered
  over: `evals/mp/tgbot.mjs`'s fixture stops at 009, where `agent_id` still has
  a default, so the room lane passes there. `evals/mp/binding.mjs`'s fixture
  applies 010 and is therefore production's shape column for column (it asserts
  that against the live catalog), which is why the two room writers under test
  are proven and the others are only named. Fixing them is `api/_room.js`'s
  owner's change.
- WhatsApp's window ledger is a warm-lambda `Map`, so a cold start forgets it
  and `send()` then fails closed (no record = outside the window). The durable
  version reads the last inbound turn from `meera_log`, which is
  `api/memory.js` — another workstream's file.
- `vy_tg_person` still exists. `personForSurfaceUser()` reads
  `vy_surface_identity` first, falls back to it for Telegram, and backfills the
  general table on the way past — so it drains itself under ordinary traffic
  and the day it is dropped is a delete rather than a migration.
