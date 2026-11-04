import {createHash} from 'node:crypto';
export function parseCSV(text) {
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){ const c=text[i]; if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||!cell)quoted=!quoted;else throw new Error('Unexpected quote in CSV');}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}else cell+=c; }
  if(quoted)throw new Error('Unclosed CSV quote'); row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
export function validateSales(csv,business,asOf){
  const rows=parseCSV(csv.replace(/^\uFEFF/,'')),header=rows.shift()?.map(x=>x.trim());
  if(!header||!['date','item_id','quantity','available'].every(x=>header.includes(x)))throw new Error('Required columns: date,item_id,quantity,available');
  const errors=[],records=[],seen=new Set();
  rows.forEach((r,i)=>{const obj=Object.fromEntries(header.map((h,j)=>[h,r[j]?.trim()]));const fail=message=>errors.push({row:i+2,message});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(obj.date||'')||!Number.isFinite(Date.parse(obj.date))||new Date(obj.date).toISOString().slice(0,10)!==obj.date||obj.date>asOf)fail('Invalid or future date');
    if(!business.products.some(p=>p.id===obj.item_id))fail('Unknown item_id');
    if(!obj.quantity||!Number.isFinite(Number(obj.quantity))||Number(obj.quantity)<0)fail('quantity must be a nonnegative number');
    if(!['true','false'].includes(obj.available))fail('available must be true or false');
    const key=obj.date+'|'+obj.item_id;if(seen.has(key))fail('Duplicate item/date in file');seen.add(key);
    records.push({date:obj.date,itemId:obj.item_id,quantity:Number(obj.quantity),available:obj.available==='true'});
  });
  if(!records.length)errors.push({row:1,message:'No sales rows found'});
  return {records,errors,hash:createHash('sha256').update(JSON.stringify(records)).digest('hex')};
}
