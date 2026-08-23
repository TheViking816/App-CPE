-- The snapshot tables are written through PostgREST with the service role. The
-- history trigger must execute its private helpers as its trusted owner without
-- granting clients USAGE on the private schema.
create or replace function private.app_cpe_preserve_portal_snapshot_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    new.payload := private.app_cpe_preserve_portal_snapshot_payload(old.payload, new.payload);
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_preserve_portal_snapshot_trigger() from public, anon, authenticated, service_role;

-- A rejected portal password is not a transient sync failure. Disable that
-- configuration and remove its consolidated job row. Saving new credentials
-- enables the configuration again; another rejection retires it again.
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

    delete from public.app_cpe_portal_sync_jobs where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_retire_rejected_portal_credentials() from public, anon, authenticated, service_role;

drop trigger if exists app_cpe_retire_rejected_portal_credentials on public.app_cpe_portal_sync_jobs;
create trigger app_cpe_retire_rejected_portal_credentials
after update of status, message on public.app_cpe_portal_sync_jobs
for each row execute function private.app_cpe_retire_rejected_portal_credentials();
