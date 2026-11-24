-- Run as postgres against an isolated DEVELOPMENT database after migration 17.
-- Simulated verified gateway claims exercise database authorization, not token signatures.
-- No real accounts or fixture commits: every change rolls back.
begin;
create temp table org_test_results(name text primary key);
create temp table org_test_users(label text primary key,id uuid not null);
grant select,insert on org_test_results,org_test_users to authenticated,anon;
select set_config('org_test.run',gen_random_uuid()::text,true);
create function pg_temp.ok(value boolean,label text) returns void language plpgsql set search_path='' as $$
begin
 if value is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.org_test_results values(label);
end $$;
create function pg_temp.denied(statement text,label text) returns void language plpgsql set search_path='' as $$
declare caught text;
begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from '42501' then raise exception 'FAILED %, SQLSTATE %',label,caught; end if;
 insert into pg_temp.org_test_results values(label);
end $$;
create function pg_temp.claim(label text) returns void language plpgsql set search_path='' as $$
begin
 perform set_config('request.jwt.claims',jsonb_build_object(
  'iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction',
  'role','authenticated','email_verified',true,'auth_time',floor(extract(epoch from now()))::bigint,
  'sub','org-security-'||current_setting('org_test.run')||'-'||label)::text,true);
end $$;

select pg_temp.ok(not has_function_privilege(r,f,'EXECUTE'),r||' cannot execute '||f)
from unnest(array['anon','authenticated']) r
cross join unnest(array['public.create_organization(text,text)','private.create_organization(text,text)']) f;
select pg_temp.ok(has_function_privilege('postgres',f,'EXECUTE'),'postgres retains '||f)
from unnest(array['public.create_organization(text,text)','private.create_organization(text,text)']) f;
select pg_temp.ok(has_function_privilege('service_role','public.create_organization(text,text)','EXECUTE')
 and not has_function_privilege('service_role','private.create_organization(text,text)','EXECUTE'),
 'existing service_role function privileges unchanged');

-- Create synthetic active Firebase profiles through the unchanged identity workflow.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['owner-a','owner-b','admin-a','teacher-a','student'] loop
  perform pg_temp.claim(label);
  insert into pg_temp.org_test_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;

-- Trusted provisioning: each organization + first active owner is one SQL statement.
with organization as (
 insert into public.organizations(name,slug,created_by)
 select 'Security fixture A','org-security-a-'||current_setting('org_test.run'),id
 from org_test_users where label='owner-a' returning id,created_by
), membership as (
 insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select id,created_by,'owner','active',now() from organization returning organization_id
)
select set_config('org_test.a',organization_id::text,true) from membership;
with organization as (
 insert into public.organizations(name,slug,created_by)
 select 'Security fixture B','org-security-b-'||current_setting('org_test.run'),id
 from org_test_users where label='owner-b' returning id,created_by
), membership as (
 insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select id,created_by,'owner','active',now() from organization returning organization_id
)
select set_config('org_test.b',organization_id::text,true) from membership;
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
select current_setting('org_test.a')::uuid,id,
 case label when 'admin-a' then 'admin' else 'teacher' end,'active',now()
from org_test_users where label in ('admin-a','teacher-a');
select pg_temp.ok((select count(*)=2 from public.organizations o
 join public.organization_memberships m on m.organization_id=o.id and m.user_id=o.created_by
 where o.id in (current_setting('org_test.a')::uuid,current_setting('org_test.b')::uuid)
 and m.role='owner' and m.status='active' and m.joined_at is not null),
 'trusted provisioning creates both tenants and initial active owners');

-- A failed membership insert rolls back its organization too (PL/pgSQL subtransaction).
do $$ declare caught text; invalid_owner uuid := gen_random_uuid(); begin
 while exists(select 1 from public.profiles where id=invalid_owner) loop invalid_owner:=gen_random_uuid(); end loop;
 begin
  with organization as (
   insert into public.organizations(name,slug) values('Invalid owner','org-security-failed-'||current_setting('org_test.run')) returning id
  )
  insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
  select id,invalid_owner,'owner','active',now() from organization;
 exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 perform pg_temp.ok(caught='23503','invalid initial owner fails foreign key');
 perform pg_temp.ok(not exists(select 1 from public.organizations where slug='org-security-failed-'||current_setting('org_test.run')),
 'failed provisioning leaves no orphan organization');
end $$;

select set_config('org_test.organization_count',(select count(*)::text from public.organizations),true);
select set_config('org_test.membership_count',(select count(*)::text from public.organization_memberships),true);
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['student','owner-a','admin-a','teacher-a'] loop
  perform pg_temp.claim(label);
  perform pg_temp.denied($s$select public.create_organization('Forbidden','org-security-forbidden-'||current_setting('org_test.run'))$s$,label||' denied public RPC');
  perform pg_temp.denied($s$select private.create_organization('Forbidden','org-security-forbidden-'||current_setting('org_test.run'))$s$,label||' denied private function');
 end loop;
