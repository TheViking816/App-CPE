create or replace function public.app_cpe_register(
  p_chapa text,
  p_password text,
  p_specialties text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_token text;
  v_chapa text;
  v_specialties text[];
begin
  v_chapa := public.app_cpe_normalize_chapa(p_chapa);
  if length(coalesce(p_password, '')) < 4 then
    raise exception 'La contraseña debe tener al menos 4 caracteres';
  end if;

  v_specialties := coalesce(p_specialties, '{}'::text[]);
  if cardinality(v_specialties) is null or cardinality(v_specialties) = 0 then
    raise exception 'Selecciona al menos una especialidad';
  end if;

  -- A first support login with master_password provisions the chapa with an
  -- unusable random password and no specialties. Let the worker claim that
  -- placeholder instead of trapping them behind the unique chapa constraint.
  select * into v_user
  from public.app_cpe_users
  where chapa = v_chapa
  for update;

  if v_user.id is null then
    insert into public.app_cpe_users (chapa, password_hash, specialties)
    values (v_chapa, crypt(p_password, gen_salt('bf')), v_specialties)
    returning * into v_user;
  elsif cardinality(v_user.specialties) = 0 then
    update public.app_cpe_users
    set password_hash = crypt(p_password, gen_salt('bf')),
        specialties = v_specialties,
        updated_at = now()
    where id = v_user.id
    returning * into v_user;
  else
    raise exception 'Esa chapa ya esta registrada';
  end if;

  v_token := public.app_cpe_create_session(v_user.id);
  return public.app_cpe_public_user(v_user, v_token);
exception
  when unique_violation then
    raise exception 'Esa chapa ya esta registrada';
end;
$$;

revoke all on function public.app_cpe_register(text, text, text[]) from public;
grant execute on function public.app_cpe_register(text, text, text[]) to anon, authenticated;
