alter table public.app_cpe_activation_email_outbox
  drop constraint if exists app_cpe_activation_email_outbox_kind_check;

alter table public.app_cpe_activation_email_outbox
  add constraint app_cpe_activation_email_outbox_kind_check
  check (kind in (
    'admin_pending',
    'user_activated',
    'portal_credentials_rejected',
    'premium_history_ready',
    'admin_security_key_added'
  ));

create or replace function private.app_cpe_mark_premium_history_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
begin
  if old.security_key_secret_id is null
     and new.security_key_secret_id is not null
     and old.portal_password_secret_id is not null then
    select * into v_user
    from public.app_cpe_users
    where chapa = new.chapa
      and portal_activation_status = 'active';

    if v_user.id is not null then
      new.premium_history_email_pending_at := now();

      insert into public.app_cpe_activation_email_outbox (
        user_id, kind, recipient, chapa
      ) values (
        v_user.id,
        'admin_security_key_added',
        'portalestibavlc@gmail.com',
        v_user.chapa
      ) on conflict (user_id, kind) do nothing;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_mark_premium_history_email()
from public, anon, authenticated, service_role;
