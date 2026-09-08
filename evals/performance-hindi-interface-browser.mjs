// Source-prepared real DOM negatives. Run only with the reserved browser lane.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {installHindiInterfaceProbe} from '../scripts/performance-hindi-interface.mjs';
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
];
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  for(const [name,html,expected]of cases){
    await page.setContent(`<main data-studio-auth-locale="hi" lang="hi">${html}</main>`);
    await page.evaluate(installHindiInterfaceProbe);
    assert.equal(await page.evaluate(()=>window.__VYAKTI_HINDI_INTERFACE__()),expected,name);
    console.log('ok '+name);
  }
  console.log(cases.length+' real DOM cases passed; no product-auth or performance acceptance');
}finally{await browser.close();}
