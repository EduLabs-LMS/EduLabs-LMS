-- Teacher invitation delivery status and acceptance preview.
-- Additive only, and it only builds on 20261024120000_platform_admin_teacher_provisioning.sql: no existing function,
-- policy, grant or row is rewritten. Adds delivery-status columns to the private invitation registry, an
-- administrator-only function that records an e-mail attempt, an administrator-only read of delivery status, and a
-- function that lets the signed-in invited teacher ask what state a link is in WITHOUT consuming it.
-- Secrets: nothing here stores or returns an invitation secret. The registry still holds only SHA-256 hashes. The only new
-- link material is a random, non-secret 16-byte salt: the server derives the link secret from salt + a server-held key, so
-- Send and Copy re-create the same link without the database ever being able to reveal it.
begin;

alter table private.teacher_invitations
 add column delivery_status text not null default 'not_sent' check (delivery_status in ('not_sent','sending','sent','failed')),
 add column delivery_attempted_at timestamptz,
 add column delivery_provider_ref text check (delivery_provider_ref is null or delivery_provider_ref ~ '^[A-Za-z0-9_.:-]{1,100}$'),
 add column delivery_failure text check (delivery_failure in ('rejected')),
 add column delivery_attempts smallint not null default 0 check (delivery_attempts between 0 and 5),
 add column link_salt bytea check (link_salt is null or octet_length(link_salt)=16),
 add constraint teacher_invitations_delivery_shape check (
  (delivery_status='not_sent' and delivery_attempted_at is null and delivery_provider_ref is null and delivery_failure is null)
  or (delivery_status='sending' and delivery_attempted_at is not null and delivery_provider_ref is null and delivery_failure is null)
  or (delivery_status='sent' and delivery_attempted_at is not null and delivery_failure is null)
  or (delivery_status='failed' and delivery_attempted_at is not null and delivery_provider_ref is null and delivery_failure is not null));
comment on column private.teacher_invitations.delivery_status is
 'not_sent: no e-mail attempt. sending: attempt started, provider outcome not recorded (unconfirmed). sent: accepted by the e-mail provider (not proof of inbox delivery). failed: provider refused.';

-- An attempt is sending -> sent | failed. The administrator may deliberately send the SAME link again (at most 5 attempts per
-- invitation); each attempt clears the previous verdict and gets its own number, used for the provider idempotency key.
create function private.platform_record_invitation_delivery(p_invitation_id uuid,p_status text,p_provider_ref text,p_failure text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := private.current_app_user_id(); inv private.teacher_invitations; ref text := nullif(btrim(coalesce(p_provider_ref,'')),'');
begin
 if u is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 if p_status is null or p_status not in ('sending','sent','failed') then raise exception 'Delivery status is not allowed' using errcode='22023'; end if;
 if ref is not null and ref !~ '^[A-Za-z0-9_.:-]{1,100}$' then raise exception 'Provider reference is not valid' using errcode='22023'; end if;
 select * into inv from private.teacher_invitations where id=p_invitation_id for update;
 if inv.id is null then raise exception 'Invitation not found' using errcode='PT404'; end if;
 if inv.status <> 'pending' or inv.expires_at <= clock_timestamp() then raise exception 'The invitation is no longer valid' using errcode='PT410'; end if;
 if p_status = 'sending' then
  -- An attempt that never recorded a verdict (timeout, crash) may be sent again deliberately, but only once it can no longer be running.
  if inv.delivery_status = 'sending' and inv.delivery_attempted_at > clock_timestamp() - interval '60 seconds' then raise exception 'A delivery attempt is already in progress' using errcode='PT409'; end if;
  if inv.delivery_attempts >= 5 then raise exception 'Delivery attempt limit reached; replace the invitation' using errcode='PT409'; end if;
  update private.teacher_invitations set delivery_status='sending',delivery_attempted_at=clock_timestamp(),delivery_provider_ref=null,delivery_failure=null,
   delivery_attempts=inv.delivery_attempts+1 where id=inv.id;
  return jsonb_build_object('invitationId',inv.id,'deliveryStatus','sending','attempt',inv.delivery_attempts+1);
 else
  if inv.delivery_status <> 'sending' then raise exception 'No delivery attempt is in progress' using errcode='PT409'; end if;
  if p_status = 'sent' then
   update private.teacher_invitations set delivery_status='sent',delivery_provider_ref=ref where id=inv.id;
  else
   if p_failure is distinct from 'rejected' then raise exception 'Failure reason is not allowed' using errcode='22023'; end if;
   update private.teacher_invitations set delivery_status='failed',delivery_failure=p_failure where id=inv.id;
  end if;
 end if;
 return jsonb_build_object('invitationId',inv.id,'deliveryStatus',p_status);
end $$;

create function private.platform_invitation_delivery(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if (select private.current_app_user_id()) is null or not private.is_platform_admin() then
  raise exception 'Platform administration denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('invitationId',i.id,'status',i.delivery_status,'attemptedAt',i.delivery_attempted_at,
   'failure',i.delivery_failure,'attempts',i.delivery_attempts) order by i.created_at desc,i.id desc) from private.teacher_invitations i where i.organization_id=p_organization_id),'[]'::jsonb);
end $$;

