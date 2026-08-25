// MEETING MEERA — the first minute, moved into the world.
//
// docs/DESIGN-WORLD.md §Phase 3.3: "the first minute must feel like walking
// into the painting the rest of the app lives in." Before this, onboarding was
// the one surface that still looked like the app it used to be — a white card
// with a fanned stack of photos on it, opening straight onto a home screen
// that is a painted Indian sky. The seam was the first thing anyone saw.
//
// So the whole flow runs ON the world layer, at the live sky, with the same
// glass vocabulary the home cards use. Three light steps, zero friction, and
// the same three it has always been.
//
// ── WHAT CARRIES OVER UNTOUCHED, AND WHY IT IS LISTED ────────────────────
//
// This is a PRESENTATION rebuild. Three things in here are load-bearing and
// were moved without being edited:
//
//   1. THE HONEST LINE. "…is an AI companion, beautifully human in how she
//      talks, always honest about what she is. For adults 18+ only." That is
//      charter copy, not UI text: it is the promise the whole product is
//      built on and the one the competitor breaks. Verbatim, and it stays on
//      the FIRST step, before anything is asked of anyone.
//   2. THE TOPIC CHIPS AND THEIR WIRING. `TOPICS` and the `seedCurrencyChips`
//      call are #65's, including the topics-FIRST ordering and the reason for
//      it (opSeedCurrency caps a batch at 6, and the vibe chips honestly miss
//      the classifier). Not one character of that logic changed.
//   3. THE onDone SHAPE. App.tsx stamps `theme: s.theme ?? "sky"` on the
//      other side of this callback; the shape it is handed is identical.
//
// ── WHAT WAS DROPPED, ON PURPOSE ─────────────────────────────────────────
//
// THE PHOTO FAN. Three small tilted photos behind step one is the shipped
// pattern and it was the right pattern when step one had nothing else in it.
// It is the wrong one now: the owner's `onboard-window-night.jpg` IS the
// meeting moment, and a fan of three more photographs behind a photograph is
// two photo treatments competing on the screen whose entire job is to
// introduce ONE person. `impeccable`'s no-cards-inside-cards, applied to
// pictures. One photograph, held large, in a painted world.
//
// ── MOTION ───────────────────────────────────────────────────────────────
//
// framer-motion is gone from this file, and that is a simplification rather
// than a preference: the step transition is now a CSS entrance keyed on the
// step, which means `scripts/check-motion.mjs` can SEE it (it lints
// stylesheets, so a duration living in a JS object was a duration outside
// every gate this repo has), it runs off the main thread during first-run
// load, and it costs the first minute one fewer library. `AnimatePresence`'s
// exit half is not replaced: with `mode="wait"` the exit was a beat of empty
// screen before the next step, and losing it makes the flow quicker rather
// than poorer. Reduced motion is handled in onboard.css, completely.

import { useState } from "react";
import { HER_NAME, type UserProfile } from "../engine/persona";
import { seedDayOneConsolidation, seedCurrencyChips } from "../engine/memory";
import WorldLayer, { useSky, skyVars } from "./WorldLayer";
import { AnimGlyph } from "./anim";
import onboardNight from "../assets/onboard-window-night.jpg";
import onboardNight600 from "../assets/onboard-window-night-600.jpg";
import "../styles/onboard.css";

const VIBES = [
  "someone to talk to",
  "late-night company",
  "hype-friend energy",
  "deep conversations",
  "someone who listens",
  "just curious",
];

// #65 TOPIC CHIPS. Onboarding asked nothing topic-shaped before this, so
// vy_currency (her "things we talk about" store, primed via
// seedCurrencyChips → api/memory.js's opSeedCurrency) started cold for
// every new person — the classifier it runs each chip through
// (CURRENCY_KIND_HINTS) was correct and ready, it simply never saw a chip
// worth matching. These five are deliberately chosen to each hit exactly
// one of the five kinds vy_currency actually stores (cricket/food/place/
// film/festival — db/schema.sql), verified against api/memory.js's own
// regexes rather than guessed: "diwali & festivals" carries the literal
// keyword because "festivals" (plural) alone does not match `\bfestival\b`.
// Optional and skippable like VIBES above — this never blocks "Start
// talking".
const TOPICS = ["cricket", "bollywood & movies", "food & chai", "travel", "diwali & festivals"];

interface Props {
  onDone: (user: UserProfile) => void;
  // GAP 2/3 (WS-FELT): only needed to fire the two day-1 seed calls below —
  // optional so any other caller/test constructing this component without a
  // real device identity yet doesn't have to fabricate one.
  deviceId?: string;
}

