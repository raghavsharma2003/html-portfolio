// Authored source controls. Run only after the parent releases the browser/CPU lane.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {build} from 'vite';
import {chromium} from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url));
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const replica = id(1), candidate = id(2), base = id(3), next = id(4), qualification = id(5);
const valid = () => ({replica_id: replica, candidate_id: candidate, active_capability_id: base,
  current_candidate_id: null, can_activate: true, qualification_id: qualification,
  can_experiment: false, experimental_qualification_id: null, selection_kind: 'baseline',
  can_reset:false,reset_target_capability_id:null,
  rollback_target_capability_id: null, can_rollback: false, blockers: []});
const entry = join(root, '__candidate_activation_fixture__.tsx');
const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import CandidateActivationAction,{parseCandidateActivationStatus} from './src/studio/CandidateActivationAction';
import PrivateSelectionRecovery,{parsePrivateSelectionRecovery} from './src/studio/PrivateSelectionRecovery';
window.parseActivation=(row)=>parseCandidateActivationStatus(row,'${replica}','${candidate}');
window.parseRecovery=(row)=>parsePrivateSelectionRecovery(row,'${replica}');
window.runtimeChanges=[];window.addEventListener('vyakti:private-runtime-changed',event=>window.runtimeChanges.push(event.detail));
function Fixture(){const[token,setToken]=useState('a');const[recovery,setRecovery]=useState(false);return <main><button onClick={()=>setToken('b')}>Switch account</button>
<button onClick={()=>setRecovery(true)}>Show erased candidate recovery</button>
{recovery?<PrivateSelectionRecovery token={token} replicaId="${replica}" onAuthError={()=>{}}/>:
<CandidateActivationAction token={token} replicaId="${replica}" candidateId="${candidate}" onAuthError={()=>{window.authErrors=(window.authErrors||0)+1}}/>}</main>}
createRoot(document.getElementById('root')!).render(<Fixture/>);`;
const bundle = await build({root, configFile: false, logLevel: 'silent', build: {write: false, minify: true,
  rolldownOptions: {input: entry, output: {entryFileNames: 'fixture.js'}}},
  plugins: [{name: 'activation-fixture', resolveId(value) {if (value === entry) return entry;}, load(value) {if (value === entry) return source;}}]});
const assets = new Map(bundle.output.map(item => ['/' + item.fileName, item.type === 'chunk' ? item.code : item.source]));
let row = valid(), calls = [], mode = '', pending = null;
const recoveryInitial=()=>({replica_id:replica,candidate_id:null,active_capability_id:next,can_reset:true,reset_target_capability_id:base});
let recoveryRow=recoveryInitial();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture.invalid');
  const json = value => {res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(value));};
  if (url.pathname === '/api/replica-candidate-activation') {
    assert.equal(req.method, 'POST'); let text = ''; for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); calls.push({body, auth: req.headers.authorization});
    assert.equal(body.replica_id, replica);
    if(!Object.hasOwn(body,'candidate_id')){
      assert(['status','reset'].includes(body.op));
      if(body.op==='status')return json(req.headers.authorization==='Bearer b'?{...recoveryRow,can_reset:false}:recoveryRow);
      assert.deepEqual(body,{op:'reset',replica_id:replica,expected_capability_id:next,target_capability_id:base});
      recoveryRow={...recoveryInitial(),active_capability_id:id(6),can_reset:false,reset_target_capability_id:null};
      if(mode==='uncertain'){res.writeHead(200,{'content-type':'application/json'});res.end('{');return;}
      return json(recoveryRow);
    }
    assert.equal(body.candidate_id, candidate);
    if (req.headers.authorization === 'Bearer b') return json({...valid(), can_activate: false, blockers: ['qualification_required']});
    if (body.op === 'status') return json(row);
    if (mode === 'selection-conflict' || mode === 'database-error') {
      res.writeHead(mode === 'selection-conflict' ? 409 : 500, {'content-type': 'application/json'});
      res.end(JSON.stringify({error: mode === 'selection-conflict' ? 'candidate_selection_changed' : 'replica_candidate_activation_failure'})); return;
    }
    const finish = () => {
      if (body.op === 'activate' || body.op === 'experiment') {
        assert.equal(body.expected_capability_id, base); assert.equal(body.qualification_id, qualification);
        row = {...valid(), active_capability_id: next, current_candidate_id: candidate, can_activate: false,
          selection_kind: body.op === 'experiment' ? 'experimental' : 'qualified',
          rollback_target_capability_id: base, can_rollback: true};
      } else if(body.op==='reset') {
        assert.equal(body.expected_capability_id,next);assert.equal(body.target_capability_id,base);
        assert.equal(Object.hasOwn(body,'qualification_id'),false);
        row={...valid(),active_capability_id:id(6),can_activate:false};
      } else {
        assert.equal(body.op, 'rollback'); assert.equal(body.expected_capability_id, next);
        assert.equal(body.target_capability_id, base); row = valid();
      }
      if (mode === 'uncertain') {res.writeHead(200, {'content-type': 'application/json'}); res.end('{');}
      else json(row);
    };
    if (mode === 'hold') {pending = finish; return;} finish(); return;
  }
  if (assets.has(url.pathname)) {res.writeHead(200, {'content-type': 'text/javascript'}); res.end(assets.get(url.pathname)); return;}
  res.writeHead(200, {'content-type': 'text/html'});
  res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px system-ui}main{max-width:760px;margin:auto;padding:24px}button{font:inherit;padding:10px 16px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser; const checks = [];
try {
  browser = await chromium.launch({headless: true});
  for (const width of [390, 1440]) {
    row = valid(); calls = []; mode = ''; pending = null;
    const page = await browser.newPage({viewport: {width, height: 900}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const activate = page.getByRole('button', {name: 'Use this version privately', exact: true});
    await page.getByText('This version passed the checks for private conversations.', {exact: true}).waitFor();
    assert.deepEqual(calls.map(item => item.body.op), ['status']);
    assert.deepEqual(await page.evaluate(() => window.runtimeChanges), []);
    const negatives = [null, {...valid(), replica_id: id(9)}, {...valid(), candidate_id: id(9)},
      {...valid(), qualification_id: null}, {...valid(), blockers: ['qualification_required']},
      {...valid(), can_activate: 'true'}, {...valid(), active_capability_id: 'invalid'},
      {...valid(), can_rollback: true}, {...valid(), current_candidate_id: candidate},
      {...valid(), blockers: ['Untrusted sentence from server']}, {...valid(), can_experiment: 'true'},
      {...valid(), can_experiment: true, experimental_qualification_id: null}, {...valid(), selection_kind: 'passed'},
      {...valid(),can_reset:true},{...valid(),can_reset:true,reset_target_capability_id:base},{...valid(),can_reset:'true'}];
    assert.equal(await page.evaluate(values => values.every(value => {try {window.parseActivation(value); return false;} catch {return true;}}), negatives), true);
    mode = 'hold'; await activate.click(); assert.equal(await activate.isDisabled(), true);
    assert.equal(calls.filter(item => item.body.op === 'activate').length, 1);
    pending(); pending = null; mode = '';
    await page.getByText('This version is selected for new private conversations.', {exact: true}).waitFor();
    assert.deepEqual(calls.map(item => item.body.op), ['status', 'activate', 'status']);
    assert.deepEqual(await page.evaluate(() => window.runtimeChanges), [{replica_id: replica, capability_id: next}]);
    await page.getByRole('button', {name: 'Restore previous version', exact: true}).click();
    await page.getByText('This version passed the checks for private conversations.', {exact: true}).waitFor();
    assert.deepEqual(calls.map(item => item.body.op), ['status', 'activate', 'status', 'rollback', 'status']);
    assert.deepEqual(await page.evaluate(() => window.runtimeChanges), [{replica_id: replica, capability_id: next}, {replica_id: replica, capability_id: base}]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    checks.push(`${width}: parser negative controls, explicit activation and rollback, fresh read, pending lock, no overflow`);

    mode = 'uncertain'; await activate.click();
    await page.getByRole('alert').waitFor(); assert.equal(await activate.isDisabled(), true);
    assert.equal(calls.filter(item => item.body.op === 'activate').length, 2);
    assert.equal(await page.evaluate(() => window.runtimeChanges.length), 2);
    mode = ''; await page.getByRole('button', {name: 'Check version status', exact: true}).click();
    await page.getByText('This version is selected for new private conversations.', {exact: true}).waitFor();
    assert.equal(calls.filter(item => item.body.op === 'activate').length, 2);
    checks.push(`${width}: ambiguous mutation requires explicit status recovery without resubmission`);
    assert.deepEqual((await page.evaluate(() => window.runtimeChanges)).at(-1), {replica_id: replica, capability_id: next});

    row = {...valid(), can_activate: false, qualification_id: null, can_experiment: true,
      experimental_qualification_id: qualification, blockers: ['qualification_inconclusive']};
    await page.reload();
    const experiment = page.getByRole('button', {name: 'Try this version privately', exact: true});
    await experiment.waitFor(); assert.equal(await activate.isDisabled(), true);
    assert.equal(calls.filter(item => item.body.op === 'experiment').length, 0);
    await experiment.click(); await page.getByText('Private text experiment', {exact: true}).waitFor();
    assert.equal(calls.filter(item => item.body.op === 'experiment').length, 1);
    assert.deepEqual(await page.evaluate(() => window.runtimeChanges), [{replica_id: replica, capability_id: next}]);
    assert.equal(await activate.isDisabled(), true);
    assert.equal(await page.getByText('This version passed the checks for private conversations.', {exact: true}).count(), 0);
    checks.push(`${width}: explicit private experiment never upgrades qualification or silently starts`);

    for (const language of ['en', 'hi']) {
      row=valid();mode='selection-conflict';await page.goto(`http://127.0.0.1:${server.address().port}/?lang=${language}`);
      await page.getByText('This version passed the checks for private conversations.',{exact:true}).waitFor();
      const beforeConflict=calls.length;await activate.click();
      await page.getByText(language==='hi'?'आपका चयन बदल गया है। ताज़ा स्थिति देखें।':'Your selection changed. Check the latest status.',{exact:true}).waitFor();
      assert.equal(await activate.isDisabled(),true);assert.equal(calls.length,beforeConflict+1);
      assert.deepEqual(await page.evaluate(()=>window.runtimeChanges),[]);
      mode='';await page.getByRole('button',{name:'Check version status',exact:true}).click();
      await page.getByText('This version passed the checks for private conversations.',{exact:true}).waitFor();
      assert.equal(calls.length,beforeConflict+2);assert.equal(calls.at(-1).body.op,'status');
    }
    mode='database-error';await activate.click();
    await page.getByText('The change is unconfirmed. Check status before continuing.',{exact:true}).waitFor();
    assert.equal(await activate.isDisabled(),true);
    checks.push(`${width}: exact409 selection conflict has English/Hindi review copy and explicit read-only recovery; other failures remain unconfirmed`);

    for(const language of ['en','hi']){
      row={...valid(),active_capability_id:next,current_candidate_id:candidate,selection_kind:'experimental',can_activate:false,
        can_reset:true,reset_target_capability_id:base,blockers:['private_selection_unavailable']};mode='';
      await page.goto(`http://127.0.0.1:${server.address().port}/?lang=${language}`);
      const reset=page.getByRole('button',{name:language==='hi'?'मौजूदा AI इस्तेमाल करें':'Use current AI',exact:true});
      await reset.waitFor();const resetBefore=calls.filter(item=>item.body.op==='reset').length;
      await reset.click();await page.getByText('This version needs more checks before private use.',{exact:true}).waitFor();
      assert.equal(calls.filter(item=>item.body.op==='reset').length,resetBefore+1);
      assert.deepEqual(await page.evaluate(()=>window.runtimeChanges),[{replica_id:replica,capability_id:id(6)}]);
    }
    checks.push(`${width}: explicit current-AI recovery binds previous selection and global target without qualification; creates fresh private baseline`);

    row = valid(); await page.reload();
    await page.getByText('This version passed the checks for private conversations.', {exact: true}).waitFor();
    mode = 'hold'; await activate.click(); await page.getByRole('button', {name: 'Switch account'}).click();
    await page.getByText('This version needs more checks before private use.', {exact: true}).waitFor();
    pending(); pending = null; mode = '';
    // Let the old response be consumed before observing current scoped state.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await activate.isDisabled(), true);
    assert.equal(await page.getByText('This version is selected for new private conversations.', {exact: true}).count(), 0);
    assert.deepEqual(errors, []); checks.push(`${width}: late previous-account mutation cannot restore authority`);
    mode='';recoveryRow=recoveryInitial();await page.goto(`http://127.0.0.1:${server.address().port}/?lang=en`);
    await page.getByRole('button',{name:'Show erased candidate recovery',exact:true}).click();
    const recovery=page.getByRole('button',{name:'Use current AI',exact:true});
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='Use current AI'&&!el.disabled));
    const beforeRecovery=calls.length;
    assert.deepEqual(calls.at(-1).body,{op:'status',replica_id:replica});
    assert.equal(await page.evaluate(values=>values.every(value=>{try{window.parseRecovery(value);return false;}catch{return true;}}),
      [{...recoveryInitial(),candidate_id:candidate},{...recoveryInitial(),replica_id:candidate},{...recoveryInitial(),reset_target_capability_id:null}]),true);
    mode='uncertain';await recovery.click();await page.getByText('Recovery is unconfirmed. Check status before continuing.',{exact:true}).waitFor();
    assert.equal(await recovery.isDisabled(),true);assert.equal(calls.length,beforeRecovery+1);
    mode='';await page.getByRole('button',{name:'Check recovery status',exact:true}).click();
    await page.waitForFunction(()=>window.runtimeChanges.length===1);
    assert.deepEqual(calls.at(-1).body,{op:'status',replica_id:replica});
    assert.deepEqual(await page.evaluate(()=>window.runtimeChanges),[{replica_id:replica,capability_id:id(6)}]);
    assert.equal(calls.length,beforeRecovery+2);
    checks.push(`${width}: erased-candidate recovery omits candidate, validates null receipt and recovers uncertain reset without repeating it`);
    await page.close();
  }
  console.log(JSON.stringify({status: 'PASS', checks, provider_calls: 0, actual_sql: false}));
} finally {await browser?.close(); await new Promise(resolve => server.close(resolve));}
