-- Revert temporary sessions and events after checking the actual public RPCs.
do $$ declare t text; a text; r jsonb; p text; n bigint;
begin
select count(*) into n from public.app_cpe_usage_events;
begin
select public.app_cpe_create_session(id) into t from public.app_cpe_users where chapa='71206';
select public.app_cpe_create_session(id) into a from public.app_cpe_users where chapa='72683';
execute 'set local role anon';
foreach p in array array['chapero','cuenta','perfil'] loop
r:=public.app_cpe_track_page_visit(t,p);
if not (r->>'tracked')::boolean then raise exception 'Visit not tracked: %',p; end if;
r:=public.app_cpe_get_usage_monitor(a);
if not exists(select 1 from jsonb_array_elements(r->'pages') item where item->>'page'=p and (item->>'views')::int>=1) then raise exception 'Page missing from monitor: %',p; end if;
end loop;
execute 'reset role';
raise exception using errcode='ZX001',message='Rollback test';
exception when sqlstate 'ZX001' then null; end;
if (select count(*) from public.app_cpe_usage_events)<>n then raise exception 'Test events persisted'; end if;
end $$;
