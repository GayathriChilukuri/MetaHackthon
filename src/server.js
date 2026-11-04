import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {seed} from './seed.js';
import {plan} from './engine.js';
import {validateSales} from './imports.js';
import {askMeta} from './copilot.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const dataDirectory=process.env.STOCKWISE_DATA_DIR||path.join(root,'data');
await mkdir(dataDirectory,{recursive:true});
const db=new DatabaseSync(path.join(dataDirectory,'stockwise.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS snapshot(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL); CREATE TABLE IF NOT EXISTS imports(hash TEXT PRIMARY KEY, mode TEXT NOT NULL);');
let state; const saved=db.prepare('SELECT data FROM snapshot WHERE id=1').get();
state=saved?JSON.parse(saved.data):seed();
function save(action,detail){db.exec('BEGIN');try{db.prepare('INSERT OR REPLACE INTO snapshot VALUES(1,?)').run(JSON.stringify(state));db.prepare('INSERT INTO audit(at,action,detail) VALUES(?,?,?)').run(new Date().toISOString(),action,JSON.stringify(detail));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
if(!saved)save('seed',{data:'synthetic'});
function options(input={}){
 const mode=input.mode||'food',horizon=Number(input.horizon||7),uplift=Number(input.uplift||0),safety=Number(input.safety??10);
 if(!['food','retail'].includes(mode)||![7,14].includes(horizon)||!Number.isFinite(uplift)||uplift < -50||uplift>100||!Number.isFinite(safety)||safety<0||safety>50)throw new Error('Invalid planning options');
 return {mode,horizon,uplift,safety};
}
const send=(res,status,data,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type==='application/json'?JSON.stringify(data):data);};
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>1024*1024)throw new Error('Request exceeds 1 MB');}return JSON.parse(raw||'{}');}
const csvCell=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
let activeAI=false,lastAI=0;
const server=http.createServer(async(req,res)=>{
 try{
  if(!['127.0.0.1','localhost','[::1]'].includes((req.headers.host||'').replace(/:\d+$/,'')))return send(res,403,{error:'Loopback host required'});
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return send(res,403,{error:'Cross-origin requests are disabled'});
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,metaConfigured:!!process.env.META_API_KEY,model:process.env.META_MODEL||'muse-spark-1.3',asOf:state.asOf});
  if(req.method==='GET'&&url.pathname==='/api/plan')return send(res,200,plan(state,options(Object.fromEntries(url.searchParams))));
  if(req.method==='GET'&&url.pathname==='/api/audit')return send(res,200,db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 50').all());
  if(req.method==='GET'&&url.pathname==='/api/export'){
   const p=plan(state,options(Object.fromEntries(url.searchParams))),headers=['name','unit','required','safety','usable','inbound','shortfall','packSize','order','rounding','orderBy','supplier','estimate'];
   res.setHeader('Content-Disposition','attachment; filename="stockwise-purchase-draft.csv"');return send(res,200,[headers.join(','),...p.purchases.map(r=>headers.map(h=>csvCell(r[h])).join(','))].join('\r\n'),'text/csv');
  }
  if(req.method==='POST'&&url.pathname==='/api/reset'){state=seed();db.prepare('DELETE FROM imports').run();save('reset',{data:'synthetic'});return send(res,200,{ok:true});}
  if(req.method==='POST'&&url.pathname==='/api/stock'){
   const b=await body(req),opt=options(b),item=state.businesses[opt.mode].inventory.find(i=>i.id===b.id);
   if(!item||!Number.isFinite(b.quantity)||b.quantity<0||b.quantity>1000000)throw new Error('Invalid stock quantity');
   const old=item.lots;item.lots=[{quantity:b.quantity,reserved:0,expiry:b.expiry||null}];
   if(b.expiry&&(!/^\d{4}-\d{2}-\d{2}$/.test(b.expiry)||!Number.isFinite(Date.parse(b.expiry))||new Date(b.expiry).toISOString().slice(0,10)!==b.expiry)){item.lots=old;throw new Error('Invalid expiry date');}
   item.updatedAt=new Date().toISOString();save('stock-count',{mode:opt.mode,id:item.id,before:old,after:item.lots});return send(res,200,{ok:true});
  }
  if(req.method==='POST'&&url.pathname==='/api/import'){
   const b=await body(req),opt=options(b),business=state.businesses[opt.mode];if(typeof b.csv!=='string')throw new Error('CSV text is required');
   const validated=validateSales(b.csv,business,state.asOf);if(validated.errors.length)return send(res,422,{errors:validated.errors});
   const hash=opt.mode+':'+validated.hash;if(db.prepare('SELECT hash FROM imports WHERE hash=?').get(hash))return send(res,409,{error:'This file has already been imported'});
   const incoming=new Set(validated.records.map(r=>r.date+'|'+r.itemId)),before=business.sales;
   business.sales=[...before.filter(r=>!incoming.has(r.date+'|'+r.itemId)),...validated.records];business.dataLabel='Demo workspace: imported sales mixed with synthetic sample records';
   db.prepare('INSERT INTO imports VALUES(?,?)').run(hash,opt.mode);save('sales-import',{mode:opt.mode,hash,rows:validated.records.length,replaced:before.filter(r=>incoming.has(r.date+'|'+r.itemId)).length});
   return send(res,200,{ok:true,rows:validated.records.length});
  }
  if(req.method==='POST'&&url.pathname==='/api/chat'){
   const b=await body(req),opt=options(b);if(typeof b.question!=='string'||!b.question.trim()||b.question.length>2000)throw new Error('Question must contain 1-2000 characters');
   if(activeAI||Date.now()-lastAI<1500)return send(res,429,{error:'Please wait before asking another question'});
   activeAI=true;lastAI=Date.now();let result;try{result=await askMeta(b.question,plan(state,opt));}finally{activeAI=false;}
   save('assistant',{mode:opt.mode,providerMode:result.mode,model:result.model,tools:result.trace.map(t=>t.name),latencyMs:result.latencyMs,tokens:result.totalTokens});return send(res,200,result);
  }
  if(req.method!=='GET')return send(res,404,{error:'Route not found'});
  const assets={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'};
  if(!assets[url.pathname])return send(res,404,{error:'Not found'});
  const file=assets[url.pathname],data=await readFile(path.join(root,'public',file));
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  send(res,200,data,{'html':'text/html','js':'text/javascript','css':'text/css'}[file.split('.').at(-1)]);
 }catch(error){send(res,400,{error:error.message});}
});
const port=Number(process.env.PORT||3000);server.listen(port,'127.0.0.1',()=>console.log(`Stockwise running at http://127.0.0.1:${server.address().port}\nMeta assistant: ${process.env.META_API_KEY?'configured':'offline (add META_API_KEY to .env)'}`));
