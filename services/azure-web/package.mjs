import { readFileSync, readdirSync, lstatSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { deploymentInputs, createDeploymentRelease } from '../../scripts/deploy-commitment.mjs';
import { publicAsset } from './server.mjs';
export const NODE_IMAGE = 'node:24.13.0-alpine3.23@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function walk(root, prefix = '') {
  const out = [];
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const relative = prefix ? `${prefix}/${name}` : name, stat = lstatSync(join(root, relative));
    if (stat.isSymbolicLink()) throw new Error('azure_web_symlink_refused');
    if (stat.isDirectory()) out.push(...walk(root, relative)); else if (stat.isFile()) out.push(relative);
  }
  return out;
}
const privatePath = p => /(?:^|\/)(?:\.env[^/]*|_config(?:\.js|\.env)|keyring\.json|google-keys\.env|scratchpad|first-clone-out)(?:\/|$)/i.test(p) || /\.(?:pem|key|wav|mp3|m4a|pt|safetensors)$/i.test(p);
const viteConfigDependencies = ['scripts/build-creator-page-fixture.mjs','scripts/build-room-about-fixture.mjs','services/azure-web/build-outcome.mjs'];
// The standalone25 shell has no root index.html. Vercel serves the explicit
// room/studio entry points and the creators directory; keep this manifest in
// lockstep with the checked-in Vite inputs rather than requiring a dead entry.
const viteConfigEntries = ['studio.html','room.html','studio-layout-fixture.html','creator-layout-fixture.html','room-layout-fixture.html','site/creators.html'];
export function prepareContext(root, destination) {
  root = resolve(root); destination = resolve(destination);
  if (existsSync(destination)) throw new Error('azure_web_context_must_be_new');
  const release = createDeploymentRelease(root, 'vyakti-clone');
  const inputs = [...new Set([...deploymentInputs(root), ...walk(join(root,'services/azure-web')).map(p=>`services/azure-web/${p}`),
    'scripts/check-copy.mjs','scripts/roomsVocabAllowlist.mjs','scripts/copy-room-scope.mjs','scripts/azure-only-fetch.mjs'])].sort();
  if (inputs.some(privatePath)) throw new Error('azure_web_private_context_refused');
  const files = inputs.map(path=>({path,sha256:sha(readFileSync(join(root,path)))}));
  mkdirSync(destination);
  for (const {path} of files) { mkdirSync(dirname(join(destination,path)),{recursive:true}); copyFileSync(join(root,path),join(destination,path)); }
  const manifest = { contract:'vyakti-azure-build-context/v1',release,nodeImage:NODE_IMAGE,files };
  writeFileSync(join(destination,'azure-build-context.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}
export function verifyContext(root) {
  const m = JSON.parse(readFileSync(join(root,'azure-build-context.json'),'utf8'));
  if (m.contract !== 'vyakti-azure-build-context/v1' || m.nodeImage !== NODE_IMAGE || !Array.isArray(m.files)) throw new Error('azure_web_context_invalid');
  const paths = m.files.map(f=>f.path);
  if (new Set(paths).size !== paths.length || paths.some(p=>privatePath(p)||p.includes('..')||p.startsWith('/')||p.includes('\\'))) throw new Error('azure_web_context_invalid');
  const viteConfig = readFileSync(join(root,'vite.config.ts'),'utf8');
  for (const dependency of viteConfigDependencies) if (!(viteConfig.includes(`import('./${dependency}')`) || viteConfig.includes(`from './${dependency}'`)) || !paths.includes(dependency)) throw new Error('azure_web_vite_config_dependency_missing');
  for (const entry of viteConfigEntries) if (!viteConfig.includes(`"${entry}"`) || !paths.includes(entry)) throw new Error('azure_web_vite_config_entry_missing');
  const actual = walk(root).filter(p=>p!=='azure-build-context.json');
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...paths].sort())) throw new Error('azure_web_context_extra_or_missing');
  for (const f of m.files) if (sha(readFileSync(join(root,f.path))) !== f.sha256) throw new Error('azure_web_context_changed');
  if (JSON.stringify(createDeploymentRelease(root,'vyakti-clone')) !== JSON.stringify(m.release)) throw new Error('azure_web_source_changed');
  return m;
}
export function assembleRuntime(root, destination, release) {
  root = resolve(root); destination = resolve(destination);
  if (existsSync(destination)) throw new Error('azure_web_runtime_must_be_new');
  const dist = join(root,'dist'), assets = walk(dist).filter(publicAsset);
  const runtime = ['services/azure-voice-app/controller.mjs','scripts/azure-voice-supervisor53.mjs','package.json','package-lock.json','vercel.json','scripts/write-config.mjs','scripts/check-copy.mjs','scripts/roomsVocabAllowlist.mjs','scripts/copy-room-scope.mjs','scripts/azure-only-fetch.mjs','evals/dbattery/prosody-baseline-log.json',
    ...walk(join(root,'api')).filter(p=>!privatePath(p)).map(p=>`api/${p}`),
    ...['routing.mjs','server.mjs','entrypoint.mjs','cron-runner.mjs'].map(p=>`services/azure-web/${p}`),
    ...assets.map(p=>`dist/${p}`)];
  mkdirSync(destination);
  for (const path of runtime) { if (privatePath(path)) throw new Error('azure_web_private_runtime_refused'); mkdirSync(dirname(join(destination,path)),{recursive:true}); copyFileSync(join(root,path),join(destination,path)); }
  const manifest = { contract:'vyakti-azure-web-artifact/v1',product:'vyakti-clone',source_commitment:release.source_commitment,
    runtimeFiles:runtime.filter(path=>!path.startsWith('dist/')).map(path=>({path,sha256:sha(readFileSync(join(destination,path)))})),
    assets:assets.map(path=>({path,bytes:readFileSync(join(dist,path)).length,sha256:sha(readFileSync(join(dist,path)))})) };
  writeFileSync(join(destination,'azure-web-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
