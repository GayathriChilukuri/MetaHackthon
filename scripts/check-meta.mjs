import {mkdir,writeFile} from 'node:fs/promises';
import {askMeta} from '../src/copilot.js';
import {plan} from '../src/engine.js';
import {seed} from '../src/seed.js';
const p=plan(seed());
const result=await askMeta('How much basmati rice should I purchase? Use get_purchase_plan and get_recipes. Explain the two-day horizon, shortfall, rounding, recipe versions and order deadline. Answer in under 150 words.',p,{fetcher:async(...args)=>{
 const response=await fetch(...args);if(response.ok){const clone=await response.clone().json(),choice=clone.choices?.[0];console.log(JSON.stringify({status:response.status,finishReason:choice?.finish_reason,toolNames:choice?.message?.tool_calls?.map(c=>c.function.name),contentLength:choice?.message?.content?.length,usage:clone.usage}));}else console.log(JSON.stringify({status:response.status}));return response;
}});
await mkdir(new URL('../output/evidence/',import.meta.url),{recursive:true});
await writeFile(new URL('../output/evidence/meta-live-check.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({mode:result.mode,model:result.model,reason:result.reason,latencyMs:result.latencyMs,totalTokens:result.totalTokens,answer:result.answer,tools:result.trace.map(t=>t.name)},null,2));
if(result.mode!=='live')process.exitCode=1;
