create table if not exists public.app_cpe_door_snapshots (
  id uuid primary key default gen_random_uuid(),
  specialty text not null,
  source text,
  doors jsonb not null,
  raw_columns jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists app_cpe_door_snapshots_specialty_updated_idx
  on public.app_cpe_door_snapshots (specialty, updated_at desc);

alter table public.app_cpe_door_snapshots enable row level security;

drop policy if exists "App CPE door snapshots are publicly readable" on public.app_cpe_door_snapshots;
create policy "App CPE door snapshots are publicly readable"
  on public.app_cpe_door_snapshots
  for select
  to anon, authenticated
  using (true);

grant select on public.app_cpe_door_snapshots to anon, authenticated;

insert into public.app_cpe_door_snapshots (specialty, source, doors, raw_columns, updated_at)
select
  'CONDUCTOR 1a',
  'seed',
  '[
    {"key":"LAB","label":"Diurna","raw":72625,"dayType":"laborable","shift":"LAB"},
    {"key":"NOC","label":"Super","raw":72699,"dayType":"laborable","shift":"NOC"},
    {"key":"NOC-FES","label":"Super festiva","raw":72737,"dayType":"festivo","shift":"NOC-FES"},
    {"key":"FES","label":"Diurna festiva","raw":72541,"dayType":"festivo","shift":"FES"}
  ]'::jsonb,
  '{
    "labHoy": 72625,
    "super": 72699,
    "labSigDia": 72625,
    "rawCol4": 72546,
    "rawCol5": 71197,
    "rawCol6": 71558,
    "festivoSuper": 72737,
    "festivoDiurno": 72541,
    "rawCol9": 63186,
    "rawCol10": 71488
  }'::jsonb,
  '2026-06-30T11:32:28.672Z'::timestamptz
where not exists (
  select 1
  from public.app_cpe_door_snapshots
  where specialty = 'CONDUCTOR 1a'
);
