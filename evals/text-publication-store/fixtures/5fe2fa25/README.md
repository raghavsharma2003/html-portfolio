# Accepted publication compiler fixture

`src__engine__publishedMaterialAssistant.ts` retains the exact compiler from
accepted application commit `5fe2fa2590a355834bf61eea4e889103351af1f7`, path
`src/engine/publishedMaterialAssistant.ts`.

LF-normalized SHA-256:
`76124a3c3d20b31e19ec0aec12c2337413427567bd98a09d2a238ce45458c0f9`.

The fixture supports teacher publication v1 and v2, before person publication.
The person suite checks its checksum, compares both teacher prompt variants
with the current compiler, and confirms this baseline rejects person authority.
Imports resolve against the same current shared compiler primitives for both
variants, isolating changes in the publication compiler under test.

This source is committed so the test needs neither historical repository
objects nor a moving branch tip. Ordinary checkouts may change line endings;
the test normalizes CRLF to LF before checking and compiling the fixture.
