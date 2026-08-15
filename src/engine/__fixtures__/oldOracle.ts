// FROZEN. This is a byte-for-byte copy of brain.ts's inline prompt assembly
// as it existed immediately BEFORE the WS-COMPILER M2 extraction — the
// independent oracle the byte-identity harness compares compiler.ts's
// `compile()` against. It intentionally does NOT import or call
// compiler.ts, so a bug introduced during extraction cannot hide by having
// both sides share the buggy code path.
//
// DO NOT "fix" this file to match future compiler.ts changes. If a real
// behavior change is ever wanted, that is a decision for a full charm-gated
// re-authoring pass (SPEC §0.3), and it happens in compiler.ts + persona.ts,
// never here. This file's only job is to keep remembering what "today" meant
// on 2026-08-15.
//
// Takes the same CompileInput shape as compiler.ts (type-only import — zero
// runtime coupling) so the harness can feed both sides identical fixtures.

import {
  buildSystemPromptParts,
  buildSpeechStyle,
  WATCH_MODE_NOTE,
  SEARCH_DECISION,
  FORGET_DECISION,
} from "../persona";
import type { CompileInput, CompiledPrompt } from "../compiler";

export function compileOld(input: CompileInput): CompiledPrompt {
  const parts = buildSystemPromptParts(input.user, input.messageCount, input.medium);
  const sysCore = parts.core + (input.mode === "call" ? buildSpeechStyle(input.voiceEngine) : "");
  let sysTail = parts.tail;

  sysTail += input.innerThread;

  if (input.watching) sysTail += WATCH_MODE_NOTE;

  if (input.memories) {
    sysTail += `\n\nWHAT YOU REMEMBER ABOUT THEM — from your earlier conversations, each tagged with when it last came up. These are real: when they touch on one, you KNOW it and you say the specific detail rather than making them repeat themselves. Two things keep it honest:
- Something being listed here is not a reason to say it. It comes out only where it actually fits, one at a time, woven into normal talk — never several at once, never as a list, never with any mention of remembering.
- A memory is not a live update. Anything with a date, a plan or a situation in it may already have happened or changed, so an old one gets talked about as old ("us december wali shaadi ho gayi na?") instead of announced as if it's still ahead — and then you let them tell you where it stands.
${input.memories}`;
  }
  if (input.herLife) {
    sysTail += `\n\nWHAT YOU'VE ALREADY TOLD THEM ABOUT YOUR OWN LIFE — you said these, so they are now fixed between you two, not open to reinvention. Same job, same people, same flat, same plans, same things you did. Add new texture freely; never say anything that contradicts a line here, and never re-tell one as if it's news:\n${input.herLife}`;
  }
  sysTail += input.innerWants;

  if (input.mode === "chat" && !input.isDirective) sysTail += input.cultureNoteText;
  if (input.mode === "chat") sysTail += SEARCH_DECISION;
  sysTail += FORGET_DECISION;

  return { core: sysCore, tail: sysTail, system: sysCore + sysTail };
}
