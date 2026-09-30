import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {loadConfig} from '../src/config.js';

const template = readFileSync(new URL('../infra/main.bicep', import.meta.url), 'utf8');

// Evaluate only the template's deliberately restricted boolean expressions.
// This checks source truth tables and actual environment references, not ARM
// execution. Bicep compilation and Azure validation are separate evidence.
function deployedFlag(source, envName, facts) {
  const mapping = source.match(new RegExp(`name: '${envName}', value: string\\((\\w+)\\)`));
  assert.ok(mapping, `${envName} must have one direct string value`);
  let expression = mapping[1];
  const variable = source.match(new RegExp(`^var ${expression} = (.+)$`, 'm'));
  if (variable) expression = variable[1];
  const tokens = expression.replace(/'[^']*'/g, "''").replace(/\b(?:faceLivenessEnabled|faceLivenessErasureEnabled|faceResourceDedicated|fail)\b/g, '');
  assert.match(tokens, /^[\s!&|()?:']*$/, 'only the tested boolean subset is accepted');
  const fn = new Function('faceLivenessEnabled','faceLivenessErasureEnabled','faceResourceDedicated','fail', `return (${expression});`);
  return fn(facts.enabled, facts.erasure, facts.dedicated, code => { throw new Error(code); });
}

test('Azure private container parameter reaches the exact runtime variable', () => {
  assert.match(template, /param privateSourceAzureContainer string = ''/);
  const mapping = "{ name: 'VYAKTI_PRIVATE_SOURCE_AZURE_CONTAINER', value: privateSourceAzureContainer }";
  const runtimeConfig = source => loadConfig({
    VYAKTI_PRIVATE_SOURCE_ORIGIN:'https://fixtureaccount.blob.core.windows.net',
    ...(source.includes(mapping) ? {VYAKTI_PRIVATE_SOURCE_AZURE_CONTAINER:'private-documents'} : {}),
    VYAKTI_BROKER_HMAC_KEY_B64:Buffer.alloc(32,7).toString('base64'),
    VERIFIER_VERSION:'identity-test-v1',
    AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT:'https://fixture.cognitiveservices.azure.com',
    AZURE_DOCUMENT_INTELLIGENCE_KEY:'synthetic',
    AZURE_FACE_ENDPOINT:'https://fixture.cognitiveservices.azure.com',AZURE_FACE_KEY:'synthetic',
    AZURE_DOCUMENT_REVIEW_ENDPOINT:'https://fixture.azurewebsites.net',
    AZURE_DOCUMENT_REVIEW_HMAC_KEY_B64:Buffer.alloc(32,8).toString('base64'),
    AZURE_DOCUMENT_REVIEW_VERSION:'review-test-v1',
  });
  assert.equal(runtimeConfig(template).sourceAzureContainer,'private-documents');
  assert.throws(()=>runtimeConfig(template.replace(mapping,'')),/source_container_required/);
});

for (const enabled of [false,true]) for (const erasure of [false,true]) for (const dedicated of [false,true]) {
  test(`deployed flags preserve creation/cleanup guards: ${enabled}/${erasure}/${dedicated}`, () => {
    const facts={enabled,erasure,dedicated};
    const evaluate=()=>[
      deployedFlag(template,'AZURE_FACE_LIVENESS_ENABLED',facts),
      deployedFlag(template,'AZURE_FACE_DEDICATED_RESOURCE',facts),
    ];
    if (enabled && !erasure) assert.throws(evaluate,/liveness_requires_erasure_plane/);
    else if ((enabled || erasure) && !dedicated) assert.throws(evaluate,/liveness_requires_dedicated_face_resource/);
    else assert.deepEqual(evaluate(),[enabled,dedicated]);
  });
}

test('guards must be consumed: mapping back to unguarded flags admits forbidden combinations', () => {
  const bypassCreation=template.replace('value: string(checkedFaceLivenessEnabled)', 'value: string(faceLivenessEnabled)');
  assert.equal(deployedFlag(bypassCreation,'AZURE_FACE_LIVENESS_ENABLED',{enabled:true,erasure:false,dedicated:true}),true);
  assert.throws(()=>deployedFlag(template,'AZURE_FACE_LIVENESS_ENABLED',{enabled:true,erasure:false,dedicated:true}));
  const bypassDedicated=template.replace('value: string(checkedFaceResourceDedicated)', 'value: string(faceResourceDedicated)');
  assert.equal(deployedFlag(bypassDedicated,'AZURE_FACE_DEDICATED_RESOURCE',{enabled:false,erasure:true,dedicated:false}),false);
  assert.throws(()=>deployedFlag(template,'AZURE_FACE_DEDICATED_RESOURCE',{enabled:false,erasure:true,dedicated:false}));
});

test('creation, cleanup and approval defaults stay false without experimental asserts', () => {
  for(const name of ['faceLivenessEnabled','faceLivenessErasureEnabled','faceLivenessLimitedAccessApproved','faceResourceDedicated']) {
    assert.match(template,new RegExp(`param ${name} bool = false`));
  }
  assert.doesNotMatch(template,/^assert\s/m);
});
