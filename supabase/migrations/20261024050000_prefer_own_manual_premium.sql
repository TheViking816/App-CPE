-- A worker's own entered amount wins when another worker saved a different value.
create or replace function private.app_cpe_premium_identity(p_value text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(btrim(regexp_replace(
    translate(upper(coalesce(p_value, '')), 'ÁÀÄÉÈËÍÌÏÓÒÖÚÙÜÑ', 'AAAEEEIIIOOOUUUN'),
    '[^A-Z0-9]+', ' ', 'g'
  )), '^CONDUCTOR DE ([12]) ?A$', 'CONDUCTOR \1A');
$$;

create or replace function public.app_cpe_get_shared_manual_premiums(p_requests jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if jsonb_typeof(p_requests) <> 'array' or jsonb_array_length(p_requests) < 1
    or jsonb_array_length(p_requests) > 250 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  with requested as (
    select ordinality::int as request_id,
      value->>'fecha' as fecha, regexp_replace(coalesce(value->>'jornada',''), '[^0-9]', '', 'g') as jornada,
      nullif(btrim(value->>'parte'), '') as parte,
      btrim(value->>'chapa') as target_chapa,
      private.app_cpe_premium_identity(value->>'puesto') as puesto,
      private.app_cpe_premium_identity(value->>'buque') as buque,
      private.app_cpe_premium_identity(value->>'empresa') as empresa
    from jsonb_array_elements(p_requests) with ordinality as input(value, ordinality)
    where coalesce(value->>'fecha','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
  ), manual_sources as (
    select j.work_date::text as fecha, regexp_replace(j.shift,'[^0-9]','','g') as jornada,
      nullif(btrim(meta.details->>'part'),'') as parte,
      private.app_cpe_premium_identity(j.specialty) as puesto,
      private.app_cpe_premium_identity(meta.details->>'vessel') as buque,
      private.app_cpe_premium_identity(meta.details->>'company') as empresa,
      j.premium as amount, j.updated_at, u.chapa as source_chapa
    from private.app_cpe_manual_jornales j
    join public.app_cpe_users u on u.id=j.user_id
    cross join lateral (
      select case when j.notes like 'APP_CPE_MANUAL_V1:%'
        then substring(j.notes from length('APP_CPE_MANUAL_V1:') + 1)::jsonb
        else '{}'::jsonb end as details
    ) meta
    where j.premium > 0 and coalesce(meta.details->>'premiumKnown','true') <> 'false'
  ), historic_sources as (
    select split_part(p.jornal_key,'|',1) as fecha,
      regexp_replace(split_part(p.jornal_key,'|',4),'[^0-9]','','g') as jornada,
      nullif(split_part(p.jornal_key,'|',2),'SIN-PARTE') as parte,
      private.app_cpe_premium_identity(coalesce(jornal.value->>'especialidad', split_part(p.jornal_key,'|',5))) as puesto,
      private.app_cpe_premium_identity(jornal.value->>'buque') as buque,
      private.app_cpe_premium_identity(jornal.value->>'empresa') as empresa,
      p.amount, p.updated_at, u.chapa as source_chapa
    from private.app_cpe_manual_premiums p
    join public.app_cpe_users u on u.id=p.user_id
    left join public.app_cpe_portal_snapshots s on s.chapa=u.chapa
    left join lateral (
      select row.value
      from jsonb_array_elements(coalesce(s.payload #> '{jornales,history}','[]'::jsonb)) period(value)
      cross join lateral jsonb_array_elements(coalesce(period.value->'rows','[]'::jsonb)) row(value)
      where (period.value->>'year') = left(p.jornal_key,4)
        and lpad(coalesce(period.value->>'month',''),2,'0') = substr(p.jornal_key,6,2)
        and lpad(coalesce(row.value->>'dia',''),2,'0') = substr(p.jornal_key,9,2)
        and regexp_replace(coalesce(row.value->>'jornada',''),'[^0-9]','','g')
          = regexp_replace(split_part(p.jornal_key,'|',4),'[^0-9]','','g')
        and private.app_cpe_premium_identity(row.value->>'especialidad')
          = private.app_cpe_premium_identity(split_part(p.jornal_key,'|',5))
        and (split_part(p.jornal_key,'|',2) = 'SIN-PARTE'
          or private.app_cpe_premium_identity(row.value->>'parte')
            = private.app_cpe_premium_identity(split_part(p.jornal_key,'|',2)))
      limit 1
    ) jornal on true
    where p.amount > 0 and jornal.value is not null
      and p.jornal_key ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}[|]'
  ), sources as (
    select * from manual_sources union all select * from historic_sources
  ), matches as (
    select r.request_id, r.parte, r.fecha, r.jornada, s.amount, s.updated_at,
      case when r.target_chapa <> '' and s.source_chapa=r.target_chapa then 4
        when r.parte is not null and s.parte is not null and r.parte=s.parte then 2 else 1 end as priority
    from requested r join sources s on s.fecha=r.fecha and s.jornada=r.jornada and s.puesto=r.puesto
    where r.puesto <> '' and r.jornada ~ '^[0-9]{4}$'
      and (
        (r.parte is not null and s.parte is not null and r.parte=s.parte)
        or ((r.parte is null or s.parte is null) and r.buque <> '' and s.buque=r.buque
          )
      )
  ), best_priority as (
    select *, max(priority) over(partition by request_id) as best from matches
  ), unambiguous as (
    select request_id, max(parte) as parte, max(fecha) as fecha, max(jornada) as jornada,
      max(amount) as amount
    from best_priority where priority=best
    group by request_id having min(amount)=max(amount)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id', request_id, 'parte', parte, 'fecha', fecha, 'jornada', jornada,
    'produccion', amount, 'verification', 'pending', 'origin', 'app_cpe_manual'
  ) order by request_id),'[]'::jsonb) into v_result from unambiguous;
  return jsonb_build_object('ok', true, 'premiums', v_result);
end $$;

revoke all on function public.app_cpe_get_shared_manual_premiums(jsonb) from public, anon, authenticated;
grant execute on function public.app_cpe_get_shared_manual_premiums(jsonb) to service_role;

create or replace function public.app_cpe_get_my_shared_manual_premiums(p_token text, p_requests jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_allowed jsonb; v_result jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if jsonb_typeof(p_requests) <> 'array' or jsonb_array_length(p_requests) < 1
    or jsonb_array_length(p_requests) > 250 then return '[]'::jsonb; end if;
  -- Each request must describe a jornal already stored for this worker.
  with requested as (
    select ordinality::int as request_id, value as item
    from jsonb_array_elements(p_requests) with ordinality as input(value, ordinality)
  ), owned as (
    select r.* from requested r
    where exists (
      select 1 from private.app_cpe_manual_jornales j
      where j.user_id=v_user.id and j.work_date::text=r.item->>'fecha'
        and regexp_replace(j.shift,'[^0-9]','','g')=regexp_replace(coalesce(r.item->>'jornada',''),'[^0-9]','','g')
        and private.app_cpe_premium_identity(j.specialty)=private.app_cpe_premium_identity(r.item->>'puesto')
        and (
          (nullif(r.item->>'parte','') is not null and j.notes like '%"part":"' || (r.item->>'parte') || '"%')
          or (coalesce(r.item->>'parte','')='' and coalesce(r.item->>'buque','')<>''
            and private.app_cpe_premium_identity(substring(j.notes from '"vessel":"([^"]*)"'))
            = private.app_cpe_premium_identity(r.item->>'buque')
          )
        )
    ) or exists (
      select 1 from public.app_cpe_portal_snapshots s
      cross join lateral jsonb_array_elements(coalesce(s.payload #> '{jornales,history}','[]'::jsonb)) period(value)
      cross join lateral jsonb_array_elements(coalesce(period.value->'rows','[]'::jsonb)) row(value)
      where s.chapa=v_user.chapa
        and period.value->>'year'=left(r.item->>'fecha',4)
        and lpad(coalesce(period.value->>'month',''),2,'0')=substr(r.item->>'fecha',6,2)
        and lpad(coalesce(row.value->>'dia',''),2,'0')=substr(r.item->>'fecha',9,2)
        and regexp_replace(coalesce(row.value->>'jornada',''),'[^0-9]','','g')
          = regexp_replace(coalesce(r.item->>'jornada',''),'[^0-9]','','g')
        and private.app_cpe_premium_identity(row.value->>'especialidad')
          = private.app_cpe_premium_identity(r.item->>'puesto')
        and (
          (nullif(r.item->>'parte','') is not null and row.value->>'parte'=r.item->>'parte')
          or (coalesce(r.item->>'parte','')='' and coalesce(r.item->>'buque','')<>''
            and private.app_cpe_premium_identity(row.value->>'buque')
            = private.app_cpe_premium_identity(r.item->>'buque'))
        )
    )
  )
  select coalesce(jsonb_agg(item || jsonb_build_object('chapa',v_user.chapa) order by request_id),'[]'::jsonb)
    into v_allowed from owned;
  if jsonb_array_length(v_allowed)=0 then return '[]'::jsonb; end if;
  -- Reattach only permitted request keys without revealing source identity.
  with allowed as (
    select ordinality::int as local_id, value as item
    from jsonb_array_elements(v_allowed) with ordinality as input(value, ordinality)
  ), resolved as (
    select (p.value->>'request_id')::int as local_id, p.value
    from jsonb_array_elements(public.app_cpe_get_shared_manual_premiums(v_allowed)->'premiums') p(value)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', a.item->>'key', 'amount', r.value->'produccion'
  )),'[]'::jsonb) into v_result
  from resolved r join allowed a using(local_id);
  return v_result;
end $$;

revoke all on function public.app_cpe_get_my_shared_manual_premiums(text,jsonb) from public, anon, authenticated;
grant execute on function public.app_cpe_get_my_shared_manual_premiums(text,jsonb) to anon, authenticated;
