-- Uses the live INSERT trigger. All fixtures roll back, and cancelled
-- offers bypass the publication notification trigger.
begin;
do $test$
declare
  v_owner uuid;
  v_count integer;
begin
  select u.id into v_owner from public.app_cpe_users u
  where not exists (
    select 1 from public.app_cpe_rest_offers o
    where o.owner_id = u.id and o.created_at > now() - interval '24 hours'
  ) limit 1;
  if v_owner is null then raise exception 'No fixture owner available'; end if;
  for v_count in 1..30 loop
    insert into public.app_cpe_rest_offers
      (owner_id, kind, offered_date, wanted_date, status)
    values (v_owner, 'swap', current_date + 100 + v_count,
      current_date + 200 + v_count, 'cancelled');
  end loop;
  begin
    insert into public.app_cpe_rest_offers
      (owner_id, kind, offered_date, wanted_date, status)
    values (v_owner, 'swap', current_date + 131, current_date + 231, 'cancelled');
    raise exception 'Daily limit did not reject publication 31';
  exception when raise_exception then
    if sqlerrm not like 'Has alcanzado el límite de 30 publicaciones de descansos en 24 horas.%' then
      raise;
    end if;
  end;
end;
$test$;
rollback;
select 'PASS: 30 consecutive offers accepted; offer 31 rejected; all fixtures rolled back' as result;
