create or replace function private.app_cpe_purge_stale_portal_state(p_chapa text)
returns void
language plpgsql
security definer
set search_path = public, private, vault, pg_temp
as $$
declare
  v_password_secret_id uuid;
  v_security_secret_id uuid;
begin
  select portal_password_secret_id, security_key_secret_id
  into v_password_secret_id, v_security_secret_id
  from public.app_cpe_portal_auto_sync
  where chapa = p_chapa;

  delete from public.app_cpe_portal_documents where chapa = p_chapa;
  delete from public.app_cpe_portal_preview_snapshots where chapa = p_chapa;
  delete from public.app_cpe_portal_snapshots where chapa = p_chapa;
  delete from public.app_cpe_portal_sync_jobs where chapa = p_chapa;
  delete from public.app_cpe_portal_auto_sync where chapa = p_chapa;

  if v_password_secret_id is not null then delete from vault.secrets where id = v_password_secret_id; end if;
  if v_security_secret_id is not null then delete from vault.secrets where id = v_security_secret_id; end if;
end;
$$;

revoke all on function private.app_cpe_purge_stale_portal_state(text) from public, anon, authenticated;

create or replace function public.app_cpe_register(p_chapa text, p_password text, p_specialties text[], p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_token text;
  v_chapa text;
  v_email text;
  v_specialties text[];
begin
  v_chapa := public.app_cpe_normalize_chapa(p_chapa);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_cpe_register:' || v_chapa, 0));
  if exists (select 1 from public.app_cpe_users where chapa = v_chapa) then raise exception 'Esa chapa ya está registrada'; end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if length(coalesce(p_password, '')) < 4 then raise exception 'La contraseña debe tener al menos 4 caracteres'; end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Introduce un correo electrónico válido'; end if;
  v_specialties := coalesce(p_specialties, '{}'::text[]);
  if cardinality(v_specialties) is null or cardinality(v_specialties) = 0 then raise exception 'Selecciona al menos una especialidad'; end if;

  perform private.app_cpe_purge_stale_portal_state(v_chapa);
  insert into public.app_cpe_users (chapa, password_hash, specialties, email, portal_activation_status)
  values (v_chapa, crypt(p_password, gen_salt('bf')), v_specialties, v_email, 'pending')
  returning * into v_user;
  v_token := public.app_cpe_create_session(v_user.id);
  return public.app_cpe_public_user(v_user, v_token);
end;
$$;

revoke all on function public.app_cpe_register(text, text, text[], text) from public;
grant execute on function public.app_cpe_register(text, text, text[], text) to anon, authenticated;
