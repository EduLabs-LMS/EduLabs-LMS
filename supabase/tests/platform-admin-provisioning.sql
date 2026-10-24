-- Disposable local PostgreSQL only. Synthetic verified-gateway claims exercise database
-- authorization, not token signatures. Every change rolls back; no real account exists.
begin;
create temp table pap_results(name text primary key);
create temp table pap_users(label text primary key,id uuid not null);
grant select,insert on pap_results,pap_users to authenticated,anon;
select set_config('pap.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.pap_results values(label);end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare caught text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught; end if;
 insert into pg_temp.pap_results values(label);end$$;
create function pg_temp.addr(label text) returns text language sql as $$select label||'.'||current_setting('pap.run')||'@example.test'$$;
create function pg_temp.claim(label text,verified boolean default true,email text default null,iss text default 'https://securetoken.google.com/diagonproduction')
returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss',iss,'aud','diagonproduction','role','authenticated','email_verified',verified,
  'email',coalesce(email,pg_temp.addr(label)),'auth_time',floor(extract(epoch from now()))::bigint,
  'sub','pap-'||current_setting('pap.run')||'-'||label)::text,true);end$$;
create function pg_temp.key(k text) returns uuid language sql as $$select current_setting('pap.'||k)::uuid$$;
create function pg_temp.hash(secret text) returns text language sql as $$select encode(sha256(convert_to(secret,'utf8')),'hex')$$;
create function pg_temp.req(email text,extra jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('teacherEmail',email,
  'systems',jsonb_build_array(
   jsonb_build_object('label','Egyptian National','examinationBoard','Ministry of Education',
    'grades',jsonb_build_array(jsonb_build_object('key','g3','label','Third Secondary'),jsonb_build_object('key','g2','label','Second Secondary'))),
   jsonb_build_object('label','British / IG','grades',jsonb_build_array(jsonb_build_object('key','y10','label','Year 10')))),
  'subjects',jsonb_build_array(jsonb_build_object('key','phy','label','Physics'),jsonb_build_object('key','chem','label','Chemistry')),
  'course',jsonb_build_object('title','Physics - Third Secondary','gradeKey','g3','subjectKey','phy')) || extra$$;
create function pg_temp.state() returns text language sql as $$
 select (select count(*) from public.organizations)||'/'||(select count(*) from public.academic_programs)||'/'||(select count(*) from public.academic_stages)
  ||'/'||(select count(*) from public.academic_subjects)||'/'||(select count(*) from public.courses)||'/'||(select count(*) from private.teacher_invitations)
  ||'/'||(select count(*) from private.platform_audit)||'/'||(select count(*) from public.organization_memberships)$$;
create function pg_temp.provision(email text,secret text,extra jsonb default '{}') returns jsonb language sql as $$
 select public.platform_provision_teacher(pg_temp.req(email,extra),pg_temp.hash(secret))$$;

-- Structural protections.
select pg_temp.ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.platform_admins'::regclass,'private.teacher_invitations'::regclass,
 'private.platform_audit'::regclass,'public.academic_subjects'::regclass)),'RLS enabled on every new table');
select pg_temp.ok((select bool_and(not has_table_privilege(r,t,'insert,update,delete,truncate')) from unnest(array['anon','authenticated','service_role']) r
 cross join unnest(array['public.academic_subjects','private.platform_admins','private.teacher_invitations','private.platform_audit']) t),'no API role can write the new tables directly');
select pg_temp.ok((select bool_and(not has_table_privilege(r,t,'select')) from unnest(array['anon','authenticated','service_role']) r
 cross join unnest(array['private.platform_admins','private.teacher_invitations','private.platform_audit']) t),'registries, invitations and audit are unreadable to API roles');
