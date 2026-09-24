-- Build a standalone iframe URL only for the owner of an active, successful
-- Portal sync. The password remains in Vault and the registro comes from that
-- user's own Noray observations (or a newer authenticated worker capture).
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
  v_registro bigint;
  v_snapshot_registro text;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if exists (
    select 1 from public.app_cpe_sessions s
    where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
      and s.expires_at > now()
      and s.is_support = true
  ) then
    raise exception 'Acceso no disponible para sesiones de soporte';
  end if;

  v_path := case p_section
    when 'disponibilidad12m' then 'disponibilidad12m'
    when 'dobles' then 'dobles'
    when 'puertas' then 'puertas'
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
  where chapa = v_user.chapa
    and enabled = true
    and sync_status = 'active'
    and last_success_at is not null;
  if v_secret_id is null then
    raise exception 'No hay sincronizacion activa del portal';
  end if;

  select payload ->> 'norayRegistro' into v_snapshot_registro
  from public.app_cpe_portal_snapshots
  where chapa = v_user.chapa;
  if v_snapshot_registro ~ '^[1-9][0-9]{0,9}$' then
    v_registro := v_snapshot_registro::integer;
  end if;
  if v_registro is null then
    select source_registro into v_registro
    from public.app_cpe_noray_jornal_observations
    where source_chapa = v_user.chapa and source_registro > 0
    order by observed_at desc
    limit 1;
  end if;
  if v_registro is null then
    raise exception 'No hay identificador Noray verificado para este usuario';
  end if;

  select decrypted_secret into v_password
  from vault.decrypted_secrets
  where id = v_secret_id;
  if nullif(v_password, '') is null then
    raise exception 'No hay acceso al portal configurado';
  end if;

  return format(
    'https://norayweb.cpevalencia.com/%s?cal=gwt&mode=PROD&req=login&usr=%s&rec=%s&pwd=%s',
    v_path,
    v_user.chapa,
    v_registro,
    encode(digest(v_password, 'sha256'), 'hex')
  );
end;
$$;

revoke all on function public.app_cpe_get_noray_link(text, text) from public, anon, authenticated;
grant execute on function public.app_cpe_get_noray_link(text, text) to anon, authenticated;
