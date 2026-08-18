alter table public.app_cpe_activation_email_outbox
  drop constraint if exists app_cpe_activation_email_outbox_status_check;

alter table public.app_cpe_activation_email_outbox
  add constraint app_cpe_activation_email_outbox_status_check
  check (status in ('pending', 'processing', 'sent', 'failed'));
