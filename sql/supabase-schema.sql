-- Ejecutar en el SQL Editor de Supabase.
-- La tabla transacciones NO tiene UNIQUE(id_txn): se guardan IDs repetidos para
-- registrarlos como anomalías, no para rechazar el POST.

create table if not exists public.usuarios (
  id serial primary key,
  nombre text not null,
  email text not null unique,
  estado text not null default 'activo',
  fecha_creacion timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now()
);

create table if not exists public.transacciones (
  id serial primary key,
  usuario_id integer not null references public.usuarios(id) on delete restrict,
  id_txn text not null,
  valor numeric(18, 2) not null,
  fecha_txn timestamptz not null,
  estado text not null default 'normal',
  hash text not null default '',
  hash_valido boolean not null default false,
  metodo_pago text not null default '',
  ip text,
  -- Deprecated legacy column; retained for upgrades from the seconds-based schema.
  ventana_segundos integer not null default 3,
  ventana_transacciones integer not null default 3,
  fecha_creacion timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now()
);

create table if not exists public.anomalias (
  id serial primary key,
  transaccion_id integer references public.transacciones(id) on delete set null,
  usuario_id integer references public.usuarios(id) on delete set null,
  usuario_email text not null default '',
  tipo text not null,
  nivel text not null,
  razon text not null default '',
  cantidad_transacciones integer not null default 1,
  -- Deprecated legacy column; retained for upgrades from the seconds-based schema.
  ventana_segundos integer not null default 3,
  ventana_transacciones integer not null default 3,
  valor_sospechoso numeric(18, 2) not null default 0,
  estado text not null default 'abierta',
  fecha_creacion timestamptz not null default now(),
  fecha_actualizacion timestamptz not null default now()
);

-- Añade las columnas nuevas si ya se ejecutó el primer esquema entregado.
alter table public.transacciones
  add column if not exists hash_valido boolean not null default false,
  add column if not exists ip text,
  add column if not exists ventana_segundos integer not null default 3,
  add column if not exists ventana_transacciones integer not null default 3;

alter table public.anomalias
  add column if not exists usuario_id integer references public.usuarios(id) on delete set null,
  add column if not exists usuario_email text not null default '',
  add column if not exists razon text not null default '',
  add column if not exists ventana_transacciones integer not null default 3,
  add column if not exists valor_sospechoso numeric(18, 2) not null default 0,
  add column if not exists estado text not null default 'abierta';

update public.transacciones
set estado = 'normal'
where lower(estado) <> 'normal';

create table if not exists public.anomalia_transacciones (
  id serial primary key,
  anomalia_id integer not null references public.anomalias(id) on delete cascade,
  transaccion_id integer not null references public.transacciones(id) on delete cascade,
  es_disparadora boolean not null default false,
  fecha_creacion timestamptz not null default now(),
  unique (anomalia_id, transaccion_id)
);

create index if not exists idx_transacciones_usuario_fecha
  on public.transacciones(usuario_id, fecha_txn);
create index if not exists idx_transacciones_usuario_recibida
  on public.transacciones(usuario_id, fecha_creacion);
create index if not exists idx_transacciones_id_txn
  on public.transacciones(id_txn);
create index if not exists idx_transacciones_fecha
  on public.transacciones(fecha_txn desc);
create index if not exists idx_anomalias_fecha
  on public.anomalias(fecha_creacion desc);
create index if not exists idx_anomalias_tipo
  on public.anomalias(tipo);
create index if not exists idx_anomalia_transacciones_anomalia
  on public.anomalia_transacciones(anomalia_id);

create or replace function public.actualizar_fecha_actualizacion()
returns trigger
language plpgsql
as $$
begin
  new.fecha_actualizacion = now();
  return new;
end;
$$;

drop trigger if exists trg_usuarios_update on public.usuarios;
create trigger trg_usuarios_update
before update on public.usuarios
for each row execute function public.actualizar_fecha_actualizacion();

drop trigger if exists trg_transacciones_update on public.transacciones;
create trigger trg_transacciones_update
before update on public.transacciones
for each row execute function public.actualizar_fecha_actualizacion();

drop trigger if exists trg_anomalias_update on public.anomalias;
create trigger trg_anomalias_update
before update on public.anomalias
for each row execute function public.actualizar_fecha_actualizacion();

alter table public.usuarios enable row level security;
alter table public.transacciones enable row level security;
alter table public.anomalias enable row level security;
alter table public.anomalia_transacciones enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete
  on public.usuarios, public.transacciones, public.anomalias, public.anomalia_transacciones
  to service_role;
grant usage, select on sequence
  public.usuarios_id_seq,
  public.transacciones_id_seq,
  public.anomalias_id_seq,
  public.anomalia_transacciones_id_seq
  to service_role;

-- El backend Next.js usa exclusivamente el rol service_role para las cuatro tablas.
-- Las políticas explícitas cubren instalaciones donde RLS está activo y el rol
-- de backend no está heredando el bypass de RLS esperado.
drop policy if exists "service_role_all_usuarios" on public.usuarios;
create policy "service_role_all_usuarios"
  on public.usuarios for all to service_role
  using (true) with check (true);

drop policy if exists "service_role_all_transacciones" on public.transacciones;
create policy "service_role_all_transacciones"
  on public.transacciones for all to service_role
  using (true) with check (true);

drop policy if exists "service_role_all_anomalias" on public.anomalias;
create policy "service_role_all_anomalias"
  on public.anomalias for all to service_role
  using (true) with check (true);

drop policy if exists "service_role_all_anomalia_transacciones" on public.anomalia_transacciones;
create policy "service_role_all_anomalia_transacciones"
  on public.anomalia_transacciones for all to service_role
  using (true) with check (true);

-- Ningún cliente directo debe escribir ni leer estas tablas: Postman llama
-- al endpoint Next.js, que valida las transacciones antes de persistirlas.
revoke all on public.usuarios, public.transacciones, public.anomalias,
  public.anomalia_transacciones from anon, authenticated;
revoke all on sequence
  public.usuarios_id_seq,
  public.transacciones_id_seq,
  public.anomalias_id_seq,
  public.anomalia_transacciones_id_seq
  from anon, authenticated;

-- El endpoint Next.js es público y escribe usando SUPABASE_SERVICE_ROLE_KEY.
-- No conceder INSERT/SELECT a anon/authenticated: eso expondría las tablas y
-- permitiría saltarse la validación de hashes y las reglas de negocio de la API.
