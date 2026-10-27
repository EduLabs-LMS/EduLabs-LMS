-- Disposable local PostgreSQL only. Synthetic verified-gateway claims exercise database authorization, not token signatures.
-- Every change rolls back; no real account, e-mail address or secret exists.
begin;
create temp table tid_results(name text primary key);
create temp table tid_users(label text primary key,id uuid not null);
grant select,insert on tid_results,tid_users to authenticated,anon;
select set_config('tid.run',gen_random_uuid()::text,true);
create function pg_temp.ok(v boolean,label text) returns void language plpgsql set search_path='' as $$begin
 if v is distinct from true then raise exception 'FAILED %',label; end if;
 insert into pg_temp.tid_results values(label);end$$;
create function pg_temp.denied(statement text,code text,label text) returns void language plpgsql set search_path='' as $$declare caught text;begin
 begin execute statement; exception when others then get stacked diagnostics caught=returned_sqlstate; end;
 if caught is distinct from code then raise exception 'FAILED % expected % got %',label,code,caught; end if;
 insert into pg_temp.tid_results values(label);end$$;
create function pg_temp.addr(label text) returns text language sql as $$select label||'.'||current_setting('tid.run')||'@example.test'$$;
create function pg_temp.claim(label text,verified boolean default true,email text default null)
returns void language plpgsql set search_path='' as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('iss','https://securetoken.google.com/diagonproduction','aud','diagonproduction','role','authenticated',
  'email_verified',verified,'email',coalesce(email,pg_temp.addr(label)),'auth_time',floor(extract(epoch from now()))::bigint,
  'sub','tid-'||current_setting('tid.run')||'-'||label)::text,true);end$$;
create function pg_temp.key(k text) returns uuid language sql as $$select current_setting('tid.'||k)::uuid$$;
create function pg_temp.hash(secret text) returns text language sql as $$select encode(sha256(convert_to(secret,'utf8')),'hex')$$;
create function pg_temp.req(email text) returns jsonb language sql as $$
 select jsonb_build_object('teacherEmail',email,
  'systems',jsonb_build_array(jsonb_build_object('label','Egyptian National','grades',jsonb_build_array(jsonb_build_object('key','g3','label','Third Secondary')))),
  'subjects',jsonb_build_array(jsonb_build_object('key','phy','label','Physics')),
  'course',jsonb_build_object('title','Physics - Third Secondary','gradeKey','g3','subjectKey','phy'))$$;
create function pg_temp.dstat(inv uuid,org uuid) returns text language sql as $$
 select e->>'status' from jsonb_array_elements(public.platform_invitation_delivery(org)) e where (e->>'invitationId')::uuid=inv$$;
create function pg_temp.state() returns text language sql as $$
 select (select count(*) from private.teacher_invitations)||'/'||(select count(*) from public.organization_memberships)||'/'||(select count(*) from private.platform_audit)
  ||'/'||(select string_agg(status||delivery_status,',' order by id) from private.teacher_invitations)$$;

-- Structure.
select pg_temp.ok((select bool_and(not has_function_privilege('anon',f,'execute') and has_function_privilege('authenticated',f,'execute')) from unnest(array[
 'public.platform_record_invitation_delivery(uuid,text,text,text)','public.platform_invitation_delivery(uuid)','public.teacher_invitation_preview(text)',
 'public.platform_store_invitation_salt(uuid,text)','public.platform_invitation_link(uuid)',
 'private.platform_record_invitation_delivery(uuid,text,text,text)','private.platform_invitation_delivery(uuid)','private.teacher_invitation_preview(text)',
 'private.platform_store_invitation_salt(uuid,text)','private.platform_invitation_link(uuid)']) f),
 'new functions are authenticated-only');
select pg_temp.ok((select bool_and(proconfig @> array['search_path=""']) from pg_proc where proname in ('platform_record_invitation_delivery','platform_invitation_delivery','teacher_invitation_preview','platform_store_invitation_salt','platform_invitation_link')
 and pronamespace in ('private'::regnamespace,'public'::regnamespace)),'new functions fix an empty search path');
