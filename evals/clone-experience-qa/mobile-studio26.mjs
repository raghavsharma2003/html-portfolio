import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { syntheticPcmWav } from './synthetic-wav.mjs';
import { launchSuiteBrowser } from '../rehearsal/browser.mjs';
const base = process.env.VYAKTI_VISUAL_BASE || 'http://127.0.0.1:5186';
const out = resolve('scratchpad/mobile-studio26');
mkdirSync(out, { recursive: true });
const wav = syntheticPcmWav();
const wavPath = resolve(out, 'synthetic.wav'); writeFileSync(wavPath, wav);
const browser = await launchSuiteBrowser('mobile-studio26', ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wavPath}`]);
const records = [], errors = [];
const sizes = [360,390,768,1440];
const context = await browser.newContext({ permissions: ['microphone'], reducedMotion: 'reduce', viewport: {width:390,height:844} });
const page = await context.newPage();
page.on('pageerror', e=>errors.push(e.message));
async function capture(state) {
 for (const width of sizes) {
  await page.setViewportSize({width,height:width>=768?900:844});
  await page.locator('.vx-capture, .vx-upload').evaluate(e=>e.scrollTop=0);
  const data=await page.evaluate(()=>{
   const rect=s=>{const e=document.querySelector(s);return e?e.getBoundingClientRect().toJSON():null};
   const controls=[...document.querySelectorAll('.vx-capture button, .vx-upload button')].filter(e=>e.getBoundingClientRect().height);
   return {overflow:document.documentElement.scrollWidth-innerWidth, rail:rect('.ffm-rail'), title:rect('.vx-stage-title'), panel:rect('.vx-capture__center, .vx-upload__center'), minControlHeight: controls.length?Math.min(...controls.map(e=>e.getBoundingClientRect().height)):null, controls:controls.map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()})), runtimeError:document.documentElement.dataset.qaRuntimeError||''};
  });
  assert.ok(data.overflow<=1,`${state}/${width} overflow`);
  assert.ok(data.minControlHeight===null||data.minControlHeight>=44,`${state}/${width} control ${data.minControlHeight}`);
  assert.ok(!data.rail||data.title.top>=data.rail.bottom+8,`${state}/${width} rail/title overlap`);
  assert.ok(data.panel.top>=data.title.bottom+8,`${state}/${width} title/panel overlap`);
  assert.equal(data.runtimeError,'');
  const contrasts=await page.locator('.vx-record-button, .vx-button--primary, .vx-language .is-selected').evaluateAll(nodes => {
   const luminance = c => {const v=c.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4});return v[0]*.2126+v[1]*.7152+v[2]*.0722};
   return nodes.filter(e=>e.getBoundingClientRect().height).map(e=>{const s=getComputedStyle(e),a=luminance(s.color),b=luminance(s.backgroundColor);return {label:e.textContent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),disabled:e.disabled}});
  });
  for(const c of contrasts)assert.ok(c.ratio>=4.5,`${state}/${width} contrast ${JSON.stringify(c)}`);
  records.push({state,width,...data,contrasts});
  await page.screenshot({path:resolve(out,`${state}-${width}.png`)});
 }
}
async function open(suffix='') {await page.goto(`${base}/evals/clone-experience-qa/harness.html?scenario=recorder${suffix}`);await page.locator('.vx-record-button').waitFor();}
try {
 if (!process.argv.includes('--extras')) {
 await open(); await capture('idle');
 await page.locator('.vx-record-button').focus();
 await page.keyboard.press('Enter');
 await page.locator('.vx-record-button.is-recording').waitFor();
 await capture('recording');
 await page.waitForTimeout(13500);
 await page.locator('.vx-record-button').click();
 await page.locator('.vx-sample audio').waitFor();
 await capture('preview');
 const focused=await page.locator('.vx-sample button').first().evaluate(e=>{e.focus();return {outline:getComputedStyle(e).outlineWidth,focused:document.activeElement===e}});
 assert.equal(focused.focused,true);assert.ok(parseFloat(focused.outline)>=2);
 for(const [flag,state] of [['uploadHold','uploading'],['uploadFail','error']]) {
  await open(`&${flag}=1`);
  await page.locator('input[type=file]').setInputFiles({name:'synthetic.wav',mimeType:'audio/wav',buffer:wav});
  await page.locator('.vx-sample audio').waitFor();
  await page.locator('.vx-source-declaration input').check();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.locator('.vx-upload').waitFor();
  if(state==='error')await page.getByRole('button',{name:'Retry safely'}).waitFor();
  await capture(state);
 }
 writeFileSync(resolve(out,'geometry.json'),JSON.stringify({records,errors,keyboard:focused},null,2));
 }
 await page.emulateMedia({reducedMotion:'no-preference'});
 await open();
 await page.locator('.vx-record-button').click();
 await page.locator('.vx-record-button.is-recording').waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.vx-capture__wave span')].some(e=>parseFloat(e.style.transform.match(/[\d.]+/)[0])>0.06),{timeout:10000});
 const motion=await page.locator('.vx-capture__wave span').evaluateAll(nodes=>nodes.map(e=>({target:e.style.transform,computed:getComputedStyle(e).transform})));
 assert.ok(motion.some(t=>parseFloat(t.target.match(/[\d.]+/)[0])>0.06), 'waveform receives actual microphone signal');
 await page.screenshot({path:resolve(out,'recording-motion-1440.png')});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.setViewportSize({width:720,height:450});
 await page.evaluate(()=>document.documentElement.style.zoom='2');
 await page.locator('.vx-record-button').scrollIntoViewIfNeeded();
 const reflow=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,height:document.querySelector('.vx-record-button').getBoundingClientRect().height}));
 assert.ok(reflow.overflow<=1 && reflow.height>=44,JSON.stringify(reflow));
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(out,'motion-reflow.json'),JSON.stringify({motion,reflow,errors},null,2));
 console.log(process.argv.includes('--extras') ? 'PASS live signal and 200% reflow; zero runtime errors' : `PASS ${records.length} mounted states; synthetic WAV recording/playback; keyboard; reduced motion; live signal; 200% reflow; zero runtime errors`);
} finally {await browser.close();}
