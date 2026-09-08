// SQL assembly regression only. Actual PostgreSQL parsing remains a release gate.
import assert from 'node:assert/strict';
import {OWNED_RUNTIME_CONTEXT_SQL,OWNED_PRIVATE_RUNTIME_CONTEXT_SQL} from '../api/_replica-runtime.js';
import {ownerPrivateCapabilityAuthoritySql} from '../api/_replica-candidate-activation-authority.js';
import {DIALOGUE_AUTHORITY_SQL} from '../api/_replica-dialogue-authority.js';
import {PRIVATE_CONTINUITY_SQL,PRIVATE_CONTINUITY_SOURCES_SQL,continuityPredicate,privateContinuityPredicate} from '../api/_private-dialogue-continuity.js';
import {DIALOGUE_OPEN_SQL,DIALOGUE_HISTORY_SQL} from '../api/_replica-dialogue-history.js';
const needle="c.state='active'",fragment=ownerPrivateCapabilityAuthoritySql('c','r');
assert(fragment.includes("$'"),'production authority includes SQL regex end anchor');
const literalSplice=(source,part)=>{const i=source.indexOf(needle);assert(i>=0);return source.slice(0,i)+part+source.slice(i+needle.length);};
assert.equal(OWNED_PRIVATE_RUNTIME_CONTEXT_SQL,literalSplice(OWNED_RUNTIME_CONTEXT_SQL,fragment));
// Negative control reproduces the actual rejected156V3 mechanism using the
// production fragment: String.replace expands $' into the unmatched suffix.
assert.notEqual(OWNED_RUNTIME_CONTEXT_SQL.replace(needle,fragment),OWNED_PRIVATE_RUNTIME_CONTEXT_SQL);
const privateDialogue=literalSplice(DIALOGUE_AUTHORITY_SQL,fragment);
assert(DIALOGUE_OPEN_SQL.startsWith(`with authorized as materialized (${privateDialogue} for update of r)`));
const projection='c.capability_id,c.profile_version,c.calibration_version';
const projected=privateDialogue.replace(projection,projection+',r.lifecycle,r.subject_mode,r.policy_version,r.identity_expires_at,r.age_verified_at,r.identity_verified_at,r.liveness_verified_at');
for(const sql of [PRIVATE_CONTINUITY_SQL,PRIVATE_CONTINUITY_SOURCES_SQL])assert(sql.startsWith(`with authorized as materialized (${projected}),`));
for(const [r,c] of [['r','c'],['owner_context','selected_capability']]){
 const original=continuityPredicate('t.continuity_refs',r,c,'t.session_id'),marker=`${c}.state='active'`,i=original.indexOf(marker);
 const expected=original.slice(0,i)+ownerPrivateCapabilityAuthoritySql(c,r)+original.slice(i+marker.length);
 assert.equal(privateContinuityPredicate('t.continuity_refs',r,c,'t.session_id'),expected);
 assert.notEqual(original.replace(marker,ownerPrivateCapabilityAuthoritySql(c,r)),expected);
}
assert(DIALOGUE_HISTORY_SQL.includes(fragment));
assert(DIALOGUE_HISTORY_SQL.includes(ownerPrivateCapabilityAuthoritySql('current_cap','r')));
const anchored=(s)=>(s.match(/\$'/g)||[]).length;
// The history replacement contains exactly both private authority predicates;
// the additional candidate authority and continuity may add their own anchors.
assert(anchored(DIALOGUE_HISTORY_SQL)>=anchored(fragment)+anchored(ownerPrivateCapabilityAuthoritySql('current_cap','r')));
console.log('Private SQL literal regression passed: runtime, open, history, both continuity readers, and two predicate aliases; rejected string-replacement controls detected. No SQL executed.');
