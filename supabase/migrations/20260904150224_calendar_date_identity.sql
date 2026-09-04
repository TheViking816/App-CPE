-- Only calendars use this merge. Premium/journal preservation is unchanged.
create function private.app_cpe_merge_calendar(a jsonb, b jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  result jsonb; months jsonb := '{}'; days jsonb; p jsonb; prior jsonb;
  d jsonb; key text; day_key text; merged_month jsonb; ordered jsonb;
begin
  if a is null and b is null then return null; end if;
  result := private.app_cpe_keep_known_json(coalesce(a,'{}') - 'months',coalesce(b,'{}') - 'months');
  for p in select value from jsonb_array_elements(
    coalesce(a->'months','[]') || coalesce(b->'months','[]')
  ) loop
    key := case when p->>'year' ~ '^[0-9]{4}$' and p->>'month' ~ '^[0-9]{1,2}$'
      then (p->>'year') || '-' || ((p->>'month')::int)::text
      else coalesce(p->>'title',p::text) end;
    prior := months->key;
    days := '{}';
    for d in select value from jsonb_array_elements(coalesce(prior->'days','[]') || coalesce(p->'days','[]')) loop
      day_key := case when d->>'day' ~ '^[0-9]{1,2}$'
        then ((d->>'day')::int)::text else d::text end;
      days := jsonb_set(days,array[day_key],private.app_cpe_keep_known_json(days->day_key,d),true);
    end loop;
    select coalesce(jsonb_agg(value order by
      case when value->>'day' ~ '^[0-9]{1,2}$' then (value->>'day')::int end nulls last),'[]')
      into ordered from jsonb_each(days);
    merged_month := private.app_cpe_keep_known_json(prior - 'days',p - 'days');
    if prior ? 'days' or p ? 'days' then
      merged_month := jsonb_set(merged_month,'{days}',ordered,true);
    end if;
    months := jsonb_set(months,array[key],merged_month,true);
  end loop;
  select coalesce(jsonb_agg(value order by
    case when value->>'year' ~ '^[0-9]{4}$' then (value->>'year')::int end nulls last,
    case when value->>'month' ~ '^[0-9]{1,2}$' then (value->>'month')::int end nulls last),'[]')
    into ordered from jsonb_each(months);
  if a ? 'months' or b ? 'months' then result := jsonb_set(result,'{months}',ordered,true); end if;
  return result;
end; $$;
revoke all on function private.app_cpe_merge_calendar(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function private.app_cpe_guard_partial_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; merged jsonb;
begin
  for k in select jsonb_object_keys(old.payload) loop
    if k in ('sync','jornales','primas','mensajes') then continue; end if;
    if k <> 'nominas' and new.payload#>>'{sync,partial}' is distinct from 'true'
      and new.payload#>>'{sync,failed}' is distinct from 'true'
      and new.payload->k is not null and new.payload->k <> '{}'::jsonb
      and new.payload#>array[k,'rows'] is distinct from '[]'::jsonb
    then continue; end if;
    if k = 'descansos' then
      merged := private.app_cpe_merge_calendar(old.payload->k,new.payload->k);
    else
      merged := private.app_cpe_keep_known_json(old.payload->k,new.payload->k);
    end if;
    if merged is not null then new.payload := jsonb_set(new.payload,array[k],merged,true); end if;
  end loop;
  return new;
end; $$;

-- Runs after the preservation trigger, for complete reads as well as partial ones.
create function private.app_cpe_order_calendar_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if jsonb_typeof(new.payload->'descansos'->'months') = 'array' then
    new.payload := jsonb_set(new.payload,'{descansos}',
      private.app_cpe_merge_calendar(null,new.payload->'descansos'));
  end if;
  return new;
end; $$;
revoke all on function private.app_cpe_order_calendar_snapshot() from public,anon,authenticated,service_role;
create trigger zzzz_app_cpe_order_calendar_snapshot before insert or update
on public.app_cpe_portal_snapshots for each row execute function private.app_cpe_order_calendar_snapshot();

-- Existing archive triggers keep the original versions. Do not change sync dates.
do $$
declare a jsonb; b jsonb; r jsonb;
begin
  a := '{"months":[{"year":2026,"month":9,"days":[{"day":15,"code":"VA"},{"day":1,"code":""}]},{"year":2026,"month":8,"days":[{"day":19,"code":"DS"}]}]}';
  b := '{"months":[{"year":2026,"month":9,"days":[{"day":15,"code":""},{"day":16,"code":"DS"}]}]}';
  r := private.app_cpe_merge_calendar(a,b);
  if jsonb_array_length(r->'months') <> 2 or r#>>'{months,0,month}' <> '8'
    or r#>>'{months,1,days,1,code}' <> 'VA'
    or jsonb_array_length(r#>'{months,1,days}') <> 3
    or private.app_cpe_merge_calendar(null,r) <> r then
    raise exception 'Calendar merge regression';
  end if;
end; $$;
-- Fail and roll back the entire migration if unrelated data changes.
-- Maintenance-only final trigger: existing generic guards may reorder other
-- arrays even on an unchanged write. Restore those sections byte-for-byte.
-- The table lock prevents any concurrent writer from using this temporary guard.
lock table public.app_cpe_portal_snapshots in share row exclusive mode;
create function private.app_cpe_calendar_repair_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.payload := (old.payload - 'descansos') || jsonb_build_object('descansos',new.payload->'descansos');
  return new;
end; $$;
create trigger zzzzz_app_cpe_calendar_repair_only before update on public.app_cpe_portal_snapshots
for each row execute function private.app_cpe_calendar_repair_only();
do $$
declare s record; after_payload jsonb;
begin
  for s in select chapa,payload from public.app_cpe_portal_snapshots
    where jsonb_typeof(payload->'descansos'->'months')='array'
    and payload->'descansos' is distinct from private.app_cpe_merge_calendar(null,payload->'descansos')
    for update
  loop
    update public.app_cpe_portal_snapshots set payload=jsonb_set(payload,'{descansos}',
      private.app_cpe_merge_calendar(null,payload->'descansos')) where chapa=s.chapa
      returning payload into after_payload;
    if (s.payload - 'descansos') is distinct from (after_payload - 'descansos') then
      raise exception 'Calendar repair changed unrelated sections for %',s.chapa;
    end if;
  end loop;
end; $$;
drop trigger zzzzz_app_cpe_calendar_repair_only on public.app_cpe_portal_snapshots;
drop function private.app_cpe_calendar_repair_only();
