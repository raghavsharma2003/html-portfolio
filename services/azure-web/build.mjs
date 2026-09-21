import { readFileSync, writeFileSync, renameSync, copyFileSync, cpSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyContext, assembleRuntime, walk } from './package.mjs';
const root = resolve(fileURLToPath(new URL('../..',import.meta.url)));
const context = JSON.parse(readFileSync(join(root,'azure-build-context.json'),'utf8'));
if (process.argv.includes('--verify-context')) { verifyContext(root); process.exit(0); }
if (process.env.STUDIO_ROOT !== '1') throw new Error('azure_web_wrong_product');
for (const [name,value] of Object.entries(process.env)) if (value && /(?:API_KEY|SECRET|NEON_URL|SUPABASE|PRIVATE_TEXT|OPENROUTER_KEY|GOOGLE_KEY)/.test(name)) throw new Error('azure_web_runtime_secrets_in_build');
// npm ci already ran in a secret-free prior build layer. Identity was checked
// before install and remains distinct from environment-sensitive Vite output.
const {createDeploymentRelease} = await import('../../scripts/deploy-commitment.mjs');
if (JSON.stringify(context.release) !== JSON.stringify(createDeploymentRelease(root,'vyakti-clone'))) throw new Error('azure_web_source_changed_after_install');
execFileSync(process.execPath,['scripts/write-config.mjs','--stub'],{cwd:root,env:{...process.env,CI:'1'},stdio:'inherit'});
execFileSync('npm',['exec','--','vite','build'],{cwd:root,stdio:'inherit'});
// Fixture entry HTML/assets must not enter the OTA archive or final image.
for (const path of walk(join(root,'dist'))) if (/fixture/i.test(path)) unlinkSync(join(root,'dist',path));
const ota = process.env.OTA_BASE_URL;
if (!ota || !/^https:\/\/[a-z0-9.-]+$/.test(ota)) throw new Error('azure_web_ota_origin_required');
execFileSync(process.execPath,['scripts/ota-bundle.mjs','--base-url',ota],{cwd:root,stdio:'inherit'});
renameSync(join(root,'dist/index.html'),join(root,'dist/chat.html'));
for (const [source,target] of [['vyakti.html','index.html'],['vyakti-privacy.html','privacy.html'],['vyakti-delete-account.html','delete-account.html'],['suites.html','suites.html'],['creators.html','creators.html'],['robots.txt','robots.txt'],['styles.css','styles.css']]) copyFileSync(join(root,'site',source),join(root,'dist',target));
mkdirSync(join(root,'dist/assets'),{recursive:true}); cpSync(join(root,'site/assets'),join(root,'dist/assets'),{recursive:true});
writeFileSync(join(root,'dist/vyakti-release.json'),JSON.stringify(context.release,null,2)+'\n');
assembleRuntime(root,resolve('/runtime'),context.release);