select pg_temp.ok((select bool_and(prosecdef) from pg_proc where oid in ('private.platform_record_invitation_delivery(uuid,text,text,text)'::regprocedure,'private.teacher_invitation_preview(text)'::regprocedure))
 and not (select prosecdef from pg_proc where oid='public.teacher_invitation_preview(text)'::regprocedure),'definer implementation behind invoker wrapper');
select pg_temp.ok((select bool_and(not has_table_privilege(r,'private.teacher_invitations','select,insert,update,delete')) from unnest(array['anon','authenticated','service_role']) r),
 'the invitation registry stays unreadable and unwritable to API roles');

set local role authenticated;
do $$ declare label text; begin
 foreach label in array array['admin','teacher','other','plain'] loop
  perform pg_temp.claim(label);
  insert into pg_temp.tid_users values(label,public.onboard_firebase_profile());
 end loop;
end $$;
reset role;
insert into private.platform_admins(user_id,note) select id,'synthetic test admin' from tid_users where label='admin';

set local role authenticated;
select pg_temp.claim('admin');
select set_config('tid.prov',public.platform_provision_teacher(pg_temp.req(pg_temp.addr('teacher')),pg_temp.hash('secret-1'))::text,true);
reset role;
select set_config('tid.org',(current_setting('tid.prov')::jsonb)->>'organizationId',true);
select set_config('tid.inv1',(current_setting('tid.prov')::jsonb)->>'invitationId',true);
select pg_temp.ok((select delivery_status='not_sent' and delivery_attempted_at is null and delivery_provider_ref is null and delivery_failure is null
 from private.teacher_invitations where id=pg_temp.key('inv1')),'a new invitation starts as not_sent');

-- Only administrators record or read delivery.
do $$ declare label text; begin
 foreach label in array array['teacher','other','plain'] loop
  perform pg_temp.claim(label);
  perform pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'sending')$s$,pg_temp.key('inv1')),'42501','recording delivery denied to '||label);
  perform pg_temp.denied(format($s$select public.platform_invitation_delivery(%L)$s$,pg_temp.key('org')),'42501','reading delivery denied to '||label);
  perform pg_temp.denied(format($s$select public.platform_store_invitation_salt(%L,repeat('a',32))$s$,pg_temp.key('inv1')),'42501','storing a link salt denied to '||label);
  perform pg_temp.denied(format($s$select public.platform_invitation_link(%L)$s$,pg_temp.key('org')),'42501','reading the link material denied to '||label);
 end loop;
end $$;
set local role authenticated;
reset role;
set local role anon;
select pg_temp.denied($s$select public.platform_record_invitation_delivery(gen_random_uuid(),'sending')$s$,'42501','anonymous cannot record delivery');
select pg_temp.denied($s$select public.teacher_invitation_preview('00')$s$,'42501','anonymous cannot preview');
select pg_temp.denied($s$select public.platform_invitation_link(gen_random_uuid())$s$,'42501','anonymous cannot read link material');
reset role;

-- Delivery lifecycle: not_sent -> sending -> sent | failed, once per invitation.
set local role authenticated;
select pg_temp.claim('admin');
select pg_temp.ok(pg_temp.dstat(pg_temp.key('inv1'),pg_temp.key('org'))='not_sent','administrator reads not_sent');
select pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'sent','ref-1')$s$,pg_temp.key('inv1')),'PT409','cannot record sent before an attempt started');
select pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'delivered')$s$,pg_temp.key('inv1')),'22023','unknown status rejected');
select pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'sending','x')$s$,gen_random_uuid()),'PT404','unknown invitation rejected');
select pg_temp.ok(public.platform_record_invitation_delivery(pg_temp.key('inv1'),'sending')->>'deliveryStatus'='sending','attempt can start');
select pg_temp.ok(pg_temp.dstat(pg_temp.key('inv1'),pg_temp.key('org'))='sending' and (select e->>'attemptedAt' is not null from jsonb_array_elements(public.platform_invitation_delivery(pg_temp.key('org'))) e limit 1),'unconfirmed attempt is visible');
select pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'sending')$s$,pg_temp.key('inv1')),'PT409','a second attempt on the same invitation is refused');
select pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'sent','bad ref with spaces')$s$,pg_temp.key('inv1')),'22023','malformed provider reference rejected');
select pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'failed',null,'other')$s$,pg_temp.key('inv1')),'22023','unknown failure reason rejected');
select pg_temp.ok(public.platform_record_invitation_delivery(pg_temp.key('inv1'),'sent','3f2b8a52-aaaa-bbbb-cccc-1234567890ab')->>'deliveryStatus'='sent','provider acceptance is recorded');
select pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'failed',null,'rejected')$s$,pg_temp.key('inv1')),'PT409','a recorded outcome cannot be changed');
select pg_temp.ok(pg_temp.dstat(pg_temp.key('inv1'),pg_temp.key('org'))='sent','status reads back as sent');

