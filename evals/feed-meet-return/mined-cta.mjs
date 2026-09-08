import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bytes=readFileSync(root+'src/studio/ContextLockerPanel.tsx');
const source=bytes.toString('utf8');
const current='["extracted", "mined"].includes(item.status)';
// Teach eligibility may use the same status predicate; validate only the Test CTA below.
const fixture=JSON.parse(readFileSync(new URL('./old-mined-cta.json',import.meta.url),'utf8'));
assert.equal(fixture.originalSourceSha256,'b66074d371b3ce85a42b660a2a883350f460a2f819c50679f1b6f914d6694438');
assert.equal(createHash('sha256').update(fixture.expression).digest('hex'),'342678d7d2d52dd82ed7c465ba442f80c555f544a1972222d748413a900589ab','exact captured historical CTA expression');
const old='const component = <>{'+fixture.expression+'}</>;';
function renderer(source, requireCurrent = false){
 const ast=ts.createSourceFile('locker.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression;
 function visit(node){if(ts.isJsxExpression(node)&&node.expression&&ts.isConditionalExpression(node.expression)&&node.expression.getText(ast).startsWith('onTestSource &&'))expression=node.expression.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert(expression,'actual CTA expression');
 if(requireCurrent){assert.equal(expression.split(current).length,2,'Test CTA keeps its exact extracted/mined eligibility');assert.throws(()=>assert.equal(expression.replace(current,'true').split(current).length,2));}
 const code=ts.transpileModule('globalThis.render=(item,onTestSource,busy=false,loading=false)=>('+expression+');',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
 const ctx={React,replicaId:'10000000-0000-4000-8000-000000000001',mounted:{current:true},testSourceLabel:'Test this source'};runInNewContext(code,ctx);return ctx.render;
}
const before=renderer(old),after=renderer(source,true),callback=()=>{};
const item={item_id:'30000000-0000-4000-8000-000000000001',kind:'file',status:'mined',extracted_chars:200,consent_scope:'own_context',authorship:'mine',format:'text'};
let groups=0;const check=(name,fn)=>{fn();console.log(`ok ${++groups} - ${name}`);};
check('exact old candidate renders no CTA for the actual native mined state',()=>assert.equal(renderToStaticMarkup(before(item,callback)),''));
for(const status of ['extracted','mined'])check(`${status} eligible row renders the actual button`,()=>assert.match(renderToStaticMarkup(after({...item,status},callback)),/>Test this source<\/button>/));
for(const status of ['refused','routed','pending','extracting'])check(`${status} remains excluded`,()=>assert.equal(renderToStaticMarkup(after({...item,status},callback)),''));
for(const patch of [{kind:'link'},{authorship:'unknown'},{authorship:'not_mine'},{consent_scope:'own_turns_only'},{extracted_chars:0},{format:'image'}])check('noneligible '+JSON.stringify(patch),()=>assert.equal(renderToStaticMarkup(after({...item,...patch},callback)),''));
check('optional caller absent remains no CTA',()=>assert.equal(renderToStaticMarkup(after(item,undefined)),''));
check('busy and loading are native disabled controls',()=>{assert.match(renderToStaticMarkup(after(item,callback,true)),/disabled/);assert.match(renderToStaticMarkup(after(item,callback,false,true)),/disabled/);});
console.log(`PASS ${groups} actual React CTA-branch groups; exact old source negative. No mounted component, database or network claim.`);
