create or replace function public.app_cpe_observed_bolsa_worker_names()
returns table (
  worker_code text,
  display_name text,
  observed_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  with observations as (
    select
      btrim(worker.value ->> 'code') as worker_code,
      btrim(worker.value ->> 'name') as display_name,
      snapshot.updated_at as observed_at
    from public.app_cpe_portal_snapshots snapshot
    cross join lateral jsonb_array_elements(
      coalesce(snapshot.payload #> '{asignaciones,rows}', '[]'::jsonb)
    ) assignment(value)
    cross join lateral jsonb_array_elements(
      coalesce(assignment.value #> '{detail,specialties}', '[]'::jsonb)
    ) specialty(value)
    cross join lateral jsonb_array_elements(
      coalesce(specialty.value -> 'workers', '[]'::jsonb)
    ) worker(value)
    where nullif(btrim(worker.value ->> 'code'), '') is not null
      and nullif(btrim(worker.value ->> 'name'), '') is not null
  )
  select distinct on (upper(worker_code))
    worker_code,
    display_name,
    observed_at
  from observations
  where upper(display_name) not in ('CERO', 'PERSONAL DE BOLSA', 'SIN NOMBRE', 'SIN NOMBRE PUBLICADO')
  order by upper(worker_code), observed_at desc;
$$;

revoke all on function public.app_cpe_observed_bolsa_worker_names() from public, anon, authenticated;
grant execute on function public.app_cpe_observed_bolsa_worker_names() to service_role;

comment on function public.app_cpe_observed_bolsa_worker_names() is
  'Returns the latest complete chapa/name pairs observed inside Donde voy part details; service-role only.';
