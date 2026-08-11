# Telemetry — the contract

Goal: any session can be reconstructed, second by second, well enough to answer
"what actually happened" without asking the user. Clicks, typing, corrections,
chat, call, screen share, errors. This file is the contract every producer and
consumer implements against; it is the spec, not a description.

---

## The four rules

**1. It never slows what it observes.** Buffered in memory, flushed on a timer
and at natural boundaries, fire-and-forget, every path wrapped so a telemetry
failure cannot surface as a product failure. No `await` on the hot path, ever.

**2. Content lives in exactly one place per kind.** Sent messages already live
in `meera_log`; telemetry references them by `msg_id` and does NOT copy them.
Duplicating content would mean `forget` deletes the message and leaves a copy in
the audit trail — the feature would become a lie. The one exception is **draft
text**, which exists nowhere else (see `compose.*`), and it is therefore subject
to rule 3.

**3. Everything user-generated is deletable.** Every row carries `device_id`.
`api/memory.js` `opForget` purges telemetry on the same terms it purges the log.
A `wipe` deletes telemetry outright. If you add a table here, add it there.

**4. Ordering is by `t_ms`, not by clock.** `at` is wall-clock and can jump
(NTP, timezone, backgrounding). `t_ms` is a monotonic offset from session start
and is what any timeline reconstruction sorts on. Both are stored.

---

## Identity and sessions

| field | meaning |
|---|---|
| `device_id` | the identity everywhere else in this schema; the delete key |
| `user_id` | set when signed in, else null — never the delete key |
| `session_id` | one app run: `<surface>-<base36 ms>-<rand>` |
| `seq` | per-session counter, gap-detectable; a hole means a dropped batch |
| `t_ms` | ms since session start, monotonic (`performance.now`) |

A session ends at hide/unload; a new run mints a new id. Call and watch sessions
nest inside an app session and carry their own `call_id` / `watch_id` in props,
so a call is a filter over one app session rather than a separate stream.

---

## Event taxonomy

Namespaced `area.event`. Props are a flat JSON object. Unknown events are
accepted and stored — the schema must never be the reason an event is lost.

### `app.*` — lifecycle and environment
- `app.start` — platform, version, build, bundle version, locale, tz offset,
  screen size, dpr, network type, whether native, cold/warm
- `app.foreground` / `app.background` — with `away_ms` on return
- `app.route` — `from`, `to`, `via` (tap/back/deeplink)
- `app.visibility` — `hidden`/`visible`
- `app.orientation`, `app.resize` — new size
- `app.net` — online/offline, effective type change
- `app.update_check`, `app.update_downloaded`, `app.update_applied`,
  `app.update_rolled_back` — the OTA path (see docs/AUTOUPDATE.md)

### `ui.*` — what they touched
- `ui.tap` — `label` (accessible name or data-tel attr), `path` (stable element
  path, NOT innerText), `x`,`y`, `since_paint_ms`
- `ui.long_press`, `ui.swipe` (`dir`, `dist`), `ui.scroll` (`depth_pct`,
  `dir`, `velocity`, throttled to 250ms)
- `ui.focus` / `ui.blur` — `field`
- `ui.rage_tap` — 3+ taps on the same target inside 800ms. A first-class event,
  because it is the single best signal of "the app is not responding to me".
- `ui.dead_tap` — a tap that produced no state change and no navigation in 1s

**Never store innerText as a label.** Use an explicit `data-tel="..."` attribute
or the accessible name. Message bubbles contain conversation content and would
smuggle it into telemetry, breaking rule 2.

### `compose.*` — how they typed, and how they changed their mind
This is the one place draft text is captured, because it exists nowhere else.
- `compose.start` — `field`, `t_since_last_msg_ms`
- `compose.keys` — rolled up every 2s or on send, never per keystroke:
  `keys`, `backspaces`, `deletes`, `selection_replaces`, `pastes`,
  `ime_compositions`, `iki_p50`, `iki_p90` (inter-key interval),
  `pauses_over_2s`, `longest_pause_ms`, `chars_net`, `chars_gross`
- `compose.edit` — a correction after a pause: `pos`, `removed_len`,
  `added_len`, `kind` (`backspace_run` | `mid_edit` | `select_replace`)
- `compose.draft` — the draft text at send, and at abandon. `text`, `final`.
  Deletable (rule 3).
- `compose.abandon` — typed then cleared without sending: `chars`, `alive_ms`
- `compose.send` — `msg_id`, `chars`, `compose_ms`, `revisions`

### `chat.*` — the exchange
- `chat.send` — `msg_id`, `kind`, `chars`
- `chat.reply` — `msg_id`, `latency_ms`, `bubbles`, `kind`, `lane`, `model`,
  `stream_first_token_ms`, `truncated`
- `chat.media` — `kind` (photo/gif/voicenote), `msg_id`, `chosen`
- `chat.reaction`, `chat.swipe_reply`, `chat.copy`
- `chat.read` — bubbles actually scrolled into view, with dwell
- `chat.error` — `stage`, `status`, `retried`

