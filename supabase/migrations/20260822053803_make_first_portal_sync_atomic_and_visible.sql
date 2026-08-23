-- Saving credentials for a pending account must atomically notify the admin
-- and queue its initial annual load. The client RPC may safely repeat this;
-- the queue is consolidated by chapa.
create or replace function private.app_cpe_queue_pending_activation_email()
returns trigger
language plpgsql
security definer
set search_path = public, private, vault, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_password text;
  v_security_key text;
begin
  select * into v_user
  from public.app_cpe_users
  where chapa = new.chapa;

  if v_user.id is not null
    and v_user.portal_activation_status = 'pending'
    and v_user.email is not null then
    insert into public.app_cpe_activation_email_outbox (user_id, kind, recipient, chapa)
    values (v_user.id, 'admin_pending', 'portalestibavlc@gmail.com', v_user.chapa)
    on conflict (user_id, kind) do nothing;

    if new.enabled and new.portal_password_secret_id is not null then
      select decrypted_secret into v_password
      from vault.decrypted_secrets
      where id = new.portal_password_secret_id;

      select decrypted_secret into v_security_key
      from vault.decrypted_secrets
      where id = new.security_key_secret_id;

      if length(coalesce(v_password, '')) > 0 then
        perform private.app_cpe_queue_portal_sync_job(
          new.chapa,
          v_password,
          v_security_key,
          'activation_pending',
          'history',
          null,
          now() + interval '30 days'
        );
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_queue_pending_activation_email() from public, anon, authenticated, service_role;

-- Keep rejected attempts in the monitor. A later credential save reuses the
-- same row and returns it to queued, so deleting the failure only hid evidence.
create or replace function private.app_cpe_retire_rejected_portal_credentials()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $$
begin
  if new.status = 'failed'
    and new.message ~* 'usuario[[:space:]]+o[[:space:]]+contrasena[[:space:]]+del[[:space:]]+portal[[:space:]]+oficial[[:space:]]+incorrectos' then
    update public.app_cpe_portal_auto_sync
    set enabled = false,
        updated_at = now()
    where chapa = new.chapa;

    update public.app_cpe_users
    set portal_activation_status = 'pending',
        portal_activated_at = null,
        updated_at = now()
    where chapa = new.chapa;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_retire_rejected_portal_credentials() from public, anon, authenticated, service_role;

-- Restore visibility for rejected pending accounts whose old trigger removed
-- the consolidated job. No password or security key is copied into this row.
insert into public.app_cpe_portal_sync_jobs (
  chapa, portal_password, security_key, status, message,
  requested_at, started_at, finished_at, expires_at, created_at,
  trigger_source, request_kind
)
select
  config.chapa, null, null, 'failed',
  'El portal oficial rechazó el usuario o la contraseña. El usuario debe guardar unas claves nuevas.',
  config.updated_at, config.updated_at, config.updated_at,
  now() + interval '30 days', config.updated_at,
  'activation_pending', 'history'
from public.app_cpe_portal_auto_sync config
join public.app_cpe_users users on users.chapa = config.chapa
where not config.enabled
  and config.portal_password_secret_id is not null
  and users.portal_activation_status = 'pending'
  and not exists (
    select 1 from public.app_cpe_portal_sync_jobs jobs where jobs.chapa = config.chapa
  )
on conflict (chapa) do nothing;
