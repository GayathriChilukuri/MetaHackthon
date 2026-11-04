export const VERSION = 'weekday-v1.0';
export const round = n => Math.round(n * 1000) / 1000;
export const day = (date, offset = 0) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay();
const mean = a => a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0;
export function predict(rows, date, method = 'weekday') {
  const valid = rows.filter(r => r.date < date && r.available !== false).sort((a,b) => a.date.localeCompare(b.date));
  const same = valid.filter(r => weekday(r.date) === weekday(date)).slice(-8);
  const sample = method === 'weekday' && same.length >= 3 ? same : valid.slice(-14);
  const value = mean(sample.map(r => r.quantity));
  const sd = Math.sqrt(mean(sample.map(r => (r.quantity - value) ** 2)));
  return {quantity: round(value), lower: round(Math.max(0, value - 1.64 * sd)), upper: round(value + 1.64 * sd), observations: sample.length, confidence: sample.length >= 6 ? 'medium' : 'low'};
}
export function backtest(rows) {
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const testDates = dates.slice(-14);
  const results = {};
  for (const method of ['weekday', 'moving-average']) {
    let absolute = 0, actual = 0, signed = 0, covered = 0, count = 0;
    for (const date of testDates) for (const item of [...new Set(rows.map(r => r.itemId))]) {
      const history = rows.filter(r => r.itemId === item && r.date < date);
      const observed = rows.find(r => r.itemId === item && r.date === date && r.available !== false);
      if (!observed || history.length < 28) continue;
      const p = predict(history, date, method), error = p.quantity - observed.quantity;
      absolute += Math.abs(error); actual += observed.quantity; signed += error;
      covered += Number(observed.quantity >= p.lower && observed.quantity <= p.upper); count++;
    }
    results[method] = {wape: actual ? round(absolute / actual * 100) : null, mae: count ? round(absolute / count) : null, bias: count ? round(signed / count) : null, coverage: count ? round(covered / count * 100) : null, count};
  }
  return results;
}
const units = {kg: ['kg',1], g: ['kg',0.001], l: ['l',1], ml: ['l',0.001], unit: ['unit',1]};
export function convert(quantity, from, to) {
  if (!units[from] || !units[to] || units[from][0] !== units[to][0]) throw new Error(`Incompatible units: ${from} -> ${to}`);
  return quantity * units[from][1] / units[to][1];
}
export function expandRecipe(id, servings, recipes, inventory, stack = []) {
  if (stack.includes(id)) throw new Error(`Circular recipe: ${[...stack,id].join(' -> ')}`);
  const recipe = recipes.find(r => r.itemId === id);
  if (!recipe || !recipe.approved || !(recipe.servings > 0)) throw new Error(`Missing approved recipe for ${id}`);
  const output = {};
  for (const line of recipe.ingredients) {
    if (!(line.quantity >= 0) || !(line.yield > 0 && line.yield <= 1)) throw new Error(`Invalid recipe quantity/yield for ${id}`);
    const amount = line.quantity * servings / recipe.servings / (line.basis === 'prepared' ? line.yield : 1);
    if (line.recipeId) {
      if (line.unit !== 'unit') throw new Error('Nested recipes must specify output servings in unit');
      const nested = expandRecipe(line.recipeId, amount, recipes, inventory, [...stack,id]);
      for (const [key, value] of Object.entries(nested)) output[key] = (output[key] || 0) + value;
    } else {
      const item = inventory.find(i => i.id === line.ingredientId);
      if (!item) throw new Error(`Unknown ingredient: ${line.ingredientId}`);
      output[item.id] = (output[item.id] || 0) + convert(amount, line.unit, item.unit);
    }
  }
  return output;
}
// Daily FEFO allocation: expired stock and late receipts cannot offset an earlier shortage.
export function replenish(item, demand, asOf, safetyPercent = 10) {
  const span = item.leadDays + item.reviewDays;
  const days = demand.slice(0, span);
  let lots = item.lots.map(l => ({...l, remaining: Math.max(0, l.quantity - (l.reserved || 0))}));
  let usedStock = 0, usedInbound = 0, shortage = 0, firstShortage;
  const need = days.reduce((s,d) => s+d.quantity, 0), safety = need * safetyPercent / 100;
  for (let index = 0; index < days.length; index++) {
    const entry = days[index];
    for (const r of item.inbound.filter(r => r.arrival === entry.date || (index === 0 && r.arrival < entry.date && r.arrival > asOf))) {
      lots.push({...r, remaining: r.quantity, inbound: true});
    }
    lots = lots.filter(l => !l.expiry || l.expiry >= entry.date).sort((a,b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
    let required = entry.quantity + (index === days.length - 1 ? safety : 0);
    for (const lot of lots) {
      const used = Math.min(required, lot.remaining); required -= used; lot.remaining -= used;
      if (lot.inbound) usedInbound += used; else usedStock += used;
    }
    if (required > 0.000001 && !firstShortage) firstShortage = entry.date;
    shortage += required;
  }
  const order = shortage > 0.000001 ? Math.ceil(Math.max(shortage, item.minimumOrder || 0) / item.packSize) * item.packSize : 0;
  const orderBy = day(firstShortage || days.at(-1)?.date || day(asOf,1), -item.leadDays);
  return {id:item.id, name:item.name, unit:item.unit, supplier:item.supplier, stockUpdatedAt:item.updatedAt, cost:item.cost, leadDays:item.leadDays, reviewDays:item.reviewDays, required:round(need), safety:round(safety), usable:round(usedStock), inbound:round(usedInbound), shortfall:round(shortage), packSize:item.packSize, order:round(order), rounding:round(order-shortage), orderBy, urgent:order > 0 && orderBy < asOf, estimate:round(order*item.cost), horizon:days.length};
}
export function plan(state, {mode = 'food', horizon = 7, uplift = 0, safety = 10} = {}) {
  const business = state.businesses[mode];
  if (!business) throw new Error('Unknown business mode');
  const forecasts = business.products.map(product => ({...product, days:Array.from({length:horizon},(_,i) => {
    const date = day(state.asOf,i+1), p = predict(business.sales.filter(r => r.itemId === product.id),date);
    const factor=1+uplift/100;
    return {date,...p,quantity:round(p.quantity*factor),lower:round(p.lower*factor),upper:round(p.upper*factor)};
  })}));
  const requirements = {};
  for (const f of forecasts) for (const d of f.days) {
    const amounts = mode === 'food' ? expandRecipe(f.id,d.quantity,business.recipes,business.inventory) : {[f.id]:d.quantity};
    for (const [id,q] of Object.entries(amounts)) { requirements[id] ||= {}; requirements[id][d.date]=(requirements[id][d.date]||0)+q; }
  }
  const purchases = business.inventory.map(item => replenish(item,Array.from({length:horizon},(_,i) => ({date:day(state.asOf,i+1),quantity:requirements[item.id]?.[day(state.asOf,i+1)] || 0})),state.asOf,safety));
  return {mode,business:business.name,asOf:state.asOf,generatedAt:new Date().toISOString(),modelVersion:VERSION,horizon,uplift,safety,forecasts,purchases,metrics:backtest(business.sales),recipeVersions:business.recipes.map(r=>({itemId:r.itemId,version:r.version})),dataLabel:business.dataLabel||'Synthetic demonstration data',history:business.sales,inventory:business.inventory,recipes:business.recipes};
}
