import { useEffect, useRef, useState } from "react";
import { splitAnswerMath, type AnswerPart } from "./answerMath";
import "./expert-answer.css";

// Load only for an answer with explicit math. No CDN, font request or provider call.
let renderer: Promise<typeof import("katex")> | undefined;
const loadRenderer = () => renderer ??= import("katex").catch(error => {
  renderer = undefined;
  throw error;
});
// KaTeX also uses this marker for refusals before its trust callback runs.
const REFUSED_MATH_COLOR = "#b30001";

function Equation({ part }: { part: AnswerPart }) {
  const [markup, setMarkup] = useState<string | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let active = true;
    void loadRenderer().then(katex => {
      if (!active) return;
      try {
        let refusedCommand = false;
        // Only KaTeX-produced MathML enters the HTML sink. Input is never HTML.
        const html = katex.renderToString(part.expression!, {
          output: "mathml", displayMode: part.display, throwOnError: true,
          trust: () => { refusedCommand = true; return false; },
          errorColor: REFUSED_MATH_COLOR,
          strict: "error", maxExpand: 200, maxSize: 10, macros: {},
        });
        if (active && !refusedCommand && !html.includes(REFUSED_MATH_COLOR)) setMarkup(html);
      } catch { /* Unsupported math retains its exact, selectable source. */ }
    }).catch(() => { /* A failed chunk keeps the complete source visible. */ });
    return () => { active = false; };
  }, [part.expression, part.display]);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () => setScrollable(node.scrollWidth > node.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [markup]);
  const props = {
    ref: element,
    className: `expert-answer__math ${part.display ? "expert-answer__math--display" : "expert-answer__math--inline"}${markup === null ? " expert-answer__math--source" : ""}`,
    tabIndex: scrollable ? 0 : undefined,
    role: scrollable ? "region" : undefined,
    "aria-label": scrollable ? "Scrollable equation" : undefined,
  };
  return markup === null ? <span {...props}>{part.raw}</span>
    : <span {...props} dangerouslySetInnerHTML={{ __html: markup }} />;
}

export default function ExpertAnswer({ text }: { text: string }) {
  return <div className="expert-answer">{splitAnswerMath(text).map(part => part.expression !== undefined
    ? <Equation key={`${part.start}:${part.raw}`} part={part} />
    : <span key={part.start}>{part.raw}</span>)}</div>;
}
