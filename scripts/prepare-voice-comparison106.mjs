import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compileStockComparison,payloadTemplate,scoringManifest} from '../evals/voice-stock-comparison/plan.mjs';

const args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--reference'||args[2]!=='--out')throw Error('usage: --reference stock.wav --out directory');
const corpus=JSON.parse(readFileSync(new URL('../evals/voice-stock-comparison/prompts.v1.json',import.meta.url),'utf8'));
const plan=compileStockComparison(corpus,readFileSync(resolve(args[1])));
const out=resolve(args[3]);mkdirSync(out,{recursive:true});
const put=(name,data)=>writeFileSync(join(out,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
put('plan.json',plan);put('scoring.json',scoringManifest(plan));
put('payload-templates.json',{contract:plan.contract,planSha256:plan.planSha256,executable:false,
  cells:plan.cells.map(cell=>({cellId:cell.cellId,payload:payloadTemplate(plan,cell.cellId)}))});
put('preparation-receipt.json',{contract:'voice-comparison106-preparation/v1',sourceScript:fileURLToPath(import.meta.url),
  referencePath:resolve(args[1]),referenceSha256:plan.reference.sha256,planSha256:plan.planSha256,cells:12,
  cropCreated:false,transcriptVerified:false,networkCalls:0,sqlCalls:0,modelCalls:0,executionAllowed:false});
console.log(JSON.stringify({out,planSha256:plan.planSha256,cells:12,executionAllowed:false}));