end $$;
select pg_temp.claim('student');
select pg_temp.denied($s$insert into public.organizations(name,slug) values('Forbidden','org-security-direct-'||current_setting('org_test.run'))$s$,'student direct organization insert denied');
select pg_temp.denied($s$insert into public.organization_memberships(organization_id,user_id,role,status) values(current_setting('org_test.a')::uuid,public.current_profile_id(),'owner','active')$s$,'student cannot assign self tenant ownership');
select pg_temp.denied($s$select public.create_teacher_course(current_setting('org_test.a')::uuid,'Forbidden','forbidden')$s$,'student cannot create teacher content');
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.denied($s$select public.create_organization('Forbidden','org-security-anon')$s$,'anonymous public RPC denied');
select pg_temp.denied($s$select private.create_organization('Forbidden','org-security-anon')$s$,'anonymous private function denied');
reset role;
select pg_temp.ok((select count(*)::text from public.organizations)=current_setting('org_test.organization_count'),'denied calls create no organizations');
select pg_temp.ok((select count(*)::text from public.organization_memberships)=current_setting('org_test.membership_count'),'denied calls create no memberships');

set local role authenticated;
select pg_temp.claim('owner-b');
select set_config('org_test.course_b',public.create_teacher_course(current_setting('org_test.b')::uuid,'Private B','private-b')::text,true);
select pg_temp.claim('owner-a');
select pg_temp.ok((public.rename_my_teaching_space(current_setting('org_test.a')::uuid,'Security fixture A edited')->>'name')='Security fixture A edited','owner renames own organization through the function');
select pg_temp.denied($s$update public.organizations set name='Direct rename' where id=current_setting('org_test.a')::uuid$s$,'a direct organization update is closed, even for the owner');
select set_config('org_test.course_a',public.create_teacher_course(current_setting('org_test.a')::uuid,'Private A','private-a')::text,true);
select pg_temp.ok((select title='Private A' from public.courses where id=current_setting('org_test.course_a')::uuid),'owner creates own course');
select pg_temp.claim('teacher-a');
select set_config('org_test.teacher_course',public.create_teacher_course(current_setting('org_test.a')::uuid,'Teacher draft','teacher-draft')::text,true);
select pg_temp.ok((public.course_update(current_setting('org_test.teacher_course')::uuid,(select updated_at from public.courses where id=current_setting('org_test.teacher_course')::uuid),'{"title":"Teacher edited","status":"published"}')->>'id')=current_setting('org_test.teacher_course'),'assigned teacher edits and publishes own course through the function');

do $$ declare label text; changed_count integer; begin
 foreach label in array array['owner-a','admin-a','teacher-a','student'] loop
  perform pg_temp.claim(label);
  perform pg_temp.ok((select count(*)=0 from public.organizations where id=current_setting('org_test.b')::uuid),label||' cannot read tenant B organization');
  perform pg_temp.ok((select count(*)=0 from public.organization_memberships where organization_id=current_setting('org_test.b')::uuid),label||' cannot read tenant B memberships');
  perform pg_temp.ok((select count(*)=0 from public.courses where id=current_setting('org_test.course_b')::uuid),label||' cannot read private B course');
  perform pg_temp.denied($s$select public.create_teacher_course(current_setting('org_test.b')::uuid,'Forbidden','forbidden')$s$,label||' cannot create B course');
  perform pg_temp.denied($s$insert into public.organization_memberships(organization_id,user_id,role,status) values(current_setting('org_test.b')::uuid,public.current_profile_id(),'teacher','active')$s$,label||' cannot join B staff');
  perform pg_temp.denied($s$update public.organizations set name='Forbidden' where id=current_setting('org_test.b')::uuid$s$,label||' cannot update B organization (direct update closed)');
  perform pg_temp.denied($s$update public.courses set title='Forbidden' where id=current_setting('org_test.course_b')::uuid$s$,label||' cannot update B course (direct update closed)');
  perform pg_temp.denied($s$select public.course_update(current_setting('org_test.course_b')::uuid,now(),'{"title":"Forbidden"}')$s$,label||' cannot update B course through the function');
 end loop;
end $$;
select pg_temp.claim('student');
select pg_temp.denied($s$select public.course_update(current_setting('org_test.teacher_course')::uuid,now(),'{"title":"Forbidden"}')$s$,'student cannot edit teacher content');
select pg_temp.claim('owner-a');
do $$ declare caught text; begin
 begin update public.organization_memberships set status='suspended'
 where organization_id=current_setting('org_test.a')::uuid and user_id=public.current_profile_id();
 exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 perform pg_temp.ok(caught='42501','a direct membership change is closed, even for the last owner');
end $$;
reset role;
do $$ declare caught text; begin
 begin update public.organization_memberships set status='suspended'
 where organization_id=current_setting('org_test.a')::uuid and user_id=public.current_profile_id();
 exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 perform pg_temp.ok(caught='23514','last active owner remains protected by the trigger');
end $$;
select pg_temp.ok((select name='Security fixture B' from public.organizations where id=current_setting('org_test.b')::uuid),'tenant B actually exists and remains unchanged');
select pg_temp.ok((select title='Private B' from public.courses where id=current_setting('org_test.course_b')::uuid),'tenant B course actually exists and remains unchanged');
select pg_temp.ok((select title='Teacher edited' and status='published' from public.courses where id=current_setting('org_test.teacher_course')::uuid),'authorized teacher changes persist inside transaction');
select jsonb_build_object('passed',count(*),'checks',jsonb_agg(name order by name)) as organization_provisioning_tests from org_test_results;
rollback;
