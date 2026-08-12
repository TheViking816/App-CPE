create table if not exists public.app_cpe_payroll_holidays (
  holiday_date date primary key,
  name text not null,
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_cpe_payroll_holidays_not_sunday
    check (extract(isodow from holiday_date) <> 7)
);

create table if not exists public.app_cpe_payroll_rates (
  operation_type text not null,
  worker_group text not null,
  rate_key text not null,
  shift_key text not null,
  amount numeric(10, 2),
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (operation_type, worker_group, rate_key, shift_key),
  constraint app_cpe_payroll_rates_operation
    check (operation_type in ('ESTIBA', 'RECEPCION_ENTREGA')),
  constraint app_cpe_payroll_rates_group
    check (worker_group in ('I', 'II', 'III', 'IV')),
  constraint app_cpe_payroll_rates_kind
    check (rate_key in (
      'LABORABLE',
      'SABADO',
      'FESTIVO',
      'FESTIVO_TO_LABORABLE',
      'FESTIVO_TO_FESTIVO',
      'LABORABLE_TO_FESTIVO'
    )),
  constraint app_cpe_payroll_rates_shift
    check (shift_key in ('02-08', '08-14', '14-20', '20-02'))
);

create table if not exists public.app_cpe_specialty_complements (
  specialty_key text primary key,
  specialty_name text not null,
  amount numeric(10, 2),
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_cpe_payroll_holidays enable row level security;
alter table public.app_cpe_payroll_rates enable row level security;
alter table public.app_cpe_specialty_complements enable row level security;

create policy "Public can read payroll holidays"
  on public.app_cpe_payroll_holidays for select
  to anon, authenticated
  using (true);

create policy "Public can read payroll rates"
  on public.app_cpe_payroll_rates for select
  to anon, authenticated
  using (true);

create policy "Public can read specialty complements"
  on public.app_cpe_specialty_complements for select
  to anon, authenticated
  using (true);

revoke all on table public.app_cpe_payroll_holidays from anon, authenticated;
revoke all on table public.app_cpe_payroll_rates from anon, authenticated;
revoke all on table public.app_cpe_specialty_complements from anon, authenticated;
grant select on table public.app_cpe_payroll_holidays to anon, authenticated;
grant select on table public.app_cpe_payroll_rates to anon, authenticated;
grant select on table public.app_cpe_specialty_complements to anon, authenticated;
grant all on table public.app_cpe_payroll_holidays to service_role;
grant all on table public.app_cpe_payroll_rates to service_role;
grant all on table public.app_cpe_specialty_complements to service_role;

insert into public.app_cpe_payroll_holidays (holiday_date, name)
values
  ('2026-01-01', 'Ano Nuevo'),
  ('2026-01-06', 'Epifania del Senor'),
  ('2026-01-22', 'San Vicente Martir'),
  ('2026-03-19', 'San Jose'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-04-06', 'Lunes de Pascua'),
  ('2026-04-13', 'San Vicente Ferrer'),
  ('2026-05-01', 'Fiesta del Trabajo'),
  ('2026-06-24', 'San Juan'),
  ('2026-07-16', 'Virgen del Carmen'),
  ('2026-08-15', 'Asuncion de la Virgen'),
  ('2026-10-09', 'Dia de la Comunitat Valenciana'),
  ('2026-10-12', 'Fiesta Nacional de Espana'),
  ('2026-12-08', 'Inmaculada Concepcion'),
  ('2026-12-25', 'Navidad')
on conflict (holiday_date) do update
set name = excluded.name;

insert into public.app_cpe_specialty_complements (specialty_key, specialty_name, amount)
values
  ('CONDUCTOR_1A', 'Conductor 1a', 7.38),
  ('CONDUCTOR_2A', 'Conductor 2a', 6.94),
  ('TRINCADOR', 'Trincador', 48.21),
  ('TRASTAINERS_RTT', 'Trastainers RTT', null),
  ('ESPECIALISTA', 'Especialista', null),
  ('TRINCA_COCHES', 'Trinca coches', null),
  ('CAPATAZ', 'Capataz', null),
  ('SOBORDISTA', 'Sobordista', null),
  ('CLASIFICADOR', 'Clasificador', null),
  ('GRUAS', 'Gruas', null)
on conflict (specialty_key) do update
set specialty_name = excluded.specialty_name,
    amount = coalesce(public.app_cpe_specialty_complements.amount, excluded.amount);

insert into public.app_cpe_payroll_rates
  (operation_type, worker_group, rate_key, shift_key, amount)
values
  ('ESTIBA', 'I', 'LABORABLE', '02-08', 216.19),
  ('ESTIBA', 'I', 'LABORABLE', '08-14', 102.19),
  ('ESTIBA', 'I', 'LABORABLE', '14-20', 102.19),
  ('ESTIBA', 'I', 'LABORABLE', '20-02', 153.32),
  ('ESTIBA', 'I', 'SABADO', '02-08', 216.19),
  ('ESTIBA', 'I', 'SABADO', '08-14', 118.66),
  ('ESTIBA', 'I', 'SABADO', '14-20', 183.96),
  ('ESTIBA', 'I', 'SABADO', '20-02', 270.55),
  ('ESTIBA', 'I', 'FESTIVO', '02-08', 389.23),
  ('ESTIBA', 'I', 'FESTIVO', '08-14', 183.96),
  ('ESTIBA', 'I', 'FESTIVO', '14-20', 260.5),
  ('ESTIBA', 'I', 'FESTIVO', '20-02', 350.68),
  ('ESTIBA', 'I', 'FESTIVO_TO_LABORABLE', '02-08', 247.72),
  ('ESTIBA', 'I', 'FESTIVO_TO_LABORABLE', '20-02', 310.65),
  ('ESTIBA', 'I', 'FESTIVO_TO_FESTIVO', '02-08', 424.44),
  ('ESTIBA', 'I', 'FESTIVO_TO_FESTIVO', '20-02', 350.68),
  ('ESTIBA', 'I', 'LABORABLE_TO_FESTIVO', '20-02', 194.16),
  ('ESTIBA', 'II', 'LABORABLE', '02-08', 223.27),
  ('ESTIBA', 'II', 'LABORABLE', '08-14', 105.53),
  ('ESTIBA', 'II', 'LABORABLE', '14-20', 105.53),
  ('ESTIBA', 'II', 'LABORABLE', '20-02', 158.36),
  ('ESTIBA', 'II', 'SABADO', '02-08', 223.27),
  ('ESTIBA', 'II', 'SABADO', '08-14', 122.02),
  ('ESTIBA', 'II', 'SABADO', '14-20', 189.98),
  ('ESTIBA', 'II', 'SABADO', '20-02', 279.42),
  ('ESTIBA', 'II', 'FESTIVO', '02-08', 401.99),
  ('ESTIBA', 'II', 'FESTIVO', '08-14', 189.98),
  ('ESTIBA', 'II', 'FESTIVO', '14-20', 269.05),
  ('ESTIBA', 'II', 'FESTIVO', '20-02', 362.16),
  ('ESTIBA', 'II', 'FESTIVO_TO_LABORABLE', '02-08', 261.16),
  ('ESTIBA', 'II', 'FESTIVO_TO_LABORABLE', '20-02', 320.77),
  ('ESTIBA', 'II', 'FESTIVO_TO_FESTIVO', '02-08', 438.26),
  ('ESTIBA', 'II', 'FESTIVO_TO_FESTIVO', '20-02', 362.16),
  ('ESTIBA', 'II', 'LABORABLE_TO_FESTIVO', '20-02', 200.51),
  ('ESTIBA', 'III', 'LABORABLE', '02-08', 225.82),
  ('ESTIBA', 'III', 'LABORABLE', '08-14', 106.56),
  ('ESTIBA', 'III', 'LABORABLE', '14-20', 106.56),
  ('ESTIBA', 'III', 'LABORABLE', '20-02', 159.91),
  ('ESTIBA', 'III', 'SABADO', '02-08', 225.82),
  ('ESTIBA', 'III', 'SABADO', '08-14', 131.81),
  ('ESTIBA', 'III', 'SABADO', '14-20', 191.77),
  ('ESTIBA', 'III', 'SABADO', '20-02', 282.1),
  ('ESTIBA', 'III', 'FESTIVO', '02-08', 405.86),
  ('ESTIBA', 'III', 'FESTIVO', '08-14', 191.66),
  ('ESTIBA', 'III', 'FESTIVO', '14-20', 271.51),
  ('ESTIBA', 'III', 'FESTIVO', '20-02', 365.52),
  ('ESTIBA', 'III', 'FESTIVO_TO_LABORABLE', '02-08', 269.62),
  ('ESTIBA', 'III', 'FESTIVO_TO_LABORABLE', '20-02', 323.86),
  ('ESTIBA', 'III', 'FESTIVO_TO_FESTIVO', '20-02', 365.62),
  ('ESTIBA', 'III', 'LABORABLE_TO_FESTIVO', '20-02', 159.91),
  ('ESTIBA', 'IV', 'LABORABLE', '02-08', 238.98),
  ('ESTIBA', 'IV', 'LABORABLE', '08-14', 122.17),
  ('ESTIBA', 'IV', 'LABORABLE', '14-20', 122.17),
  ('ESTIBA', 'IV', 'LABORABLE', '20-02', 169.25),
  ('ESTIBA', 'IV', 'SABADO', '02-08', 238.98),
  ('ESTIBA', 'IV', 'SABADO', '08-14', 138.49),
  ('ESTIBA', 'IV', 'SABADO', '14-20', 203),
  ('ESTIBA', 'IV', 'SABADO', '20-02', 298.55),
  ('ESTIBA', 'IV', 'FESTIVO', '02-08', 429.56),
  ('ESTIBA', 'IV', 'FESTIVO', '08-14', 202.88),
  ('ESTIBA', 'IV', 'FESTIVO', '14-20', 287.36),
  ('ESTIBA', 'IV', 'FESTIVO', '20-02', 386.88),
  ('ESTIBA', 'IV', 'FESTIVO_TO_LABORABLE', '02-08', 294.81),
  ('ESTIBA', 'IV', 'FESTIVO_TO_LABORABLE', '20-02', 342.76),
  ('ESTIBA', 'IV', 'FESTIVO_TO_FESTIVO', '20-02', 386.98),
  ('ESTIBA', 'IV', 'LABORABLE_TO_FESTIVO', '20-02', 169.25),
  ('RECEPCION_ENTREGA', 'I', 'LABORABLE', '02-08', 291.41),
  ('RECEPCION_ENTREGA', 'I', 'LABORABLE', '08-14', 148.63),
  ('RECEPCION_ENTREGA', 'I', 'LABORABLE', '14-20', 148.63),
  ('RECEPCION_ENTREGA', 'I', 'LABORABLE', '20-02', 222.91),
  ('RECEPCION_ENTREGA', 'I', 'SABADO', '02-08', 291.41),
  ('RECEPCION_ENTREGA', 'I', 'SABADO', '08-14', 165.13),
  ('RECEPCION_ENTREGA', 'I', 'SABADO', '14-20', 267.5),
  ('RECEPCION_ENTREGA', 'I', 'SABADO', '20-02', 393.35),
  ('RECEPCION_ENTREGA', 'I', 'FESTIVO', '02-08', 524.52),
  ('RECEPCION_ENTREGA', 'I', 'FESTIVO', '08-14', 267.5),
  ('RECEPCION_ENTREGA', 'I', 'FESTIVO', '14-20', 378.82),
  ('RECEPCION_ENTREGA', 'I', 'FESTIVO', '20-02', 509.96),
  ('RECEPCION_ENTREGA', 'I', 'FESTIVO_TO_LABORABLE', '02-08', 333.73),
  ('RECEPCION_ENTREGA', 'I', 'FESTIVO_TO_LABORABLE', '20-02', 451.76),
  ('RECEPCION_ENTREGA', 'I', 'FESTIVO_TO_FESTIVO', '02-08', 572.01),
  ('RECEPCION_ENTREGA', 'I', 'FESTIVO_TO_FESTIVO', '20-02', 509.96),
  ('RECEPCION_ENTREGA', 'I', 'LABORABLE_TO_FESTIVO', '20-02', 282.35),
  ('RECEPCION_ENTREGA', 'II', 'LABORABLE', '02-08', 297.97),
  ('RECEPCION_ENTREGA', 'II', 'LABORABLE', '08-14', 151.92),
  ('RECEPCION_ENTREGA', 'II', 'LABORABLE', '14-20', 151.92),
  ('RECEPCION_ENTREGA', 'II', 'LABORABLE', '20-02', 227.93),
  ('RECEPCION_ENTREGA', 'II', 'SABADO', '02-08', 297.97),
  ('RECEPCION_ENTREGA', 'II', 'SABADO', '08-14', 168.39),
  ('RECEPCION_ENTREGA', 'II', 'SABADO', '14-20', 273.51),
  ('RECEPCION_ENTREGA', 'II', 'SABADO', '20-02', 402.2),
  ('RECEPCION_ENTREGA', 'II', 'FESTIVO', '02-08', 536.26),
  ('RECEPCION_ENTREGA', 'II', 'FESTIVO', '08-14', 273.51),
  ('RECEPCION_ENTREGA', 'II', 'FESTIVO', '14-20', 387.29),
  ('RECEPCION_ENTREGA', 'II', 'FESTIVO', '20-02', 521.37),
  ('RECEPCION_ENTREGA', 'II', 'FESTIVO_TO_LABORABLE', '02-08', 348.54),
  ('RECEPCION_ENTREGA', 'II', 'FESTIVO_TO_LABORABLE', '20-02', 461.81),
  ('RECEPCION_ENTREGA', 'II', 'FESTIVO_TO_FESTIVO', '02-08', 584.93),
  ('RECEPCION_ENTREGA', 'II', 'FESTIVO_TO_FESTIVO', '20-02', 521.37),
  ('RECEPCION_ENTREGA', 'II', 'LABORABLE_TO_FESTIVO', '20-02', 288.69),
  ('RECEPCION_ENTREGA', 'III', 'LABORABLE', '02-08', 297.53),
  ('RECEPCION_ENTREGA', 'III', 'LABORABLE', '08-14', 151.74),
  ('RECEPCION_ENTREGA', 'III', 'LABORABLE', '14-20', 151.74),
  ('RECEPCION_ENTREGA', 'III', 'LABORABLE', '20-02', 227.62),
  ('RECEPCION_ENTREGA', 'III', 'SABADO', '02-08', 297.53),
  ('RECEPCION_ENTREGA', 'III', 'SABADO', '08-14', 167.8),
  ('RECEPCION_ENTREGA', 'III', 'SABADO', '14-20', 273.08),
  ('RECEPCION_ENTREGA', 'III', 'SABADO', '20-02', 401.64),
  ('RECEPCION_ENTREGA', 'III', 'FESTIVO', '02-08', 535.51),
  ('RECEPCION_ENTREGA', 'III', 'FESTIVO', '08-14', 273.08),
  ('RECEPCION_ENTREGA', 'III', 'FESTIVO', '14-20', 386.78),
  ('RECEPCION_ENTREGA', 'III', 'FESTIVO', '20-02', 520.67),
  ('RECEPCION_ENTREGA', 'III', 'FESTIVO_TO_LABORABLE', '02-08', 355.88),
  ('RECEPCION_ENTREGA', 'III', 'FESTIVO_TO_LABORABLE', '20-02', 461.19),
  ('RECEPCION_ENTREGA', 'III', 'FESTIVO_TO_FESTIVO', '02-08', 584.07),
  ('RECEPCION_ENTREGA', 'III', 'FESTIVO_TO_FESTIVO', '20-02', 520.67),
  ('RECEPCION_ENTREGA', 'III', 'LABORABLE_TO_FESTIVO', '20-02', 288.32),
  ('RECEPCION_ENTREGA', 'IV', 'LABORABLE', '02-08', 309.7),
  ('RECEPCION_ENTREGA', 'IV', 'LABORABLE', '08-14', 157.9),
  ('RECEPCION_ENTREGA', 'IV', 'LABORABLE', '14-20', 157.9),
  ('RECEPCION_ENTREGA', 'IV', 'LABORABLE', '20-02', 236.91),
  ('RECEPCION_ENTREGA', 'IV', 'SABADO', '02-08', 309.7),
  ('RECEPCION_ENTREGA', 'IV', 'SABADO', '08-14', 173.96),
  ('RECEPCION_ENTREGA', 'IV', 'SABADO', '14-20', 284.3),
  ('RECEPCION_ENTREGA', 'IV', 'SABADO', '20-02', 418.06),
  ('RECEPCION_ENTREGA', 'IV', 'FESTIVO', '02-08', 557.42),
  ('RECEPCION_ENTREGA', 'IV', 'FESTIVO', '08-14', 284.3),
  ('RECEPCION_ENTREGA', 'IV', 'FESTIVO', '14-20', 402.56),
  ('RECEPCION_ENTREGA', 'IV', 'FESTIVO', '20-02', 541.99),
  ('RECEPCION_ENTREGA', 'IV', 'FESTIVO_TO_LABORABLE', '02-08', 382.71),
  ('RECEPCION_ENTREGA', 'IV', 'FESTIVO_TO_LABORABLE', '20-02', 480.01),
  ('RECEPCION_ENTREGA', 'IV', 'FESTIVO_TO_FESTIVO', '02-08', 607.79),
  ('RECEPCION_ENTREGA', 'IV', 'FESTIVO_TO_FESTIVO', '20-02', 541.99),
  ('RECEPCION_ENTREGA', 'IV', 'LABORABLE_TO_FESTIVO', '20-02', 300.04)
on conflict (operation_type, worker_group, rate_key, shift_key) do update
set amount = excluded.amount;
