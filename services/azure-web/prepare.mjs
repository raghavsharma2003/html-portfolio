import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { prepareContext } from './package.mjs';
const root = resolve(fileURLToPath(new URL('../..',import.meta.url)));
const at = process.argv.indexOf('--out'), out = process.argv[at+1];
if (at<0||!out||out.startsWith('--')) throw new Error('azure_web_new_context_path_required');
const result = prepareContext(root,out);
console.log(JSON.stringify({source_commitment:result.release.source_commitment,files:result.files.length,cloudCalls:0,context:resolve(out)}));
