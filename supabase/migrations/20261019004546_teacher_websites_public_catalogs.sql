-- M6A: local-only until separately approved. No existing academic grants change.
begin;
create schema website_public;
revoke all on schema website_public from public;
grant usage on schema website_public to anon,authenticated;
alter default privileges in schema website_public revoke execute on functions from public;

create function private.website_text(v text,n integer) returns boolean language sql immutable set search_path='' as $$
 select v is not null and length(v)<=n and v !~ '[<>[:cntrl:]]'
$$;
create function private.website_config_valid(v jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>12000 then return false;end if;
 if exists(select 1 from jsonb_object_keys(v) x where x not in ('displayName','heroTitle','heroSubtitle','about','locale','theme','accent','ctaLabel','ctaTarget','sections','logoAssetId','heroAssetId')) then return false;end if;
 foreach k in array array['displayName','heroTitle','heroSubtitle','about','ctaLabel'] loop
  if jsonb_typeof(v->k) is distinct from 'string' or not private.website_text(v->>k,case when k='about' then 4000 when k='heroSubtitle' then 400 else 160 end) then return false;end if;
 end loop;
 if length(btrim(v->>'displayName'))=0 or length(btrim(v->>'heroTitle'))=0 or length(btrim(v->>'ctaLabel'))=0
 or coalesce(v->>'locale','') not in ('en','ar') or coalesce(v->>'theme','') not in ('green','ink','cream')
 or coalesce(v->>'accent','') not in ('green','blue','violet','amber') or coalesce(v->>'ctaTarget','') not in ('sign-in','sign-up','access') then return false;end if;
 if jsonb_typeof(v->'sections') is distinct from 'array' then return false;end if;
 if jsonb_array_length(v->'sections') not between 1 and 4 or exists(select 1 from jsonb_array_elements(v->'sections') x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('hero','about','programs','courses'))
 or (select count(distinct x) from jsonb_array_elements(v->'sections') x)<>jsonb_array_length(v->'sections') then return false;end if;
 foreach k in array array['logoAssetId','heroAssetId'] loop
  if v?k and v->k<>'null'::jsonb then
   if jsonb_typeof(v->k)<>'string' then return false;end if;perform (v->>k)::uuid;
  end if;
 end loop;
 return true;
exception when invalid_text_representation then return false;
end$$;
create function private.website_hostname_valid(v text) returns boolean language sql immutable set search_path='' as $$
 select v is not null and length(v) between 4 and 253 and v=lower(v)
 and v ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
 -- Unicode UTS46/IDNA validation is a future trusted adapter, never guessed in SQL.
 and v !~ '(^|\.)xn--' and v !~ '(^|\.)(localhost|local|internal|invalid|test|example|onion)$'
$$;
revoke all on function private.website_text(text,integer),private.website_config_valid(jsonb),private.website_hostname_valid(text) from public,anon,authenticated;

create table public.organization_websites (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null unique references public.organizations(id) on delete restrict,
 slug text not null unique check(length(slug) between 3 and 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and slug not in ('admin','api','auth','www','staging','support','edulabs','localhost')),
 status text not null default 'draft' check(status in ('draft','published','unpublished')),
 draft_config jsonb not null check(private.website_config_valid(draft_config)),
 revision bigint not null default 0 check(revision>=0), published_version_id uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,id),check(status<>'published' or published_version_id is not null)
);
create table public.public_website_assets (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null,website_id uuid not null,
 kind text not null check(kind in ('logo','hero','course')),status text not null default 'pending' check(status in ('pending','approved','revoked')),
 object_path text not null unique, mime_type text check(mime_type in ('image/webp','image/png','image/jpeg')),
 size_bytes integer check(size_bytes between 1 and 2097152),sha256 text check(sha256 ~ '^[a-f0-9]{64}$'),
 revision bigint not null default 0 check(revision>=0),reviewed_at timestamptz,created_at timestamptz not null default now(),
 foreign key(organization_id,website_id) references public.organization_websites(organization_id,id) on delete restrict,
 unique(organization_id,website_id,id),check(object_path=website_id::text||'/'||id::text||'.image'),
 check(status<>'approved' or (mime_type is not null and size_bytes is not null and sha256 is not null and reviewed_at is not null))
);
-- The (organization_id,website_id,id) unique index already covers the site FK.
create table public.website_catalog_entries (
 website_id uuid not null,organization_id uuid not null,course_id uuid not null,
 title text not null check(private.website_text(title,160) and length(btrim(title))>0),summary text not null default '' check(private.website_text(summary,1200)),asset_id uuid,
 primary key(website_id,course_id),
 foreign key(organization_id,website_id) references public.organization_websites(organization_id,id) on delete restrict,
 foreign key(organization_id,course_id) references public.courses(organization_id,id) on delete restrict,
 foreign key(organization_id,website_id,asset_id) references public.public_website_assets(organization_id,website_id,id) on delete restrict
);
create index website_entries_course_idx on public.website_catalog_entries(organization_id,course_id);
create index website_entries_asset_idx on public.website_catalog_entries(organization_id,website_id,asset_id);
create table public.website_stage_selections (
 website_id uuid not null,organization_id uuid not null,stage_id uuid not null,
 primary key(website_id,stage_id),
 foreign key(organization_id,website_id) references public.organization_websites(organization_id,id) on delete restrict,
 foreign key(organization_id,stage_id) references public.academic_stages(organization_id,id) on delete restrict
);
create index website_stage_tenant_idx on public.website_stage_selections(organization_id,stage_id);
create index website_stage_site_idx on public.website_stage_selections(organization_id,website_id);
create table private.website_publications (
 id uuid primary key default gen_random_uuid(),website_id uuid not null references public.organization_websites(id) on delete restrict,
 revision bigint not null,config jsonb not null check(private.website_config_valid(config)),created_at timestamptz not null default now(),
 unique(website_id,id),unique(website_id,revision)
);
alter table public.organization_websites add foreign key(id,published_version_id) references private.website_publications(website_id,id) on delete restrict;
create table private.website_publication_courses (
 publication_id uuid not null references private.website_publications(id) on delete restrict,course_id uuid not null references public.courses(id) on delete restrict,
 title text not null,summary text not null,asset_id uuid references public.public_website_assets(id) on delete restrict,
 primary key(publication_id,course_id)
);
create index website_publication_course_idx on private.website_publication_courses(course_id);
create index website_publication_asset_idx on private.website_publication_courses(asset_id);
create table private.website_publication_stages (
 publication_id uuid not null references private.website_publications(id) on delete restrict,stage_id uuid not null references public.academic_stages(id) on delete restrict,
 program_id uuid not null references public.academic_programs(id) on delete restrict,label text not null,program_label text not null,position integer not null,program_position integer not null,
 primary key(publication_id,stage_id)
);
create index website_publication_stage_idx on private.website_publication_stages(stage_id);
create index website_publication_program_idx on private.website_publication_stages(program_id);
create table private.website_publication_course_stages (
 publication_id uuid not null,course_id uuid not null,stage_id uuid not null,
 primary key(publication_id,course_id,stage_id),
 foreign key(publication_id,course_id) references private.website_publication_courses(publication_id,course_id) on delete restrict,
 foreign key(publication_id,stage_id) references private.website_publication_stages(publication_id,stage_id) on delete restrict
);
create index website_publication_course_stage_idx on private.website_publication_course_stages(publication_id,stage_id);
create table private.website_reserved_domains(hostname text primary key check(private.website_hostname_valid(hostname)));
insert into private.website_reserved_domains values ('edulabs.com'),('edulabs.app'),('edulabs-lms.com'),('vercel.app'),('supabase.co'),('firebaseapp.com'),('googleapis.com'),('cloudflare.com');
create function private.website_hostname_allowed(v text) returns boolean language sql stable security definer set search_path='' as $$
 select private.website_hostname_valid(v) and not exists(select 1 from private.website_reserved_domains r where v=r.hostname or right(v,length(r.hostname)+1)='.'||r.hostname)
