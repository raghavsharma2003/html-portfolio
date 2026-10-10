// Offline positive-list build packet. No registry/cloud operation is present.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const [commit,output]=process.argv.slice(2);
if(!/^[a-f0-9]{40}$/.test(commit||'')||!output||!resolve(output).split(/[\\/]/).includes('scratchpad'))throw Error('exact_commit_and_scratchpad_output_required');
const git=args=>execFileSync('git',args,{maxBuffer:16*1024*1024});
const sha=x=>createHash('sha256').update(x).digest('hex');
const docker='services/private-voice/Dockerfile',content=git(['show',`${commit}:${docker}`]).toString();
const paths=[docker,...[...content.matchAll(/COPY \["([^"]+)"/g)].map(m=>m[1])].sort();
if(paths.length!==new Set(paths).size||paths.some(p=>p.includes('..')||p.includes('_config')||!p.match(/^[A-Za-z0-9_/.-]+$/)))throw Error('positive_source_list_invalid');
const manifest=paths.map(path=>{const bytes=git(['show',`${commit}:${path}`]);return {path,bytes:bytes.length,sha256:sha(bytes),git_blob:git(['rev-parse',`${commit}:${path}`]).toString().trim()};});
mkdirSync(output,{recursive:true});const tag=`private27-${commit.slice(0,12)}`,archive=resolve(output,`${tag}.tar`);
git(['archive','--format=tar',`--output=${archive}`,commit,...paths]);
const nodeImage='node:24.13.0-alpine3.23@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e';
const packet={schema:'private-voice-build-packet27/v1',source_commit:commit,source_files:manifest,archive,archive_sha256:sha(readFileSync(archive)),
 image_tag:`vyaktivoiceacr.azurecr.io/vyakti/internal-voice:${tag}`,node_image:nodeImage,cloud_calls:0,submission_enabled:false,
 body_template:{type:'DockerBuildRequest',platform:{os:'Linux',architecture:'amd64'},agentConfiguration:{cpu:2},timeout:1200,
  dockerFilePath:docker,imageNames:[`vyakti/internal-voice:${tag}`],sourceLocation:'<validated ACR uploaded source relativePath, memory only>',
  isPushEnabled:true,isArchiveEnabled:false,noCache:false,arguments:[{name:'NODE_IMAGE',value:nodeImage,isSecret:false}]},
 after_acceptance:{target_app:'vyakti-internal-voice25',preserve_cpu_scale:{minReplicas:1,maxReplicas:1},preserve_cpu_resources:{cpu:.5,memory:'1Gi'},
  preserve_gpu_scale:{minReplicas:0,maxReplicas:1},gpu_mutations:0,broker_rebuild_required:false,new_always_on_cpu_apps:0,
  command:['node','services/private-voice/server.mjs'],supervisor_command:['node','scripts/azure-voice-supervisor53.mjs'],
  supervisor_source_sha256:manifest.find(r=>r.path==='scripts/azure-voice-supervisor53.mjs').sha256,
  acceptance_rule:'Match every packaged source byte against the final accepted integration commit before build submission; deploy only an independently read-back digest.'}};
const file=resolve(output,'build-packet.json');writeFileSync(file,JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({packet:file,source_files:manifest.length,archive_sha256:packet.archive_sha256,cloud_calls:0}));
