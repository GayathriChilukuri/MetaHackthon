import {seed} from './seed.js';
import {plan} from './engine.js';
import {validateSales} from './imports.js';
import {askMeta,offline} from './copilot.js';

const COOKIE='stockwise_demo';
const MAX_BODY=1024*1024;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function options(input={}){
 const mode=input.mode||'food',horizon=Number(input.horizon||7),uplift=Number(input.uplift||0),safety=Number(input.safety??10);
 if(!['food','retail'].includes(mode)||![7,14].includes(horizon)||!Number.isFinite(uplift)||uplift < -50||uplift>100||!Number.isFinite(safety)||safety<0||safety>50)throw new Error('Invalid planning options');
 return {mode,horizon,uplift,safety};
}
async function readBody(request){
 if(Number(request.headers.get('Content-Length'))>MAX_BODY)throw new Error('Request exceeds 1 MB');
 const reader=request.body?.getReader();if(!reader)return {};
 const chunks=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY){await reader.cancel();throw new Error('Request exceeds 1 MB');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes)||'{}');
}
export function cookieId(request){const value=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return /^[a-f0-9-]{36}$/.test(value||'')?value:null;}
export function validateStock(state,input,opt){
 const item=state.businesses[opt.mode].inventory.find(i=>i.id===input.id);
 if(!item||!Number.isFinite(input.quantity)||input.quantity<0||input.quantity>1000000)throw new Error('Invalid stock quantity');
 if(input.expiry&&(!/^\d{4}-\d{2}-\d{2}$/.test(input.expiry)||!Number.isFinite(Date.parse(input.expiry))||new Date(input.expiry).toISOString().slice(0,10)!==input.expiry))throw new Error('Invalid expiry date');
 return item;
}
async function workspace(request,db){
 const id=cookieId(request);
 if(id){const row=await db.prepare('SELECT id,state,revision FROM demo_workspaces WHERE id=?').bind(id).first();if(row)return {...row,state:JSON.parse(row.state),fresh:false};}
 const row={id:crypto.randomUUID(),state:seed(),revision:0,fresh:true},now=new Date().toISOString();
 await db.prepare('INSERT INTO demo_workspaces(id,state,revision,created_at,updated_at) VALUES(?,?,0,?,?)').bind(row.id,JSON.stringify(row.state),now,now).run();return row;
}
async function save(db,row,action,detail){
 const now=new Date().toISOString();
 const result=await db.prepare('UPDATE demo_workspaces SET state=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(JSON.stringify(row.state),now,row.id,row.revision).run();
 if(!result.meta.changes){const error=new Error('Workspace changed in another request. Refresh and try again.');error.status=409;throw error;}
 row.revision++;
 await audit(db,row.id,action,detail);
}
async function audit(db,id,action,detail){await db.prepare('INSERT INTO demo_audit(id,workspace_id,at,action,detail) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,new Date().toISOString(),action,JSON.stringify(detail)).run();}
export async function reserveAI(db,id,limit){
 const today=new Date().toISOString().slice(0,10),now=Date.now();
 const sessionKey=`browser:${today}:${id}`,globalKey=`global:${today}`;
 await db.batch([db.prepare('INSERT OR IGNORE INTO ai_usage(key,count,last_at) VALUES(?,0,0)').bind(sessionKey),db.prepare('INSERT OR IGNORE INTO ai_usage(key,count,last_at) VALUES(?,0,0)').bind(globalKey)]);
 const browser=await db.prepare('UPDATE ai_usage SET count=count+1,last_at=? WHERE key=? AND count<5 AND last_at<?').bind(now,sessionKey,now-10000).run();
 if(!browser.meta.changes)return 'This browser has reached its demo allowance (5 questions/day), or the previous request was less than 10 seconds ago.';
 const global=await db.prepare('UPDATE ai_usage SET count=count+1,last_at=? WHERE key=? AND count<? AND last_at<?').bind(now,globalKey,limit,now-3000).run();
 if(!global.meta.changes)return 'The shared Meta demo allowance is currently unavailable. The local planning summary remains available.';
 return null;
}
const cell=value=>{let text=String(value??'');if(/^[=+@\-\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
export async function handleAPI(request,env){
 const url=new URL(request.url),origin=request.headers.get('Origin');
 if(origin&&origin!==url.origin)return json({error:'Cross-origin requests are disabled'},403);
 if(!env.DB)return json({error:'Demo storage is unavailable'},503);
 let row;
 try{
  row=await workspace(request,env.DB);
  const response=await route(request,url,env,row);
  if(row.fresh){const secure=url.protocol==='https:'?'; Secure':'';response.headers.append('Set-Cookie',`${COOKIE}=${row.id}; Path=/; Max-Age=172800; HttpOnly; SameSite=Lax${secure}`);}
  return response;
 }catch(error){const response=json({error:error.status===409?error.message:'The request could not be completed. '+(error.message||'Please try again.')},error.status||400);if(row?.fresh)response.headers.append('Set-Cookie',`${COOKIE}=${row.id}; Path=/; Max-Age=172800; HttpOnly; SameSite=Lax${url.protocol==='https:'?'; Secure':''}`);return response;}
}
async function route(request,url,env,row){
 const db=env.DB,state=row.state;
 if(request.method==='GET'&&url.pathname==='/api/health')return json({ok:true,metaConfigured:!!env.META_API_KEY,model:env.META_MODEL||'muse-spark-1.3',asOf:state.asOf,hosted:true,demoLimits:{perBrowser:5,global:dailyLimit(env)},workspace:'Private to this browser; synthetic starter records'});
 if(request.method==='GET'&&url.pathname==='/api/plan')return json(plan(state,options(Object.fromEntries(url.searchParams))));
 if(request.method==='GET'&&url.pathname==='/api/audit'){const result=await db.prepare('SELECT at,action,detail FROM demo_audit WHERE workspace_id=? ORDER BY at DESC LIMIT 50').bind(row.id).all();return json(result.results);}
 if(request.method==='GET'&&url.pathname==='/api/export'){
  const p=plan(state,options(Object.fromEntries(url.searchParams))),keys=['name','unit','required','safety','usable','inbound','shortfall','packSize','order','rounding','orderBy','supplier','estimate'];
  return new Response([keys.join(','),...p.purchases.map(p=>keys.map(k=>cell(p[k])).join(','))].join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="stockwise-purchase-draft.csv"','Cache-Control':'no-store'}});
 }
 if(request.method!=='POST')return json({error:'Not found'},404);
 const body=await readBody(request),opt=options(body);
 if(url.pathname==='/api/reset'){row.state=seed();await save(db,row,'reset',{data:'synthetic'});return json({ok:true});}
 if(url.pathname==='/api/stock'){
  const item=validateStock(state,body,opt),before=item.lots;item.lots=[{quantity:body.quantity,reserved:0,expiry:body.expiry||null}];item.updatedAt=new Date().toISOString();
  await save(db,row,'stock-count',{mode:opt.mode,id:item.id,before,after:item.lots});return json({ok:true});
 }
 if(url.pathname==='/api/import'){
  if(typeof body.csv!=='string')throw new Error('CSV text is required');const business=state.businesses[opt.mode],valid=validateSales(body.csv,business,state.asOf);
  if(valid.errors.length)return json({errors:valid.errors},422);
  const hash=opt.mode+':'+valid.hash;state.importHashes||=[];if(state.importHashes.includes(hash))return json({error:'This file has already been imported'},409);
  const keys=new Set(valid.records.map(r=>r.date+'|'+r.itemId));business.sales=[...business.sales.filter(r=>!keys.has(r.date+'|'+r.itemId)),...valid.records];business.dataLabel='Demo workspace: imported sales mixed with synthetic sample records';state.importHashes.push(hash);
  await save(db,row,'sales-import',{mode:opt.mode,hash,rows:valid.records.length});return json({ok:true,rows:valid.records.length});
 }
 if(url.pathname==='/api/chat'){
  if(typeof body.question!=='string'||!body.question.trim()||body.question.length>2000)throw new Error('Question must contain 1-2000 characters');
  const p=plan(state,opt);let result;
  if(!env.META_API_KEY)result=offline(p);else {const reason=await reserveAI(db,row.id,dailyLimit(env));result=reason?offline(p,reason):await askMeta(body.question,p,{apiKey:env.META_API_KEY,model:env.META_MODEL||'muse-spark-1.3',baseURL:'https://api.meta.ai/v1'});}
  await audit(db,row.id,'assistant',{mode:opt.mode,providerMode:result.mode,model:result.model,tools:result.trace.map(t=>t.name),latencyMs:result.latencyMs,tokens:result.totalTokens});return json(result);
 }
 return json({error:'Not found'},404);
}
function dailyLimit(env){const value=Number(env.META_DAILY_REQUEST_LIMIT||30);return Number.isInteger(value)&&value>0&&value<=100?value:30;}
