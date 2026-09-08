export type AnswerPart = { start: number; raw: string; expression?: string; display?: boolean };
export type InlinePart = { kind: "text" | "strong" | "code"; text: string };

/** Only explicit TeX delimiters are mathematical. Currency and ordinary prose stay literal. */
export function splitAnswerMath(text: string): AnswerPart[] {
  if (text.length > 64_000) return [{ start: 0, raw: text }];
  const parts: AnswerPart[] = [];
  const pattern = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g;
  let end = 0;
  let equations = 0;
  for (const match of text.matchAll(pattern)) {
    if (equations === 64) break;
    const start = match.index;
    if (start > end) parts.push({ start: end, raw: text.slice(end, start) });
    const expression = match[1] ?? match[2];
    equations++;
    parts.push(expression.length <= 4096 && expression.trim()
      ? { start, raw: match[0], expression, display: match[1] !== undefined }
      : { start, raw: match[0] });
    end = start + match[0].length;
  }
  if (end < text.length) parts.push({ start: end, raw: text.slice(end) });
  return parts;
}

function closingMarker(text: string, marker: string, from: number) {
  for (let index = from; index <= text.length - marker.length; index++) {
    if (text[index] === "\\") { index++; continue; }
    if (text.startsWith(marker, index)) return index;
  }
  return -1;
}

/** Render only the two answer conventions we support; all other text stays literal. */
export function splitAnswerInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let plainStart = 0;
  let index = 0;
  const pushPlain = (end: number) => {
    if (end > plainStart) parts.push({ kind: "text", text: text.slice(plainStart, end) });
  };
  while (index < text.length) {
    if (text[index] === "\\" && (text[index + 1] === "*" || text[index + 1] === "`" || text[index + 1] === "\\")) {
      index += 2;
      continue;
    }
    const marker = text.startsWith("**", index) ? "**" : text[index] === "`" ? "`" : "";
    if (!marker) { index++; continue; }
    const close = closingMarker(text, marker, index + marker.length);
    if (close <= index + marker.length) { index += marker.length; continue; }
    pushPlain(index);
    parts.push({ kind: marker === "**" ? "strong" : "code", text: text.slice(index + marker.length, close) });
    index = close + marker.length;
    plainStart = index;
  }
  pushPlain(text.length);
  return parts.length ? parts : [{ kind: "text", text }];
}
