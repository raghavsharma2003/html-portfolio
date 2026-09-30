// Synthetic development-only SQL integration. Never targets the production DB.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { q } from "../../api/_db.js";
import { dmRecall, roomRecall } from "../../api/_room.js";

const [database] = await q("select current_database() as name");
assert.equal(database.name, "vyakti_expert_integration_20260906", "isolated development database required");
const [cascade] = await q("select confdeltype from pg_constraint where conname='vy_fact_agent_fk' and conrelid='vy_fact'::regclass");
assert.equal(cascade?.confdeltype, "c", "synthetic cleanup requires the installed agent-to-fact cascade");
const people = [randomUUID(), randomUUID()];
const agents = [randomUUID(), randomUUID()];
const token = randomUUID();
const facts = [
  { person:people[0], agent:agents[0], body:`synthetic alpha ${token}` },
  { person:people[1], agent:agents[0], body:`synthetic beta ${token}` },
  { person:people[0], agent:agents[1], body:`synthetic gamma ${token}` },
];
const createdPeople = [];
const createdAgents = [];
let passed = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); passed += 1; };
const bodies = (rows) => rows.map(row=>row.body).sort();
try {
  for (const person of people) {
    await q("insert into vy_person(person_id) values($1::uuid)",[person]);
    createdPeople.push(person);
  }
  for (const agent of agents) {
    await q("insert into vy_agent(agent_id,slug,display_name,status) values($1::uuid,$2,'Synthetic isolation expert','active')",[agent,`synthetic-${agent}`]);
    createdAgents.push(agent);
  }
  for (const fact of facts) await q("insert into vy_fact(person_id,agent_id,kind,name,body,provenance,citations) values($1::uuid,$2::uuid,'user','synthetic isolation',$3,'authored','{}'::bigint[])",[fact.person,fact.agent,fact.body]);
  // Real domain reads: a swallowed SQL error cannot pass the positive controls.
  equal(bodies(await dmRecall(people[0],{agentId:agents[0]})),[facts[0].body]);
  equal(bodies(await dmRecall(people[1],{agentId:agents[0]})),[facts[1].body]);
  equal(bodies(await dmRecall(people[0],{agentId:agents[1]})),[facts[2].body]);
  equal(await dmRecall(people[1],{agentId:agents[1]}),[]);
  equal(await dmRecall(randomUUID(),{agentId:agents[0]}),[]);
  equal(await dmRecall(people[0],{agentId:randomUUID()}),[]);
  equal(await roomRecall(randomUUID(),people,{agentId:agents[0]}),[]);
  // The same person/agent returns the same authorized memory across repeated calls.
  equal(bodies(await dmRecall(people[0],{agentId:agents[0]})),[facts[0].body]);
} finally {
  // Delete only exact identities created by this invocation. The installed FK
  // cascade removes their facts; do not delete any rows by broad test-name match.
  await q("delete from vy_agent where agent_id=any($1::uuid[])",[createdAgents]);
  const [remainingFacts] = await q("select count(*)::int n from vy_fact where agent_id=any($1::uuid[])",[createdAgents]);
  assert.equal(remainingFacts.n,0,"agent cascade must remove every synthetic fact");
  await q("delete from vy_person where person_id=any($1::uuid[])",[createdPeople]);
  const [remaining] = await q("select (select count(*) from vy_agent where agent_id=any($1::uuid[]))::int agents,(select count(*) from vy_person where person_id=any($2::uuid[]))::int people",[createdAgents,createdPeople]);
  assert.equal(remaining.agents,0);assert.equal(remaining.people,0);
  console.log(JSON.stringify({cleanup:"complete",syntheticAgents:2,syntheticPeople:2,syntheticFacts:3,remainingCreatedRows:0}));
}
console.log(JSON.stringify({gate:"live-relational-isolation",checks:passed,state:"passed",scope:"development-only-real-domain-recall",providerCalls:0}));
