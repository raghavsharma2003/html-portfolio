// Current owner product terminology applies to private expert preparation.
// Room recipients and the controls that publish/distribute Rooms retain the
// established Room vocabulary. Other copy rules keep their original scope.
//
// WS-R159 note: both patterns below name `studio` alongside `creatorStudio`
// because they predate Codex's handoff206 rename (the wave-era's creator
// studio lived at `src/studio/` until that merge moved it to
// `src/creatorStudio/` and gave `src/studio/` a new, unrelated meaning: the
// PERSONAL studio, `context/decisions.md#codex-handoff206-adopted-as-the-base`).
// `ROOM_VOCAB_PATH`'s nine named component filenames (RoomStudio.tsx,
// ReadinessPanel.tsx, ...) do not exist under the new `src/studio/`, so that
// alternation is dead there today and is left as-is rather than touched
// speculatively. `MIXED_COPY` is NOT dead: it matches by bare filename
// (`copy.ts` / `hiCopy.ts`), and the personal studio's own new registry
// (WS-R159, `src/studio/copy.ts` / `hiCopy.ts`) has no Room sections at all
// (it is not a Room-facing surface) and does not export top-level `EN`/`HI`
// bindings. Left unfixed, `roomCopySectionSource` would either throw
// `copy_room_section_missing` (all sixteen Room sections absent) or
// `copy_room_table_shape_invalid` (no `EN`/`HI` declaration) the instant that
// file existed, so `studio` is dropped from `MIXED_COPY` here rather than
// carried forward as a second stale copy of the same assumption
// (`context/rejected.md#ws-r159-mixed-copy-regex-matched-the-wrong-studio`).
export const ROOM_VOCAB_PATH = /^(?:src\/room\/|src\/(?:studio|creatorStudio)\/(?:RoomStudio|ReadinessPanel|CheckinsCard|HandoffCard|SuiteCard|PayoutsCard|InviteCreatorCard|ShowcaseCard|ShareKitCard)\.tsx$|site\/(?:vyakti|creators|suites)\.html$|room\.html$)/;
export const ROOM_COPY_SECTIONS = Object.freeze([
  'readiness', 'recallRun', 'payouts', 'checkins', 'handoff', 'inviteCreator',
  'suite', 'roomStudio', 'showcase', 'suiteSeatLock', 'showcasePicker', 'poster',
  'shareKit', 'suiteWeeklyNote', 'roomStudioMandate', 'shareKitWhatsappJoin',
]);
const MIXED_COPY = /^src\/creatorStudio\/(copy|hiCopy)\.ts$/;

// Parse source only; never import/execute the locale table or its lazy loaders.
// TypeScript is loaded only by the CLI's mixed-table pass. Existing server
// consumers of scanSource do not acquire a runtime TypeScript dependency.
export async function roomCopySectionSource(rel, source) {
  const match = MIXED_COPY.exec(rel);
  if (!match) return null;
  const ts = (await import('typescript')).default;
  const ast = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length) throw new Error(`copy_room_table_syntax_invalid: ${rel}`);
  const name = match[1] === 'copy' ? 'EN' : 'HI';
  const declarations = ast.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name);
  if (declarations.length !== 1 || !declarations[0].initializer || !ts.isObjectLiteralExpression(declarations[0].initializer)) {
    throw new Error(`copy_room_table_shape_invalid: ${rel}`);
  }
  const ranges = [];
  const seen = new Set();
  for (const property of declarations[0].initializer.properties) {
    // A computed key/spread could overwrite a Room section after this pass.
    if (!ts.isPropertyAssignment(property) || !property.name ||
        !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      throw new Error(`copy_room_table_property_invalid: ${rel}`);
    }
    const key = property.name.text;
    if (seen.has(key)) throw new Error(`copy_room_table_duplicate_key: ${rel}.${key}`);
    seen.add(key);
    if (!ROOM_COPY_SECTIONS.includes(key)) continue;
    if (!ts.isObjectLiteralExpression(property.initializer)) throw new Error(`copy_room_section_shape_invalid: ${rel}.${key}`);
    ranges.push([property.getFullStart(), property.end]);
  }
  // A renamed/missing section must not silently stop receiving its rule.
  for (const key of ROOM_COPY_SECTIONS) if (!seen.has(key)) throw new Error(`copy_room_section_missing: ${rel}.${key}`);
  // Blank other source while preserving offsets/newlines and inline copy-ok
  // comments inside retained sections for the established scanner contract.
  const parts = []; let cursor = 0;
  for (const [start,end] of ranges) { parts.push(source.slice(cursor,start).replace(/[^\r\n]/g,' '),source.slice(start,end)); cursor=end; }
  parts.push(source.slice(cursor).replace(/[^\r\n]/g,' '));
  return parts.join('');
}
