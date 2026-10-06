import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true});
const uid='11111111-1111-1111-1111-111111111111';
const profile={id:uid,display_name:'Fiscal de prueba',role:'fiscal',active:true};
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
const token=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:uid,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})+'.fake-signature';
const session={access_token:token,refresh_token:'fake-refresh-token',token_type:'bearer',expires_in:3600,user:{id:uid,email:'fiscal@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()}};
let control=null,requests=[],drop=true;
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.routeWebSocket(/supabase.co/,ws=>ws.close());
 await page.route('https://conteo-test.supabase.co/**',async route=>{
  const request=route.request(),u=new URL(request.url());
  const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  if(u.pathname.includes('/auth/v1/token'))return json(session);
  if(u.pathname.includes('/auth/v1/user'))return json(session.user);
  if(u.pathname.includes('/profiles'))return json(u.searchParams.has('id')?profile:[profile]);
  if(u.pathname.includes('/electoral_tables'))return json([{id:25,label:'025',active:true}]);
  if(u.pathname.includes('/audit_log'))return json([]);
  if(u.pathname.includes('/controls'))return json(control?[control]:[]);
  if(u.pathname.includes('/table_totals'))return json([{table_id:25,total:control?control.votes:0,reported:!!control,last_control:control?.created_at??null}]);
  if(u.pathname.includes('/submit_control')){
   const p=request.postDataJSON();requests.push(p.p_request);
   if(!control)control={id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',table_id:p.p_table,user_id:uid,remaining:p.p_remaining,votes:5-p.p_remaining,created_at:new Date().toISOString(),status:'valid',replaces_id:null,request_id:p.p_request};
   if(drop){drop=false;return route.abort('failed');}
   assert.equal(p.p_request,control.request_id);
   return json(control);
  }
  return route.fulfill({status:204});
 });
 await page.goto('http://127.0.0.1:4173/');
 await page.getByLabel('Correo electrónico').fill('fiscal@example.test');
 await page.getByLabel('Contraseña').fill('temporary-test-password');
 await page.getByRole('button',{name:'Ingresar',exact:true}).click();
 await page.getByRole('heading',{name:'Registrar control'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Panel general',exact:true}).count(),0);
 await page.locator('#table').selectOption('25');
 await page.getByRole('button',{name:'3',exact:true}).click();
 await page.getByRole('button',{name:/Revisar y continuar/}).click();
 await page.locator('#replenish').check();
 await page.getByRole('button',{name:'Confirmar y registrar'}).click();
 await page.getByRole('button',{name:'Verificar / reintentar envío'}).waitFor();
 assert.ok(await page.evaluate(()=>localStorage.getItem('conteo-pending-11111111-1111-1111-1111-111111111111')));
 await page.reload();
 await page.getByRole('button',{name:'Verificar / reintentar envío'}).click();
 await page.getByRole('status').filter({hasText:'Control registrado'}).waitFor();
 assert.equal(requests.length,2);
 assert.equal(requests[0],requests[1]);
 assert.equal(control.votes,2);
 assert.equal(await page.evaluate(()=>localStorage.getItem('conteo-pending-11111111-1111-1111-1111-111111111111')),null);
 assert.match(await page.getByRole('status').textContent(),/Acumulado: 2/);
 assert.deepEqual(errors,[]);
 console.log('OK: mocked Supabase authentication, fiscal role, lost response after server commit, reload recovery, same UUID, +2 exactly once.');
} finally {await browser.close();}

