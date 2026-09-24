-- Limited pilot: only chapa 72683 can request the verified standalone Noray pages.
-- The portal password stays in Vault; this function never returns it in cleartext.
create or replace function public.app_cpe_get_noray_link(
  p_token text,
  p_section text
)
returns text
language plpgsql
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_secret_id uuid;
  v_password text;
  v_path text;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if v_user.chapa <> '72683' then
    raise exception 'Acceso no disponible para este usuario';
  end if;

  if exists (
    select 1 from public.app_cpe_sessions s
    where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and s.expires_at > now()
      and s.is_support = true
  ) then
    raise exception 'Acceso no disponible para sesiones de soporte';
  end if;

  v_path := case p_section
    when 'jornales' then 'jornales'
    when 'donde-voy' then 'donde-voy'
    when 'mis-especialidades' then 'mis-especialidades'
    when 'chapero' then 'chapero'
    when 'chapero-especialidades' then 'chapero-especialidades'
    when 'jornada-contratada' then 'jornada-contratada'
    else null
  end;

  if v_path is null then
    raise exception 'Seccion no disponible';
  end if;

  select portal_password_secret_id into v_secret_id
  from public.app_cpe_portal_auto_sync
  where chapa = v_user.chapa and enabled = true;

  if v_secret_id is null then
    raise exception 'No hay acceso al portal configurado';
  end if;

  select decrypted_secret into v_password
  from vault.decrypted_secrets
  where id = v_secret_id;

  if nullif(v_password, '') is null then
    raise exception 'No hay acceso al portal configurado';
  end if;

  return format(
    'https://norayweb.cpevalencia.com/%s?cal=gwt&mode=PROD&req=login&usr=%s&rec=2611&pwd=%s',
    v_path,
    v_user.chapa,
    encode(digest(v_password, 'sha256'), 'hex')
  );
end;
$$;

revoke all on function public.app_cpe_get_noray_link(text, text) from public;
grant execute on function public.app_cpe_get_noray_link(text, text) to anon, authenticated;
