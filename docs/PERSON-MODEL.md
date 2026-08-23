# Evidence-backed Person Model

Status: implemented control-plane slice on `voice-cloning`, 2026-08-24. It is
not a claim of human-replica fidelity. A private, cited audio-transcript claim
extractor now feeds review-pending claims, but general multimodal extraction
and a qualified behavioural generation model remain closed.

## Purpose

The Person Model is the versioned, owner-reviewed representation of a replica's
identity, speech habits, behaviour, values, boundaries, autobiography and
relationship modes. It is deliberately separate from VoiceGenome,
RelationalOS and any runtime prompt.

```text
immutable evidence -> cited claims -> owner decisions -> deterministic profile
                                                       -> frozen runtime capability
```

Raw transcripts, provider metadata and arbitrary uploaded JSON never enter the
runtime prompt. The runtime receives a bounded typed view of one approved
profile version. Relationship-specific state remains isolated in RelationalOS
at `(agent_id, person_id)` and is not copied into the global profile.

## Claim review

Every claim is scoped to one owner and replica and cites its private source set.
The owner can append one of three decisions:

- `accepted`: accurate, representative, or current;
- `rejected`: inaccurate, not me, private/exclude, or wrong context;
- `superseded`: outdated or replaced.

Decisions are append-only. The latest decision controls eligibility, preserving
the review history without exposing source identifiers in the browser.
Expired and superseded claims cannot contribute to readiness, the source-set
commitment, or the generated definition.

## Deterministic profiles

`person-model-builder/v1` creates `vyakti.person-model.v1` from the accepted,
currently valid claim set. The source-set hash is order-independent and commits
to the claim body, provenance class, confidence and validity interval. Repeating
the same build is idempotent. Any change in accepted evidence produces a new
draft version.

Approval recomputes the current eligible source set server-side and approves
only the exact matching draft. An older profile is retired unless an active
runtime capability has frozen it. A stale browser cannot approve a profile
after its evidence changed, and an upgrade cannot silently break a live one.

Minimum readiness currently requires:

- accepted self name and language identity;
- accepted behavioural evidence;
- at least one explicit boundary;
- no conflicting accepted self-name or pronoun claims.

The definition retains competing non-critical observations as explicit
uncertainty rather than averaging them into a fabricated fact.

## Security invariants

- Ownership comes only from the verified bearer session.
- Claim, decision, profile and replica rows are joined on owner and replica.
- Client responses omit source ids, raw transcripts and evidence hashes.
- The API never accepts a client-authored profile definition.
- Activation still requires a separately approved VoiceGenome, live consent,
  self-verification and all seven qualification suites.

## Extracted proposals

`docs/CLAIM-EXTRACTION.md` defines the first automatic intake lane. It accepts
only reviewed target-speaker transcript evidence, masks direct identifiers,
requires exact server-verified citations and writes proposals that still need
the same owner decisions above. It cannot approve a claim, manufacture
`self_declared` provenance or bypass the deterministic profile builder.

## Deliberate closed gates

General memory import, non-audio extraction, fine-tuning and production
dialogue generation remain closed. Typed preference collection and
deterministic calibration policy building are implemented separately in
`docs/CALIBRATION.md`; learned preference models are not. Until live consent,
provider quality and end-to-end dialogue gates exist, this subsystem is an
auditable control plane, not a finished replica.
