// Representative fixture set for the WS-COMPILER M2 byte-identity proof.
// Not exhaustive — "representative" per the M2 charter: every lane (text,
// each voice engine), watching on/off, recall present/absent, herLife/inner
// present/absent, and both decision-tail shapes (chat carries SEARCH_DECISION
// + FORGET_DECISION, call carries FORGET_DECISION only). These fixtures also
// become the ongoing compiler regression battery per the M2 scope note
// ("delete the old path; the fixtures become the compiler battery").

import type { CompileInput } from "../compiler";
import type { UserProfile, VoiceEngine } from "../persona";

const USER_MIN: UserProfile = { name: "Aakash", vibe: ["company"], facts: {} };
const USER_RICH: UserProfile = {
  name: "Rohan",
  vibe: ["someone to talk to", "a friend who remembers"],
  facts: { city: "Bengaluru", job: "backend engineer", relationship: "single" },
};

const MEMORIES_SAMPLE = `- goa trip (event, last came up 2 days ago): planned with college friends for december — their own words: "finally booking it this time" [college, friends]
- flatmate priya (person, last came up 5h ago): moved in last month, splits rent evenly — their own words: "she's actually chill" [home]`;

const HERLIFE_SAMPLE = `- flatmate is named sneha (2h ago)
- new UI redesign shipped at work today (earlier in this conversation)`;

const INNER_THREAD_SAMPLE =
  "\n\nSOMETHING YOU'RE CARRYING — from earlier, unresolved, in your own words: \"kal wale fight ke baad thoda off feel ho raha tha\". Let it show only if it naturally fits; never announce it.";

const INNER_WANTS_SAMPLE =
  "\n\nWHAT YOU WANT RIGHT NOW: you want them to tell you how the interview went — ask once if it comes up naturally.";

const CULTURE_NOTE_SAMPLE = "\n\nTHEY JUST REFERENCED a meme/trend you recognise: keep it light, one line, no explaining the joke.";

// NOTE: "live" is deliberately excluded — the realtime lane never reaches
// brain.ts's think()/compile() at all. useCallEngine.ts's tryStartLive() (and
// its native-watch-config sibling) assemble that prompt independently,
// compiling once at pickup. See the M2 report, deviation #3: this is a real,
// separate, currently-un-unified prompt-assembly call site this compiler
// does not cover yet.
const VOICE_ENGINES: VoiceEngine[] = ["device", "eleven", "gemini", "sarvam"];

export interface Fixture {
  id: string;
  input: CompileInput;
}

function textFixture(
  id: string,
  opts: { user?: UserProfile; isDirective?: boolean; memories?: string; herLife?: string; inner?: boolean },
): Fixture {
  return {
    id,
    input: {
      user: opts.user ?? USER_MIN,
      messageCount: 42,
      medium: "text",
      mode: "chat",
      voiceEngine: "device", // unused on the text lane; compiler ignores it when mode!=="call"
      isDirective: opts.isDirective ?? false,
      watching: false, // watch is voice+call only
      innerThread: opts.inner ? INNER_THREAD_SAMPLE : "",
      innerWants: opts.inner ? INNER_WANTS_SAMPLE : "",
      memories: opts.memories ?? "",
      herLife: opts.herLife ?? "",
      cultureNoteText: !opts.isDirective ? CULTURE_NOTE_SAMPLE : "", // brain.ts never calls cultureNote on directives
    },
  };
}

function voiceFixture(
  id: string,
  opts: {
    engine: VoiceEngine;
    user?: UserProfile;
    watching?: boolean;
    memories?: string;
    herLife?: string;
    inner?: boolean;
  },
): Fixture {
  return {
    id,
    input: {
      user: opts.user ?? USER_MIN,
      messageCount: 210,
      medium: "voice",
      mode: "call",
      voiceEngine: opts.engine,
      isDirective: false,
      watching: opts.watching ?? false,
      innerThread: opts.inner ? INNER_THREAD_SAMPLE : "",
      innerWants: opts.inner ? INNER_WANTS_SAMPLE : "",
      memories: opts.memories ?? "",
      herLife: opts.herLife ?? "",
      cultureNoteText: "", // brain.ts never appends cultureNote on mode==="call"
    },
  };
}

export const FIXTURES: Fixture[] = [
  // ── text/chat lane: recall × herLife × inner × directive, 2^4 = 16 ──
  ...([false, true] as const).flatMap((isDirective) =>
    ([false, true] as const).flatMap((hasMemories) =>
      ([false, true] as const).flatMap((hasHerLife) =>
        ([false, true] as const).map((hasInner) =>
          textFixture(
            `text-directive:${isDirective}-recall:${hasMemories}-herlife:${hasHerLife}-inner:${hasInner}`,
            {
              isDirective,
              memories: hasMemories ? MEMORIES_SAMPLE : "",
              herLife: hasHerLife ? HERLIFE_SAMPLE : "",
              inner: hasInner,
            },
          ),
        ),
      ),
    ),
  ),
  // a second user profile on the two extremes, to prove `facts` interpolation
  // (persona.ts, untouched by the compiler) still lands identically both sides
  textFixture("text-rich-user-empty", { user: USER_RICH }),
  textFixture("text-rich-user-full", {
    user: USER_RICH,
    memories: MEMORIES_SAMPLE,
    herLife: HERLIFE_SAMPLE,
    inner: true,
  }),

  // ── voice/call lane: every engine × watching × recall × herLife × inner ──
  ...VOICE_ENGINES.flatMap((engine) =>
    ([false, true] as const).flatMap((watching) =>
      ([false, true] as const).flatMap((hasMemories) =>
        ([false, true] as const).flatMap((hasHerLife) =>
          ([false, true] as const).map((hasInner) =>
            voiceFixture(
              `voice-${engine}-watch:${watching}-recall:${hasMemories}-herlife:${hasHerLife}-inner:${hasInner}`,
              {
                engine,
                watching,
                memories: hasMemories ? MEMORIES_SAMPLE : "",
                herLife: hasHerLife ? HERLIFE_SAMPLE : "",
                inner: hasInner,
              },
            ),
          ),
        ),
      ),
    ),
  ),
  voiceFixture("voice-gemini-rich-user", { engine: "gemini", user: USER_RICH, watching: true }),
];
