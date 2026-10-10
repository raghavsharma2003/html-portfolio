import { readFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createWebServer } from './server.mjs';
import { createAzureOnlyFetch } from '../../scripts/azure-only-fetch.mjs';
const root = resolve(fileURLToPath(new URL('../..',import.meta.url)));
if (process.env.STUDIO_ROOT !== '1' || process.env.VYAKTI_MODEL_SERVING !== 'azure_only' || process.env.VYAKTI_REPLY_PROVIDER !== 'azure_foundry') throw new Error('azure_web_configuration_required');
const db = new URL(process.env.NEON_URL || 'https://missing.invalid');
if (!process.env.VYAKTI_DATABASE_NAME || decodeURIComponent(db.pathname.slice(1)) !== process.env.VYAKTI_DATABASE_NAME) throw new Error('azure_web_database_binding_required');
const origin = new URL(process.env.AZURE_WEB_PUBLIC_ORIGIN || 'https://missing.invalid');
if (origin.protocol !== 'https:' || origin.hostname === 'missing.invalid' || origin.port || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('azure_web_public_origin_required');
const configFile = join(root,'api/_config.js');
// This writes only an ephemeral runtime file; no package/image receives keys.
// Recreate on every process restart. The final Docker stage checks that no
// config exists in the image, independently of writable-container restarts.
execFileSync(process.execPath,['scripts/write-config.mjs'],{cwd:root,env:{...process.env,CI:'1'},stdio:['ignore','ignore','pipe']});
chmodSync(configFile,0o600);
globalThis.fetch = createAzureOnlyFetch({databaseHost:db.hostname,authOrigin:process.env.SUPABASE_URL});
const response = await fetch(`https://${db.hostname}/sql`,{method:'POST',headers:{'Content-Type':'application/json','Neon-Connection-String':db.href},body:JSON.stringify({query:'select current_database() as name',params:[]}),signal:AbortSignal.timeout(15000)});
if (!response.ok || (await response.json()).rows?.[0]?.name !== process.env.VYAKTI_DATABASE_NAME) throw new Error('azure_web_database_identity_failed');
const manifest = JSON.parse(readFileSync(join(root,'azure-web-manifest.json'),'utf8'));
const server = await createWebServer({root,manifest,trustedIngress:process.env.AZURE_WEB_TRUST_INGRESS==='1',publicOrigin:origin.origin});
const port = Number(process.env.PORT || 8080);
if (!Number.isInteger(port)||port<1||port>65535) throw new Error('azure_web_port_invalid');
server.listen(port,'0.0.0.0',()=>console.log('Vyakti web artifact ready; voice and product acceptance remain separate.'));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{ server.close(()=>process.exit(0)); setTimeout(()=>{server.closeAllConnections();process.exit(1);},25000).unref(); });
