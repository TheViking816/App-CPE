create or replace function private.app_cpe_cleanup_portal_link_secrets()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets
    where id=old.password_secret_id or id=old.security_key_secret_id;
  return old;
end $$;
revoke all on function private.app_cpe_cleanup_portal_link_secrets() from public, anon, authenticated;

create trigger app_cpe_cleanup_portal_link_secrets_after_delete
after delete on private.app_cpe_portal_link_requests
for each row execute function private.app_cpe_cleanup_portal_link_secrets();
