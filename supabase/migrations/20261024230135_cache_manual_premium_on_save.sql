-- Cache a premium when its owner saves it, before another edit can change it.
create or replace function private.app_cpe_cache_manual_premium(p_row private.app_cpe_manual_jornales)
returns void language plpgsql set search_path = '' as $$
declare v_details jsonb; v_part text; v_vessel text; v_identity text;
begin
  if p_row.premium is null or p_row.premium <= 0
    or p_row.notes not like 'APP_CPE_MANUAL_V1:%' then return; end if;
  v_details := substring(p_row.notes from length('APP_CPE_MANUAL_V1:') + 1)::jsonb;
  if coalesce(v_details->>'premiumKnown','true') = 'false' then return; end if;
  v_part := nullif(btrim(v_details->>'part'),'');
  v_vessel := private.app_cpe_premium_identity(v_details->>'vessel');
  if v_part is null and v_vessel = '' then return; end if;
  v_identity := concat_ws('|', p_row.work_date::text,
    regexp_replace(p_row.shift,'[^0-9]','','g'),
    private.app_cpe_premium_identity(p_row.specialty),
    case when v_part is not null then 'P:' || v_part else 'B:' || v_vessel end);
  insert into private.app_cpe_shared_premium_values(identity_key, amount)
    values(v_identity, p_row.premium) on conflict (identity_key) do nothing;
end $$;

create or replace function private.app_cpe_cache_manual_premium_trigger()
returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then
    perform private.app_cpe_cache_manual_premium(OLD);
  end if;
  perform private.app_cpe_cache_manual_premium(NEW);
  return NEW;
end $$;

create trigger app_cpe_cache_manual_premium_on_save
  after insert or update on private.app_cpe_manual_jornales
  for each row execute function private.app_cpe_cache_manual_premium_trigger();

-- Existing unanimous premiums can be cached without changing any journal.
with source_rows as (
  select concat_ws('|', j.work_date::text, regexp_replace(j.shift,'[^0-9]','','g'),
    private.app_cpe_premium_identity(j.specialty),
    case when nullif(btrim(meta.details->>'part'),'') is not null
      then 'P:' || btrim(meta.details->>'part')
      else 'B:' || private.app_cpe_premium_identity(meta.details->>'vessel') end) as identity_key,
    j.premium as amount
  from private.app_cpe_manual_jornales j
  cross join lateral (
    select substring(j.notes from length('APP_CPE_MANUAL_V1:') + 1)::jsonb as details
  ) meta
  where j.notes like 'APP_CPE_MANUAL_V1:%' and j.premium > 0
    and coalesce(meta.details->>'premiumKnown','true') <> 'false'
    and (nullif(btrim(meta.details->>'part'),'') is not null
      or private.app_cpe_premium_identity(meta.details->>'vessel') <> '')
), unanimous as (
  select identity_key, max(amount) as amount from source_rows
  group by identity_key having min(amount) = max(amount)
)
insert into private.app_cpe_shared_premium_values(identity_key,amount)
select identity_key, amount from unanimous
on conflict (identity_key) do nothing;
