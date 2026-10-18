-- Disposable local PostgreSQL only. Every fixture and existing-row change rolls back.
begin;
create temp table academic_results(name text primary key);
grant select,insert on academic_results to authenticated,anon;
create function pg_temp.ok(v boolean,label text) returns void language plpgsql as $$begin
 if v is distinct from true then raise exception 'FAILED %',label;end if;
 insert into pg_temp.academic_results values(label);end$$;
create function pg_temp.denied(sql text,code text,label text) returns void language plpgsql as $$declare caught text;begin
 begin execute sql;exception when others then get stacked diagnostics caught=returned_sqlstate;end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught;end if;
 insert into pg_temp.academic_results values(label);end$$;
create function pg_temp.claim(n integer,extra jsonb default '{}') returns void language sql as $$
 select set_config('request.jwt.claims',(jsonb_build_object('iss','https://gmvouqgjbtbkbhrdruzu.supabase.co/auth/v1','aud','authenticated','role','authenticated',
 'sub','10000000-0000-0000-0000-'||lpad(n::text,12,'0'))||extra)::text,true)::void$$;
create function pg_temp.key(k text) returns uuid language sql as $$select current_setting('m5.'||k)::uuid$$;
create function pg_temp.command(action text,id uuid default null,rev bigint default null,data jsonb default '{}') returns jsonb language sql as $$
 select public.academic_command(action,'20000000-0000-0000-0000-000000000001',id,rev,data)$$;

select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid in
 ('public.academic_programs'::regclass,'public.academic_stages'::regclass,'public.course_stage_assignments'::regclass,'public.student_stage_preferences'::regclass,'private.course_stage_versions'::regclass)),'all five new tables have RLS');
select pg_temp.ok(not has_function_privilege('anon','public.academic_command(text,uuid,uuid,bigint,jsonb)','execute')
 and not has_function_privilege('anon','public.set_student_stage_preference(uuid,uuid,bigint)','execute'),'anon cannot call commands');
select pg_temp.ok((select bool_and(not has_table_privilege('authenticated',x,'insert,update,delete')) from unnest(array['public.academic_programs','public.academic_stages','public.course_stage_assignments','public.student_stage_preferences']) x),'no direct authenticated writes');
select pg_temp.ok(not has_table_privilege('authenticated','private.course_stage_versions','select'),'classification ledger not exposed');
select pg_temp.ok((select bool_and(not has_function_privilege('anon',x,'execute')) from unnest(array[
 'private.academic_command(text,uuid,uuid,bigint,jsonb)','private.set_student_stage_preference(uuid,uuid,bigint)',
 'public.course_stage_classification(uuid)','private.course_stage_classification(uuid)',
 'private.can_view_academic_stage(uuid)','private.can_view_academic_organization(uuid)']) x),'all academic helper and RPC anonymous execution revoked');
select pg_temp.ok((select bool_and(proconfig @> array['search_path=""']) from pg_proc where pronamespace='private'::regnamespace and proname in
 ('academic_command','set_student_stage_preference','course_stage_classification','can_view_academic_stage','can_view_academic_organization')),'all new private functions fix empty search path');
