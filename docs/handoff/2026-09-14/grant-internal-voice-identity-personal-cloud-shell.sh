#!/usr/bin/env bash
# Run ONLY in Azure Cloud Shell Bash on your personal device.
# Do not sign in to personal Microsoft accounts on the employer laptop.
# Requires permission to create this custom role and assign it at this resource.
# Grants no permissions to the existing operator service principal. Starts no app.
set -euo pipefail

export VOICE_SUB='c60a32f6-c812-4c0e-bc42-b6431ee90b8f'
export VOICE_TENANT='e4eba489-3b57-4e50-8d1b-49e060817dc9'
export VOICE_GPU="/subscriptions/${VOICE_SUB}/resourceGroups/vyakti-voice/providers/Microsoft.App/containerApps/vyakti-open-voice-hi"
export VOICE_IDENTITY="/subscriptions/${VOICE_SUB}/resourceGroups/vyakti-voice/providers/Microsoft.ManagedIdentity/userAssignedIdentities/vyakti-internal-voice25-id"
export VOICE_PRINCIPAL='e0e22b20-1f94-4480-812a-1ac9a84dc51e'
export VOICE_CLIENT='93535d5d-d17f-424e-bbfe-2340a53e8c13'
export VOICE_ROLE="/subscriptions/${VOICE_SUB}/providers/Microsoft.Authorization/roleDefinitions/b9ee16fd-4ff7-5d8d-825e-fe5c7593c1c6"
export VOICE_ASSIGNMENT="${VOICE_GPU}/providers/Microsoft.Authorization/roleAssignments/8cb12aaa-d543-5276-90cb-199f8a535b5c"
VOICE_TMP="$(mktemp -d)"
export VOICE_TMP
trap 'rm -rf -- "$VOICE_TMP"' EXIT

az account set --subscription "$VOICE_SUB"
test "$(az account show --query tenantId --output tsv)" = "$VOICE_TENANT"
az identity show --ids "$VOICE_IDENTITY" --output json > "$VOICE_TMP/identity.json"
python3 - <<'PY'
import json, os, pathlib
p=pathlib.Path(os.environ['VOICE_TMP'])
identity=json.loads((p/'identity.json').read_text())
assert identity['id'].lower()==os.environ['VOICE_IDENTITY'].lower(), 'Identity resource changed'
assert identity['principalId']==os.environ['VOICE_PRINCIPAL'], 'Identity principal changed'
assert identity['clientId']==os.environ['VOICE_CLIENT'], 'Identity client changed'
assert identity['tenantId']==os.environ['VOICE_TENANT'], 'Identity tenant changed'
role={'properties': {'roleName':'Vyakti Internal Voice Revision Operator 25',
 'description':'Exact dormant Hindi revision read and activate/deactivate for internal owner voice test.',
 'type':'CustomRole','permissions':[{'actions':[
  'Microsoft.App/containerApps/read',
  'Microsoft.App/containerApps/revisions/read',
  'Microsoft.App/containerApps/revisions/replicas/read',
  'Microsoft.App/containerApps/revisions/activate/action',
  'Microsoft.App/containerApps/revisions/deactivate/action'],
  'notActions':[],'dataActions':[],'notDataActions':[]}],
 'assignableScopes':[os.environ['VOICE_GPU']]}}
assignment={'properties': {'roleDefinitionId':os.environ['VOICE_ROLE'],
 'principalId':os.environ['VOICE_PRINCIPAL'],'principalType':'ServicePrincipal'}}
(p/'role.json').write_text(json.dumps(role))
(p/'assignment.json').write_text(json.dumps(assignment))
PY

# Refuse inaccessible or conflicting resources; never overwrite an existing grant.
read_optional() {
  local url="$1" output="$2"
  if az rest --method get --url "$url" --output json > "$output" 2> "$VOICE_TMP/read-error.txt"; then
    return 0
  fi
  if grep -Eq 'RoleDefinitionDoesNotExist|RoleAssignmentDoesNotExist|RoleAssignmentNotFound|ResourceNotFound|\(NotFound\)' "$VOICE_TMP/read-error.txt"; then
    return 1
  fi
  cat "$VOICE_TMP/read-error.txt" >&2
  exit 1
}
ROLE_URL="https://management.azure.com${VOICE_ROLE}?api-version=2022-04-01"
ASSIGNMENT_URL="https://management.azure.com${VOICE_ASSIGNMENT}?api-version=2022-04-01"

if read_optional "$ROLE_URL" "$VOICE_TMP/existing-role.json"; then
  python3 - <<'PY'
import json,os,pathlib
p=pathlib.Path(os.environ['VOICE_TMP']); actual=json.loads((p/'existing-role.json').read_text())['properties']; expected=json.loads((p/'role.json').read_text())['properties']
assert all(actual.get(k)==v for k,v in expected.items()), 'Existing role differs; stopped without changing it'
PY
else
  az rest --method put --url "$ROLE_URL" --body "@$VOICE_TMP/role.json" --output none
fi

if read_optional "$ASSIGNMENT_URL" "$VOICE_TMP/existing-assignment.json"; then
  python3 - <<'PY'
import json,os,pathlib
p=pathlib.Path(os.environ['VOICE_TMP']); actual=json.loads((p/'existing-assignment.json').read_text())['properties']
assert actual['principalId']==os.environ['VOICE_PRINCIPAL'], 'Existing assignment principal differs'
assert actual['roleDefinitionId'].lower()==os.environ['VOICE_ROLE'].lower(), 'Existing assignment role differs'
assert actual['scope'].lower()==os.environ['VOICE_GPU'].lower(), 'Existing assignment scope differs'
assert not actual.get('condition'), 'Existing conditional assignment requires inspection'
PY
else
  az rest --method put --url "$ASSIGNMENT_URL" --body "@$VOICE_TMP/assignment.json" --output none
fi

az rest --method get --url "$ROLE_URL" --output json > "$VOICE_TMP/existing-role.json"
az rest --method get --url "$ASSIGNMENT_URL" --output json > "$VOICE_TMP/existing-assignment.json"
python3 - <<'PY'
import json,os,pathlib
p=pathlib.Path(os.environ['VOICE_TMP']);role=json.loads((p/'existing-role.json').read_text())['properties'];expected=json.loads((p/'role.json').read_text())['properties'];assignment=json.loads((p/'existing-assignment.json').read_text())['properties']
assert all(role.get(k)==v for k,v in expected.items()), 'Role readback differs'
assert assignment['principalId']==os.environ['VOICE_PRINCIPAL'], 'Principal readback differs'
assert assignment['roleDefinitionId'].lower()==os.environ['VOICE_ROLE'].lower(), 'Role assignment readback differs'
assert assignment['scope'].lower()==os.environ['VOICE_GPU'].lower() and not assignment.get('condition'), 'Scope readback differs'
print('Verified: dedicated identity has the five specified actions only at the Hindi GPU resource.')
print('No Container App was created, activated, warmed or changed by this script.')
PY