$$;
revoke all on function private.website_hostname_allowed(text) from public,anon,authenticated;
create table public.organization_website_domains (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,website_id uuid not null,
 hostname text not null unique check(private.website_hostname_valid(hostname)),
 state text not null default 'pending' check(state in ('pending','verified','active','disabled','revoked')),
 challenge text not null check(challenge ~ '^[a-f0-9]{64}$'),challenge_expires_at timestamptz not null,
 verified_at timestamptz,valid_until timestamptz,certificate_ready boolean not null default false,
 revision bigint not null default 0 check(revision>=0),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(organization_id,website_id) references public.organization_websites(organization_id,id) on delete restrict,
 check(state not in ('verified','active') or (verified_at is not null and valid_until is not null and valid_until>verified_at)),
 check(state<>'active' or certificate_ready)
);
create index website_domain_site_idx on public.organization_website_domains(organization_id,website_id);
create table private.website_audit (
 id uuid primary key default gen_random_uuid(),website_id uuid not null references public.organization_websites(id) on delete restrict,
 actor_id uuid references public.profiles(id) on delete restrict,event text not null,revision bigint not null,details jsonb not null default '{}' check(octet_length(details::text)<=2000),created_at timestamptz not null default now()
);
create index website_audit_site_idx on private.website_audit(website_id,created_at);
create index website_audit_actor_idx on private.website_audit(actor_id);
-- No uploads or anonymous Storage policies until the byte-validation adapter is approved.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('lms-website-assets','lms-website-assets',false,2097152,array['image/webp','image/png','image/jpeg']);
do $$declare t text;begin
 foreach t in array array['organization_websites','public_website_assets','website_catalog_entries','website_stage_selections','organization_website_domains'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy website_staff_read on public.%I for select to authenticated using (private.is_org_member(organization_id))',t);
 end loop;
 foreach t in array array['website_publications','website_publication_courses','website_publication_stages','website_publication_course_stages','website_reserved_domains','website_audit'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end$$;

create function private.website_command(p_action text,p_org uuid,p_revision bigint,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=private.current_app_user_id();w public.organization_websites;asset_record public.public_website_assets;domain_record public.organization_website_domains;v uuid;item jsonb;ids uuid[];
begin
 if u is null or not private.has_org_role(p_org,array['owner','admin']) then raise exception 'Website management denied' using errcode='42501';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>20000 then raise exception 'Invalid website payload' using errcode='22023';end if;
 perform 1 from public.organizations where id=p_org for update;
 perform 1 from public.profiles where id=u for share;
 perform 1 from public.organization_memberships where organization_id=p_org and user_id=u for share nowait;
 if private.current_app_user_id() is distinct from u or not private.has_org_role(p_org,array['owner','admin']) then raise exception 'Website management denied' using errcode='42501';end if;
 select * into w from public.organization_websites where organization_id=p_org for update;
 if p_action='create' then
  if w.id is not null or p_revision is distinct from 0 then raise exception 'Website changed' using errcode='PT409';end if;
  if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('slug','config')) or jsonb_typeof(p_data->'slug') is distinct from 'string' then raise exception 'Invalid website fields' using errcode='22023';end if;
  insert into public.organization_websites(organization_id,slug,draft_config) values(p_org,p_data->>'slug',p_data->'config') returning * into w;
 else
  if w.id is null then raise exception 'Website unavailable' using errcode='42501';end if;
  if p_revision is distinct from w.revision then raise exception 'Website changed; reload' using errcode='PT409';end if;
  if p_action='draft' then
   if exists(select 1 from jsonb_object_keys(p_data) x where x<>'config') or not p_data?'config' then raise exception 'Invalid draft' using errcode='22023';end if;
   update public.organization_websites set draft_config=p_data->'config' where id=w.id;
  elsif p_action='catalog' then
   if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('courses','stages')) or jsonb_typeof(p_data->'courses') is distinct from 'array' or jsonb_typeof(p_data->'stages') is distinct from 'array' then raise exception 'Invalid catalog' using errcode='22023';end if;
   if jsonb_array_length(p_data->'courses')>200 or jsonb_array_length(p_data->'stages')>100 then raise exception 'Catalog too large' using errcode='22023';end if;
   if exists(select 1 from jsonb_array_elements(p_data->'courses') x where jsonb_typeof(x)<>'object' or exists(select 1 from jsonb_object_keys(x) k where k not in ('id','title','summary','assetId')) or jsonb_typeof(x->'id') is distinct from 'string' or jsonb_typeof(x->'title') is distinct from 'string' or jsonb_typeof(x->'summary') is distinct from 'string') then raise exception 'Invalid public course fields' using errcode='22023';end if;
   if exists(select 1 from jsonb_array_elements(p_data->'stages') x where jsonb_typeof(x)<>'string') then raise exception 'Invalid stage IDs' using errcode='22023';end if;
   delete from public.website_catalog_entries where website_id=w.id;
   for item in select * from jsonb_array_elements(p_data->'courses') loop
    insert into public.website_catalog_entries(website_id,organization_id,course_id,title,summary,asset_id) values(w.id,p_org,(item->>'id')::uuid,item->>'title',item->>'summary',(item->>'assetId')::uuid);
   end loop;
   delete from public.website_stage_selections where website_id=w.id;
   insert into public.website_stage_selections(website_id,organization_id,stage_id) select w.id,p_org,value::uuid from jsonb_array_elements_text(p_data->'stages');
  elsif p_action='publish' then
   if p_data<>'{}' then raise exception 'Unexpected publish fields' using errcode='22023';end if;
   if not private.website_config_valid(w.draft_config) or (select count(*) from public.website_catalog_entries where website_id=w.id)>200 or (select count(*) from public.website_stage_selections where website_id=w.id)>100 then raise exception 'Invalid publication' using errcode='22023';end if;
   if exists(select 1 from public.website_catalog_entries e join public.courses c on c.id=e.course_id where e.website_id=w.id and (c.status<>'published' or c.visibility<>'public')) then raise exception 'Catalog contains non-public course' using errcode='42501';end if;
   if exists(select 1 from public.website_stage_selections e join public.academic_stages s on s.id=e.stage_id join public.academic_programs p on p.id=s.program_id where e.website_id=w.id and (s.status<>'active' or p.status<>'active')) then raise exception 'Catalog contains inactive stage' using errcode='42501';end if;
   select coalesce(array_agg(id),'{}'::uuid[]) into ids from (
    select (w.draft_config->>'logoAssetId')::uuid id union select (w.draft_config->>'heroAssetId')::uuid union select asset_id from public.website_catalog_entries where website_id=w.id
   ) x where id is not null;
   if exists(select 1 from unnest(ids) chosen(asset_id) where not exists(select 1 from public.public_website_assets a where a.id=chosen.asset_id and a.website_id=w.id and a.organization_id=p_org and a.status='approved')) then raise exception 'Approved same-site asset required' using errcode='42501';end if;
   insert into private.website_publications(website_id,revision,config) values(w.id,w.revision+1,w.draft_config) returning id into v;
   insert into private.website_publication_courses select v,course_id,title,summary,asset_id from public.website_catalog_entries where website_id=w.id;
   insert into private.website_publication_stages select v,s.id,p.id,s.label,p.label,s.position,p.position from public.website_stage_selections e join public.academic_stages s on s.id=e.stage_id join public.academic_programs p on p.id=s.program_id where e.website_id=w.id;
   insert into private.website_publication_course_stages select v,a.course_id,a.stage_id from public.course_stage_assignments a join public.website_catalog_entries e on e.course_id=a.course_id and e.website_id=w.id join public.website_stage_selections s on s.stage_id=a.stage_id and s.website_id=w.id;
   update public.organization_websites set status='published',published_version_id=v where id=w.id;
  elsif p_action='unpublish' then
   if p_data<>'{}' then raise exception 'Unexpected unpublish fields' using errcode='22023';end if;
   update public.organization_websites set status='unpublished' where id=w.id;
  elsif p_action='asset.reserve' then
   if exists(select 1 from jsonb_object_keys(p_data) x where x<>'kind') or jsonb_typeof(p_data->'kind') is distinct from 'string' or (select count(*) from public.public_website_assets where website_id=w.id and status<>'revoked')>=10 then raise exception 'Invalid asset reservation' using errcode='22023';end if;
   v:=gen_random_uuid();insert into public.public_website_assets(id,organization_id,website_id,kind,object_path) values(v,p_org,w.id,p_data->>'kind',w.id::text||'/'||v::text||'.image') returning * into asset_record;
  elsif p_action='domain.claim' then
   if exists(select 1 from jsonb_object_keys(p_data) x where x<>'hostname') or not coalesce(private.website_hostname_allowed(p_data->>'hostname'),false) or (select count(*) from public.organization_website_domains where website_id=w.id)>=10 then raise exception 'Invalid hostname or binding limit' using errcode='22023';end if;
   insert into public.organization_website_domains(organization_id,website_id,hostname,challenge,challenge_expires_at) values(p_org,w.id,p_data->>'hostname',replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),clock_timestamp()+interval '24 hours') returning * into domain_record;
  elsif p_action in ('domain.rotate','domain.activate','domain.disable') then
   if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('id','revision')) or jsonb_typeof(p_data->'revision') is distinct from 'number' then raise exception 'Invalid domain command' using errcode='22023';end if;
   select * into domain_record from public.organization_website_domains where id=(p_data->>'id')::uuid and website_id=w.id for update;
   if domain_record.id is null then raise exception 'Domain denied' using errcode='42501';end if;
   if domain_record.revision is distinct from (p_data->>'revision')::bigint then raise exception 'Domain changed' using errcode='PT409';end if;
   if domain_record.state='revoked' then raise exception 'Domain revoked' using errcode='42501';end if;
   if p_action='domain.activate' then
    if domain_record.state<>'verified' or domain_record.valid_until<=clock_timestamp() or not domain_record.certificate_ready or not private.website_hostname_allowed(domain_record.hostname) then raise exception 'Verified certificate-eligible binding required' using errcode='42501';end if;
    update public.organization_website_domains set state='active' where id=domain_record.id;
   elsif p_action='domain.disable' then update public.organization_website_domains set state='disabled',certificate_ready=false where id=domain_record.id;
   else update public.organization_website_domains set state='pending',challenge=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),challenge_expires_at=clock_timestamp()+interval '24 hours',verified_at=null,valid_until=null,certificate_ready=false where id=domain_record.id;
   end if;
   update public.organization_website_domains set revision=revision+1,updated_at=clock_timestamp() where id=domain_record.id returning * into domain_record;
  else raise exception 'Unsupported website action' using errcode='22023';end if;
  update public.organization_websites set revision=revision+1,updated_at=clock_timestamp() where id=w.id returning * into w;
 end if;
 insert into private.website_audit(website_id,actor_id,event,revision,details) values(w.id,u,p_action,w.revision,jsonb_strip_nulls(jsonb_build_object('domainId',domain_record.id,'assetId',asset_record.id,'publicationId',case when p_action='publish' then v end)));
 return jsonb_build_object('website',to_jsonb(w),'asset',case when asset_record.id is null then null else to_jsonb(asset_record) end,'domain',case when domain_record.id is null then null else to_jsonb(domain_record) end);
