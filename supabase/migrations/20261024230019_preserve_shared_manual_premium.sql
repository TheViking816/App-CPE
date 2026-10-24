-- Preserve the first unambiguous shared premium for each journal identity.
create table private.app_cpe_shared_premium_values (
  identity_key text primary key,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

alter table private.app_cpe_shared_premium_values enable row level security;
revoke all on private.app_cpe_shared_premium_values from public, anon, authenticated;

create or replace function public.app_cpe_get_shared_manual_premiums(p_requests jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if jsonb_typeof(p_requests) <> 'array' or jsonb_array_length(p_requests) < 1
    or jsonb_array_length(p_requests) > 250 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  with requested as (
    select ordinality::int as request_id,
      value->>'fecha' as fecha, regexp_replace(coalesce(value->>'jornada',''), '[^0-9]', '', 'g') as jornada,
      nullif(btrim(value->>'parte'), '') as parte,
      btrim(value->>'chapa') as target_chapa,
      private.app_cpe_premium_identity(value->>'puesto') as puesto,
      private.app_cpe_premium_identity(value->>'buque') as buque,
      private.app_cpe_premium_identity(value->>'empresa') as empresa
    from jsonb_array_elements(p_requests) with ordinality as input(value, ordinality)
    where coalesce(value->>'fecha','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
  ), keyed as (
    select *, concat_ws('|', fecha, jornada, puesto,
      case when parte is not null then 'P:' || parte else 'B:' || buque end) as identity_key
    from requested where puesto <> '' and jornada ~ '^[0-9]{4}$'
      and (parte is not null or buque <> '')
  ), manual_sources as (
    select j.work_date::text as fecha, regexp_replace(j.shift,'[^0-9]','','g') as jornada,
      nullif(btrim(meta.details->>'part'),'') as parte,
      private.app_cpe_premium_identity(j.specialty) as puesto,
      private.app_cpe_premium_identity(meta.details->>'vessel') as buque,
      private.app_cpe_premium_identity(meta.details->>'company') as empresa,
      j.premium as amount, u.chapa as source_chapa
    from private.app_cpe_manual_jornales j
    join public.app_cpe_users u on u.id=j.user_id
    cross join lateral (
      select case when j.notes like 'APP_CPE_MANUAL_V1:%'
        then substring(j.notes from length('APP_CPE_MANUAL_V1:') + 1)::jsonb
        else '{}'::jsonb end as details
    ) meta
    where j.premium > 0 and coalesce(meta.details->>'premiumKnown','true') <> 'false'
  ), historic_sources as (
    select split_part(p.jornal_key,'|',1) as fecha,
      regexp_replace(split_part(p.jornal_key,'|',4),'[^0-9]','','g') as jornada,
      nullif(split_part(p.jornal_key,'|',2),'SIN-PARTE') as parte,
      private.app_cpe_premium_identity(coalesce(jornal.value->>'especialidad', split_part(p.jornal_key,'|',5))) as puesto,
      private.app_cpe_premium_identity(jornal.value->>'buque') as buque,
      private.app_cpe_premium_identity(jornal.value->>'empresa') as empresa,
      p.amount, u.chapa as source_chapa
    from private.app_cpe_manual_premiums p
    join public.app_cpe_users u on u.id=p.user_id
    left join public.app_cpe_portal_snapshots s on s.chapa=u.chapa
    left join lateral (
      select row.value
      from jsonb_array_elements(coalesce(s.payload #> '{jornales,history}','[]'::jsonb)) period(value)
      cross join lateral jsonb_array_elements(coalesce(period.value->'rows','[]'::jsonb)) row(value)
      where (period.value->>'year') = left(p.jornal_key,4)
        and lpad(coalesce(period.value->>'month',''),2,'0') = substr(p.jornal_key,6,2)
        and lpad(coalesce(row.value->>'dia',''),2,'0') = substr(p.jornal_key,9,2)
        and regexp_replace(coalesce(row.value->>'jornada',''),'[^0-9]','','g')
          = regexp_replace(split_part(p.jornal_key,'|',4),'[^0-9]','','g')
        and private.app_cpe_premium_identity(row.value->>'especialidad')
          = private.app_cpe_premium_identity(split_part(p.jornal_key,'|',5))
        and (split_part(p.jornal_key,'|',2) = 'SIN-PARTE'
          or private.app_cpe_premium_identity(row.value->>'parte')
            = private.app_cpe_premium_identity(split_part(p.jornal_key,'|',2)))
      limit 1
    ) jornal on true
    where p.amount > 0 and jornal.value is not null
      and p.jornal_key ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}[|]'
  ), sources as (
    select * from manual_sources union all select * from historic_sources
  ), matches as (
    select r.request_id, r.identity_key, r.parte, r.fecha, r.jornada,
      s.amount, s.source_chapa,
      case when r.parte is not null and s.parte is not null and r.parte=s.parte then 2 else 1 end as priority
    from keyed r join sources s on s.fecha=r.fecha and s.jornada=r.jornada and s.puesto=r.puesto
    where (r.parte is not null and s.parte is not null and r.parte=s.parte)
      or ((r.parte is null or s.parte is null) and r.buque <> '' and s.buque=r.buque)
  ), best_priority as (
    select *, max(priority) over(partition by request_id) as best from matches
  ), consensus as (
    select request_id, max(identity_key) as identity_key, max(amount) as amount
    from best_priority where priority=best
    group by request_id having min(amount)=max(amount)
  ), inserted as (
    insert into private.app_cpe_shared_premium_values (identity_key, amount)
    select identity_key, max(amount) from consensus
    group by identity_key having min(amount)=max(amount)
    on conflict (identity_key) do nothing
    returning identity_key, amount
  ), own_values as (
    select m.request_id, max(m.amount) as amount
    from matches m join keyed r on r.request_id=m.request_id
    where r.target_chapa <> '' and m.source_chapa=r.target_chapa
    group by m.request_id having min(m.amount)=max(m.amount)
  ), resolved as (
    select r.request_id, r.parte, r.fecha, r.jornada,
      coalesce(o.amount, saved.amount, fresh.amount, c.amount) as amount
    from keyed r
    left join own_values o on o.request_id=r.request_id
    left join private.app_cpe_shared_premium_values saved on saved.identity_key=r.identity_key
    left join inserted fresh on fresh.identity_key=r.identity_key
    left join consensus c on c.request_id=r.request_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'request_id', request_id, 'parte', parte, 'fecha', fecha, 'jornada', jornada,
    'produccion', amount, 'verification', 'pending', 'origin', 'app_cpe_manual'
  ) order by request_id),'[]'::jsonb) into v_result
  from resolved where amount is not null;
  return jsonb_build_object('ok', true, 'premiums', v_result);
end $$;

revoke all on function public.app_cpe_get_shared_manual_premiums(jsonb) from public, anon, authenticated;
grant execute on function public.app_cpe_get_shared_manual_premiums(jsonb) to service_role;