-- The link is fixed once: Send and Copy re-derive the same secret from this salt, and only a replacement changes it.
select pg_temp.ok((public.platform_invitation_link(pg_temp.key('org'))->>'salt') is null,'a fresh invitation has no salt until the server stores one');
select pg_temp.denied(format($s$select public.platform_store_invitation_salt(%L,'not-hex')$s$,pg_temp.key('inv1')),'22023','malformed salt rejected');
select pg_temp.denied(format($s$select public.platform_store_invitation_salt(%L,repeat('a',31))$s$,pg_temp.key('inv1')),'22023','wrong-length salt rejected');
select pg_temp.denied(format($s$select public.platform_store_invitation_salt(%L,repeat('a',32))$s$,gen_random_uuid()),'PT404','salt for an unknown invitation rejected');
select pg_temp.ok(public.platform_store_invitation_salt(pg_temp.key('inv1'),'00112233445566778899aabbccddeeff') is not null,'administrator stores the salt');
select pg_temp.denied(format($s$select public.platform_store_invitation_salt(%L,repeat('b',32))$s$,pg_temp.key('inv1')),'PT409','the salt cannot be overwritten (the link cannot silently change)');
select pg_temp.ok((select l->>'tokenHash'=pg_temp.hash('secret-1') from (select public.platform_invitation_link(pg_temp.key('org')) l) x),'the link material carries the stored hash so the server can verify its derivation');
select pg_temp.ok((select l->>'salt'='00112233445566778899aabbccddeeff' and (l->>'invitationId')::uuid=pg_temp.key('inv1') and l->>'deliveryStatus'='sent' and (l->>'attempts')::int=1
 from (select public.platform_invitation_link(pg_temp.key('org')) l) x),'the link material reads back unchanged and nothing rotates');
select pg_temp.ok((select l->>'salt'='00112233445566778899aabbccddeeff' from (select public.platform_invitation_link(pg_temp.key('org')) l) x),'reading it twice gives the same salt');

-- A deliberate second delivery of the SAME link: a new numbered attempt that clears the earlier verdict, never a new secret.
select pg_temp.ok((public.platform_record_invitation_delivery(pg_temp.key('inv1'),'sending')->>'attempt')::int=2,'a second attempt of the same invitation gets attempt number 2');
select pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'sending')$s$,pg_temp.key('inv1')),'PT409','a fresh unconfirmed attempt blocks an immediate duplicate (double click)');
reset role;
update private.teacher_invitations set delivery_attempted_at=now()-interval '2 minutes' where id=pg_temp.key('inv1');
set local role authenticated; select pg_temp.claim('admin');
select pg_temp.ok((public.platform_record_invitation_delivery(pg_temp.key('inv1'),'sending')->>'attempt')::int=3,'an attempt with no verdict for over a minute may be sent again deliberately (attempt 3)');
select pg_temp.ok((select e->>'status'='sending' and (e->>'attempts')::int=3 from jsonb_array_elements(public.platform_invitation_delivery(pg_temp.key('org'))) e where (e->>'invitationId')::uuid=pg_temp.key('inv1')),'the new attempt is unconfirmed until recorded');
select pg_temp.ok((select l->>'salt'='00112233445566778899aabbccddeeff' from (select public.platform_invitation_link(pg_temp.key('org')) l) x),'sending again does not change the link');
select pg_temp.ok(public.platform_record_invitation_delivery(pg_temp.key('inv1'),'failed',null,'rejected')->>'deliveryStatus'='failed','attempt 3 is refused');
select pg_temp.ok((public.platform_record_invitation_delivery(pg_temp.key('inv1'),'sending')->>'attempt')::int=4,'attempt 4');
select pg_temp.ok(public.platform_record_invitation_delivery(pg_temp.key('inv1'),'sent','ref-4')->>'deliveryStatus'='sent','attempt 4 is accepted');
select pg_temp.ok((public.platform_record_invitation_delivery(pg_temp.key('inv1'),'sending')->>'attempt')::int=5,'attempt 5');
select pg_temp.ok(public.platform_record_invitation_delivery(pg_temp.key('inv1'),'sent','ref-5')->>'deliveryStatus'='sent','attempt 5 is accepted');
select pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'sending')$s$,pg_temp.key('inv1')),'PT409','attempts are capped at five per invitation');

