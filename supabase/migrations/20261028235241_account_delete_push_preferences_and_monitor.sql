-- A user's decision to stop mobile push must survive page reloads and sign-in.
alter table public.app_cpe_users add column if not exists push_opted_out_at timestamptz;

create or replace function public.app_cpe_push_preference(p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  return v_user.push_opted_out_at is null;
end $$;

create or replace function public.app_cpe_push_set_preference(p_token text, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_enabled is null then raise exception 'Opción de notificaciones no válida'; end if;
  update public.app_cpe_users
    set push_opted_out_at = case when p_enabled then null else now() end
    where id = v_user.id;
  if not p_enabled then
    update private.app_cpe_push_subscriptions
      set disabled_at=now(), disabled_reason='user_opt_out', updated_at=now()
      where user_id=v_user.id and disabled_at is null;
    update private.app_cpe_push_deliveries d
      set state='failed', updated_at=now()
      from private.app_cpe_push_subscriptions s
      where d.subscription_id=s.id and s.user_id=v_user.id
        and d.state in ('pending','processing');
  end if;
  return true;
end $$;

create or replace function public.app_cpe_push_subscribe(p_token text,p_subscription jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_endpoint text; v_p256dh text; v_auth text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if v_user.push_opted_out_at is not null then raise exception 'Notificaciones desactivadas por el usuario'; end if;
  v_endpoint := p_subscription->>'endpoint';
  v_p256dh := p_subscription->'keys'->>'p256dh';
  v_auth := p_subscription->'keys'->>'auth';
  if length(coalesce(v_endpoint,'')) not between 20 and 2048
    or v_endpoint !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com|webpush[.]push[.]apple[.]com|[a-z0-9-]+[.]notify[.]windows[.]com)/'
    or length(coalesce(v_p256dh,'')) not between 80 and 200
    or length(coalesce(v_auth,'')) not between 16 and 100 then
    raise exception 'Suscripción push no válida';
  end if;
  insert into private.app_cpe_push_subscriptions(user_id,endpoint,p256dh,auth)
  values (v_user.id,v_endpoint,v_p256dh,v_auth)
  on conflict(endpoint) do update set
    user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,
    activated_at=case when private.app_cpe_push_subscriptions.disabled_at is not null
      then now() else private.app_cpe_push_subscriptions.activated_at end,
    disabled_at=null,disabled_reason=null,updated_at=now();
  return true;
end $$;

revoke all on function public.app_cpe_push_preference(text) from public,anon,authenticated;
grant execute on function public.app_cpe_push_preference(text) to anon,authenticated;
revoke all on function public.app_cpe_push_set_preference(text,boolean) from public,anon,authenticated;
grant execute on function public.app_cpe_push_set_preference(text,boolean) to anon,authenticated;

create table private.app_cpe_notification_opens (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.app_cpe_user_notifications(id) on delete cascade,
  source text not null check (source in ('push','app')),
  opened_at timestamptz not null default now()
);
create index on private.app_cpe_notification_opens(notification_id,opened_at desc);
revoke all on private.app_cpe_notification_opens from public,anon,authenticated;

create function public.app_cpe_record_notification_open(
  p_token text,p_notification_id uuid,p_source text default 'app'
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  if p_source not in ('push','app') then raise exception 'Origen no válido'; end if;
  if not exists(select 1 from public.app_cpe_user_notifications
    where id=p_notification_id and user_id=v_user.id) then
    raise exception 'Aviso no encontrado';
  end if;
  insert into private.app_cpe_notification_opens(notification_id,source)
    values(p_notification_id,p_source);
  return true;
end $$;
revoke all on function public.app_cpe_record_notification_open(text,uuid,text) from public,anon,authenticated;
grant execute on function public.app_cpe_record_notification_open(text,uuid,text) to anon,authenticated;

create function public.app_cpe_admin_push_delivery_monitor(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_admin public.app_cpe_users; v_rows jsonb;
begin
  v_admin := public.app_cpe_user_from_token(p_token);
  if v_admin.chapa is distinct from '72683' then raise exception 'Acceso de administrador requerido'; end if;
  select coalesce(jsonb_agg(to_jsonb(row) order by row.updated_at desc),'[]'::jsonb)
    into v_rows from (
      select d.id, n.chapa, n.title, n.event_type, d.state, d.attempts,
        d.updated_at, o.opened_at, o.source as opened_source
      from private.app_cpe_push_deliveries d
      join public.app_cpe_user_notifications n on n.id=d.notification_id
      left join lateral (
        select opened_at,source from private.app_cpe_notification_opens
        where notification_id=n.id order by opened_at desc limit 1
      ) o on true
      order by d.updated_at desc limit 100
    ) row;
  return jsonb_build_object('rows',v_rows);
end $$;
revoke all on function public.app_cpe_admin_push_delivery_monitor(text) from public,anon,authenticated;
grant execute on function public.app_cpe_admin_push_delivery_monitor(text) to anon,authenticated;

-- Extend the existing password-confirmed account deletion to data introduced
-- after that function was first created. Foreign-key cascades remove the rest.
create or replace function public.app_cpe_delete_account(
  p_token text,p_current_password text,p_confirmation text
) returns jsonb language plpgsql security definer
set search_path = public, private, vault, extensions, pg_catalog, pg_temp as $$
declare
  v_user public.app_cpe_users;
  v_password_secret_id uuid;
  v_security_secret_id uuid;
begin
  v_user := public.app_cpe_user_from_token(p_token);
  select u.* into v_user from public.app_cpe_users u where u.id=v_user.id for update;
  if v_user.password_hash <> crypt(coalesce(p_current_password,''),v_user.password_hash) then
    raise exception 'La contraseña actual no es correcta';
  end if;
  if upper(trim(coalesce(p_confirmation,''))) <> 'ELIMINAR' then
    raise exception 'Escribe ELIMINAR para confirmar la baja definitiva';
  end if;
  select portal_password_secret_id,security_key_secret_id
    into v_password_secret_id,v_security_secret_id
    from public.app_cpe_portal_auto_sync where chapa=v_user.chapa;

  delete from cpe_mobile_private.personal_items where chapa=v_user.chapa;
  delete from private.app_cpe_initial_paid_days where chapa=v_user.chapa;
  delete from private.app_cpe_noray_link_audit where chapa=v_user.chapa;
  delete from public.app_cpe_bolsa_name_scan_jobs where chapa=v_user.chapa;
  delete from public.app_cpe_usage_events where chapa=v_user.chapa;
  update cpe_mobile_private.personal_runs set current_chapa=null where current_chapa=v_user.chapa;
  update private.app_cpe_personal_sync_runs set current_chapa=null where current_chapa=v_user.chapa;
  delete from public.app_cpe_users where id=v_user.id;
  delete from vault.secrets where id in (v_password_secret_id,v_security_secret_id);
  return jsonb_build_object('ok',true,'deleted',true);
end $$;
