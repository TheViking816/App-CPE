create table if not exists public.app_cpe_chapero_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null default 'latest',
  source text,
  page_date text,
  jornada_text text,
  jornada_date text,
  from_hour text,
  to_hour text,
  shift_key text,
  summary jsonb not null default '{}'::jsonb,
  workers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists app_cpe_chapero_snapshots_key_uidx
  on public.app_cpe_chapero_snapshots (snapshot_key);

create index if not exists app_cpe_chapero_snapshots_updated_idx
  on public.app_cpe_chapero_snapshots (updated_at desc);

alter table public.app_cpe_chapero_snapshots enable row level security;

drop policy if exists "App CPE chapero snapshots are publicly readable" on public.app_cpe_chapero_snapshots;
create policy "App CPE chapero snapshots are publicly readable"
  on public.app_cpe_chapero_snapshots
  for select
  to anon, authenticated
  using (true);

grant select on public.app_cpe_chapero_snapshots to anon, authenticated;
