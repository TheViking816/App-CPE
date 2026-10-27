create function public.app_cpe_admin_push_activation_monitor(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin public.app_cpe_users; v_users jsonb; v_total integer;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa is distinct from '72683' then
    raise exception 'Acceso de administrador requerido';
  end if;

  select count(*) into v_total from (
    select user_id from private.app_cpe_push_subscriptions group by user_id
  ) active_users;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.activated_at desc), '[]'::jsonb)
    into v_users from (
      select u.chapa, u.display_name, min(s.created_at) as activated_at,
        max(s.updated_at) as last_confirmed_at, count(*)::integer as devices
      from private.app_cpe_push_subscriptions s
      join public.app_cpe_users u on u.id=s.user_id
      group by u.id,u.chapa,u.display_name
      order by min(s.created_at) desc
      limit 200
    ) item;

  return jsonb_build_object('total',v_total,'users',v_users);
end $$;

revoke all on function public.app_cpe_admin_push_activation_monitor(text) from public, anon, authenticated;
grant execute on function public.app_cpe_admin_push_activation_monitor(text) to anon, authenticated;