end$$;
revoke all on function private.website_command(text,uuid,bigint,jsonb) from public,anon;
grant execute on function private.website_command(text,uuid,bigint,jsonb) to authenticated;
create function public.teacher_website_command(p_action text,p_organization_id uuid,p_revision bigint,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select private.website_command(p_action,p_organization_id,p_revision,p_data)$$;
revoke all on function public.teacher_website_command(text,uuid,bigint,jsonb) from public,anon;
grant execute on function public.teacher_website_command(text,uuid,bigint,jsonb) to authenticated;

-- Trusted worker boundary: no owner/student/anonymous execution and no DNS/HTTP I/O.
create function private.review_website_resource(p_kind text,p_id uuid,p_revision bigint,p_approve boolean,p_evidence text,p_data jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare domain_record public.organization_website_domains;asset_record public.public_website_assets;site uuid;org uuid;rev bigint;
begin
 if p_approve is null or not private.website_text(p_evidence,160) or length(p_evidence)<8 or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>2000 then raise exception 'Trusted review evidence required' using errcode='22023';end if;
 if p_kind='domain' then select website_id,organization_id into site,org from public.organization_website_domains where id=p_id;
 elsif p_kind='asset' then select website_id,organization_id into site,org from public.public_website_assets where id=p_id;
 else raise exception 'Unknown review kind' using errcode='22023';end if;
 if site is null then raise exception 'Resource unavailable' using errcode='42501';end if;
 perform 1 from public.organizations where id=org for update;
 perform 1 from public.organization_websites where id=site for update;
 if p_kind='domain' then
  if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('challenge','certificateReady')) then raise exception 'Invalid verification receipt' using errcode='22023';end if;
  select * into domain_record from public.organization_website_domains where id=p_id for update;
  if domain_record.revision is distinct from p_revision then raise exception 'Domain changed' using errcode='PT409';end if;
  if p_approve then
   if domain_record.state not in ('pending','verified','active') or domain_record.challenge_expires_at<=clock_timestamp() or domain_record.challenge is distinct from p_data->>'challenge' or not private.website_hostname_allowed(domain_record.hostname) or jsonb_typeof(p_data->'certificateReady') is distinct from 'boolean' then raise exception 'Invalid ownership proof' using errcode='42501';end if;
   update public.organization_website_domains set state='verified',verified_at=clock_timestamp(),valid_until=clock_timestamp()+interval '7 days',certificate_ready=(p_data->>'certificateReady')::boolean where id=p_id;
  else update public.organization_website_domains set state='revoked',certificate_ready=false,valid_until=null where id=p_id;end if;
  update public.organization_website_domains set revision=revision+1,updated_at=clock_timestamp() where id=p_id returning revision into rev;
 else
  if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('mime','size','sha256')) then raise exception 'Invalid asset receipt' using errcode='22023';end if;
  select * into asset_record from public.public_website_assets where id=p_id for update;
  if asset_record.revision is distinct from p_revision then raise exception 'Asset changed' using errcode='PT409';end if;
  if p_approve then
   if asset_record.status<>'pending' or not exists(select 1 from storage.objects where bucket_id='lms-website-assets' and name=asset_record.object_path and metadata->>'mimetype'=p_data->>'mime' and metadata->>'size'=p_data->>'size' and metadata->>'sha256'=p_data->>'sha256') then raise exception 'Verified dedicated object required' using errcode='42501';end if;
   update public.public_website_assets set status='approved',mime_type=p_data->>'mime',size_bytes=(p_data->>'size')::integer,sha256=p_data->>'sha256',reviewed_at=clock_timestamp() where id=p_id;
  else update public.public_website_assets set status='revoked' where id=p_id;end if;
  update public.public_website_assets set revision=revision+1 where id=p_id returning revision into rev;
 end if;
 insert into private.website_audit(website_id,event,revision,details) values(site,p_kind||case when p_approve then '.verified' else '.revoked' end,rev,jsonb_build_object('resourceId',p_id,'evidence',p_evidence));
