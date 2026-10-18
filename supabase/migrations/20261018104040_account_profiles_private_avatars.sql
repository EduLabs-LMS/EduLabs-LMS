-- Identity-level presentation only. No organization, enrollment or academic grants.
create table private.account_avatar_assets (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete restrict,
 object_path text not null unique,size_bytes integer not null check(size_bytes between 1 and 1048576),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),status text not null default 'pending' check(status in ('pending','ready','retired')),
 created_at timestamptz not null default now(),unique(id,user_id),
 check(object_path=user_id::text||'/'||id::text||'.webp')
);
create index account_avatar_assets_owner_idx on private.account_avatar_assets(user_id,status,created_at);
alter table private.account_avatar_assets enable row level security;
revoke all on private.account_avatar_assets from public,anon,authenticated;
create table public.account_profiles (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 first_name text not null default '' check(length(first_name)<=60 and first_name !~ '[[:cntrl:]]'),
 last_name text not null default '' check(length(last_name)<=60 and last_name !~ '[[:cntrl:]]'),
 avatar_id uuid,onboarding_completed_at timestamptz,revision bigint not null default 0 check(revision>=0),
 updated_at timestamptz not null default now(),
 foreign key(avatar_id,user_id) references private.account_avatar_assets(id,user_id) on delete restrict,
 check(onboarding_completed_at is null or (length(btrim(first_name))>0 and length(btrim(last_name))>0))
);
create index account_profiles_avatar_idx on public.account_profiles(avatar_id,user_id) where avatar_id is not null;
alter table public.account_profiles enable row level security;
revoke all on public.account_profiles from public,anon,authenticated;
grant select on public.account_profiles to authenticated;
create policy own_account_profile on public.account_profiles for select to authenticated using(user_id=(select private.current_app_user_id()));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('lms-avatars','lms-avatars',false,1048576,array['image/webp']);

create function private.avatar_capability(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.account_avatar_assets a where a.id=p_id and a.user_id=(select private.current_app_user_id()) and a.status='pending'
  and auth.jwt()->'avatar_upload'->>'id'=a.id::text and auth.jwt()->'avatar_upload'->>'sha256'=a.sha256
  and auth.jwt()->'avatar_upload'->>'size'=a.size_bytes::text
  and coalesce(auth.jwt()->'avatar_upload'->>'issuedAt','') ~ '^[0-9]{1,12}$'
  and (auth.jwt()->'avatar_upload'->>'issuedAt')::numeric between extract(epoch from clock_timestamp())-120 and extract(epoch from clock_timestamp())+5)
$$;
revoke all on function private.avatar_capability(uuid) from public,anon;
grant execute on function private.avatar_capability(uuid) to authenticated;
create function private.account_avatar_access(p_path text,p_operation text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.account_avatar_assets a where a.object_path=p_path and a.user_id=(select private.current_app_user_id())
  and case p_operation when 'read' then true when 'insert' then private.avatar_capability(a.id) when 'delete' then a.status='retired' else false end)
$$;
revoke all on function private.account_avatar_access(text,text) from public,anon;
grant execute on function private.account_avatar_access(text,text) to authenticated;
create policy avatar_owner_read on storage.objects for select to authenticated using(bucket_id='lms-avatars' and private.account_avatar_access(name,'read'));
create policy avatar_attested_insert on storage.objects for insert to authenticated with check(bucket_id='lms-avatars' and private.account_avatar_access(name,'insert'));
create policy avatar_retired_delete on storage.objects for delete to authenticated using(bucket_id='lms-avatars' and private.account_avatar_access(name,'delete'));
-- No UPDATE/upsert policy: an immutable UUID object can never replace another file.

