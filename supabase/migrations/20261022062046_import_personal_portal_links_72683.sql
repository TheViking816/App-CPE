create table private.app_cpe_imported_portal_links (
  chapa text not null references public.app_cpe_users(chapa) on delete cascade check (chapa = '72683'),
  section text not null check (section in ('descansos','vacaciones','dobles','jornales','donde-voy','chapero','chapero-especialidades','puertas','jornada-contratada','mis-especialidades','excepciones-pedidas','excluir-jornadas','disponibilidad12m','puntos-formacion','situacion-trabajador','solicito-formacion')),
  registro text not null check (registro ~ '^[1-9][0-9]{0,9}$'),
  password_hash text not null check (password_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now(),
  primary key (chapa, section)
);
alter table private.app_cpe_imported_portal_links enable row level security;
revoke all on private.app_cpe_imported_portal_links from public, anon, authenticated;

create function public.app_cpe_imported_portal_link_status(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa is distinct from '72683' then raise exception 'Acceso denegado'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('section', section, 'updatedAt', updated_at) order by section)
    from private.app_cpe_imported_portal_links where chapa = v_user.chapa), '[]'::jsonb);
end; $$;

create function public.app_cpe_import_personal_portal_links(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users; item jsonb; v_section text; v_url text; v_rec text; v_pwd text;
  v_seen text[] := array[]::text[];
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa is distinct from '72683' then raise exception 'Acceso denegado'; end if;
  if p_payload is null or octet_length(p_payload::text) > 40000
    or p_payload->>'version' is distinct from '1' or p_payload->>'chapa' is distinct from v_user.chapa
    or jsonb_typeof(p_payload->'enlaces') is distinct from 'array' then raise exception 'Importación no válida'; end if;
  if jsonb_array_length(p_payload->'enlaces') not between 1 and 16 then raise exception 'Número de enlaces no válido'; end if;
  for item in select value from jsonb_array_elements(p_payload->'enlaces') loop
    v_section := substring(item->>'seccion' from '^/([a-z0-9-]+)$');
    if v_section is null or v_section <> all(array['descansos','vacaciones','dobles','jornales','donde-voy','chapero','chapero-especialidades','puertas','jornada-contratada','mis-especialidades','excepciones-pedidas','excluir-jornadas','disponibilidad12m','puntos-formacion','situacion-trabajador','solicito-formacion'])
      or v_section = any(v_seen) then raise exception 'Sección no válida o repetida'; end if;
    v_url := item->>'url';
    if v_url is null or v_url !~ ('^https://norayweb[.]cpevalencia[.]com/' || v_section || '[?]cal=gwt&mode=PROD&req=login&usr=72683&rec=[1-9][0-9]{0,9}&pwd=[A-Fa-f0-9]{64}$') then
      raise exception 'Enlace no válido para esta chapa';
    end if;
    v_rec := substring(v_url from '&rec=([0-9]+)&');
    v_pwd := lower(substring(v_url from '&pwd=([A-Fa-f0-9]{64})$'));
    insert into private.app_cpe_imported_portal_links(chapa,section,registro,password_hash)
      values(v_user.chapa,v_section,v_rec,v_pwd)
      on conflict(chapa,section) do update set registro=excluded.registro,password_hash=excluded.password_hash,updated_at=now();
    v_seen := array_append(v_seen,v_section);
  end loop;
  return public.app_cpe_imported_portal_link_status(p_token);
end; $$;

create function public.app_cpe_get_imported_portal_link(p_token text, p_section text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_link private.app_cpe_imported_portal_links;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa is distinct from '72683' then return null; end if;
  select * into v_link from private.app_cpe_imported_portal_links where chapa=v_user.chapa and section=p_section;
  if not found then return null; end if;
  return format('https://norayweb.cpevalencia.com/%s?cal=gwt&mode=PROD&req=login&usr=%s&rec=%s&pwd=%s',v_link.section,v_user.chapa,v_link.registro,v_link.password_hash);
end; $$;

revoke all on function public.app_cpe_import_personal_portal_links(text,jsonb), public.app_cpe_imported_portal_link_status(text), public.app_cpe_get_imported_portal_link(text,text) from public, anon, authenticated;
grant execute on function public.app_cpe_import_personal_portal_links(text,jsonb), public.app_cpe_imported_portal_link_status(text), public.app_cpe_get_imported_portal_link(text,text) to anon, authenticated;
