// Mounted personal publication ceremony. All HTTP is synthetic and local;
// this does not exercise PostgreSQL, real account auth, models or voice.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import {launchSuiteBrowser} from '../rehearsal/browser.mjs';
import {boundedWaitMs} from '../lib/bounded-wait.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const out=join(root,'scratchpad/text-publication-person-profile',String(Date.now()));
mkdirSync(out,{recursive:true});
const RID='10000000-0000-4000-8000-000000000001';
const SID='20000000-0000-4000-8000-000000000001';
const INVALID_SID='20000000-0000-4000-8000-000000000002';
const IID='30000000-0000-4000-8000-000000000001';
const TOKEN='synthetic-person-publication-owner-token';
const reviewHash='b'.repeat(64);
const terms={audience:'signed_in_adult_attestation',publication_days:30,retention_days:30,
  visitor_question_limit:20,total_question_limit:200,budget_microusd:100000,
  quota_policy:'admission_counts',memory:false,voice:false};
const projection={sheetKind:'person',name:'Synthetic Anika',identityWho:'I am a gardener and a careful listener.',
  identityLife:'I grew up near Jaipur and now keep a small rooftop garden.',
  lifeTexture:'Morning chai, seed trays and handwritten notes.',
  tasteTopics:'Gardening, local walks and everyday recipes.',
  curiosityTopics:'How people make time for things they enjoy.',
  personLine:'An AI version of Anika, sharing the profile and notes she approved.',
  personValues:['Be kind without pretending to agree.','Say when something is uncertain.'],
  personNeverSay:['Do not claim to be the real Anika.','Do not share private family details.'],
  personTalk:{register:'mixed',scriptBaseline:'roman-hinglish',codeSwitchNote:'Keep Hindi phrases in Roman letters.'}};
const teacherProjection={name:'Synthetic Physics Teacher',subjectDomain:'physics',explanationOrder:'Known facts, then calculation'};
const material='Water basil when its top layer of soil feels dry. Check the soil before adding more water.';
const statements=[
  {id:'authorize_public_material',text:'Let signed-in adults receive AI text answers using this reviewed personal profile and material. I approve sharing every profile field shown here.'},
  {id:'confirm_material_rights',text:'I created this material and have permission to publish its contents. I reviewed it for private information.'},
  {id:'accept_public_ai_disclosure',text:'This publishes AI text from my account materials. It does not verify my identity or authorize voice, training or private relationship memory.'},
  {id:'accept_publication_terms',text:'I accept the displayed audience, term, question limits and budget. Visitors may copy answers. I can stop this link and erase stored content.'},
];
const personStatementSet='account-person-material-publication/v1';
const sourcePaths=['src/studio/ExpertSharePanel.tsx','src/studio/publication/MaterialSharePanel.tsx',
  'src/studio/publication/publicationApi.ts','src/studio/publication/publication.css'];
const digest=value=>createHash('sha256').update(value).digest('hex');
const sourceHashes=Object.fromEntries(sourcePaths.map(path=>[path,digest(readFileSync(join(root,path)))]));
const entryPath=join(out,'fixture.tsx');
writeFileSync(entryPath,`
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/instrument-sans';
import ExpertSharePanel from '${root.replaceAll('\\','/')}src/studio/ExpertSharePanel';
import MaterialSharePanel from '${root.replaceAll('\\','/')}src/studio/publication/MaterialSharePanel';
function Fixture(){
  const [opens,setOpens]=useState(0);
  return <main>
    {new URLSearchParams(location.search).get('surface')==='fallback'
      ? <MaterialSharePanel token={${JSON.stringify(TOKEN)}} replicaId={${JSON.stringify(RID)}} onReview={()=>{}}/>
      : <ExpertSharePanel token={${JSON.stringify(TOKEN)}} replicaId={${JSON.stringify(RID)}}
          stopped={false} voiceWorkspaceReady={false} onReview={()=>{}}
          onAuthError={()=>{throw new Error('unexpected fixture auth error')}}
          onOpenProfile={()=>setOpens(value=>value+1)}/>}
    <output id="profile-callback-count" aria-label="Personal profile callback count">{opens}</output>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`);