select pg_temp.ok(not has_table_privilege('anon','public.academic_subjects','select'),'anonymous cannot read subjects');
select pg_temp.ok((select bool_and(not has_function_privilege('anon',f,'execute') and has_function_privilege('authenticated',f,'execute')) from unnest(array[
 'public.platform_provision_teacher(jsonb,text)','public.platform_reissue_teacher_invitation(uuid,text,integer,text)','public.platform_revoke_teacher_invitation(uuid)',
 'public.accept_teacher_invitation(text)','public.platform_portal_overview(integer)','public.platform_portal_detail(uuid)','public.is_platform_admin()']) f),'RPCs are authenticated-only');
select pg_temp.ok((select bool_and(not has_function_privilege(r,f,'execute')) from unnest(array['anon','authenticated']) r cross join unnest(array[
 'private.slugify(text,text)','private.next_free_slug(text,text[])','private.clean_text(jsonb,integer,text)','private.token_hash_bytes(text)',
 'private.write_platform_audit(uuid,text,text,uuid,uuid,jsonb)']) f),'helper functions are not callable by API roles');
select pg_temp.ok((select bool_and(proconfig @> array['search_path=""']) from pg_proc where pronamespace in ('private'::regnamespace,'public'::regnamespace)
 and proname in ('platform_provision_teacher','platform_reissue_teacher_invitation','platform_revoke_teacher_invitation','accept_teacher_invitation',
 'platform_portal_overview','platform_portal_detail','is_platform_admin','slugify','next_free_slug','clean_text','token_hash_bytes','write_platform_audit','platform_audit_append_only','teacher_invitation_guard')),'new functions fix an empty search path');
select pg_temp.ok((select bool_and(prosecdef) from pg_proc where oid in ('private.platform_provision_teacher(jsonb,text)'::regprocedure,'private.accept_teacher_invitation(text)'::regprocedure))
 and not (select prosecdef from pg_proc where oid='public.platform_provision_teacher(jsonb,text)'::regprocedure),'definer implementation behind invoker wrapper');

-- Existing tenant with the full student path, created before any provisioning.
set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','revoked','teacher','other','orgowner','student','support'] loop
  perform pg_temp.claim(label);
  insert into pg_temp.pap_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from pap_users where label='admin';
insert into private.platform_admins(user_id,active,note) select id,false,'revoked test admin' from pap_users where label='revoked';
insert into private.support_operators(user_id) select id from pap_users where label='support';
select set_config('pap.old_org',(select gen_random_uuid()::text),true);
insert into public.organizations(id,name,slug) values(pg_temp.key('old_org'),'Existing tenant','pap-existing-'||current_setting('pap.run'));
insert into public.organization_memberships(organization_id,user_id,role,status,joined_at)
 select pg_temp.key('old_org'),id,'owner','active',now() from pap_users where label='orgowner';
select set_config('pap.old_course',(select gen_random_uuid()::text),true);
insert into public.courses(id,organization_id,title,slug,status,visibility) values(pg_temp.key('old_course'),pg_temp.key('old_org'),'Existing course','existing','published','private');
select set_config('pap.old_offering',(select gen_random_uuid()::text),true);
insert into public.course_offerings(id,course_id,name,status) values(pg_temp.key('old_offering'),pg_temp.key('old_course'),'Existing offering','active');
insert into public.enrollments(offering_id,user_id,status) select pg_temp.key('old_offering'),id,'active' from pap_users where label='student';
set local role authenticated;
select pg_temp.claim('orgowner');
select set_config('pap.old_program',public.academic_command('program.create',pg_temp.key('old_org'),null,null,'{"label":"Existing curriculum","slug":"existing-curriculum"}')->>'id',true);
select set_config('pap.old_stage',public.academic_command('stage.create',pg_temp.key('old_org'),null,null,
 jsonb_build_object('label','Existing grade','slug','existing-grade','programId',pg_temp.key('old_program')))->>'id',true);
reset role;
select set_config('pap.before_state',pg_temp.state(),true);
select pg_temp.ok((select count(*)=0 from public.courses where subject_id is not null) and (select count(*)=0 from public.academic_programs where examination_board is not null),
 'migration leaves existing courses subject-less and programs without a board (no backfill)');

