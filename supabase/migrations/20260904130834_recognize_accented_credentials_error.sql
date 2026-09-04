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
    and new.message ~* 'usuario[[:space:]]+o[[:space:]]+contrase[nñ]a[[:space:]]+del[[:space:]]+portal[[:space:]]+oficial[[:space:]]+incorrectos' then
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
