import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// Select the locale sections actually referenced by this panel, not unrelated
// auth/legal copy recently moved into the same table. Missing sections fail.
export function panelCopy(root, component, sections) {
  const source = ts.createSourceFile('panel.tsx', component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const referenced = new Set();
  function visit(node) {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') referenced.add(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.deepEqual([...referenced].sort(), [...sections].sort(), 'panel copy section inventory changed');
  const literals = [];
  for (const [file, table] of [['copy.ts', 'EN'], ['hiCopy.ts', 'HI']]) {
    const text = readFileSync(join(root, 'src/creatorStudio', file), 'utf8');
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    let object;
    function find(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === table && node.initializer && ts.isObjectLiteralExpression(node.initializer)) object = node.initializer;
      ts.forEachChild(node, find);
    }
    find(ast); assert.ok(object, `${file} ${table} literal table required`);
    for (const section of sections) {
      const property = object.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(ast) === section);
      assert.ok(property && ts.isObjectLiteralExpression(property.initializer), `${file} ${section} literal section required`);
      function collect(node) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) literals.push(node.text);
        ts.forEachChild(node, collect);
      }
      collect(property.initializer);
    }
  }
  return literals.map(value => ': ' + JSON.stringify(value)).join('\n');
}
