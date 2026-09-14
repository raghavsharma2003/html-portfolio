// Pure preparation: no SQL execution, provider call or filesystem mutation.
import {utf16CitationQuoteSql} from '../api/_claim-extraction/citation-coordinates.js';

export const citationCoordinateCases = Object.freeze([
  {name:'ascii', text:'rate is fixed', start:0, end:4, expected:'rate'},
  {name:'emoji-before', text:'🙂rate', start:2, end:6, expected:'rate'},
  {name:'emoji-inside', text:'A🙂B', start:0, end:4, expected:'A🙂B'},
  {name:'emoji-only', text:'A🙂B', start:1, end:3, expected:'🙂'},
  {name:'after-emoji', text:'A🙂B', start:3, end:4, expected:'B'},
  {name:'hindi-combining', text:'🙂किंतु', start:2, end:7, expected:'किंतु'},
  {name:'combining-subspan', text:'किंतु', start:1, end:3, expected:'िं'},
  {name:'decomposed-accent', text:'e\u0301x', start:0, end:2, expected:'e\u0301'},
  {name:'zwj-preserved', text:'👩‍🔬x', start:0, end:5, expected:'👩‍🔬'},
  {name:'whitespace-preserved', text:'a  b\nc', start:1, end:5, expected:'  b\n'},
  {name:'split-start', text:'A🙂B', start:2, end:4, expected:null},
  {name:'split-end', text:'A🙂B', start:0, end:2, expected:null},
  {name:'past-end', text:'🙂', start:0, end:3, expected:null},
  {name:'negative-start', text:'text', start:-1, end:2, expected:null},
  {name:'empty-span', text:'text', start:1, end:1, expected:null},
  {name:'reversed-span', text:'text', start:2, end:1, expected:null},
  {name:'empty-text', text:'', start:0, end:1, expected:null},
  {name:'null-text', text:null, start:0, end:1, expected:null},
  {name:'null-start', text:'text', start:null, end:2, expected:null},
  {name:'null-end', text:'text', start:0, end:null, expected:null},
]);

// EXPLAIN checks syntax/types only. Executing these read-only SELECTs would
// additionally test SQL semantics; neither has been run by this module.
export function citationCoordinateProofStatements() {
  const sql=`select ${utf16CitationQuoteSql('$1::text','$2::integer','$3::integer')} as quote`;
  return citationCoordinateCases.map(({name,text,start,end,expected}) => ({
    name, sql, params:[text,start,end], expected,
  }));
}