-- Who is a platform administrator.
set local role authenticated;
select pg_temp.claim('admin');   select pg_temp.ok(public.is_platform_admin(),'verified registered administrator is recognized');
select pg_temp.claim('revoked'); select pg_temp.ok(not public.is_platform_admin(),'deactivated administrator is not recognized');
select pg_temp.claim('orgowner');select pg_temp.ok(not public.is_platform_admin(),'organization owner is not a platform administrator');
select pg_temp.claim('support'); select pg_temp.ok(not public.is_platform_admin(),'support operator is not a platform administrator');
select pg_temp.claim('student'); select pg_temp.ok(not public.is_platform_admin(),'student is not a platform administrator');
select pg_temp.claim('admin',false); select pg_temp.ok(not public.is_platform_admin(),'unverified claims for the admin subject are rejected');
select pg_temp.claim('admin',true,null,'https://example.invalid'); select pg_temp.ok(not public.is_platform_admin(),'foreign issuer with the admin subject is rejected');

-- Every privileged operation is denied to everyone who is not an administrator.
do $$ declare label text; begin
 foreach label in array array['revoked','teacher','orgowner','support','student'] loop
  perform pg_temp.claim(label);
  perform pg_temp.denied(format($s$select pg_temp.provision(%L,'x-secret-%s')$s$,pg_temp.addr('someone'),label),'42501','provision denied to '||label);
  perform pg_temp.denied(format($s$select public.platform_portal_overview(10)$s$),'42501','overview denied to '||label);
  perform pg_temp.denied(format($s$select public.platform_portal_detail(%L)$s$,pg_temp.key('old_org')),'42501','detail denied to '||label);
  perform pg_temp.denied(format($s$select public.platform_revoke_teacher_invitation(%L)$s$,pg_temp.key('old_org')),'42501','revoke denied to '||label);
  perform pg_temp.denied(format($s$select public.platform_reissue_teacher_invitation(%L,%L,7)$s$,pg_temp.key('old_org'),pg_temp.hash('r-'||label)),'42501','reissue denied to '||label);
 end loop;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"nobody"}',true);
select pg_temp.denied($s$select pg_temp.provision('someone@example.test','x-unmapped')$s$,'42501','unmapped identity denied');
set local role anon;
select pg_temp.denied($s$select public.platform_provision_teacher('{}'::jsonb,'00')$s$,'42501','anonymous provisioning denied');
select pg_temp.denied($s$select public.accept_teacher_invitation('00')$s$,'42501','anonymous acceptance denied');
select pg_temp.denied($s$select * from public.academic_subjects$s$,'42501','anonymous subject read denied');
reset role;
select pg_temp.ok(pg_temp.state()=current_setting('pap.before_state'),'denied calls changed nothing');

-- Successful provisioning.
set local role authenticated;
select pg_temp.claim('admin');
select set_config('pap.prov',pg_temp.provision(upper(pg_temp.addr('teacher')),'secret-teacher-1')::text,true);
reset role;
select set_config('pap.org',(current_setting('pap.prov')::jsonb)->>'organizationId',true);
select set_config('pap.inv',(current_setting('pap.prov')::jsonb)->>'invitationId',true);
select set_config('pap.course',(current_setting('pap.prov')::jsonb)->>'courseId',true);
select pg_temp.ok((select name='Pending teacher portal' and status='active' and created_by is null from public.organizations where id=pg_temp.key('org')),
 'portal created with a neutral placeholder name, no invented display name and no creator ownership');
select pg_temp.ok((select count(*)=0 from public.organization_memberships where organization_id=pg_temp.key('org')),'no owner membership before acceptance');
select pg_temp.ok((select count(*)=0 from public.organization_websites where organization_id=pg_temp.key('org')),'creating a portal activates no public site or domain');
select pg_temp.ok((select status='pending' and email=lower(pg_temp.addr('teacher')) and token_hash=sha256(convert_to('secret-teacher-1','utf8'))
 and expires_at>now()+interval '6 days' and expires_at<now()+interval '8 days' from private.teacher_invitations where id=pg_temp.key('inv')),
 'invitation is pending, email-bound (normalized), stores only the secret hash and expires in 7 days by default');
