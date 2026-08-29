create or replace function public.app_cpe_get_shared_part_premiums(
  p_requests jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if jsonb_typeof(p_requests) <> 'array'
    or jsonb_array_length(p_requests) = 0
    or jsonb_array_length(p_requests) > 250 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  with requested as (
    select
      request.ordinality::text as request_id,
      btrim(request.value ->> 'parte') as parte,
      (request.value ->> 'fecha')::date as fecha,
      regexp_replace(coalesce(request.value ->> 'jornada', ''), '[^0-9]', '', 'g') as jornada
    from jsonb_array_elements(p_requests) with ordinality as request(value, ordinality)
    where coalesce(request.value ->> 'parte', '') ~ '^[0-9]{1,12}$'
      and coalesce(request.value ->> 'fecha', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and nullif(regexp_replace(coalesce(request.value ->> 'jornada', ''), '[^0-9]', '', 'g'), '') is not null
  ), candidates as (
    select
      requested.request_id,
      requested.parte,
      requested.fecha,
      requested.jornada,
      premium.value ->> 'produccion' as produccion,
      case
        when premium.value ->> 'produccionEstado' in ('pending', 'verified', 'paid')
          then premium.value ->> 'produccionEstado'
        else 'unknown'
      end as verification,
      snapshot.updated_at,
      case premium.value ->> 'produccionEstado'
        when 'paid' then 3
        when 'verified' then 2
        when 'pending' then 1
        else 0
      end as verification_rank
    from requested
    join public.app_cpe_portal_snapshots snapshot on exists (
      select 1
      from jsonb_array_elements(coalesce(snapshot.payload #> '{asignaciones,rows}', '[]'::jsonb)) assignment(value)
      where assignment.value ->> 'parte' = requested.parte
        and assignment.value #>> '{detail,recognized}' = 'true'
        and regexp_replace(coalesce(assignment.value ->> 'jornada', ''), '[^0-9]', '', 'g') = requested.jornada
        and case
          when coalesce(assignment.value #>> '{detail,fecha}', '') ~ '^[0-9]{8}$'
            then to_date(assignment.value #>> '{detail,fecha}', 'YYYYMMDD')
          when coalesce(assignment.value ->> 'fecha', '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
            then to_date(assignment.value ->> 'fecha', 'DD/MM/YYYY')
          else null
        end = requested.fecha
    )
    cross join lateral jsonb_array_elements(
      coalesce(snapshot.payload #> '{primas,history}', '[]'::jsonb)
    ) premium_period(value)
    cross join lateral jsonb_array_elements(
      coalesce(premium_period.value -> 'rows', '[]'::jsonb)
    ) premium(value)
    where nullif(btrim(premium.value ->> 'produccion'), '') is not null
      and premium.value ->> 'parte' = requested.parte
      and case when coalesce(premium_period.value ->> 'year', '') ~ '^[0-9]+$'
        then (premium_period.value ->> 'year')::integer else 0 end = extract(year from requested.fecha)::integer
      and case when coalesce(premium_period.value ->> 'month', '') ~ '^[0-9]+$'
        then (premium_period.value ->> 'month')::integer else 0 end = extract(month from requested.fecha)::integer
      and case when coalesce(premium.value ->> 'dia', '') ~ '^[0-9]+$'
        then (premium.value ->> 'dia')::integer else 0 end = extract(day from requested.fecha)::integer
      and regexp_replace(coalesce(premium.value ->> 'jornada', ''), '[^0-9]', '', 'g') = requested.jornada
  ), selected as (
    select distinct on (request_id)
      request_id,
      parte,
      fecha,
      jornada,
      produccion,
      verification
    from candidates
    order by request_id, verification_rank desc, updated_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id', request_id,
    'parte', parte,
    'fecha', to_char(fecha, 'YYYY-MM-DD'),
    'jornada', jornada,
    'produccion', produccion,
    'verification', verification
  ) order by request_id::integer), '[]'::jsonb)
  into v_result
  from selected;

  return jsonb_build_object('ok', true, 'premiums', v_result);
end;
$$;

revoke all on function public.app_cpe_get_shared_part_premiums(jsonb) from public;
revoke all on function public.app_cpe_get_shared_part_premiums(jsonb) from anon, authenticated;
grant execute on function public.app_cpe_get_shared_part_premiums(jsonb) to service_role;

comment on function public.app_cpe_get_shared_part_premiums(jsonb) is
  'Returns only official part premiums for authorized cross-app batch lookups; no source worker or payroll history is exposed.';
