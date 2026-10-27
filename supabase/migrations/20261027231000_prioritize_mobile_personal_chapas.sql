-- Process these active linked accounts first in salary, rest/vacation and parts reads.
-- The remaining accounts keep their chapa order. No run is started here.
create or replace function public.app_cpe_mobile_personal_next(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item cpe_mobile_private.personal_items; v_link private.app_cpe_manual_noray_section_links;
begin
  if not exists(select 1 from cpe_mobile_private.personal_runs where id=p_run_id and status='running')
    then raise exception 'Lectura móvil no disponible'; end if;
  if exists(select 1 from private.app_cpe_personal_sync_runs where status='running')
    then raise exception 'La sincronización del PC está en curso'; end if;
  if exists(select 1 from cpe_mobile_private.personal_items where run_id=p_run_id and status='running')
    then raise exception 'La cuenta anterior no se ha guardado'; end if;
  select * into v_item from cpe_mobile_private.personal_items
    where run_id=p_run_id and status='pending'
    order by coalesce(array_position(array['72663','72766','72774','72778','72782','72775','72760']::text[],chapa),8),chapa
    for update skip locked limit 1;
  if v_item.chapa is null then
    update cpe_mobile_private.personal_runs set status='completed',finished_at=now(),current_chapa=null,
      message='Lectura finalizada' where id=p_run_id;
    return null;
  end if;
  select * into v_link from private.app_cpe_manual_noray_section_links
    where chapa=v_item.chapa and section='vacaciones';
  if v_link.chapa is null then raise exception 'Enlace personal no disponible'; end if;
  update cpe_mobile_private.personal_items set status='running' where run_id=p_run_id and chapa=v_item.chapa;
  update cpe_mobile_private.personal_runs set current_chapa=v_item.chapa where id=p_run_id;
  return jsonb_build_object('chapa',v_item.chapa,'rec',v_link.registro,'pwd',v_link.password_hash);
end; $$;

create or replace function public.app_cpe_mobile_upcoming_accounts(p_chapa text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(case when p_chapa is null then jsonb_build_object('chapa',u.chapa)
    else jsonb_build_object('chapa',u.chapa,'rec',l.registro,'pwd',l.password_hash) end
    order by coalesce(array_position(array['72663','72766','72774','72778','72782','72775','72760']::text[],u.chapa),8),u.chapa),'[]'::jsonb)
  from public.app_cpe_users u
  cross join lateral (
    select x.registro,x.password_hash from private.app_cpe_manual_noray_section_links x
    where x.chapa=u.chapa and x.registro ~ '^[1-9][0-9]{0,9}$' and x.password_hash ~ '^[a-fA-F0-9]{64}$'
    order by case when x.section='jornales' then 0 when x.section='vacaciones' then 1 else 2 end,x.section limit 1
  ) l
  where u.portal_activation_status='active' and (p_chapa is null or u.chapa=p_chapa)
    and greatest(u.created_at,coalesce((select max(s.last_seen_at) from public.app_cpe_sessions s
      where s.user_id=u.id and not coalesce(s.is_support,false)),'-infinity'::timestamptz)) >= now()-interval '7 days';
$$;
