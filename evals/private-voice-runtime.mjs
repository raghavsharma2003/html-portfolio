// No network beyond loopback. Synthetic transport results are not SQL or quality evidence.
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--test','services/private-voice/runtime.test.mjs'],{stdio:'inherit',timeout:180000});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status||1);
