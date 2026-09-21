// CPU writers must reserve a bounded lease/output_write_not_after BEFORE an
// upload. The final locator is fixed at admission, so a lost upload receipt is
// still in the source erasure manifest. No owner content enters budget tables.
export function privateVoiceErasureFence(alias='s',source=true){
 if(!/^[a-z][a-z0-9_]*$/.test(alias))throw new Error('private_voice_sql_alias');
 return `not exists(select 1 from vy_private_voice_run pv left join vy_voice_app_lifecycle pvl using(window_id)
 left join vy_gpu_allocation_window pvw using(window_id) where pv.replica_id=${alias}.replica_id and pv.owner_user_id=${alias}.owner_user_id
 ${source?`and pv.source_id=${alias}.source_id`:''} and (pv.lease_expires_at>now() or pv.output_write_not_after>now()
 or (pv.window_id is not null and (pvl.state is distinct from 'terminal_observed' or pvw.resource_released_at is null))))`;
}
