-- Migración aditiva: aplicar solamente después de verificar respaldo y autorizar producción.
-- Independiente del esquema electoral: no altera sus tablas, funciones ni perfiles.
begin;
create table public.curso_operadores (
 user_id uuid primary key references auth.users(id),
 display_name text not null check(length(trim(display_name)) between 1 and 100),
 role text not null default 'operador' check(role in ('admin','operador')),
 active boolean not null default false
);
create table public.curso_participantes (
 id uuid primary key,
 nombre text not null check(length(trim(nombre)) between 1 and 100),
 apellido text not null check(length(trim(apellido)) between 1 and 100),
 dni text unique check(dni ~ '^[0-9]{7,9}$'),
 telefono text not null default '' check(length(telefono)<=40),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id)
);
create table public.curso_asistencias (
 participante_id uuid not null references public.curso_participantes(id),
 fecha date not null,
 presente boolean not null,
 updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id),
 primary key(participante_id,fecha)
);
create index curso_asistencias_fecha on public.curso_asistencias(fecha);
create index curso_participantes_orden on public.curso_participantes(apellido,nombre,id);
create table public.curso_auditoria (
 id bigint generated always as identity primary key,
 actor_id uuid not null references auth.users(id),
 participante_id uuid not null references public.curso_participantes(id),
 accion text not null check(accion in ('alta','edicion','asistencia')),
 fecha date,
 presente_anterior boolean,
 presente_nuevo boolean,
 created_at timestamptz not null default now()
);
create function private.curso_autorizado() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.curso_operadores where user_id=auth.uid() and active)
$$;
create function private.curso_admin() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.curso_operadores where user_id=auth.uid() and active and role='admin')
$$;
alter table public.curso_operadores enable row level security;
alter table public.curso_participantes enable row level security;
alter table public.curso_asistencias enable row level security;
alter table public.curso_auditoria enable row level security;
create policy curso_operador_lectura on public.curso_operadores for select to authenticated
 using(user_id=auth.uid() or private.curso_admin());
create policy curso_participantes_lectura on public.curso_participantes for select to authenticated
 using(private.curso_autorizado());
create policy curso_asistencias_lectura on public.curso_asistencias for select to authenticated
 using(private.curso_autorizado());
create policy curso_auditoria_lectura on public.curso_auditoria for select to authenticated
 using(private.curso_admin());
revoke all on public.curso_operadores,public.curso_participantes,public.curso_asistencias,public.curso_auditoria from public,anon,authenticated;
grant select on public.curso_operadores,public.curso_participantes,public.curso_asistencias,public.curso_auditoria to authenticated;

create function public.curso_guardar_participante(p_id uuid,p_nombre text,p_apellido text,p_dni text,p_telefono text,p_version timestamptz default null)
returns public.curso_participantes language plpgsql security definer set search_path='' as $$
declare result public.curso_participantes; old public.curso_participantes;
begin
 if not private.curso_autorizado() then raise exception 'Sin permiso para administrar el curso'; end if;
 if p_id is null or p_nombre is null or length(trim(p_nombre)) not between 1 and 100 or p_apellido is null or length(trim(p_apellido)) not between 1 and 100 then raise exception 'Completá nombre y apellido'; end if;
 if nullif(trim(p_dni),'') is not null and trim(p_dni) !~ '^[0-9]{7,9}$' then raise exception 'El DNI debe tener entre 7 y 9 dígitos'; end if;
 if length(coalesce(p_telefono,''))>40 then raise exception 'Teléfono demasiado largo'; end if;
 -- Un mismo UUID de alta se puede reintentar sin duplicar. Serializa también altas concurrentes.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into old from public.curso_participantes where id=p_id for update;
 if found then
  if p_version is null then
   if old.nombre=trim(p_nombre) and old.apellido=trim(p_apellido) and old.dni is not distinct from nullif(trim(p_dni),'') and old.telefono=trim(coalesce(p_telefono,'')) and old.created_by=auth.uid() then return old; end if;
   raise exception 'El participante ya existe; actualizá la lista';
  end if;
  if old.updated_at<>p_version then raise exception 'Otro operador modificó este participante. Actualizá la lista antes de editar'; end if;
  update public.curso_participantes set nombre=trim(p_nombre),apellido=trim(p_apellido),dni=nullif(trim(p_dni),''),telefono=trim(coalesce(p_telefono,'')),updated_at=clock_timestamp() where id=p_id returning * into result;
  insert into public.curso_auditoria(actor_id,participante_id,accion) values(auth.uid(),p_id,'edicion');
 else
  if p_version is not null then raise exception 'Participante inexistente'; end if;
  insert into public.curso_participantes(id,nombre,apellido,dni,telefono,created_by)
   values(p_id,trim(p_nombre),trim(p_apellido),nullif(trim(p_dni),''),trim(coalesce(p_telefono,'')),auth.uid()) returning * into result;
  insert into public.curso_auditoria(actor_id,participante_id,accion) values(auth.uid(),p_id,'alta');
 end if;
 return result;
end $$;

create function public.curso_marcar_asistencia(p_participante uuid,p_fecha date,p_presente boolean)
returns public.curso_asistencias language plpgsql security definer set search_path='' as $$
declare previous boolean; result public.curso_asistencias;
begin
 if not private.curso_autorizado() then raise exception 'Sin permiso para tomar asistencia'; end if;
 if p_fecha is null or p_presente is null then raise exception 'Seleccioná una fecha válida'; end if;
 -- El día operativo se valida explícitamente en horario argentino.
 if p_fecha>(now() at time zone 'America/Argentina/Buenos_Aires')::date then raise exception 'No se puede tomar asistencia futura'; end if;
 perform 1 from public.curso_participantes where id=p_participante for update;
 if not found then raise exception 'Participante inexistente'; end if;
 select presente into previous from public.curso_asistencias where participante_id=p_participante and fecha=p_fecha;
 insert into public.curso_asistencias(participante_id,fecha,presente,updated_by)
  values(p_participante,p_fecha,p_presente,auth.uid())
  on conflict(participante_id,fecha) do update set presente=excluded.presente,updated_at=clock_timestamp(),updated_by=auth.uid()
  returning * into result;
 if previous is distinct from p_presente then
  insert into public.curso_auditoria(actor_id,participante_id,accion,fecha,presente_anterior,presente_nuevo)
   values(auth.uid(),p_participante,'asistencia',p_fecha,previous,p_presente);
 end if;
 return result;
end $$;
revoke all on function private.curso_autorizado(),private.curso_admin() from public,anon;
grant execute on function private.curso_autorizado(),private.curso_admin() to authenticated;
revoke all on function public.curso_guardar_participante(uuid,text,text,text,text,timestamptz),public.curso_marcar_asistencia(uuid,date,boolean) from public,anon;
grant execute on function public.curso_guardar_participante(uuid,text,text,text,text,timestamptz),public.curso_marcar_asistencia(uuid,date,boolean) to authenticated;
commit;
