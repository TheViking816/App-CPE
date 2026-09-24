-- Support access to another worker's portal is explicitly enabled by the owner.
-- Record each such opening without saving the credential-bearing URL.
create table if not exists private.app_cpe_noray_link_audit (
  id bigint generated always as identity primary key,
  chapa text not null,
  section text not null,
  created_at timestamptz not null default now()
);
create index if not exists app_cpe_noray_link_audit_created_idx
  on private.app_cpe_noray_link_audit (created_at desc);
alter table private.app_cpe_noray_link_audit enable row level security;
revoke all on private.app_cpe_noray_link_audit from public, anon, authenticated;

create or replace function public.app_cpe_can_open_noray_links(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  return exists (
    select 1 from public.app_cpe_portal_auto_sync c
    where c.chapa = v_user.chapa
      and c.enabled = true
      and c.sync_status = 'active'
      and c.portal_password_secret_id is not null
      and (
        exists (
          select 1 from public.app_cpe_portal_snapshots s
          where s.chapa = v_user.chapa
            and (s.payload ->> 'norayRegistro') ~ '^[1-9][0-9]{0,9}$'
        )
        or exists (
          select 1 from public.app_cpe_noray_jornal_observations o
          where o.source_chapa = v_user.chapa and o.source_registro > 0
        )
      )
  );
end;
$$;
revoke all on function public.app_cpe_can_open_noray_links(text) from public, anon, authenticated;
grant execute on function public.app_cpe_can_open_noray_links(text) to anon, authenticated;

create or replace function public.app_cpe_get_noray_link(
  p_token text,
  p_section text
)
returns text
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_secret_id uuid;
  v_password text;
  v_path text;
  v_registro bigint;
  v_snapshot_registro text;
  v_is_support boolean;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select coalesce(s.is_support, false) into v_is_support
  from public.app_cpe_sessions s
  where s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and s.expires_at > now();
  if not found then
    raise exception 'Sesion no valida';
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
    and sync_status = 'active';
  if v_secret_id is null then
    raise exception 'No hay sincronizacion activa del portal';
  end if;

  select payload ->> 'norayRegistro' into v_snapshot_registro
  from public.app_cpe_portal_snapshots
  where chapa = v_user.chapa;
  if v_snapshot_registro ~ '^[1-9][0-9]{0,9}$' then
    v_registro := v_snapshot_registro::bigint;
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

  if v_is_support then
    insert into private.app_cpe_noray_link_audit (chapa, section)
    values (v_user.chapa, v_path);
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
