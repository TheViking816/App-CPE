-- Test sessions and usage events are reverted together before this test ends.
do $$
declare
  v_user public.app_cpe_users;
  v_admin_token text;
  v_user_token text;
  v_result jsonb;
  v_before bigint;
  v_denied boolean;
  v_section text;
begin
  select count(*) into v_before from private.app_cpe_personal_link_opens;
  begin
    select * into v_user from public.app_cpe_users where chapa = '71206';
    if v_user.id is null then raise exception 'Test account missing'; end if;
    select public.app_cpe_create_session(id) into v_admin_token from public.app_cpe_users where chapa = '72683';
    v_user_token := public.app_cpe_create_session(v_user.id);
    execute 'set local role anon';
    foreach v_section in array array['donde-voy','vacaciones','dobles','jornales','descansos','chapero','chapero-especialidades','puertas','jornada-contratada'] loop
      if not public.app_cpe_track_personal_link_open(v_user_token,v_section) then
        raise exception 'Valid opening not recorded';
      end if;
    end loop;
    if public.app_cpe_track_personal_link_open(v_admin_token,'chapero') then
      raise exception 'Administrator access polluted usage';
    end if;
    v_denied := false;
    begin perform public.app_cpe_admin_personal_link_monitor(v_user_token);
    exception when raise_exception then v_denied := true; end;
    if not v_denied then raise exception 'Ordinary user can read other users activity'; end if;
    v_denied := false;
    begin perform public.app_cpe_track_personal_link_open(v_user_token,'https://example.com/?pwd=secret');
    exception when raise_exception then v_denied := true; end;
    if not v_denied then raise exception 'Unvalidated section accepted'; end if;
    v_denied := false;
    begin perform public.app_cpe_track_personal_link_open('invalid-test-token','chapero');
    exception when raise_exception then v_denied := true; end;
    if not v_denied then raise exception 'Invalid session accepted'; end if;
    v_result := public.app_cpe_admin_personal_link_monitor(v_admin_token);
    if jsonb_array_length(v_result->'sections') < 9 or (v_result->>'opens24h')::bigint < 9 then
      raise exception 'Monitor totals omitted openings';
    end if;
    if exists(select 1 from jsonb_array_elements(v_result->'recent') r
      where r ? 'token' or r ? 'url' or r ? 'password_hash') then
      raise exception 'Credentials exposed in monitor';
    end if;
    execute 'reset role';
    update public.app_cpe_sessions set is_support = true
      where token_hash = encode(extensions.digest(v_user_token,'sha256'),'hex');
    if public.app_cpe_track_personal_link_open(v_user_token,'puertas') then
      raise exception 'Support access polluted usage';
    end if;
    if (select count(*) from private.app_cpe_personal_link_opens) <> v_before + 9 then
      raise exception 'Unexpected extra usage records';
    end if;
    raise exception using errcode = 'ZX001', message = 'Revert temporary test sessions and openings';
  exception when sqlstate 'ZX001' then null;
  end;
  if (select count(*) from private.app_cpe_personal_link_opens) <> v_before then
    raise exception 'Test openings were not reverted';
  end if;
end $$;
