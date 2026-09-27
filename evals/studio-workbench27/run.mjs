import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { launchSuiteBrowser } from '../rehearsal/browser.mjs';

const root=resolve(import.meta.dirname,'../..');
const out=resolve(root,'scratchpad/workbench27');mkdirSync(out,{recursive:true});
const server=process.env.VYAKTI_VISUAL_BASE ? null : await createServer({root,cacheDir:resolve(out,'vite-cache'),logLevel:'error',optimizeDeps:{entries:['evals/studio-workbench27/host.html']},server:{host:'127.0.0.1',port:0,open:false}});
let browser;const results=[],errors=[];
try {
 await server?.listen();const origin=process.env.VYAKTI_VISUAL_BASE || `http://127.0.0.1:${server.httpServer.address().port}`;console.log('workspace server ready');
 browser=await launchSuiteBrowser('studio-workbench27');console.log('workspace browser ready');
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/evals/studio-workbench27/host.html?view=enrich&saved=1&text=1`);
  await page.locator('.workbench-overview').waitFor();console.log(`overview ${width} mounted`);await page.evaluate(()=>document.fonts.ready);
  const nav=page.locator(width<761?'.workbench-mobile-nav':'.workbench-sidebar');
  assert.equal(await nav.isVisible(),true,'navigation exists before any voice/runtime approval');
  if(width<761){const box=await nav.boundingBox();assert.ok(box.y>800&&box.y+box.height<=901,'phone navigation is anchored at the bottom');}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:resolve(out,`overview-${width}.png`)});
  await page.locator('.workbench-setup-list').getByRole('button',{name:/Knowledge/}).click();
  await page.getByText('My notes.txt',{exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('enrichView'),'files');
  await page.reload();await page.getByText('My notes.txt',{exact:true}).waitFor();
  await page.screenshot({path:resolve(out,`knowledge-${width}.png`)});
  await nav.getByRole('button',{name:width<761?'Build':'Your AI',exact:true}).click();
  await page.locator('.workbench-setup-list').getByRole('button',{name:/Personality/}).click();
  await page.locator('.humanos-studio').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('enrichView'),'humanos');
  await page.screenshot({path:resolve(out,`personality-${width}.png`)});
  await nav.getByRole('button',{name:'Test',exact:true}).click();
  await page.locator('.ptr-panel').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('view'),'rehearsal');
  assert.equal(await nav.isVisible(),true,'test keeps a way back to setup');
  await nav.getByRole('button',{name:width<761?'Build':'Your AI',exact:true}).click();
  await page.locator('.workbench-setup-list').getByRole('button',{name:/Voice/}).click();
  await page.getByRole('heading',{name:'Voice verification is not available yet.'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Test a private draft',exact:true}).count(),1,'saved material readiness does not require entering the files panel again');
  if(width>=761){await nav.getByRole('button',{name:'Response style',exact:true}).click();await page.locator('.emotionos-studio').waitFor();assert.equal(new URL(page.url()).searchParams.get('view'),'emotionos');}
  results.push({width,checks:['pre-runtime-navigation','phone-bottom-placement','no-overflow','knowledge-reload','profile-route','private-test-route','ready-material-preload','style-route']});
  await page.close();
 }
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(out,'result.json'),JSON.stringify({results,errors,scope:'Mounted product components with synthetic API responses. No signed-in live account, provider call or quality proof.'},null,2));
 console.log(`Workspace: ${results.length} viewport journeys passed; no live account or model call.`);
} catch(error) {console.error(error);throw error;} finally {await browser?.close();await server?.close();}
