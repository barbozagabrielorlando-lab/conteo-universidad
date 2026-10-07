create or replace function public.submit_control(p_table integer,p_remaining integer,p_request uuid) returns public.controls
language plpgsql security definer set search_path='' as $$
declare result public.controls;
begin
 if not private.can_table(p_table) then raise exception 'Mesa no autorizada'; end if;
 if p_remaining is null or p_remaining not between 0 and 5 or p_request is null then raise exception 'Control inválido'; end if;
 perform 1 from public.electoral_tables where id=p_table and active for update;
 if not found then raise exception 'Mesa cerrada'; end if;
 select * into result from public.controls where request_id=p_request;
 if found then
  if result.user_id<>auth.uid() or result.table_id<>p_table or result.remaining<>p_remaining or result.replaces_id is not null then raise exception 'Solicitud incompatible'; end if;
  return result;
 end if;
 insert into public.controls(table_id,user_id,remaining,request_id) values(p_table,auth.uid(),p_remaining,p_request) returning * into result;
 insert into public.audit_log(control_id,actor_id,action,reason) values(result.id,auth.uid(),'created','Control de boletas; reposición a cinco confirmada');
 return result;
end $$;
