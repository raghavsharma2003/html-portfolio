// Explicitly comparative, not release acceptance. Source preparation only until lane grant.
import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Three cold Hindi contexts per revision, fixed AB/BA/AB order.
// Odd pair count gives baseline two first positions; disclose, never reorder.
export const ORDER = Object.freeze([
 ['baseline','studio-hi'],['candidate','studio-hi'],['candidate','studio-hi'],['baseline','studio-hi'],['baseline','studio-hi'],['candidate','studio-hi'],
]);
const [baseArg,candidateArg,outArg]=process.argv.slice(2);
assert.ok(baseArg&&candidateArg&&outArg,'Explicit private baseline, candidate and receipt paths required');
const roots={baseline:resolve(baseArg),candidate:resolve(candidateArg)},out=resolve(outArg);
assert.notEqual(roots.baseline,roots.candidate);
assert.match(basename(roots.baseline),/^expert-auth-loading47$/,'Use a private baseline isolate, never frozen45');
assert.match(basename(roots.candidate),/^expert-hindi-observer53$/);
await mkdir(out,{recursive:false});
const rows=[],modules={},created=[];let browser,server,timer;
process.on('message', message => { if(message?.type==='loading47-deadline') void browser?.close(); });
const hash=text=>createHash('sha256').update(text).digest('hex');
const sourceFingerprints={};
async function fingerprint(root) {
  const files=[];
  async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await walk(path);else if(entry.isFile())files.push({path:path.slice(root.length+1).replaceAll('\\','/'),sha256:hash(await readFile(path))});}}
  await walk(join(root,'dist'));files.sort((a,b)=>a.path.localeCompare(b.path));
  const assets=[...files];files.length=0;await walk(join(root,'src'));files.push({path:'studio.html',sha256:hash(await readFile(join(root,'studio.html')))});files.sort((a,b)=>a.path.localeCompare(b.path));
  const measurement = {}; for(const file of ['performance-hindi-interface.mjs','loading-font-collector.mjs']) measurement[file]=hash(await readFile(join(root,'scripts',file)));
  return {measurement,assets,source:[...files],package:hash(await readFile(join(root,'package.json'))),lock:hash(await readFile(join(root,'package-lock.json'))),config:hash(await readFile(join(root,'api/_config.js')))};
}
const before={};
try {
  const collectorPath=pathToFileURL(join(roots.candidate,'scripts/loading-font-collector.mjs')).href;
  for(const revision of ['baseline','candidate']) {
    before[revision]=await fingerprint(roots[revision]);
    const path=join(roots[revision],'scripts/check-performance.mjs');
    let source=await readFile(path,'utf8');sourceFingerprints[revision]=hash(source);
    const replace=(from,to)=>{assert.equal(source.split(from).length,2,`Exact one diagnostic seam: ${from}`);source=source.replace(from,to);};
    source=`import { startLoadingFontCollector } from ${JSON.stringify(collectorPath)};\n`+source;
    replace('  const perf = await readSettledPerformance(page);','  const perf = await readSettledPerformance(page);');
    replace('  const t0 = Date.now();','  const fontCollector = startLoadingFontCollector(cdp, `http://127.0.0.1:${PORT}`);\n  const t0 = Date.now();');
    replace('  const networkReceipt = networkAccounting.snapshot();','  const networkReceipt = networkAccounting.snapshot();\n  const fontReceipt = fontCollector.snapshot(networkReceipt.nodeReceivedAt);\n  fontCollector.stop();');
    replace('    bytes: networkReceipt.bytes,','    fontReceipt,\n    bytes: networkReceipt.bytes,');
    // Derive the exact existing aggregation body; no custom median/budget logic.
    const start=source.indexOf('async function measureTarget('),end=source.indexOf('\nfunction ',start);
    assert.ok(start>=0&&end>start);
    let aggregate=source.slice(start,end);
    const header=/async function measureTarget\([^\n]+\) \{\r?\n  const runs = \[\];\r?\n  for \(let i = 0; i < RUNS; i\+\+\) runs.push\(await measureOnce\(browser, target, diagnostics, profile\)\);/;
    assert.ok(header.test(aggregate));aggregate=aggregate.replace(header,'function summarizeRuns(target, runs) {');
    source+=`\n${aggregate}\nexport { measureOnce, summarizeRuns, serveApp, TARGETS, BUDGETS, THROTTLE, VIEWPORT };\n`;
    const generated=join(roots[revision],'scripts',`_observer53-measure-${process.pid}.mjs`);
    await writeFile(generated,source,{flag:'wx'});created.push(generated);
    modules[revision]=await import(pathToFileURL(generated).href);
  }
  assert.deepEqual(modules.baseline.BUDGETS,modules.candidate.BUDGETS);
  assert.deepEqual(modules.baseline.THROTTLE,modules.candidate.THROTTLE);
  assert.deepEqual(modules.baseline.VIEWPORT,modules.candidate.VIEWPORT);
  assert.equal(before.baseline.package,before.candidate.package);assert.equal(before.baseline.lock,before.candidate.lock);assert.equal(before.baseline.config,before.candidate.config);
  const beforeFiles=new Map(before.baseline.source.map(f=>[f.path,f.sha256]));
  const changed=before.candidate.source.filter(f=>beforeFiles.get(f.path)!==f.sha256).map(f=>f.path).sort();
  assert.deepEqual(changed,[],'Production source must be identical');
  assert.deepEqual(before.baseline.assets,before.candidate.assets,'Built assets must be identical');
  assert.deepEqual(before.baseline.source.map(f=>f.path),before.candidate.source.map(f=>f.path),'No unexplained added/removed source');
  const executablePath=process.env.CHROMIUM_PATH||chromium.executablePath();
  browser=await chromium.launch({executablePath,timeout:30000,args:['--no-sandbox','--disable-background-networking']});
  await writeFile(join(out,'plan.json'),JSON.stringify({acceptance:false,order:ORDER,sourceFingerprints,before,browserVersion:browser.version(),browserExecutablePath:executablePath,browserExecutableHash:hash(await readFile(executablePath)),budgets:modules.baseline.BUDGETS,throttle:modules.baseline.THROTTLE,viewport:modules.baseline.VIEWPORT},null,2));
  timer=setTimeout(()=>{void browser.close();},15*60*1000);
  for(const [revision,name]of ORDER){
    const m=modules[revision],target=m.TARGETS.find(t=>t.name===name);assert.ok(target);
    server=await m.serveApp();
    try {const startedAt=new Date().toISOString();const result=await m.measureOnce(browser,target,false,false);rows.push({revision,target:name,startedAt,finishedAt:new Date().toISOString(),result});await writeFile(join(out,'progress.json'),JSON.stringify(rows,null,2));}
    finally{server.closeAllConnections();await new Promise(r=>server.close(r));server=null;}
  }
  const groups=[];
  for(const revision of ['baseline','candidate'])for(const name of ['studio-hi']){const m=modules[revision],runs=rows.filter(r=>r.revision===revision&&r.target===name).map(r=>r.result);assert.equal(runs.length,3);const result=m.summarizeRuns(m.TARGETS.find(t=>t.name===name),runs);groups.push({revision,result,findings:m.evaluateBudgets(result)});}
  for(const revision of ['baseline','candidate']){assert.equal(hash(await readFile(join(roots[revision],'scripts/check-performance.mjs'),'utf8')),sourceFingerprints[revision]);assert.deepEqual(await fingerprint(roots[revision]),before[revision]);}
  const complete=rows.every(r=>r.result.fontReceipt.complete);
  await writeFile(join(out,'result.json'),JSON.stringify({acceptance:false,complete,rows,groups},null,2));
  process.exitCode=complete&&groups.every(g=>g.findings.length===0)?0:1;
}catch(error){await writeFile(join(out,'failure.json'),JSON.stringify({acceptance:false,error:String(error),rows},null,2));process.exitCode=1;}
finally{clearTimeout(timer);await browser?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}for(const path of created)await unlink(path);if(process.connected)process.disconnect();}

