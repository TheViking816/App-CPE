create or replace function public.app_cpe_get_notifications(
  p_token text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_rows jsonb;
  v_unread integer;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select coalesce(jsonb_agg(to_jsonb(items) order by items."createdAt" desc), '[]'::jsonb)
    into v_rows
    from (
      select
        n.id,
        n.event_type as "eventType",
        n.title,
        n.body,
        n.entity_key as "entityKey",
        n.target_tab as "targetTab",
        n.metadata,
        n.read_at as "readAt",
        n.created_at as "createdAt"
      from public.app_cpe_user_notifications n
      where n.user_id = v_user.id
      order by n.created_at desc
      limit greatest(1, least(coalesce(p_limit, 100), 100))
    ) items;

  select count(*)::integer
    into v_unread
    from public.app_cpe_user_notifications n
   where n.user_id = v_user.id
     and n.read_at is null;

  return jsonb_build_object('ok', true, 'unread', v_unread, 'rows', v_rows);
end;
$$;

revoke all on function public.app_cpe_get_notifications(text, integer) from public;
grant execute on function public.app_cpe_get_notifications(text, integer) to anon, authenticated;
