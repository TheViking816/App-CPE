create or replace function public.app_cpe_change_password(
  p_token text,
  p_current_password text,
  p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_updated public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if v_user.password_hash <> crypt(coalesce(p_current_password, ''), v_user.password_hash) then
    raise exception 'La contraseña actual no es correcta';
  end if;

  if length(coalesce(p_new_password, '')) < 4 then
    raise exception 'La nueva contraseña debe tener al menos 4 caracteres';
  end if;

  update public.app_cpe_users
  set password_hash = crypt(p_new_password, gen_salt('bf')),
      updated_at = now()
  where id = v_user.id
  returning * into v_updated;

  delete from public.app_cpe_sessions
  where user_id = v_user.id
    and token_hash <> encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');

  return public.app_cpe_public_user(v_updated, p_token);
end;
$$;

revoke all on function public.app_cpe_change_password(text, text, text) from public;
grant execute on function public.app_cpe_change_password(text, text, text) to anon, authenticated;
