import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const operador='10000000-0000-0000-0000-000000000001',electoral='10000000-0000-0000-0000-000000000002',inactivo='10000000-0000-0000-0000-000000000003',admin='10000000-0000-0000-0000-000000000004';
let db:PGlite;let baseline:unknown;const participante=randomUUID();
const snapshot=`select jsonb_build_object(
 'profiles',(select jsonb_agg(to_jsonb(p) order by id) from profiles p),
 'mesas',(select jsonb_agg(to_jsonb(t) order by id) from electoral_tables t),
 'asignaciones',(select jsonb_agg(to_jsonb(a) order by user_id,table_id) from assignments a),
 'controles',(select jsonb_agg(to_jsonb(c) order by id) from controls c),
 'auditoria',(select jsonb_agg(to_jsonb(a) order by id) from audit_log a),
 'funciones',(select jsonb_agg(pg_get_functiondef(p.oid) order by proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('submit_control','submit_batch','revise_control','table_totals'))
) as estado`;
async function owner(sql:string){await db.exec('reset role');return db.query(sql);}
async function asUser(id:string,sql:string){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`);return db.query(sql);}
const alta=(id=participante,dni='12345678')=>`select * from curso_guardar_participante('${id}','Ana','Pérez','${dni}','123',null)`;
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const file of ['001_initial.sql','002_remove_submission_cooldown.sql','003_six_rows_votes.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8').replace(/alter publication supabase_realtime add table[^;]+;/,''));
 await db.exec(`insert into auth.users(id) values('${operador}'),('${electoral}'),('${inactivo}'),('${admin}');update profiles set active=true,role='admin' where id='${electoral}';insert into electoral_tables values(1,'001',true);`);
 await asUser(electoral,`select * from submit_control(1,2,'${randomUUID()}')`);
 baseline=(await owner(snapshot)).rows;
 await db.exec(readFileSync(new URL('../supabase/migrations/004_curso.sql',import.meta.url),'utf8'));
 await db.exec(readFileSync(new URL('../supabase/migrations/20261030200159_curso_fechas_futuras.sql',import.meta.url),'utf8'));
 await db.exec(`insert into curso_operadores values('${operador}','Operador','operador',true),('${inactivo}','Inactivo','operador',false),('${admin}','Admin curso','admin',true);`);
},30000);
afterAll(async()=>db?.close());

it('no otorga acceso al curso al administrador electoral ni al inactivo',async()=>{
 for(const user of [electoral,inactivo]){expect((await asUser(user,'select * from curso_participantes')).rows).toEqual([]);await expect(asUser(user,alta())).rejects.toThrow(/permiso/);}
 await db.exec('reset role;set role anon');await expect(db.query('select * from curso_participantes')).rejects.toThrow(/permission denied/);await expect(db.query(alta())).rejects.toThrow(/permission denied/);
});
it('crea un participante persistente y el reintento no duplica ni agrega auditoría',async()=>{
 const a=await asUser(operador,alta());const b=await asUser(operador,alta());expect(a.rows).toEqual(b.rows);expect((await asUser(operador,'select * from curso_participantes')).rows).toHaveLength(1);expect((await asUser(admin,'select * from curso_auditoria')).rows).toHaveLength(1);
});
it('evita DNI duplicado, permite DNI vacío y bloquea escritura directa/elevación',async()=>{
 await expect(asUser(operador,alta(randomUUID()))).rejects.toThrow(/unique/);
 await asUser(operador,alta(randomUUID(),''));await asUser(operador,alta(randomUUID(),''));
 for(const sql of ["update curso_operadores set role='admin'",'delete from curso_participantes',`insert into curso_asistencias values('${participante}','2026-01-01',true,now(),'${operador}')`])await expect(asUser(operador,sql)).rejects.toThrow(/permission denied/);
 expect((await asUser(operador,'select * from curso_auditoria')).rows).toEqual([]);
});
it('mantiene asistencias separadas por día y permite corregir sin duplicar',async()=>{
 const mark=(date:string,present:boolean)=>`select * from curso_marcar_asistencia('${participante}','${date}',${present})`;
 await asUser(operador,mark('2026-01-01',true));await asUser(operador,mark('2026-01-01',true));
 expect((await asUser(operador,"select * from curso_asistencias where fecha='2026-01-02'")).rows).toEqual([]);
 await asUser(operador,mark('2026-01-02',true));await asUser(operador,mark('2026-01-02',false));
 const rows=(await asUser(admin,'select fecha::text,presente from curso_asistencias order by fecha')).rows;
 expect(rows).toEqual([{fecha:'2026-01-01',presente:true},{fecha:'2026-01-02',presente:false}]);
 expect((await asUser(admin,"select * from curso_auditoria where accion='asistencia'")).rows).toHaveLength(3);
 await asUser(operador,mark('2999-01-01',true));
 expect((await asUser(operador,"select fecha::text,presente from curso_asistencias where fecha='2999-01-01'")).rows).toEqual([{fecha:'2999-01-01',presente:true}]);
 await expect(asUser(operador,`select * from curso_marcar_asistencia('${participante}',null,true)`)).rejects.toThrow(/fecha válida/);
});
it('detecta edición concurrente en vez de sobrescribir y conserva asistencias',async()=>{
 const version=(await asUser(operador,`select updated_at::text from curso_participantes where id='${participante}'`)).rows[0] as {updated_at:string};
 await asUser(operador,`select * from curso_guardar_participante('${participante}','Ana María','Pérez','12345678','456','${version.updated_at}')`);
 await expect(asUser(operador,`select * from curso_guardar_participante('${participante}','Ana','Pérez','12345678','789','${version.updated_at}')`)).rejects.toThrow(/Otro operador/);
 expect((await asUser(operador,'select * from curso_asistencias')).rows).toHaveLength(3);
});
it('revoca inmediatamente la consulta y escritura al deshabilitar el operador',async()=>{
 await owner(`update curso_operadores set active=false where user_id='${operador}'`);
 expect((await asUser(operador,'select * from curso_participantes')).rows).toEqual([]);
 await expect(asUser(operador,`select * from curso_marcar_asistencia('${participante}','2026-01-01',false)`)).rejects.toThrow(/permiso/);
});
it('no concede acceso electoral a cuentas del curso y conserva los controles originales',async()=>{
 expect((await asUser(admin,'select * from controls')).rows).toEqual([]);await expect(asUser(admin,`select * from submit_control(1,3,'${randomUUID()}')`)).rejects.toThrow(/autorizada/);
 expect((await owner(snapshot)).rows).toEqual(baseline);
 const profile=(await owner(`select active,role from profiles where id='${admin}'`)).rows;expect(profile).toEqual([{active:false,role:'fiscal'}]);
});
