create or replace function private.app_cpe_premium_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select btrim(regexp_replace(
      translate(lower(coalesce(p_role, '')), 'áéíóúüñªº', 'aeiouunao'),
      '[^a-z0-9]+', ' ', 'g'
    )) as role
  )
  select case
    when role ~ '(trastainer|transtainer|containera?|mafi|reach|grua|carretill|coches?)' then 'excluded'
    when role ~ '(^| )trincador( |$)' then 'trincador'
    when role ~ '(^| )conductor( de)? 1 ?a( |$)' then 'conductor_1a'
    when role ~ '(^| )conductor( de)? 2 ?a( |$)' then 'conductor_2a'
    when role ~ '(^| )especialista( |$)' then 'especialista'
    when role ~ '(^| )capataz( |$)' then 'capataz'
    when role ~ '(^| )sobord(ista|istista)( |$)' then 'sobordista'
    when role ~ '(^| )clasificador(a|es|as)?( |$)' then 'clasificador'
    when role ~ '(^| )furgonetero(a|s|as)?( |$)' then 'furgonetero'
    else 'excluded'
  end
  from normalized;
$$;

create or replace function private.app_cpe_premium_roles_compatible(
  p_source_role text,
  p_target_role text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with roles as (
    select
      private.app_cpe_premium_role(p_source_role) as source_role,
      private.app_cpe_premium_role(p_target_role) as target_role
  )
  select case
    when source_role = 'excluded' or target_role = 'excluded' then false
    when source_role = 'trincador' or target_role = 'trincador' then false
    when source_role in ('conductor_1a', 'especialista', 'sobordista', 'clasificador', 'capataz')
      and target_role in ('conductor_1a', 'especialista', 'sobordista', 'clasificador', 'capataz')
      then true
    when source_role = 'conductor_2a'
      and target_role in ('conductor_2a', 'furgonetero', 'clasificador', 'capataz')
      then true
    when target_role = 'conductor_2a'
      and source_role in ('conductor_2a', 'furgonetero', 'clasificador', 'capataz')
      then true
    else false
  end
  from roles;
$$;

revoke all on function private.app_cpe_premium_role(text) from public;
revoke all on function private.app_cpe_premium_roles_compatible(text, text) from public;

comment on function private.app_cpe_premium_roles_compatible(text, text) is
  'Checks the business role matrix before sharing an official premium for the same part, date and shift.';

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
      regexp_replace(coalesce(request.value ->> 'jornada', ''), '[^0-9]', '', 'g') as jornada,
      btrim(coalesce(request.value ->> 'puesto', '')) as puesto
    from jsonb_array_elements(p_requests) with ordinality as request(value, ordinality)
    where coalesce(request.value ->> 'parte', '') ~ '^[0-9]{1,12}$'
      and coalesce(request.value ->> 'fecha', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and nullif(regexp_replace(coalesce(request.value ->> 'jornada', ''), '[^0-9]', '', 'g'), '') is not null
      and private.app_cpe_premium_role(request.value ->> 'puesto') <> 'excluded'
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
    join public.app_cpe_portal_snapshots snapshot on true
    cross join lateral (
      select source_positions.puesto
      from (
        select specialty.value ->> 'name' as puesto, 1 as source_priority
        from jsonb_array_elements(coalesce(snapshot.payload #> '{asignaciones,rows}', '[]'::jsonb)) assignment(value)
        cross join lateral jsonb_array_elements(coalesce(assignment.value #> '{detail,specialties}', '[]'::jsonb)) specialty(value)
        cross join lateral jsonb_array_elements(coalesce(specialty.value -> 'workers', '[]'::jsonb)) worker(value)
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
          and regexp_replace(coalesce(worker.value ->> 'code', ''), '[^0-9]', '', 'g')
            = regexp_replace(coalesce(snapshot.chapa, ''), '[^0-9]', '', 'g')

        union all

        select coalesce(jornal.value ->> 'especialidad', jornal.value ->> 'puesto') as puesto,
          2 as source_priority
        from jsonb_array_elements(coalesce(snapshot.payload #> '{jornales,history}', '[]'::jsonb)) jornal_period(value)
        cross join lateral jsonb_array_elements(coalesce(jornal_period.value -> 'rows', '[]'::jsonb)) jornal(value)
        where jornal.value ->> 'parte' = requested.parte
          and regexp_replace(coalesce(jornal.value ->> 'jornada', ''), '[^0-9]', '', 'g') = requested.jornada
          and case when coalesce(jornal_period.value ->> 'year', '') ~ '^[0-9]+$'
            then (jornal_period.value ->> 'year')::integer else 0 end = extract(year from requested.fecha)::integer
          and case when coalesce(jornal_period.value ->> 'month', '') ~ '^[0-9]+$'
            then (jornal_period.value ->> 'month')::integer else 0 end = extract(month from requested.fecha)::integer
          and case when coalesce(jornal.value ->> 'dia', '') ~ '^[0-9]+$'
            then (jornal.value ->> 'dia')::integer else 0 end = extract(day from requested.fecha)::integer
      ) source_positions
      where private.app_cpe_premium_role(source_positions.puesto) <> 'excluded'
      order by source_positions.source_priority
      limit 1
    ) source_role
    cross join lateral jsonb_array_elements(coalesce(snapshot.payload #> '{primas,history}', '[]'::jsonb)) premium_period(value)
    cross join lateral jsonb_array_elements(coalesce(premium_period.value -> 'rows', '[]'::jsonb)) premium(value)
    where private.app_cpe_premium_roles_compatible(source_role.puesto, requested.puesto)
      and nullif(btrim(premium.value ->> 'produccion'), '') is not null
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
      request_id, parte, fecha, jornada, produccion, verification
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
  'Returns official premiums when the source role and PortalEstibaVLC target role are compatible for the same part, date and shift, using assignment or historical jornal role data.';
