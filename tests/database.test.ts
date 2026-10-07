import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {votesFor,summarize} from '../src/domain';
import {randomUUID} from 'node:crypto';
const fiscal='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',admin='33333333-3333-3333-3333-333333333333';
let db:PGlite;
async function asUser(id:string,sql:string){await db.exec("reset role; select set_config('request.jwt.claim.sub','"+id+"',false); set role authenticated;");return db.query(sql);}
async function owner(sql:string){await db.exec('reset role;');return db.exec(sql);}
const submit=(table:number,n:number,key=randomUUID())=>"select * from public.submit_control("+table+","+n+",'"+key+"')";
beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 const sql=readFileSync(new URL('../supabase/migrations/001_initial.sql',import.meta.url),'utf8').replace(/alter publication supabase_realtime add table[^;]+;/,'');
 await db.exec(sql);
 await db.exec(readFileSync(new URL('../supabase/migrations/002_remove_submission_cooldown.sql',import.meta.url),'utf8')); 
 await db.exec(`insert into auth.users(id) values ('${fiscal}'),('${other}'),('${admin}'); update public.profiles set active=true;update public.profiles set role='admin' where id='${admin}'; insert into public.electoral_tables values(1,'001',true),(2,'002',true),(3,'003',false);insert into public.assignments values('${fiscal}',1),('${other}',2),('${fiscal}',3);`);
},30000);
afterAll(async()=>db?.close());
describe('cálculo',()=>{
 it('mapea todos los botones y rechaza entradas inválidas',()=>{expect([0,1,2,3,4,5].map(votesFor)).toEqual([5,4,3,2,1,0]);for(const n of [-1,6,2.5,NaN])expect(()=>votesFor(n)).toThrow();});
 it('los controles individuales suman 7',()=>{const cs=[3,4,1].map((remaining,i)=>({id:String(i),table_id:25,user_id:fiscal,remaining,votes:votesFor(remaining),created_at:'2026-10-06T13:00:00Z',status:'valid' as const,replaces_id:null,request_id:String(i)}));expect(summarize([{id:25,label:'025',active:true}],cs)[0].total).toBe(7);});
});
describe('base de datos y permisos',()=>{
 it('registra usuario, hora del servidor y votos calculados; reintento sin duplicar',async()=>{const key=randomUUID();const a=await asUser(fiscal,submit(1,3,key));const b=await asUser(fiscal,submit(1,3,key));expect(a.rows[0]).toMatchObject({user_id:fiscal,remaining:3,votes:2,status:'valid'});expect(a.rows[0]).toEqual(b.rows[0]);expect((await asUser(fiscal,'select * from audit_log')).rows).toHaveLength(1);await expect(asUser(fiscal,submit(1,4,key))).rejects.toThrow(/incompatible/);});
 it('permite envíos consecutivos y bloquea mesas ajenas y cerradas',async()=>{await owner('begin;');try{expect((await asUser(fiscal,submit(1,4))).rows[0]).toMatchObject({votes:1});expect((await asUser(fiscal,submit(1,2))).rows[0]).toMatchObject({votes:3});}finally{await owner('rollback;');}await expect(asUser(fiscal,submit(2,4))).rejects.toThrow(/autorizada/);await expect(asUser(fiscal,submit(3,4))).rejects.toThrow(/cerrada/);});
 it('impide alteraciones directas de controles y elevación de rol',async()=>{await expect(asUser(fiscal,"update profiles set role='admin'")).rejects.toThrow(/permission denied/);await expect(asUser(fiscal,'delete from controls')).rejects.toThrow(/permission denied/);await expect(asUser(fiscal,"insert into electoral_tables values(4,'004',true)")).rejects.toThrow(/permission denied/);});
 it('RLS oculta registros ajenos y totales de mesas no asignadas',async()=>{await asUser(other,submit(2,0));expect((await asUser(fiscal,'select * from controls')).rows).toHaveLength(1);expect((await asUser(fiscal,'select * from table_totals()')).rows.map((x:any)=>x.table_id)).toEqual([1,3]);expect((await asUser(admin,'select * from controls')).rows).toHaveLength(2);});
 it('corrige atómicamente conservando original y motivo; reintento idempotente',async()=>{const original=(await asUser(fiscal,'select id from controls')).rows[0] as {id:string};const key=randomUUID();const sql=`select public.revise_control('${original.id}',1,'Cantidad incorrecta','${key}')`;const a=await asUser(fiscal,sql);expect((await asUser(fiscal,sql)).rows).toEqual(a.rows);const rows=(await asUser(fiscal,'select * from controls')).rows;expect(rows).toHaveLength(2);expect(rows.some((c:any)=>c.status==='corrected')).toBe(true);expect((await asUser(fiscal,'select total from table_totals() where table_id=1')).rows).toEqual([{total:4}]);expect((await asUser(fiscal,"select reason from audit_log where action='corrected'")).rows).toEqual([{reason:'Cantidad incorrecta'}]);});
 it('rechaza corrección ajena y fuera de ventana; admin puede anular',async()=>{const row=(await asUser(fiscal,"select id from controls where status='valid'")).rows[0] as {id:string};await expect(asUser(other,`select revise_control('${row.id}',0,'Error de carga','${randomUUID()}')`)).rejects.toThrow(/15 minutos/);await owner(`update controls set created_at=now()-interval '20 minutes' where id='${row.id}'`);await expect(asUser(fiscal,`select revise_control('${row.id}',0,'Error de carga','${randomUUID()}')`)).rejects.toThrow(/15 minutos/);await asUser(admin,`select revise_control('${row.id}',null,'Control duplicado','${randomUUID()}')`);expect((await asUser(admin,'select total from table_totals() where table_id=1')).rows).toEqual([{total:0}]);});
 it('cuentas inactivas y anónimos no pueden cargar ni leer conteo',async()=>{await owner(`update profiles set active=false where id='${fiscal}'`);await expect(asUser(fiscal,submit(1,2))).rejects.toThrow(/autorizada/);expect((await asUser(fiscal,'select * from controls')).rows).toHaveLength(0);await db.exec('reset role;set role anon;');await expect(db.query(submit(1,2))).rejects.toThrow(/permission denied/);await expect(db.query('select * from controls')).rejects.toThrow(/permission denied/);});
});

