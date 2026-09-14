import { launchSuiteBrowser } from "./rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createServer } from 'node:http';
import { build } from 'vite';
import { chromium } from 'playwright';
import {boundedWaitMs} from './lib/bounded-wait.mjs'; // WS-R181: scale the fixed Playwright action timeout by machine load

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const original = readFileSync(join(ROOT, 'src/studio/CloneExperience.tsx'), 'utf8');
const parsed = ts.createSourceFile('CloneExperience.tsx', original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['ResonanceRecorder', 'signalSummary', 'clockDuration', 'bytesLabel', 'safeRecordingName', 'normalizeRecordingFile']);
const extracted = parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(parsed)).join('\n');
assert.equal(parsed.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).length, names.size);
const constants = parsed.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ['MINIMUM_RECORDING_MS', 'RECOMMENDED_RECORDING_MS', 'MAXIMUM_RECORDING_MS', 'RECORDING_MIME_BY_EXTENSION'].includes(d.name.getText(parsed)))).map(node => node.getText(parsed)).join('\n');
const preamble = `import {useCallback,useEffect,useRef,useState} from 'react';
import {AnimatePresence,motion,useReducedMotion} from 'framer-motion';
import {openPrivateWavCapture} from 'virtual:recorder-device';
import {ENROLLMENT_LANGUAGE_LABELS} from ${JSON.stringify(join(ROOT,'src/studio/enrollmentLanguage.ts'))};
// WS-R166 moved ResonanceRecorder's own strings into the studio copy
// registry, read through useStudioLocale() (src/studio/localeContext.tsx).
// This probe mounts ResonanceRecorder standalone with no
// StudioLocaleProvider above it -- the same posture the real production
// entry never uses, but one useStudioLocale() is explicitly built to
// survive (its header: "Never throws outside a provider: falls back to
// en... a file mounted by an eval harness or fixture with no provider
// still renders real English"). Importing the hook is therefore both
// necessary (the extracted function calls it directly and previously had
// no import for it at all) and sufficient (no provider wrapper needed) for
// the real registry-driven English strings this suite asserts against.
import {useStudioLocale} from ${JSON.stringify(join(ROOT,'src/studio/localeContext.tsx'))};
const VoiceField=()=>null;
${constants}\n`;
const base = join(ROOT, 'scratchpad'); mkdirSync(base, {recursive:true});
const cacheDir = mkdtempSync(join(base, 'recorder-lifecycle-vite-'));
const bundled=await build({root:ROOT,configFile:false,logLevel:'silent',define:{'process.env.NODE_ENV':'"development"'},build:{write:false,minify:false,rolldownOptions:{input:join(ROOT,'evals/recorder-lifecycle/host.tsx'),output:{entryFileNames:'probe.js'}}},plugins:[{
  name:'actual-recorder-function',
  resolveId(id){if(id.startsWith('virtual:recorder-'))return id;},
  load(id){if(!id.startsWith('virtual:recorder-'))return;
    const component=extracted
      .replace('mountedRef.current = true;', 'if (!new URLSearchParams(location.search).has("legacy-effect")) mountedRef.current = true;')
      .replace('if (!mountedRef.current || disabled || captureState !== "idle") return;', 'if (!new URLSearchParams(location.search).has("legacy-effect") && (!mountedRef.current || disabled || captureState !== "idle")) return;');
    assert.notEqual(component,extracted,'exact actual mount repair available for old-behavior negative control');
    return ts.transpileModule(id==='virtual:recorder-device'?`export async function openPrivateWavCapture(options){return window.recorderProbe.open(options)}`:preamble+component+'\nexport default ResonanceRecorder;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;},
}]});
const server=createServer((req,res)=>{if(req.url==='/probe.js'){res.setHeader('Content-Type','text/javascript');res.end(bundled.output.find(item=>item.fileName==='probe.js').code);}else{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/probe.js"></script>');}});
let browser; let checks=0;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/recorder-probe`;
  browser=await launchSuiteBrowser("recorder-lifecycle");
  const page=await browser.newPage();page.setDefaultTimeout(boundedWaitMs(15000));
  const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('page error:',e.message);});
  await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());
  const button=()=>page.getByRole('button',{name:'Start voice recording',exact:true});
  const open=async(query='')=>{await page.goto(url+query);await button().waitFor();await page.waitForFunction(()=>window.recorderProbe?.effects>=2);};
  const counts=()=>page.evaluate(()=>({...window.recorderProbe.counts}));
  async function check(name,fn){await fn();console.log(`ok ${++checks} - ${name}`);}
  await check('actual recorder starts after StrictMode effect replay',async()=>{
    await open();await button().click();await page.waitForFunction(()=>window.recorderProbe.counts.open===1);
    await page.evaluate(()=>window.recorderProbe.resolveOpen());
    await page.waitForFunction(()=>window.recorderProbe.counts.start+window.recorderProbe.counts.cancel>0);
    assert.equal((await counts()).start,1);
    await page.getByRole('button',{name:/Finish recording/}).waitFor();
    assert.equal((await counts()).start,1);assert.equal((await counts()).cancel,0);
  });
  await check('actual old mount behavior cancels every StrictMode recording',async()=>{
    await open('?legacy-effect=1');await button().click();await page.evaluate(()=>window.recorderProbe.resolveOpen());
    await page.waitForFunction(()=>window.recorderProbe.counts.cancel===1);assert.equal((await counts()).start,0);
  });
  await check('actual recorder waits for audio resume before announcing recording',async()=>{
    await open('?deferred-resume=1');await button().click();await page.evaluate(()=>window.recorderProbe.resolveOpen());
    await page.waitForFunction(()=>window.recorderProbe.counts.start===1);
    assert.equal(await page.getByRole('button',{name:/Finish recording/}).count(),0);
    await page.evaluate(()=>window.recorderProbe.resolveResume());await page.getByRole('button',{name:/Finish recording/}).waitFor();
  });
  await check('resume rejection is visible and a new attempt remains available',async()=>{
    await open('?deferred-resume=1');await button().click();await page.evaluate(()=>window.recorderProbe.resolveOpen());
    await page.waitForFunction(()=>window.recorderProbe.counts.start===1);await page.evaluate(()=>window.recorderProbe.rejectResume());
    await button().waitFor();assert((await page.getByRole('alert').innerText()).includes('Synthetic resume failed'));
    assert.equal((await counts()).cancel,1);assert.equal((await counts()).proceed,0);
  });
  await check('unmount during resume closes capture before late resolution',async()=>{
    await open('?deferred-resume=1');await button().click();await page.evaluate(()=>window.recorderProbe.resolveOpen());
    await page.waitForFunction(()=>window.recorderProbe.counts.start===1);await page.evaluate(()=>{window.recorderProbe.unmount();window.recorderProbe.resolveResume();});
    await page.waitForFunction(()=>window.recorderProbe.counts.cancel>=1);assert.equal(await page.getByRole('button',{name:/Finish recording/}).count(),0);
    assert.equal((await counts()).proceed,0);
  });
  await check('permission resolving after unmount cancels without recording',async()=>{
    await open();await button().click();await page.evaluate(()=>window.recorderProbe.unmount());
    await page.evaluate(()=>window.recorderProbe.resolveOpen());
    await page.waitForFunction(()=>window.recorderProbe.counts.cancel===1);assert.equal((await counts()).start,0);
  });
  await check('recording completion after unmount releases its object URL',async()=>{
    await open();await button().click();await page.evaluate(()=>window.recorderProbe.resolveOpen());await page.getByRole('button',{name:/Finish recording/}).waitFor();
    await page.evaluate(()=>window.recorderProbe.advanceTime());await page.getByRole('button',{name:/Finish recording/}).click();
    await page.waitForFunction(()=>window.recorderProbe.counts.stop===1);await page.evaluate(()=>window.recorderProbe.unmount());
    await page.evaluate(()=>window.recorderProbe.resolveStop());
    await page.waitForFunction(()=>window.recorderProbe.revoked.includes('blob:recorder-result'));
  });
  await check('preview URL is released on unmount',async()=>{
    await open();await button().click();await page.evaluate(()=>window.recorderProbe.resolveOpen());await page.getByRole('button',{name:/Finish recording/}).waitFor();
    await page.evaluate(()=>window.recorderProbe.advanceTime());await page.getByRole('button',{name:/Finish recording/}).click();await page.evaluate(()=>window.recorderProbe.resolveStop());
    await page.waitForFunction(()=>window.recorderProbe.media.length===1);await page.evaluate(()=>window.recorderProbe.finishMedia(0));
    await page.getByRole('button',{name:'Try again',exact:true}).waitFor();await page.evaluate(()=>window.recorderProbe.unmount());
    await page.waitForFunction(()=>window.recorderProbe.revoked.includes('blob:recorder-result'));
  });
  const upload=async(name)=>page.getByLabel('Choose your voice recording',{exact:true}).setInputFiles({name,mimeType:'audio/wav',buffer:Buffer.from('synthetic audio')});
  await check('record review retake and record again retains a usable continuation',async()=>{
    await open();
    for(let turn=1;turn<=2;turn++){
      await button().click();await page.evaluate(()=>window.recorderProbe.resolveOpen());await page.getByRole('button',{name:/Finish recording/}).waitFor();
      await page.evaluate(()=>window.recorderProbe.advanceTime());await page.getByRole('button',{name:/Finish recording/}).click();await page.evaluate(()=>window.recorderProbe.resolveStop());
      await page.waitForFunction(expected=>window.recorderProbe.media.length===expected,turn);await page.evaluate(index=>window.recorderProbe.finishMedia(index),turn-1);
      await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
      if(turn===1){await page.getByRole('button',{name:'Try again',exact:true}).click();await button().waitFor();}
    }
    await page.getByRole('button',{name:'Continue',exact:true}).click();assert.equal((await counts()).proceed,1);assert.equal((await counts()).start,2);
  });
  await check('unreadable file refuses continuation and a new file can recover',async()=>{
    await open();await upload('broken.wav');await page.evaluate(()=>window.recorderProbe.media[0].onerror());
    await page.getByRole('button',{name:'Try again',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Continue',exact:true}).isDisabled());
    await page.getByRole('button',{name:'Try again',exact:true}).click();await upload('working.wav');await page.evaluate(()=>window.recorderProbe.finishMedia(1));
    await page.getByRole('checkbox').check();assert(await page.getByRole('button',{name:'Continue',exact:true}).isEnabled());
  });
  await check('file metadata completing after unmount cannot retain its object URL',async()=>{
    await open();await upload('a.wav');await page.waitForFunction(()=>window.recorderProbe.media.length===1);
    await page.evaluate(()=>window.recorderProbe.unmount());
    await page.waitForFunction(()=>window.recorderProbe.created.every(url=>window.recorderProbe.revoked.includes(url)));
  });
  await check('a later file selection replaces pending metadata without leaking the old URL',async()=>{
    await open();await upload('a.wav');await upload('b.wav');await page.waitForFunction(()=>window.recorderProbe.media.length===2);
    await page.evaluate(()=>window.recorderProbe.finishMedia(1));await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
    const state=await page.evaluate(()=>({created:window.recorderProbe.created,revoked:window.recorderProbe.revoked,src:document.querySelector('.vx-sample audio')?.getAttribute('src')}));
    assert(state.revoked.includes(state.created[0]));assert.equal(state.src,state.created[1]);assert(!state.revoked.includes(state.created[1]));
  });
  assert.deepEqual(errors,[]);console.log(`PASS ${checks} mounted actual-recorder groups; synthetic microphone, no device/provider/voice-quality evidence.`);
} finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  const resolved=realpathSync(cacheDir);assert.equal(dirname(resolved),realpathSync(base));rmSync(resolved,{recursive:true,force:true});
}