-- The link salt is stored once per invitation, right after it is issued. Non-secret on its own.
create function private.platform_store_invitation_salt(p_invitation_id uuid,p_salt text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare inv private.teacher_invitations; v bytea;
begin
 if (select private.current_app_user_id()) is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 if p_salt is null or p_salt !~ '^[0-9a-f]{32}$' then raise exception 'Salt is not valid' using errcode='22023'; end if;
 v := decode(p_salt,'hex');
 select * into inv from private.teacher_invitations where id=p_invitation_id for update;
 if inv.id is null then raise exception 'Invitation not found' using errcode='PT404'; end if;
 if inv.status <> 'pending' or inv.expires_at <= clock_timestamp() then raise exception 'The invitation is no longer valid' using errcode='PT410'; end if;
 if inv.link_salt is not null then raise exception 'The link is already fixed' using errcode='PT409'; end if;
 update private.teacher_invitations set link_salt=v where id=inv.id;
 return jsonb_build_object('invitationId',inv.id);
end $$;

-- The active invitation's id, expiry and salt, so the server can re-derive the same link. Never rotates anything.
create function private.platform_invitation_link(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare inv private.teacher_invitations;
begin
 if (select private.current_app_user_id()) is null or not private.is_platform_admin() then raise exception 'Platform administration denied' using errcode='42501'; end if;
 select * into inv from private.teacher_invitations where organization_id=p_organization_id and status='pending' order by created_at desc,id desc limit 1;
 if inv.id is null then raise exception 'No active invitation' using errcode='PT404'; end if;
 if inv.expires_at <= clock_timestamp() then raise exception 'The invitation has expired' using errcode='PT410'; end if;
 return jsonb_build_object('invitationId',inv.id,'expiresAt',inv.expires_at,'salt',case when inv.link_salt is null then null else encode(inv.link_salt,'hex') end,
  'deliveryStatus',inv.delivery_status,'attempts',inv.delivery_attempts);
end $$;

-- Read-only: the signed-in caller learns the state of a link they already hold. Unknown secrets and states never differ in
-- timing-relevant work beyond one indexed lookup; the invited address is returned masked, and only to the holder of the secret.
create function private.teacher_invitation_preview(p_token_hash text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
 u uuid := private.current_app_user_id(); v_hash bytea; v_email text; v_verified boolean; inv private.teacher_invitations; st text;
begin
 if u is null then raise exception 'Invitation unavailable' using errcode='42501'; end if;
 v_hash := private.token_hash_bytes(p_token_hash);
 v_email := lower(btrim(coalesce(auth.jwt()->>'email','')));
 v_verified := v_email <> '' and auth.jwt()->>'email_verified' = 'true'
  and exists(select 1 from private.external_identities e where e.profile_id=u and e.provider='firebase'
   and e.issuer=auth.jwt()->>'iss' and e.subject=auth.jwt()->>'sub' and e.status='active');
 select * into inv from private.teacher_invitations where token_hash=v_hash;
 if inv.id is null then return jsonb_build_object('state','unavailable','emailVerified',v_verified); end if;
 st := case when inv.status='accepted' then 'used' when inv.status='revoked' then 'revoked'
  when inv.expires_at <= clock_timestamp() then 'expired' else 'valid' end;
 return jsonb_build_object('state',st,'emailVerified',v_verified,'emailMatches',(v_verified and inv.email=v_email),
  'acceptedByMe',(inv.accepted_by is not distinct from u and inv.accepted_by is not null),
  'maskedEmail',regexp_replace(inv.email,'^(.).*(@.*)$','\1***\2'));
end $$;

revoke all on function private.platform_record_invitation_delivery(uuid,text,text,text),private.platform_invitation_delivery(uuid),
 private.teacher_invitation_preview(text),private.platform_store_invitation_salt(uuid,text),private.platform_invitation_link(uuid) from public,anon;
grant execute on function private.platform_record_invitation_delivery(uuid,text,text,text),private.platform_invitation_delivery(uuid),
 private.teacher_invitation_preview(text),private.platform_store_invitation_salt(uuid,text),private.platform_invitation_link(uuid) to authenticated;

create function public.platform_record_invitation_delivery(p_invitation_id uuid,p_status text,p_provider_ref text default null,p_failure text default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.platform_record_invitation_delivery(p_invitation_id,p_status,p_provider_ref,p_failure) $$;
create function public.platform_invitation_delivery(p_organization_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.platform_invitation_delivery(p_organization_id) $$;
create function public.teacher_invitation_preview(p_token_hash text) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.teacher_invitation_preview(p_token_hash) $$;
create function public.platform_store_invitation_salt(p_invitation_id uuid,p_salt text) returns jsonb
language sql security invoker set search_path='' as $$ select private.platform_store_invitation_salt(p_invitation_id,p_salt) $$;
create function public.platform_invitation_link(p_organization_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.platform_invitation_link(p_organization_id) $$;
revoke all on function public.platform_record_invitation_delivery(uuid,text,text,text),public.platform_invitation_delivery(uuid),
 public.teacher_invitation_preview(text),public.platform_store_invitation_salt(uuid,text),public.platform_invitation_link(uuid) from public,anon;
grant execute on function public.platform_record_invitation_delivery(uuid,text,text,text),public.platform_invitation_delivery(uuid),
 public.teacher_invitation_preview(text),public.platform_store_invitation_salt(uuid,text),public.platform_invitation_link(uuid) to authenticated;

commit;
