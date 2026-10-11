import assert from 'node:assert/strict';
import {sliceUtf16Citation,utf16CitationQuoteSql} from '../api/_claim-extraction/citation-coordinates.js';
import {validateExtractionOutput} from '../api/_claim-extraction/contracts.js';
import {sha256Hex} from '../api/_provenance/contracts.js';
import {citationCoordinateCases,citationCoordinateProofStatements} from '../scripts/citation-coordinates184-proof-contract.mjs';

let groups=0;
const check=(name,run)=>{run();groups++;console.log(`PASS ${name}`);};
check('twenty fixed coordinate cases preserve exact UTF16 quotes and refuse invalid boundaries',()=>{
  for(const c of citationCoordinateCases) assert.equal(sliceUtf16Citation(c.text,c.start,c.end),c.expected,c.name);
});
check('old PostgreSQL character-index interpretation disagrees on actual emoji counterexamples',()=>{
  const before=citationCoordinateCases.find(c=>c.name==='emoji-before');
  assert.notEqual(Array.from(before.text).slice(before.start,before.end).join(''),before.expected);
  assert.ok(before.end>Array.from(before.text).length,'old end_char <= length(text) rejects this valid citation');
  const inside=citationCoordinateCases.find(c=>c.name==='emoji-only');
  assert.notEqual(Array.from(inside.text).slice(inside.start,inside.end).join(''),inside.expected);
});
check('all valid scalar-boundary spans match unchanged JavaScript offsets and byte hashes',()=>{
  for(const text of ['A🙂B','🙂किंतु','e\u0301👩‍🔬\n𝄞']){
    const boundaries=[0];let offset=0;for(const scalar of text){offset+=scalar.length;boundaries.push(offset);}
    for(const start of boundaries)for(const end of boundaries)if(end>start){
      const quote=sliceUtf16Citation(text,start,end);
      assert.equal(quote,text.slice(start,end));
      assert.equal(sha256Hex(quote),sha256Hex(text.slice(start,end)));
    }
  }
});
check('malformed text, fractional offsets and split pairs cannot become fabricated quotes',()=>{
  for(const text of ['a\ud800b','a\udc00b','a\u0000b'])assert.equal(sliceUtf16Citation(text,0,1),null);
  for(const start of [NaN,Infinity,0.5,'0',undefined])assert.equal(sliceUtf16Citation('abc',start,2),null);
  assert.equal(sliceUtf16Citation('🙂',0,1),null);assert.equal(sliceUtf16Citation('🙂',1,2),null);
});
check('actual extraction validator emits original UTF16 offsets for emoji and combining-mark quotes',()=>{
  const evidence_id='60000000-0000-4000-8000-000000000001',source_id='60000000-0000-4000-8000-000000000002';
  for(const c of citationCoordinateCases.filter(c=>c.expected&&c.expected.trim())){
    const result=validateExtractionOutput({claims:[{domain:'knowledge',key:'rate_law',body:'Rate depends on concentration.',
      origin:'observed',confidence:0.96,sensitive:false,valid_from:null,valid_to:null,
      citations:[{evidence_id,start_char:c.start,end_char:c.end,quote:c.expected,entailment:0.98}]}]},
      {spans:[{evidence_id,source_id,text:c.text,confidence:1}]});
    assert.equal(result.proposals.length,1,c.name);
    const cite=result.proposals[0].citations[0];
    assert.equal(cite.start_char,c.start,c.name);assert.equal(cite.end_char,c.end,c.name);
    assert.equal(cite.quote_hash,sha256Hex(c.expected),c.name);
  }
});
check('SQL proof inputs stay parameterized with exact expected values',()=>{
  const statements=citationCoordinateProofStatements();assert.equal(statements.length,20);
  for(const [i,statement] of statements.entries()){
    const c=citationCoordinateCases[i];assert.deepEqual(statement.params,[c.text,c.start,c.end]);
    assert.equal(statement.expected,c.expected);assert.equal(statement.sql,statements[0].sql);
    assert.ok(statement.sql.startsWith('select '));assert.ok(!statement.sql.includes('🙂'));
  }
});
check('SQL reconstruction checks both boundaries and retains character ordering',()=>{
  const sql=utf16CitationQuoteSql("e.value->>'text'",'cc.start_char','cc.end_char');
  for(const fragment of ['with ordinality','convert_to(citation_chars.piece, \'UTF8\')',
    'then 2 else 1','bool_or(citation_units.start_unit = (cc.start_char))',
    'bool_or(citation_units.end_unit = (cc.end_char))','order by citation_units.ordinal',
    'else null end'])assert.ok(sql.includes(fragment),fragment);
});
console.log(`${groups} offline citation-coordinate groups passed; JavaScript contract and SQL source only, no PostgreSQL execution.`);
