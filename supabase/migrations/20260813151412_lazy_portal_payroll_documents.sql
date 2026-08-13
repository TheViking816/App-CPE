alter table public.app_cpe_portal_sync_jobs
  add column if not exists request_kind text not null default 'snapshot',
  add column if not exists document_id text;

alter table public.app_cpe_portal_sync_jobs
  drop constraint if exists app_cpe_portal_sync_jobs_request_kind_check;

alter table public.app_cpe_portal_sync_jobs
  add constraint app_cpe_portal_sync_jobs_request_kind_check
  check (request_kind in ('snapshot', 'document'));

create or replace function public.app_cpe_create_portal_document_job(
  p_token text,
  p_document_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_config public.app_cpe_portal_auto_sync;
  v_snapshot public.app_cpe_portal_snapshots;
  v_password text;
  v_security_key text;
  v_job public.app_cpe_portal_sync_jobs;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if length(coalesce(p_document_id, '')) < 1 or length(p_document_id) > 240 then
    raise exception 'Documento no valido';
  end if;

  select * into v_snapshot
  from public.app_cpe_portal_snapshots
  where chapa = v_user.chapa;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_snapshot.payload->'nominas'->'rows', '[]'::jsonb)) item
    where item->>'id' = p_document_id
  ) then
    raise exception 'La nomina solicitada no pertenece a este usuario';
  end if;

  select * into v_config
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa and enabled;

  if v_config.portal_password_secret_id is null or v_config.security_key_secret_id is null then
    raise exception 'Guarda la contrasena del portal y la clave de seguridad para abrir nominas';
  end if;

  select decrypted_secret into v_password
  from vault.decrypted_secrets
  where id = v_config.portal_password_secret_id;

  select decrypted_secret into v_security_key
  from vault.decrypted_secrets
  where id = v_config.security_key_secret_id;

  if length(coalesce(v_password, '')) < 1 or length(coalesce(v_security_key, '')) < 1 then
    raise exception 'No se pudieron recuperar las claves guardadas';
  end if;

  insert into public.app_cpe_portal_sync_jobs (
    chapa, portal_password, security_key, trigger_source,
    request_kind, document_id, expires_at
  ) values (
    v_user.chapa, v_password, v_security_key, 'document',
    'document', p_document_id, now() + interval '15 minutes'
  ) returning * into v_job;

  return jsonb_build_object(
    'ok', true,
    'jobId', v_job.id,
    'status', v_job.status,
    'requestedAt', v_job.requested_at
  );
end;
$$;

revoke all on function public.app_cpe_create_portal_document_job(text, text) from public;
revoke all on function public.app_cpe_create_portal_document_job(text, text) from anon, authenticated;
grant execute on function public.app_cpe_create_portal_document_job(text, text) to service_role;
