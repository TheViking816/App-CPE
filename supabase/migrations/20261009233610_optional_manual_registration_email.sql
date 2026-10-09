-- Registration no longer asks for email. Keep the existing RPC signature so
-- older clients can still register with an optional, validated address.
create or replace function public.app_cpe_register_manual_profile(
  p_chapa text, p_password text, p_email text,
  p_professional_group text, p_rest_group text, p_specialties text[]
) returns jsonb language plpgsql security definer
set search_path = public, private, extensions, pg_catalog, pg_temp as $$
declare v_user public.app_cpe_users; v_chapa text; v_email text; v_token text;
begin
  v_chapa := public.app_cpe_normalize_chapa(p_chapa);
  v_email := nullif(lower(trim(coalesce(p_email, ''))), '');
  if length(coalesce(p_password, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Introduce un correo válido';
  end if;
  perform private.app_cpe_validate_manual_profile(p_professional_group, p_rest_group, p_specialties);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_cpe_register:' || v_chapa, 0));
  if exists(select 1 from public.app_cpe_users where chapa = v_chapa) then
    raise exception 'Esa chapa ya está registrada; inicia sesión con tu cuenta';
  end if;
  insert into public.app_cpe_users
    (chapa, password_hash, specialties, email, professional_group, rest_group, portal_activation_status)
  values
    (v_chapa, extensions.crypt(p_password, extensions.gen_salt('bf')),
     p_specialties, v_email, p_professional_group, p_rest_group, 'active')
  returning * into v_user;
  v_token := public.app_cpe_create_session(v_user.id);
  return public.app_cpe_public_user(v_user, v_token);
end;
$$;
