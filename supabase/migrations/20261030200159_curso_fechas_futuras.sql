-- Permitir consultar y marcar fechas futuras del curso sin cambiar datos ni permisos.
CREATE OR REPLACE FUNCTION public.curso_marcar_asistencia(p_participante uuid, p_fecha date, p_presente boolean)
 RETURNS public.curso_asistencias
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous boolean; result public.curso_asistencias;
begin
 if not private.curso_autorizado() then raise exception 'Sin permiso para tomar asistencia'; end if;
 if p_fecha is null or p_presente is null then raise exception 'Seleccioná una fecha válida'; end if;
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
end $function$;
