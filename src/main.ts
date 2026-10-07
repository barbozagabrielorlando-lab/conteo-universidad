import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { votesFor, type Profile, type Table, type Control, type Audit } from './domain';
import './style.css';

const root=document.querySelector<HTMLDivElement>('#app')!;
const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const configured=!!url&&!!key&&!url.includes('TU-PROYECTO');
const db:SupabaseClient|null=configured?createClient(url!,key!):null;
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const time=(s:string)=>s?new Date(s).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'Sin controles';
let profile:Profile|null=null,tables:Table[]=[],controls:Control[]=[],audits:Audit[]=[],profiles:Profile[]=[];
type Total={table_id:number;total:number;reported:boolean;last_control:string|null};
let totals:Total[]=[],view='load',selected=0,remaining:number|null=null,busy=false,error='',notice='',sync='Conectando',lastSync='',demo=false,loading=false;
type Pending={table:number;remaining:number;request:string};
let pending:Pending|null=null;
const storageKey=()=> 'conteo-pending-'+profile!.id;
let channel:ReturnType<SupabaseClient['channel']>|null=null;
let generation=0;
let refreshTimer:ReturnType<typeof setTimeout>|undefined;
const brand='<a class="brand" href="#inicio"><span class="brand-icon">U</span><span>UPAU</span></a>';
const buttons=(value:number|null)=>'<div class="numbers" role="group" aria-label="Votos estimados">'+[0,1,2,3,4,5].map(n=>'<button type="button" class="number '+(value===5-n?'chosen':'')+'" aria-pressed="'+(value===5-n)+'" data-number="'+(5-n)+'" '+(busy||pending?'disabled':'')+'>'+n+'</button>').join('')+'</div>';
const person=(id:string)=>profiles.find(p=>p.id===id)?.display_name??(id===profile?.id?profile.display_name:id.slice(0,8));
function render(){
 if(!profile){login();return;}
 const admin=profile.role==='admin';
 if(!admin&&view==='dashboard')view='load';
 root.innerHTML='<header>'+brand+'<div class="user">'+esc(profile.display_name)+' <span class="role">'+(admin?'Administración':'Fiscal')+'</span><button id="logout" class="text-button">Salir</button></div></header>'+
 '<div class="disclaimer">'+(demo?'<strong>DEMOSTRACIÓN · Datos ficticios · No se envía información.</strong>':'Estimación interna basada en consumo de boletas. No es el escrutinio oficial.')+'</div>'+
 '<div class="layout"><aside><p class="eyebrow">JORNADA ELECTORAL</p><nav>'+[['load','Registrar control'],['history','Historial de controles'],...(admin?[['dashboard','Panel general']]:[])].map(([id,label])=>'<button data-view="'+id+'" class="'+(view===id?'active':'')+'">'+label+'</button>').join('')+'</nav><div class="side-note"><span aria-hidden="true">🐱</span><b>Cada control cuenta.</b><p>Revisá, registrá y reponé las boletas hasta llegar a cinco.</p></div></aside><main>'+
 (error?'<div class="alert" role="alert">'+esc(error)+'</div>':'')+(notice?'<div class="success" role="status">'+esc(notice)+'</div>':'')+
 (view==='load'?loadView():view==='history'?historyView():dashboard())+'</main></div><footer><span>Conteo provisorio · uso interno</span><span id="sync">'+esc(sync)+(lastSync?' · '+time(lastSync):'')+'</span></footer><div id="modal"></div>';
 root.querySelector('#logout')!.addEventListener('click',async()=>{if(busy)return;generation++;if(channel&&db)await db.removeChannel(channel);channel=null;if(db)await db.auth.signOut();profile=null;tables=[];controls=[];audits=[];totals=[];pending=null;notice='';error='';demo=false;render();});
 root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>{if(busy)return;view=b.dataset.view!;error='';render();});
 root.querySelectorAll<HTMLButtonElement>('[data-number]').forEach(b=>b.onclick=()=>{remaining=Number(b.dataset.number);render();});
 root.querySelector<HTMLSelectElement>('#table')?.addEventListener('change',e=>{selected=Number((e.target as HTMLSelectElement).value);remaining=null;notice='';render();});
 root.querySelector('#review')?.addEventListener('click',confirmControl);
 root.querySelector('#retry')?.addEventListener('click',()=>sendControl());
 root.querySelectorAll<HTMLButtonElement>('[data-revise]').forEach(b=>b.onclick=()=>reviseDialog(b.dataset.revise!));
 root.querySelector('#refresh')?.addEventListener('click',()=>{void refresh();});
}
function login(){
 root.innerHTML='<header>'+brand+'</header><main class="login"><section class="login-intro"><p class="eyebrow">ELECCIÓN UNIVERSITARIA</p><h1>El conteo de UPAU,<br>en tiempo real.</h1><p>Registrá los votos estimados de tu mesa y acompañá el conteo interno durante la jornada.</p><div class="intro-note">🐱 Cada registro conserva su historial.</div></section><section class="card login-card"><p class="eyebrow">ACCESO DEL EQUIPO</p><h2>Ingresá a tu cuenta</h2><p>Usá el correo y la contraseña que te asignaron.</p><form id="login"><label>Correo electrónico<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required minlength="6"></label><button class="primary" '+(!db||busy?'disabled':'')+'>Ingresar</button></form>'+(error?'<p class="alert" role="alert">'+esc(error)+'</p>':'')+(!db?'<div class="setup-note">El proyecto todavía no está conectado a Supabase. Podés explorar una demostración local.</div><button id="demo" class="secondary">Explorar demostración</button>':'')+'</section></main><footer>Estimación provisoria interna. No es el escrutinio oficial.<small style="display:block;margin-top:6px;font-size:10px;opacity:.7">Software Pequeño J</small></footer>';
 root.querySelector('#demo')?.addEventListener('click',startDemo);
 root.querySelector<HTMLFormElement>('#login')!.onsubmit=async e=>{
 e.preventDefault();if(!db||busy)return;busy=true;error='';const form=new FormData(e.currentTarget as HTMLFormElement); const button=root.querySelector<HTMLButtonElement>('.primary')!;button.disabled=true;button.textContent='Ingresando…';
 try{const {error:err}=await db.auth.signInWithPassword({email:String(form.get('email')),password:String(form.get('password'))});if(err)throw err;}catch(e){error=message(e);}finally{busy=false;if(!profile)render();}
 };
}
function loadView(){
 const total=totals.find(t=>t.table_id===selected);
 return '<div class="page-head"><div><p class="eyebrow">CARGA DE LA MESA</p><h1>Registrar control</h1><p>Contá las boletas disponibles antes de reponerlas.</p></div><span class="pill">Carga directa</span></div>'+
 '<div class="load-grid"><section class="card"><label for="table">1. Seleccioná tu mesa</label><select id="table" '+(busy||pending?'disabled':'')+'><option value="0">Elegir una mesa</option>'+tables.filter(t=>t.active).map(t=>'<option value="'+t.id+'" '+(t.id===selected?'selected':'')+'>Mesa '+esc(t.label)+'</option>').join('')+'</select>'+
 '<h2 class="question">2. ¿Cuántos votos estimás en este control?</h2><p>Elegí los votos nuevos de este control, entre 0 y 5. No ingreses el acumulado.</p>'+buttons(remaining)+
 '<div class="estimate"><span>Votos estimados en este control</span><strong>'+(remaining===null?'—':'+'+votesFor(remaining))+'</strong></div>'+
 (pending?'<div class="alert">Hay un envío pendiente de verificar. Reintentá el mismo control: no se duplicará.</div><button id="retry" class="primary" '+(busy?'disabled':'')+'>'+(busy?'Verificando…':'Verificar / reintentar envío')+'</button>':'<button id="review" class="primary" '+(!selected||remaining===null||busy?'disabled':'')+'>Registrar control</button>')+'</section>'+
 '<section class="card table-card"><p class="eyebrow">TU MESA</p><h2>'+(selected?'Mesa '+esc(tables.find(t=>t.id===selected)?.label):'Seleccioná una mesa')+'</h2><div class="big-total">'+(total?.total??'—')+'</div><p>votos estimados acumulados</p><hr><p><b>Último control</b><br>'+time(total?.last_control??'')+'</p><div class="hint">Después de cada control, las boletas deben volver a ser <b>5</b>. Cada envío suma votos nuevos.</div></section></div>';
}
function historyView(){
 return '<div class="page-head"><div><p class="eyebrow">TRAZABILIDAD</p><h1>Historial de controles</h1><p>'+(profile?.role==='admin'?'Todos los registros y sus correcciones.':'Tus registros individuales. Podés corregirlos durante 15 minutos.')+'</p></div><button class="secondary" id="refresh">Actualizar</button></div><section class="card table-wrap"><table><thead><tr><th>Mesa / hora</th><th>Fiscal</th><th>Votos</th><th>Estado</th><th>Acción</th></tr></thead><tbody>'+
 [...controls].sort((a,b)=>b.created_at.localeCompare(a.created_at)).map(c=>{
 const editable=c.status==='valid'&&(profile?.role==='admin'||(c.user_id===profile?.id&&Date.now()-Date.parse(c.created_at)<15*60*1000&&tables.some(t=>t.id===c.table_id)));
 const logs=audits.filter(a=>a.control_id===c.id);
 return '<tr><td><b>'+esc(tables.find(t=>t.id===c.table_id)?.label??c.table_id)+'</b><small>'+time(c.created_at)+'</small></td><td>'+esc(person(c.user_id))+'</td><td><b>+'+c.votes+'</b></td><td><span class="status '+c.status+'">'+({valid:'Válido',corrected:'Corregido',void:'Anulado'}[c.status])+'</span>'+
 (c.replaces_id?'<small>Reemplaza '+esc(c.replaces_id.slice(0,8))+'</small>':'')+logs.filter(l=>l.action!=='created').map(l=>'<small>'+esc(l.reason)+' · '+esc(person(l.actor_id))+' · '+time(l.created_at)+'</small>').join('')+'</td><td>'+(editable?'<button class="text-button" data-revise="'+c.id+'">Corregir / anular</button>':'—')+'</td></tr>';
 }).join('')+'</tbody></table>'+(!controls.length?'<div class="empty">Todavía no hay controles registrados.</div>':'')+'</section>';
}
function dashboard(){
 const total=totals.reduce((n,t)=>n+Number(t.total),0),reported=totals.filter(t=>t.reported).length;
 const last=totals.map(t=>t.last_control??'').sort().at(-1)??'';
 const valid=controls.filter(c=>c.status==='valid').sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const byHour=new Map<string,number>();for(const c of valid){const h=new Date(c.created_at).toLocaleTimeString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',hour12:false});byHour.set(h,(byHour.get(h)??0)+c.votes);}
 let sum=0;const points=valid.map(c=>({x:Date.parse(c.created_at),y:sum+=c.votes}));
 const min=points[0]?.x??0,max=points.at(-1)?.x??1;
 const xy=points.map(p=>((p.x-min)/(max-min||1)*540+20).toFixed(1)+','+(155-p.y/Math.max(1,total)*130).toFixed(1));
 const line=points.length?'<svg viewBox="0 0 580 190" role="img" aria-label="Evolución: '+total+' votos estimados"><path d="M20 155 H560" stroke="#dce5de" fill="none"/><polyline points="20,155 '+xy.join(' ')+'" fill="none" stroke="#24755e" stroke-width="3"/>'+points.map((p,i)=>'<circle cx="'+xy[i].split(',')[0]+'" cy="'+xy[i].split(',')[1]+'" r="3" fill="#24755e"><title>'+time(new Date(p.x).toISOString())+': '+p.y+'</title></circle>').join('')+'<text x="20" y="184" font-size="12">'+esc(time(valid[0].created_at))+'</text><text x="560" y="184" text-anchor="end" font-size="12">'+esc(time(valid.at(-1)!.created_at))+'</text></svg>':'<div class="empty">La evolución aparecerá con el primer control.</div>';
 return '<div class="page-head"><div><p class="eyebrow">SEGUIMIENTO EN VIVO</p><h1>Panel general <span aria-hidden="true" class="cat">🐱</span></h1><p>La jornada, mesa por mesa.</p></div><button class="secondary" id="refresh">Actualizar</button></div>'+
 '<div class="stats"><section class="stat featured"><span>Votos estimados</span><strong>'+total+'</strong><small>Acumulado provisorio</small></section><section class="stat"><span>Mesas reportadas</span><strong>'+reported+' <em>/ '+tables.length+'</em></strong><small>'+Math.round(reported/Math.max(1,tables.length)*100)+'% de las mesas</small></section><section class="stat"><span>Sin reportar</span><strong>'+(tables.length-reported)+'</strong><small>Mesas sin controles</small></section><section class="stat"><span>Último control</span><strong class="time-stat">'+(last?new Date(last).toLocaleTimeString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',minute:'2-digit'}):'—')+'</strong><small>Hora de Argentina</small></section></div>'+
 '<div class="charts"><section class="card"><h2>Evolución del acumulado</h2><p>Controles vigentes, ordenados por hora.</p>'+line+'</section><section class="card"><h2>Ritmo por hora</h2><p>Votos estimados agregados por hora.</p><div class="bars">'+[...byHour].sort().map(([h,n])=>'<div><span>'+esc(h)+':00</span><i style="width:'+Math.max(2,n/Math.max(1,...byHour.values())*65)+'%"></i><b>'+n+'</b></div>').join('')+(!byHour.size?'<div class="empty">Sin registros todavía.</div>':'')+'</div></section></div>'+
 '<section class="card table-wrap"><h2>Resumen por mesa</h2><table><thead><tr><th>Mesa</th><th>Estimación</th><th>Distribución</th><th>Último control</th><th>Reporte</th></tr></thead><tbody>'+tables.map(t=>{const s=totals.find(x=>x.table_id===t.id);return '<tr><td><b>'+esc(t.label)+'</b>'+(!t.active?'<small>Cerrada</small>':'')+'</td><td><b>'+(s?.total??0)+'</b></td><td><div class="mini-bar"><i style="width:'+Number(s?.total??0)/Math.max(1,...totals.map(x=>Number(x.total)))*100+'%"></i></div></td><td>'+time(s?.last_control??'')+'</td><td><span class="status '+(s?.reported?'valid':'waiting')+'">'+(s?.reported?'Reportada':'Sin reportar')+'</span></td></tr>';}).join('')+'</tbody></table></section>';
}
function showModal(html:string){const holder=root.querySelector('#modal')!;holder.innerHTML='<dialog aria-labelledby="dialog-title">'+html+'</dialog>';const d=holder.querySelector('dialog')!;d.showModal();d.querySelector<HTMLInputElement>('input,button')?.focus();d.addEventListener('cancel',e=>{if(busy)e.preventDefault();});return d;}
function confirmControl(){
 if(!selected||remaining===null||busy||pending)return;
 const next={table:selected,remaining:remaining!,request:crypto.randomUUID()};
 try{if(!demo)localStorage.setItem(storageKey(),JSON.stringify(next));}
 catch{error='El navegador no permite guardar el envío pendiente. Habilitá el almacenamiento local antes de registrar.';render();return;}
 pending=next;void sendControl();
}
async function sendControl(){
 if(!pending||busy)return;busy=true;error='';notice='';render();const p={...pending};
 try{
 let c:Control,accumulated:number|null=null;
 if(demo){c={id:crypto.randomUUID(),table_id:p.table,user_id:profile!.id,remaining:p.remaining,votes:votesFor(p.remaining),created_at:new Date().toISOString(),status:'valid',replaces_id:null,request_id:p.request};controls.push(c);demoTotals();accumulated=totals.find(t=>t.table_id===p.table)?.total??null;}
 else {const {data,error:err}=await db!.rpc('submit_control',{p_table:p.table,p_remaining:p.remaining,p_request:p.request});if(err)throw err;c=data;if(!controls.some(x=>x.id===c.id))controls.push(c);const result=await db!.rpc('table_totals');if(!result.error){totals=result.data;accumulated=totals.find(t=>t.table_id===p.table)?.total??null;}await refresh(false);}
 pending=null;if(!demo)localStorage.removeItem(storageKey());remaining=null;
 notice='🐱 Control registrado · Mesa '+(tables.find(t=>t.id===p.table)?.label??p.table)+' · +'+c.votes+' votos estimados · Acumulado: '+(accumulated??'pendiente de actualizar')+' · '+time(c.created_at);
 }catch(e){error=message(e);if((e as {code?:string}).code==='P0001'){pending=null;if(!demo)localStorage.removeItem(storageKey());}}
 finally{busy=false;render();}
}
function reviseDialog(id:string){
 const c=controls.find(c=>c.id===id)!;let replacement=c.remaining;
 const request=crypto.randomUUID();
 const d=showModal('<h2 id="dialog-title">Corregir o anular</h2><p>Mesa '+esc(tables.find(t=>t.id===c.table_id)?.label??c.table_id)+' · '+time(c.created_at)+' · Original: +'+c.votes+'</p><label>Tipo<select id="revision-kind"><option value="correct">Corregir cantidad</option><option value="void">Anular control</option></select></label><div id="revision-numbers">'+buttons(replacement)+'</div><label>Motivo obligatorio<textarea id="reason" minlength="5" maxlength="500" placeholder="Explicá qué ocurrió"></textarea></label><p>El registro original y el motivo quedarán en el historial.</p><p id="revision-error" role="alert"></p><div class="actions"><button id="cancel" class="secondary">Cancelar</button><button id="save" class="primary">Confirmar cambio</button></div>');
 d.querySelectorAll<HTMLButtonElement>('[data-number]').forEach(b=>b.onclick=()=>{replacement=Number(b.dataset.number);d.querySelectorAll('[data-number]').forEach(x=>{x.classList.toggle('chosen',x===b);x.setAttribute('aria-pressed',String(x===b));});});
 d.querySelector('#revision-kind')!.addEventListener('change',e=>{(d.querySelector('#revision-numbers') as HTMLElement).hidden=(e.target as HTMLSelectElement).value==='void';});
 d.querySelector('#cancel')!.addEventListener('click',()=>{if(!busy)d.close();});
 d.querySelector<HTMLButtonElement>('#save')!.onclick=async()=>{
 const reason=(d.querySelector('#reason') as HTMLTextAreaElement).value.trim(),isVoid=(d.querySelector('#revision-kind') as HTMLSelectElement).value==='void';
 const err=d.querySelector('#revision-error')!;if(reason.length<5){err.textContent='Ingresá un motivo de al menos 5 caracteres.';return;}
 if(busy)return;busy=true;d.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('button,input,select,textarea').forEach(x=>x.disabled=true);
 try{
 if(demo){c.status=isVoid?'void':'corrected';let next:string|null=null;if(!isVoid){next=crypto.randomUUID();controls.push({...c,id:next,user_id:profile!.id,remaining:replacement,votes:votesFor(replacement),created_at:new Date().toISOString(),status:'valid',replaces_id:c.id,request_id:request});}audits.push({id:audits.length+1,control_id:id,actor_id:profile!.id,action:isVoid?'void':'corrected',reason,created_at:new Date().toISOString(),replacement_id:next});demoTotals();}
 else{const {error:e}=await db!.rpc('revise_control',{p_id:id,p_remaining:isVoid?null:replacement,p_reason:reason,p_request:request});if(e)throw e;await refresh(false);}
 notice='Cambio registrado. El original permanece en el historial.';d.close();busy=false;render();
 }catch(e){busy=false;err.textContent=message(e);d.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('button,input,select,textarea').forEach(x=>x.disabled=false);}
 };
}
function message(e:unknown){return navigator.onLine?((e as {message?:string})?.message??'No se pudo completar la operación. Reintentá.'):'Sin conexión. El envío no está confirmado; verificá o reintentá cuando vuelva internet.';}
async function allRows<T>(table:string):Promise<T[]>{const rows:T[]=[];for(let from=0;;from+=1000){const {data,error}=await db!.from(table).select('*').order(table==='audit_log'?'id':table==='controls'?'created_at':'id').range(from,from+999);if(error)throw error;rows.push(...data as T[]);if(data.length<1000)return rows;}}
async function refresh(draw=true){
 if(demo){demoTotals();if(draw&&!busy)render();return;}
 if(!db||!profile||loading)return;loading=true;const g=generation;
 try{
 const {data:p,error:pe}=await db.from('profiles').select('*').eq('id',profile.id).single();if(g!==generation)return;if(pe)throw pe;if(!p.active){profile=null;error='Tu cuenta está deshabilitada. Contactá a administración.';render();return;}profile=p;
 const [ts,cs,as,ps,res]=await Promise.all([allRows<Table>('electoral_tables'),allRows<Control>('controls'),allRows<Audit>('audit_log'),allRows<Profile>('profiles'),db.rpc('table_totals')]);
 if(res.error)throw res.error;if(g!==generation)return;
 tables=ts;controls=cs;audits=as;profiles=ps;totals=res.data;lastSync=new Date().toISOString();if(!channel)sync='Actualización periódica';
 if(selected&&!tables.some(t=>t.id===selected))selected=0;
 if(draw&&!busy&&!root.querySelector('dialog[open]'))render();
 }catch(e){if(g===generation){error='No se pudo actualizar: '+message(e);sync='Datos sin actualizar';if(draw&&!busy&&!root.querySelector('dialog[open]'))render();}}
 finally{loading=false;}
}
async function sessionUser(userId:string){
 if(!db)return;generation++;const g=generation;
 if(profile?.id!==userId){profile=null;tables=[];controls=[];audits=[];profiles=[];totals=[];selected=0;remaining=null;pending=null;notice='';lastSync='';render();}
 const {data,error:err}=await db.from('profiles').select('*').eq('id',userId).single();
 if(g!==generation)return;
 if(err||!data?.active){profile=null;error='Cuenta sin habilitar. Pedí al administrador que active tu usuario y asigne tu mesa.';render();return;}
 profile=data;view=profile!.role==='admin'?'dashboard':'load';error='';
 try{pending=JSON.parse(localStorage.getItem(storageKey())??'null');if(pending){selected=pending.table;remaining=pending.remaining;}}catch{pending=null;}
 await refresh(false);render();
 if(channel)await db.removeChannel(channel);
 channel=db.channel('conteo-'+userId).on('postgres_changes',{event:'*',schema:'public'},()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>void refresh(),250);}).subscribe(status=>{sync=status==='SUBSCRIBED'?'En vivo':status==='CHANNEL_ERROR'||status==='TIMED_OUT'?'Reconectando · respaldo cada 20 s':'Conectando';const el=root.querySelector('#sync');if(el)el.textContent=sync;});
}
function demoTotals(){totals=tables.map(t=>{const cs=controls.filter(c=>c.table_id===t.id);return {table_id:t.id,total:cs.filter(c=>c.status==='valid').reduce((n,c)=>n+c.votes,0),reported:!!cs.length,last_control:cs.map(c=>c.created_at).sort().at(-1)??null};});sync='Demostración local';lastSync=new Date().toISOString();}
function startDemo(){
 demo=true;profile={id:'demo-admin',display_name:'Equipo UPAU',role:'admin',active:true};profiles=[profile,{id:'demo-fiscal',display_name:'Lucía · Fiscal',role:'fiscal',active:true}];
 tables=Array.from({length:8},(_,i)=>({id:i+1,label:String(i+1).padStart(3,'0'),active:true}));
 controls=Array.from({length:32},(_,i)=>({id:crypto.randomUUID(),table_id:i%6+1,user_id:'demo-fiscal',remaining:i%5,votes:5-i%5,created_at:new Date(Date.now()-(32-i)*240000).toISOString(),status:'valid' as const,replaces_id:null,request_id:crypto.randomUUID()}));audits=[];selected=0;remaining=null;pending=null;view='dashboard';demoTotals();render();
}
window.addEventListener('online',()=>void refresh());window.addEventListener('offline',()=>{sync='Sin conexión';const el=root.querySelector('#sync');if(el)el.textContent=sync;});
setInterval(()=>{if(profile&&!demo)void refresh();},20000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&profile)void refresh();});
render();
if(db){db.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){generation++;profile=null;render();}else if(session&&(event==='SIGNED_IN'||event==='INITIAL_SESSION'))setTimeout(()=>void sessionUser(session.user.id),0);});}
