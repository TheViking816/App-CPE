-- A stored password must remain available to the scheduler even when the
-- official portal rejects it. Track the rejection as state, not by disabling
-- the configuration row.
create or replace function private.app_cpe_apply_portal_sync_lifecycle()
returns trigger
language plpgsql
set search_path = public, private, pg_catalog, pg_temp
as $$
begin
  if not new.enabled then
    new.sync_status := 'credentials_error';
    new.paused_at := coalesce(new.paused_at, now());
    new.pause_reason := 'credentials_error';
  elsif tg_op = 'INSERT'
    or not old.enabled
    or new.portal_password_secret_id is distinct from old.portal_password_secret_id
    or new.sync_status = 'credentials_error' then
    new.sync_status := 'active';
    new.last_app_seen_at := now();
    new.paused_at := null;
    new.pause_reason := null;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_apply_portal_sync_lifecycle()
from public, anon, authenticated, service_role;

create or replace function private.app_cpe_retire_rejected_portal_credentials()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
begin
  if new.status = 'failed'
    and new.message ~* 'usuario[[:space:]]+o[[:space:]]+contrase[nñ]a[[:space:]]+del[[:space:]]+portal[[:space:]]+oficial[[:space:]]+incorrectos' then
    update public.app_cpe_portal_auto_sync
    set sync_status = 'credentials_error',
        paused_at = now(),
        pause_reason = 'credentials_error',
        updated_at = now()
    where chapa = new.chapa
      and portal_password_secret_id is not null;

    update public.app_cpe_users
    set portal_activation_status = 'pending',
        portal_activated_at = null,
        updated_at = now()
    where chapa = new.chapa
    returning * into v_user;

    if v_user.id is not null and v_user.email is not null then
      insert into public.app_cpe_activation_email_outbox (
        user_id, kind, recipient, chapa, status, attempts, last_error, sent_at, created_at
      ) values (
        v_user.id, 'portal_credentials_rejected', v_user.email, v_user.chapa,
        'pending', 0, null, null, now()
      )
      on conflict (user_id, kind) do nothing;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_retire_rejected_portal_credentials()
from public, anon, authenticated, service_role;

-- Repair every existing row that still owns a password secret.
update public.app_cpe_portal_auto_sync
set enabled = true,
    sync_status = 'active',
    paused_at = null,
    pause_reason = null,
    updated_at = now()
where portal_password_secret_id is not null
  and not enabled;