select pg_temp.ok((select count(*)=2 and bool_or(label='Egyptian National' and examination_board='Ministry of Education') and bool_or(label='British / IG' and examination_board is null)
 from public.academic_programs where organization_id=pg_temp.key('org')),'education systems created tenant-owned with an optional board');
select pg_temp.ok((select count(*)=3 from public.academic_stages where organization_id=pg_temp.key('org')) and
 (select count(*)=2 from public.academic_stages s join public.academic_programs p on p.id=s.program_id where p.label='Egyptian National' and s.organization_id=pg_temp.key('org')),
 'grade levels belong to the intended education system');
select pg_temp.ok((select count(*)=2 from public.academic_subjects where organization_id=pg_temp.key('org')),'subjects created tenant-owned');
select pg_temp.ok((select title='Physics - Third Secondary' and status='draft' and visibility='private' and created_by is null
 and subject_id=(select id from public.academic_subjects where organization_id=pg_temp.key('org') and label='Physics') from public.courses where id=pg_temp.key('course')),
 'first course is a private draft linked to its subject');
select pg_temp.ok((select count(*)=1 and bool_and(s.label='Third Secondary' and a.organization_id=pg_temp.key('org')) from public.course_stage_assignments a
 join public.academic_stages s on s.id=a.stage_id where a.course_id=pg_temp.key('course')),'first course is assigned to the intended grade level');
select pg_temp.ok((select revision=1 from private.course_stage_versions where course_id=pg_temp.key('course')),'classification revision recorded');
select pg_temp.ok((select count(*)=0 from public.course_modules where course_id=pg_temp.key('course')) and (select count(*)=0 from public.course_offerings where course_id=pg_temp.key('course'))
 and (select count(*)=0 from public.enrollments e join public.course_offerings o on o.id=e.offering_id where o.course_id=pg_temp.key('course'))
 and (select count(*)=1 from public.courses where organization_id=pg_temp.key('org')),'the course is created empty: no chapters, offerings, students or extra courses');
select pg_temp.ok((select count(*)=1 and bool_and(actor_id=(select id from pap_users where label='admin') and organization_id=pg_temp.key('org') and target_type='organization')
 from private.platform_audit where action='portal.provision' and organization_id=pg_temp.key('org')),'provisioning is audited with actor and target');
select pg_temp.ok((select count(*)=1 from private.platform_audit where detail::text like '%secret%')=false,'no invitation secret is written to the audit trail');

-- Slugs are generated, never typed.
set local role authenticated;
select pg_temp.claim('admin');
select set_config('pap.prov2',pg_temp.provision(pg_temp.addr('other'),'secret-other-1',jsonb_build_object('systems',jsonb_build_array(jsonb_build_object('label','المنهج المصري',
 'grades',jsonb_build_array(jsonb_build_object('key','a','label','الصف الثالث الثانوي'),jsonb_build_object('key','b','label','الصف الثاني الثانوي')))),
 'subjects',jsonb_build_array(jsonb_build_object('key','p1','label','Physics'),jsonb_build_object('key','p2','label','Physics!')),
 'course',jsonb_build_object('title','الفيزياء','gradeKey','a','subjectKey','p1'),'expiresInDays',14))::text,true);
reset role;
select set_config('pap.org2',(current_setting('pap.prov2')::jsonb)->>'organizationId',true);
select pg_temp.ok((select array_agg(slug order by position) = array['education-system'] from public.academic_programs where organization_id=pg_temp.key('org2')),'non-Latin names get a generated fallback slug');
select pg_temp.ok((select array_agg(slug order by position) = array['grade-level','grade-level-2'] from public.academic_stages where organization_id=pg_temp.key('org2')),'generated slugs stay unique inside one education system');
select pg_temp.ok((select array_agg(slug order by position) = array['physics','physics-2'] from public.academic_subjects where organization_id=pg_temp.key('org2')),'colliding subject slugs are suffixed');
select pg_temp.ok((select slug='course' from public.courses where organization_id=pg_temp.key('org2')),'course slug is generated');
select pg_temp.ok((select expires_at>now()+interval '13 days' from private.teacher_invitations where organization_id=pg_temp.key('org2')),'selected invitation lifetime is honored');

