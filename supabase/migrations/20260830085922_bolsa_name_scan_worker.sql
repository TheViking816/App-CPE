create table if not exists public.app_cpe_bolsa_name_scan_jobs (
  id uuid primary key default gen_random_uuid(),
  chapa text not null check (chapa ~ '^(24|63|71|72)[0-9]{3}$'),
  portal_password text,
  security_key text,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  message text,
  parts_scanned integer not null default 0 check (parts_scanned >= 0),
  names_found integer not null default 0 check (names_found >= 0),
  names_new integer not null default 0 check (names_new >= 0),
  names_updated integer not null default 0 check (names_updated >= 0),
  new_workers jsonb not null default '[]'::jsonb check (jsonb_typeof(new_workers) = 'array'),
  updated_workers jsonb not null default '[]'::jsonb check (jsonb_typeof(updated_workers) = 'array'),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null default (now() + interval '12 hours'),
  created_at timestamptz not null default now()
);

create unique index if not exists app_cpe_bolsa_name_scan_jobs_active_chapa_idx
  on public.app_cpe_bolsa_name_scan_jobs (chapa)
  where status in ('queued', 'running');

create index if not exists app_cpe_bolsa_name_scan_jobs_queue_idx
  on public.app_cpe_bolsa_name_scan_jobs (requested_at, id)
  where status = 'queued';

alter table public.app_cpe_bolsa_name_scan_jobs enable row level security;
revoke all on table public.app_cpe_bolsa_name_scan_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.app_cpe_bolsa_name_scan_jobs to service_role;

comment on table public.app_cpe_bolsa_name_scan_jobs is
  'Cola aislada para descubrir nombres de personal de bolsa desde Jornadas contratadas; no interviene en la sincronizacion principal.';

create or replace function public.app_cpe_create_bolsa_name_scan_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public, private, vault, extensions, pg_catalog, pg_temp
as $$
declare
  v_config public.app_cpe_portal_auto_sync;
  v_password text;
  v_security_key text;
  v_queued integer := 0;
  v_skipped integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_cpe_bolsa_name_scan_jobs', 0));

  update public.app_cpe_bolsa_name_scan_jobs
  set status = 'failed',
      message = 'Trabajo caducado antes de terminar',
      portal_password = null,
      security_key = null,
      finished_at = now()
  where status in ('queued', 'running') and expires_at <= now();

  for v_config in
    select config.*
    from public.app_cpe_portal_auto_sync config
    where config.enabled
      and config.sync_status = 'active'
      and config.portal_password_secret_id is not null
    order by config.chapa
  loop
    if exists (
      select 1
      from public.app_cpe_bolsa_name_scan_jobs job
      where job.chapa = v_config.chapa
        and job.status in ('queued', 'running')
        and job.expires_at > now()
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select decrypted_secret into v_password
    from vault.decrypted_secrets
    where id = v_config.portal_password_secret_id;

    select decrypted_secret into v_security_key
    from vault.decrypted_secrets
    where id = v_config.security_key_secret_id;

    if length(coalesce(v_password, '')) < 1 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.app_cpe_bolsa_name_scan_jobs (
      chapa, portal_password, security_key, status, message, expires_at
    ) values (
      v_config.chapa, v_password, v_security_key, 'queued',
      'Pendiente de leer Jornadas contratadas', now() + interval '12 hours'
    );
    v_queued := v_queued + 1;
  end loop;

  return jsonb_build_object('ok', true, 'queued', v_queued, 'skipped', v_skipped);
end;
$$;

revoke all on function public.app_cpe_create_bolsa_name_scan_jobs() from public, anon, authenticated;
grant execute on function public.app_cpe_create_bolsa_name_scan_jobs() to service_role;

create or replace function public.app_cpe_claim_bolsa_name_scan_jobs(p_limit integer default 1)
returns setof public.app_cpe_bolsa_name_scan_jobs
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
begin
  return query
  with candidates as (
    select job.id
    from public.app_cpe_bolsa_name_scan_jobs job
    where job.status = 'queued' and job.expires_at > now()
    order by job.requested_at, job.id
    limit greatest(1, least(coalesce(p_limit, 1), 6))
    for update skip locked
  )
  update public.app_cpe_bolsa_name_scan_jobs job
  set status = 'running',
      message = 'Leyendo Jornadas contratadas',
      started_at = now()
  from candidates
  where job.id = candidates.id
  returning job.*;
end;
$$;

revoke all on function public.app_cpe_claim_bolsa_name_scan_jobs(integer) from public, anon, authenticated;
grant execute on function public.app_cpe_claim_bolsa_name_scan_jobs(integer) to service_role;

create or replace function public.app_cpe_finish_bolsa_name_scan_job(
  p_id uuid,
  p_ok boolean,
  p_message text,
  p_parts_scanned integer default 0,
  p_names_found integer default 0,
  p_new_workers jsonb default '[]'::jsonb,
  p_updated_workers jsonb default '[]'::jsonb
)
returns public.app_cpe_bolsa_name_scan_jobs
language plpgsql
security definer
set search_path = public, pg_catalog, pg_temp
as $$
declare
  v_job public.app_cpe_bolsa_name_scan_jobs;
begin
  update public.app_cpe_bolsa_name_scan_jobs
  set status = case when p_ok then 'completed' else 'failed' end,
      message = left(coalesce(p_message, ''), 1000),
      parts_scanned = greatest(0, coalesce(p_parts_scanned, 0)),
      names_found = greatest(0, coalesce(p_names_found, 0)),
      names_new = jsonb_array_length(coalesce(p_new_workers, '[]'::jsonb)),
      names_updated = jsonb_array_length(coalesce(p_updated_workers, '[]'::jsonb)),
      new_workers = coalesce(p_new_workers, '[]'::jsonb),
      updated_workers = coalesce(p_updated_workers, '[]'::jsonb),
      portal_password = null,
      security_key = null,
      finished_at = now()
  where id = p_id and status = 'running'
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.app_cpe_finish_bolsa_name_scan_job(uuid, boolean, text, integer, integer, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.app_cpe_finish_bolsa_name_scan_job(uuid, boolean, text, integer, integer, jsonb, jsonb)
  to service_role;
