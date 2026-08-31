alter table public.app_cpe_bolsa_name_scan_jobs
  drop constraint if exists app_cpe_bolsa_name_scan_jobs_chapa_check;

alter table public.app_cpe_bolsa_name_scan_jobs
  add constraint app_cpe_bolsa_name_scan_jobs_chapa_check
  check (chapa ~ '^(24|63|71|72)[0-9]{3}$');

comment on constraint app_cpe_bolsa_name_scan_jobs_chapa_check
  on public.app_cpe_bolsa_name_scan_jobs is
  'Admite exclusivamente chapas CPE de los rangos 24xxx, 63xxx, 71xxx y 72xxx.';