export default function Onboarding({ onDone, deviceId }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [vibe, setVibe] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  // The live sky, exactly as home and both call screens take it. Someone
  // onboards at noon, and the glass has to follow the sky then too.
  const sky = useSky();

  const toggleVibe = (v: string) =>
    setVibe((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  const toggleTopic = (t: string) =>
    setTopics((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const finish = () => {
    // GAP 2/3 (WS-FELT), fire-and-forget: never awaited, never allowed to
    // delay or fail this transition — the button must feel exactly as
    // instant as it did before either call existed. The nightly cron
    // remains the backstop for both regardless of whether these land.
    if (deviceId) {
      seedDayOneConsolidation(deviceId);
      // #65 TOPIC CHIPS: topics FIRST — opSeedCurrency caps a batch at 6
      // chips, and every VIBES chip honestly misses the currency classifier
      // (none are topic-shaped), so topics-first is what keeps a full topic
      // pick from being silently truncated by a full vibe pick.
      const currencyChips = [...topics, ...vibe];
      if (currencyChips.length) seedCurrencyChips(deviceId, currencyChips);
    }
    onDone({
      name: name.trim(),
      vibe: vibe.length ? vibe : ["company"],
      facts: topics.length ? { topics: topics.join(", ") } : {},
    });
  };

  return (
    <div className="onb" style={skyVars(sky)} data-sky={sky.state}>
      <WorldLayer frame={sky} />
      {/* `key` is the whole animation: React swaps the subtree on a step
          change, the new one enters under `@starting-style`, and there is no
          library and no exit beat. */}
      <div className="onb-step" key={step}>
        {step === 0 && (
          <div className="onb-meet">
            {/* THE MEETING MOMENT. One photograph, held large, floating in
                the world rather than pasted onto a card — the frame is a
                hairline and a shadow, nothing more, because anything heavier
                turns a person into an illustration of a person. */}
            <div className="onb-photo">
              <img
                src={onboardNight600}
                srcSet={`${onboardNight600} 600w, ${onboardNight} 941w`}
                sizes="(max-width: 360px) 78vw, 300px"
                width={600}
                height={1066}
                alt={`${HER_NAME}, at her window`}
                draggable={false}
                decoding="async"
                fetchPriority="high"
              />
            </div>
            {/* her name in the identity home established: lowercase serif */}
            <h1 className="onb-name name-serif">{HER_NAME}</h1>
            <p className="onb-lede">
              Some days deserve <em>someone to tell</em>.
            </p>
            <p className="onb-sub">
              She texts in Hinglish, calls when you want to hear a voice, and
              remembers what you tell her.
            </p>
            <button
              className="onb-cta"
              data-tel="onboarding.start"
              onClick={() => setStep(1)}
            >
              Meet {HER_NAME}
            </button>
            {/* CHARTER COPY, VERBATIM. legal text is text: --ink-faint put it
                at 2.7:1, which is a disclosure nobody can read. On the world
                it takes --world-ink-dim, which is gated at 4.5:1 against
                every one of the five skies. */}
            <p className="onb-honest">
              {HER_NAME} is an AI companion, beautifully human in how she
              talks, always honest about what she is. For adults 18+ only.
              By continuing you confirm you're 18 or older.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="onb-ask">
            <h1 className="onb-q">
              Hi, main {HER_NAME}{" "}
              {/* Her own bloom, not the platform's. It is 30px because the
                  glyph it replaces was 30px, and its alt is the word the
                  emoji announced, so the heading reads the same aloud as it
                  did. Reduced motion gets the still drawing (./anim.tsx). */}
              <AnimGlyph name="bloom" size={30} alt="blossom" className="onb-bloom" />
              <br />
              Tumhe kya <em>bulaun</em>?
            </h1>
            <p className="onb-sub">Bas naam batao, jo dost bulate hain wahi chalega.</p>
            <input
              className="onb-field"
              placeholder="Your name"
              value={name}
              autoFocus
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(2)}
            />
            <button
              className="onb-cta"
              data-tel="onboarding.name_next"
              disabled={!name.trim()}
              onClick={() => setStep(2)}
            >
              Nice to meet you
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="onb-ask">
            <h1 className="onb-q">
              {name.trim()}, what are you <em>looking for</em>?
            </h1>
            <p className="onb-sub">Pick anything that feels true. I'll take it from there.</p>
            <div className="onb-chips">
              {VIBES.map((v) => (
                <button
                  key={v}
                  className={`onb-chip ${vibe.includes(v) ? "on" : ""}`}
                  aria-pressed={vibe.includes(v)}
                  onClick={() => toggleVibe(v)}
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="onb-sub onb-sub-tight">
              aur baat kis pe hoti rahegi? <span className="onb-opt">(optional)</span>
            </p>
            <div className="onb-chips">
              {TOPICS.map((t) => (
                <button
                  key={t}
                  className={`onb-chip ${topics.includes(t) ? "on" : ""}`}
                  aria-pressed={topics.includes(t)}
                  onClick={() => toggleTopic(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <button className="onb-cta" data-tel="onboarding.finish" onClick={finish}>
              Start talking
            </button>
          </div>
        )}
      </div>

      {/* Onboarding used to move in one direction only: a typo in your name
          on step 2 was a typo she would use forever, because there was no
          way back and no way to edit it afterwards either. */}
      <div className="onb-foot">
        <button
          className="onb-back"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          aria-label="Back"
        >
          ← back
        </button>
        <div className="onb-dots" role="presentation">
          {[0, 1, 2].map((i) => (
            <i key={i} className={i === step ? "on" : ""} />
          ))}
        </div>
        <span className="onb-back" aria-hidden="true" />
      </div>
    </div>
  );
}
