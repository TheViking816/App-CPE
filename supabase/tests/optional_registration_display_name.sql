-- Exercise the production RPC without retaining any test users or sessions.
do $$
declare
  v_chapa text;
  v_name text;
  v_result jsonb;
  v_stored_name text;
  v_rejected boolean;
begin
  select chapa into v_chapa from (
    select value::text as chapa from generate_series(79990, 79999) value
  ) candidates where not exists (
    select 1 from public.app_cpe_users u where u.chapa = candidates.chapa
  ) limit 1;
  if v_chapa is null then raise exception 'No disposable test chapa available'; end if;
  if not has_function_privilege('anon',
    'public.app_cpe_register_manual_profile_named(text,text,text,text,text,text[],text)', 'EXECUTE') then
    raise exception 'Registration is not available to new users';
  end if;

  foreach v_name in array array[null::text, '', '   ', '  María   García Pérez  '] loop
    begin
      v_result := public.app_cpe_register_manual_profile_named(
        v_chapa, extensions.gen_random_uuid()::text, null, 'G-I', 'A - N',
        array['conductor-1a','conductor-2a','pol-trincador','pol-trinca-coches','pol-especialista'], v_name
      );
      if v_result->>'chapa' is distinct from v_chapa
        or nullif(v_result->>'token', '') is null
        or jsonb_array_length(v_result->'specialties') <> 5 then
        raise exception 'Registration lost the user profile';
      end if;
      select display_name into v_stored_name from public.app_cpe_users where chapa = v_chapa;
      if nullif(trim(coalesce(v_name,'')), '') is null then
        if v_stored_name is not null then raise exception 'Name should remain optional'; end if;
      elsif v_stored_name is distinct from 'María García Pérez'
        or v_result->>'displayName' is distinct from v_stored_name then
        raise exception 'Display name was not saved or returned correctly';
      end if;
      raise exception using errcode = 'ZX001', message = 'Revert verified registration';
    exception when sqlstate 'ZX001' then null;
    end;
    if exists(select 1 from public.app_cpe_users where chapa = v_chapa) then
      raise exception 'Test registration was not reverted';
    end if;
  end loop;

  foreach v_name in array array[repeat('a', 41), '<script>'] loop
    v_rejected := false;
    begin
      perform public.app_cpe_register_manual_profile_named(
        v_chapa, extensions.gen_random_uuid()::text, null, 'G-I', 'A - N',
        array['pol-trincador'], v_name
      );
    exception when raise_exception then v_rejected := true;
    end;
    if not v_rejected or exists(select 1 from public.app_cpe_users where chapa = v_chapa) then
      raise exception 'Invalid name left a partial account';
    end if;
  end loop;
end $$;
