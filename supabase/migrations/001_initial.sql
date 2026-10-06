-- Aplicar UNA VEZ, exclusivamente en un proyecto Supabase nuevo.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create table public.profiles (
 id uuid primary key references auth.users(id), display_name text not null check(length(display_name) between 1 and 100),
 role text not null default 'fiscal' check(role in ('fiscal','admin')), active boolean not null default false
);
create table public.electoral_tables (id integer primary key check(id>0),label text not null unique,active boolean not null default true);
create table public.assignments (user_id uuid references public.profiles(id),table_id integer references public.electoral_tables(id),primary key(user_id,table_id));
create table public.controls (
 id uuid primary key default gen_random_uuid(), table_id integer not null references public.electoral_tables(id),
 user_id uuid not null references public.profiles(id), remaining integer not null check(remaining between 0 and 5),
 votes integer generated always as (5-remaining) stored, created_at timestamptz not null default now(),
 status text not null default 'valid' check(status in ('valid','corrected','void')),
 replaces_id uuid unique references public.controls(id), request_id uuid not null unique
);
create index controls_table_time on public.controls(table_id,created_at);
create index controls_user_time on public.controls(user_id,created_at);
create table public.audit_log (
 id bigint generated always as identity primary key, control_id uuid not null references public.controls(id),
 actor_id uuid not null references public.profiles(id),action text not null check(action in ('created','corrected','void')),
 reason text not null,created_at timestamptz not null default now(),replacement_id uuid references public.controls(id)
);
create function private.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active and role='admin')
$$;
create function private.is_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active)
$$;
create function private.can_table(t integer) returns boolean language sql stable security definer set search_path='' as $$
 select private.is_active() and (private.is_admin() or exists(select 1 from public.assignments where user_id=auth.uid() and table_id=t))
$$;
create function private.new_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,display_name) values(new.id,coalesce(nullif(left(new.raw_user_meta_data->>'display_name',100),''),'Fiscal'));
 return new;
end $$;
create trigger auth_profile after insert on auth.users for each row execute function private.new_profile();
alter table public.profiles enable row level security;
alter table public.electoral_tables enable row level security;
alter table public.assignments enable row level security;
alter table public.controls enable row level security;
alter table public.audit_log enable row level security;
create policy profile_read on public.profiles for select to authenticated using(id=auth.uid() or private.is_admin());
create policy table_read on public.electoral_tables for select to authenticated using(private.can_table(id));
create policy assignment_read on public.assignments for select to authenticated using(private.is_active() and (user_id=auth.uid() or private.is_admin()));
create policy control_read on public.controls for select to authenticated using(private.is_active() and (user_id=auth.uid() or private.is_admin()));
create policy audit_read on public.audit_log for select to authenticated using(private.is_active() and (private.is_admin() or exists(select 1 from public.controls c where c.id=control_id and c.user_id=auth.uid())));
revoke all on public.profiles,public.electoral_tables,public.assignments,public.controls,public.audit_log from anon,authenticated;
grant select on public.profiles,public.electoral_tables,public.assignments,public.controls,public.audit_log to authenticated;
create function public.submit_control(p_table integer,p_remaining integer,p_request uuid) returns public.controls
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
 if exists(select 1 from public.controls where table_id=p_table and created_at>now()-interval '30 seconds') then
  raise exception 'Esta mesa recibió un control hace menos de 30 segundos. Revisá el historial antes de volver a enviar.';
 end if;
 insert into public.controls(table_id,user_id,remaining,request_id) values(p_table,auth.uid(),p_remaining,p_request) returning * into result;
 insert into public.audit_log(control_id,actor_id,action,reason) values(result.id,auth.uid(),'created','Control de boletas; reposición a cinco confirmada');
 return result;
end $$;
create function public.revise_control(p_id uuid,p_remaining integer,p_reason text,p_request uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare original public.controls; replacement public.controls; admin boolean; result_id uuid;
begin
 if not private.is_active() then raise exception 'Usuario no autorizado'; end if;
 if p_reason is null or length(trim(p_reason))<5 or length(p_reason)>500 or p_request is null then raise exception 'Ingresá un motivo entre 5 y 500 caracteres'; end if;
 if p_remaining is not null and p_remaining not between 0 and 5 then raise exception 'Control inválido'; end if;
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
create function public.table_totals() returns table(table_id integer,total bigint,reported boolean,last_control timestamptz)
language sql stable security definer set search_path='' as $$
 select t.id,coalesce(sum(c.votes) filter(where c.status='valid'),0),count(c.id)>0,max(c.created_at)
 from public.electoral_tables t left join public.controls c on c.table_id=t.id
 where private.can_table(t.id) group by t.id
$$;
revoke all on function public.submit_control(integer,integer,uuid),public.revise_control(uuid,integer,text,uuid),public.table_totals() from public,anon;
grant execute on function public.submit_control(integer,integer,uuid),public.revise_control(uuid,integer,text,uuid),public.table_totals() to authenticated;
revoke all on all functions in schema private from public,anon;
grant execute on function private.is_admin(),private.is_active(),private.can_table(integer) to authenticated;
-- Supabase Realtime: las lecturas siguen las políticas RLS.
alter publication supabase_realtime add table public.controls,public.audit_log,public.profiles,public.electoral_tables,public.assignments;
commit;

