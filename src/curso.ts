import type { SupabaseClient } from '@supabase/supabase-js';
import {descargarExcel,fechasSemana,prepararPlanilla} from './exportar-asistencia';
import {leerDatosCurso} from './curso-export-data';

export type CursoOperador={user_id:string;display_name:string;role:'admin'|'operador';active:boolean};
type Participante={id:string;nombre:string;apellido:string;dni:string|null;telefono:string;created_at:string;updated_at:string;created_by:string};
type Asistencia={participante_id:string;fecha:string;presente:boolean};
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function fechaArgentina(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-');}
const fallo=(e:unknown)=>(e as {code?:string})?.code==='23505'?'Ya existe un participante con ese DNI. Buscalo en la lista.':((e as {message?:string})?.message??'No se pudo guardar. Verificá la conexión y reintentá.');

export class Curso {
 private fecha=fechaArgentina(); private buscar=''; private page=0; private readonly size=30;
 private total=0; private presentes=0; private participantes:Participante[]=[]; private asistencias:Asistencia[]=[];
 private loading=false; private busy=false; private error=''; private notice=''; private ready=false; private disposed=false; private generation=0;
 private demoRows:Participante[]=[]; private demoAttendance:Asistencia[]=[];
 constructor(private host:HTMLElement,private db:SupabaseClient|null,private userId:string,private demo:boolean){
  if(demo){try{const saved=JSON.parse(localStorage.getItem('upau-demo-curso-v1')??'null');this.demoRows=saved?.participantes??[];this.demoAttendance=saved?.asistencias??[];}catch{this.error='No se pudo recuperar la demostración local.';}}
 }
 start(){this.render();void this.load();}
 dispose(){this.disposed=true;this.generation++;}
 private persistDemo(){localStorage.setItem('upau-demo-curso-v1',JSON.stringify({participantes:this.demoRows,asistencias:this.demoAttendance}));}
 private async load(){
  const g=++this.generation;this.loading=true;this.ready=false;this.error='';this.render();
  try{
   if(this.demo){
    const matching=this.demoRows.filter(p=>[p.nombre,p.apellido,p.dni??''].some(v=>v.toLocaleLowerCase('es').includes(this.buscar.toLocaleLowerCase('es')))).sort((a,b)=>(a.apellido+a.nombre).localeCompare(b.apellido+b.nombre,'es'));
    this.total=matching.length;this.participantes=matching.slice(this.page*this.size,(this.page+1)*this.size);
    this.asistencias=this.demoAttendance.filter(a=>a.fecha===this.fecha&&this.participantes.some(p=>p.id===a.participante_id));
    this.presentes=this.demoAttendance.filter(a=>a.fecha===this.fecha&&a.presente).length;
   }else{
    let query=this.db!.from('curso_participantes').select('id,nombre,apellido,dni,telefono,created_at,updated_at,created_by',{count:'exact'}).order('apellido').order('nombre').order('id').range(this.page*this.size,(this.page+1)*this.size-1);
    // Limitar sintaxis de filtro evita que una búsqueda altere la expresión PostgREST.
    const term=this.buscar.normalize('NFC').replace(/[^\p{L}\p{N} \-]/gu,' ').trim().slice(0,100);
    if(term)query=query.or(`nombre.ilike.%${term}%,apellido.ilike.%${term}%,dni.ilike.%${term}%`);
    const result=await query;if(result.error)throw result.error;
    if(g!==this.generation||this.disposed)return;
    const ps=result.data as Participante[];
    const [attendance,count]=await Promise.all([
     ps.length?this.db!.from('curso_asistencias').select('participante_id,fecha,presente').eq('fecha',this.fecha).in('participante_id',ps.map(p=>p.id)):Promise.resolve({data:[],error:null}),
     this.db!.from('curso_asistencias').select('participante_id',{count:'exact',head:true}).eq('fecha',this.fecha).eq('presente',true)
    ]);
    if(attendance.error)throw attendance.error;if(count.error)throw count.error;
    if(g!==this.generation||this.disposed)return;
    this.participantes=ps;this.total=result.count??0;this.asistencias=attendance.data??[];this.presentes=count.count??0;
   }
   this.ready=true;
  }catch(e){if(g===this.generation&&!this.disposed){this.error=fallo(e);this.participantes=[];this.asistencias=[];}}
  finally{if(g===this.generation&&!this.disposed){this.loading=false;this.render();}}
 }
 private render(){
  if(this.disposed)return;
  const disabled=this.loading||this.busy;
  this.host.innerHTML=`<div class="page-head"><div><p class="eyebrow">PARTICIPANTES Y ASISTENCIA</p><h1>Curso</h1><p>La lista se conserva. Elegí el día y confirmá quiénes asistieron.</p></div><div class="curso-page-actions"><button class="secondary" id="curso-exportar" ${disabled?'disabled':''}>Exportar a Excel</button><button class="primary" id="curso-nuevo" ${disabled?'disabled':''}>Agregar participante</button></div></div>
   ${this.demo?'<div class="setup-note">DEMOSTRACIÓN · Datos ficticios guardados solo en este navegador. No usar para asistencia real.</div>':''}
   ${this.error?`<div class="alert" role="alert">${esc(this.error)}</div>`:''}${this.notice?`<div class="success" role="status">${esc(this.notice)}</div>`:''}
   <section class="card curso-toolbar"><label>Fecha de asistencia<input id="curso-fecha" type="date" value="${this.fecha}" ${disabled?'disabled':''}></label><form id="curso-buscar"><label>Buscar participante<input id="curso-query" type="search" maxlength="100" value="${esc(this.buscar)}" placeholder="Nombre, apellido o DNI" ${disabled?'disabled':''}></label><button class="secondary" ${disabled?'disabled':''}>Buscar</button></form><button class="secondary" id="curso-refresh" ${disabled?'disabled':''}>Actualizar</button></section>
   <div class="curso-summary" aria-live="polite">${this.loading?'Cargando lista…':this.ready?`<b>${this.presentes}</b> presentes el ${this.fecha.split('-').reverse().join('/')} · <b>${this.total}</b> participantes${this.buscar?' encontrados':''}`:'Lista sin actualizar. Actualizá para tomar asistencia.'}</div>
   <section class="card"><div class="asistencia-list">${this.participantes.map(p=>{const present=this.asistencias.some(a=>a.participante_id===p.id&&a.presente);return `<article class="asistencia-row"><div><h2>${esc(p.apellido)}, ${esc(p.nombre)}</h2><p>${p.dni?'DNI '+esc(p.dni):'Sin DNI registrado'}${p.telefono?' · '+esc(p.telefono):''}</p></div><div class="asistencia-actions"><button class="text-button" data-edit="${p.id}" ${disabled||!this.ready?'disabled':''}>Editar<span class="sr-only"> a ${esc(p.nombre)} ${esc(p.apellido)}</span></button><button class="attendance-button ${present?'is-present':''}" aria-pressed="${present}" data-attend="${p.id}" aria-label="${present?'Quitar asistencia de':'Confirmar asistencia de'} ${esc(p.nombre)} ${esc(p.apellido)}" ${disabled||!this.ready?'disabled':''}>${present?'✓ Presente':'Marcar presente'}</button></div></article>`;}).join('')}${this.ready&&!this.participantes.length?`<div class="empty">${this.buscar?'No hay participantes con esa búsqueda.':'Todavía no hay participantes. Agregá el primero para comenzar.'}</div>`:''}</div>
   <div class="curso-pagination"><button class="secondary" id="curso-prev" ${disabled||this.page===0?'disabled':''}>Anterior</button><span>Página ${this.page+1} de ${Math.max(1,Math.ceil(this.total/this.size))}</span><button class="secondary" id="curso-next" ${disabled||(this.page+1)*this.size>=this.total?'disabled':''}>Siguiente</button></div></section><div id="curso-modal"></div>`;
  this.host.querySelector('#curso-nuevo')!.addEventListener('click',()=>this.edit());
  this.host.querySelector('#curso-exportar')!.addEventListener('click',()=>this.exportar());
  this.host.querySelector<HTMLInputElement>('#curso-fecha')!.onchange=e=>{const date=(e.target as HTMLInputElement).value;if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){this.error='Elegí una fecha válida.';this.render();return;}this.fecha=date;this.notice='';void this.load();};
  this.host.querySelector<HTMLFormElement>('#curso-buscar')!.onsubmit=e=>{e.preventDefault();this.buscar=this.host.querySelector<HTMLInputElement>('#curso-query')!.value.trim();this.page=0;void this.load();};
  this.host.querySelector('#curso-refresh')!.addEventListener('click',()=>void this.load());
  this.host.querySelector('#curso-prev')!.addEventListener('click',()=>{this.page--;void this.load();});
  this.host.querySelector('#curso-next')!.addEventListener('click',()=>{this.page++;void this.load();});
  this.host.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(b=>b.onclick=()=>this.edit(this.participantes.find(p=>p.id===b.dataset.edit)));
  this.host.querySelectorAll<HTMLButtonElement>('[data-attend]').forEach(b=>b.onclick=()=>void this.mark(b.dataset.attend!));
 }
 private async mark(id:string){
  if(this.busy||!this.ready)return;
  const presente=!this.asistencias.some(a=>a.participante_id===id&&a.presente);
  this.busy=true;this.notice='';this.error='';this.render();
  try{
   if(this.demo){const next=this.demoAttendance.filter(a=>a.fecha!==this.fecha||a.participante_id!==id);next.push({participante_id:id,fecha:this.fecha,presente});const old=this.demoAttendance;this.demoAttendance=next;try{this.persistDemo();}catch(e){this.demoAttendance=old;throw e;}}
   else{const {error}=await this.db!.rpc('curso_marcar_asistencia',{p_participante:id,p_fecha:this.fecha,p_presente:presente});if(error)throw error;}
   this.notice=presente?'Asistencia confirmada.':'Marca de asistencia quitada.';
  }catch(e){this.error=fallo(e);this.busy=false;this.ready=false;this.render();return;}
  this.busy=false;await this.load();
 }
 private exportar(){
  if(this.busy||this.loading)return;
  const storageKey='upau-planilla-opciones-'+this.userId;
  let options:{curso:string;lugar:string;horario:string}={curso:'Sublimación',lugar:'Comité Capital',horario:'18 a 20'};
  try{const saved=JSON.parse(localStorage.getItem(storageKey)??'null');if(saved&&typeof saved.curso==='string'&&typeof saved.lugar==='string'&&typeof saved.horario==='string')options=saved;}catch{/* Preferencias opcionales: la exportación no depende del almacenamiento local. */}
  let fechas=fechasSemana(this.fecha);let saving=false;
  this.host.querySelector('#curso-modal')!.innerHTML=`<dialog class="export-dialog" aria-labelledby="export-title"><h2 id="export-title">Exportar planilla de asistencia</h2><p>Incluye todos los participantes. Las asistencias confirmadas se marcan con P y las demás celdas quedan vacías.</p><form id="export-form"><label>Curso<input name="curso" required maxlength="120" value="${esc(options.curso)}"></label><label>Lugar<input name="lugar" required maxlength="160" value="${esc(options.lugar)}"></label><label>Horario<input name="horario" required maxlength="80" value="${esc(options.horario)}"></label><fieldset class="export-dates"><legend>Fechas de clase</legend><div id="export-fechas"></div><button type="button" class="secondary" id="export-add-date">Agregar fecha</button></fieldset><p id="export-error" role="alert"></p><div class="actions"><button type="button" class="secondary" id="export-cancel">Cancelar</button><button type="submit" class="primary" id="export-download">Descargar Excel</button></div></form></dialog>`;
  const dialog=this.host.querySelector<HTMLDialogElement>('dialog')!;
  const readDates=()=>{fechas=Array.from(dialog.querySelectorAll<HTMLInputElement>('[data-export-date]'),el=>el.value);};
  const drawDates=()=>{
   dialog.querySelector('#export-fechas')!.innerHTML=fechas.map((date,i)=>`<div class="export-date-row"><label>Clase ${i+1}<input type="date" required data-export-date="${i}" value="${date}"></label><button type="button" class="text-button" data-remove-date="${i}" aria-label="Quitar fecha de clase ${i+1}" ${fechas.length===1?'disabled':''}>Quitar</button></div>`).join('');
   dialog.querySelector<HTMLButtonElement>('#export-add-date')!.disabled=fechas.length>=31;
   dialog.querySelectorAll<HTMLButtonElement>('[data-remove-date]').forEach(button=>button.onclick=()=>{readDates();fechas.splice(Number(button.dataset.removeDate),1);drawDates();});
  };
  drawDates();dialog.showModal();dialog.querySelector<HTMLInputElement>('input')!.focus();
  dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
  dialog.querySelector('#export-cancel')!.addEventListener('click',()=>{if(!saving)dialog.close();});
  dialog.querySelector('#export-add-date')!.addEventListener('click',()=>{readDates();const last=fechas.at(-1);const next=last?new Date(last+'T12:00:00Z'):new Date(this.fecha+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);fechas.push(Number.isNaN(next.getTime())?this.fecha:next.toISOString().slice(0,10));drawDates();});
  dialog.querySelector<HTMLFormElement>('form')!.onsubmit=async e=>{
   e.preventDefault();if(saving)return;readDates();
   const form=new FormData(e.currentTarget as HTMLFormElement),err=dialog.querySelector('#export-error')!;
   try{
    const input=prepararPlanilla({curso:String(form.get('curso')).trim(),lugar:String(form.get('lugar')).trim(),horario:String(form.get('horario')).trim(),fechas,participantes:[],asistencias:[]});
    saving=true;this.busy=true;err.textContent='';dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button').forEach(el=>el.disabled=true);dialog.querySelector('#export-download')!.textContent='Preparando Excel…';
    const data=this.demo?{participantes:[...this.demoRows],asistencias:this.demoAttendance.filter(a=>input.fechas.includes(a.fecha))}:await leerDatosCurso(this.db!,this.userId,input.fechas);
    if(this.disposed)return;
    descargarExcel({...input,...data});
    try{localStorage.setItem(storageKey,JSON.stringify({curso:input.curso,lugar:input.lugar,horario:input.horario}));}catch{/* Guardar preferencias es opcional. */}
    dialog.close();this.notice=`Excel descargado: ${data.participantes.length} participantes y ${input.fechas.length} fechas de clase.`;this.busy=false;this.render();
   }catch(e){saving=false;this.busy=false;err.textContent=fallo(e);dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button').forEach(el=>el.disabled=false);dialog.querySelector('#export-download')!.textContent='Descargar Excel';dialog.querySelector<HTMLButtonElement>('#export-add-date')!.disabled=fechas.length>=31;dialog.querySelectorAll<HTMLButtonElement>('[data-remove-date]').forEach(el=>el.disabled=fechas.length===1);}
  };
 }
 private edit(p?:Participante){
  if(this.busy)return;
  const id=p?.id??crypto.randomUUID();
  this.host.querySelector('#curso-modal')!.innerHTML=`<dialog aria-labelledby="curso-dialog-title"><h2 id="curso-dialog-title">${p?'Editar':'Agregar'} participante</h2><p>Se registra una vez y permanece en la lista de los próximos días.</p><form id="curso-form"><label>Nombre<input name="nombre" required maxlength="100" value="${esc(p?.nombre)}" autocomplete="given-name"></label><label>Apellido<input name="apellido" required maxlength="100" value="${esc(p?.apellido)}" autocomplete="family-name"></label><label>DNI (opcional)<input name="dni" inputmode="numeric" pattern="[0-9]{7,9}" maxlength="9" value="${esc(p?.dni)}"></label><label>Teléfono (opcional)<input name="telefono" type="tel" maxlength="40" value="${esc(p?.telefono)}"></label><p role="alert" id="curso-form-error"></p><div class="actions"><button type="button" class="secondary" id="curso-cancel">Cancelar</button><button class="primary">Guardar participante</button></div></form></dialog>`;
  const dialog=this.host.querySelector<HTMLDialogElement>('dialog')!;dialog.showModal();dialog.querySelector<HTMLInputElement>('input')!.focus();
  let saving=false;dialog.addEventListener('cancel',e=>{if(saving)e.preventDefault();});
  dialog.querySelector('#curso-cancel')!.addEventListener('click',()=>{if(!saving)dialog.close();});
  dialog.querySelector<HTMLFormElement>('form')!.onsubmit=async e=>{
   e.preventDefault();if(saving)return;
   const form=new FormData(e.currentTarget as HTMLFormElement);
   const nombre=String(form.get('nombre')).trim(),apellido=String(form.get('apellido')).trim(),dni=String(form.get('dni')).trim(),telefono=String(form.get('telefono')).trim();
   const err=dialog.querySelector('#curso-form-error')!;
   if(!nombre||!apellido){err.textContent='Completá nombre y apellido.';return;}
   saving=true;this.busy=true;dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button').forEach(b=>b.disabled=true);
   try{
    if(this.demo){if(dni&&this.demoRows.some(row=>row.dni===dni&&row.id!==id))throw new Error('Ya existe un participante con ese DNI.');const stamp=new Date().toISOString();const row:Participante={id,nombre,apellido,dni:dni||null,telefono,created_at:p?.created_at??stamp,updated_at:stamp,created_by:p?.created_by??this.userId};const old=this.demoRows;this.demoRows=[...this.demoRows.filter(r=>r.id!==id),row];try{this.persistDemo();}catch(e){this.demoRows=old;throw e;}}
    else{const {error}=await this.db!.rpc('curso_guardar_participante',{p_id:id,p_nombre:nombre,p_apellido:apellido,p_dni:dni||null,p_telefono:telefono,p_version:p?.updated_at??null});if(error)throw error;}
    dialog.close();this.notice=p?'Participante actualizado.':'Participante agregado. Ya queda disponible para los próximos días.';this.busy=false;await this.load();
   }catch(e){saving=false;this.busy=false;err.textContent=fallo(e);dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button').forEach(b=>b.disabled=false);}
  };
 }
}
