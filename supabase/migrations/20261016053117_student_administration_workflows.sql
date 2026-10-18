-- Step 08: additive, offering-scoped student access. No existing academic row backfill.
create table public.enrollment_requests (
 id uuid primary key default gen_random_uuid(), offering_id uuid not null references public.course_offerings(id) on delete restrict,
 user_id uuid not null references public.profiles(id) on delete restrict,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 version bigint not null default 0 check(version>=0), reason text not null default '' check(length(reason)<=1000),
 reviewed_by uuid references public.profiles(id) on delete restrict, reviewed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(offering_id,user_id), check((reviewed_by is null)=(reviewed_at is null)),
 check((status='pending')=(reviewed_at is null))
);
create index enrollment_requests_user_idx on public.enrollment_requests(user_id,offering_id);
create index enrollment_requests_queue_idx on public.enrollment_requests(offering_id,status,created_at,id);
create index enrollment_requests_reviewer_idx on public.enrollment_requests(reviewed_by) where reviewed_by is not null;
alter table public.enrollment_requests enable row level security;
create trigger enrollment_requests_updated before update on public.enrollment_requests for each row execute function private.touch_updated_at();
revoke all on public.enrollment_requests from public,anon,authenticated,service_role;
grant select on public.enrollment_requests to authenticated;
create policy enrollment_requests_read on public.enrollment_requests for select to authenticated using(
 private.is_active_user() and (user_id=(select private.current_app_user_id()) or private.can_support_offering(offering_id))
);
create table private.student_access_links (
 id uuid primary key default gen_random_uuid(), offering_id uuid not null references public.course_offerings(id) on delete restrict,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'), kind text not null check(kind in ('request','invite')),
 recipient_id uuid references public.profiles(id) on delete restrict,
 created_by uuid not null references public.profiles(id) on delete restrict, expires_at timestamptz not null,
 enrollment_expires_at timestamptz, revoked_at timestamptz, claimed_by uuid references public.profiles(id) on delete restrict,
 claimed_at timestamptz, created_at timestamptz not null default now(),
 check(expires_at>created_at),check(enrollment_expires_at is null or enrollment_expires_at>created_at),
 check((claimed_by is null)=(claimed_at is null)),check(kind='invite' or claimed_by is null),
 check((kind='invite')=(recipient_id is not null)),check(claimed_by is null or claimed_by=recipient_id)
);
create index student_access_links_offering_idx on private.student_access_links(offering_id,created_at,id);
create index student_access_links_creator_idx on private.student_access_links(created_by,created_at);
create index student_access_links_recipient_idx on private.student_access_links(recipient_id) where recipient_id is not null;
create index student_access_links_claimant_idx on private.student_access_links(claimed_by) where claimed_by is not null;
create table private.enrollment_admin_versions (
 enrollment_id uuid primary key references public.enrollments(id) on delete cascade,
 version bigint not null default 0 check(version>=0)
);
create table private.student_admin_audit (
 id uuid primary key default gen_random_uuid(),offering_id uuid not null references public.course_offerings(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,subject_id uuid references public.profiles(id) on delete restrict,
 action text not null, before_data jsonb not null, after_data jsonb not null,created_at timestamptz not null default now()
);
create index student_admin_audit_offering_idx on private.student_admin_audit(offering_id,created_at,id);
create index student_admin_audit_actor_idx on private.student_admin_audit(actor_id);
create index student_admin_audit_subject_idx on private.student_admin_audit(subject_id) where subject_id is not null;
create table private.student_admin_commands (
 actor_id uuid not null references public.profiles(id) on delete restrict, request_id uuid not null,
 fingerprint text not null,result jsonb not null,created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
create index student_admin_commands_recent_idx on private.student_admin_commands(actor_id,created_at);
do $$declare t text;begin foreach t in array array['student_access_links','enrollment_admin_versions','student_admin_audit','student_admin_commands'] loop
 execute format('alter table private.%I enable row level security',t);execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
end loop;end$$;
create function private.bump_enrollment_admin_version() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into private.enrollment_admin_versions(enrollment_id,version) values(new.id,1)
 on conflict(enrollment_id) do update set version=enrollment_admin_versions.version+1;return new;
end$$;
revoke all on function private.bump_enrollment_admin_version() from public,anon,authenticated,service_role;
create trigger enrollment_admin_version after update on public.enrollments for each row execute function private.bump_enrollment_admin_version();

create function private.student_link_issuer(p_offering uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.course_offerings o join public.courses c on c.id=o.course_id join public.organizations g on g.id=c.organization_id and g.status='active'
 join public.profiles p on p.id=p_user and p.status='active' join public.organization_memberships m on m.organization_id=g.id and m.user_id=p_user and m.status='active'
 where o.id=p_offering and (m.role in ('owner','admin') or exists(select 1 from public.course_staff s where s.course_id=c.id and s.user_id=p_user and s.role in ('owner','instructor')) or exists(select 1 from public.offering_staff s where s.offering_id=o.id and s.user_id=p_user and s.role='instructor')))
$$;
revoke all on function private.student_link_issuer(uuid,uuid) from public,anon,authenticated,service_role;
create function private.student_administration(p_action text,p_offering uuid,p_subject uuid,p_version bigint,p_request uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=private.current_app_user_id(); f public.course_offerings; course_row public.courses; link private.student_access_links;
 req public.enrollment_requests; enrollment_row public.enrollments; saved private.student_admin_commands; result jsonb; previous jsonb:='{}';
 fingerprint text; token text:=p_data->>'token'; page integer:=coalesce((p_data->>'page')::integer,0); search text:=coalesce(p_data->>'search','');
 filter text:=coalesce(p_data->>'filter','all'); expires timestamptz; v bigint; target uuid:=p_subject; org uuid;
begin
 if u is null or not private.is_active_user() then raise exception 'Sign in required' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>8000 or page not between 0 and 100000 or length(search)>120 then raise exception 'Invalid input' using errcode='23514';end if;
 if p_action='offerings' then
  return jsonb_build_object('page',page,'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(
   select o.id,o.name,c.title course_title,g.name organization_name,private.can_manage_offering(o.id) manage
   from public.course_offerings o join public.courses c on c.id=o.course_id join public.organizations g on g.id=c.organization_id
   where private.can_support_offering(o.id) order by g.name,o.name,o.id limit 25 offset page*25)x),'[]'));
 elsif p_action='metrics' then
  if p_data->>'organizationId' is not null then org:=(p_data->>'organizationId')::uuid;
   if not private.is_org_member(org) then raise exception 'Organization unavailable' using errcode='42501';end if;
  end if;
  return jsonb_build_object(
   'totalStudents',(select count(distinct e.user_id) from public.enrollments e join public.course_offerings o on o.id=e.offering_id join public.courses c on c.id=o.course_id join public.organizations g on g.id=c.organization_id join public.profiles p on p.id=e.user_id
    where private.can_support_offering(o.id) and (org is null or c.organization_id=org) and e.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or e.expires_at>clock_timestamp()) and p.status='active' and o.status='active' and c.status='published' and g.status='active'),
   'pendingWaitlistCount',(select count(*) from public.enrollment_requests r join public.course_offerings o on o.id=r.offering_id join public.courses c on c.id=o.course_id where r.status='pending' and private.can_support_offering(o.id) and (org is null or c.organization_id=org)),
   'pendingHomeworkCount',(select count(*) from public.homework_submissions s join private.homework_corrections h on h.submission_id=s.id join public.homework_assignments a on a.id=s.assignment_id join public.courses c on c.id=a.course_id where s.status='submitted' and h.status='under_correction' and h.released_at is null and private.homework_staff(a.id,'grade') and (org is null or c.organization_id=org)),
   'activeGroupsCount',(select count(*) from public.study_groups g join public.course_offerings o on o.id=g.offering_id join public.courses c on c.id=o.course_id where g.status='active' and private.can_support_offering(o.id) and (org is null or c.organization_id=org))
  );
 elsif p_action='mine' then return jsonb_build_object('profileId',u,'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(select r.id,r.status,r.version,r.reason,r.created_at,o.name offering_name,g.name organization_name from public.enrollment_requests r join public.course_offerings o on o.id=r.offering_id join public.courses c on c.id=o.course_id join public.organizations g on g.id=c.organization_id where r.user_id=u order by r.created_at desc,r.id limit 25 offset page*25)x),'[]'));
 end if;
 if p_action in ('inspect','request','accept') then
  if coalesce(token,'')!~'^[A-Za-z0-9_-]{43}$' then raise exception 'Link unavailable' using errcode='42501';end if;
  select * into link from private.student_access_links where token_hash=encode(sha256(convert_to(token,'UTF8')),'hex');
  if link.id is null or link.revoked_at is not null or link.expires_at<=clock_timestamp() or (link.kind='invite' and link.recipient_id<>u) or (link.claimed_by is not null and link.claimed_by<>u) or not private.student_link_issuer(link.offering_id,link.created_by) then
   raise exception 'Link unavailable' using errcode='42501';end if;
  p_offering:=link.offering_id;target:=u;
 end if;
 select * into f from public.course_offerings where id=p_offering;
 select * into course_row from public.courses where id=f.course_id;
 if f.id is null then raise exception 'Offering unavailable' using errcode='42501';end if;
 if p_action='inspect' then
  if f.status<>'active' or course_row.status<>'published' or not exists(select 1 from public.organizations where id=course_row.organization_id and status='active') then raise exception 'Link unavailable' using errcode='42501';end if;
  return jsonb_build_object('name',f.name,'organization',(select name from public.organizations where id=course_row.organization_id),'kind',link.kind,'expiresAt',link.expires_at,'enrolled',private.is_enrolled(f.id),'requestStatus',(select status from public.enrollment_requests where offering_id=f.id and user_id=u));
 end if;
 if p_action not in ('request','accept') and not private.can_support_offering(f.id) then raise exception 'Offering unavailable' using errcode='42501';end if;
 if p_action='roster' then
  if filter not in ('all','active','suspended','expired','completed','cancelled','invited') then raise exception 'Invalid filter' using errcode='23514';end if;
  return jsonb_build_object('manage',private.can_manage_offering(f.id),'page',page,'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(
   select e.id,e.user_id,p.display_name,e.status,e.expires_at,e.enrolled_at,coalesce(v.version,0) version,
    (e.status='active' and p.status='active' and (e.enrolled_at is null or e.enrolled_at<=clock_timestamp()) and (e.expires_at is null or e.expires_at>clock_timestamp()) and f.status='active' and course_row.status='published') eligible
   from public.enrollments e join public.profiles p on p.id=e.user_id left join private.enrollment_admin_versions v on v.enrollment_id=e.id
   where e.offering_id=f.id and (search='' or position(lower(search) in lower(coalesce(p.display_name,'')))>0)
   and (filter='all' or filter=e.status and (filter<>'active' or e.expires_at is null or e.expires_at>clock_timestamp()) or filter='expired' and e.expires_at<=clock_timestamp())
   order by coalesce(p.display_name,''),e.id limit 25 offset page*25)x),'[]'));
 elsif p_action='requests' then
  if filter not in ('all','pending','approved','rejected') then raise exception 'Invalid filter' using errcode='23514';end if;
  return jsonb_build_object('manage',private.can_manage_offering(f.id),'page',page,'rows',coalesce((select jsonb_agg(to_jsonb(x)) from(
   select r.id,r.user_id,p.display_name,r.status,r.version,r.reason,r.created_at from public.enrollment_requests r join public.profiles p on p.id=r.user_id
   where r.offering_id=f.id and (filter='all' or r.status=filter) and (search='' or position(lower(search) in lower(coalesce(p.display_name,'')))>0)
   order by r.created_at,r.id limit 25 offset page*25)x),'[]'));
 elsif p_action='links' then
  if not private.can_manage_offering(f.id) then raise exception 'Instructor required' using errcode='42501';end if;
  return coalesce((select jsonb_agg(to_jsonb(x)) from(select id,kind,expires_at,revoked_at,claimed_at from private.student_access_links where offering_id=f.id order by created_at desc,id limit 25 offset page*25)x),'[]');
 end if;
 if p_request is null then raise exception 'Request ID required' using errcode='23514';end if;
 perform pg_advisory_xact_lock(hashtextextended('student-admin:'||u,0));
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(p_action,p_offering,p_subject,p_version,p_data)::text,'UTF8')),'hex');
 select * into saved from private.student_admin_commands where actor_id=u and request_id=p_request;
 if found then if fingerprint<>saved.fingerprint then raise exception 'Request ID reused' using errcode='23514';end if;return saved.result;end if;
 if (select count(*) from private.student_admin_commands where actor_id=u and created_at>clock_timestamp()-interval '1 hour')>=(case when private.can_manage_offering(f.id) then 2000 else 100 end) then raise exception 'Command rate limit' using errcode='PT429';end if;
 -- Offering first matches capacity/group enrollment trigger lock order.
 select * into f from public.course_offerings where id=f.id for update;
 select * into course_row from public.courses where id=f.course_id for share;
 perform 1 from public.profiles p where p.id in(u,target,case when p_action in ('request','accept') then link.created_by else u end) order by p.id for share;
 if not private.is_active_user() then raise exception 'Identity revoked' using errcode='42501';end if;
 -- Keep the authorizing membership/assignment stable through the grant transaction.
 perform 1 from public.organization_memberships m where m.organization_id=course_row.organization_id and m.user_id=case when p_action in ('request','accept') then link.created_by else u end for share;
 perform 1 from public.course_staff s where s.course_id=course_row.id and s.user_id=case when p_action in ('request','accept') then link.created_by else u end for share;
 perform 1 from public.offering_staff s where s.offering_id=f.id and s.user_id=case when p_action in ('request','accept') then link.created_by else u end for share;
 -- The existing last-owner trigger locks membership before organization.
 perform 1 from public.organizations where id=course_row.organization_id for share;
 if p_action in ('request','accept') then
  select * into link from private.student_access_links where id=link.id for update;
  if link.revoked_at is not null or link.expires_at<=clock_timestamp() or (link.kind='invite' and link.recipient_id<>u) or (link.claimed_by is not null and link.claimed_by<>u) or not private.student_link_issuer(f.id,link.created_by) then raise exception 'Link unavailable' using errcode='42501';end if;
 else
  if not private.can_manage_offering(f.id) then raise exception 'Instructor required' using errcode='42501';end if;
 end if;
 if p_action='link' then
  if coalesce(token,'')!~'^[A-Za-z0-9_-]{43}$' or p_data->>'kind' not in ('request','invite') then raise exception 'Invalid link' using errcode='23514';end if;
  expires:=(p_data->>'expiresAt')::timestamptz;
  if expires is null or expires<=clock_timestamp() or expires>clock_timestamp()+interval '30 days' or (p_data->>'enrollmentExpiresAt' is not null and (p_data->>'enrollmentExpiresAt')::timestamptz<=clock_timestamp()) then raise exception 'Invalid expiry' using errcode='23514';end if;
  if (select count(*) from private.student_access_links where created_by=u and created_at>clock_timestamp()-interval '1 hour')>=100 then raise exception 'Rate limit' using errcode='PT429';end if;
  if p_data->>'kind'='invite' and not exists(select 1 from public.profiles where id=(p_data->>'recipientId')::uuid and status='active') then raise exception 'Recipient unavailable' using errcode='42501';end if;
  insert into private.student_access_links(offering_id,token_hash,kind,recipient_id,created_by,expires_at,enrollment_expires_at) values(f.id,encode(sha256(convert_to(token,'UTF8')),'hex'),p_data->>'kind',(p_data->>'recipientId')::uuid,u,expires,(p_data->>'enrollmentExpiresAt')::timestamptz) returning * into link;
  result:=jsonb_build_object('id',link.id);target:=null;
 elsif p_action='revoke-link' then
  update private.student_access_links set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=(p_data->>'linkId')::uuid and offering_id=f.id returning * into link;
  if link.id is null then raise exception 'Link unavailable' using errcode='42501';end if;result:=jsonb_build_object('id',link.id);target:=null;
 elsif p_action='request' then
  if link.kind<>'request' then raise exception 'Wrong link type' using errcode='23514';end if;
  if f.status<>'active' or course_row.status<>'published' or not exists(select 1 from public.organizations where id=course_row.organization_id and status='active') or (f.enrollment_opens_at is not null and f.enrollment_opens_at>clock_timestamp()) or (f.enrollment_closes_at is not null and f.enrollment_closes_at<=clock_timestamp()) or (f.ends_at is not null and f.ends_at<=clock_timestamp()) then raise exception 'Enrollment unavailable' using errcode='42501';end if;
  if exists(select 1 from public.enrollments where offering_id=f.id and user_id=u) then raise exception 'Contact teacher about existing enrollment' using errcode='23514';end if;
  if (select count(*) from public.enrollment_requests where user_id=u and created_at>clock_timestamp()-interval '1 hour')>=10 and not exists(select 1 from public.enrollment_requests where offering_id=f.id and user_id=u) then raise exception 'Request rate limit' using errcode='PT429';end if;
  insert into public.enrollment_requests(offering_id,user_id) values(f.id,u) on conflict(offering_id,user_id) do nothing;
  select * into req from public.enrollment_requests where offering_id=f.id and user_id=u;
  result:=jsonb_build_object('id',req.id,'status',req.status,'version',req.version);
 elsif p_action in ('approve','reject','accept','enroll') then
  if p_action in ('approve','reject') then
   select * into req from public.enrollment_requests where offering_id=f.id and user_id=target for update;
   if req.id is null then raise exception 'Request unavailable' using errcode='42501';end if;
   if p_version is distinct from req.version then raise exception 'Stale request' using errcode='PT409';end if;
   if req.status<>'pending' then raise exception 'Request already decided' using errcode='PT409';end if;
   previous:=to_jsonb(req);
  elsif p_action='accept' then
   if link.kind<>'invite' then raise exception 'Wrong link type' using errcode='23514';end if;
   if (f.enrollment_opens_at is not null and f.enrollment_opens_at>clock_timestamp()) or (f.enrollment_closes_at is not null and f.enrollment_closes_at<=clock_timestamp()) then raise exception 'Enrollment unavailable' using errcode='42501';end if;
  elsif not exists(select 1 from public.enrollments prior_enrollment join public.course_offerings o on o.id=prior_enrollment.offering_id join public.courses pc on pc.id=o.course_id where prior_enrollment.user_id=target and pc.organization_id=course_row.organization_id) then raise exception 'Use a student request or invitation first' using errcode='42501';end if;
  if p_action='reject' then
   update public.enrollment_requests set status='rejected',version=version+1,reason=coalesce(p_data->>'reason',''),reviewed_by=u,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=req.id returning * into req;
   result:=jsonb_build_object('id',req.id,'version',req.version,'status',req.status);
  else
   if f.status<>'active' or course_row.status<>'published' or not exists(select 1 from public.organizations where id=course_row.organization_id and status='active') or (f.ends_at is not null and f.ends_at<=clock_timestamp()) then raise exception 'Enrollment unavailable' using errcode='42501';end if;
   if target is null or not exists(select 1 from public.profiles where id=target and status='active') then raise exception 'Student unavailable' using errcode='42501';end if;
   expires:=case when p_action='accept' then link.enrollment_expires_at else (p_data->>'expiresAt')::timestamptz end;
   if expires<=clock_timestamp() then raise exception 'Expiry must be future' using errcode='23514';end if;
   select * into enrollment_row from public.enrollments where offering_id=f.id and user_id=target for update;
   if enrollment_row.id is not null and (enrollment_row.status<>'active' or enrollment_row.expires_at<=clock_timestamp()) then raise exception 'Existing access requires explicit reactivation' using errcode='23514';end if;
   if enrollment_row.id is null then insert into public.enrollments(offering_id,user_id,status,enrolled_at,expires_at,created_by,source) values(f.id,target,'active',now(),expires,case when p_action='accept' then link.created_by else u end,'student-administration') returning * into enrollment_row;end if;
   if req.id is not null then update public.enrollment_requests set status='approved',version=version+1,reviewed_by=u,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where id=req.id returning * into req;end if;
   if p_action='accept' then
    update private.student_access_links set claimed_by=u,claimed_at=coalesce(claimed_at,clock_timestamp()) where id=link.id;
    update public.enrollment_requests set status='approved',version=version+1,reviewed_by=link.created_by,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() where offering_id=f.id and user_id=u and status<>'approved';
   end if;
   result:=jsonb_build_object('id',enrollment_row.id,'status',enrollment_row.status);
  end if;
 elsif p_action in ('suspend','reactivate') then
  select * into enrollment_row from public.enrollments where offering_id=f.id and user_id=target for update;
  if enrollment_row.id is null then raise exception 'Enrollment unavailable' using errcode='42501';end if;
  select coalesce((select version from private.enrollment_admin_versions where enrollment_id=enrollment_row.id),0) into v;
  if p_version is distinct from v then raise exception 'Stale enrollment' using errcode='PT409';end if;
  previous:=to_jsonb(enrollment_row);expires:=(p_data->>'expiresAt')::timestamptz;
    if p_action='reactivate' and (expires<=clock_timestamp() or f.status<>'active' or (f.ends_at is not null and f.ends_at<=clock_timestamp()) or course_row.status<>'published' or not exists(select 1 from public.organizations where id=course_row.organization_id and status='active') or not exists(select 1 from public.profiles where id=target and status='active')) then raise exception 'Cannot reactivate' using errcode='23514';end if;
  update public.enrollments set status=case when p_action='suspend' then 'suspended' else 'active' end,
   enrolled_at=case when p_action='reactivate' then now() else enrolled_at end,
   expires_at=case when p_action='reactivate' then expires else expires_at end where id=enrollment_row.id returning * into enrollment_row;
  result:=jsonb_build_object('id',enrollment_row.id,'status',enrollment_row.status,'version',(select version from private.enrollment_admin_versions where enrollment_id=enrollment_row.id));
 else raise exception 'Unknown action' using errcode='23514';end if;
 insert into private.student_admin_audit(offering_id,actor_id,subject_id,action,before_data,after_data) values(f.id,u,target,p_action,previous,result);
 insert into private.student_admin_commands(actor_id,request_id,fingerprint,result) values(u,p_request,fingerprint,result);
 return result;
end$$;
create function public.student_administration(p_action text,p_offering uuid default null,p_subject uuid default null,p_version bigint default null,p_request uuid default null,p_data jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$select private.student_administration(p_action,p_offering,p_subject,p_version,p_request,p_data)$$;
revoke all on function private.student_administration(text,uuid,uuid,bigint,uuid,jsonb),public.student_administration(text,uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.student_administration(text,uuid,uuid,bigint,uuid,jsonb),public.student_administration(text,uuid,uuid,bigint,uuid,jsonb) to authenticated;
