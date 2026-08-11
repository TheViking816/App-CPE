revoke all on function public.app_cpe_claim_scheduled_portal_sync_jobs(text) from public, anon, authenticated;
grant execute on function public.app_cpe_claim_scheduled_portal_sync_jobs(text) to service_role;

revoke all on function public.app_cpe_update_auto_sync_success() from public, anon, authenticated;
