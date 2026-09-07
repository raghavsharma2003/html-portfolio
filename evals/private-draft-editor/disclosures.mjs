import assert from 'node:assert/strict';
import {join} from 'node:path';

// Called inside the incumbent synthetic HTTP editor fixture. Toggling details
// uses actual native keyboard behavior; no handler or editing state is mocked.
export async function checkDisclosures({page,width,open,posts,gets,art,check,measurements}) {
 const geometry=()=>page.evaluate(()=>({height:document.documentElement.scrollHeight,saveTop:document.querySelector('.person-model-action button').getBoundingClientRect().top+scrollY,overflow:document.documentElement.scrollWidth>innerWidth}));
 const editable=()=>page.locator('.teacher-sheet-grid').evaluate(el=>Array.from(el.querySelectorAll('input,select,textarea')).map(n=>({tag:n.tagName,id:n.id,type:n.type,value:n.value,checked:n.checked,disabled:n.disabled})));
 const save=()=>Promise.all([page.waitForResponse(r=>r.request().method()==='POST'),page.locator('.person-model-action button').click()]);
 const toggle=async selector=>{await page.locator(selector+' > summary').focus();await page.keyboard.press('Enter');};
 for(const lane of ['creator','studio']) {
  const suffix=lane==='studio'?'&studio=1':'';
  await open('?full=1&densityOld=1'+suffix);await page.locator('#teacher-sheet-studio').waitFor();
  const oldGeometry=await geometry(),oldControls=await editable();
  const oldValues=await page.locator('.teacher-sheet-ingested-grid .teacher-sheet-readonly > p').allTextContents();
  const oldBoundary=await page.locator('.teacher-sheet-card').last().locator('.teacher-sheet-readonly > p').textContent();
  assert(await page.locator('.teacher-sheet-ingested-grid').isVisible());
  assert.equal(await page.evaluate(()=>Boolean(document.querySelector('.person-model-action').compareDocumentPosition(document.querySelector('.teacher-sheet-ingested'))&Node.DOCUMENT_POSITION_FOLLOWING)),false);
  await page.screenshot({path:join(art,`${width}-${lane}-density-old.png`),fullPage:true});
  await open('?full=1'+suffix);await page.locator('#teacher-sheet-studio').waitFor();
  assert.equal(await page.locator('details[open]').count(),0);assert.equal(await page.locator('.teacher-sheet-ingested-grid').isVisible(),false);
  assert.deepEqual(await editable(),oldControls);
  for(const id of ['subject-domain','syllabus-scope','strictness','warmth','identity-life'])assert(await page.locator('#'+id).isVisible());
  assert(await page.locator('.create-row input').isVisible());assert(await page.locator('.teacher-sheet-publication').isVisible());
  assert.equal(await page.evaluate(()=>Boolean(document.querySelector('.person-model-action').compareDocumentPosition(document.querySelector('.teacher-sheet-ingested'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
  const freshGeometry=await geometry();assert.equal(freshGeometry.overflow,false);assert(freshGeometry.height<oldGeometry.height);assert(freshGeometry.saveTop<oldGeometry.saveTop);
  const calls=[posts().length,gets().length];
  for(const selector of ['.teacher-sheet-boundary','.teacher-sheet-ingested']) {
   const summary=page.locator(selector+' > summary');assert((await summary.boundingBox()).height>=44);
   await toggle(selector);assert.equal(await page.locator(selector).getAttribute('open'),'');assert(await summary.evaluate(el=>el===document.activeElement));
  }
  assert.deepEqual(await page.locator('.teacher-sheet-ingested-grid .teacher-sheet-readonly > p').allTextContents(),oldValues);
  assert.equal(await page.locator('.teacher-sheet-boundary .teacher-sheet-readonly > p').textContent(),oldBoundary);
  for(const selector of ['.teacher-sheet-boundary','.teacher-sheet-ingested']){await toggle(selector);assert.equal(await page.locator(selector).getAttribute('open'),null);}
  assert.deepEqual([posts().length,gets().length],calls);
  await page.screenshot({path:join(art,`${width}-${lane}-density-current.png`),fullPage:true});
  measurements.push({width,lane,old:oldGeometry,current:freshGeometry});
  check(`${width}/${lane}: exact old density negative, earlier Save, keyboard disclosure, exact revealed text and zero toggle requests`);

  const raw={name:'Anjali',identityWho:'Physics teacher',subjectDomain:'physics',subjectStrands:['Kinematics'],strictness:2,warmth:3,syllabusScope:'Exact scope',identityLife:'Exact teaching life',doubtEscalationLadder:['Exact first hint'],boundaryParagraph:'Exact saved boundary',languageVoiceRule:'Exact saved language',sttSoundAlikes:'Exact saved sound',boardVerbalisms:['Exact saved saying'],notationConventions:'Exact saved notation',analogyBank:[{topic:'force',anchor:'push',extra:'keep'}],commonMistakeBank:['Exact mistake'],unknownOwnerField:{keep:['exact',null,7]}};
  await open('?current=1'+suffix,raw);await page.locator('#teacher-sheet-studio').waitFor();await save();assert.deepEqual(posts()[0].draft,raw);
  await page.locator('#syllabus-scope').fill('Explicit changed scope');await save();assert.deepEqual(posts().at(-1).draft,{...raw,syllabusScope:'Explicit changed scope'});
  await page.locator('#strictness').selectOption('0');await page.locator('#warmth').selectOption('4');await page.locator('#identity-life').fill('Explicit teaching life');await page.locator('.syllabus-chapters input').first().check();
  await page.locator('.create-row input').fill('Exact second hint');await page.locator('.create-row input').press('Enter');await save();
  const edited=posts().at(-1).draft;assert.equal(edited.strictness,0);assert.equal(edited.warmth,4);assert.equal(edited.identityLife,'Explicit teaching life');assert.deepEqual(edited.doubtEscalationLadder,['Exact first hint','Exact second hint']);assert.equal(edited.subjectStrands.length,2);
  for(const key of ['boundaryParagraph','languageVoiceRule','sttSoundAlikes','boardVerbalisms','notationConventions','analogyBank','commonMistakeBank','unknownOwnerField'])assert.deepEqual(edited[key],raw[key]);
  check(`${width}/${lane}: exact untouched and unrelated saves plus every editable control preserve read-only and unknown content`);

  const malformed={...raw,boundaryParagraph:{keep:'boundary'},analogyBank:[null],subjectStrands:'bad',doubtEscalationLadder:[null]};
  await open('?current=1'+suffix,malformed);await page.locator('.draft-invalid-notice').waitFor();assert.equal(await page.locator('details[open]').count(),2);assert.equal(await page.locator('summary .disclosure-review').count(),2);
  for(const selector of ['.teacher-sheet-boundary','.teacher-sheet-ingested']){await toggle(selector);assert(await page.locator(selector+' > summary .disclosure-review').isVisible());}
  assert(await page.locator('.draft-invalid-notice').isVisible());assert(await page.getByRole('button',{name:'Replace chapter list',exact:true}).isVisible());assert(await page.getByRole('button',{name:'Replace doubt steps',exact:true}).isVisible());
  await save();assert.deepEqual(posts()[0].draft,malformed);
  await page.getByRole('button',{name:'Replace chapter list',exact:true}).click();assert(await page.locator('.syllabus-chapters input').first().evaluate(el=>el===document.activeElement));
  await page.getByRole('button',{name:'Replace doubt steps',exact:true}).click();assert(await page.locator('.create-row input').evaluate(el=>el===document.activeElement));await save();assert.deepEqual(posts().at(-1).draft,{...malformed,subjectStrands:[],doubtEscalationLadder:[]});
  check(`${width}/${lane}: malformed warnings remain discoverable when closed; explicit replacement preserves raw hidden content and focus`);

  await open('?seed=1'+suffix,{});await page.locator('#teacher-sheet-studio').waitFor();assert(await page.locator('.teacher-sheet-ingested > summary').getByText('Nothing drafted yet',{exact:true}).isVisible());
  assert.equal(await page.locator('details[open]').count(),0);await save();assert.deepEqual(posts()[0].draft,{});
  check(`${width}/${lane}: empty owner seed remains honest outside disclosure and explicit save stays empty`);
 }
 await open('?hi=1',{name:'Anjali',subjectDomain:'physics',boundaryParagraph:{keep:true},analogyBank:[null]});await page.locator('.draft-invalid-notice').waitFor();
 assert(await page.getByText('ड्राफ्ट का विवरण (सिर्फ़ पढ़ने के लिए)',{exact:false}).first().isVisible());assert.equal(await page.locator('summary .disclosure-review').count(),2);
 for(const selector of ['.teacher-sheet-boundary','.teacher-sheet-ingested']){await toggle(selector);assert(await page.locator(selector+' > summary .disclosure-review').isVisible());}
 assert.equal((await geometry()).overflow,false);await page.screenshot({path:join(art,`${width}-density-hindi-invalid.png`),fullPage:true});
 check(`${width}: Hindi summaries and malformed warnings remain visible without horizontal overflow`);
}
