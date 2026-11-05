-- Disposable local PostgreSQL only. Synthetic verified-gateway claims exercise database authorization, not token signatures. Every change rolls back; no real account exists.
-- Covers migration 20261105130000_teaching_space_name.sql. EVERY identity here is a Firebase identity (issuer securetoken.google.com/diagonproduction, a non-UUID subject,
-- an active private.external_identities row created by onboard_firebase_profile), so a call that cast the subject to uuid (auth.uid()) would fail every check.
begin;
create temp table tsn_results(name text primary key);
create temp table tsn_users(label text primary key,id uuid not null);
grant select,insert on tsn_results,tsn_users to authenticated,anon;
select set_config('tsn.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.tsn_results values(label);end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare caught text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught; end if;
 insert into pg_temp.tsn_results values(label);end$$;
create function pg_temp.addr(label text) returns text language sql as $$select label||'.'||current_setting('tsn.run')||'@example.test'$$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated','email_verified',true,
  'email',pg_temp.addr(label),'auth_time',floor(extract(epoch from now()))::bigint,'sub','tsn-'||current_setting('tsn.run')||'-'||label)::text,true);end$$;
create function pg_temp.key(k text) returns uuid language sql as $$select current_setting('tsn.'||k)::uuid$$;
create function pg_temp.hash(secret text) returns text language sql as $$select encode(sha256(convert_to(secret,'utf8')),'hex')$$;
create function pg_temp.req(name jsonb) returns jsonb language sql as $$
 select jsonb_build_object('teacherEmail',pg_temp.addr('invited'||gen_random_uuid()::text),
  'systems',jsonb_build_array(jsonb_build_object('label','Egyptian National','grades',jsonb_build_array(jsonb_build_object('key','g3','label','Third Secondary')))),
  'subjects',jsonb_build_array(jsonb_build_object('key','phy','label','Physics')),
  'course',jsonb_build_object('title','Physics - Third Secondary','gradeKey','g3','subjectKey','phy'))
  || case when name is null then '{}'::jsonb else jsonb_build_object('spaceName',name) end$$;
-- Reads as the database owner, so a check can see a name the signed-in person is not allowed to read.
create function pg_temp.orgnameid(i uuid) returns text language sql security definer set search_path='' as $$select name from public.organizations where id=i$$;
create function pg_temp.orgname(k text) returns text language sql security definer set search_path='' as $$select name from public.organizations where id=pg_temp.key(k)$$;

-- Everyone signs in with Firebase first, so each has a profile.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','owner','orgadmin','teacher','assistant','student','stranger','suspended'] loop
  perform pg_temp.claim(label);
  insert into pg_temp.tsn_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from tsn_users where label='admin';

-- ---------------------------------------------------------------- provisioning requires a space name and uses it
set local role authenticated;
select pg_temp.claim('admin');
select set_config('tsn.prov',public.platform_provision_teacher(pg_temp.req(to_jsonb('  Mr   Ahmed''s Physics '::text)),pg_temp.hash('tsn-secret-1'))::text,true);
select set_config('tsn.space',(current_setting('tsn.prov')::jsonb)->>'organizationId',true);
select pg_temp.ok(pg_temp.orgname('space')='Mr Ahmed''s Physics','the space is created with the name given, trimmed and with spaces collapsed');
select pg_temp.ok(pg_temp.orgname('space')<>'Pending teacher portal','no placeholder name is stored');
select set_config('tsn.prov2',public.platform_provision_teacher(pg_temp.req(to_jsonb('فيزياء الأستاذ أحمد'::text)),pg_temp.hash('tsn-secret-2'))::text,true);
select pg_temp.ok(pg_temp.orgnameid(((current_setting('tsn.prov2')::jsonb)->>'organizationId')::uuid)='فيزياء الأستاذ أحمد','an Arabic name is stored as typed');
reset role;
select set_config('tsn.space2',(current_setting('tsn.prov2')::jsonb)->>'organizationId',true);
select set_config('tsn.before',(select count(*)||'/'||(select count(*) from private.teacher_invitations)||'/'||(select count(*) from private.platform_audit) from public.organizations),true);
set local role authenticated;
select pg_temp.claim('admin');
select pg_temp.denied($s$select public.platform_provision_teacher(pg_temp.req(null),pg_temp.hash('n1'))$s$,'22023','a missing space name is refused');
select pg_temp.denied($s$select public.platform_provision_teacher(pg_temp.req('null'::jsonb),pg_temp.hash('n2'))$s$,'22023','a null space name is refused');
select pg_temp.denied($s$select public.platform_provision_teacher(pg_temp.req(to_jsonb('   '::text)),pg_temp.hash('n3'))$s$,'22023','a blank space name is refused');
select pg_temp.denied($s$select public.platform_provision_teacher(pg_temp.req(to_jsonb(repeat('x',201))),pg_temp.hash('n4'))$s$,'22023','a name over 200 characters is refused');
select pg_temp.denied($s$select public.platform_provision_teacher(pg_temp.req(to_jsonb(('Bell'||chr(7))::text)),pg_temp.hash('n5'))$s$,'22023','a name with a control character is refused');
select pg_temp.denied($s$select public.platform_provision_teacher(pg_temp.req('42'::jsonb),pg_temp.hash('n6'))$s$,'22023','a name that is not text is refused');
select pg_temp.denied($s$select public.platform_provision_teacher(pg_temp.req(to_jsonb('X'::text)) || '{"organizationName":"x"}',pg_temp.hash('n7'))$s$,'22023','an unknown key is still refused');
reset role;
select pg_temp.ok(current_setting('tsn.before')=(select count(*)||'/'||(select count(*) from private.teacher_invitations)||'/'||(select count(*) from private.platform_audit) from public.organizations),'refused requests created nothing');

