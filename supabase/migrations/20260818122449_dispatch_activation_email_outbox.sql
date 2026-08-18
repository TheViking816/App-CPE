create or replace function private.app_cpe_dispatch_activation_email()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions, pg_temp
as $$
begin
  perform net.http_post(
    url := 'https://portalestiba-push-backend-one.vercel.app/api/push/notify-new-hire',
    body := jsonb_build_object('app_cpe_activation_emails', true),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );
  return new;
end;
$$;

drop trigger if exists app_cpe_dispatch_activation_email on public.app_cpe_activation_email_outbox;
create trigger app_cpe_dispatch_activation_email
after insert on public.app_cpe_activation_email_outbox
for each statement execute function private.app_cpe_dispatch_activation_email();
