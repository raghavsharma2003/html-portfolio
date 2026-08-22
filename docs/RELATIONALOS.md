# RelationalOS — the layer, named

The owner, 2026-08-21, verbatim intent: *"we will make multiple personalities
and apps on our layers — be it Meera, be it WhatsApp, Telegram, or Discord…
we need to make the real shit happen in the layer only, so that we don't need
to do things again and again for each use case or each personality. I think we
call it RelationalOS."*

This document names the layer so the boundary stops being folklore. Everything
in it already exists in the tree; the point is the TEST, so the next feature
lands on the right side without a debate.

## The boundary test

> Would a different personality, on a different surface, need this unchanged?

Yes → RelationalOS. No → surface. A thing that is "mostly yes" is two things
and should be split until each half answers cleanly.

## What lives in the OS (and where)

| capability | where | proof it generalises |
|---|---|---|
| memory graph, episodes, rel-state, disclosure | `api/memory.js`, `api/_disclosure.js`, migrations | multi-agent tenancy (mig 009) + agent-scope WHERE predicate |
| the prompt compiler (CORE/TAIL, budgets, T-slots) | `src/engine/compiler.ts` | one assembler on chat + both call lanes (G-C6) |
| persona as an injected module | `src/engine/agents/registry` | Phase E: a second agent is a registry row |
| honesty (families 1–4 + presupposition) | `src/engine/honesty.ts` on the output path, reached by the web lane (`brain.ts`) and by every surface (`api/_surface.js` `gatedReply`) | predicates, not prompts — same gate for any personality, on any transport (`evals/surface.mjs`) |
| time, away, repeat, burst pacing | `src/engine/{clock,away,repeat,burst}.ts` | pure functions of the record, no persona text |
| ACTIVITIES — "what we are doing together" | `src/engine/activity.ts` + per-kind adapters | measured 2026-08-21: games two and three (wyr, ttt) each touched five named seams and zero shared logic |
| surface adapter contract | `api/_surface.js`, `docs/SURFACES.md` | Telegram shipping; Discord/WhatsApp code-complete |

## What is allowed to be surface

Rendering, input capture, notification plumbing, platform quirks (Capacitor,
webhooks), and the *choice points* the OS deliberately exposes: which chess
strength this surface plays at, which theme, which activity rows the hub shows.
A surface may choose how bytes reach the wire; it may never choose whether the
OS's guarantees apply (`docs/CONVERSATION-DEFECTS.md`'s closing rule).

## The standing hazards, so they stay visible

1. ~~**`api/_surface.js` does not yet route through parse-and-gate**~~ —
   **CLOSED 2026-08-22 (ticket #102).** Every surface lane now takes its reply
   through `gatedReply()` in `api/_surface.js`, which runs the engine's own
   entry point — `parseBubbles` → `stripTextingDashes` → `guardReply`, the same
   three calls in the same order as `brain.ts`'s `gate()` — via the committed
   bundle. So the non-web surfaces carry families 1–4, the presupposition
   detector, protocol extraction and the texting-dash predicate, and they will
   carry the NEXT family without a line of per-surface code, because the gate
   was routed to rather than copied.

   What makes that a guarantee and not a habit: `ctx.reply` (the raw brain
   call) has exactly one call site in the file, inside `gatedReply`, so no
   expression anywhere can produce deliverable model text without gating it.
   `evals/surface.mjs` asserts that statically — single call site, every
   `deliver()` emitting either app-voiced constants or gate-derived text, no
   adapter holding a reply path of its own — alongside the behavioural half
   (a known fabrication injected as the model's reply comes back rewritten,
   byte-identical to the web lane; a clean reply comes back byte-identical to
   itself). It fails closed: a bundle without the gate makes her say nothing,
   loudly, rather than say something ungated quietly.

   **Still owed, and not covered by this:** an unlinked or non-Meera
   personality shipping on a surface inherits the gate, but the *disclosure*
   half is `api/_disclosure.js`'s and always was. And point 2 below is
   untouched — a surface with a realtime lane is still in the asymmetry.
2. **The live voice lane has no post-generation gate** — speech-to-speech
   output can't be inspected before it is heard. There the OS's honesty is
   carried by input-side fences (the pickup scene clause, provenance-clean
   context notes). Every new realtime surface inherits this asymmetry and must
   say so rather than imply gate coverage.

## Why the layer is trustworthy at all

Because its rules are predicates and its claims are measured — `rejected.md`
is the organ that keeps it honest. An instruction leaked 57–98% of the time;
a SQL predicate leaked 0 in 31,122. When a rule matters, the OS does not ask
the model to follow it; it makes the violation unrepresentable or catches it
on the output path. That is the property every future personality is buying
by building here, and it is the one thing a surface can never provide for
itself.
