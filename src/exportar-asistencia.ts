/** Exportador XLSX del navegador. Solo datos en celdas, sin macros ni fórmulas. */
export type PersonaPlanilla={id:string;nombre:string;apellido:string;telefono:string};
export type MarcaPlanilla={participante_id:string;fecha:string;presente:boolean};
export type DatosPlanilla={curso:string;lugar:string;horario:string;fechas:string[];participantes:PersonaPlanilla[];asistencias:MarcaPlanilla[]};
const xml=(v:unknown)=>String(v??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const encoder=new TextEncoder();
const xmlStart='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export function columnaExcel(index:number){let value='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))value=String.fromCharCode(65+(n-1)%26)+value;return value;}
export function fechasSemana(fecha:string){const date=new Date(fecha+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));return Array.from({length:5},(_,i)=>new Date(date.getTime()+i*86400000).toISOString().slice(0,10));}
function fechaValida(s:string){return /^\d{4}-\d{2}-\d{2}$/.test(s)&&s>='1901-01-01'&&s<='9999-12-31'&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
export function prepararPlanilla(input:DatosPlanilla){
 if(!input.curso.trim()||!input.lugar.trim()||!input.horario.trim())throw new Error('Completá curso, lugar y horario.');
 if(input.fechas.length<1||input.fechas.length>31||input.fechas.some(f=>!fechaValida(f)))throw new Error('Elegí entre 1 y 31 fechas válidas.');
 if(new Set(input.fechas).size!==input.fechas.length)throw new Error('Hay fechas repetidas. Cada clase debe tener una fecha diferente.');
 return {...input,fechas:[...input.fechas].sort(),participantes:[...input.participantes].sort((a,b)=>a.apellido.localeCompare(b.apellido,'es')||a.nombre.localeCompare(b.nombre,'es')||a.id.localeCompare(b.id))};
}
function textCell(ref:string,value:string,style:number){return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;}
function numberCell(ref:string,value:number,style:number){return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;}
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let b=0;b<8;b++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
// ZIP sin compresión: OOXML estándar, sin dependencias ni envío a servicios externos.
function zip(entries:Record<string,string>){
 const chunks:Uint8Array[]=[];const directory:Uint8Array[]=[];let offset=0;
 for(const [path,content] of Object.entries(entries)){
  const name=encoder.encode(path),data=encoder.encode(content),crc=crc32(data);
  const header=new Uint8Array(30+name.length),view=new DataView(header.buffer);
  view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x0800,true);view.setUint16(12,0x21,true);view.setUint32(14,crc,true);view.setUint32(18,data.length,true);view.setUint32(22,data.length,true);view.setUint16(26,name.length,true);header.set(name,30);
  chunks.push(header,data);
  const central=new Uint8Array(46+name.length),cv=new DataView(central.buffer);
  cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x0800,true);cv.setUint16(14,0x21,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);central.set(name,46);directory.push(central);offset+=header.length+data.length;
 }
 const centralSize=directory.reduce((sum,b)=>sum+b.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);
 ev.setUint32(0,0x06054b50,true);ev.setUint16(8,directory.length,true);ev.setUint16(10,directory.length,true);ev.setUint32(12,centralSize,true);ev.setUint32(16,offset,true);
 const result=new Uint8Array(offset+centralSize+end.length);let cursor=0;for(const part of [...chunks,...directory,end]){result.set(part,cursor);cursor+=part.length;}return result;
}
export function crearExcelAsistencia(input:DatosPlanilla){
 const data=prepararPlanilla(input),cols=3+data.fechas.length,last=columnaExcel(cols-1),endRow=7+Math.max(30,data.participantes.length);
 const months=[...new Set(data.fechas.map(d=>new Intl.DateTimeFormat('es-AR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'))))].join(' / ');
 const present=new Set(data.asistencias.filter(a=>a.presente).map(a=>a.participante_id+'|'+a.fecha));
 const rows=[`<row r="1" ht="30" customHeight="1">${textCell('A1','Planilla de Asistencia',1)}</row>`];
 for(const [i,label,value] of [[2,'Curso',data.curso],[3,'Lugar',data.lugar],[4,'Horario',data.horario],[5,'Mes',months]] as [number,string,string][]){
  rows.push(`<row r="${i}" ht="${Math.max(20,Math.ceil(value.length/(19+data.fechas.length*12))*15)}" customHeight="1">${Array.from({length:cols},(_,c)=>textCell(columnaExcel(c)+i,c===1?label:c===2?value:'',2)).join('')}</row>`);
 }
 rows.push(`<row r="6" ht="22" customHeight="1">${textCell('A6','',3)+textCell('B6','Fecha',3)+textCell('C6','',3)+data.fechas.map((date,i)=>numberCell(columnaExcel(i+3)+'6',Math.round((Date.parse(date+'T00:00:00Z')-Date.UTC(1899,11,30))/86400000),5)).join('')}</row>`);
 rows.push(`<row r="7" ht="24" customHeight="1">${['Nº','Nombre y Apellido','Teléfono',...data.fechas.map((_,i)=>'Clase '+(i+1))].map((title,i)=>textCell(columnaExcel(i)+'7',title,i===1||i===2?3:4)).join('')}</row>`);
 for(let r=8;r<=endRow;r++){
  const p=data.participantes[r-8];
  const cells=[numberCell('A'+r,r-7,4),textCell('B'+r,p?`${p.nombre} ${p.apellido}`:'',3),textCell('C'+r,p?.telefono??'',6),...data.fechas.map((date,i)=>textCell(columnaExcel(i+3)+r,p&&present.has(p.id+'|'+date)?'P':'',4))];
  // Nombre/telefono largos se envuelven y aumentan la altura para impresión legible.
  const lines=p?Math.max(Math.ceil((p.nombre.length+p.apellido.length+1)/30),Math.ceil(p.telefono.length/17),1):1;
  rows.push(`<row r="${r}" ht="${Math.max(21,lines*15)}" customHeight="1">${cells.join('')}</row>`);
 }
 const sheet=xmlStart+`<worksheet xmlns="${ns}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${last}${endRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="3" ySplit="7" topLeftCell="D8" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="21"/><cols><col min="1" max="1" width="5" customWidth="1"/><col min="2" max="2" width="32" customWidth="1"/><col min="3" max="3" width="19" customWidth="1"/><col min="4" max="${cols}" width="12" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><mergeCells count="5"><mergeCell ref="A1:${last}1"/>${[2,3,4,5].map(r=>`<mergeCell ref="C${r}:${last}${r}"/>`).join('')}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="${data.fechas.length>5?'landscape':'portrait'}" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;C&amp;P / &amp;N</oddFooter></headerFooter></worksheet>`;
 const styles=xmlStart+`<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="[$-es-AR]d-mmm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><sz val="16"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="3"><border/><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom></border><border><left style="hair"><color rgb="FFD9D9D9"/></left><right style="hair"><color rgb="FFD9D9D9"/></right><top style="hair"><color rgb="FFD9D9D9"/></top><bottom style="hair"><color rgb="FFD9D9D9"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
 return zip({
  '[Content_Types].xml':xmlStart+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
  '_rels/.rels':xmlStart+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':xmlStart+`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Asistencia" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Asistencia'!$A$1:$${last}$${endRow}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">'Asistencia'!$1:$7</definedName></definedNames></workbook>`,
  'xl/_rels/workbook.xml.rels':xmlStart+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  'xl/styles.xml':styles,'xl/worksheets/sheet1.xml':sheet
 });
}
export function descargarExcel(input:DatosPlanilla){
 const data=prepararPlanilla(input),bytes=crearExcelAsistencia(data);
 const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;
 const name=data.curso.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9 -]/g,'').trim().replace(/\s+/g,'-').slice(0,70)||'curso';
 link.download=`Asistencia-${name}-${data.fechas[0]}.xlsx`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
