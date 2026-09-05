create or replace function private.app_cpe_mark_premium_history_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.app_cpe_users;
  v_snapshot jsonb;
  v_needs_initial_history boolean := false;
begin
  if new.security_key_secret_id is not null
     and old.portal_password_secret_id is not null then
    select * into v_user
    from public.app_cpe_users
    where chapa = new.chapa
      and portal_activation_status = 'active';

    if v_user.id is not null then
      select payload into v_snapshot
      from public.app_cpe_portal_snapshots
      where chapa = new.chapa;

      v_needs_initial_history := old.security_key_secret_id is null
        or v_snapshot #>> '{sync,fullHistoryCompletedAt}' is null
        or v_snapshot #>> '{nominas,recognized}' is distinct from 'true'
        or v_snapshot #>> '{nominas,locked}' is distinct from 'false'
        or coalesce(jsonb_array_length(v_snapshot #> '{nominas,rows}'), 0) = 0;

      -- Updating a rejected key reuses the same Vault secret id. Mark the
      -- history email pending whenever the user still lacks a complete first
      -- history, even though the id itself did not change.
      if v_needs_initial_history then
        new.premium_history_email_pending_at := now();
      end if;

      -- Also recover the administrative notice when the first saved key was
      -- rejected and its Vault id is reused by the corrected value.
      if v_needs_initial_history then
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
  end if;
  return new;
end;
$$;
