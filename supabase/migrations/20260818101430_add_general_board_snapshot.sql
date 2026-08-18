create table if not exists public.app_cpe_general_board_snapshot (
  id text primary key check (id = 'latest'),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_cpe_general_board_snapshot enable row level security;

revoke all on table public.app_cpe_general_board_snapshot from anon, authenticated;
grant select on table public.app_cpe_general_board_snapshot to anon, authenticated;
grant select, insert, update, delete on table public.app_cpe_general_board_snapshot to service_role;

drop policy if exists "App CPE general board is publicly readable" on public.app_cpe_general_board_snapshot;
create policy "App CPE general board is publicly readable"
on public.app_cpe_general_board_snapshot
for select
to anon, authenticated
using (id = 'latest');