-- Validation failures are atomic: nothing is left behind.
select set_config('pap.snapshot',pg_temp.state(),true);
set local role authenticated;
select pg_temp.claim('admin');
select pg_temp.denied($s$select pg_temp.provision('not-an-email','f1')$s$,'22023','malformed email rejected');
select pg_temp.denied($s$select pg_temp.provision('dup@example.test','f2','{"extra":1}')$s$,'22023','unknown request field rejected');
select pg_temp.denied($s$select public.platform_provision_teacher(pg_temp.req('f3@example.test'),'abc')$s$,'22023','malformed token hash rejected');
select pg_temp.denied($s$select pg_temp.provision('f4@example.test','f4','{"expiresInDays":365}')$s$,'22023','unsupported invitation lifetime rejected');
select pg_temp.denied($s$select pg_temp.provision('f5@example.test','f5','{"course":{"title":"X","gradeKey":"nope","subjectKey":"phy"}}')$s$,'22023','course must use a configured grade level (detected after inserts, fully rolled back)');
select pg_temp.denied($s$select pg_temp.provision('f6@example.test','f6','{"course":{"title":"X","gradeKey":"g3","subjectKey":"nope"}}')$s$,'22023','course must use a configured subject');
select pg_temp.denied($s$select pg_temp.provision('f7@example.test','f7','{"course":{"title":"  ","gradeKey":"g3","subjectKey":"phy"}}')$s$,'22023','blank course title rejected');
select pg_temp.denied($s$select pg_temp.provision('f8@example.test','f8','{"subjects":[{"key":"phy","label":"Physics"},{"key":"x","label":" physics "}]}')$s$,'23505','duplicate subject names rejected');
select pg_temp.denied($s$select pg_temp.provision('f9@example.test','f9','{"subjects":[{"key":"phy","label":"Physics"},{"key":"phy","label":"Other"}]}')$s$,'22023','repeated key rejected');
select pg_temp.denied($s$select pg_temp.provision('f10@example.test','f10','{"systems":[]}')$s$,'22023','at least one education system required');
select pg_temp.denied($s$select pg_temp.provision('f11@example.test','f11','{"systems":[{"label":"A","grades":[]}]}')$s$,'22023','every system needs a grade level');
select pg_temp.denied($s$select pg_temp.provision('f12@example.test','f12','{"systems":[{"label":"A","role":"owner","grades":[{"key":"g3","label":"G"}]}]}')$s$,'22023','privilege-looking fields rejected');
select pg_temp.denied($s$select pg_temp.provision('f13@example.test','f13','{"systems":[{"label":"A","examinationBoard":5,"grades":[{"key":"g3","label":"G"}]}]}')$s$,'22023','board must be text');
select pg_temp.denied($s$select pg_temp.provision('f14@example.test','f14','{"systems":[{"label":"A","grades":[{"key":"g3","label":"G"}]},{"label":" a ","grades":[{"key":"h","label":"H"}]}]}')$s$,'23505','duplicate education systems rejected');
select pg_temp.denied(format($s$select pg_temp.provision(%L,'f15')$s$,upper(pg_temp.addr('teacher'))),'23505','second pending invitation for the same email rejected (case-insensitive)');
select pg_temp.denied($s$select public.platform_provision_teacher(pg_temp.req('f16@example.test'),pg_temp.hash('secret-teacher-1'))$s$,'23505','secret hash must be unique');
reset role;
select pg_temp.ok(pg_temp.state()=current_setting('pap.snapshot'),'every rejected provisioning left no portal, academic record, invitation or audit entry behind');

