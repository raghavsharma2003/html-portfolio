// Emits exact production SQL exports and type-valid inert parameters for a
// caller-owned read-only EXPLAIN. It opens no database or network connection.
import assert from 'node:assert/strict';
import {FEEDBACK_DATASET_BUILD_SQL,FEEDBACK_DATASET_REVIEW_SQL,FEEDBACK_DATASET_SCHEMA} from '../../api/_replica-feedback-dataset.js';
import {OWNED_FEEDBACK_LEARNING_EXAMPLE_SQL} from '../../api/_replica-feedback.js';
import {REPLICA_POLICY_VERSION} from '../../api/_replica.js';

const replica='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000002';
const dataset='30000000-0000-4000-8000-000000000003';
const capability='40000000-0000-4000-8000-000000000004';
const feedback='50000000-0000-4000-8000-000000000005';
const sha='a'.repeat(64);
const calls=[];
const capture=(name,sql,params)=>calls.push({name,sql,params});
capture('feedback_dataset_review',FEEDBACK_DATASET_REVIEW_SQL,[replica,owner,REPLICA_POLICY_VERSION]);
capture('feedback_dataset_build',FEEDBACK_DATASET_BUILD_SQL,[replica,owner,dataset,1,1,FEEDBACK_DATASET_SCHEMA,sha,'{}','[]','{}',REPLICA_POLICY_VERSION,'[]',capability]);
capture('owned_feedback_learning_example',OWNED_FEEDBACK_LEARNING_EXAMPLE_SQL,[feedback,owner]);
assert.equal(new Set(calls.map(call=>call.sql)).size,3);
console.log(JSON.stringify({contract:'vyakti.correction-learner-context-sql-explain-inputs.v1',calls},null,2));
