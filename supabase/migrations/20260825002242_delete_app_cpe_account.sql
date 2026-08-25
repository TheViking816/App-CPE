-- The account owner may permanently remove every App CPE record associated
-- with their user and chapa. The app uses its own opaque session tokens, so
-- the current password and an explicit confirmation are both required.
-- These foreign keys also prevent an already-running worker from recreating
-- portal data after the account row has disappeared.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_cpe_portal_documents_chapa_user_fkey') then
    alter table public.app_cpe_portal_documents
      add constraint app_cpe_portal_documents_chapa_user_fkey
      foreign key (chapa) references public.app_cpe_users(chapa) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_cpe_portal_preview_snapshots_chapa_user_fkey') then
    alter table public.app_cpe_portal_preview_snapshots
      add constraint app_cpe_portal_preview_snapshots_chapa_user_fkey
      foreign key (chapa) references public.app_cpe_users(chapa) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_cpe_portal_snapshots_chapa_user_fkey') then
    alter table public.app_cpe_portal_snapshots
      add constraint app_cpe_portal_snapshots_chapa_user_fkey
      foreign key (chapa) references public.app_cpe_users(chapa) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_cpe_portal_sync_jobs_chapa_user_fkey') then
    alter table public.app_cpe_portal_sync_jobs
      add constraint app_cpe_portal_sync_jobs_chapa_user_fkey
      foreign key (chapa) references public.app_cpe_users(chapa) on delete cascade;
  end if;
end;
$$;

create or replace function public.app_cpe_delete_account(
  p_token text,
  p_current_password text,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_password_secret_id uuid;
  v_security_secret_id uuid;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select users.* into v_user
  from public.app_cpe_users users
  where users.id = v_user.id
  for update;

  if v_user.password_hash <> crypt(coalesce(p_current_password, ''), v_user.password_hash) then
    raise exception 'La contraseña actual no es correcta';
  end if;

  if upper(trim(coalesce(p_confirmation, ''))) <> 'ELIMINAR' then
    raise exception 'Escribe ELIMINAR para confirmar la baja definitiva';
  end if;

  select portal_password_secret_id, security_key_secret_id
  into v_password_secret_id, v_security_secret_id
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa;

  -- These tables are keyed by chapa rather than user_id and therefore do not
  -- participate in the user foreign-key cascades.
  delete from public.app_cpe_portal_documents where chapa = v_user.chapa;
  delete from public.app_cpe_portal_preview_snapshots where chapa = v_user.chapa;
  delete from public.app_cpe_portal_snapshots where chapa = v_user.chapa;
  delete from public.app_cpe_portal_sync_jobs where chapa = v_user.chapa;
  delete from public.app_cpe_usage_events where chapa = v_user.chapa;

  -- Sessions, activation emails, relay-hour preferences and portal auto-sync
  -- configuration are removed by their ON DELETE CASCADE constraints.
  delete from public.app_cpe_users where id = v_user.id;

  if v_password_secret_id is not null then
    delete from vault.secrets where id = v_password_secret_id;
  end if;
  if v_security_secret_id is not null then
    delete from vault.secrets where id = v_security_secret_id;
  end if;

  return jsonb_build_object('ok', true, 'deleted', true);
end;
$$;

revoke all on function public.app_cpe_delete_account(text, text, text) from public, anon, authenticated;
grant execute on function public.app_cpe_delete_account(text, text, text) to anon, authenticated;
