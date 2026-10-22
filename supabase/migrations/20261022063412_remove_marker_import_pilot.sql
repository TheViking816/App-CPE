-- Remove the unused marker pilot: no imported links were saved.
drop function if exists public.app_cpe_import_personal_portal_links(text,jsonb);
drop function if exists public.app_cpe_imported_portal_link_status(text);
drop function if exists public.app_cpe_get_imported_portal_link(text,text);
drop table if exists private.app_cpe_imported_portal_links;

-- This pilot only confirms 72683 against an already verified portal token.
-- It never attempts to authenticate at the portal or tries another account.
create function public.app_cpe_link_own_portal_pilot(p_token text, p_password_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_saved private.app_cpe_manual_noray_section_links;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.chapa is distinct from '72683' then raise exception 'Acceso denegado'; end if;
  if p_password_hash is null or p_password_hash !~ '^[a-f0-9]{64}$' then raise exception 'Credencial no válida'; end if;
  select * into v_saved from private.app_cpe_manual_noray_section_links
    where chapa=v_user.chapa and section='dobles';
  if not found or v_saved.password_hash is distinct from p_password_hash then
    raise exception 'La contraseña no coincide con el acceso verificado de 72683';
  end if;
  insert into private.app_cpe_manual_noray_section_links(chapa,section,registro,password_hash)
    select v_user.chapa,section,v_saved.registro,p_password_hash from unnest(array['dobles','vacaciones']) as section
    on conflict(chapa,section) do update set registro=excluded.registro,password_hash=excluded.password_hash,updated_at=now();
  return jsonb_build_object('linked',true,'chapa',v_user.chapa,'sections',jsonb_build_array('descansos','vacaciones','dobles','jornales','donde-voy','chapero','chapero-especialidades','puertas','jornada-contratada'));
end; $$;
revoke all on function public.app_cpe_link_own_portal_pilot(text,text) from public, anon, authenticated;
grant execute on function public.app_cpe_link_own_portal_pilot(text,text) to anon, authenticated;