create function private.account_profile(p_action text,p_revision bigint,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=(select private.current_app_user_id());p public.account_profiles;a private.account_avatar_assets;asset uuid;first_value text;last_value text;result jsonb;
begin
 if u is null or not private.is_active_user() then raise exception 'Verified account required' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or length(p_data::text)>4000 then raise exception 'Invalid profile payload' using errcode='23514';end if;
 -- Caller identity is never accepted in the payload, even for staff/owners.
 if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('firstName','lastName','completeOnboarding','id','size','sha256')) then raise exception 'Unsupported account field' using errcode='23514';end if;
 insert into public.account_profiles(user_id) values(u) on conflict do nothing;
 select * into p from public.account_profiles where user_id=u for update;
 if private.current_app_user_id() is distinct from u or not private.is_active_user() then raise exception 'Account access changed' using errcode='42501';end if;
 if p_action in ('save','begin-avatar','commit-avatar','remove-avatar') and p_revision is distinct from p.revision then raise exception 'Account changed; reload' using errcode='PT409';end if;
 if p_action='save' then
  first_value:=btrim(p_data->>'firstName');last_value:=btrim(p_data->>'lastName');
  if jsonb_typeof(p_data->'firstName') is distinct from 'string' or jsonb_typeof(p_data->'lastName') is distinct from 'string'
   or length(first_value) not between 1 and 60 or length(last_value) not between 1 and 60 or first_value ~ '[[:cntrl:]]' or last_value ~ '[[:cntrl:]]'
   or (p_data?'completeOnboarding' and jsonb_typeof(p_data->'completeOnboarding')<>'boolean') then raise exception 'Enter valid first and last names' using errcode='23514';end if;
  update public.account_profiles set first_name=first_value,last_name=last_value,onboarding_completed_at=case when p_data->'completeOnboarding'='true'::jsonb then coalesce(onboarding_completed_at,clock_timestamp()) else onboarding_completed_at end,revision=revision+1,updated_at=clock_timestamp() where user_id=u returning * into p;
  update public.profiles set display_name=first_value||' '||last_value where id=u;
 elsif p_action='begin-avatar' then
  if (select count(*) from private.account_avatar_assets where user_id=u)>=10 then raise exception 'Finish account photo cleanup before uploading again' using errcode='23514';end if;
  asset:=gen_random_uuid();insert into private.account_avatar_assets(id,user_id,object_path,size_bytes,sha256) values(asset,u,u::text||'/'||asset::text||'.webp',(p_data->>'size')::integer,p_data->>'sha256') returning * into a;
  return jsonb_build_object('id',a.id,'path',a.object_path);
 elsif p_action='commit-avatar' then
  asset:=(p_data->>'id')::uuid;
  select * into a from private.account_avatar_assets where id=asset and user_id=u for update;
  if a.id is null or not private.avatar_capability(a.id) or not exists(select 1 from storage.objects where bucket_id='lms-avatars' and name=a.object_path and metadata->>'mimetype'='image/webp' and metadata->>'size'=a.size_bytes::text) then raise exception 'Server-verified avatar required' using errcode='42501';end if;
  update private.account_avatar_assets set status='retired' where id=p.avatar_id and user_id=u;
  update private.account_avatar_assets set status='ready' where id=a.id;
  update public.account_profiles set avatar_id=a.id,revision=revision+1,updated_at=clock_timestamp() where user_id=u returning * into p;
 elsif p_action='remove-avatar' then
  update private.account_avatar_assets set status='retired' where id=p.avatar_id and user_id=u;
  update public.account_profiles set avatar_id=null,revision=revision+1,updated_at=clock_timestamp() where user_id=u returning * into p;
 elsif p_action='abort-avatar' then
  update private.account_avatar_assets set status='retired' where id=(p_data->>'id')::uuid and user_id=u and status='pending';
 elsif p_action='cleanup' then
  update private.account_avatar_assets set status='retired' where user_id=u and status='pending' and created_at<clock_timestamp()-interval '1 hour';
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',object_path)),'[]'::jsonb) into result from private.account_avatar_assets where user_id=u and status='retired';return result;
 elsif p_action='prune-avatar' then
  delete from private.account_avatar_assets owned where owned.id=(p_data->>'id')::uuid and owned.user_id=u and owned.status='retired' and not exists(select 1 from storage.objects s where s.bucket_id='lms-avatars' and s.name=owned.object_path);
 elsif p_action<>'get' then raise exception 'Unsupported account action' using errcode='23514';end if;
 return to_jsonb(p)||jsonb_build_object('avatarPath',(select object_path from private.account_avatar_assets where id=p.avatar_id and user_id=u and status='ready'));
end$$;
revoke all on function private.account_profile(text,bigint,jsonb) from public,anon;
grant execute on function private.account_profile(text,bigint,jsonb) to authenticated;
create function public.account_profile(p_action text,p_revision bigint default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.account_profile(p_action,p_revision,p_data)$$;
revoke all on function public.account_profile(text,bigint,jsonb) from public,anon;
grant execute on function public.account_profile(text,bigint,jsonb) to authenticated;
