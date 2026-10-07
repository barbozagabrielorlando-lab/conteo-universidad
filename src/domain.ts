export type Profile = {id:string; display_name:string; role:'fiscal'|'admin'; active:boolean};
export type Table = {id:number; label:string; active:boolean};
export type Control = {id:string; table_id:number; user_id:string; remaining:number; votes:number; created_at:string; status:'valid'|'corrected'|'void'; replaces_id:string|null; request_id:string};
export type Audit = {id:number; control_id:string; actor_id:string; action:string; reason:string; created_at:string; replacement_id:string|null};
export function votesFor(remaining:number) {if (!Number.isInteger(remaining)||remaining< -5||remaining>5) throw new Error('Elegí votos entre 0 y 10.'); return 5-remaining;}
export function summarize(tables:Table[],controls:Control[]) {
 return tables.map(table=>{const rows=controls.filter(c=>c.table_id===table.id); const valid=rows.filter(c=>c.status==='valid');return {...table,total:valid.reduce((n,c)=>n+c.votes,0),reported:rows.length>0,last:rows.reduce((s,c)=>c.created_at>s?c.created_at:s,'')};});
}