-- 200 characters exactly is accepted.
set local role authenticated;
select pg_temp.claim('admin');
select pg_temp.ok(length(pg_temp.orgnameid(((public.platform_provision_teacher(pg_temp.req(to_jsonb(repeat('x',200))),pg_temp.hash('n8')))->>'organizationId')::uuid))=200,'a name of exactly 200 characters is accepted');

-- ---------------------------------------------------------------- the read models carry the name
select pg_temp.ok(public.platform_portal_detail(pg_temp.key('space'))->>'name'='Mr Ahmed''s Physics','the portal detail shows the space name');
select pg_temp.ok((select bool_or(i->>'name'='Mr Ahmed''s Physics' and i->>'organizationId'=current_setting('tsn.space')) from jsonb_array_elements(public.platform_portal_overview(50)->'items') i),'the overview lists the space name');
reset role;

-- ---------------------------------------------------------------- memberships (owner of the space and of a second one, an admin, a teacher, an assistant, a suspended owner)
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.key('space'),id,case label when 'owner' then 'owner' when 'orgadmin' then 'admin' when 'teacher' then 'teacher' when 'assistant' then 'assistant' when 'suspended' then 'owner' end,
  case label when 'suspended' then 'suspended' else 'active' end,now()
 from tsn_users where label in ('owner','orgadmin','teacher','assistant','suspended');
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) select pg_temp.key('space2'),id,'owner','active',now() from tsn_users where label='owner';
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) select pg_temp.key('space2'),id,'owner','active',now() from tsn_users where label='stranger';
select set_config('tsn.state',(select string_agg(id::text||slug||status,',' order by id) from public.organizations where id in (pg_temp.key('space'),pg_temp.key('space2'))),true);
select set_config('tsn.inv',(select string_agg(id::text||status||expires_at::text,',' order by id) from private.teacher_invitations where organization_id=pg_temp.key('space')),true);
select set_config('tsn.audit0',(select count(*) from private.platform_audit)::text,true);

-- ---------------------------------------------------------------- the owner renames their own space
set local role authenticated;
select pg_temp.claim('owner');
select pg_temp.ok(public.rename_my_teaching_space(pg_temp.key('space'),'  Physics   with Mr Ahmed ')->>'name'='Physics with Mr Ahmed','the owner renames the space; the name is trimmed and spaces collapsed');
select pg_temp.ok(pg_temp.orgname('space')='Physics with Mr Ahmed','the new name is stored');
select pg_temp.ok((select count(*)=2 and count(distinct name)=2 from public.organizations where id in (pg_temp.key('space'),pg_temp.key('space2'))),'an owner of two spaces now sees two different names');
select pg_temp.ok(public.rename_my_teaching_space(pg_temp.key('space'),'Physics with Mr Ahmed')->>'name'='Physics with Mr Ahmed','renaming to the same name works');
select pg_temp.ok(public.rename_my_teaching_space(pg_temp.key('space'),'مستر أحمد للفيزياء')->>'name'='مستر أحمد للفيزياء','an Arabic name works');
select pg_temp.denied($s$select public.rename_my_teaching_space(pg_temp.key('space'),'   ')$s$,'22023','a blank name is refused');
select pg_temp.denied($s$select public.rename_my_teaching_space(pg_temp.key('space'),repeat('x',201))$s$,'22023','rename: a name over 200 characters is refused');
select pg_temp.denied($s$select public.rename_my_teaching_space(pg_temp.key('space'),'Bell'||chr(7))$s$,'22023','rename: a name with a control character is refused');
select pg_temp.denied($s$select public.rename_my_teaching_space(pg_temp.key('space'),null)$s$,'22023','no name is refused');
select pg_temp.denied($s$select public.rename_my_teaching_space(gen_random_uuid(),'Nope')$s$,'42501','a space that does not exist is refused like any space the caller does not own');
select pg_temp.ok(pg_temp.orgname('space')='مستر أحمد للفيزياء','refused renames changed nothing');

