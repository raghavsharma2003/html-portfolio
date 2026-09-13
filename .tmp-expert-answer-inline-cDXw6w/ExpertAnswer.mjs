// src/studio/ExpertAnswer.tsx
import { useEffect, useRef, useState } from "react";

// src/studio/answerMath.ts
function splitAnswerMath(text) {
  if (text.length > 64e3) return [{ start: 0, raw: text }];
  const parts = [];
  const pattern = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g;
  let end = 0;
  let equations = 0;
  for (const match of text.matchAll(pattern)) {
    if (equations === 64) break;
    const start = match.index;
    if (start > end) parts.push({ start: end, raw: text.slice(end, start) });
    const expression = match[1] ?? match[2];
    equations++;
    parts.push(expression.length <= 4096 && expression.trim() ? { start, raw: match[0], expression, display: match[1] !== void 0 } : { start, raw: match[0] });
    end = start + match[0].length;
  }
  if (end < text.length) parts.push({ start: end, raw: text.slice(end) });
  return parts;
}
function closingMarker(text, marker, from) {
  for (let index = from; index <= text.length - marker.length; index++) {
    if (text[index] === "\\") {
      index++;
      continue;
    }
    if (text.startsWith(marker, index)) return index;
  }
  return -1;
}
function splitAnswerInline(text) {
  const parts = [];
  let plainStart = 0;
  let index = 0;
  const pushPlain = (end) => {
    if (end > plainStart) parts.push({ kind: "text", text: text.slice(plainStart, end) });
  };
  while (index < text.length) {
    if (text[index] === "\\" && (text[index + 1] === "*" || text[index + 1] === "`" || text[index + 1] === "\\")) {
      index += 2;
      continue;
    }
    const marker = text.startsWith("**", index) ? "**" : text[index] === "`" ? "`" : "";
    if (!marker) {
      index++;
      continue;
    }
    const close = closingMarker(text, marker, index + marker.length);
    if (close <= index + marker.length) {
      index += marker.length;
      continue;
    }
    pushPlain(index);
    parts.push({ kind: marker === "**" ? "strong" : "code", text: text.slice(index + marker.length, close) });
    index = close + marker.length;
    plainStart = index;
  }
  pushPlain(text.length);
  return parts.length ? parts : [{ kind: "text", text }];
}

// src/studio/ExpertAnswer.tsx
import { Fragment, jsx } from "react/jsx-runtime";
var renderer;
var loadRenderer = () => renderer ??= import("katex").catch((error) => {
  renderer = void 0;
  throw error;
});
var REFUSED_MATH_COLOR = "#b30001";
function Equation({ part }) {
  const [markup, setMarkup] = useState(null);
  const [scrollable, setScrollable] = useState(false);
  const element = useRef(null);
  useEffect(() => {
    let active = true;
    void loadRenderer().then((katex) => {
      if (!active) return;
      try {
        let refusedCommand = false;
        const html = katex.renderToString(part.expression, {
          output: "mathml",
          displayMode: part.display,
          throwOnError: true,
          trust: () => {
            refusedCommand = true;
            return false;
          },
          errorColor: REFUSED_MATH_COLOR,
          strict: "error",
          maxExpand: 200,
          maxSize: 10,
          macros: {}
        });
        if (active && !refusedCommand && !html.includes(REFUSED_MATH_COLOR)) setMarkup(html);
      } catch {
      }
    }).catch(() => {
    });
    return () => {
      active = false;
    };
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
    tabIndex: scrollable ? 0 : void 0,
    role: scrollable ? "region" : void 0,
    "aria-label": scrollable ? "Scrollable equation" : void 0
  };
  return markup === null ? /* @__PURE__ */ jsx("span", { ...props, children: part.raw }) : /* @__PURE__ */ jsx("span", { ...props, dangerouslySetInnerHTML: { __html: markup } });
}
function InlineContent({ text }) {
  return /* @__PURE__ */ jsx(Fragment, { children: splitAnswerInline(text).map((part, index) => {
    const key = `${index}:${part.kind}:${part.text}`;
    if (part.kind === "strong") return /* @__PURE__ */ jsx("strong", { children: part.text }, key);
    if (part.kind === "code") return /* @__PURE__ */ jsx("code", { className: "expert-answer__code", children: part.text }, key);
    return /* @__PURE__ */ jsx("span", { children: part.text }, key);
  }) });
}
function ExpertAnswer({ text }) {
  return /* @__PURE__ */ jsx("div", { className: "expert-answer", children: splitAnswerMath(text).map((part) => part.expression !== void 0 ? /* @__PURE__ */ jsx(Equation, { part }, `${part.start}:${part.raw}`) : /* @__PURE__ */ jsx(InlineContent, { text: part.raw }, part.start)) });
}
export {
  ExpertAnswer as default
};
