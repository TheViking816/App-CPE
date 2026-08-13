alter table public.app_cpe_portal_sync_jobs
  drop constraint if exists app_cpe_portal_sync_jobs_request_kind_check;

alter table public.app_cpe_portal_sync_jobs
  add constraint app_cpe_portal_sync_jobs_request_kind_check
  check (request_kind in ('snapshot', 'document', 'history'));
