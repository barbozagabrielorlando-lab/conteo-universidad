begin;
-- Compatibilidad con controles existentes: votos = 5 - remaining.
-- En la interfaz se ingresan votos directos; remaining es una codificación interna.
alter table public.controls drop constraint controls_remaining_check;
alter table public.controls add constraint controls_remaining_check check(remaining between -5 and 5);
create or replace function public.submit_control(p_table integer,p_remaining integer,p_request uuid) returns public.controls
language plpgsql security definer set search_path='' as $$
declare result public.controls;
begin
 if not private.can_table(p_table) then raise exception 'Mesa no autorizada'; end if;
 if p_remaining is null or p_remaining not between -5 and 5 or p_request is null then raise exception 'Control inválido'; end if;
 perform 1 from public.electoral_tables where id=p_table and active for update;
 if not found then raise exception 'Mesa cerrada'; end if;
 select * into result from public.controls where request_id=p_request;
 if found then
  if result.user_id<>auth.uid() or result.table_id<>p_table or result.remaining<>p_remaining or result.replaces_id is not null then raise exception 'Solicitud incompatible'; end if;
  return result;
 end if;
 insert into public.controls(table_id,user_id,remaining,request_id) values(p_table,auth.uid(),p_remaining,p_request) returning * into result;
 insert into public.audit_log(control_id,actor_id,action,reason) values(result.id,auth.uid(),'created','Votos estimados ingresados directamente');
 return result;
end $$;

create or replace function public.revise_control(p_id uuid,p_remaining integer,p_reason text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare original public.controls; replacement public.controls; admin boolean; result_id uuid;
begin
 if not private.is_active() then raise exception 'Usuario no autorizado'; end if;
 if p_reason is null or length(trim(p_reason))<5 or length(p_reason)>500 or p_request is null then raise exception 'Ingresá un motivo entre 5 y 500 caracteres'; end if;
 if p_remaining is not null and p_remaining not between -5 and 5 then raise exception 'Control inválido'; end if;
 -- Serializar con cargas de la misma mesa: siempre mesa antes de control.
 select * into original from public.controls where id=p_id;
 if not found then raise exception 'Control inexistente'; end if;
 perform 1 from public.electoral_tables where id=original.table_id for update;
 select * into original from public.controls where id=p_id for update;
 admin:=private.is_admin();
 if not admin and (original.user_id<>auth.uid() or original.created_at<now()-interval '15 minutes' or not private.can_table(original.table_id)) then
  raise exception 'Solo podés corregir tus controles durante 15 minutos en una mesa asignada';
 end if;
 select * into replacement from public.controls where request_id=p_request;
 if found then
  if replacement.replaces_id=p_id and replacement.remaining=p_remaining and replacement.user_id=auth.uid() then return replacement.id; end if;
  raise exception 'Solicitud incompatible';
 end if;
 if original.status<>'valid' then
  if p_remaining is null and exists(select 1 from public.audit_log where control_id=p_id and action='void' and actor_id=auth.uid() and reason=trim(p_reason)) then return p_id; end if;
  raise exception 'Este control ya fue corregido o anulado';
 end if;
 if p_remaining is null then
  update public.controls set status='void' where id=p_id;
  result_id:=p_id;
 else
  insert into public.controls(table_id,user_id,remaining,replaces_id,request_id)
   values(original.table_id,auth.uid(),p_remaining,p_id,p_request) returning id into result_id;
  update public.controls set status='corrected' where id=p_id;
 end if;
 insert into public.audit_log(control_id,actor_id,action,reason,replacement_id)
 values(p_id,auth.uid(),case when p_remaining is null then 'void' else 'corrected' end,trim(p_reason),case when p_remaining is null then null else result_id end);
 return result_id;
end $$;

create or replace function public.submit_batch(p_table integer,p_votes integer[],p_requests uuid[]) returns setof public.controls
language plpgsql security definer set search_path='' as $$
declare i integer; item public.controls;
begin
 if p_votes is null or p_requests is null or cardinality(p_votes) not between 1 and 6 or cardinality(p_votes)<>cardinality(p_requests) then raise exception 'Carga inválida'; end if;
 for i in 1..cardinality(p_votes) loop
  if p_votes[i] is null or p_votes[i] not between 0 and 10 or p_requests[i] is null then raise exception 'Cada fila debe contener de 0 a 10 votos'; end if;
  select * into item from public.submit_control(p_table,5-p_votes[i],p_requests[i]);
  return next item;
 end loop;
end $$;
revoke all on function public.submit_batch(integer,integer[],uuid[]) from public,anon;
grant execute on function public.submit_batch(integer,integer[],uuid[]) to authenticated;
commit;
