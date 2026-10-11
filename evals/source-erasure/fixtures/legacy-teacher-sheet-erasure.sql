with review_lock as materialized (
       select pg_try_advisory_xact_lock(hashtextextended($2::text || ':voice_genome_review',0)) acquired
     ), candidate as materialized (
       select s.source_id,s.replica_id,s.owner_user_id,s.erasure_attempts,
              coalesce(
                nullif(s.provenance->>'erasure_requested_at','')::timestamptz,
                (select min(a.at) from vy_replica_audit a
                  where a.replica_id=s.replica_id and a.owner_user_id=s.owner_user_id
                    and a.action='source.delete.request' and a.object_kind='source'
                    and a.object_id=s.source_id::text),
                s.updated_at
              )
                erasure_requested_at
         from vy_replica_source s cross join review_lock
        where review_lock.acquired and s.source_id=$1::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid
          and s.state='deleting' and s.erasure_lease_token_hash=$4
          and s.erasure_lease_expires_at>now()
          -- Recheck every provider authority under the completion row lock.
          -- The prefix sweep happened outside this transaction, so a receipt
          -- must not remove the final manifest if an authority was extended or
          -- an old-version writer became visible after the lease was issued.
          and coalesce(s.upload_authorization_expires_at,'-infinity'::timestamptz)<=now()
          and not exists (
            select 1 from vy_replica_source_storage_writer sw
             where sw.source_id=s.source_id and sw.replica_id=s.replica_id
               and sw.owner_user_id=s.owner_user_id and sw.state='active'
               and sw.storage_write_not_after>now()
          )
          and not exists (
            select 1 from vy_replica_liveness_challenge ch where ch.replica_id=s.replica_id
               and ch.owner_user_id=s.owner_user_id and ch.face_session_state in (
                 'issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting'
               )
           )
        for update
     ), affected_genomes as materialized (
       select g.version,g.source_set_hash
         from vy_replica_voice_genome g join candidate c on c.replica_id=g.replica_id
        where (g.definition#>'{references,source_ids}') ? c.source_id::text
     ), affected_profiles as materialized (
       select p.version,p.source_set_hash
         from vy_replica_profile p join candidate c on c.replica_id=p.replica_id
        where jsonb_path_exists(
          p.definition,'$.domains.*[*].source_ids[*] ? (@ == $source)',
          jsonb_build_object('source',to_jsonb(c.source_id::text))
        )
     ), target as materialized (
       select c.* from candidate c
        where not exists (
          select 1 from vy_replica_voice_profile vp
          join affected_genomes affected on affected.version=vp.genome_version
           where vp.replica_id=c.replica_id and vp.owner_user_id=c.owner_user_id
        )
     ), source_context_items as materialized (
       -- Capture the exact context handles before source deletion cascades
       -- through the item/text FKs. Ingest runs retain a text video_ref rather
       -- than an item FK, so that cascade alone cannot erase their quotations.
       select i.item_id,i.replica_id,i.owner_user_id
         from vy_context_item i join target t
           on i.source_id=t.source_id and i.replica_id=t.replica_id
          and i.owner_user_id=t.owner_user_id
        for update of i
     ), context_ingest_runs as (
       update vy_ingest_run r
          set stats='{}'::jsonb,proposed_delta='{}'::jsonb,proposed_delta_count=0,
              video_title='',failure_code='context_source_removed',
              status=case when r.status in ('applied','rejected') then r.status else 'rejected' end,
              approved_by_user_id=case when r.status in ('applied','rejected') then r.approved_by_user_id else $3::uuid end,
              decided_at=case when r.status in ('applied','rejected') then r.decided_at else now() end,
              updated_at=now()
         from source_context_items i
        where r.replica_id=i.replica_id and r.owner_user_id=i.owner_user_id
          and r.replica_id=$2::uuid and r.owner_user_id=$3::uuid
          and r.transcript_source='context_item' and r.video_ref='context:' || i.item_id::text
       returning r.run_id
     ), source_windows as materialized (
       -- vy_mirror_window.source_id is ON DELETE SET NULL for historical
       -- source-less calls. A source erasure must therefore capture the exact
       -- owner/replica/source window set before the source row disappears.
       -- Otherwise the FK keeps the transcript while destroying its erasure
       -- handle.
       select w.window_id,w.session_id,w.replica_id,w.owner_user_id,w.seq
         from vy_mirror_window w join target t
           on t.source_id=w.source_id and t.replica_id=w.replica_id
          and t.owner_user_id=w.owner_user_id
     ), source_turns as materialized (
       select tr.turn_id,tr.window_id,tr.session_id,tr.replica_id,tr.owner_user_id
         from vy_mirror_turn tr join source_windows w
           on w.window_id=tr.window_id and w.session_id=tr.session_id
          and w.replica_id=tr.replica_id and w.owner_user_id=tr.owner_user_id
     ), source_deltas as materialized (
       -- Mirror deltas cite window sequence numbers rather than a foreign key.
       -- Their citation/evidence JSON may contain transcript excerpts, so a
       -- source-bound delta must be found before its cited window is removed.
       select distinct d.delta_id,d.session_id,d.replica_id,d.owner_user_id,
              d.target_field,d.fragment,d.state,d.applied_at,d.applied_sheet_id
         from vy_mirror_delta d join source_windows w
           on w.session_id=d.session_id and w.replica_id=d.replica_id
          and w.owner_user_id=d.owner_user_id and w.seq=any(d.cited_windows)
     ), reversible_delta_fragments as materialized (
       -- Only an accepted delta that actually changed a sheet is reversed.
       -- Preserve a phrase when another still-cited accepted delta supports it.
       select distinct d.delta_id,d.replica_id,d.owner_user_id,d.target_field,d.fragment,
              d.applied_sheet_id
         from source_deltas d
        where d.state='accepted' and d.applied_at is not null and d.target_field<>''
          and not exists (
            select 1 from vy_mirror_delta support
             where support.replica_id=d.replica_id and support.owner_user_id=d.owner_user_id
               and support.delta_id<>d.delta_id and support.state='accepted'
               and support.applied_at is not null
               and support.target_field=d.target_field and support.fragment=d.fragment
               and not exists (select 1 from source_deltas erased where erased.delta_id=support.delta_id)
               and not exists (
                 select 1 from unnest(support.cited_windows) cited(seq)
                  where not exists (
                    select 1 from vy_mirror_window live
                     where live.session_id=support.session_id and live.replica_id=support.replica_id
                       and live.owner_user_id=support.owner_user_id and live.seq=cited.seq
                       and live.source_id is not null
                  )
               )
          )
     ), sheet_candidates as materialized (
       select s.sheet_id,s.sheet,s.status,
              exists (select 1 from reversible_delta_fragments f
                       where f.replica_id=t.replica_id and f.owner_user_id=t.owner_user_id
                         and f.target_field='boardVerbalisms'
                         and (f.applied_sheet_id=s.sheet_id or f.applied_sheet_id is null)) remove_board,
              exists (select 1 from reversible_delta_fragments f
                       where f.replica_id=t.replica_id and f.owner_user_id=t.owner_user_id
                         and f.target_field='exSlangRepeat'
                         and (f.applied_sheet_id=s.sheet_id or f.applied_sheet_id is null)) remove_slang,
              t.replica_id,t.owner_user_id
         from target t join vy_replica r
           on r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id
        join vy_teacher_sheet s on s.agent_id=r.agent_id and s.status<>'revoked'
        where exists (select 1 from reversible_delta_fragments f
                       where f.replica_id=t.replica_id and f.owner_user_id=t.owner_user_id
                         and (f.applied_sheet_id=s.sheet_id or f.applied_sheet_id is null))
     ), sheet_board_rewritten as materialized (
       select c.*,
              case when not c.remove_board then c.sheet else
                jsonb_set(c.sheet,'{boardVerbalisms}',coalesce((
                  select jsonb_agg(item.value order by item.ordinality)
                    from jsonb_array_elements(case
                      when jsonb_typeof(c.sheet->'boardVerbalisms')='array'
                        then c.sheet->'boardVerbalisms' else '[]'::jsonb end)
                      with ordinality item(value,ordinality)
                   where not exists (
                     select 1 from reversible_delta_fragments f
                      where f.replica_id=c.replica_id and f.owner_user_id=c.owner_user_id
                        and f.target_field='boardVerbalisms'
                        and (f.applied_sheet_id=c.sheet_id or f.applied_sheet_id is null)
                        and f.fragment=btrim(item.value#>>'{}')
                   )
                ),'[]'::jsonb),true) end sheet_after_board
         from sheet_candidates c
     ), sheet_rewritten as materialized (
       select b.sheet_id,b.status,
              case when not b.remove_slang then b.sheet_after_board else
                jsonb_set(b.sheet_after_board,'{exSlangRepeat}',to_jsonb((
                  select '('||coalesce(string_agg(to_jsonb(existing.fragment)::text,', '
                                               order by existing.ordinality),'')||')'
                    from (
                      select btrim(part,E' 	
"') fragment,ordinality
                        from regexp_split_to_table(
                          btrim(coalesce(b.sheet_after_board->>'exSlangRepeat',''),E' 	
()'),
                          E'[[:space:]]*,[[:space:]]*') with ordinality pieces(part,ordinality)
                    ) existing
                   where existing.fragment<>'' and not exists (
                     select 1 from reversible_delta_fragments f
                      where f.replica_id=b.replica_id and f.owner_user_id=b.owner_user_id
                        and f.target_field='exSlangRepeat'
                        and (f.applied_sheet_id=b.sheet_id or f.applied_sheet_id is null)
                        and f.fragment=existing.fragment
                   )
                )),true) end rewritten_sheet
         from sheet_board_rewritten b
     ), teacher_sheet_effects as (
       update vy_teacher_sheet s
          set sheet=x.rewritten_sheet,
              status=case when s.status in ('published','validated') then 'draft' else s.status end,
              published_at=case when s.status='published' then null else s.published_at end,
              consent_artifact_id=case when s.status='published' then null else s.consent_artifact_id end,
              updated_at=now()
         from sheet_rewritten x where s.sheet_id=x.sheet_id
       returning s.sheet_id
     ), provider_consent as (
       update vy_replica_provider_consent pc set source_id=null,state='revoked',
              revoked_at=coalesce(revoked_at,now()),updated_at=now()
         from target t where pc.source_id=t.source_id and pc.replica_id=t.replica_id
          and pc.owner_user_id=t.owner_user_id
     ), identity_binding as (
       select ic.identity_case_id,ic.replica_id,ic.owner_user_id,
              (ic.state='verified' and r.age_verified_at is not null
               and r.identity_verified_at is not null and r.liveness_verified_at is not null
               and r.identity_expires_at>now()) preserve
         from vy_replica_identity_case ic
         join target t on t.source_id=ic.source_id and t.replica_id=ic.replica_id
          and t.owner_user_id=ic.owner_user_id
         join vy_replica r on r.replica_id=ic.replica_id and r.owner_user_id=ic.owner_user_id
     ), preserved_identity as (
       update vy_replica_identity_case ic set source_id=null,updated_at=now()
        from identity_binding b where b.preserve and ic.identity_case_id=b.identity_case_id
       returning ic.identity_case_id
     ), identity_challenge_sources as (
       update vy_replica_source live set state='deleting',updated_at=now()
         from vy_replica_liveness_challenge ch
         join identity_binding b on b.identity_case_id=ch.identity_case_id and not b.preserve
         join target t on t.replica_id=b.replica_id and t.owner_user_id=b.owner_user_id
        where live.source_id=ch.source_id and live.replica_id=ch.replica_id
          and live.owner_user_id=ch.owner_user_id and live.source_id<>t.source_id
       -- RETURNING is mandatory, not decoration: a data-modifying CTE with no
       -- RETURNING clause cannot be REFERENCED, and the "count(*)" below is a
       -- reference. Without it Postgres rejects the whole statement at parse
       -- time — 0A000, "WITH query "identity_challenge_sources" does not have a
       -- RETURNING clause" — so it could never execute.
       returning live.source_id
     ), identity_cases as (
       delete from vy_replica_identity_case ic using identity_binding b
        where ic.identity_case_id=b.identity_case_id and not b.preserve
          -- Reads the rows the CTE above actually marked. The predicate is
          -- deliberately total (>=0 holds for an empty set too): its job is to
          -- name the dependency, not to filter. Marking the challenge sources
          -- for deletion must not be skipped when there happen to be none.
          and (select count(*) from identity_challenge_sources)>=0
       returning ic.replica_id,ic.owner_user_id
     ), identity_replica as (
       update vy_replica r set age_verified_at=null,identity_verified_at=null,liveness_verified_at=null,
              identity_expires_at=null,
              lifecycle=case when lifecycle in ('revoked','purging') then lifecycle else 'enrolling' end,
              updated_at=now()
        where exists (select 1 from identity_cases ic where ic.replica_id=r.replica_id
          and ic.owner_user_id=r.owner_user_id)
       returning r.subject_person_id
     ), identity_consent as (
       update vy_replica_consent c set revoked_at=coalesce(revoked_at,now())
        where exists (select 1 from identity_cases ic where ic.replica_id=c.replica_id
          and ic.owner_user_id=c.owner_user_id) and c.scope='biometric' and c.revoked_at is null
     ), identity_person as (
       update vy_person p set age_tier='unverified'
        where exists (select 1 from identity_replica r where r.subject_person_id=p.person_id)
     ), claim_materialization_episodes as materialized (
       select e.id,e.agent_id,e.person_id
         from target t
         join vy_replica r on r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id
         join vy_replica_claim c on c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and t.source_id=any(c.source_ids) and c.proposal_hash is not null
         join vy_episode e on e.agent_id=r.agent_id and e.person_id=r.subject_person_id
          and e.boundary_reason like 'replica_claim:'||c.proposal_hash||':%'
     ), claim_materialized_facts as (
       delete from vy_fact f using claim_materialization_episodes e
        where f.agent_id=e.agent_id and f.person_id=e.person_id
          and f.citations && array[e.id]::bigint[]
     ), claim_materialized_rel_events as (
       delete from vy_rel_event v using claim_materialization_episodes e
        where v.agent_id=e.agent_id and v.person_id=e.person_id
          and v.citations && array[e.id]::bigint[]
     ), claim_materialized_episodes as (
       delete from vy_episode e using claim_materialization_episodes doomed
        where e.id=doomed.id and e.agent_id=doomed.agent_id and e.person_id=doomed.person_id
     ), claims as (
       delete from vy_replica_claim c using target t
        where c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and t.source_id=any(c.source_ids)
     ), affected_calibrations as materialized (
       select c.version
         from vy_replica_calibration c join target t
           on t.replica_id=c.replica_id and t.owner_user_id=c.owner_user_id
        where exists (select 1 from affected_profiles affected where affected.version=c.profile_version)
     ), affected_datasets as materialized (
       select d.dataset_id
         from vy_replica_feedback_dataset d join target t
           on t.replica_id=d.replica_id and t.owner_user_id=d.owner_user_id
        where exists (select 1 from affected_profiles affected where affected.version=d.profile_version)
           or exists (select 1 from affected_calibrations affected where affected.version=d.calibration_version)
     ), affected_builds as materialized (
       select b.build_id
         from vy_replica_model_build b join target t
           on t.replica_id=b.replica_id and t.owner_user_id=b.owner_user_id
        where b.created_at<=t.erasure_requested_at
           or exists (select 1 from affected_genomes affected where affected.source_set_hash=b.source_set_hash)
           or exists (select 1 from affected_profiles affected where affected.source_set_hash=b.source_set_hash)
     ), genomes as (
       update vy_replica_voice_genome g set status='retired',
              source_set_hash='erased:'||$1::text||':'||g.version::text,
              definition=jsonb_build_object('erased',true,'reason','source_erased')
         from target t where g.replica_id=t.replica_id
          and exists (select 1 from affected_genomes affected where affected.version=g.version)
     ), profiles as (
       update vy_replica_profile p set status='retired',
              source_set_hash='erased:'||$1::text||':'||p.version::text,
              definition=jsonb_build_object('erased',true,'reason','source_erased')
         from target t where p.replica_id=t.replica_id
          and exists (select 1 from affected_profiles affected where affected.version=p.version)
     ), calibrations as (
       update vy_replica_calibration c set status='retired',
              definition=jsonb_build_object('erased',true,'reason','source_erased')
         from target t where c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and exists (select 1 from affected_calibrations affected where affected.version=c.version)
     ), datasets as (
       update vy_replica_feedback_dataset d set status='retired',
              definition=jsonb_build_object('erased',true,'reason','source_erased'),
              readiness=jsonb_build_object('ready',false,'blockers',jsonb_build_array('source_erased'))
         from target t where d.replica_id=t.replica_id and d.owner_user_id=t.owner_user_id
          and exists (select 1 from affected_datasets affected where affected.dataset_id=d.dataset_id)
     ), candidates as (
       update vy_replica_candidate c set status='retired',updated_at=now()
         from target t,affected_datasets affected
        where c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and c.dataset_id=affected.dataset_id
          and c.status<>'retired'
      ), builds as (
        update vy_replica_model_build b set state='retired',updated_at=now()
          from target t,affected_builds affected
         where b.replica_id=t.replica_id and b.owner_user_id=t.owner_user_id
           and b.build_id=affected.build_id
           and b.state<>'retired'
      ), voice_delivery_policies as (
        delete from vy_replica_voice_delivery_policy p using vy_replica_processing_artifact a,target t
         where p.preview_artifact_id=a.artifact_id and p.replica_id=a.replica_id
           and p.owner_user_id=a.owner_user_id and a.source_id=t.source_id
           and a.replica_id=t.replica_id and a.owner_user_id=t.owner_user_id
      ), voice_preferences as (
        delete from vy_replica_voice_preference p using target t
         where p.replica_id=t.replica_id and p.owner_user_id=t.owner_user_id
           and exists (
             select 1 from vy_replica_generation g
             join vy_replica_processing_artifact a on a.artifact_id=g.preview_artifact_id
              and a.replica_id=g.replica_id and a.owner_user_id=g.owner_user_id
              where g.generation_id in (p.left_generation_id,p.right_generation_id)
                and a.source_id=t.source_id and a.replica_id=t.replica_id
                and a.owner_user_id=t.owner_user_id
           )
      ), preview_generations as (
        delete from vy_replica_generation g using vy_replica_processing_artifact a,target t
         where g.preview_artifact_id=a.artifact_id and g.replica_id=a.replica_id
           and g.owner_user_id=a.owner_user_id and a.source_id=t.source_id
           and a.replica_id=t.replica_id and a.owner_user_id=t.owner_user_id
       ), voice_trials as (
         delete from vy_replica_voice_trial v using target t
         where v.preview_artifact_id in (
           select a.artifact_id from vy_replica_processing_artifact a
            where a.source_id=t.source_id and a.replica_id=t.replica_id and a.owner_user_id=t.owner_user_id
          ) and v.replica_id=t.replica_id and v.owner_user_id=t.owner_user_id
       ), mirror_feedback as (
         delete from vy_mirror_feedback f using source_turns tr
          where f.session_id=tr.session_id and f.replica_id=tr.replica_id
            and f.owner_user_id=tr.owner_user_id and f.turn_ref=tr.turn_id::text
         returning f.feedback_id
       ), mirror_finetune_jobs as (
         delete from vy_mirror_finetune_job j using source_windows w
          where j.session_id=w.session_id and j.replica_id=w.replica_id
            and j.owner_user_id=w.owner_user_id
         returning j.job_id
       ), mirror_deltas as (
         delete from vy_mirror_delta d using source_deltas doomed
          where d.delta_id=doomed.delta_id and d.session_id=doomed.session_id
            and d.replica_id=doomed.replica_id and d.owner_user_id=doomed.owner_user_id
            and (select count(*) from teacher_sheet_effects)>=0
         returning d.delta_id
       ), expression_observations as (
         delete from vy_replica_expression_observation o using target t
          where o.source_id=t.source_id and o.replica_id=t.replica_id
            and o.owner_user_id=t.owner_user_id
         returning o.observation_id
       ), canonical_evidence as (
         delete from vy_replica_processing_evidence e using target t
          where e.source_id=t.source_id and e.replica_id=t.replica_id
            and e.owner_user_id=t.owner_user_id
         returning e.evidence_id
       ), mirror_conditioning as (
         delete from vy_mirror_conditioning c using source_windows w
          where c.window_id=w.window_id and c.session_id=w.session_id
            and c.replica_id=w.replica_id and c.owner_user_id=w.owner_user_id
         returning c.selection_id
       ), mirror_turns as (
         delete from vy_mirror_turn tr using source_turns doomed
          where tr.turn_id=doomed.turn_id and tr.window_id=doomed.window_id
            and tr.replica_id=doomed.replica_id and tr.owner_user_id=doomed.owner_user_id
            and (select count(*) from mirror_feedback)>=0
            and (select count(*) from expression_observations)>=0
         returning tr.turn_id
       ), mirror_windows as (
         delete from vy_mirror_window w using source_windows doomed
          where w.window_id=doomed.window_id and w.session_id=doomed.session_id
            and w.replica_id=doomed.replica_id and w.owner_user_id=doomed.owner_user_id
            and (select count(*) from mirror_finetune_jobs)>=0
            and (select count(*) from mirror_deltas)>=0
            and (select count(*) from canonical_evidence)>=0
            and (select count(*) from mirror_conditioning)>=0
            and (select count(*) from mirror_turns)>=0
         returning w.window_id
       ), removed as (
         delete from vy_replica_source s using target t
          where s.source_id=t.source_id and s.replica_id=t.replica_id and s.owner_user_id=t.owner_user_id
           and (select count(*) from identity_cases)>=0 and (select count(*) from preserved_identity)>=0
           and (select count(*) from mirror_windows)>=0
           and (select count(*) from context_ingest_runs)>=0
        returning t.source_id,t.replica_id,t.owner_user_id,t.erasure_attempts
     ), attempted as (
       update vy_replica_source_erasure_attempt a set outcome='complete',failure_code='',finished_at=now()
         from removed r where a.source_id=r.source_id and a.attempt=r.erasure_attempts and a.outcome='running'
     ), audit as (
       insert into vy_replica_audit
         (replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'source.delete.complete','source',source_id::text,$5,'allowed',
              jsonb_build_object(
                'derived_models_scrubbed',true,'worker','reconciler',
                'mirror_windows_removed',(select count(*) from mirror_windows),
                'mirror_deltas_removed',(select count(*) from mirror_deltas),
                'expression_observations_removed',(select count(*) from expression_observations),
                'canonical_evidence_removed',(select count(*) from canonical_evidence),
                'context_ingest_runs_scrubbed',(select count(*) from context_ingest_runs),
                'teacher_sheets_rewritten',(select count(*) from teacher_sheet_effects)
              ) from removed
     ) select source_id from removed