-- Migration: custodia markers & coordinated finish
-- 1) ubicacion -> servicio_custodio_id
alter table if exists public.ubicacion
  add column if not exists servicio_custodio_id uuid references public.servicio_custodio(id);

create index if not exists idx_ubicacion_servicio_custodio_captured
  on public.ubicacion (servicio_custodio_id, captured_at desc);

-- 2) servicio -> finished_at / finished_by_sc_id
alter table if exists public.servicio
  add column if not exists finished_at timestamptz,
  add column if not exists finished_by_sc_id uuid references public.servicio_custodio(id);

-- 3) vista ultimo ping por custodia
create or replace view public.v_ultimo_ping_por_custodia as
with ranked as (
  select
    sc.id as servicio_custodio_id,
    sc.servicio_id,
    sc.nombre_custodio,
    sc.tipo_custodia,
    s.empresa,
    s.placa_upper as placa,
    c.nombre_upper as cliente,
    u.lat,
    u.lng,
    u.captured_at,
    row_number() over (
      partition by sc.id
      order by u.captured_at desc nulls last
    ) as rn
  from public.servicio_custodio sc
  join public.servicio s on s.id = sc.servicio_id
  left join public.cliente c on c.id = s.cliente_id
  left join public.ubicacion u on u.servicio_custodio_id = sc.id
)
select
  servicio_custodio_id,
  servicio_id,
  lat,
  lng,
  captured_at as ultimo_ping_at,
  nombre_custodio,
  tipo_custodia,
  placa,
  cliente,
  empresa
from ranked
where rn = 1;

-- 4) registrar_ubicacion ahora admite servicio_custodio_id (opcional)
create or replace function public.registrar_ubicacion(
  p_servicio_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_servicio_custodio_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ubicacion(
    servicio_id,
    servicio_custodio_id,
    lat,
    lng,
    captured_at
  )
  values (
    p_servicio_id,
    p_servicio_custodio_id,
    p_lat,
    p_lng,
    now()
  );
end;
$$;
