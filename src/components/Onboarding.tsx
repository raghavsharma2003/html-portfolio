// Meeting Meera — onboarding that feels like being introduced to a person,
// not filling out a form. Three light steps, zero friction.

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { HER_NAME, type UserProfile } from "../engine/persona";
import meeraWalk from "../assets/moments/meera-walk.jpg";
import meeraBeach from "../assets/moments/meera-beach.jpg";
import meeraReading from "../assets/moments/meera-reading.jpg";

interface Props {
  onDone: (user: UserProfile) => void;
}

const VIBES = [
  "someone to talk to",
  "late-night company",
  "hype-friend energy",
  "deep conversations",
  "someone who listens",
  "just curious",
];

// Spatial travel is the part of this that some people cannot tolerate — the
// crossfade carries the same meaning and stays. framer-motion does not read
// the media query for us, so it is read here.
const reduced =
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const stepAnim = reduced
  ? {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.2 },
    }
  : {
      initial: { opacity: 0, y: 26 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: -18 },
      transition: { duration: 0.45, ease: [0.2, 0.9, 0.3, 1] as any },
    };

export default function Onboarding({ onDone }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [vibe, setVibe] = useState<string[]>([]);

  const toggleVibe = (v: string) =>
    setVibe((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));

  return (
    <div className="onb">
      <div className="onb-step">
        <AnimatePresence mode="wait">
          {step === 0 && (
            <motion.div key="s0" {...stepAnim}>
              <div className="photo-fan">
                <img src={meeraReading} alt="" className="fan fan-l" draggable={false} />
                <img src={meeraWalk} alt={HER_NAME} className="fan fan-c" draggable={false} />
                <img src={meeraBeach} alt="" className="fan fan-r" draggable={false} />
              </div>
              <h1 style={{ textAlign: "center" }}>
                Some days deserve <em>someone to tell</em>.
              </h1>
              <p className="sub" style={{ textAlign: "center", margin: "0 auto 34px" }}>
                {HER_NAME} is a friend who's always up for talking — the small
                stuff, the big stuff, whenever you need it.
              </p>
              <button className="btn-primary" onClick={() => setStep(1)}>
                Meet {HER_NAME}
              </button>
              {/* legal text is text: --ink-faint put it at 2.7:1, which is
                  a disclosure nobody can read */}
              <p
                style={{
                  textAlign: "center",
                  marginTop: 16,
                  fontSize: 12.5,
                  color: "var(--ink-dim)",
                  lineHeight: 1.5,
                }}
              >
                {HER_NAME} is an AI companion — beautifully human in how she
                talks, always honest about what she is. For adults 18+ only.
                By continuing you confirm you're 18 or older.
              </p>
            </motion.div>
          )}

          {step === 1 && (
            <motion.div key="s1" {...stepAnim}>
              <h1>
                Hi, main {HER_NAME} <span style={{ fontSize: 30 }}>🌸</span>
                <br />
                Tumhe kya <em>bulaun</em>?
              </h1>
              <p className="sub">Bas naam batao — jo dost bulate hain wahi chalega.</p>
              <input
                className="field"
                placeholder="Your name"
                value={name}
                autoFocus
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && name.trim() && setStep(2)}
              />
              <div style={{ height: 22 }} />
              <button className="btn-primary" disabled={!name.trim()} onClick={() => setStep(2)}>
                Nice to meet you
              </button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="s2" {...stepAnim}>
              <h1>
                {name.trim()}, what are you <em>looking for</em>?
              </h1>
              <p className="sub">Pick anything that feels true. I'll take it from there.</p>
              <div className="chip-row" style={{ marginBottom: 30 }}>
                {VIBES.map((v) => (
                  <button
                    key={v}
                    className={`chip ${vibe.includes(v) ? "on" : ""}`}
                    onClick={() => toggleVibe(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <button
                className="btn-primary"
                onClick={() =>
                  onDone({ name: name.trim(), vibe: vibe.length ? vibe : ["company"], facts: {} })
                }
              >
                Start talking
              </button>
            </motion.div>
          )}
        </AnimatePresence>
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
