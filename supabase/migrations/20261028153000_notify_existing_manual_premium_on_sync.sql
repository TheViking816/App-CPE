create or replace function public.app_cpe_mobile_salary_save(
  p_run_id uuid,p_chapa text,p_snapshot jsonb,p_premiums jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_previous jsonb; v_history jsonb; v_journals jsonb; v_old_month jsonb;
  v_rows jsonb; v_incoming jsonb; v_old_row jsonb; v_item jsonb;
  v_year integer; v_month integer; v_done integer; v_total integer;
  v_added integer := 0; v_changed integer := 0;
  v_pr_added integer := 0; v_pr_changed integer := 0;
  v_date date; v_slot text; v_user_id uuid; v_old_premium numeric; v_manual_premium numeric;
begin
  if not exists(select 1 from cpe_mobile_private.personal_runs
      where id=p_run_id and status='running' and run_mode='salary' and current_chapa=p_chapa)
    or not exists(select 1 from cpe_mobile_private.personal_items
      where run_id=p_run_id and chapa=p_chapa and status='running')
    then raise exception 'Cuenta no asignada'; end if;
  v_journals := p_snapshot->'journals';
  v_year := (v_journals->>'year')::integer;
  v_month := (v_journals->>'month')::integer;
  if p_snapshot->>'chapa' is distinct from p_chapa
    or p_snapshot->>'schemaVersion' is distinct from '1'
    or v_year not between 2024 and 2035 or v_month not between 1 and 12
    or jsonb_typeof(v_journals->'rows') is distinct from 'array'
    or jsonb_array_length(v_journals->'rows')>100
    or octet_length(p_snapshot::text)>200000
    then raise exception 'Jornales incompletos'; end if;
  if p_premiums is not null and (
    p_premiums->>'chapa' is distinct from p_chapa
    or (p_premiums->>'year')::integer is distinct from v_year
    or (p_premiums->>'month')::integer is distinct from v_month
    or p_premiums->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(p_premiums->'rows') is distinct from 'array'
    or jsonb_array_length(p_premiums->'rows')>100
    or octet_length(p_premiums::text)>50000)
    then raise exception 'Primas incompletas'; end if;

  perform pg_advisory_xact_lock(hashtextextended('app-cpe-salary-slot:'||p_chapa,0));
  select id into v_user_id from public.app_cpe_users where chapa=p_chapa;
  select payload into v_previous from private.app_cpe_personal_noray_snapshots
    where chapa=p_chapa for update;
  select item into v_old_month from jsonb_array_elements(
    coalesce(v_previous->'journalHistory','[]'::jsonb)||
    case when v_previous->'journals' is not null
      then jsonb_build_array(v_previous->'journals') else '[]'::jsonb end) with ordinality as periods(item,ord)
    where (item->>'year')::int=v_year and (item->>'month')::int=v_month
    order by ord desc limit 1;
  v_rows := coalesce(v_old_month->'rows','[]'::jsonb);
  for v_incoming in select value from jsonb_array_elements(v_journals->'rows') loop
    if coalesce(v_incoming->>'dia','') !~ '^[0-9]{1,2}$'
      or coalesce(v_incoming->>'jornada','') !~ '^[0-9]{2}-[0-9]{2}$'
      then raise exception 'Jornal inválido'; end if;
    begin v_date:=make_date(v_year,v_month,(v_incoming->>'dia')::int);
    exception when datetime_field_overflow then raise exception 'Fecha de jornal inválida'; end;
    v_slot:=v_date::text||'|'||(v_incoming->>'jornada');
    select item into v_old_row from jsonb_array_elements(v_rows) item
      where (item->>'dia')::int=(v_incoming->>'dia')::int
        and item->>'jornada'=v_incoming->>'jornada' limit 1;
    if v_old_row is null then
      if exists(select 1 from private.app_cpe_manual_jornales m
        where m.user_id=v_user_id and m.work_date=v_date and m.shift=v_incoming->>'jornada')
        then v_changed:=v_changed+1;
        else v_added:=v_added+1; end if;
    elsif v_old_row is distinct from v_incoming then
      v_changed:=v_changed+1;
    end if;
    if v_old_row=v_incoming then continue; end if;
    -- Remove only this date/shift from the previous snapshot. An unrelated
    -- shift on the same day must survive.
    select coalesce(jsonb_agg(item),'[]'::jsonb) into v_rows
      from jsonb_array_elements(v_rows) item
      where not ((item->>'dia')::int=(v_incoming->>'dia')::int
        and item->>'jornada'=v_incoming->>'jornada');
    v_rows:=v_rows||jsonb_build_array(v_incoming);
  end loop;
  if v_rows is distinct from coalesce(v_old_month->'rows','[]'::jsonb)
    or v_previous->'journals' is null then
    v_journals:=jsonb_set(v_journals,'{rows}',v_rows);
    select coalesce(jsonb_agg(item),'[]'::jsonb) into v_history
      from jsonb_array_elements(coalesce(v_previous->'journalHistory',
        case when v_previous->'journals' is not null
          then jsonb_build_array(v_previous->'journals') else '[]'::jsonb end)) item
      where (item->>'year',item->>'month') is distinct from
        (v_journals->>'year',v_journals->>'month');
    v_previous:=coalesce(v_previous,jsonb_build_object('schemaVersion',1,'chapa',p_chapa));
    v_previous:=jsonb_set(v_previous,'{journals}',v_journals,true);
    v_previous:=jsonb_set(v_previous,'{journalHistory}',v_history||jsonb_build_array(v_journals),true);
    v_previous:=jsonb_set(v_previous,'{updatedAt}',to_jsonb(now()),true);
    insert into private.app_cpe_personal_noray_snapshots(chapa,payload,updated_at)
      values(p_chapa,v_previous,now()) on conflict(chapa)
      do update set payload=excluded.payload,updated_at=now();
  end if;

  if p_premiums is not null then
    for v_item in select value from jsonb_array_elements(p_premiums->'rows') loop
      if v_item->>'part' !~ '^[0-9]{1,12}$'
        or v_item->>'date' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
        or v_item->>'shift' !~ '^[0-9]{2}-[0-9]{2}$'
        or (v_item->>'amount')::numeric not between 0.01 and 99999.99
        then raise exception 'Prima inválida'; end if;
      v_date:=(v_item->>'date')::date;
      v_slot:=v_date::text||'|'||(v_item->>'shift');
      select amount into v_old_premium
        from cpe_mobile_private.personal_salary_premiums
        where chapa=p_chapa and work_date=v_date and shift=v_item->>'shift'
        order by updated_at desc limit 1;
      if v_old_premium is null then
        if exists(select 1 from private.app_cpe_manual_jornales m
          where m.user_id=v_user_id and m.work_date=v_date
            and m.shift=v_item->>'shift' and m.premium>0)
          or exists(select 1 from private.app_cpe_manual_premiums m
          where m.user_id=v_user_id and m.jornal_key like v_date::text||'|%|%|'||(v_item->>'shift')||'%')
          then v_pr_changed:=v_pr_changed+1; else v_pr_added:=v_pr_added+1; end if;
      elsif v_old_premium is distinct from (v_item->>'amount')::numeric then
        v_pr_changed:=v_pr_changed+1;
      end if;
      delete from cpe_mobile_private.personal_salary_premiums
        where chapa=p_chapa and work_date=v_date and shift=v_item->>'shift'
          and part<>v_item->>'part';
      insert into cpe_mobile_private.personal_salary_premiums
        (chapa,year,month,part,work_date,shift,amount,status)
        values(p_chapa,v_year,v_month,v_item->>'part',v_date,v_item->>'shift',
          (v_item->>'amount')::numeric,coalesce(v_item->>'status','verified'))
        on conflict(chapa,year,month,part) do update
          set work_date=excluded.work_date,shift=excluded.shift,
            amount=excluded.amount,status=excluded.status,updated_at=now()
          where (cpe_mobile_private.personal_salary_premiums.work_date,
            cpe_mobile_private.personal_salary_premiums.shift,
            cpe_mobile_private.personal_salary_premiums.amount,
            cpe_mobile_private.personal_salary_premiums.status) is distinct from
            (excluded.work_date,excluded.shift,excluded.amount,excluded.status);
      -- An existing synced amount can be unchanged while a manual amount differs.
      -- Notify once for that difference; keep the manual record as an audit trail.
      if v_old_premium is not distinct from (v_item->>'amount')::numeric
        and v_date >= (now() at time zone 'Europe/Madrid')::date - 30 then
        select x.amount into v_manual_premium from (
          select m.premium as amount, m.updated_at from private.app_cpe_manual_jornales m
            where m.user_id=v_user_id and m.work_date=v_date
              and m.shift=v_item->>'shift' and m.premium>0
          union all
          select m.amount, m.updated_at from private.app_cpe_manual_premiums m
            where m.user_id=v_user_id and m.jornal_key like
              v_date::text||'|%|%|'||(v_item->>'shift')||'%'
        ) x order by x.updated_at desc limit 1;
        if v_manual_premium is not null
          and v_manual_premium is distinct from (v_item->>'amount')::numeric then
          insert into public.app_cpe_user_notifications
            (user_id,chapa,event_type,title,body,entity_key,change_hash,target_tab,metadata)
          values (v_user_id,p_chapa,'premium_updated','Prima actualizada',
            to_char(v_date,'DD/MM/YYYY')||' · '||(v_item->>'shift')||' · '||
            to_char(v_manual_premium,'FM999G999D00')||' € → '||
            to_char((v_item->>'amount')::numeric,'FM999G999D00')||' € · Parte '||
            (v_item->>'part'),
            v_slot,(v_item->>'part')||':'||v_manual_premium::text||':'||(v_item->>'amount'),
            'sueldometro',jsonb_build_object('date',v_date,'shift',v_item->>'shift',
              'part',v_item->>'part','previousAmount',v_manual_premium,
              'amount',(v_item->>'amount')::numeric))
          on conflict (chapa,event_type,entity_key,change_hash) do nothing;
        end if;
      end if;
    end loop;
  end if;
  update cpe_mobile_private.personal_items set status='completed'
    where run_id=p_run_id and chapa=p_chapa;
  update cpe_mobile_private.personal_runs
    set completed_count=completed_count+1,current_chapa=null
    where id=p_run_id returning completed_count,total_count into v_done,v_total;
  return jsonb_build_object('completedCount',v_done,'totalCount',v_total,
    'newJournals',v_added,'updatedJournals',v_changed,
    'newPremiums',v_pr_added,'updatedPremiums',v_pr_changed);
end $$;


