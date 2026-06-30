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
values (
  'CONDUCTOR 1a',
  'seed',
  '[
    {"key":"LAB","label":"LAB","raw":72625,"turn":"Laborable"},
    {"key":"NOC","label":"NOC","raw":72699,"turn":"Laborable super/noche"},
    {"key":"LAB-SIG","label":"LAB SIG.","raw":72625,"turn":"Laborable siguiente dia"},
    {"key":"POL-LAB","label":"POL LAB","raw":72546,"turn":"Polivalencia laborable"},
    {"key":"POL-NOC","label":"POL NOC","raw":71197,"turn":"Polivalencia super/noche"},
    {"key":"POL-LAB-SIG","label":"POL SIG.","raw":71558,"turn":"Polivalencia siguiente dia"},
    {"key":"NOC-FES","label":"NOC-FES","raw":72737,"turn":"Festivo super/noche"},
    {"key":"FES","label":"FES","raw":72541,"turn":"Festivo diurno"},
    {"key":"POL-NOC-FES","label":"POL NOC-FES","raw":63186,"turn":"Festivo polivalencia super"},
    {"key":"POL-FES","label":"POL FES","raw":71488,"turn":"Festivo polivalencia diurno"}
  ]'::jsonb,
  '{
    "labHoy": 72625,
    "super": 72699,
    "labSigDia": 72625,
    "polivalenciaLabHoy": 72546,
    "polivalenciaSuper": 71197,
    "polivalenciaLabSigDia": 71558,
    "festivoSuper": 72737,
    "festivoDiurno": 72541,
    "festivoPolivalenciaSuper": 63186,
    "festivoPolivalenciaDiurno": 71488
  }'::jsonb,
  '2026-06-30T11:32:28.672Z'::timestamptz
)
where not exists (
  select 1
  from public.app_cpe_door_snapshots
  where specialty = 'CONDUCTOR 1a'
);