-- Overview and detail show provisioned portals only.
set local role authenticated;
select pg_temp.claim('admin');
select pg_temp.ok((select jsonb_array_length(public.platform_portal_overview(50)->'items')=2 and (public.platform_portal_overview(50)->>'hasMore')='false'),'overview lists only the two provisioned portals');
select pg_temp.ok(not (public.platform_portal_overview(50)::text like '%Existing tenant%') and not (public.platform_portal_overview(50)::text like '%Existing course%'),'existing development tenants are not listed or rewritten');
select pg_temp.ok((select public.platform_portal_overview(1)->>'hasMore')='true' and jsonb_array_length(public.platform_portal_overview(1)->'items')=1,'overview pages are bounded');
select pg_temp.ok((select x->>'invitationStatus'='pending' and x->'course'->>'subject'='Physics' and x->'course'->>'grade'='Third Secondary'
 and x->'course'->>'educationSystem'='Egyptian National' and x->'course'->>'examinationBoard'='Ministry of Education'
 from jsonb_array_elements(public.platform_portal_overview(50)->'items') x where x->>'organizationId'=current_setting('pap.org')),'overview shows status and the configured path');
select pg_temp.ok((select (d->>'hasOwner')='false' and jsonb_array_length(d->'invitations')=1 and jsonb_array_length(d->'educationSystems')=2
 and jsonb_array_length(d->'subjects')=2 and jsonb_array_length(d->'courses')=1 and d->'activity'->0->>'action'='portal.provision'
 and d->'activity'->0->>'actor'='administrator' from (select public.platform_portal_detail(pg_temp.key('org')) d) q),'detail shows structure, invitation and activity');
select pg_temp.ok(not (public.platform_portal_detail(pg_temp.key('org'))::text like '%secret%') and not (public.platform_portal_detail(pg_temp.key('org'))::text like '%token%'),'detail never exposes a secret or token');
select pg_temp.denied(format($s$select public.platform_portal_detail(%L)$s$,pg_temp.key('old_org')),'PT404','detail of a non-provisioned tenant is not available');
select pg_temp.denied($s$select public.platform_portal_detail(gen_random_uuid())$s$,'PT404','unknown portal not found');
-- A platform administrator has no implicit tenant data access.
select pg_temp.ok((select count(*)=0 from public.courses where organization_id in (pg_temp.key('org'),pg_temp.key('old_org')))
 and (select count(*)=0 from public.academic_subjects) and (select count(*)=0 from public.academic_programs),'platform administration confers no tenant read access');

-- Acceptance constraints.
select pg_temp.claim('teacher');
select pg_temp.denied($s$select public.accept_teacher_invitation('not-hex')$s$,'22023','malformed secret hash rejected');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('wrong-secret')),'PT404','unknown secret reveals nothing');
select pg_temp.claim('other');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-teacher-1')),'42501','a different verified email cannot accept');
select pg_temp.claim('teacher',false);
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-teacher-1')),'42501','unverified email cannot accept');
select pg_temp.claim('teacher',true,null,'https://example.invalid');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-teacher-1')),'42501','foreign issuer cannot accept');
select pg_temp.claim('teacher',true,pg_temp.addr('other'));
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-teacher-1')),'42501','a verified email claim for another address cannot accept');
select pg_temp.claim('student');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-teacher-1')),'42501','an unrelated student cannot accept');
reset role;
select pg_temp.ok((select status='pending' from private.teacher_invitations where id=pg_temp.key('inv')) and
 (select count(*)=0 from public.organization_memberships where organization_id=pg_temp.key('org')),'rejected acceptances changed nothing');

-- Expired and revoked secrets (time moved by editing the stored row as the database owner).
update private.teacher_invitations set created_at=now()-interval '10 days',expires_at=now()-interval '1 day' where id=pg_temp.key('inv');
set local role authenticated;
select pg_temp.claim('teacher');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-teacher-1')),'PT410','expired invitation cannot be accepted');
select pg_temp.claim('admin');
select pg_temp.ok((select x->>'invitationStatus'='expired' from jsonb_array_elements(public.platform_portal_overview(50)->'items') x where x->>'organizationId'=current_setting('pap.org')),'expired status is derived from the expiry time');

