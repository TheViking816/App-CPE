create or replace function public.app_cpe_push_subscribe(p_token text,p_subscription jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_user public.app_cpe_users; v_endpoint text; v_p256dh text; v_auth text;
begin
  v_user := public.app_cpe_user_from_token(p_token);
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
  on conflict(endpoint) do update set user_id=excluded.user_id,p256dh=excluded.p256dh,
    auth=excluded.auth,updated_at=now();
  return true;
end $$;
