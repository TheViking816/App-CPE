-- The official portal snapshot supplies a name only when the App CPE profile
-- has none. A name chosen in "Nombre y privacidad" always takes precedence.
create function private.app_cpe_fill_missing_portal_name()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text := nullif(btrim(new.payload #>> '{descansos,worker,name}'), '');
  v_previous_setting text;
begin
  if new.payload #>> '{descansos,worker,chapa}' is distinct from new.chapa
    or v_name is null or char_length(v_name) > 120
    or upper(v_name) in ('SIN NOMBRE', 'SIN NOMBRE PUBLICADO', 'PERSONAL DE BOLSA')
    or v_name ~ '[[:cntrl:]<>]' then
    return new;
  end if;

  v_previous_setting := pg_catalog.current_setting('app_cpe.allow_profile_display_name_update', true);
  perform pg_catalog.set_config('app_cpe.allow_profile_display_name_update', 'on', true);
  update public.app_cpe_users u
    set display_name = v_name, updated_at = now()
    where u.chapa = new.chapa and nullif(btrim(u.display_name), '') is null;
  perform pg_catalog.set_config('app_cpe.allow_profile_display_name_update', coalesce(v_previous_setting, ''), true);
  return new;
end;
$$;
revoke all on function private.app_cpe_fill_missing_portal_name() from public, anon, authenticated;

create trigger app_cpe_fill_missing_portal_name
  after insert or update of payload on public.app_cpe_portal_snapshots
  for each row execute function private.app_cpe_fill_missing_portal_name();

-- Repair already-synced accounts without touching any chosen profile name.
do $$
declare v_previous_setting text;
begin
  v_previous_setting := pg_catalog.current_setting('app_cpe.allow_profile_display_name_update', true);
  perform pg_catalog.set_config('app_cpe.allow_profile_display_name_update', 'on', true);
  update public.app_cpe_users u
    set display_name = btrim(s.payload #>> '{descansos,worker,name}'), updated_at = now()
    from public.app_cpe_portal_snapshots s
    where s.chapa = u.chapa
      and s.payload #>> '{descansos,worker,chapa}' = u.chapa
      and nullif(btrim(u.display_name), '') is null
      and nullif(btrim(s.payload #>> '{descansos,worker,name}'), '') is not null
      and char_length(btrim(s.payload #>> '{descansos,worker,name}')) <= 120
      and upper(btrim(s.payload #>> '{descansos,worker,name}')) not in
        ('SIN NOMBRE', 'SIN NOMBRE PUBLICADO', 'PERSONAL DE BOLSA')
      and btrim(s.payload #>> '{descansos,worker,name}') !~ '[[:cntrl:]<>]';
  perform pg_catalog.set_config('app_cpe.allow_profile_display_name_update', coalesce(v_previous_setting, ''), true);
end;
$$;
