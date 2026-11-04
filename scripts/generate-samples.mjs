import {writeFile,mkdir} from 'node:fs/promises';
import {seed} from '../src/seed.js';
const state=seed();await mkdir(new URL('../samples/',import.meta.url),{recursive:true});
for(const [mode,b] of Object.entries(state.businesses)){
 const csv='date,item_id,quantity,available\r\n'+b.sales.map(r=>[r.date,r.itemId,r.quantity,r.available].join(',')).join('\r\n');
 await writeFile(new URL(`../samples/${mode}-sales.csv`,import.meta.url),csv);
}
console.log('Synthetic food and retail sales CSVs generated for snapshot '+state.asOf);
