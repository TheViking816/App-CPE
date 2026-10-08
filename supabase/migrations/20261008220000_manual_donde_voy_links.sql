-- Personal links are entered by the app administrator. Their credential-bearing
-- components never leave this private table except for an authenticated redirect.
create schema if not exists private;

create table if not exists private.app_cpe_manual_donde_voy_links (
  chapa text primary key references public.app_cpe_users(chapa) on delete cascade,
  registro text not null check (registro ~ '^[1-9][0-9]{0,9}$'),
  password_hash text not null check (password_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now()
);
alter table private.app_cpe_manual_donde_voy_links enable row level security;
revoke all on private.app_cpe_manual_donde_voy_links from public, anon, authenticated;

create or replace function public.app_cpe_admin_set_manual_donde_voy_link(
  p_token text, p_chapa text, p_url text
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
  if v_chapa !~ '^[0-9]{5}$' or not exists (
    select 1 from public.app_cpe_users where chapa = v_chapa
  ) then raise exception 'Chapa no registrada'; end if;
  if v_url !~ '^https://norayweb[.]cpevalencia[.]com/donde-voy[?]'
    or v_url ~ '[#[:space:]]' then raise exception 'Enlace no válido'; end if;
  v_usr := substring(v_url from '[?&]usr=([0-9]+)');
  v_rec := substring(v_url from '[?&]rec=([0-9]+)');
  v_pwd := lower(substring(v_url from '[?&]pwd=([A-Fa-f0-9]+)'));
  if v_usr is distinct from v_chapa or v_rec !~ '^[1-9][0-9]{0,9}$'
    or v_pwd !~ '^[a-f0-9]{64}$'
    or v_url !~ '[?&]mode=PROD(&|$)' or v_url !~ '[?&]req=login(&|$)' then
    raise exception 'Enlace no válido para esta chapa';
  end if;
  insert into private.app_cpe_manual_donde_voy_links (chapa, registro, password_hash, updated_at)
  values (v_chapa, v_rec, v_pwd, now())
  on conflict (chapa) do update set registro = excluded.registro,
    password_hash = excluded.password_hash, updated_at = now();
  return true;
end;
$$;

create or replace function public.app_cpe_admin_manual_donde_voy_status(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin public.app_cpe_users;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa <> '72683' then raise exception 'Acceso denegado'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'chapa', u.chapa, 'configured', l.chapa is not null, 'updatedAt', l.updated_at
  ) order by u.chapa)
    from public.app_cpe_users u
    left join private.app_cpe_manual_donde_voy_links l on l.chapa = u.chapa), '[]'::jsonb);
end;
$$;

create or replace function public.app_cpe_has_manual_donde_voy_link(p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  return exists (select 1 from private.app_cpe_manual_donde_voy_links
    where chapa = v_user.chapa);
end;
$$;

create or replace function public.app_cpe_get_manual_donde_voy_link(
  p_token text, p_chapa text default null
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_target text;
  v_link private.app_cpe_manual_donde_voy_links;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  v_target := coalesce(nullif(trim(p_chapa), ''), v_user.chapa);
  if v_target <> v_user.chapa and v_user.chapa <> '72683' then
    raise exception 'Acceso denegado';
  end if;
  select * into v_link from private.app_cpe_manual_donde_voy_links
  where chapa = v_target;
  if v_link.chapa is null then return null; end if;
  return format('https://norayweb.cpevalencia.com/donde-voy?cal=gwt&mode=PROD&req=login&usr=%s&rec=%s&pwd=%s',
    v_target, v_link.registro, v_link.password_hash);
end;
$$;

revoke all on function public.app_cpe_admin_set_manual_donde_voy_link(text, text, text),
  public.app_cpe_admin_manual_donde_voy_status(text),
  public.app_cpe_has_manual_donde_voy_link(text),
  public.app_cpe_get_manual_donde_voy_link(text, text) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_set_manual_donde_voy_link(text, text, text),
  public.app_cpe_admin_manual_donde_voy_status(text),
  public.app_cpe_has_manual_donde_voy_link(text),
  public.app_cpe_get_manual_donde_voy_link(text, text) to anon, authenticated;
