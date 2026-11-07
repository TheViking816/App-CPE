-- Match the personal-link registry used by the redirect API and Monitor.
-- Only the section name is stored; URLs and credentials never enter this table.
alter table private.app_cpe_personal_link_opens
  drop constraint app_cpe_personal_link_opens_section_check;
alter table private.app_cpe_personal_link_opens
  add constraint app_cpe_personal_link_opens_section_check check (section in (
    'donde-voy','vacaciones','dobles','jornales','descansos','descansos-permuta',
    'excepciones-pedidas','calendario-base','mis-especialidades','solicito-formacion',
    'disponibilidad12m','chapero','chapero-especialidades','puertas',
    'jornada-contratada','situacion-trabajador'
  ));

create or replace function public.app_cpe_track_personal_link_open(p_token text, p_section text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_section is null or p_section not in (
    'donde-voy','vacaciones','dobles','jornales','descansos','descansos-permuta',
    'excepciones-pedidas','calendario-base','mis-especialidades','solicito-formacion',
    'disponibilidad12m','chapero','chapero-especialidades','puertas',
    'jornada-contratada','situacion-trabajador'
  ) then raise exception 'Sección no válida'; end if;
  if v_user.chapa = '72683' or exists (
    select 1 from public.app_cpe_sessions s
    where s.token_hash = pg_catalog.encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
      and s.expires_at > now() and s.is_support
  ) then return false; end if;
  insert into private.app_cpe_personal_link_opens(user_id, section) values(v_user.id, p_section);
  return true;
end;
$$;

revoke all on function public.app_cpe_track_personal_link_open(text,text) from public, anon, authenticated;
grant execute on function public.app_cpe_track_personal_link_open(text,text) to anon, authenticated;
