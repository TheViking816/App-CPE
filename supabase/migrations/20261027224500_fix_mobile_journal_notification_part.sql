-- Keep the JSON extraction separate from text concatenation in journal notifications.
create or replace function private.app_cpe_notify_mobile_journals()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user public.app_cpe_users; v_row jsonb; v_previous jsonb;
  v_old_rows jsonb := '[]'::jsonb; v_year int; v_month int;
  v_date date; v_key text; v_type text; v_details text;
begin
  select * into v_user from public.app_cpe_users where chapa=new.chapa;
  if v_user.id is null or coalesce(new.payload->'journals'->>'year','') !~ '^20[0-9]{2}$'
    or coalesce(new.payload->'journals'->>'month','') !~ '^[0-9]{1,2}$'
    then return new; end if;
  v_year:=(new.payload->'journals'->>'year')::int;
  v_month:=(new.payload->'journals'->>'month')::int;
  if v_month not between 1 and 12 then return new; end if;
  if tg_op='UPDATE' then
    select item->'rows' into v_old_rows from jsonb_array_elements(
      coalesce(old.payload->'journalHistory','[]'::jsonb)||
      case when old.payload->'journals' is not null
        then jsonb_build_array(old.payload->'journals') else '[]'::jsonb end) with ordinality as periods(item,ord)
      where (item->>'year')::int=v_year and (item->>'month')::int=v_month
      order by ord desc limit 1;
    v_old_rows:=coalesce(v_old_rows,'[]'::jsonb);
  end if;
  for v_row in select value from jsonb_array_elements(coalesce(new.payload->'journals'->'rows','[]'::jsonb)) loop
    if coalesce(v_row->>'dia','') !~ '^[0-9]{1,2}$' then continue; end if;
    begin v_date:=make_date(v_year,v_month,(v_row->>'dia')::int);
    exception when datetime_field_overflow then continue; end;
    if v_date < (now() at time zone 'Europe/Madrid')::date - 7 then continue; end if;
    select item into v_previous from jsonb_array_elements(v_old_rows) item
      where (item->>'dia')::int=(v_row->>'dia')::int
        and item->>'jornada'=v_row->>'jornada' limit 1;
    if v_previous=v_row then continue; end if;
    v_type:=case when v_previous is not null or exists(
      select 1 from private.app_cpe_manual_jornales m
      where m.user_id=v_user.id and m.work_date=v_date and m.shift=v_row->>'jornada')
      then 'journal_updated' else 'new_journal' end;
    v_key:=v_date::text||'|'||coalesce(v_row->>'jornada','');
    v_details:=concat_ws(' · ',nullif(v_row->>'especialidad',''),
      nullif(v_row->>'empresa',''),nullif(v_row->>'buque',''),
      case when nullif(v_row->>'parte','') is not null then 'Parte '||(v_row->>'parte') end);
    insert into public.app_cpe_user_notifications
      (user_id,chapa,event_type,title,body,entity_key,change_hash,target_tab,metadata)
    values (v_user.id,new.chapa,v_type,
      case when v_type='journal_updated' then 'Jornal actualizado' else 'Nuevo jornal cargado' end,
      to_char(v_date,'DD/MM/YYYY')||' · '||coalesce(v_row->>'jornada','')||
        case when v_details<>'' then ' · '||v_details else '' end,
      v_key,encode(extensions.digest(v_row::text,'sha256'),'hex'),'sueldometro',
      jsonb_build_object('date',v_date,'shift',v_row->>'jornada','part',v_row->>'parte'))
    on conflict (chapa,event_type,entity_key,change_hash) do nothing;
  end loop;
  return new;
end $$;

