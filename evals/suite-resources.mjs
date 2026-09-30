// Read test/helper source only. Never import a suite or walk application config.
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve,relative,extname} from 'node:path';
import ts from 'typescript';

const driver = /^(?:@playwright\/test|playwright(?:-core)?|puppeteer(?:-core)?)(?:\/|$)/;
const extensions = ['', '.mjs', '.js', '.cjs', '.ts', '.tsx'];
export function classifySuiteResources(entries, {root}) {
  const roots = [resolve(root,'evals'),resolve(root,'scripts')];
  const inScope = file => roots.some(base => {const path=relative(base,file);return path===''||(!path.startsWith('..')&&!path.includes(':'));});
  const parsed = new Map();
  function dependencies(file) {
    if(parsed.has(file))return parsed.get(file);
    const ast=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const imports=[];let launchesBrowser=false;
    const visit=node=>{
      if ((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require')&&node.arguments.length&&ts.isStringLiteralLike(node.arguments[0])) imports.push(node.arguments[0].text);
      // The existing creator rehearsal computes its browser-helper URL.
      // Its actual launch caller must still consume a browser slot.
      if(ts.isCallExpression(node)){
        const expression=node.expression;
        if(ts.isIdentifier(expression)&&/^launch.*Browser$/.test(expression.text))launchesBrowser=true;
        if(ts.isPropertyAccessExpression(expression)&&expression.name.text==='launch'){
          const receiver=expression.expression;
          const name=ts.isIdentifier(receiver)?receiver.text:ts.isPropertyAccessExpression(receiver)?receiver.name.text:'';
          if(['chromium','firefox','webkit','puppeteer'].includes(name))launchesBrowser=true;
        }
      }
      ts.forEachChild(node,visit);
    };
    visit(ast);
    const value={browser:launchesBrowser||imports.some(spec=>driver.test(spec)),files:[]};parsed.set(file,value);
    for(const spec of imports.filter(spec=>spec.startsWith('.'))){
      const target=resolve(dirname(file),spec);
      if(!inScope(target))continue;
      const match=extensions.map(ext=>target+ext).find(path=>existsSync(path)&&/\.(?:mjs|cjs|js|ts|tsx)$/.test(extname(path)));
      if(match)value.files.push(match);
    }
    return value;
  }
  return entries.map(entry=>{
    const pending=[resolve(entry.file)],seen=new Set(),drivers=[];
    while(pending.length){const file=pending.pop();if(seen.has(file))continue;seen.add(file);const info=dependencies(file);if(info.browser)drivers.push(file);pending.push(...info.files);}
    return {...entry,browser:drivers.length>0,browserSources:drivers};
  });
}
