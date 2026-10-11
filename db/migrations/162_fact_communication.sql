-- One logical remembered quote, with closed presentation metadata. Existing
-- fact/episode erasure and export ownership apply to the same row.
alter table vy_fact add column if not exists communication jsonb
constraint vy_fact_communication_check check (
 communication is null or (
  kind='user' and name='preference' and provenance='user_said'
  and jsonb_typeof(communication)='object'
  and communication ?& array['version','state','scope','language','script','brevity']
  and communication - array['version','state','scope','language','script','brevity']='{}'::jsonb
  and communication->'version'='1'::jsonb
  and communication->'state' in ('"classified"'::jsonb,'"unclassified"'::jsonb,'"no_preference"'::jsonb)
  and jsonb_typeof(communication->'scope')='object'
  and (communication->'scope') ?& array['language','script','brevity']
  and (communication->'scope') - array['language','script','brevity']='{}'::jsonb
  and jsonb_typeof(communication->'scope'->'language')='boolean'
  and jsonb_typeof(communication->'scope'->'script')='boolean'
  and jsonb_typeof(communication->'scope'->'brevity')='boolean'
  and (communication->'scope'->'language'='true'::jsonb
    or communication->'scope'->'script'='true'::jsonb
    or communication->'scope'->'brevity'='true'::jsonb)
  and communication->'language' in ('null'::jsonb,'"english"'::jsonb,'"hindi"'::jsonb,'"hinglish"'::jsonb)
  and communication->'script' in ('null'::jsonb,'"roman"'::jsonb,'"devanagari"'::jsonb)
  and communication->'brevity' in ('null'::jsonb,'"short"'::jsonb,'"detailed"'::jsonb)
  and (communication->'language'='null'::jsonb or communication->'scope'->'language'='true'::jsonb)
  and (communication->'script'='null'::jsonb or communication->'scope'->'script'='true'::jsonb)
  and (communication->'brevity'='null'::jsonb or communication->'scope'->'brevity'='true'::jsonb)
  and ((communication->>'state'='classified' and
    (communication->'language'<>'null'::jsonb or communication->'script'<>'null'::jsonb or communication->'brevity'<>'null'::jsonb))
   or (communication->>'state' in ('unclassified','no_preference')
    and communication->'language'='null'::jsonb and communication->'script'='null'::jsonb and communication->'brevity'='null'::jsonb))
 )
);
