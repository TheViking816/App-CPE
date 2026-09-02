-- A rejected Portal password is one notification episode. Repeated workers may
-- fail for the same saved password, but they must not re-arm the same email.
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
    and new.message ~* 'usuario[[:space:]]+o[[:space:]]+contrasena[[:space:]]+del[[:space:]]+portal[[:space:]]+oficial[[:space:]]+incorrectos' then
    update public.app_cpe_portal_auto_sync
    set enabled = false,
        updated_at = now()
    where chapa = new.chapa;

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

-- Saving a password starts a new notification episode. The Vault secret ID is
-- normally reused, so this deliberately reacts to UPDATE OF even when the ID
-- itself has not changed.
create or replace function private.app_cpe_reset_rejected_credentials_email()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $$
begin
  if new.portal_password_secret_id is not null then
    delete from public.app_cpe_activation_email_outbox outbox
    using public.app_cpe_users users
    where users.chapa = new.chapa
      and outbox.user_id = users.id
      and outbox.kind = 'portal_credentials_rejected';
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_reset_rejected_credentials_email()
from public, anon, authenticated, service_role;

drop trigger if exists app_cpe_reset_rejected_credentials_email
on public.app_cpe_portal_auto_sync;

create trigger app_cpe_reset_rejected_credentials_email
after insert or update of portal_password_secret_id
on public.app_cpe_portal_auto_sync
for each row execute function private.app_cpe_reset_rejected_credentials_email();