-- who may NOT rename
do $$ declare label text; begin
 foreach label in array array['orgadmin','teacher','assistant','student','stranger','suspended'] loop
  perform pg_temp.claim(label);
  perform pg_temp.denied(format($s$select public.rename_my_teaching_space(pg_temp.key('space'),%L)$s$,'Taken by '||label),'42501','rename denied to '||label);
 end loop;
end $$;
select pg_temp.claim('stranger');
select pg_temp.ok(public.rename_my_teaching_space(pg_temp.key('space2'),'Stranger''s own space')->>'name'='Stranger''s own space','an owner of another space renames only their own');
select pg_temp.claim('owner');
select pg_temp.ok(pg_temp.orgname('space2')='Stranger''s own space','and that does not depend on who else owns it: a shared space renamed by one of its owners');
select pg_temp.ok(pg_temp.orgname('space')='مستر أحمد للفيزياء','the stranger changed nothing in the first space');
select pg_temp.denied($s$select public.platform_rename_teaching_space(pg_temp.key('space'),'Admin only')$s$,'42501','the owner is not a platform administrator, so the administrator rename is denied');
select pg_temp.claim('teacher');
select pg_temp.denied($s$select public.platform_rename_teaching_space(pg_temp.key('space'),'Admin only')$s$,'42501','a teacher cannot use the administrator rename');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"nobody"}',true);
select pg_temp.denied($s$select public.rename_my_teaching_space(pg_temp.key('space'),'Unmapped')$s$,'42501','an unmapped identity is refused');
set local role anon;
select pg_temp.denied($s$select public.rename_my_teaching_space(pg_temp.key('space'),'Anon')$s$,'42501','anonymous callers cannot rename');
select pg_temp.denied($s$select public.platform_rename_teaching_space(pg_temp.key('space'),'Anon')$s$,'42501','anonymous callers cannot use the administrator rename');
reset role;

-- a suspended space cannot be renamed by its owner
update public.organizations set status='suspended' where id=pg_temp.key('space2');
set local role authenticated;
select pg_temp.claim('stranger');
select pg_temp.denied($s$select public.rename_my_teaching_space(pg_temp.key('space2'),'Suspended')$s$,'42501','a suspended space cannot be renamed by its owner');
reset role;
update public.organizations set status='active' where id=pg_temp.key('space2');

-- ---------------------------------------------------------------- the administrator renames
set local role authenticated;
select pg_temp.claim('admin');
select pg_temp.ok(public.platform_rename_teaching_space(pg_temp.key('space'),' Mr Ahmed Physics Academy ')->>'name'='Mr Ahmed Physics Academy','a platform administrator renames a provisioned space');
select pg_temp.ok(public.platform_portal_detail(pg_temp.key('space'))->>'name'='Mr Ahmed Physics Academy','the portal detail shows the new name');
select pg_temp.denied($s$select public.platform_rename_teaching_space(pg_temp.key('space'),'')$s$,'22023','the administrator cannot set a blank name');
select pg_temp.denied($s$select public.platform_rename_teaching_space(pg_temp.key('space'),repeat('y',201))$s$,'22023','the administrator cannot set an over-long name');
select pg_temp.denied($s$select public.platform_rename_teaching_space(gen_random_uuid(),'Nope')$s$,'PT404','an unknown space is not found');
reset role;
insert into public.organizations(id,name,slug) values('c0ffee00-0000-4000-8000-000000000001','Not provisioned here','tsn-plain-'||current_setting('tsn.run'));
set local role authenticated;
select pg_temp.claim('admin');
select pg_temp.denied($s$select public.platform_rename_teaching_space('c0ffee00-0000-4000-8000-000000000001','Nope')$s$,'PT404','a space that was not provisioned through the portal flow is not renamed from the portal pages');
reset role;

