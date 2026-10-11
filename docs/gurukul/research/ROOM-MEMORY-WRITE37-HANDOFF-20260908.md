# Room write acknowledgement, focused verification

Base: release34 `5ade4ea95209b15b0268338128514401be41b710`. Source is not integrated or fully accepted. Initial preparation ran no tests while root reserved the host. After full release34 terminated, root cleared focused execution; results below are from this isolate, not a deployment or database proof.

`logDmTurn` previously caught INSERT errors and returned undefined for both success and failure. `roomSay` awaited it and returned `remembers:true`, which is a preference rather than a persistence acknowledgement. The patch returns `{persisted:boolean}` from the existing writer and adds `memory_write_state: confirmed | unconfirmed | not_requested` to each Room turn. A missing legacy/injected acknowledgement counts as unconfirmed. The field concerns raw user/assistant turn persistence only, not episode creation, consolidation, retrieval quality or long-term memory completeness.

An uncertain write does not retry the insert or model call and does not throw away an answer already generated and charged. The same response retains answer, session, preference and quota. Web attaches the nonblocking status to the affected exchange, using the existing room-fine style and English/Hindi copy. Telegram and WhatsApp send the same status through their existing transport and locale helpers. Status delivery is best effort after answer delivery; a status failure cannot turn it into a failed webhook that invites another answer. Voice reply binding continues to refer only to the generated answer, never the application notice.

Prepared tests in the existing `evals/room/run.mjs` exercise the actual extracted writer body with acknowledged/ambiguous fake SQL and exactly one attempted insert; five Room writer-outcome combinations assert raw-write state, reply retention and one model call. Existing no-memory case asserts not_requested. No fixture SQL is claimed to prove PostgreSQL validity. Existing SQL text is unchanged.

Remaining validation: a bounded mounted web check for an unconfirmed result at mobile/desktop widths and integration/full-release acceptance. No browser, SQL or provider call ran here. No package install ran: this isolate uses a junction to release34's dependencies and a copy of its verified inert config (SHA256 `728dc5821336bed9c5ad851b3e837a54d342674923de81454ce11b0a2d48a432`). Impeccable hardening/craft-floor guidance was read during preparation.

## Focused results, 2026-09-08

- `node evals/room/run.mjs`: 67 passed, 0 failed, terminal0. Raw writer acknowledgement is tested by actual extracted writer body with fake SQL, not PostgreSQL parsing.
- `node evals/room-telegram/run.mjs`: 68 passed, 0 failed, terminal0.
- `node evals/room-whatsapp-chat/run.mjs`: first run115passed/2failed; repaired explicit successful-write fixture acknowledgement and added4uncertain-send controls, final121passed/0failed, terminal0.
- `node evals/room-telegram-voice/run.mjs`: first run55passed/7failed; repaired successful-write fixture acknowledgement and added8English/Hindi notice and delivery-failure controls, final70passed/0failed, terminal0.
- `node node_modules/typescript/bin/tsc -b --force`: terminal0, no diagnostics. No TS/TSX source changed after this run.
- `node scripts/check-copy.mjs`: 7 scopes clean, 21 negative controls, terminal0. No product copy changed after this run.

Original failing transport logs are retained under `scratchpad/room-memory-write37-whatsapp.log` and `scratchpad/room-memory-write37-telegram-voice.log`; final logs use `-v2.log`. Other receipts are `room-memory-write37-room.log`, `room-memory-write37-telegram.log`, `room-memory-write37-typescript.log` and `room-memory-write37-copy.log` in the same ignored directory. Parent owns review, context logging and commit; no commit or freeze was made by the validation agent.

The transport failures were actual fixture regressions: prior success fakes returned `undefined`, which now correctly produces an unconfirmed-save notice. Exact happy-path message count and ordering assertions remain unchanged. Success fakes now return `{persisted:true}`; separate negative cases prove missing/false acknowledgements send a notice, preserve the answer, call the model once, and do not retry after notice delivery throws. Telegram covers English and Hindi notices through the actual locale switch. All transports remain offline fixtures, not live deliveries.

Context-ready entries:

- Decision: expose raw turn-save uncertainty without discarding the completed answer or automatically retrying. Rationale: the original write may have committed and the provider call already incurred cost. Reverse if the Room gains an atomic durable operation receipt allowing safe replay, or actual caller testing shows the additive field breaks a consumer.
- Measurement: 2026-09-08, n=1 frozen-base source path traced across the raw writer, Room response and three web/Telegram/WhatsApp callers. Existing writer returned undefined on both success/failure. No runtime pass count or quality score exists for this patch.
- Rejection: throwing on the assistant persistence failure after generation. Source ordering shows this would hide the completed answer and invite a repeat despite quota/provider spending. Also reject interpreting remembers=true as saved; it records consent, not this write's outcome.
