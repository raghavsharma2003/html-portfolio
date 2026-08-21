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
| honesty (families 1–4 + presupposition) | `src/engine/honesty.ts` on the output path | predicates, not prompts — same gate for any personality |
| time, away, repeat, burst pacing | `src/engine/{clock,away,repeat,burst}.ts` | pure functions of the record, no persona text |
| ACTIVITIES — "what we are doing together" | `src/engine/activity.ts` + per-kind adapters | measured 2026-08-21: games two and three (wyr, ttt) each touched five named seams and zero shared logic |
| surface adapter contract | `api/_surface.js`, `docs/SURFACES.md` | Telegram shipping; Discord/WhatsApp code-complete |

## What is allowed to be surface

Rendering, input capture, notification plumbing, platform quirks (Capacitor,
webhooks), and the *choice points* the OS deliberately exposes: which chess
strength this surface plays at, which theme, which activity rows the hub shows.
A surface may choose how bytes reach the wire; it may never choose whether the
OS's guarantees apply (`docs/CONVERSATION-DEFECTS.md`'s closing rule).

## The two standing hazards, so they stay visible

1. **`api/_surface.js` does not yet route through parse-and-gate** (ticket
   #102). Until it does, non-web surfaces do NOT carry the honesty guarantees,
   and no personality should ship on them with claims to the contrary.
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