select pg_temp.ok((select count(*)=0 from public.course_stage_assignments),'existing courses not auto classified');
select pg_temp.ok((select count(*)=2 from public.courses c where not exists(select 1 from public.course_stage_assignments a where a.course_id=c.id)),'both original courses remain explicitly unassigned');
set local role anon;
select pg_temp.denied('select * from public.academic_programs','42501','anonymous catalog denied');
select pg_temp.denied('select * from public.academic_stages','42501','anonymous stages denied');
select pg_temp.denied('select * from public.course_stage_assignments','42501','anonymous classifications denied');
select pg_temp.denied('select * from public.student_stage_preferences','42501','anonymous preferences denied');
select pg_temp.denied($q$select public.academic_command('program.create','20000000-0000-0000-0000-000000000001')$q$,'42501','anonymous RPC denied');
reset role;
set local role authenticated;select pg_temp.claim(1);
select set_config('m5.program',(pg_temp.command('program.create',null,null,'{"label":"Secondary","slug":"secondary"}')->>'id'),true);
select set_config('m5.otherprogram',(pg_temp.command('program.create',null,null,'{"label":"University","slug":"university","description":"Independent curriculum"}')->>'id'),true);
select set_config('m5.stage',(pg_temp.command('stage.create',null,null,jsonb_build_object('label','Year One','slug','year-one','programId',pg_temp.key('program')))->>'id'),true);
select set_config('m5.stage2',(pg_temp.command('stage.create',null,null,jsonb_build_object('label','Year Two','slug','year-two','programId',pg_temp.key('program'),'position',1))->>'id'),true);
select set_config('m5.otherstage',(pg_temp.command('stage.create',null,null,jsonb_build_object('label','Engineering','slug','engineering','programId',pg_temp.key('otherprogram')))->>'id'),true);
select pg_temp.ok((select count(*)=2 from public.academic_programs),'owner creates multiple programs in one tenant');
select pg_temp.ok((select count(*)=3 from public.academic_stages),'owner creates ordered stages');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'{"label":"Duplicate","slug":"secondary"}')$q$,'23505','duplicate program slug rejected');
select pg_temp.denied($q$select pg_temp.command('stage.create',null,null,jsonb_build_object('label','Duplicate','slug','year-one','programId',pg_temp.key('program')))$q$,'23505','duplicate stage slug rejected');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'{"label":"Bad","slug":"bad","role":"owner"}')$q$,'22023','unknown privilege field rejected');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'{"label":12,"slug":"bad"}')$q$,'22023','numeric label rejected');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'{"label":"  ","slug":"bad"}')$q$,'22023','blank label rejected');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'{"label":"Bad","slug":"bad","position":1.5}')$q$,'22023','fractional position rejected');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'{"label":"Bad","slug":"bad","position":-1}')$q$,'22023','negative position rejected');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'{"label":"Bad","slug":"../bad"}')$q$,'22023','unsafe slug rejected');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'{"label":"Bad","slug":"bad","status":"published"}')$q$,'22023','unknown taxonomy state rejected');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'[]')$q$,'22023','nonobject payload rejected');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,jsonb_build_object('label','Bad','slug','bad','description',repeat('x',17000)))$q$,'22023','oversized payload rejected');
select pg_temp.denied($q$select pg_temp.command('stage.edit',pg_temp.key('stage'),0,jsonb_build_object('programId',pg_temp.key('otherprogram')))$q$,'22023','stage cannot silently change program');
select pg_temp.command('program.edit',pg_temp.key('program'),0,'{"label":"Secondary revised","position":2}');
select pg_temp.ok((select slug='secondary' and revision=1 from public.academic_programs where id=pg_temp.key('program')),'metadata edit retains stable identity and omitted slug');
select pg_temp.denied($q$select pg_temp.command('program.edit',pg_temp.key('program'),0,'{"label":"Stale"}')$q$,'PT409','stale taxonomy write rejected');

