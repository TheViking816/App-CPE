create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

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

revoke all on function private.app_cpe_premium_role(text) from public, anon, authenticated;
revoke all on function private.app_cpe_premium_roles_compatible(text, text) from public, anon, authenticated;

create table if not exists public.app_cpe_noray_jornal_observations (
  source_chapa text not null check (source_chapa ~ '^[0-9]{5}$'),
  source_registro integer not null check (source_registro > 0),
  year integer not null check (year between 2024 and 2100),
  month integer not null check (month between 1 and 12),
  fecha date not null,
  parte text not null check (parte ~ '^[0-9]{1,12}$'),
  jornada text not null,
  jornada_key text not null check (jornada_key ~ '^[0-9]{4}$'),
  source_role text not null default '',
  premium_amount numeric(10,2) check (premium_amount > 0 and premium_amount < 100000),
  premium_status text check (premium_status in ('pending', 'verified')),
  part_detail jsonb not null default '{}'::jsonb check (jsonb_typeof(part_detail) = 'object'),
  observed_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (source_chapa, fecha, parte, jornada_key),
  check ((premium_amount is null) = (premium_status is null))
);

create index if not exists app_cpe_noray_jornal_lookup_idx
  on public.app_cpe_noray_jornal_observations (fecha, parte, jornada_key);

create index if not exists app_cpe_noray_jornal_source_idx
  on public.app_cpe_noray_jornal_observations (source_chapa, year, month);

alter table public.app_cpe_noray_jornal_observations enable row level security;
revoke all on table public.app_cpe_noray_jornal_observations from public, anon, authenticated;
grant select, insert, update, delete on table public.app_cpe_noray_jornal_observations to service_role;

comment on table public.app_cpe_noray_jornal_observations is
  'Observaciones privadas de Jornales Noray usadas para ampliar partes y primas oficiales con coincidencia exacta.';

create or replace function public.app_cpe_get_shared_part_detail(
  p_parte text,
  p_fecha date,
  p_jornada text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail jsonb;
  v_shift text := regexp_replace(coalesce(p_jornada, ''), '[^0-9]', '', 'g');
begin
  if nullif(btrim(p_parte), '') is null or p_fecha is null or nullif(v_shift, '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select candidate.detail
  into v_detail
  from (
    select
      assignment.row -> 'detail' as detail,
      snapshot.updated_at,
      coalesce((
        select sum(jsonb_array_length(coalesce(specialty.value -> 'workers', '[]'::jsonb)))
        from jsonb_array_elements(coalesce(assignment.row #> '{detail,specialties}', '[]'::jsonb)) specialty(value)
      ), 0) as named_workers
    from public.app_cpe_portal_snapshots snapshot
    cross join lateral jsonb_array_elements(
      coalesce(snapshot.payload #> '{asignaciones,rows}', '[]'::jsonb)
    ) assignment(row)
    where assignment.row ->> 'parte' = btrim(p_parte)
      and assignment.row #>> '{detail,recognized}' = 'true'
      and regexp_replace(coalesce(assignment.row ->> 'jornada', ''), '[^0-9]', '', 'g') = v_shift
      and case
        when coalesce(assignment.row #>> '{detail,fecha}', '') ~ '^[0-9]{8}$'
          then to_date(assignment.row #>> '{detail,fecha}', 'YYYYMMDD')
        when coalesce(assignment.row ->> 'fecha', '') ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'
          then to_date(assignment.row ->> 'fecha', 'DD/MM/YYYY')
        else null
      end = p_fecha

    union all

    select
      observation.part_detail as detail,
      observation.updated_at,
      coalesce((
        select sum(jsonb_array_length(coalesce(specialty.value -> 'workers', '[]'::jsonb)))
        from jsonb_array_elements(coalesce(observation.part_detail -> 'specialties', '[]'::jsonb)) specialty(value)
      ), 0) as named_workers
    from public.app_cpe_noray_jornal_observations observation
    where observation.parte = btrim(p_parte)
      and observation.fecha = p_fecha
      and observation.jornada_key = v_shift
      and observation.part_detail ->> 'recognized' = 'true'
  ) candidate
  order by candidate.named_workers desc, candidate.updated_at desc
  limit 1;

  if v_detail is null then
    return jsonb_build_object('ok', true, 'detail', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'detail', jsonb_build_object(
      'parte', v_detail ->> 'parte',
      'fecha', v_detail ->> 'fecha',
      'jornada', v_detail ->> 'jornada',
      'empresa', v_detail ->> 'empresa',
      'buque', v_detail ->> 'buque',
      'muelle', v_detail ->> 'muelle',
      'operacion', v_detail ->> 'operacion',
      'mercancia', v_detail ->> 'mercancia',
      'observaciones', v_detail ->> 'observaciones',
      'specialties', coalesce(v_detail -> 'specialties', '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.app_cpe_get_shared_part_detail(text, date, text) from public, anon, authenticated;
grant execute on function public.app_cpe_get_shared_part_detail(text, date, text) to service_role;

create or replace function public.app_cpe_get_shared_part_premiums(p_requests jsonb)
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
  ), snapshot_candidates as (
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
      snapshot.chapa as source_chapa,
      'portal_primas'::text as origin,
      snapshot.updated_at,
      case premium.value ->> 'produccionEstado'
        when 'paid' then 3 when 'verified' then 2 when 'pending' then 1 else 0
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

        select coalesce(jornal.value ->> 'especialidad', jornal.value ->> 'puesto'), 2
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
  ), noray_candidates as (
    select
      requested.request_id,
      requested.parte,
      requested.fecha,
      requested.jornada,
      observation.premium_amount::text as produccion,
      observation.premium_status as verification,
      observation.source_chapa,
      'noray_jornales'::text as origin,
      observation.updated_at,
      case observation.premium_status when 'verified' then 2 when 'pending' then 1 else 0 end as verification_rank
    from requested
    join public.app_cpe_noray_jornal_observations observation
      on observation.parte = requested.parte
      and observation.fecha = requested.fecha
      and observation.jornada_key = requested.jornada
      and observation.premium_amount is not null
    where private.app_cpe_premium_roles_compatible(observation.source_role, requested.puesto)
  ), candidates as (
    select * from snapshot_candidates
    union all
    select * from noray_candidates
  ), selected as (
    select distinct on (request_id)
      request_id, parte, fecha, jornada, produccion, verification, source_chapa, origin
    from candidates
    order by request_id, verification_rank desc, updated_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id', request_id,
    'parte', parte,
    'fecha', to_char(fecha, 'YYYY-MM-DD'),
    'jornada', jornada,
    'produccion', produccion,
    'verification', verification,
    'source_chapa', source_chapa,
    'origin', origin
  ) order by request_id::integer), '[]'::jsonb)
  into v_result
  from selected;

  return jsonb_build_object('ok', true, 'premiums', v_result);
end;
$$;

revoke all on function public.app_cpe_get_shared_part_premiums(jsonb) from public, anon, authenticated;
grant execute on function public.app_cpe_get_shared_part_premiums(jsonb) to service_role;

comment on function public.app_cpe_get_shared_part_premiums(jsonb) is
  'Returns role-compatible official premiums from portal snapshots and the new Noray Jornales history.';
