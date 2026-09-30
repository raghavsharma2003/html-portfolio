import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {runPool,createBrowserBudget,PRE_POOL_SUITES,PORT_LANE_SUITES} from '../runner-lib.mjs';
import {classifySuiteResources} from '../suite-resources.mjs';
// WS-R181. This suite's own 12s deadline is a wall-clock measurement of the
// pool scheduler under test, spawning real child `node` processes -- exactly
// the "fixed 12 to 30s barrier" shape this workstream's brief names, and the
// one context/rejected.md already recorded flaking under wave-22 contention
// (`ws-r169-performance-budgets-and-browser-resource-flaked-under-wave-22-contention`).
// Scale it the same way every other barrier in this shape now is.
import {boundedWaitMs} from '../lib/bounded-wait.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'vyakti-browser-budget-'));let count=0;
const ok=(name,value)=>{assert(value,name);console.log(`ok ${++count}: ${name}`);};
try{
  const frozen=readFileSync(new URL('./old-runner-lib.mjs.txt',import.meta.url));
  const oldPath=join(dir,'old-runner.mjs');writeFileSync(oldPath,frozen);
  const old=await import(pathToFileURL(oldPath).href);
  async function witnessed(pool,bounded){
    const pending=[],active=new Set(),starts=[],completion=[];let max=0,pure=false,pureOverlap=false,violation=false,released=false,expired=false;
    const release=()=>{released=true;while(pending.length)pending.shift().end('release');};
    const server=createServer((req,res)=>{
      const name=req.url.slice(1);starts.push(name);
      if(name==='pure'){pure=true;res.end('release');}else{active.add(name);max=Math.max(max,active.size);pending.push(res);}
      if(active.size>2){violation=true;release();}
      if(pure&&active.size===2&&!released){pureOverlap=true;release();}
      if(released)release();
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    const names=[...Array.from({length:7},(_,i)=>'browser'+i),'pure','port-browser'];
    const entries=names.map(name=>{
      const file=join(dir,(bounded?'bounded-':'old-')+name+'.mjs');
      writeFileSync(file,`import{get}from'node:http';const request=get(${JSON.stringify(origin+'/'+name)},r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>process.exit(body==='release'?${name==='browser0'?1:0}:2));});request.on('error',()=>process.exit(2));`);
      return{name,file,browser:name!=='pure'};
    });
    const deadline=setTimeout(()=>{expired=true;release();server.closeAllConnections();},boundedWaitMs(12000));
    const budget=createBrowserBudget(2);
    const onDone=result=>{active.delete(result.name);completion.push(result.name);};
    try{
      const [main,port]=await Promise.all([pool(entries.slice(0,-1),7,{onDone,...(bounded?{browserBudget:budget}:{})}),pool(entries.slice(-1),1,{onDone,...(bounded?{browserBudget:budget}:{})})]);
      return{max,pureOverlap,violation,expired,starts,completion,results:[...main,...port],names};
    }finally{clearTimeout(deadline);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
  const negative=await witnessed(old.runPool,false);
  ok('retained old scheduler actually starts more than two browser children',negative.violation&&negative.max>2&&!negative.expired);
  const current=await witnessed(runPool,true);
  ok('current shared browser cap is two across main and port pools',current.max===2&&!current.violation&&!current.expired);
  ok('CPU child progresses past seven queued browser entries while two browsers are held',current.pureOverlap);
  ok('failure releases its browser slot and every queued browser eventually completes',current.completion.length===9&&current.results.filter(r=>!r.ok).length===1&&current.results.find(r=>r.name==='browser0').ok===false);
  ok('results preserve input order across completion reordering',JSON.stringify(current.results.map(r=>r.name))===JSON.stringify(current.names));
  // WS-R158: byte-equality against the frozen snapshot broke the moment a
  // new shared-`dist/`-writing rehearsal (`rehearsal-personal`) was legitimately
  // ADDED to `PRE_POOL_SUITES` — the exact `frozen-file-merge-controls-break-
  // on-the-next-change` shape this repo's own context/rejected.md already
  // names, restated for a frozen ARRAY instead of a frozen FILE. The actual
  // property this control exists to catch is regression (an existing entry
  // silently dropped, renamed or reordered into a different list), not
  // stasis (the lists may only ever grow) — checked here as "every frozen
  // entry is still present, in both lists" rather than exact equality.
  ok('fixed-port and pre-pool writer classifications remain unchanged',old.PRE_POOL_SUITES.every(name=>PRE_POOL_SUITES.includes(name))&&old.PORT_LANE_SUITES.every(name=>PORT_LANE_SUITES.includes(name)));
  mkdirSync(join(dir,'evals'));mkdirSync(join(dir,'scripts'));mkdirSync(join(dir,'api'));
  writeFileSync(join(dir,'api/_config.js'),'throw Error("CONFIG_MUST_NOT_BE_READ_OR_EXECUTED");');
  const source={
    'direct.mjs':"import { chromium } from 'playwright'; throw Error('MUST_NOT_EXECUTE');",
    'dynamic.mjs':"const { chromium } = await import('playwright');",
    'computed.mjs':"const {launchRehearsalBrowser}=await import(computedUrl); await launchRehearsalBrowser();",
    'nested.mjs':"import '../scripts/helper.mjs'; import '../api/_config.js';",
    'comment.mjs':"// import {chromium} from 'playwright';\nconst prose=\"import('playwright')\";",
    'cycle.mjs':"import './cycle-peer.mjs';",
    'cycle-peer.mjs':"import './cycle.mjs'; import './direct.mjs';",
  };
  for(const [file,body]of Object.entries(source))writeFileSync(join(dir,'evals',file),body);
  writeFileSync(join(dir,'scripts/helper.mjs'),"export {chromium} from 'playwright-core';");
  const classified=classifySuiteResources(Object.keys(source).map(name=>({name,file:join(dir,'evals',name)})),{root:dir});
  ok('new direct and dynamic browser registrations are discovered without a name allowlist',classified.find(e=>e.name==='direct.mjs').browser&&classified.find(e=>e.name==='dynamic.mjs').browser);
  ok('actual browser launch through a computed helper import cannot bypass classification',classified.find(e=>e.name==='computed.mjs').browser);
  ok('transitive test/script helpers and cycles retain browser classification',classified.filter(e=>['nested.mjs','cycle.mjs','cycle-peer.mjs'].includes(e.name)).every(e=>e.browser));
  ok('comments and prose do not classify a CPU test as browser work',!classified.find(e=>e.name==='comment.mjs').browser);
  const ast=ts.createSourceFile('run.mjs',readFileSync(join(root,'evals/run.mjs'),'utf8'),ts.ScriptTarget.Latest,true);
  const declaration=ast.statements.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations).find(d=>d.name.getText(ast)==='suites');
  const registry=declaration.initializer.properties.map(p=>({name:ts.isStringLiteralLike(p.name)?p.name.text:p.name.getText(ast),file:join(root,'evals',p.initializer.text)}));
  const actual=classifySuiteResources(registry,{root}),browsers=actual.filter(e=>e.browser);
  ok('actual registered mounted focus/editor and transitive rehearsal/Room suites are classified', ['explicit-action-focus','teacher-sheet-edit-races','rehearsal-follower','rehearsal-creator','room-push'].every(name=>browsers.some(e=>e.name===name)));
  ok('actual pure provider and policy tests remain CPU work',actual.filter(e=>['azure-only-fetch','private-rehearsal-handler'].includes(e.name)).every(e=>!e.browser));
  const evidence={at:new Date().toISOString(),passed:count,negative:{max:negative.max,thirdBrowserWitness:negative.violation},current:{max:current.max,pureOverlap:current.pureOverlap,starts:current.starts,completion:current.completion},oldRunnerHash:createHash('sha256').update(frozen).digest('hex'),registered:actual.length,browsers:browsers.map(e=>({name:e.name,sources:e.browserSources}))};
  const output=join(root,'scratchpad/browser-resource',String(Date.now()));mkdirSync(output,{recursive:true});writeFileSync(join(output,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:count,registered:actual.length,browsers:browsers.length,artifact:output}));
}finally{assert.equal(dirname(realpathSync(dir)),realpathSync(tmpdir()));assert(dir.includes('vyakti-browser-budget-'));rmSync(dir,{recursive:true,force:true});}
