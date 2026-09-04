-- Immutable versions survive replacement of a current snapshot. Account deletion
-- deliberately cascades into this private archive, respecting user erasure.
create table public.app_cpe_portal_data_versions (
  id bigint generated always as identity primary key,
  chapa text not null references public.app_cpe_users(chapa) on delete cascade,
  source text not null,
  payload jsonb not null,
  fingerprint text not null,
  saved_at timestamptz not null default now(),
  unique(chapa, source, fingerprint)
);
alter table public.app_cpe_portal_data_versions enable row level security;
revoke all on public.app_cpe_portal_data_versions from public, anon, authenticated;
grant select on public.app_cpe_portal_data_versions to service_role;

create function private.app_cpe_archive_portal_data() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if tg_op = 'UPDATE' then
    v := to_jsonb(old) - 'updated_at';
    insert into public.app_cpe_portal_data_versions(chapa,source,payload,fingerprint)
      values(old.chapa,tg_table_name,v,md5(v::text)) on conflict do nothing;
  end if;
  v := to_jsonb(new) - 'updated_at';
  insert into public.app_cpe_portal_data_versions(chapa,source,payload,fingerprint)
    values(new.chapa,tg_table_name,v,md5(v::text)) on conflict do nothing;
  return new;
end; $$;
revoke all on function private.app_cpe_archive_portal_data() from public,anon,authenticated,service_role;
create trigger app_cpe_archive_snapshot after insert or update on public.app_cpe_portal_snapshots
for each row execute function private.app_cpe_archive_portal_data();
create trigger app_cpe_archive_document after insert or update on public.app_cpe_portal_documents
for each row execute function private.app_cpe_archive_portal_data();
insert into public.app_cpe_portal_data_versions(chapa,source,payload,fingerprint)
select chapa,'app_cpe_portal_snapshots',to_jsonb(s)-'updated_at',md5((to_jsonb(s)-'updated_at')::text)
from public.app_cpe_portal_snapshots s join public.app_cpe_users u using(chapa)
on conflict do nothing;
insert into public.app_cpe_portal_data_versions(chapa,source,payload,fingerprint)
select chapa,'app_cpe_portal_documents',to_jsonb(d)-'updated_at',md5((to_jsonb(d)-'updated_at')::text)
from public.app_cpe_portal_documents d join public.app_cpe_users u using(chapa)
on conflict do nothing;

-- Missing data cannot erase known values. Object arrays merge by stable identity.
create function private.app_cpe_keep_known_json(a jsonb,b jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare result jsonb; k text; v jsonb; item jsonb; identity_key text; items jsonb := '{}';
begin
  if a is null then return b; end if;
  if b is null or b in ('null'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb) then return a; end if;
  if jsonb_typeof(a)='object' and jsonb_typeof(b)='object' then
    result := a;
    for k,v in select * from jsonb_each(b) loop
      if k='produccionEstado' and
        (case a->>k when 'paid' then 3 when 'verified' then 2 when 'pending' then 1 else 0 end) >
        (case v#>>'{}' when 'paid' then 3 when 'verified' then 2 when 'pending' then 1 else 0 end)
      then continue; end if;
      result := jsonb_set(result,array[k],private.app_cpe_keep_known_json(a->k,v),true);
    end loop;
    return result;
  end if;
  if jsonb_typeof(a)='array' and jsonb_typeof(b)='array'
    and not exists(select 1 from jsonb_array_elements(a||b) x where jsonb_typeof(x)<>'object') then
    for item in select * from jsonb_array_elements(a||b) loop
      identity_key := coalesce(item->>'id',item->>'documentId',item->>'monthLabel',
        case when item->>'parte' is not null then concat_ws('|',item->>'parte',item->>'jornada',item->>'especialidad') end,
        item::text);
      items := jsonb_set(items,array[identity_key],private.app_cpe_keep_known_json(items->identity_key,item),true);
    end loop;
    select coalesce(jsonb_agg(value),'[]') into result from jsonb_each(items);
    return result;
  end if;
  return b;
end; $$;
revoke all on function private.app_cpe_keep_known_json(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function private.app_cpe_merge_portal_period_section(p_existing jsonb,p_incoming jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb; histories jsonb; old_period jsonb; new_period jsonb;
begin
  if p_existing is null then return p_incoming; end if;
  if p_incoming is null or p_incoming->>'locked'='true' then return p_existing; end if;
  old_period := p_existing - 'history';
  new_period := p_incoming - 'history';
  histories := coalesce(p_existing->'history','[]');
  if nullif(old_period->>'monthLabel','') is not null then
    histories := private.app_cpe_keep_known_json(histories,jsonb_build_array(old_period));
  end if;
  histories := private.app_cpe_keep_known_json(histories,coalesce(p_incoming->'history','[]'));
  if nullif(new_period->>'monthLabel','') is not null then
    histories := private.app_cpe_keep_known_json(histories,jsonb_build_array(new_period));
  end if;
  if old_period->>'monthLabel' is not distinct from new_period->>'monthLabel' then
    result := private.app_cpe_keep_known_json(old_period,new_period);
  else result := new_period; end if;
  return jsonb_set(result,'{history}',histories,true);
end; $$;

create function private.app_cpe_guard_partial_snapshot() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text; merged jsonb;
begin
  -- Preserve all sections when a partial read supplies empty values. Period
  -- sections have their own month-aware merge and sync metadata stays current.
  for k in select jsonb_object_keys(old.payload) loop
    if k in ('sync','jornales','primas','mensajes') then continue; end if;
    -- Valid complete operational changes (cancelled leave, new assignments)
    -- remain authoritative; their former versions stay in the archive.
    if k <> 'nominas' and new.payload#>>'{sync,partial}' is distinct from 'true'
      and new.payload#>>'{sync,failed}' is distinct from 'true'
      and new.payload->k is not null and new.payload->k <> '{}'::jsonb
      and new.payload#>array[k,'rows'] is distinct from '[]'::jsonb
    then continue; end if;
    merged := private.app_cpe_keep_known_json(old.payload->k,new.payload->k);
    if merged is not null then new.payload := jsonb_set(new.payload,array[k],merged,true); end if;
  end loop;
  return new;
end; $$;
revoke all on function private.app_cpe_guard_partial_snapshot() from public,anon,authenticated,service_role;
create trigger zzz_app_cpe_guard_partial_snapshot before update on public.app_cpe_portal_snapshots
for each row execute function private.app_cpe_guard_partial_snapshot();

create function private.app_cpe_guard_payroll_document() returns trigger
language plpgsql set search_path = '' as $$
begin
  if nullif(new.content_base64,'') is null and nullif(old.content_base64,'') is not null then
    new.content_base64 := old.content_base64;
    new.mime_type := old.mime_type;
    new.title := old.title;
  end if;
  return new;
end; $$;
revoke all on function private.app_cpe_guard_payroll_document() from public,anon,authenticated,service_role;
create trigger app_cpe_guard_payroll_document before update on public.app_cpe_portal_documents
for each row execute function private.app_cpe_guard_payroll_document();