-- ---------------------------------------------------------------- nothing else changed, and every rename is audited
select pg_temp.ok(current_setting('tsn.state')=(select string_agg(id::text||slug||status,',' order by id) from public.organizations where id in (pg_temp.key('space'),pg_temp.key('space2'))),'slug and status never change');
select pg_temp.ok(current_setting('tsn.inv')=(select string_agg(id::text||status||expires_at::text,',' order by id) from private.teacher_invitations where organization_id=pg_temp.key('space')),'the invitation is untouched by a rename');
select pg_temp.ok((select count(*)=4 from private.platform_audit where action='portal.rename' and organization_id in (pg_temp.key('space'),pg_temp.key('space2'))),
 'four renames that changed a name were audited (the same-name rename was not)');
select pg_temp.ok((select detail->>'from'='Mr Ahmed''s Physics' and detail->>'to'='Physics with Mr Ahmed' from private.platform_audit where action='portal.rename' and organization_id=pg_temp.key('space') order by id limit 1),'the audit keeps the old and the new name');
select pg_temp.ok((select actor_id=(select id from tsn_users where label='owner') from private.platform_audit where action='portal.rename' and organization_id=pg_temp.key('space') order by id limit 1),'the audit names the owner who renamed');
select pg_temp.ok((select actor_id=(select id from tsn_users where label='admin') from private.platform_audit where action='portal.rename' and organization_id=pg_temp.key('space') order by id desc limit 1),'and the administrator who did');
set local role authenticated;
select pg_temp.claim('admin');
select pg_temp.ok((select count(*)=3 and bool_or(x->>'actor'='teacher') and bool_or(x->>'actor'='administrator') from jsonb_array_elements(public.platform_portal_detail(pg_temp.key('space'))->'activity') x where x->>'action'='portal.rename'),'the activity list shows renames by the teacher and by the administrator');
reset role;

-- ---------------------------------------------------------------- structure
select pg_temp.ok((select bool_and(not has_function_privilege('anon',f,'execute') and has_function_privilege('authenticated',f,'execute')) from unnest(array[
 'public.platform_rename_teaching_space(uuid,text)','public.rename_my_teaching_space(uuid,text)','private.platform_rename_teaching_space(uuid,text)','private.rename_my_teaching_space(uuid,text)']) f),'the rename functions are authenticated-only');
select pg_temp.ok((select bool_and(proconfig @> array['search_path=""']) from pg_proc where proname in ('platform_rename_teaching_space','rename_my_teaching_space','platform_provision_teacher','platform_portal_overview','platform_portal_detail')
 and pronamespace in ('private'::regnamespace,'public'::regnamespace)),'every function touched fixes an empty search_path');
select pg_temp.ok((select bool_and(prosecdef) from pg_proc where oid in ('private.platform_rename_teaching_space(uuid,text)'::regprocedure,'private.rename_my_teaching_space(uuid,text)'::regprocedure,'private.platform_provision_teacher(jsonb,text)'::regprocedure))
 and not (select bool_or(prosecdef) from pg_proc where oid in ('public.platform_rename_teaching_space(uuid,text)'::regprocedure,'public.rename_my_teaching_space(uuid,text)'::regprocedure)),'definer implementations behind invoker wrappers');
select pg_temp.ok((select bool_and(pg_get_functiondef(p.oid) !~ 'auth\.uid\(') from pg_proc p where p.oid in ('private.platform_rename_teaching_space(uuid,text)'::regprocedure,'private.rename_my_teaching_space(uuid,text)'::regprocedure,'private.platform_provision_teacher(jsonb,text)'::regprocedure,'private.platform_portal_overview(integer)'::regprocedure,'private.platform_portal_detail(uuid)'::regprocedure)),'no function uses auth.uid()');
select pg_temp.ok((select pg_get_constraintdef(oid) like '%portal.rename%' from pg_constraint where conname='platform_audit_action_check'),'the audit table accepts the rename action');

select count(*) as teaching_space_name_tests from tsn_results;
rollback;