-- Teacher may edit assigned course classification, never tenant-wide taxonomy.
select pg_temp.claim(2);
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'{"label":"Forbidden","slug":"forbidden"}')$q$,'42501','ordinary teacher cannot administer taxonomy');
select pg_temp.ok((public.course_stage_classification('30000000-0000-0000-0000-000000000001')->>'revision')::int=0,'unassigned course has version zero');
select pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',0,jsonb_build_object('stageIds',jsonb_build_array(pg_temp.key('stage'),pg_temp.key('otherstage'))));
select pg_temp.ok((select count(*)=2 from public.course_stage_assignments),'one course can span programs without duplication');
select pg_temp.ok((pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',1,jsonb_build_object('stageIds',jsonb_build_array(pg_temp.key('otherstage'),pg_temp.key('stage'))))->>'revision')::int=1,'unchanged assignments are idempotent');
select pg_temp.denied($q$select pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',0,'{"stageIds":[]}')$q$,'PT409','stale classification rejected');
select pg_temp.denied($q$select pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',1,jsonb_build_object('stageIds',jsonb_build_array(pg_temp.key('stage'),pg_temp.key('stage'))))$q$,'22023','duplicate stage IDs rejected');
select pg_temp.denied($q$select pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',1,jsonb_build_object('stageIds',to_jsonb(array_fill(pg_temp.key('stage'),array[51]))))$q$,'22023','classification array bounded');
select pg_temp.denied($q$select pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',1,'{"stageIds":[3]}')$q$,'22023','nonUUID array value denied');
select pg_temp.denied($q$select pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',1,'{"stageIds":["not-a-uuid"]}')$q$,'22P02','malformed UUID rejected');
select pg_temp.claim(4);
select pg_temp.ok((public.course_stage_classification('30000000-0000-0000-0000-000000000001')->>'revision')::int=1,'contextual course editor can inspect classification');
select pg_temp.denied($q$select pg_temp.command('program.edit',pg_temp.key('program'),1,'{"label":"No"}')$q$,'42501','assistant editor cannot administer taxonomy');
reset role;
update public.course_staff set role='assistant' where user_id='10000000-0000-0000-0000-000000000004';
set local role authenticated;
select pg_temp.denied($q$select pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',1,'{"stageIds":[]}')$q$,'42501','noneditor assistant cannot classify');
reset role;
update public.course_staff set role='editor' where user_id='10000000-0000-0000-0000-000000000004';
set local role authenticated;
select pg_temp.ok((pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',1,'{"stageIds":[]}')->>'revision')::int=2,'editor can explicitly clear classifications');
select pg_temp.ok((public.course_stage_classification('30000000-0000-0000-0000-000000000001')->>'revision')::int=2,'empty classification retains version tombstone');

-- B owner creates a private catalog with same slugs; A cannot discover it.
select pg_temp.claim(3);
select set_config('m5.bprogram',(public.academic_command('program.create','20000000-0000-0000-0000-000000000002',null,null,'{"label":"Private B","slug":"secondary"}')->>'id'),true);
select set_config('m5.bstage',(public.academic_command('stage.create','20000000-0000-0000-0000-000000000002',null,null,jsonb_build_object('label','Private B stage','slug','year-one','programId',pg_temp.key('bprogram')))->>'id'),true);
select pg_temp.ok((select count(*)=0 from public.academic_programs where id=pg_temp.key('program')),'other tenant owner cannot read A catalog');
select pg_temp.claim(1);
select pg_temp.denied($q$select pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',2,jsonb_build_object('stageIds',jsonb_build_array(pg_temp.key('bstage'))))$q$,'42501','forged cross tenant classification RPC denied');
select pg_temp.ok((public.course_stage_classification('30000000-0000-0000-0000-000000000001')->>'revision')::integer=2,'failed assignment changes neither links nor revision');
select pg_temp.denied($q$select pg_temp.command('stage.create',null,null,jsonb_build_object('label','Cross','slug','cross','programId',pg_temp.key('bprogram')))$q$,'42501','cross tenant program cannot parent stage');
select pg_temp.denied($q$select pg_temp.command('program.edit',pg_temp.key('bprogram'),0,'{"label":"Cross"}')$q$,'42501','forged other tenant edit denied');
reset role;
select pg_temp.denied($q$insert into public.course_stage_assignments(course_id,stage_id,organization_id) values('30000000-0000-0000-0000-000000000001',pg_temp.key('bstage'),'20000000-0000-0000-0000-000000000001')$q$,'23503','composite FK blocks privileged cross tenant assignment');
select pg_temp.denied($q$insert into public.academic_stages(organization_id,program_id,label,slug) values('20000000-0000-0000-0000-000000000001',pg_temp.key('bprogram'),'Cross','cross')$q$,'23503','composite FK blocks forged stage tenant');
select pg_temp.denied($q$insert into public.student_stage_preferences(user_id,organization_id,program_id,stage_id) values('10000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001',pg_temp.key('program'),pg_temp.key('otherstage'))$q$,'23503','preference FK requires exact selected program');
set local role authenticated;select pg_temp.claim(1);
select pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',2,jsonb_build_object('stageIds',jsonb_build_array(pg_temp.key('stage'))));
select pg_temp.claim(5);
select pg_temp.ok((select count(*)=2 from public.academic_programs),'enrolled student sees active own tenant choices');
select pg_temp.ok((select count(*)=0 from public.academic_programs where id=pg_temp.key('bprogram')),'student cannot read another tenant choices');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'{"label":"No","slug":"no"}')$q$,'42501','student taxonomy command denied');
select pg_temp.denied($q$select pg_temp.command('course.assign','30000000-0000-0000-0000-000000000001',3,'{"stageIds":[]}')$q$,'42501','student classification command denied');
select pg_temp.denied($q$insert into public.student_stage_preferences(user_id,organization_id,program_id,stage_id) values('10000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000001',pg_temp.key('program'),pg_temp.key('stage'))$q$,'42501','forged student preference direct insert denied');
select pg_temp.denied('update public.academic_programs set status=''archived''','42501','student direct taxonomy update denied');
select pg_temp.denied('delete from public.course_stage_assignments','42501','student direct classification delete denied');
select public.set_student_stage_preference(pg_temp.key('program'),pg_temp.key('stage'));
select public.set_student_stage_preference(pg_temp.key('otherprogram'),pg_temp.key('otherstage'));
select pg_temp.denied('update public.student_stage_preferences set stage_id=null','42501','even owner preference writes require revision RPC');
select pg_temp.ok((select count(*)=2 from public.student_stage_preferences),'student selections independently persist per program');
select pg_temp.ok((public.set_student_stage_preference(pg_temp.key('program'),pg_temp.key('stage'),1)->>'revision')::int=1,'repeated identical preference idempotent');
select pg_temp.denied($q$select public.set_student_stage_preference(pg_temp.key('program'),pg_temp.key('stage2'),0)$q$,'PT409','stale preference rejected');
select pg_temp.denied($q$select public.set_student_stage_preference(pg_temp.key('program'),pg_temp.key('otherstage'),1)$q$,'42501','wrong program selection denied');
select pg_temp.denied($q$select public.set_student_stage_preference(pg_temp.key('bprogram'),pg_temp.key('bstage'),0)$q$,'42501','cross tenant preference denied');
select pg_temp.denied($q$select public.set_student_stage_preference(pg_temp.key('program'),'ffffffff-ffff-ffff-ffff-ffffffffffff',1)$q$,'42501','missing stage denied');
select pg_temp.ok(private.is_enrolled('60000000-0000-0000-0000-000000000001') and not private.is_enrolled('60000000-0000-0000-0000-000000000003'),'preference changes no enrollment authority');
select pg_temp.ok((select count(*)=0 from public.courses where id='30000000-0000-0000-0000-000000000002'),'selection grants no other course access');
select pg_temp.ok((select count(*)=0 from public.lessons where status='draft'),'selection grants no draft access');
select public.set_student_stage_preference(pg_temp.key('program'),pg_temp.key('stage2'),1);
select pg_temp.ok(private.can_view_course('30000000-0000-0000-0000-000000000001'),'different selected stage does not revoke enrollment');
select pg_temp.claim(6);
select pg_temp.ok((select count(*)=0 from public.student_stage_preferences),'other student preferences hidden');
select public.set_student_stage_preference(pg_temp.key('program'),pg_temp.key('stage'),0);
select pg_temp.claim(2);
select pg_temp.ok((select count(*)=0 from public.student_stage_preferences),'teacher cannot read private student preferences');
select pg_temp.ok((select count(*)=1 from public.academic_programs where id=pg_temp.key('bprogram')),'same identity has legitimate contextual admin role in B');
select pg_temp.ok((public.academic_command('program.edit','20000000-0000-0000-0000-000000000002',pg_temp.key('bprogram'),0,'{"description":"Authorized B admin"}')->>'revision')::int=1,'contextual admin can manage B only');

-- Archival preserves historical references and permits an explicit cleared preference.
select pg_temp.claim(1);
select pg_temp.command('stage.edit',pg_temp.key('stage'),0,'{"status":"archived"}');
select pg_temp.ok((select count(*)=1 from public.academic_stages where id=pg_temp.key('stage')),'staff sees archived stage');
select pg_temp.claim(6);
select pg_temp.ok((select count(*)=0 from public.academic_stages where id=pg_temp.key('stage')),'archived stage hidden from student choices');
select pg_temp.ok((select stage_id=pg_temp.key('stage') from public.student_stage_preferences where program_id=pg_temp.key('program')),'archived preference retained for recovery');
select pg_temp.denied($q$select public.set_student_stage_preference(pg_temp.key('program'),pg_temp.key('stage'),1)$q$,'42501','cannot newly choose archived stage');
select public.set_student_stage_preference(pg_temp.key('program'),null,1);
select pg_temp.ok((select stage_id is null and revision=2 from public.student_stage_preferences),'explicit clear persists version without history deletion');
select pg_temp.claim(1);
select pg_temp.command('program.edit',pg_temp.key('otherprogram'),0,'{"status":"archived"}');
select pg_temp.claim(5);
select pg_temp.ok((select count(*)=0 from public.academic_stages where id=pg_temp.key('otherstage')),'active child of archived program hidden');
select pg_temp.denied($q$select public.set_student_stage_preference(pg_temp.key('otherprogram'),pg_temp.key('otherstage'),1)$q$,'42501','archived parent rejects selection');
select public.set_student_stage_preference(pg_temp.key('otherprogram'),null,1);
select pg_temp.ok((select count(*)=2 from public.student_stage_preferences),'clearing archived parent preserves other preference');

-- Losing staff/enrollment access immediately removes taxonomy/preference access.
reset role;
update public.organization_memberships set role='admin',status='suspended' where user_id='10000000-0000-0000-0000-000000000004';
set local role authenticated;select pg_temp.claim(4);
select pg_temp.ok((select count(*)=0 from public.academic_programs),'suspended admin catalog hidden');
select pg_temp.denied($q$select pg_temp.command('program.edit',pg_temp.key('program'),1,'{"label":"Suspended"}')$q$,'42501','suspended admin writes denied');
reset role;
update public.organization_memberships set role='assistant',status='active' where user_id='10000000-0000-0000-0000-000000000004';
update public.enrollments set enrolled_at=now()-interval '2 days',expires_at=now()-interval '1 minute' where user_id='10000000-0000-0000-0000-000000000005';
set local role authenticated;select pg_temp.claim(5);
select pg_temp.ok((select count(*)=0 from public.academic_programs),'expired student catalog hidden');
select pg_temp.ok((select count(*)=0 from public.student_stage_preferences),'expired student saved preferences hidden');
select pg_temp.denied($q$select public.set_student_stage_preference(pg_temp.key('program'),pg_temp.key('stage2'),2)$q$,'42501','expired student selection denied');
reset role;
update public.enrollments set expires_at=null where user_id='10000000-0000-0000-0000-000000000005';
update public.course_offerings set ends_at=now()-interval '1 day' where id='60000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.ok(private.is_enrolled('60000000-0000-0000-0000-000000000001'),'existing active unexpired enrollment after offering end preserved');
select pg_temp.ok((select count(*)=1 from public.academic_programs),'taxonomy follows established post-end learning policy');
reset role;
update public.organizations set status='suspended' where id='20000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.academic_programs),'suspended organization blocks student catalog');
select pg_temp.denied($q$select public.set_student_stage_preference(pg_temp.key('program'),pg_temp.key('stage2'),2)$q$,'42501','suspended organization blocks preferences');
select pg_temp.claim(1);
select pg_temp.denied($q$select pg_temp.command('program.edit',pg_temp.key('program'),1,'{"label":"Inactive"}')$q$,'42501','suspended organization blocks owner taxonomy writes');
reset role;
update public.organizations set status='active' where id='20000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.claim(7);
select pg_temp.ok((select count(*)=0 from public.academic_programs where organization_id='20000000-0000-0000-0000-000000000001'),'other organization student cannot list A taxonomy');
-- The real Firebase identity boundary is exercised locally with gateway-claim
-- substitutes and the existing onboarding RPC, never a forged mapping insert.
select set_config('request.jwt.claims','{"iss":"https://securetoken.google.com/diagonproduction","aud":"diagonproduction","sub":"m5-disposable-student","email_verified":true,"auth_time":1999999999,"role":"authenticated"}',true);
select set_config('m5.firebaseprofile',public.onboard_firebase_profile()::text,true);
select pg_temp.ok((select count(*)=0 from public.academic_programs),'verified Firebase registration alone grants no taxonomy access');
select pg_temp.denied($q$select public.set_student_stage_preference(pg_temp.key('program'),pg_temp.key('stage2'),0)$q$,'42501','verified unenrolled identity cannot choose private tenant stage');
reset role;
insert into public.enrollments(offering_id,user_id,status,enrolled_at) values('60000000-0000-0000-0000-000000000001',current_setting('m5.firebaseprofile')::uuid,'active',now());
set local role authenticated;
select public.set_student_stage_preference(pg_temp.key('program'),pg_temp.key('stage2'),0);
select pg_temp.ok((select count(*)=1 from public.student_stage_preferences),'verified enrolled Firebase identity saves own preference');
reset role;
update private.external_identities set status='disabled' where profile_id=current_setting('m5.firebaseprofile')::uuid;
set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.student_stage_preferences),'disabled Firebase mapping hides preference immediately');
select pg_temp.denied($q$select public.set_student_stage_preference(pg_temp.key('program'),null,1)$q$,'42501','disabled Firebase mapping cannot change preference');
select pg_temp.claim(5,'{"iss":"https://securetoken.google.com/diagonproduction","aud":"diagonproduction","sub":"forged","email_verified":false,"role":"authenticated","organization_id":"20000000-0000-0000-0000-000000000001"}');
select pg_temp.ok((select count(*)=0 from public.academic_programs),'forged unverified Firebase claims cannot grant catalog');
select pg_temp.denied($q$select pg_temp.command('program.create',null,null,'{"label":"Forged","slug":"forged"}')$q$,'42501','forged token denied command');
reset role;
select pg_temp.denied($q$delete from public.academic_stages where id=pg_temp.key('stage')$q$,'23503','referenced archived stage cannot be deleted');
select pg_temp.ok((select count(*)=4 from public.student_stage_preferences),'privileged verification confirms all preferences survived suspension');
select count(*) as academic_programs_stages_tests from academic_results;
rollback;
