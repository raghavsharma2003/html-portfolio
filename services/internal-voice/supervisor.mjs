import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createInternalVoiceRuntime} from './runtime.mjs';
import {sha,fail,safeError} from './contract.mjs';
import {commitment} from '../azure-voice-app/controller.mjs';
export async function supervisorPass(runtime,now=Date.now){
  const {config,store,controller}=runtime;
  if(sha(readFileSync(new URL(import.meta.url)))!==config.policy.supervisor_source_sha256)fail('internal_voice_supervisor_source_changed');
  const observed=await store.read();
  for(const run of Object.values(observed.runs))if(run.window&&run.window.state!=='terminal_observed')await controller.supervisorTick(run.window.window_id);
  const time=now();
  await store.heartbeat({app_id:config.plan.app_id,contract_sha256:config.plan.contract_sha256,
    revision_sha256:commitment({revision_name:config.plan.revision_name,configuration_sha256:config.plan.configuration_sha256,template_sha256:config.plan.template_sha256}),
    source_sha256:config.policy.supervisor_source_sha256,heartbeat_at:new Date(time).toISOString(),lease_expires_at:new Date(time+30000).toISOString()});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const runtime=createInternalVoiceRuntime();
  for(;;){try{await supervisorPass(runtime);}catch(e){process.stderr.write(`${safeError(e)}\n`);}await new Promise(resolve=>setTimeout(resolve,5000));}
}
