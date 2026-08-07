create table if not exists public.app_cpe_portal_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  chapa text not null,
  portal_password text,
  security_key text,
  status text not null default 'queued',
  message text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);

create index if not exists app_cpe_portal_sync_jobs_chapa_idx
  on public.app_cpe_portal_sync_jobs (chapa, requested_at desc);

create index if not exists app_cpe_portal_sync_jobs_expires_idx
  on public.app_cpe_portal_sync_jobs (expires_at);

alter table public.app_cpe_portal_sync_jobs enable row level security;

revoke all on public.app_cpe_portal_sync_jobs from anon, authenticated;

create or replace function public.app_cpe_create_portal_sync_job(
  p_token text,
  p_portal_password text,
  p_security_key text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_job public.app_cpe_portal_sync_jobs;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if length(coalesce(p_portal_password, '')) < 1 then
    raise exception 'Introduce la contrasena del portal';
  end if;

  delete from public.app_cpe_portal_sync_jobs
  where expires_at < now()
     or (chapa = v_user.chapa and status in ('completed', 'failed') and requested_at < now() - interval '1 hour');

  insert into public.app_cpe_portal_sync_jobs (chapa, portal_password, security_key)
  values (v_user.chapa, p_portal_password, nullif(p_security_key, ''))
  returning * into v_job;

  return jsonb_build_object(
    'ok', true,
    'jobId', v_job.id,
    'status', v_job.status,
    'requestedAt', v_job.requested_at
  );
end;
$$;

create or replace function public.app_cpe_get_portal_sync_job(
  p_token text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_job public.app_cpe_portal_sync_jobs;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select * into v_job
  from public.app_cpe_portal_sync_jobs
  where id = p_job_id
    and chapa = v_user.chapa;

  if v_job.id is null then
    raise exception 'Sincronizacion no encontrada';
  end if;

  return jsonb_build_object(
    'ok', true,
    'jobId', v_job.id,
    'status', v_job.status,
    'message', v_job.message,
    'requestedAt', v_job.requested_at,
    'startedAt', v_job.started_at,
    'finishedAt', v_job.finished_at
  );
end;
$$;

grant execute on function public.app_cpe_create_portal_sync_job(text, text, text) to anon, authenticated;
grant execute on function public.app_cpe_get_portal_sync_job(text, uuid) to anon, authenticated;
