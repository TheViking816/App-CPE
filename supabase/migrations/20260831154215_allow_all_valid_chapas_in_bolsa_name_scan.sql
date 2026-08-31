alter table public.app_cpe_bolsa_name_scan_jobs
  drop constraint if exists app_cpe_bolsa_name_scan_jobs_chapa_check;

alter table public.app_cpe_bolsa_name_scan_jobs
  add constraint app_cpe_bolsa_name_scan_jobs_chapa_check
  check (chapa ~ '^[0-9]{5}$');

comment on constraint app_cpe_bolsa_name_scan_jobs_chapa_check
  on public.app_cpe_bolsa_name_scan_jobs is
  'Admite cualquier chapa CPE valida de cinco cifras.';
