import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handleAPI,reserveAI} from '../lib/stockwise/hosted.js';
function database(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0000_foamy_starjammers.sql',import.meta.url),'utf8'));
 return {prepare(sql){const statement=db.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){const result=statement.run(...args);return {meta:{changes:Number(result.changes)}};}};},async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},close(){db.close();}};
}
function request(path,cookie,body,headers={}){return new Request('https://stockwise.example'+path,{method:body?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});}
test('hosted demo isolates browser records, audits, imports and reset',async()=>{
 const DB=database(),env={DB};try{
  const a=await handleAPI(request('/api/health'),env),b=await handleAPI(request('/api/health'),env);
  const cookieA=a.headers.get('Set-Cookie').split(';')[0],cookieB=b.headers.get('Set-Cookie').split(';')[0];assert.notEqual(cookieA,cookieB);assert.match(a.headers.get('Set-Cookie'),/HttpOnly; SameSite=Lax; Secure/);
  assert.equal((await handleAPI(request('/api/stock',cookieA,{id:'rice',quantity:100}),env)).status,200);
  const get=async(cookie)=>(await handleAPI(request('/api/plan',cookie),env)).json();
  const pa=await get(cookieA),pb=await get(cookieB);assert.equal(pa.inventory[0].lots[0].quantity,100);assert.equal(pb.inventory[0].lots[0].quantity,3);
  const csv=`date,item_id,quantity,available\n${pa.asOf},chai,42,true`;
  assert.equal((await handleAPI(request('/api/import',cookieA,{csv}),env)).status,200);
  assert.equal((await handleAPI(request('/api/import',cookieA,{csv}),env)).status,409);
  assert.equal((await handleAPI(request('/api/import',cookieB,{csv}),env)).status,200);
  const auditA=await(await handleAPI(request('/api/audit',cookieA),env)).json(),auditB=await(await handleAPI(request('/api/audit',cookieB),env)).json();assert.ok(auditA.some(a=>a.action==='stock-count'));assert.ok(!auditB.some(a=>a.action==='stock-count'));
  assert.equal((await handleAPI(request('/api/stock',cookieA,{id:'rice',quantity:1},{Origin:'https://attacker.example'}),env)).status,403);
  assert.equal((await handleAPI(request('/api/stock',cookieA,{id:'rice',quantity:1,expiry:'2026-02-30'}),env)).status,400);assert.equal((await get(cookieA)).inventory[0].lots[0].quantity,100);
  const exportResponse=await handleAPI(request('/api/export',cookieA),env);assert.match(exportResponse.headers.get('Content-Type'),/text\/csv/);
  const chat=await(await handleAPI(request('/api/chat',cookieA,{question:'Explain rice'}),env)).json();assert.equal(chat.mode,'offline');
  await handleAPI(request('/api/reset',cookieA,{}),env);assert.equal((await get(cookieA)).inventory[0].lots[0].quantity,3);
 }finally{DB.close();}
});
test('persistent shared AI budget and per-browser allowance cannot exceed limits',async()=>{
 const DB=database();try{
  assert.equal(await reserveAI(DB,'browser-a',1),null);
  const today=new Date().toISOString().slice(0,10);await DB.prepare('UPDATE ai_usage SET last_at=0').run();
  assert.match(await reserveAI(DB,'browser-b',1),/shared Meta demo/);
  const usage=await DB.prepare('SELECT count FROM ai_usage WHERE key=?').bind('global:'+today).first();assert.equal(usage.count,1);
  await DB.prepare('UPDATE ai_usage SET count=5,last_at=0 WHERE key=?').bind(`browser:${today}:browser-a`).run();assert.match(await reserveAI(DB,'browser-a',30),/5 questions/);
 }finally{DB.close();}
});
