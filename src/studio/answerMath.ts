export type AnswerPart = { start: number; raw: string; expression?: string; display?: boolean };

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
