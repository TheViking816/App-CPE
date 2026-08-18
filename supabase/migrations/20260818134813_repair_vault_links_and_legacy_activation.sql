-- Reconnect user-owned Vault secrets that survived a removed configuration row.
with vault_passwords as (
  select id, substring(name from '([0-9]{5})$') as chapa, created_at
  from vault.secrets
  where name ~ '^app_cpe_portal_password_[0-9]{5}$'
), vault_security as (
  select id, substring(name from '([0-9]{5})$') as chapa
  from vault.secrets
  where name ~ '^app_cpe_portal_security_[0-9]{5}$'
)
insert into public.app_cpe_portal_auto_sync (
  chapa,
  portal_password_secret_id,
  security_key_secret_id,
  enabled,
  created_at,
  updated_at
)
select
  users.chapa,
  passwords.id,
  security.id,
  true,
  passwords.created_at,
  now()
from vault_passwords passwords
join public.app_cpe_users users on users.chapa = passwords.chapa
left join vault_security security on security.chapa = passwords.chapa
left join public.app_cpe_portal_auto_sync config on config.chapa = passwords.chapa
where config.chapa is null
on conflict (chapa) do nothing;

-- Undo the broad legacy classification from the preceding migration. A legacy
-- account enters pending onboarding only when it submits an email and keys.
update public.app_cpe_users users
set portal_activation_status = 'active',
    updated_at = now()
where users.chapa not in ('72683', '72728')
  and users.portal_activation_status = 'pending'
  and users.email is null
  and users.portal_activated_at is null
  and users.created_at < timestamptz '2026-08-18 12:10:38+00'
  and not exists (
    select 1 from public.app_cpe_portal_auto_sync config where config.chapa = users.chapa
  )
  and not exists (
    select 1 from public.app_cpe_portal_snapshots snapshot
    where snapshot.chapa = users.chapa and snapshot.payload is not null
  );

create or replace function public.app_cpe_update_activation_email(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_updated public.app_cpe_users;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_has_snapshot boolean;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select exists (
    select 1 from public.app_cpe_portal_snapshots snapshot
    where snapshot.chapa = v_user.chapa and snapshot.payload is not null
  ) into v_has_snapshot;

  if v_user.portal_activation_status <> 'pending' and v_has_snapshot then
    raise exception 'La cuenta ya está activada';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Introduce un correo electrónico válido';
  end if;

  update public.app_cpe_users
  set email = v_email,
      portal_activation_status = 'pending',
      portal_activated_at = null,
      updated_at = now()
  where id = v_user.id
  returning * into v_updated;

  return public.app_cpe_public_user(v_updated, p_token);
end;
$$;

create or replace function public.app_cpe_admin_portal_sync_users(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_admin public.app_cpe_users;
  v_users jsonb;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then
    raise exception using errcode = '42501', message = 'Acceso administrativo no autorizado';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'chapa', users.chapa,
      'email', users.email,
      'activationStatus', users.portal_activation_status,
      'hasCredentials', coalesce(config.enabled, false) and config.portal_password_secret_id is not null,
      'hasSecurityKey', config.security_key_secret_id is not null,
      'lastSuccessAt', config.last_success_at,
      'jobStatus', jobs.status,
      'jobMessage', jobs.message,
      'triggerSource', jobs.trigger_source,
      'requestKind', jobs.request_kind,
      'requestedAt', jobs.requested_at,
      'startedAt', jobs.started_at,
      'finishedAt', jobs.finished_at
    ) order by
      case
        when users.portal_activation_status = 'pending' then 0
        when jobs.status = 'failed' then 1
        when jobs.status in ('queued', 'running') then 2
        else 3
      end,
      users.chapa
  ), '[]'::jsonb)
  into v_users
  from public.app_cpe_users users
  left join public.app_cpe_portal_auto_sync config on config.chapa = users.chapa
  left join public.app_cpe_portal_sync_jobs jobs on jobs.chapa = users.chapa
  where users.chapa <> v_admin.chapa
    and (config.chapa is not null or users.portal_activation_status = 'pending');

  return jsonb_build_object('ok', true, 'users', v_users, 'generatedAt', now());
end;
$$;

revoke all on function public.app_cpe_update_activation_email(text, text) from public, anon, authenticated;
revoke all on function public.app_cpe_admin_portal_sync_users(text) from public, anon, authenticated;
grant execute on function public.app_cpe_update_activation_email(text, text) to anon, authenticated;
grant execute on function public.app_cpe_admin_portal_sync_users(text) to anon, authenticated;