-- A replacement invitation supersedes the old one and starts clean; the old row can no longer be written.
select set_config('tid.re',public.platform_reissue_teacher_invitation(pg_temp.key('org'),pg_temp.hash('secret-2'),7)::text,true);
select set_config('tid.inv2',(current_setting('tid.re')::jsonb)->>'invitationId',true);
select pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'failed',null,'rejected')$s$,pg_temp.key('inv1')),'PT410','a superseded invitation cannot receive delivery records');
select pg_temp.ok(pg_temp.dstat(pg_temp.key('inv2'),pg_temp.key('org'))='not_sent' and pg_temp.dstat(pg_temp.key('inv1'),pg_temp.key('org'))='sent',
 'the replacement starts not_sent and the history keeps the earlier attempt');
select pg_temp.ok((public.platform_invitation_link(pg_temp.key('org'))->>'salt') is null and (public.platform_invitation_link(pg_temp.key('org'))->>'invitationId')::uuid=pg_temp.key('inv2'),'link material now describes the replacement, with no salt yet: the old link is gone');
select pg_temp.denied(format($s$select public.platform_store_invitation_salt(%L,repeat('c',32))$s$,pg_temp.key('inv1')),'PT410','the superseded invitation cannot receive a salt');
select pg_temp.ok(public.platform_record_invitation_delivery(pg_temp.key('inv2'),'sending')->>'deliveryStatus'='sending','replacement attempt starts');
select pg_temp.ok(public.platform_record_invitation_delivery(pg_temp.key('inv2'),'failed',null,'rejected')->>'deliveryStatus'='failed','provider refusal is recorded');
select pg_temp.ok((select e->>'failure'='rejected' from jsonb_array_elements(public.platform_invitation_delivery(pg_temp.key('org'))) e where (e->>'invitationId')::uuid=pg_temp.key('inv2')),'failure reason reads back');
reset role;
select pg_temp.denied(format($s$update private.teacher_invitations set delivery_status='sent' where id=%L$s$,pg_temp.key('inv2')),'23514','the table itself refuses an impossible delivery state');

-- Preview never consumes and never grants anything.
select set_config('tid.before_preview',pg_temp.state(),true);
set local role authenticated;
select pg_temp.claim('teacher');
select pg_temp.ok((select (p->>'state')='valid' and (p->>'emailMatches')::boolean and (p->>'emailVerified')::boolean and not (p->>'acceptedByMe')::boolean
 and p->>'maskedEmail' ~ '^t\*\*\*@example\.test$' from (select public.teacher_invitation_preview(pg_temp.hash('secret-2')) p) x),'invited, verified teacher sees a valid link with a masked address');
select pg_temp.ok((select p->>'maskedEmail' not like '%'||current_setting('tid.run')||'%' from (select public.teacher_invitation_preview(pg_temp.hash('secret-2')) p) x),'the full address is never returned');
select pg_temp.ok((select (p->>'state')='unavailable' from (select public.teacher_invitation_preview(pg_temp.hash('no-such-secret')) p) x),'unknown secret is simply unavailable');
select pg_temp.denied($s$select public.teacher_invitation_preview('not-hex')$s$,'22023','malformed secret hash rejected');
select pg_temp.claim('other');
select pg_temp.ok((select (p->>'state')='valid' and not (p->>'emailMatches')::boolean and (p->>'emailVerified')::boolean from (select public.teacher_invitation_preview(pg_temp.hash('secret-2')) p) x),'a different verified account is told the address does not match');
select pg_temp.claim('teacher',false);
select pg_temp.denied(format($s$select public.teacher_invitation_preview(%L)$s$,pg_temp.hash('secret-2')),'42501','an unverified account cannot preview: identity resolution already fails closed');
select pg_temp.claim('teacher',true,upper(pg_temp.addr('teacher')));
select pg_temp.ok((select (p->>'emailMatches')::boolean from (select public.teacher_invitation_preview(pg_temp.hash('secret-2')) p) x),'e-mail comparison ignores case');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"nobody"}',true);
reset role;
select pg_temp.ok(pg_temp.state()=current_setting('tid.before_preview'),'previewing changed nothing');