### `call.*` — extends the existing `diag("call", …)` events, same sink
- `call.start` / `call.end` — `reason`, `duration_ms`, `lane`
- `call.connect` — the existing `live_connect` fields incl. `uplinkMs`,
  `setupBytes`
- `call.turn` — `who`, `dur_ms`, `words`, `first_audio_ms`, `lane`
- `call.bargein` — `at_ms_into_her_turn`, `accepted`, `coupling_db`
- `call.silence` — `ms`, `who_broke_it`
- `call.tts` — `lane` (free/paid), `first_audio_ms`, `chars`, `cached`
- `call.lane_change` — `from`, `to`, `reason` — the voice-swap class of bug
- `call.audio_glitch` — underrun, overlap detected, duplicate speaker

### `watch.*` — screen share
- `watch.start` / `watch.stop` — `reason`, `duration_ms`, `lane`
- `watch.frame` — sampled: `age_ms`, `bytes`, `w`,`h`, `blank`
- `watch.scene` — `class` (settle/reshow/point/start/along/idle), `hold_ms`
- `watch.wake` — `class`, `frame_age_ms`, `suppressed_by` (quiet/ceiling/none)
- `watch.comment` — `words`, `frame_age_ms`, `msg_id`
- `watch.no_comment` — why
- `watch.grounding` — **the fabrication audit**: `had_frame`, `frame_age_ms`,
  `named_entities` (count only), so a claim can be checked against whether a
  picture had actually arrived

### `err.*`
- `err.js` — `msg`, `stack` (trimmed), `where`
- `err.promise`, `err.fetch` — `url_path` (never query), `status`, `ms`
- `err.render` — component boundary

---

## Transport

`POST /api/telemetry`

```json
{ "device": "...", "user_id": "...|null", "session": "...", "surface": "app",
  "records": [ { "seq": 1, "t_ms": 1234, "at": 1786461276777,
                 "area": "ui", "event": "ui.tap", "props": { } } ] }
```

- Batch on a 4s timer, or at 60 records, whichever first.
- Flush immediately on `visibilitychange:hidden`, `pagehide`, call end, watch
  end, and any `err.*`.
- Use `navigator.sendBeacon` when the page is going away; `fetch` with
  `keepalive` as the fallback.
- **Offline queue in IndexedDB**, capped at 2000 records / 24h, drained on
  reconnect. A flight-mode session must not vanish — that is exactly the
  session someone will ask about.
- Server always returns 200 unless the batch is malformed. Telemetry must never
  push back on the app.

---

## Storage

```sql
create table if not exists meera_tel (
  id         bigint generated always as identity primary key,
  device_id  text not null,
  user_id    uuid,
  session_id text not null,
  seq        integer,
  area       text not null,
  event      text not null,
  t_ms       integer,
  props      jsonb not null default '{}'::jsonb,
  at         timestamptz not null default now()
);
-- NOT named meera_tel_session: tables and indexes share one namespace in
-- Postgres, so that name would be claimed by the index and the
-- `create table if not exists meera_tel_session` below would find a relation
-- of that name and SKIP — with a NOTICE, not an error. The apply reports
-- success, the table never exists, and every rollup query fails much later.
create index if not exists meera_tel_session_tms on meera_tel (session_id, t_ms);
create index if not exists meera_tel_device_at on meera_tel (device_id, at desc);
create index if not exists meera_tel_event_at on meera_tel (event, at desc);
create index if not exists meera_tel_area_at on meera_tel (area, at desc);
```

One session row so a session can be listed without scanning events:

```sql
create table if not exists meera_tel_session (
  session_id  text primary key,
  device_id   text not null,
  user_id     uuid,
  surface     text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  events      integer not null default 0,
  platform    text,
  app_version text,
  meta        jsonb not null default '{}'::jsonb
);
create index if not exists meera_tel_session_device on meera_tel_session (device_id, started_at desc);
```

---

## Reading it back

`node scripts/session.mjs --list [--device X] [--since 24h]`
`node scripts/session.mjs --session <id>` — the full timeline, `t_ms` ordered,
joined against `meera_log` by `msg_id` so what was SAID appears inline with what
was DONE, without telemetry ever having stored it.
`node scripts/session.mjs --session <id> --rca` — derived findings: gaps in
`seq`, rage/dead taps, lane changes mid-call, comments with no fresh frame,
replies over budget, errors.

---

## Privacy, stated plainly

This captures far more than before, including draft text. Two consequences that
are the owner's to accept, not mine to assume:

1. **`/privacy` must say so.** It currently describes conversation storage. It
   does not describe keystroke dynamics or draft capture. Shipping this without
   updating that page would make the page inaccurate.
2. **Rule 3 is what keeps `forget` honest.** Telemetry purge is wired into the
   same op. If a future table skips it, the product starts lying about deletion.
