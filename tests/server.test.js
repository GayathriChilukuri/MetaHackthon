import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
const root=fileURLToPath(new URL('../',import.meta.url));
test('HTTP flow: import validation, duplicate prevention, stock persistence, exports, isolation',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'stockwise-test-'));
 let child;
 async function start(){
  child=spawn(process.execPath,['src/server.js'],{cwd:root,env:{...process.env,PORT:'0',META_API_KEY:'',STOCKWISE_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  const address=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Server startup timed out')),10000);child.stdout.on('data',chunk=>{text+=chunk;const m=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);reject(new Error('Server exited: '+code));});});
  return address;
 }
 async function stop(){const exited=once(child,'exit');child.kill();await exited;}
 try{
  let base=await start();
  const post=(route,data,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  const initial=await (await fetch(base+'/api/plan')).json();assert.equal(initial.mode,'food');
  const csv=`date,item_id,quantity,available\n${initial.asOf},chai,42,true`;
  assert.equal((await post('/api/import',{csv:csv.replace('42','-1')})).status,422);
  assert.equal((await post('/api/import',{csv})).status,200);
  assert.equal((await post('/api/import',{csv})).status,409);
  assert.equal((await post('/api/stock',{id:'rice',quantity:100})).status,200);
  assert.equal((await post('/api/stock',{id:'rice',quantity:-3})).status,400);
  assert.equal((await post('/api/stock',{id:'rice',quantity:1},{Origin:'https://attacker.example'})).status,403);
  const exported=await fetch(base+'/api/export');assert.match(await exported.text(),/Suggested|name,unit,required/);
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base+'/api/plan?mode=another-business')).status,400);
  const chat=await(await post('/api/chat',{question:'Explain rice purchases'})).json();assert.equal(chat.mode,'offline');
  await stop();base=await start();
  const restored=await(await fetch(base+'/api/plan')).json();assert.equal(restored.inventory.find(i=>i.id==='rice').lots[0].quantity,100);assert.match(restored.dataLabel,/imported/);
  assert.equal(restored.history.find(r=>r.itemId==='chai'&&r.date===initial.asOf).quantity,42);
  const audit=await(await fetch(base+'/api/audit')).json();assert.ok(audit.some(r=>r.action==='sales-import'));
 }finally{
  if(child&&child.exitCode===null)await stop();
  const absolute=path.resolve(dir);if(path.dirname(absolute)!==path.resolve(os.tmpdir())||!path.basename(absolute).startsWith('stockwise-test-'))throw new Error('Unsafe temporary cleanup path');
  await rm(absolute,{recursive:true,force:true});
 }
});
