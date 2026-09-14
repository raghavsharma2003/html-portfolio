// Passive evidence only: never changes focus, actionability, timeouts or UI.
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
export async function observeBrowser(context) {
  await context.addInitScript(() => {
    const d = window.__actionDiagnostics = {started: Date.now(), frames: 0, lastFrame: null, gaps: [], visibility: [], longTasks: []};
    let previous = performance.now();
    function frame(now) { d.frames++; d.lastFrame = Date.now(); if(now - previous > 250) d.gaps.push({at: Date.now(), ms: now - previous}); previous = now; requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', () => d.visibility.push({at: Date.now(), state: document.visibilityState}));
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => {
      for (const entry of list.getEntries()) d.longTasks.push({start: entry.startTime, duration: entry.duration});
    }).observe({type: 'longtask', buffered: true});
  });
}
export async function recordBrowserFailure(browser, directory) {
  const pages = browser?.contexts().flatMap(context => context.pages()) || [];
  for (const [index,page] of pages.entries()) {
    try {
      let deadline;
      const state = await Promise.race([page.evaluate(() => {
        const selectors = ['#syllabus-scope', '.ptr-attestation input', '#teacher-sheet-studio'];
        return {at: new Date().toISOString(), url: location.href, visibility: document.visibilityState, focus: document.activeElement?.outerHTML, diagnostics: window.__actionDiagnostics,
          elements: selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(el => ({selector, html: el.outerHTML, connected: el.isConnected, readOnly: el.readOnly, rect: el.getBoundingClientRect().toJSON(), display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility, disabled: el.matches(':disabled'), animations: el.getAnimations().map(a => ({state:a.playState,time:a.currentTime})), ancestors: [...(function*(){let p=el.parentElement;while(p){yield {tag:p.tagName,hidden:p.hidden,inert:p.inert};p=p.parentElement;}})()]})))};
      }), new Promise((_,reject) => { deadline = setTimeout(() => reject(new Error('browser_diagnostic_deadline')),3000); })]).finally(() => clearTimeout(deadline));
      writeFileSync(join(directory, `browser-failure-${index}.json`), JSON.stringify(state,null,2));
      await page.screenshot({path: join(directory, `browser-failure-${index}.png`), timeout: 3000});
    } catch(error) { writeFileSync(join(directory, `browser-diagnostic-error-${index}.txt`), String(error)); }
  }
}
