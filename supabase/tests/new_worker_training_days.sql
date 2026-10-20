-- All registration checks are rolled back inside subtransactions.
do $$
declare
  v_chapa text;
  v_session jsonb;
  v_days jsonb;
begin
  if (select count(*) from private.app_cpe_initial_paid_days) <> 160
    or (select count(distinct chapa) from private.app_cpe_initial_paid_days) <> 40 then
    raise exception 'Expected four FM dates for exactly 40 chapas';
  end if;
  for v_chapa in select distinct chapa from private.app_cpe_initial_paid_days loop
    if exists(select 1 from public.app_cpe_users where chapa = v_chapa) then
      if (select count(*) from private.app_cpe_manual_paid_days d
        join public.app_cpe_users u on u.id = d.user_id
        where u.chapa = v_chapa and d.work_date between date '2026-10-19' and date '2026-10-22'
          and d.concept_type = 'FM') <> 4 then
        raise exception 'Missing training days for existing chapa %', v_chapa;
      end if;
    else
      begin
        execute 'set local role anon';
        v_session := public.app_cpe_register_manual_profile_named(
          v_chapa, extensions.gen_random_uuid()::text, null, 'G-I', 'A - N',
          array['conductor-1a'], null
        );
        v_days := public.app_cpe_list_manual_paid_days(v_session->>'token');
        if jsonb_array_length(v_days) <> 4 or exists(
          select 1 from jsonb_array_elements(v_days) d
          where d->>'concept_type' <> 'FM'
            or (d->>'work_date')::date not between date '2026-10-19' and date '2026-10-22'
        ) then raise exception 'Registration did not seed four FM dates for %', v_chapa; end if;
        -- The existing range editor must not add duplicates to seeded dates.
        perform public.app_cpe_add_manual_paid_day_range(
          v_session->>'token', date '2026-10-19', date '2026-10-22', 'FM'
        );
        if jsonb_array_length(public.app_cpe_list_manual_paid_days(v_session->>'token')) <> 4 then
          raise exception 'Duplicate FM days for %', v_chapa;
        end if;
        raise exception using errcode = 'ZX001', message = 'Revert verified test account';
      exception when sqlstate 'ZX001' then null;
      end;
      if exists(select 1 from public.app_cpe_users where chapa = v_chapa) then
        raise exception 'Test account was not reverted';
      end if;
    end if;
  end loop;
end $$;