-- Reissue supersedes the old secret; the old secret becomes unusable.
select set_config('pap.reissue',public.platform_reissue_teacher_invitation(pg_temp.key('org'),pg_temp.hash('secret-teacher-2'),3)::text,true);
reset role;
select pg_temp.ok((select count(*)=1 and bool_and(status='pending' and expires_at<now()+interval '4 days') from private.teacher_invitations where organization_id=pg_temp.key('org') and status='pending')
 and (select count(*)=1 from private.teacher_invitations where id=pg_temp.key('inv') and status='revoked' and revoke_reason='superseded'),'reissue supersedes the earlier invitation and keeps one pending');
set local role authenticated;
select pg_temp.claim('teacher');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-teacher-1')),'PT410','a superseded secret cannot be used');
select pg_temp.claim('admin');
select pg_temp.denied(format($s$select public.platform_reissue_teacher_invitation(%L,%L,7,%L)$s$,pg_temp.key('org'),pg_temp.hash('s-x'),pg_temp.addr('other')),'23505','reissue cannot move to an email with another pending invitation');
select pg_temp.denied(format($s$select public.platform_reissue_teacher_invitation(%L,%L,99)$s$,pg_temp.key('org'),pg_temp.hash('s-y')),'22023','unsupported lifetime rejected on reissue');
select pg_temp.denied(format($s$select public.platform_reissue_teacher_invitation(gen_random_uuid(),%L,7)$s$,pg_temp.hash('s-z')),'PT404','reissue of an unknown portal rejected');

-- Revoke.
select public.platform_revoke_teacher_invitation(pg_temp.key('org2'));
select pg_temp.denied(format($s$select public.platform_revoke_teacher_invitation(%L)$s$,pg_temp.key('org2')),'PT409','nothing left to revoke');
select pg_temp.claim('other');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-other-1')),'PT410','revoked invitation cannot be accepted');

-- Acceptance succeeds once, binds the owner role and nothing else.
select pg_temp.claim('teacher');
select set_config('pap.accepted',public.accept_teacher_invitation(pg_temp.hash('secret-teacher-2'))::text,true);
select pg_temp.ok((current_setting('pap.accepted')::jsonb->>'organizationId')=current_setting('pap.org'),'acceptance returns the tenant stored on the invitation');
select pg_temp.ok((select count(*)=1 and bool_and(role='owner' and status='active') from public.organization_memberships where organization_id=pg_temp.key('org')
 and user_id=(select id from pap_users where label='teacher')),'accepted teacher becomes the active owner');
select pg_temp.ok(private.can_edit_course(pg_temp.key('course')) and (select count(*)=1 from public.courses where id=pg_temp.key('course')),'owner can reach the empty first course');
select pg_temp.ok((select count(*)=2 from public.academic_programs) and (select count(*)=2 from public.academic_subjects),'owner sees only the new portal structure');
select pg_temp.ok((select count(*)=0 from public.courses where organization_id=pg_temp.key('old_org')),'owner of one portal cannot read another tenant');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-teacher-2')),'PT409','a used invitation cannot be accepted again');
select pg_temp.claim('admin');
select pg_temp.denied(format($s$select public.platform_reissue_teacher_invitation(%L,%L,7)$s$,pg_temp.key('org'),pg_temp.hash('after-accept')),'PT409','accepted invitations cannot be reissued');
select pg_temp.denied(format($s$select public.platform_revoke_teacher_invitation(%L)$s$,pg_temp.key('org')),'PT409','accepted invitations cannot be revoked');
select pg_temp.ok((select d->>'hasOwner'='true' and d->'invitations'->0->>'status'='accepted' from (select public.platform_portal_detail(pg_temp.key('org')) d) q),'detail reports the connected owner');
select pg_temp.ok((public.platform_portal_detail(pg_temp.key('org'))->'activity') @> '[{"action":"invitation.accept","actor":"teacher"}]'::jsonb
 and (public.platform_portal_detail(pg_temp.key('org'))->'activity') @> '[{"action":"invitation.reissue","actor":"administrator"}]'::jsonb,'acceptance and reissue appear in the activity log');
