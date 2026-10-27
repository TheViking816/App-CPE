select cron.schedule('app-cpe-web-push', '* * * * *', $job$
  select net.http_post(
    url := 'https://wvwdiywtlbffumshbboa.supabase.co/functions/v1/app-cpe-web-push',
    headers := jsonb_build_object('Content-Type','application/json','x-cpe-push-token',
      (select dispatch_token from private.app_cpe_push_config where id=true)),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
$job$);
