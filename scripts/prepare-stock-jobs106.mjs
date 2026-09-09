import {readFileSync,mkdirSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileStockComparison,payloadTemplate,sha} from '../evals/voice-stock-comparison/plan.mjs';
import {canonical} from '../evals/voice-listening-benchmark/lib.mjs';
import {BASE_IMAGES} from '../services/voice-stock-comparison/job-plan.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--reference'||args[2]!=='--out')throw Error('usage: --reference stock.wav --out directory');
const referencePath=resolve(args[1]),out=resolve(args[3]);
if(existsSync(out))throw Error('stock_build_context_already_exists');
const corpus=JSON.parse(readFileSync(join(root,'evals/voice-stock-comparison/prompts.v1.json'),'utf8'));
const plan=compileStockComparison(corpus,readFileSync(referencePath));
const entrypoint=readFileSync(join(root,'services/voice-stock-comparison/entrypoint.py'));
const policy={contract:'synthetic-reference-use/v1',scope:plan.scope,referenceSha256:plan.reference.sha256,planSha256:plan.planSha256,
  authority:'Effective only inside an immutable Manual Job admitted by the reviewed operator plan and existing durable GPU ledger.'};
const policySha256=sha(canonical(policy));
const provision={contract:'vyakti-stock-job-provision-input/v1',planSha256:plan.planSha256,enabled:false,jobs:[]};
for(const arm of plan.arms){
  const dir=join(out,arm.id);mkdirSync(join(dir,'runtime'),{recursive:true});
  const runtimeDir=arm.id==='chatterbox'?'open-voice-runtime':'voxcpm2-runtime';
  const runtimeDestination=arm.id==='chatterbox'?'/srv/open-voice':'/srv/voxcpm2';
  const runtimeNames=arm.id==='chatterbox'?['app.py','lora.py','hindi_pack.py','offline_assets.py']:['app.py','contract.py'];
  const runtimeFiles=runtimeNames.map(name=>{
    const bytes=readFileSync(join(root,'services',runtimeDir,name));writeFileSync(join(dir,'runtime',name),bytes);
    return {path:`${runtimeDestination}/${name}`,sha256:sha(bytes)};
  });
  const requests=plan.cells.filter(c=>c.arm===arm.id).map(c=>{
    const payload=payloadTemplate(plan,c.cellId);
    if(arm.id==='voxcpm2')Object.assign(payload,{replica_id:'00000106-0000-4000-a000-000000000001',third_party_policy_receipt_sha256:policySha256});
    else delete payload.referenceScopeReceipt;
    return {cellId:c.cellId,textSha256:c.textSha256,payload};
  });
  const manifest={contract:'vyakti-stock-job106/v1',arm:arm.id,scope:plan.scope,planSha256:plan.planSha256,
    referenceSha256:plan.reference.sha256,requestsSha256:sha(canonical(requests)),entrypointSha256:sha(entrypoint),
    modelCommitment:arm.modelCommitment,modelRevision:arm.modelRevision,baseImage:BASE_IMAGES[arm.id],runtimeFiles,
    policy,policySha256,replicaIdMeaning:'Non-owner synthetic experiment identifier only; no replica database row or identity assertion.'};
  writeFileSync(join(dir,'entrypoint.py'),entrypoint);copyFileSync(referencePath,join(dir,'stock.wav'));
  writeFileSync(join(dir,'requests.json'),JSON.stringify(requests,null,2)+'\n');
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');writeFileSync(join(dir,'manifest.json'),manifestBytes);
  writeFileSync(join(dir,'Dockerfile'),`FROM ${BASE_IMAGES[arm.id]}\nHEALTHCHECK NONE\nENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1\nCOPY runtime/ ${runtimeDestination}/\nCOPY entrypoint.py manifest.json requests.json stock.wav /opt/vyakti-stock/\nCMD ["python","/opt/vyakti-stock/entrypoint.py"]\n`);
  provision.jobs.push({arm:arm.id,contextPath:dir,baseImage:BASE_IMAGES[arm.id],manifestSha256:sha(manifestBytes),image:null,
    jobId:`/subscriptions/c60a32f6-c812-4c0e-bc42-b6431ee90b8f/resourceGroups/vyakti-voice/providers/Microsoft.App/jobs/vyakti-stock106-${arm.id}`,
    environmentId:null,workloadProfileName:'Consumption-GPU-NC8as-T4'});
}
writeFileSync(join(out,'provision-input.disabled.json'),JSON.stringify(provision,null,2)+'\n');
writeFileSync(join(out,'preparation.json'),JSON.stringify({planSha256:plan.planSha256,referenceSha256:plan.reference.sha256,
  entrypointSha256:sha(entrypoint),networkCalls:0,sqlCalls:0,builds:0,modelCalls:0,enabled:false},null,2)+'\n');
console.log(JSON.stringify({out,planSha256:plan.planSha256,contexts:2,builds:0,enabled:false}));