reset role;
select pg_temp.ok((select count(*)=3 from private.platform_audit where organization_id=pg_temp.key('org')) and
 (select count(*)=1 from private.platform_audit where action='invitation.revoke' and organization_id=pg_temp.key('org2')),'revocation is audited');
select pg_temp.denied($s$update private.platform_audit set detail='{}'$s$,'42501','audit rows cannot be updated');
select pg_temp.denied($s$delete from private.platform_audit$s$,'42501','audit rows cannot be deleted');
select pg_temp.denied($s$truncate private.platform_audit$s$,'42501','audit table cannot be truncated');

-- Tenant isolation and compatibility with existing student and teacher functionality.
set local role authenticated;
select pg_temp.claim('orgowner');
select pg_temp.ok((select count(*)=0 from public.academic_subjects) and (select count(*)=1 from public.academic_programs) and (select count(*)=0 from public.courses where organization_id=pg_temp.key('org')),
 'an existing tenant owner cannot see provisioned portals');
select pg_temp.ok((public.academic_command('program.create',pg_temp.key('old_org'),null,null,'{"label":"Second curriculum","slug":"second-curriculum"}')->>'id') is not null,'existing academic command still works');
select pg_temp.denied(format($s$select public.academic_command('program.create',%L,null,null,'{"label":"Hijack","slug":"hijack"}')$s$,pg_temp.key('org')),'42501','existing command cannot write a provisioned tenant for a non-member');
select pg_temp.claim('student');
select pg_temp.ok((select count(*)=2 from public.academic_programs) and (select count(*)=0 from public.academic_subjects),'enrolled student still sees only the enrolled tenant academic choices');
select pg_temp.ok((public.set_student_stage_preference(pg_temp.key('old_program'),pg_temp.key('old_stage'),0)->>'stage_id')=pg_temp.key('old_stage')::text,'student stage selection still works');
select pg_temp.claim('teacher');
select pg_temp.denied(format($s$select public.set_student_stage_preference(%L,%L,0)$s$,pg_temp.key('old_program'),pg_temp.key('old_stage')),'42501','a portal owner cannot use another tenant''s student selection');
reset role;
-- Direct SQL cannot cross tenants even for the database owner's constraints.
select pg_temp.denied(format($s$update public.courses set subject_id=(select id from public.academic_subjects where organization_id=%L limit 1) where id=%L$s$,pg_temp.key('org'),pg_temp.key('old_course')),'23503','a course cannot reference another tenant''s subject');
select pg_temp.denied(format($s$insert into public.course_stage_assignments(course_id,stage_id,organization_id) values(%L,%L,%L)$s$,pg_temp.key('old_course'),
 (select id from public.academic_stages where organization_id=current_setting('pap.org')::uuid limit 1),pg_temp.key('old_org')),'23503','a course cannot be assigned a grade level of another tenant');
select pg_temp.denied(format($s$delete from public.academic_subjects where organization_id=%L$s$,pg_temp.key('org')),'23503','a referenced subject cannot be deleted');
select pg_temp.denied(format($s$delete from public.organizations where id=%L$s$,pg_temp.key('org')),'23503','a provisioned portal cannot be deleted');
select pg_temp.denied(format($s$insert into private.teacher_invitations(organization_id,email,token_hash,expires_at,created_by) select %L,'dup@example.test',sha256('x'),now()+interval '1 day',id from pap_users where label='admin'$s$,pg_temp.key('org')),'23505','only one accepted or pending invitation per portal');
select pg_temp.ok((select count(*)=2 from public.academic_programs where organization_id=pg_temp.key('old_org'))
 and (select count(*)=1 from public.courses where id=pg_temp.key('old_course') and subject_id is null)
 and (select count(*)=1 from public.enrollments e where e.offering_id=pg_temp.key('old_offering')),'existing tenant records are untouched by provisioning');

select count(*) as platform_admin_provisioning_tests from pap_results;
rollback;