end$$;
revoke all on function private.review_website_resource(text,uuid,bigint,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function private.review_website_resource(text,uuid,bigint,boolean,text,jsonb) to service_role;
create function public.review_website_resource(p_kind text,p_id uuid,p_revision bigint,p_approve boolean,p_evidence text,p_data jsonb default '{}') returns void language sql security invoker set search_path='' as $$select private.review_website_resource(p_kind,p_id,p_revision,p_approve,p_evidence,p_data)$$;
revoke all on function public.review_website_resource(text,uuid,bigint,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.review_website_resource(text,uuid,bigint,boolean,text,jsonb) to service_role;

create function website_public.catalog(p_slug text,p_stage_id uuid default null,p_after uuid default null,p_limit integer default 20,p_course_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w public.organization_websites;v private.website_publications;items jsonb;stages jsonb;config jsonb;n integer;next_id uuid;
begin
 if p_slug is null or length(p_slug)>80 or p_limit is null or p_limit not between 1 and 50 or (p_course_id is not null and p_after is not null) then raise exception 'Invalid public query' using errcode='22023';end if;
 select s.* into w from public.organization_websites s join public.organizations o on o.id=s.organization_id where s.slug=p_slug and s.status='published' and o.status='active';
 if w.id is null then return null;end if;
 select * into v from private.website_publications where id=w.published_version_id and website_id=w.id;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.stage_id,'label',s.label,'programId',s.program_id,'programLabel',s.program_label,'position',s.position,'programPosition',s.program_position) order by s.program_position,s.program_id,s.position,s.stage_id),'[]') into stages
 from private.website_publication_stages s join public.academic_stages a on a.id=s.stage_id join public.academic_programs p on p.id=s.program_id where s.publication_id=v.id and a.status='active' and p.status='active' and a.organization_id=w.organization_id;
 if p_stage_id is not null and not exists(select 1 from jsonb_array_elements(stages) s where s->>'id'=p_stage_id::text) then return null;end if;
 select coalesce(jsonb_agg(x.value order by x.course_id),'[]'),count(*) into items,n from (
  select c.course_id,jsonb_build_object('id',c.course_id,'title',c.title,'summary',c.summary,
   'assetId',(select a.id from public.public_website_assets a where a.id=c.asset_id and a.website_id=w.id and a.status='approved'),
   'stageIds',coalesce((select jsonb_agg(s.stage_id order by s.stage_id) from private.website_publication_course_stages s where s.publication_id=v.id and s.course_id=c.course_id and exists(select 1 from jsonb_array_elements(stages) a where a->>'id'=s.stage_id::text)),'[]')) value
  from private.website_publication_courses c join public.courses live on live.id=c.course_id and live.organization_id=w.organization_id
  where c.publication_id=v.id and live.status='published' and live.visibility='public' and (p_after is null or c.course_id>p_after) and (p_course_id is null or c.course_id=p_course_id)
   and (p_stage_id is null or exists(select 1 from private.website_publication_course_stages s where s.publication_id=v.id and s.course_id=c.course_id and s.stage_id=p_stage_id)) order by c.course_id limit p_limit+1
 ) x;
 if p_course_id is not null and n=0 then return null;end if;
 if n>p_limit then items:=items- p_limit;end if;
 if jsonb_array_length(items)>0 then next_id:=(items->(jsonb_array_length(items)-1)->>'id')::uuid;end if;
 config:=v.config;
 config:=config||jsonb_build_object('logoAssetId',(select id from public.public_website_assets where id=(config->>'logoAssetId')::uuid and website_id=w.id and status='approved'),'heroAssetId',(select id from public.public_website_assets where id=(config->>'heroAssetId')::uuid and website_id=w.id and status='approved'));
 return jsonb_build_object('slug',w.slug,'version',v.id,'revision',v.revision,'site',config,'stages',stages,'courses',items,'hasMore',n>p_limit,'next',case when n>p_limit then next_id else null end);
