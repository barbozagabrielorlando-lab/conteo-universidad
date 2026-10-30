import type {SupabaseClient} from '@supabase/supabase-js';
import type {MarcaPlanilla,PersonaPlanilla} from './exportar-asistencia';
/** Consulta completa bajo la sesión/RLS actual. No depende de la página ni del buscador. */
export async function leerDatosCurso(db:SupabaseClient,userId:string,fechas:string[]){
 async function personas(){const result:PersonaPlanilla[]=[];let expected:number|undefined;const ids=new Set<string>();for(let offset=0;;){
  const {data,error,count}=await db.from('curso_participantes').select('id,nombre,apellido,telefono',{count:'exact'}).order('apellido').order('nombre').order('id').range(offset,offset+999);
  if(error)throw error;if(!Array.isArray(data)||count===null)throw new Error('No se pudo verificar la lista completa. Reintentá la exportación.');
  if(expected!==undefined&&count!==expected)throw new Error('La lista cambió durante la exportación. Volvé a intentarlo.');expected=count;
  for(const p of data){if(ids.has(p.id))throw new Error('La lista cambió durante la exportación. Volvé a intentarlo.');ids.add(p.id);}
  result.push(...data);if(result.length===count)return result;if(!data.length||result.length>count)throw new Error('La lista se recibió incompleta. Reintentá la exportación.');offset+=data.length;
 }}
 async function marcas(){const result:MarcaPlanilla[]=[];let expected:number|undefined;const ids=new Set<string>();for(let offset=0;;){
  const {data,error,count}=await db.from('curso_asistencias').select('participante_id,fecha,presente',{count:'exact'}).in('fecha',fechas).eq('presente',true).order('fecha').order('participante_id').range(offset,offset+999);
  if(error)throw error;if(!Array.isArray(data)||count===null)throw new Error('No se pudieron verificar todas las asistencias. Reintentá la exportación.');
  if(expected!==undefined&&count!==expected)throw new Error('Las asistencias cambiaron durante la exportación. Volvé a intentarlo.');expected=count;
  for(const a of data){const id=a.participante_id+'|'+a.fecha;if(ids.has(id))throw new Error('Las asistencias cambiaron durante la exportación. Volvé a intentarlo.');ids.add(id);}
  result.push(...data);if(result.length===count)return result;if(!data.length||result.length>count)throw new Error('Las asistencias se recibieron incompletas. Reintentá la exportación.');offset+=data.length;
 }}
 const [participantes,asistencias]=await Promise.all([personas(),marcas()]);
 const {data:operador,error}=await db.from('curso_operadores').select('active').eq('user_id',userId).maybeSingle();
 if(error)throw error;if(!operador?.active)throw new Error('Tu cuenta ya no tiene acceso al curso. No se descargó la planilla.');
 return {participantes,asistencias};
}
