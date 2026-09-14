// Source-prepared real DOM negatives. Run only with the reserved browser lane.
import assert from 'node:assert/strict';
import {launchRehearsalBrowser} from './rehearsal/browser.mjs';
import {installHindiInterfaceProbe} from '../scripts/performance-hindi-interface.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const cases=[
  ['real email interface', '<h2 id="signin-title">ईमेल से शुरू करें</h2><label for="studio-email">ईमेल पता</label><input id="studio-email" type="email">', true],
  ['real optional code interface', '<h2 id="signin-title">इनबॉक्स देखें</h2><label for="studio-code">छह अंकों का कोड</label><input id="studio-code" inputmode="numeric">', true],
  ['logo-only Hindi', '<span aria-hidden="true">व्य</span><h2 id="signin-title">Start with email</h2><label for="studio-email">Email address</label><input id="studio-email" type="email">', false],
  ['input missing', '<h2 id="signin-title">ईमेल से शुरू करें</h2><label for="studio-email">ईमेल पता</label>', false],
  ['input display none', '<h2 id="signin-title">ईमेल से शुरू करें</h2><label for="studio-email">ईमेल पता</label><input style="display:none" id="studio-email" type="email">', false],
  ['input visibility hidden', '<h2 id="signin-title">ईमेल से शुरू करें</h2><label for="studio-email">ईमेल पता</label><input style="visibility:hidden" id="studio-email" type="email">', false],
  ['input disabled', '<h2 id="signin-title">ईमेल से शुरू करें</h2><label for="studio-email">ईमेल पता</label><input disabled id="studio-email" type="email">', false],
  ['input wrong type', '<h2 id="signin-title">ईमेल से शुरू करें</h2><label for="studio-email">ईमेल पता</label><input id="studio-email" type="checkbox">', false],
  ['hidden Hindi descendant', '<h2 id="signin-title">Start with email<span hidden>ईमेल से शुरू करें</span></h2><label for="studio-email">ईमेल पता</label><input id="studio-email" type="email">', false],
  ['CSS-hidden Hindi descendant', '<h2 id="signin-title">Start with email<span style="display:none">ईमेल से शुरू करें</span></h2><label for="studio-email">ईमेल पता</label><input id="studio-email" type="email">', false],
  ['aria-hidden Hindi descendant', '<h2 id="signin-title">Start with email<span aria-hidden="true">ईमेल से शुरू करें</span></h2><label for="studio-email">ईमेल पता</label><input id="studio-email" type="email">', false],
  ['input readonly', '<h2 id="signin-title">ईमेल से शुरू करें</h2><label for="studio-email">ईमेल पता</label><input readonly id="studio-email" type="email">', false],
  ['input opacity zero', '<h2 id="signin-title">ईमेल से शुरू करें</h2><label for="studio-email">ईमेल पता</label><input style="opacity:0" id="studio-email" type="email">', false],
  ['input offscreen', '<h2 id="signin-title">ईमेल से शुरू करें</h2><label for="studio-email">ईमेल पता</label><input style="position:absolute;top:2000px" id="studio-email" type="email">', false],
  ['inert ancestor', '<div inert><h2 id="signin-title">ईमेल से शुरू करें</h2><label for="studio-email">ईमेल पता</label><input id="studio-email" type="email"></div>', false],
  ['opacity zero Hindi descendant', '<h2 id="signin-title">Start<span style="opacity:0">ईमेल से शुरू करें</span></h2><label for="studio-email">ईमेल पता</label><input id="studio-email" type="email">', false],
  ['wrong label association', '<h2 id="signin-title">ईमेल से शुरू करें</h2><label for="wrong">ईमेल पता</label><input id="studio-email" type="email">', false],
];
// Match full Chromium explicitly pinned by paired47/native49/probe52
// diagnostics — the shared binary resolution `evals/rehearsal/browser.mjs`
// already owns (WS-R165), rather than a second copy of it here.
const {browser,executablePath,channel,reason}=await launchRehearsalBrowser([],{timeout:30000});
if(!browser){console.log(`SKIP performance-hindi-interface-browser: ${reason}`);process.exit(0);}
const executableHash=executablePath?createHash('sha256').update(readFileSync(executablePath)).digest('hex'):null;
console.log(JSON.stringify({startedAt:new Date().toISOString(),executablePath:executablePath||`playwright chromium channel (${channel})`,executableHash}));
console.log(JSON.stringify({browserVersion:browser.version()}));
const deadline=setTimeout(()=>{void browser.close();},90000);
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(5000);
  await page.evaluate(()=>{
    window.forcedReads=[];
    for(const key of ['checkVisibility','getBoundingClientRect'])Element.prototype[key]=function(){window.forcedReads.push(key);throw Error('forbidden '+key);};
    window.getComputedStyle=()=>{window.forcedReads.push('getComputedStyle');throw Error('forbidden computed style');};
  });
  for(const [name,html,expected]of cases){
    await page.evaluate(()=>window.__VYAKTI_HINDI_INTERFACE_STOP__?.());
    await page.setContent(`<main data-studio-auth-locale="hi" lang="hi">${html}</main>`);
    await page.evaluate(installHindiInterfaceProbe);
    assert.notEqual(await page.evaluate(()=>window.__VYAKTI_HINDI_INTERFACE_STATE__.status),'unsupported','Real browser visibility tracking supported');
    if(expected)await page.waitForFunction(()=>window.__VYAKTI_HINDI_INTERFACE__());
    else await page.waitForTimeout(300); // Functional negative delivery window, never gate timing.
    assert.equal(await page.evaluate(()=>window.__VYAKTI_HINDI_INTERFACE__()),expected,name);
    assert.deepEqual(await page.evaluate(()=>window.forcedReads),[],name+' does not force layout');
    console.log('ok '+name);
  }
  await page.evaluate(()=>window.__VYAKTI_HINDI_INTERFACE_STOP__());
  await page.setContent(`<main data-studio-auth-locale="hi" lang="hi">${cases[0][1]}</main>`);
  await page.evaluate(installHindiInterfaceProbe);await page.waitForFunction(()=>window.__VYAKTI_HINDI_INTERFACE__());
  for(const mutation of ['opacity','disabled','readonly','replace']){
    assert.equal(await page.evaluate(kind=>{
      const node=document.querySelector('#studio-email');
      if(kind==='opacity')node.style.opacity='0';else if(kind==='disabled')node.disabled=true;else if(kind==='readonly')node.readOnly=true;else node.replaceWith(node.cloneNode());
      return window.__VYAKTI_HINDI_INTERFACE__();
    },mutation),false,'No cached-positive after '+mutation);
    if(mutation!=='replace'){await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.__VYAKTI_HINDI_INTERFACE__()),false);}
    await page.evaluate(()=>{const node=document.querySelector('#studio-email');node.style.opacity='1';node.disabled=false;node.readOnly=false;});
    await page.waitForFunction(()=>window.__VYAKTI_HINDI_INTERFACE__());
  }
  assert.deepEqual(await page.evaluate(()=>window.forcedReads),[]);
  console.log(cases.length+' real DOM cases plus4 stale-generation transitions passed; no product-auth or performance acceptance');
}finally{clearTimeout(deadline);await browser.close();}