end$$;
create function website_public.domain_lookup(p_hostname text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('slug',w.slug,'version',w.published_version_id) from public.organization_website_domains d join public.organization_websites w on w.id=d.website_id join public.organizations o on o.id=w.organization_id
 where d.hostname=p_hostname and private.website_hostname_allowed(p_hostname) and d.state='active' and d.valid_until>clock_timestamp() and d.certificate_ready and w.status='published' and o.status='active'
$$;
create function website_public.asset(p_slug text,p_asset uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'mime',a.mime_type,'size',a.size_bytes,'sha256',a.sha256) from public.public_website_assets a join public.organization_websites w on w.id=a.website_id join public.organizations o on o.id=w.organization_id join private.website_publications v on v.id=w.published_version_id
 where w.slug=p_slug and w.status='published' and o.status='active' and a.id=p_asset and a.status='approved' and
 (v.config->>'logoAssetId'=a.id::text or v.config->>'heroAssetId'=a.id::text or exists(select 1 from private.website_publication_courses e join public.courses c on c.id=e.course_id where e.publication_id=v.id and e.asset_id=a.id and c.organization_id=w.organization_id and c.status='published' and c.visibility='public'))
$$;
revoke all on function website_public.catalog(text,uuid,uuid,integer,uuid),website_public.domain_lookup(text),website_public.asset(text,uuid) from public;
grant execute on function website_public.catalog(text,uuid,uuid,integer,uuid),website_public.domain_lookup(text),website_public.asset(text,uuid) to anon,authenticated;
create function public.public_teacher_catalog(p_slug text,p_stage_id uuid default null,p_after uuid default null,p_limit integer default 20,p_course_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select website_public.catalog(p_slug,p_stage_id,p_after,p_limit,p_course_id)$$;
create function public.resolve_teacher_website(p_hostname text) returns jsonb language sql stable security invoker set search_path='' as $$select website_public.domain_lookup(p_hostname)$$;
create function public.public_teacher_asset(p_slug text,p_asset_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select website_public.asset(p_slug,p_asset_id)$$;
revoke all on function public.public_teacher_catalog(text,uuid,uuid,integer,uuid),public.resolve_teacher_website(text),public.public_teacher_asset(text,uuid) from public;
grant execute on function public.public_teacher_catalog(text,uuid,uuid,integer,uuid),public.resolve_teacher_website(text),public.public_teacher_asset(text,uuid) to anon,authenticated;
comment on schema website_public is 'Non-exposed projection-only schema. Anonymous USAGE does not extend to the private academic/helper schema.';
comment on table public.organization_website_domains is 'No automatic reclaim: disabled/revoked hostnames remain reserved. TXT verification and certificate readiness require a trusted reviewed adapter; no DNS I/O here.';
commit;
