import test from 'node:test';
import assert from 'node:assert/strict';
import {expandRecipe,convert,replenish,predict,backtest,plan,day} from '../src/engine.js';
import {seed} from '../src/seed.js';
import {validateSales,parseCSV} from '../src/imports.js';
import {askMeta,runTool} from '../src/copilot.js';
const asOf='2026-11-04';
const rice={id:'rice',name:'Rice',unit:'kg',cost:80,supplier:'Supplier',leadDays:1,reviewDays:0,packSize:5,lots:[{quantity:3}],inbound:[{quantity:4,arrival:'2026-11-05'}]};
test('hand-worked recipe example: 100 biryanis + 50 bowls = 14kg rice',()=>{
 const b=seed(asOf).businesses.food;
 const a=expandRecipe('biryani',100,b.recipes,b.inventory),c=expandRecipe('bowl',50,b.recipes,b.inventory);
 assert.equal(a.rice+c.rice,14);assert.equal(a.vegetables,10); // 8kg prepared / .8
 const p=replenish(rice,[{date:'2026-11-05',quantity:14}],asOf,100*2/14);
 assert.equal(p.safety,2);assert.equal(p.shortfall,9);assert.equal(p.order,10);assert.equal(p.rounding,1);
});
test('expired and reserved stock are excluded; late receipts cannot cover earlier demand',()=>{
 const p=replenish({...rice,reviewDays:1,lots:[{quantity:20,expiry:asOf},{quantity:5,reserved:4}],inbound:[{quantity:100,arrival:'2026-11-06'}]},[{date:'2026-11-05',quantity:10},{date:'2026-11-06',quantity:10}],asOf,0);
 assert.equal(p.usable,1);assert.equal(p.inbound,10);assert.equal(p.shortfall,9);assert.equal(p.order,10);
});
test('FEFO preserves later-expiring stock for day two',()=>{
 const p=replenish({...rice,reviewDays:1,lots:[{quantity:10,expiry:'2026-11-06'},{quantity:10,expiry:'2026-11-05'}],inbound:[]},[{date:'2026-11-05',quantity:10},{date:'2026-11-06',quantity:10}],asOf,0);
 assert.equal(p.shortfall,0);assert.equal(p.order,0);
});
test('minimum orders apply only to positive shortfalls and round to packs',()=>{
 assert.equal(replenish({...rice,minimumOrder:11,lots:[],inbound:[]},[{date:'2026-11-05',quantity:1}],asOf,0).order,15);
 assert.equal(replenish({...rice,minimumOrder:11,lots:[{quantity:100}]},[{date:'2026-11-05',quantity:1}],asOf,0).order,0);
});
test('order deadline derives from first FEFO shortage',()=>{
 const p=replenish({...rice,leadDays:2,lots:[],inbound:[]},[{date:'2026-11-05',quantity:1},{date:'2026-11-06',quantity:1}],asOf,0);
 assert.equal(p.orderBy,'2026-11-03');assert.equal(p.urgent,true);
});
test('unit conversion, missing recipes, yields, and cycles are validated',()=>{
 assert.equal(convert(1000,'g','kg'),1);assert.throws(()=>convert(2,'kg','l'));
 assert.throws(()=>expandRecipe('missing',1,[],[]),/Missing approved/);
 const recipes=[{itemId:'a',approved:true,servings:1,ingredients:[{recipeId:'a',quantity:1,yield:1,unit:'unit'}]}];
 assert.throws(()=>expandRecipe('a',1,recipes,[]),/Circular/);
 const b=seed(asOf).businesses.food;b.recipes[0].ingredients[0].yield=0;assert.throws(()=>expandRecipe('biryani',1,b.recipes,b.inventory),/yield/);
});
test('numerical forecasts exclude stockout observations and future information',()=>{
 const rows=Array.from({length:42},(_,i)=>({date:day(asOf,i-42),itemId:'a',quantity:20,available:true}));
 rows.push({date:asOf,itemId:'a',quantity:99999,available:false},{date:day(asOf,1),itemId:'a',quantity:8888});
 assert.equal(predict(rows,day(asOf,1)).quantity,20);
 assert.equal(backtest(rows.filter(r=>r.date<asOf)).weekday.wape,0);
});
test('both modes return finite nonnegative reproducible quantities',()=>{
 for(const mode of ['food','retail']){const p=plan(seed(asOf),{mode,horizon:14});assert.equal(p.forecasts[0].days.length,14);assert.ok(p.purchases.every(r=>Number.isFinite(r.order)&&r.order>=0));assert.ok(p.metrics.weekday.count>0);}
});
test('CSV validation gives row errors, rejects duplicates, future dates and unknown IDs',()=>{
 const b=seed(asOf).businesses.food;
 const bad=validateSales('date,item_id,quantity,available\n2026-11-05,unknown,-1,yes',b,asOf);assert.equal(bad.errors.length,4);
 assert.equal(validateSales('date,item_id,quantity,available\n2026-11-01,chai,20,true\n2026-11-01,chai,20,true',b,asOf).errors.length,1);
 assert.ok(validateSales('date,item_id,quantity,available\n2026-02-30,chai,2,true',b,asOf).errors.length);
 assert.deepEqual(parseCSV('a,b\r\n"x,y","say ""hi"""'),[['a','b'],['x,y','say "hi"']]);assert.throws(()=>parseCSV('a,"b'));
});
test('Meta unavailable fallback is explicitly local',async()=>{
 const p=plan(seed(asOf));assert.equal((await askMeta('rice?',p,{apiKey:''})).mode,'offline');
 const failed=await askMeta('rice?',p,{apiKey:'test',fetcher:async()=>({ok:false,status:503})});assert.equal(failed.mode,'offline');assert.match(failed.reason,/503/);
});
test('Meta tool loop executes scoped tools and records live evidence',async()=>{
 const p=plan(seed(asOf));let calls=0;
 const result=await askMeta('rice?',p,{apiKey:'fake-for-test',fetcher:async(url,req)=>{const payload=JSON.parse(req.body);calls++;if(calls===1)return {ok:true,json:async()=>({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'get_purchase_plan',arguments:'{}'}}]}}],usage:{total_tokens:10}})};assert.equal(payload.messages.at(-1).role,'tool');return {ok:true,json:async()=>({model:'test-meta-model',choices:[{message:{content:'Grounded purchase explanation'}}],usage:{total_tokens:15}})};}});
 assert.equal(result.mode,'live');assert.equal(result.totalTokens,25);assert.equal(result.trace[0].name,'get_purchase_plan');assert.equal(calls,2);
 assert.throws(()=>runTool('execute_sql',{},p),/not allowed/);assert.throws(()=>runTool('get_purchase_plan',{mode:'other-tenant'},p));
});
test('ungrounded model output and malformed tool arguments fall back safely',async()=>{
 const p=plan(seed(asOf));for(const message of [{content:'Invented numbers'},{tool_calls:[{id:'1',function:{name:'get_purchase_plan',arguments:'not json'}}]}]){
 const r=await askMeta('rice?',p,{apiKey:'fake',fetcher:async()=>({ok:true,json:async()=>({choices:[{message}]})})});assert.equal(r.mode,'offline');}
});
test('a token-truncated Meta answer is not presented as a completed live explanation',async()=>{
 const p=plan(seed(asOf));
 const r=await askMeta('rice?',p,{apiKey:'fake',fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'Purchase half of the'}}]})})});
 assert.equal(r.mode,'offline');assert.match(r.reason,/completion-token budget/);
});
