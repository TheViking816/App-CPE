-- Invalid credentials must return the user to the same pending activation flow
-- used by a new registration. The snapshot is preserved so previously loaded
-- information remains available until the replacement access is approved.
create or replace function private.app_cpe_retire_rejected_portal_credentials()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $$
begin
  if new.status = 'failed'
    and new.message ~* 'usuario[[:space:]]+o[[:space:]]+contrasena[[:space:]]+del[[:space:]]+portal[[:space:]]+oficial[[:space:]]+incorrectos' then
    update public.app_cpe_portal_auto_sync
    set enabled = false,
        updated_at = now()
    where chapa = new.chapa;

    update public.app_cpe_users
    set portal_activation_status = 'pending',
        portal_activated_at = null,
        updated_at = now()
    where chapa = new.chapa;

    delete from public.app_cpe_portal_sync_jobs where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function private.app_cpe_retire_rejected_portal_credentials() from public, anon, authenticated, service_role;

-- A pending user, or an active user whose portal access was disabled, may
-- submit a fresh email. Clearing the old outbox entries lets both the admin
-- request and the later user confirmation be delivered again.
create or replace function public.app_cpe_update_activation_email(p_token text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_updated public.app_cpe_users;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_has_enabled_access boolean;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select exists (
    select 1
    from public.app_cpe_portal_auto_sync config
    where config.chapa = v_user.chapa
      and config.enabled
      and config.portal_password_secret_id is not null
  ) into v_has_enabled_access;

  if v_user.portal_activation_status <> 'pending' and v_has_enabled_access then
    raise exception 'El acceso al portal ya está configurado';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Introduce un correo electrónico válido';
  end if;

  update public.app_cpe_users
  set email = v_email,
      portal_activation_status = 'pending',
      portal_activated_at = null,
      updated_at = now()
  where id = v_user.id
  returning * into v_updated;

  delete from public.app_cpe_activation_email_outbox
  where user_id = v_user.id
    and kind in ('admin_pending', 'user_activated');

  return public.app_cpe_public_user(v_updated, p_token);
end;
$$;

revoke all on function public.app_cpe_update_activation_email(text, text) from public, anon, authenticated;
grant execute on function public.app_cpe_update_activation_email(text, text) to anon, authenticated;
