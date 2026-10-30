-- The mobile reader stores complete teams in its shared cache. Give each app user
-- access only to a part that appears in that user's saved journals or preview.
create or replace function public.app_cpe_get_my_part_detail(
  p_token text, p_parte text, p_fecha date, p_jornada text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users;
  v_detail jsonb;
  v_allowed boolean;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_parte !~ '^[0-9]{1,10}$' or p_fecha is null
     or p_jornada !~ '^[0-9]{2}-[0-9]{2}$' then
    raise exception 'Parte no válido';
  end if;

  select exists (
    select 1 from private.app_cpe_personal_noray_snapshots s
    where s.chapa = v_user.chapa
      and jsonb_path_exists(s.payload, '$.** ? (@.parte == $part)',
        jsonb_build_object('part', p_parte))
  ) or exists (
    select 1 from public.app_cpe_portal_preview_snapshots s
    where s.chapa = v_user.chapa and s.channel = 'upcoming-contracts-72683'
      and jsonb_path_exists(s.payload, '$.** ? (@.parte == $part)',
        jsonb_build_object('part', p_parte))
  ) or exists (
    select 1 from private.app_cpe_manual_jornales j
    where j.user_id = v_user.id and j.work_date = p_fecha
      and j.shift = p_jornada and j.notes = p_parte
  ) into v_allowed;
  if not v_allowed then
    return jsonb_build_object('ok', true, 'detail', null);
  end if;

  select c.detail into v_detail
  from cpe_mobile_private.upcoming_part_cache c
  where c.year = extract(year from p_fecha)::int and c.part = p_parte
    and c.detail ->> 'recognized' = 'true'
    and (c.detail ->> 'fecha')::date = p_fecha
    and regexp_replace(coalesce(c.detail ->> 'jornada', ''), '[^0-9]', '', 'g')
      = regexp_replace(p_jornada, '[^0-9]', '', 'g')
    and jsonb_typeof(c.detail -> 'specialties') = 'array'
    and jsonb_array_length(c.detail -> 'specialties') > 0;

  if v_detail is null then
    return public.app_cpe_get_shared_part_detail(p_parte, p_fecha, p_jornada);
  end if;
  return jsonb_build_object('ok', true, 'detail', v_detail);
end;
$$;

revoke all on function public.app_cpe_get_my_part_detail(text,text,date,text)
  from public, anon, authenticated;
grant execute on function public.app_cpe_get_my_part_detail(text,text,date,text)
  to anon, authenticated;
