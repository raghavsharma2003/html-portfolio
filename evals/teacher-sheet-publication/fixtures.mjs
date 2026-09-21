import {isDeepStrictEqual} from 'node:util';
import {PRIVATE_TEACHER_SHEET_READ_SQL,PRIVATE_TEACHER_SHEET_SAVE_SQL,BOUND_TEACHER_SHEET_READ_SQL,BOUND_TEACHER_SHEET_PUBLISH_SQL} from '../../api/_teacher-sheet-draft.js';
export const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',replica='33333333-3333-4333-8333-333333333333',agent='55555555-5555-4555-8555-555555555555',sheetId='66666666-6666-4666-8666-666666666666',consent='77777777-7777-4777-8777-777777777777';
export const row=(sheet,extra={})=>({sheet_id:sheetId,agent_id:agent,replica_id:replica,owner_user_id:owner,status:'draft',sheet,version:sheet.version,consent_artifact_id:consent,...extra});
export function fixture({agentId=null,rows=[],lifecycle='consent_pending',beforeSave=null,beforePublish=null,mutateSql=s=>s}={}) {
  const state={owner,agentId,rows:structuredClone(rows),lifecycle,calls:[]};
  const scoped=(s)=>s.replica_id===replica && s.owner_user_id===state.owner &&
    (s.agent_id===null || s.agent_id===state.agentId);
  const legacy=(s)=>s.replica_id==null && s.owner_user_id==null &&
    state.agentId!==null && s.agent_id===state.agentId;
  const db=async(raw,params)=>{
    const sql=mutateSql(raw);state.calls.push({sql,params});
    if(raw===PRIVATE_TEACHER_SHEET_SAVE_SQL && beforeSave)beforeSave(state);
    if(raw===BOUND_TEACHER_SHEET_PUBLISH_SQL && beforePublish)beforePublish(state);
    const owned=params[0]===replica && (params[1]===state.owner || !sql.includes('r.owner_user_id = $2::uuid')) &&
      (!sql.includes("r.lifecycle not in ('revoked','purging')") || !['revoked','purging'].includes(state.lifecycle));
    if(!owned)return [];
    if(raw.includes('select r.replica_id, r.agent_id'))return [{replica_id:replica,agent_id:state.agentId}];
    if(raw===PRIVATE_TEACHER_SHEET_READ_SQL)return state.rows.filter(s=>scoped(s)||legacy(s)).slice(-1).reverse();
    if(raw===PRIVATE_TEACHER_SHEET_SAVE_SQL){
      const editable=s=>sql.includes("s.status in ('draft','validated')") ? ['draft','validated'].includes(s.status) : s.status!=='published';
      let row=state.rows.filter(s=>(scoped(s)||legacy(s))&&editable(s)).at(-1);
      if(!row){row={sheet_id:params[4],agent_id:state.agentId,replica_id:replica,owner_user_id:state.owner,created_at:'2026-09-07T00:00:00Z',consent_artifact_id:null,published_at:null};state.rows.push(row);}
      Object.assign(row,{sheet:JSON.parse(params[2]),version:params[3],status:'draft',replica_id:replica,owner_user_id:state.owner,updated_at:'2026-09-07T00:00:01Z'});
      return [structuredClone(row)];
    }
    if(raw===BOUND_TEACHER_SHEET_READ_SQL)return state.rows.filter(s=>
      state.agentId!==null && s.agent_id===state.agentId && s.status!=='revoked' &&
      (!sql.includes('s.replica_id = r.replica_id') || scoped(s)||legacy(s))).slice(-1).reverse();
    if(raw===BOUND_TEACHER_SHEET_PUBLISH_SQL){
      const allowed=s=>!sql.includes('s.replica_id = o.replica_id')||scoped(s)||legacy(s);
      const snapshot=s=>(!sql.includes('s.sheet = $4::jsonb')||isDeepStrictEqual(s.sheet,JSON.parse(params[3])))&&
        (!sql.includes('s.status = $5::text')||s.status===params[4])&&
        (!sql.includes('s.consent_artifact_id = $6::uuid')||s.consent_artifact_id===params[5])&&
        (!sql.includes('s.version = $7::text')||s.version===params[6]);
      const target=state.rows.find(s=>s.sheet_id===params[2]&&s.agent_id===state.agentId&&state.agentId!==null&&s.status!=='revoked'&&s.consent_artifact_id&&allowed(s)&&snapshot(s));
      if(!target)return [];
      for(const s of state.rows)if(s!==target&&s.agent_id===state.agentId&&s.status==='published'&&allowed(s))s.status='validated';
      target.status='published';target.published_at='2026-09-07T00:00:02Z';return [structuredClone(target)];
    }
    throw new Error('Unexpected SQL in fixture');
  };
  return {db,state};
}
