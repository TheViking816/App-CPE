-- Keep credential-bearing links private and scoped to their exact Noray section.
create schema if not exists private;

create table if not exists private.app_cpe_manual_noray_section_links (
  chapa text not null references public.app_cpe_users(chapa) on delete cascade,
  section text not null check (section in ('vacaciones', 'dobles')),
  registro text not null check (registro ~ '^[1-9][0-9]{0,9}$'),
  password_hash text not null check (password_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now(),
  primary key (chapa, section)
);
alter table private.app_cpe_manual_noray_section_links enable row level security;
revoke all on private.app_cpe_manual_noray_section_links from public, anon, authenticated;

create or replace function public.app_cpe_admin_set_manual_noray_section_link(
  p_token text, p_chapa text, p_section text, p_url text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_admin public.app_cpe_users;
  v_chapa text := trim(coalesce(p_chapa, ''));
  v_url text := trim(coalesce(p_url, ''));
  v_usr text;
  v_rec text;
  v_pwd text;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then raise exception 'Acceso denegado'; end if;
  if p_section not in ('vacaciones', 'dobles') then raise exception 'Sección no válida'; end if;
  if v_chapa !~ '^[0-9]{5}$' or not exists (
    select 1 from public.app_cpe_users where chapa = v_chapa
  ) then raise exception 'Chapa no registrada'; end if;
  if v_url !~ ('^https://norayweb[.]cpevalencia[.]com/' || p_section || '[?]')
    or v_url ~ '[#[:space:]]' then raise exception 'Enlace no válido'; end if;
  v_usr := substring(v_url from '[?&]usr=([0-9]+)');
  v_rec := substring(v_url from '[?&]rec=([0-9]+)');
  v_pwd := lower(substring(v_url from '[?&]pwd=([A-Fa-f0-9]+)'));
  if v_usr is distinct from v_chapa or v_rec !~ '^[1-9][0-9]{0,9}$'
    or v_pwd !~ '^[a-f0-9]{64}$'
    or v_url !~ '[?&]cal=gwt(&|$)'
    or v_url !~ '[?&]mode=PROD(&|$)'
    or v_url !~ '[?&]req=login(&|$)' then
    raise exception 'Enlace no válido para esta chapa';
  end if;
  insert into private.app_cpe_manual_noray_section_links
    (chapa, section, registro, password_hash, updated_at)
  values (v_chapa, p_section, v_rec, v_pwd, now())
  on conflict (chapa, section) do update set registro = excluded.registro,
    password_hash = excluded.password_hash, updated_at = now();
  return true;
end;
$$;

create or replace function public.app_cpe_admin_manual_noray_section_status(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin public.app_cpe_users;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then raise exception 'Acceso denegado'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'chapa', u.chapa,
    'vacaciones', v.chapa is not null,
    'dobles', d.chapa is not null
  ) order by u.chapa)
    from public.app_cpe_users u
    left join private.app_cpe_manual_noray_section_links v
      on v.chapa = u.chapa and v.section = 'vacaciones'
    left join private.app_cpe_manual_noray_section_links d
      on d.chapa = u.chapa and d.section = 'dobles'), '[]'::jsonb);
end;
$$;

create or replace function public.app_cpe_has_manual_noray_section_link(
  p_token text, p_section text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_section not in ('vacaciones', 'dobles') then return false; end if;
  return exists (select 1 from private.app_cpe_manual_noray_section_links
    where chapa = v_user.chapa and section = p_section);
end;
$$;

create or replace function public.app_cpe_get_manual_noray_section_link(
  p_token text, p_section text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_link private.app_cpe_manual_noray_section_links;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_section not in ('vacaciones', 'dobles') then return null; end if;
  select * into v_link from private.app_cpe_manual_noray_section_links
  where chapa = v_user.chapa and section = p_section;
  if v_link.chapa is null then return null; end if;
  return format('https://norayweb.cpevalencia.com/%s?cal=gwt&mode=PROD&req=login&usr=%s&rec=%s&pwd=%s',
    p_section, v_user.chapa, v_link.registro, v_link.password_hash);
end;
$$;

revoke all on function public.app_cpe_admin_set_manual_noray_section_link(text, text, text, text),
  public.app_cpe_admin_manual_noray_section_status(text),
  public.app_cpe_has_manual_noray_section_link(text, text),
  public.app_cpe_get_manual_noray_section_link(text, text) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_set_manual_noray_section_link(text, text, text, text),
  public.app_cpe_admin_manual_noray_section_status(text),
  public.app_cpe_has_manual_noray_section_link(text, text),
  public.app_cpe_get_manual_noray_section_link(text, text) to anon, authenticated;
