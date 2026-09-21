// Mounted regression for the owner's persistent mobile notice. No API/model calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { launchRehearsalBrowser } from "../rehearsal/browser.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bundle = await build({ stdin: { contents: `
  import React, { useState } from 'react';
  import { createRoot } from 'react-dom/client';
  window.noticeTimerStarts = 0;
  const schedule = window.setTimeout.bind(window);
  window.setTimeout = (fn, delay, ...args) => {
    if (delay === 6000) window.noticeTimerStarts++;
    return schedule(fn, delay, ...args);
  };
  import Notice from './src/studio/WorkspaceNotice';
  import { workspaceLifecycleLabel } from './src/studio/workspaceLifecycle';
  function App() {
    const [message,setMessage]=useState(''); const [scope,setScope]=useState('a');
    const [hidden,setHidden]=useState(false); const [error,setError]=useState(null);
    const [tick,setTick]=useState(0);
    return <><button onClick={()=>setMessage('Source removed')}>Notify</button>
      <button onClick={()=>setTick(tick+1)}>Rerender</button>
      <button onClick={()=>setScope(scope==='a'?'b':'a')}>Navigate</button>
      <button onClick={()=>setHidden(!hidden)}>Drawer</button>
      <button onClick={()=>setError({headline:'Upload stopped',detail:'Check your connection and retry.'})}>Error</button>
      <p data-testid="lifecycle">{workspaceLifecycleLabel('consent_pending','en')} / {workspaceLifecycleLabel('enrolling','hi')}</p>
      <Notice message={message} error={error} scope={scope} hidden={hidden} locale="en"
        onDismissNotice={()=>setMessage('')} onDismissError={()=>setError(null)} /></>;
  }
  createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic", logLevel: "silent" });
const server = createServer((req,res) => {
  res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/app.js" ? bundle.outputFiles[0].contents : '<div id="root"></div><script src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const launched = await launchRehearsalBrowser();
if (!launched.browser) { server.close(); console.log(`SKIP workspace-notice: ${launched.reason}`); process.exit(0); }
const browser = launched.browser;
let checks = 0;
try {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const click = name => page.getByRole('button',{name,exact:true}).click();
  const count = async (role,n) => {
    await page.getByRole(role).waitFor({ state: n ? 'attached' : 'detached', timeout: 3000 });
    assert.equal(await page.getByRole(role).count(),n); checks++;
  };
  await click('Notify'); await count('status',1);
  await page.waitForFunction(()=>window.noticeTimerStarts === 1);
  await page.clock.runFor(4000); await click('Rerender'); await page.clock.runFor(2100);
  assert.equal(await page.evaluate(()=>window.noticeTimerStarts),1,'unstable parent callback must not restart the timer');
  await count('status',0); // wait for React/AnimatePresence to commit the actual dismissal
  await click('Notify'); await page.getByRole('button',{name:'Dismiss',exact:true}).focus();
  await page.clock.runFor(8000); await count('status',1);
  await page.getByRole('button',{name:'Rerender',exact:true}).focus(); await page.clock.runFor(6100);
  await count('status',0);
  await click('Notify'); await click('Navigate'); await count('status',0);
  await click('Notify'); await click('Drawer'); await count('status',0);
  await click('Drawer'); await count('status',0); // reopening must not revive stale feedback
  await click('Notify'); await click('Dismiss'); await count('status',0);
  await page.getByRole('button',{name:'Notify',exact:true}).evaluate(button=>button.click());
  await page.clock.runFor(6100); await count('status',0); // dismissed focus cannot pause the next async notice
  await click('Notify'); await page.getByRole('status').hover();
  await page.getByRole('button',{name:'Navigate',exact:true}).evaluate(button=>button.click());
  await count('status',0);
  await page.mouse.move(700,500);
  await page.getByRole('button',{name:'Notify',exact:true}).evaluate(button=>button.click());
  await page.clock.runFor(6100); await count('status',0); // removed hover cannot leak into the next scope
  await click('Error'); await page.clock.runFor(15000); await count('alert',1);
  await click('Dismiss'); await count('alert',0);
  assert.equal(await page.getByTestId('lifecycle').textContent(),'Finish setup / अपनी आवाज़ जोड़ें'); checks++;
  console.log(`workspace-notice: ${checks}/${checks} mounted checks passed`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
