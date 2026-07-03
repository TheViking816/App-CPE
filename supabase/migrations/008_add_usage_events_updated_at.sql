alter table public.app_cpe_usage_events
  add column if not exists updated_at timestamptz;

update public.app_cpe_usage_events
set updated_at = created_at
where updated_at is null;

alter table public.app_cpe_usage_events
  alter column updated_at set default now(),
  alter column updated_at set not null;

create index if not exists app_cpe_usage_events_updated_idx
  on public.app_cpe_usage_events (updated_at desc);
