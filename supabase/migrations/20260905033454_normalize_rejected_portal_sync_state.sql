-- Repair any row whose latest stored job already proves that the current
-- password was rejected, including jobs completed during an older migration.
update public.app_cpe_portal_auto_sync config
set sync_status = 'credentials_error',
    paused_at = coalesce(config.paused_at, now()),
    pause_reason = 'credentials_error',
    updated_at = now()
from public.app_cpe_portal_sync_jobs jobs
where jobs.chapa = config.chapa
  and jobs.status = 'failed'
  and jobs.message ~* 'usuario[[:space:]]+o[[:space:]]+contrase[nñ]a[[:space:]]+del[[:space:]]+portal[[:space:]]+oficial[[:space:]]+incorrectos'
  and config.portal_password_secret_id is not null
  and config.sync_status <> 'credentials_error';
