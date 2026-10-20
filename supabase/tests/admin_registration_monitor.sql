-- Use a temporary administrator session; revert it before this test ends.
do $$
declare
  v_token text;
  v_result jsonb;
  v_expected bigint;
  v_denied boolean := false;
begin
  begin
    perform public.app_cpe_admin_registration_monitor('invalid-registration-monitor-test');
  exception when raise_exception then v_denied := true;
  end;
  if not v_denied then raise exception 'Unauthenticated registration history access'; end if;
  select count(*) into v_expected from public.app_cpe_users where chapa <> '72683';
  begin
    select public.app_cpe_create_session(id) into v_token from public.app_cpe_users where chapa = '72683';
    v_result := public.app_cpe_admin_registration_monitor(v_token);
    if (v_result->>'total')::bigint <> v_expected
      or jsonb_array_length(v_result->'registrations') <> least(v_expected, 100)
      or exists(select 1 from jsonb_array_elements(v_result->'registrations') r
        where r->>'chapa' = '72683' or r ? 'password_hash' or r ? 'token') then
      raise exception 'Incorrect registration history or sensitive fields exposed';
    end if;
    if (select array_agg(r->>'chapa' order by (r->>'created_at')::timestamptz desc, r->>'chapa' desc)
      from jsonb_array_elements(v_result->'registrations') r)
      is distinct from (select array_agg(r->>'chapa' order by ordinal)
        from jsonb_array_elements(v_result->'registrations') with ordinality d(r,ordinal)) then
      raise exception 'Registration history is not newest first';
    end if;
    raise exception using errcode = 'ZX001', message = 'Revert temporary test session';
  exception when sqlstate 'ZX001' then null;
  end;
end $$;
