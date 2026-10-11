import ts from 'typescript';

// Inspect syntax, not angle brackets: TypeScript type arguments are not JSX.
// This guard intentionally covers literal JSX text, not arbitrary expression values.
export function literalEnglishTextNodes(src) {
  const file = ts.createSourceFile('locale-scan.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (file.parseDiagnostics.length) throw new Error('locale_scan_invalid_tsx');
  const hits = [];
  function visit(node) {
    // Commands in semantic <code> are intentionally literal executable text.
    // Sibling instructions still require localization; <pre> alone is not exempt.
    if (ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName)
      && node.openingElement.tagName.text === 'code') return;
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, ' ').trim();
      const words = text.split(' ').filter(word => /[A-Za-z]/.test(word));
      if (words.length >= 3) hits.push(text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return hits;
}
