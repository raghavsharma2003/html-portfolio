import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),path=new URL('../api/_replica-source.js',import.meta.url);
const sha=x=>createHash('sha256').update(x).digest('hex');
const calls=[];let egress=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{egress++;throw Error('OFFLINE_NETWORK_REFUSED');};
try{
 const current=await import(path.href);
 const {fileURLToPath}=await import('node:url');
 const oldText=execFileSync('git',['show','0a3b2d2608d64a4f9aebdafc690caf445f6b5889:api/_replica-source.js'],{cwd:fileURLToPath(root),encoding:'utf8'});
 const routed=oldText.replace(/from (["'])(\.[^"']+)\1/g,(_,quote,rel)=>`from ${quote}${new URL(rel,path).href}${quote}`);
 const old=await import('data:text/javascript;base64,'+Buffer.from(routed).toString('base64'));
 const f={rid:'10000000-0000-4000-8000-000000000001',owner:'10000000-0000-4000-8000-000000000002',sid:'10000000-0000-4000-8000-000000000003',hash:'a'.repeat(64)};
 async function run(fn,{missing=false,commit=true,size=123,mime='text/plain',digest=f.hash}={}){
  const seen=[];const out=await fn(async(sql,p)=>{seen.push({sql,p});if(seen.length===1)return missing?[]:[{byte_size:123,mime:'text/plain',sha256:f.hash}];return commit?[{source_id:f.sid,state:p[3],rejection_code:p[4]}]:[];},f.owner,f.rid,f.sid,{byteSize:size,mime,sha256:digest,objectId:'synthetic'});return {seen,out};
 }
 const baseline=await run(old.finalizeOwnedContextSource),fixed=await run(current.finalizeOwnedContextSource);
 assert.equal(sha(baseline.seen[1].sql),'f83f7c553c84b945f7732abb5ab3b483d3cc162d344d6015b3044b9253c69f15');calls.push('actual-incumbent-query-matches-real-42702-artifact');
 const projection=sql=>/and s.sha256=\$7\s+returning ([\s\S]+?)\s+\), audit as/.exec(sql)[1];
 const oldProjection=projection(baseline.seen[1].sql),newProjection=projection(fixed.seen[1].sql);
 assert(oldProjection.split(',').some(x=>x.trim()==='replica_id'));assert(newProjection.split(',').every(x=>/^s\.[a-z_][a-z0-9_]*$/.test(x.trim())));calls.push('actual-query-qualifies-all-target-columns-old-negative');
 assert.deepEqual(newProjection.split(',').map(x=>x.trim().slice(2)),oldProjection.split(',').map(x=>x.trim()));calls.push('same-returned-fields-and-order');
 assert.equal(fixed.seen[1].sql.replace(newProjection,oldProjection),baseline.seen[1].sql);assert.deepEqual(fixed.seen.map(x=>x.p),baseline.seen.map(x=>x.p));assert.equal(fixed.seen[0].sql,baseline.seen[0].sql);calls.push('all-source-owner-consent-hash-predicates-and-params-byte-preserved');
 assert.equal(fixed.out.state,'ready');calls.push('valid-server-byte-verdict-ready-control-flow');
 assert.equal((await run(current.finalizeOwnedContextSource,{missing:true})).seen.length,1);calls.push('missing-owned-pending-source-never-finalizes');
 for(const options of [{size:124},{mime:'image/png'},{digest:'b'.repeat(64)}])assert.equal((await run(current.finalizeOwnedContextSource,options)).out.state,'rejected');calls.push('byte-mime-hash-verdicts-still-refuse');
 assert.equal((await run(current.finalizeOwnedContextSource,{commit:false})).out,null);calls.push('lost-current-authority-not-ready');
 assert.equal(egress,0);console.log(JSON.stringify({groups:calls.length,checks:calls,networkCalls:egress,querySha256:sha(fixed.seen[1].sql),scope:'Actual helper with offline DB callbacks, exact old-source negative and full SQL parity except projection. PostgreSQL compile result is a separate root-run EXPLAIN.'}));
}finally{globalThis.fetch=originalFetch;}