-- Expiry, revocation and use are reported distinctly.
update private.teacher_invitations set created_at=now()-interval '3 days',expires_at=now()-interval '1 day' where id=pg_temp.key('inv2');
set local role authenticated; select pg_temp.claim('teacher');
select pg_temp.ok((select p->>'state'='expired' from (select public.teacher_invitation_preview(pg_temp.hash('secret-2')) p) x),'expired link is reported as expired');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-2')),'PT410','an expired link cannot be accepted');
select pg_temp.claim('admin');
select pg_temp.denied(format($s$select public.platform_invitation_link(%L)$s$,pg_temp.key('org')),'PT410','link material for an expired invitation is refused');
select pg_temp.claim('admin');
select pg_temp.ok(public.platform_reissue_teacher_invitation(pg_temp.key('org'),pg_temp.hash('secret-3'),7) is not null,'administrator issues a replacement after expiry');
select pg_temp.ok(public.platform_revoke_teacher_invitation(pg_temp.key('org')) is not null,'administrator revokes it');
select pg_temp.denied(format($s$select public.platform_invitation_link(%L)$s$,pg_temp.key('org')),'PT404','link material for a revoked invitation is refused');
select pg_temp.claim('teacher');
select pg_temp.ok((select p->>'state'='revoked' from (select public.teacher_invitation_preview(pg_temp.hash('secret-3')) p) x),'revoked link is reported as revoked');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-3')),'PT410','a revoked link cannot be accepted');
select pg_temp.claim('admin');
select set_config('tid.inv4',public.platform_reissue_teacher_invitation(pg_temp.key('org'),pg_temp.hash('secret-4'),7)->>'invitationId',true);

-- Acceptance after a preview: still bound to the verified e-mail, single use, and no administrator rights.
select pg_temp.claim('other');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-4')),'42501','a different verified account cannot accept');
select pg_temp.claim('teacher',false);
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-4')),'42501','an unverified account cannot accept');
select pg_temp.claim('teacher');
select pg_temp.ok(public.accept_teacher_invitation(pg_temp.hash('secret-4'))->>'organizationId'=current_setting('tid.org'),'the invited, verified teacher accepts');
select pg_temp.denied(format($s$select public.accept_teacher_invitation(%L)$s$,pg_temp.hash('secret-4')),'PT409','a second acceptance is refused');
select pg_temp.ok((select p->>'state'='used' and (p->>'acceptedByMe')::boolean from (select public.teacher_invitation_preview(pg_temp.hash('secret-4')) p) x),'the teacher who accepted can recognise an already-completed acceptance');
select pg_temp.claim('other');
select pg_temp.ok((select p->>'state'='used' and not (p->>'acceptedByMe')::boolean from (select public.teacher_invitation_preview(pg_temp.hash('secret-4')) p) x),'someone else sees only that the link was used');
select pg_temp.claim('teacher');
select pg_temp.ok(not public.is_platform_admin(),'accepting grants no platform administration');
select pg_temp.claim('admin');
select pg_temp.denied(format($s$select public.platform_record_invitation_delivery(%L,'sending')$s$,pg_temp.key('inv4')),'PT410','delivery cannot be recorded for an accepted invitation');
reset role;
select pg_temp.ok((select count(*)=1 from public.organization_memberships where organization_id=pg_temp.key('org') and role='owner' and status='active'
 and user_id=(select id from tid_users where label='teacher')),'exactly one owner membership exists, for the invited teacher');
select pg_temp.ok((select count(*)=0 from private.platform_admins where user_id=(select id from tid_users where label='teacher')),'no administrator row was created');

select count(*) as teacher_invitation_delivery_tests from tid_results;
rollback;
