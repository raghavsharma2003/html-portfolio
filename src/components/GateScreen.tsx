// THE PASSWORD PAGE. One question, one field, one button.
//
// It appears in two places and is the same page in both:
//   - as the last step of onboarding, after the memory question, for someone
//     who has just registered (Onboarding.tsx); and
//   - by itself, in front of the whole app, for someone who was already here
//     before the gate existed or whose device has not entered the word yet
//     (App.tsx).
// Once a device gets it right the token is kept (src/engine/gate.ts) and this
// page does not come back, unless the password is rotated.
//
// The copy is honest about what this is. It does not pretend to be a security
// ceremony: the app is not open to everyone yet, and this is the door.
import { useRef, useState } from "react";
import { submitGatePassword, type GateResult } from "../engine/gate";
import WorldLayer, { useSky, skyVars } from "./WorldLayer";
import "../styles/onboard.css";

export const GATE_COPY = {
  title: "Ek second.",
  lede: "Maya abhi sirf invited logon ke liye khuli hai. Jo word tumhe bataya gaya tha, wo yahan likho.",
  placeholder: "Access word",
  cta: "Andar aao",
  busy: "Checking...",
  wrong: "Ye nahi hai. Ek baar aur try karo.",
  slow: "Bahut tries ho gaye. Ek minute ruko.",
  offline: "Maya tak pahunch nahi paa rahe. Internet check karo.",
} as const;

const MESSAGE: Record<Exclude<GateResult, "ok">, string> = {
  wrong: GATE_COPY.wrong,
  slow: GATE_COPY.slow,
  offline: GATE_COPY.offline,
};

interface BodyProps {
  onOpen: () => void;
}

/** The question itself, without the page around it. */
export function GateBody({ onOpen }: BodyProps) {
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>("");
  // a second tap while the first is in flight would spend a rate-limit slot on
  // a duplicate guess
  const inflight = useRef(false);

  const submit = async () => {
    if (!word.trim() || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setProblem("");
    const r = await submitGatePassword(word);
    inflight.current = false;
    setBusy(false);
    if (r === "ok") return onOpen();
    setProblem(MESSAGE[r]);
  };

  return (
    <div className="onb-ask">
      <h1 className="onb-q">{GATE_COPY.title}</h1>
      <p className="onb-sub">{GATE_COPY.lede}</p>
      <input
        className="onb-field"
        type="password"
        placeholder={GATE_COPY.placeholder}
        value={word}
        autoFocus
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        maxLength={64}
        aria-label={GATE_COPY.placeholder}
        aria-invalid={problem ? true : undefined}
        onChange={(e) => {
          setWord(e.target.value);
          if (problem) setProblem("");
        }}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
      <p className="onb-honest" role="alert" aria-live="polite" style={{ minHeight: "1.5em" }}>
        {problem}
      </p>
      <button
        className="onb-cta"
        data-tel="gate.enter"
        disabled={!word.trim() || busy}
        onClick={() => void submit()}
      >
        {busy ? GATE_COPY.busy : GATE_COPY.cta}
      </button>
    </div>
  );
}

/** The page by itself, for everyone who is not mid-onboarding. */
export default function GateScreen({ onOpen }: BodyProps) {
  const sky = useSky();
  return (
    <div className="onb" style={skyVars(sky)} data-sky={sky.state}>
      <WorldLayer frame={sky} />
      <div className="onb-step">
        <GateBody onOpen={onOpen} />
      </div>
    </div>
  );
}