const bundle=join(out,'bundle');
await build({root,configFile:false,logLevel:'error',build:{outDir:bundle,emptyOutDir:true,
  lib:{entry:entryPath,name:'PersonPublicationFixture',formats:['iife'],fileName:()=> 'fixture.js'},cssCodeSplit:false},
  define:{'process.env.NODE_ENV':JSON.stringify('production')}});
const js=readFileSync(join(bundle,'fixture.js'));
const css=readFileSync(join(bundle,readdirSync(bundle).find(path=>path.endsWith('.css'))));
let teacher=false,publication=null,requests=[],page,browser,server;
const errors=[],unexpected=[],blockedExternal=[],checks=[],captures=[];
const readiness=input=>{
  const chosen=input.sheet_id===SID&&input.context_item_id===IID;
  const invalid=input.sheet_id===INVALID_SID;
  return {replica_id:RID,state:chosen?'ready':'needs_input',
    blockers:chosen?[]:[{code:invalid?'text_publication_projection_invalid':'text_publication_selection_required',responsibility:'owner'}],
    drafts:teacher?[{sheet_id:SID,name:teacherProjection.name,sheet_kind:'teacher',status:'draft',updated_at:'2026-10-09T00:00:00Z'}]
      :[{sheet_id:SID,name:projection.name,sheet_kind:'person',status:'draft',updated_at:'2026-10-09T00:00:00Z'},
        {sheet_id:INVALID_SID,name:'Incomplete personal profile',sheet_kind:'person',status:'draft',updated_at:'2026-10-09T00:00:00Z'}],
    context_items:[{item_id:IID,source_name:'garden-notes.txt',status:'mined',format:'text',authorship:'mine',
      source_id:IID,source_ready:true,eligible:true,reason:null}],
    selected:chosen?{review_hash:reviewHash,source_name:'garden-notes.txt',projection:teacher?teacherProjection:projection,
      material_text:material,terms}:null,
    statement_set:teacher?'account-material-publication/v1':personStatementSet,
    statements:teacher?statements.map(statement=>statement.id==='authorize_public_material'
      ?{...statement,text:'Let signed-in adults receive AI text answers using this reviewed material and these teaching choices.'}:statement):statements,
    can_publish:chosen,publications:publication?[publication]:[]};
};
const noPublish=()=>assert.equal(requests.filter(request=>request.op==='publish').length,0,'nothing publishes before the explicit action');
const check=name=>{assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);checks.push(name);console.log(`ok ${checks.length} - ${name}`);};
try{
  server=createServer(async(req,res)=>{
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    try{
      const url=new URL(req.url,'http://fixture');
      if(url.pathname==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(js);}
      if(url.pathname==='/fixture.css'){res.setHeader('Content-Type','text/css; charset=utf-8');return res.end(css);}
      if(!url.pathname.startsWith('/api/')){
        res.setHeader('Content-Type','text/html; charset=utf-8');
        return res.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}main{max-width:780px;margin:24px auto;padding:0 12px}#profile-callback-count{display:block;margin-top:16px;font-family:system-ui}</style><div id="root"></div><script src="/fixture.js"></script>');
      }
      let raw='';for await(const chunk of req)raw+=chunk;
      const input=raw?JSON.parse(raw):Object.fromEntries(url.searchParams);
      requests.push({path:url.pathname,method:req.method,op:input.op,input});
      if(url.pathname==='/api/replica-text-publication'){
        assert.equal(req.headers.authorization,`Bearer ${TOKEN}`);
        assert.equal(input.replica_id,RID);
        if(input.op==='readiness'&&req.method==='GET')return send(200,{readiness:readiness(input)});
        if(input.op==='publish'&&req.method==='POST'){
          assert.equal(teacher,false);assert.equal(publication,null,'one publish per ceremony');
          assert.equal(input.sheet_id,SID);assert.equal(input.context_item_id,IID);
          assert.equal(input.statement_set,personStatementSet);assert.equal(input.expected_review_hash,reviewHash);
          assert.deepEqual(input.attestations,Object.fromEntries(statements.map(statement=>[statement.id,true])));
          publication={public_id:input.publication_id,replica_id:RID,version:1,state:'active',title:projection.name,
            subject_domain:null,disclosure:'AI text using material released by the publishing account. Real-world identity and voice are unverified.',
            disclosure_hash:'a'.repeat(64),terms,created_at:'2026-10-09T00:00:00Z',expires_at:'2026-11-08T00:00:00Z',can_text:true,can_voice:false};
          return send(201,{publication});
        }
      }
      if(url.pathname==='/api/text-publication'&&input.op==='open'&&publication?.public_id===input.public_id)return send(200,{publication});
      unexpected.push(`${req.method} ${url.pathname} ${input.op}`);return send(500,{error:'unexpected_fixture_request'});
    }catch(error){errors.push(`server: ${error.message}`);return send(500,{error:'fixture_assertion'});}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await launchSuiteBrowser('text-publication-person-profile-ui');
  const open=async(width,{isTeacher=false,surface='expert'}={})=>{
    if(page)await page.context().close();
    teacher=isTeacher;publication=null;requests=[];
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
    page=await context.newPage();page.setDefaultTimeout(boundedWaitMs(12000));
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>{
      if(new URL(route.request().url()).origin===origin)return route.continue();
      blockedExternal.push(route.request().url());return route.abort();
    });
    await page.goto(origin+'/studio?'+new URLSearchParams({surface}));
    await page.getByRole('combobox',{name:isTeacher?'Teaching profile':'Profile',exact:true}).waitFor();
  };
  const selectProfile=async(id)=>{
    const response=page.waitForResponse(response=>{
      const url=new URL(response.url());return url.pathname==='/api/replica-text-publication'&&url.searchParams.get('sheet_id')===id;
    });
    await page.getByRole('combobox',{name:teacher?'Teaching profile':'Profile',exact:true}).selectOption(id);await response;
  };
  for(const width of [390,1440]){
    await open(width);await selectProfile(INVALID_SID);
    await page.getByText('Your personal profile needs a name and a saved description of who you are.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Review teaching profile',exact:true}).count(),0);
    assert.equal(await page.locator('a[href*="mode=teacher"]').count(),0);
    assert.equal(await page.getByRole('button',{name:'Publish link',exact:true}).count(),0);noPublish();
    check(`${width} invalid person in actual ExpertSharePanel has personal recovery and no teacher-mode link`);

    const recovery=page.getByRole('button',{name:'Review personal profile',exact:true});
    for(let steps=0;steps<12&&!await recovery.evaluate(element=>element===document.activeElement);steps++)await page.keyboard.press('Tab');
    assert(await recovery.evaluate(element=>element===document.activeElement),'personal recovery reached by Tab');
    await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#profile-callback-count')?.textContent==='1');
    assert.equal(new URL(page.url()).searchParams.get('mode'),null);noPublish();
    check(`${width} keyboard recovery invokes onOpenProfile through actual no-voice ExpertSharePanel`);

    await open(width,{surface:'fallback'});await selectProfile(INVALID_SID);
    const fallback=page.getByRole('link',{name:'Review personal profile',exact:true});await fallback.waitFor();
    const target=new URL(await fallback.getAttribute('href'),origin);
    assert.equal(target.pathname,'/studio');assert.equal(target.searchParams.get('replica'),RID);
    assert.equal(target.searchParams.get('view'),'enrich');assert.equal(target.searchParams.get('enrichView'),'humanos');
    assert.equal(target.searchParams.get('mode'),null);noPublish();
    check(`${width} standalone personal recovery fallback preserves personal workspace routing`);

    await open(width,{isTeacher:true});
    assert.equal(await page.getByRole('combobox',{name:'Profile',exact:true}).count(),0);
    assert.equal(await page.getByRole('combobox',{name:'Teaching profile',exact:true}).count(),1);noPublish();
    check(`${width} all-teacher choices retain Teaching profile label`);

    await open(width);await selectProfile(SID);
    await page.getByRole('combobox',{name:'Material',exact:true}).selectOption(IID);
    await page.getByRole('heading',{name:'Review what you will share',exact:true}).waitFor();
    const publish=page.getByRole('button',{name:'Publish link',exact:true});assert(await publish.isDisabled());noPublish();
    assert.equal(requests.some(request=>/voice|liveness|runtime/.test(request.path)),false);
    check(`${width} saved person and material reach publication review without voice prerequisites`);

    await page.getByText('garden-notes.txt',{exact:true}).last().click();
    assert(await page.getByText(material,{exact:true}).isVisible());
    await page.getByText('Personal profile to share',{exact:true}).click();
    const details=page.locator('.vp-review details').filter({has:page.locator('summary', {hasText:'Personal profile to share'})});
    assert(await details.getByText('Every field below will be available to visitors. Remove anything you want to keep private before publishing.',{exact:true}).isVisible());
    const fields={Name:projection.name,'Who you are':projection.identityWho,'Your life':projection.identityLife,
      'Everyday details':projection.lifeTexture,'What you enjoy':projection.tasteTopics,'What you are curious about':projection.curiosityTopics,
      Introduction:projection.personLine,Values:projection.personValues.join(', '),
      Boundaries:projection.personNeverSay.join(', '),
      'How you talk':'Tone: Mixed; Language: Hinglish in Roman script; Language habits: Keep Hindi phrases in Roman letters.'};
    assert.equal(await details.locator('dl > div').count(),Object.keys(fields).length);
    for(const [label,value] of Object.entries(fields)){
      const row=details.locator('dl > div').filter({has:page.locator('dt').getByText(label,{exact:true})});
      assert.equal(await row.count(),1,`projected field ${label} present`);
      assert(await row.locator('dd').isVisible(),`projected field ${label} expanded`);
      assert.equal(await row.locator('dd').innerText(),value,`projected field ${label} readable`);
    }
    assert.equal((await details.innerText()).includes('[object Object]'),false);noPublish();
    check(`${width} expanded review displays every projected person field with readable personTalk`);

    await page.getByText('Access and limits',{exact:true}).click();
    assert(await page.getByText('Conversation memory is off.',{exact:true}).isVisible());
    assert(await page.getByText('Usage budget: up to $0.10. Voice is not enabled.',{exact:true}).isVisible());
    const permission=page.getByRole('group',{name:'Permission to publish',exact:true});
    assert.equal(await permission.getByRole('checkbox').count(),4);
    for(let index=0;index<statements.length;index++){
      await permission.getByLabel(statements[index].text,{exact:true}).check();
      assert.equal(await publish.isEnabled(),index===statements.length-1,'all four explicit permissions are required');noPublish();
    }
    const capture=join(out,`person-review-${width}.png`);
    await page.screenshot({path:capture,fullPage:true});captures.push(capture);
    check(`${width} four person-specific checks enable Publish link without dispatching`);

    await publish.click();await page.getByLabel('Share link',{exact:true}).waitFor();
    await page.getByText('Visitors can open this conversation.',{exact:true}).waitFor();
    assert.equal(requests.filter(request=>request.op==='publish').length,1);
    const link=new URL(await page.getByLabel('Share link',{exact:true}).inputValue());
    assert.equal(link.origin,origin);assert.equal(link.pathname,'/studio');
    assert.equal(link.searchParams.get('publication'),publication.public_id);assert.equal(link.searchParams.get('mode'),null);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(requests.some(request=>/voice|liveness|runtime/.test(request.path)),false);
    check(`${width} one explicit publish returns the studio publication link without voice calls or horizontal overflow`);
  }
  for(const [path,hash] of Object.entries(sourceHashes))assert.equal(digest(readFileSync(join(root,path))),hash,`${path} changed during browser proof`);
  assert.deepEqual(blockedExternal,[],'fixture initiates no external network');
  writeFileSync(join(out,'result.json'),JSON.stringify({at:new Date().toISOString(),passed:checks.length,checks,captures,
    sourceHashes,errors,unexpected,blockedExternal,
    scope:'Actual ExpertSharePanel and MaterialSharePanel using synthetic localhost HTTP at 390/1440. Keyboard callback propagation and standalone fallback routing; no real account, SQL, model, voice or cloud calls. One review screenshot per width.'},null,2));
  console.log(JSON.stringify({passed:checks.length,out,captures}));
}catch(error){
  const dom=page&&!page.isClosed()?await page.evaluate(()=>({text:document.body.innerText,url:location.href})).catch(()=>null):null;
  writeFileSync(join(out,'failure.json'),JSON.stringify({at:new Date().toISOString(),message:error.message,stack:error.stack,
    checks,sourceHashes,requests,errors,unexpected,blockedExternal,dom},null,2));throw error;
}finally{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
}
