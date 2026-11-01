import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export class InputError extends Error {}
const round = value => Math.round(value * 10000) / 10000;

export function clinicDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

export function previousDay(day) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function text(value, label, maximum = 120) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new InputError(`${label} is required (up to ${maximum} characters).`);
  return value.trim();
}

function quantity(value, label, minimum = 0) {
  if (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < minimum || Number(value) > 1e9) throw new InputError(`${label} must be a number between ${minimum} and 1,000,000,000.`);
  return round(Number(value));
}

function validDay(value, today) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value || value > today) throw new InputError('Choose a valid date that is not in the future.');
  return value;
}

export function supplierUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new Error();
    return url.href;
  } catch {
    throw new InputError('Enter a complete supplier link beginning with https:// or http://, without a username or password.');
  }
}

export function calculateStock(item, estimates, actualUsage, deliveries = []) {
  const actual = new Map(actualUsage.filter(row => row.item_id === item.id).map(row => [row.day, Number(row.quantity)]));
  const estimated = new Map(estimates.filter(row=>row.item_id===item.id).map(row => [row.day, Number(row.quantity)]));
  const days = new Set([...estimated.keys(), ...actual.keys()]);
  let consumed = 0;
  let hasEstimates = false;
  for (const day of days) {
    if (day <= item.count_through) continue;
    if (actual.has(day)) consumed += actual.get(day);
    else if (estimated.has(day)) {
      consumed += estimated.get(day);
      hasEstimates = hasEstimates || estimated.get(day) > 0;
    }
  }
  const received = deliveries.filter(row => row.item_id === item.id && row.id > item.count_receipt_id).reduce((sum, row) => sum + Number(row.quantity), 0);
  const raw = round(item.baseline + received - consumed);
  const remaining = Math.max(0, raw);
  return { remaining, shortfall: Math.max(0, -raw), consumed: round(consumed), received: round(received), hasEstimates, status: remaining === 0 ? 'out' : remaining <= item.threshold ? 'low' : 'ok' };
}

export function createStore(filename = ':memory:', clock = () => new Date()) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 4000;
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '', pack_size REAL NOT NULL DEFAULT 1,
      threshold REAL NOT NULL CHECK (threshold >= 0),
      mode TEXT NOT NULL CHECK (mode IN ('manual','patients')),
      rate REAL NOT NULL DEFAULT 0 CHECK (rate >= 0),
      baseline REAL NOT NULL CHECK (baseline >= 0), count_through TEXT NOT NULL,
      count_receipt_id INTEGER NOT NULL DEFAULT 0, counted_at TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS patients (day TEXT PRIMARY KEY, total INTEGER NOT NULL CHECK(total >= 0));
    CREATE TABLE IF NOT EXISTS usage (
      item_id TEXT NOT NULL REFERENCES items(id), day TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity >= 0), PRIMARY KEY(item_id, day)
    );
    CREATE TABLE IF NOT EXISTS estimates (
      item_id TEXT NOT NULL REFERENCES items(id), day TEXT NOT NULL,
      quantity REAL NOT NULL CHECK(quantity >= 0), rate REAL NOT NULL CHECK(rate >= 0),
      PRIMARY KEY(item_id, day)
    );
    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT NOT NULL REFERENCES items(id),
      quantity REAL NOT NULL CHECK(quantity > 0), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id),
      name TEXT NOT NULL, url TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
      item_name TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  const today = () => clinicDate(clock());
  const stamp = () => clock().toISOString();
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function activity(kind, name, detail) { db.prepare('INSERT INTO activity(kind,item_name,detail,created_at) VALUES(?,?,?,?)').run(kind, name, detail, stamp()); }
  function findItem(id) {
    const item = db.prepare('SELECT * FROM items WHERE id=?').get(id);
    if (!item) throw new InputError('This supply was not found. Refresh the page and try again.');
    return item;
  }
  function itemFields(input) {
    const mode = input.mode;
    if (!['manual','patients'].includes(mode)) throw new InputError('Choose actual usage or a patient-based estimate.');
    return {
      name: text(input.name, 'Supply name'), unit: text(input.unit, 'Tracking unit', 30),
      location: typeof input.location === 'string' ? input.location.trim().slice(0, 120) : '',
      packSize: quantity(input.packSize ?? 1, 'Units per pack', 0.0001),
      threshold: quantity(input.threshold, 'Low-stock level'), mode,
      rate: mode === 'patients' ? quantity(input.rate, 'Usage per patient') : 0,
    };
  }
  const store = {
    today,
    close: () => db.close(),
    createItem(input) {
      const values = itemFields(input);
      const baseline = quantity(input.quantity, 'Starting quantity');
      const through = validDay(input.countThrough ?? previousDay(today()), today());
      const id = randomUUID();
      return transaction(() => {
        db.prepare('INSERT INTO items(id,name,unit,location,pack_size,threshold,mode,rate,baseline,count_through,counted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, values.name, values.unit, values.location, values.packSize, values.threshold, values.mode, values.rate, baseline, through, stamp());
        if(values.mode==='patients')for(const day of db.prepare('SELECT * FROM patients WHERE day>?').all(through))db.prepare('INSERT INTO estimates(item_id,day,quantity,rate) VALUES(?,?,?,?)').run(id,day.day,round(day.total*values.rate),values.rate);
        activity('Supply added', values.name, `Starting count: ${baseline} ${values.unit}.`);
        return id;
      });
    },
    editItem(id, input) {
      const original=findItem(id);
      const values = itemFields(input);
      if(original.unit!==values.unit)throw new InputError('Keep the original tracking unit. Create a separate supply to use a different unit.');
      transaction(() => {
        db.prepare('UPDATE items SET name=?,unit=?,location=?,pack_size=?,threshold=?,mode=?,rate=? WHERE id=?').run(values.name,values.unit,values.location,values.packSize,values.threshold,values.mode,values.rate,id);
        activity('Supply settings updated',values.name,`Low-stock level: ${values.threshold} ${values.unit}.`);
      });
    },
    recordCount(id, input) {
      const item = findItem(id);
      const amount = quantity(input.quantity, 'Physical count');
      const through = validDay(input.countThrough, today());
      transaction(() => {
        const latest = db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM deliveries WHERE item_id=?').get(id).id;
        db.prepare('UPDATE items SET baseline=?,count_through=?,count_receipt_id=?,counted_at=? WHERE id=?').run(amount,through,latest,stamp(),id);
        activity('Physical count recorded',item.name,`${amount} ${item.unit}; usage through ${through} is already included.`);
      });
    },
    addDelivery(id, input) {
      const item = findItem(id);
      const amount = quantity(input.quantity, 'Delivered quantity', 0.0001);
      transaction(() => {
        db.prepare('INSERT INTO deliveries(item_id,quantity,created_at) VALUES(?,?,?)').run(id,amount,stamp());
        activity('Delivery recorded',item.name,`Added ${amount} ${item.unit}.`);
      });
    },
    saveDay(input) {
      const day = validDay(input.day,today());
      const total = input.patients === null ? null : quantity(input.patients,'Daily patient total');
      if (total !== null && (!Number.isInteger(total) || total > 10000)) throw new InputError('Patient total must be a whole number between 0 and 10,000.');
      if (!Array.isArray(input.actuals) || input.actuals.length > 1000) throw new InputError('Invalid daily usage entries.');
      const entries = input.actuals.map(entry => {
        findItem(entry.itemId);
        return { itemId:entry.itemId, quantity:entry.quantity === null ? null : quantity(entry.quantity,'Actual usage') };
      });
      transaction(() => {
        if (total === null) db.prepare('DELETE FROM patients WHERE day=?').run(day);
        else db.prepare('INSERT INTO patients(day,total) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET total=excluded.total').run(day,total);
        if(total===null)db.prepare('DELETE FROM estimates WHERE day=?').run(day);
        else for(const item of db.prepare('SELECT * FROM items').all()){
          const previous=db.prepare('SELECT rate FROM estimates WHERE item_id=? AND day=?').get(item.id,day);
          if(!previous&&(item.mode!=='patients'||item.archived))continue;
          const rate=previous?.rate??item.rate;
          db.prepare('INSERT INTO estimates(item_id,day,quantity,rate) VALUES(?,?,?,?) ON CONFLICT(item_id,day) DO UPDATE SET quantity=excluded.quantity').run(item.id,day,round(total*rate),rate);
        }
        for (const entry of entries) {
          if (entry.quantity === null) db.prepare('DELETE FROM usage WHERE item_id=? AND day=?').run(entry.itemId,day);
          else db.prepare('INSERT INTO usage(item_id,day,quantity) VALUES(?,?,?) ON CONFLICT(item_id,day) DO UPDATE SET quantity=excluded.quantity').run(entry.itemId,day,entry.quantity);
        }
        activity('Daily use updated','',`${day}: ${total === null ? 'no patient total' : `${total} patients`}; ${entries.filter(entry=>entry.quantity!==null).length} actual usage entries.`);
      });
    },
    addSupplier(id, input) {
      const item = findItem(id);
      const name = text(input.name,'Supplier name',80);
      const url = supplierUrl(input.url);
      const existing = db.prepare('SELECT id FROM suppliers WHERE item_id=? AND url=? AND archived=0').get(id,url);
      if (existing) throw new InputError('That link is already saved for this supply.');
      transaction(() => {
        db.prepare('INSERT INTO suppliers(id,item_id,name,url) VALUES(?,?,?,?)').run(randomUUID(),id,name,url);
        activity('Supplier saved',item.name,name);
      });
    },
    archiveSupplier(id, archived) {
      if (typeof archived !== 'boolean') throw new InputError('Invalid supplier change.');
      const row = db.prepare('SELECT suppliers.*,items.name AS item_name FROM suppliers JOIN items ON items.id=suppliers.item_id WHERE suppliers.id=?').get(id);
      if (!row) throw new InputError('Supplier not found.');
      transaction(() => {
        db.prepare('UPDATE suppliers SET archived=? WHERE id=?').run(Number(archived),id);
        activity(archived?'Supplier archived':'Supplier restored',row.item_name,row.name);
      });
    },
    archiveItem(id, archived) {
      const item = findItem(id);
      if (typeof archived !== 'boolean') throw new InputError('Invalid supply change.');
      transaction(() => {
        db.prepare('UPDATE items SET archived=? WHERE id=?').run(Number(archived),id);
        activity(archived?'Supply archived':'Supply restored',item.name,'History and supplier links retained.');
      });
    },
    getDay(day) {
      validDay(day,today());
      return { day, patients:db.prepare('SELECT total FROM patients WHERE day=?').get(day)?.total ?? null, actuals:db.prepare('SELECT item_id,quantity FROM usage WHERE day=?').all(day).map(row=>({...row})), estimates:db.prepare('SELECT item_id,quantity,rate FROM estimates WHERE day=?').all(day).map(row=>({...row})) };
    },
    getState() {
      const estimates=db.prepare('SELECT * FROM estimates ORDER BY day').all();
      const usage=db.prepare('SELECT * FROM usage').all();
      const deliveries=db.prepare('SELECT * FROM deliveries').all();
      const suppliers=db.prepare('SELECT * FROM suppliers ORDER BY name').all();
      const items=db.prepare('SELECT * FROM items ORDER BY name COLLATE NOCASE').all().map(item=>({ ...item, ...calculateStock(item,estimates,usage,deliveries), suppliers:suppliers.filter(supplier=>supplier.item_id===item.id).map(row=>({...row})) }));
      return { today:today(), yesterday:previousDay(today()), items, activity:db.prepare('SELECT * FROM activity ORDER BY id DESC LIMIT 100').all().map(row=>({...row})) };
    },
  };
  return store;
}

export function seedDemo(store) {
  if (store.getState().items.length) return;
  const baseline=previousDay(store.today());
  const gloves=store.createItem({name:'Exam gloves — medium',unit:'gloves',location:'Supply cabinet, shelf 2',packSize:100,threshold:200,mode:'patients',rate:4,quantity:240,countThrough:baseline});
  const masks=store.createItem({name:'Procedure masks',unit:'masks',location:'Supply cabinet, shelf 1',packSize:50,threshold:50,mode:'manual',quantity:24,countThrough:baseline});
  store.createItem({name:'Paper towels',unit:'rolls',location:'Back storage',packSize:12,threshold:4,mode:'manual',quantity:18,countThrough:baseline});
  store.createItem({name:'Printer paper',unit:'reams',location:'Front desk cabinet',packSize:1,threshold:2,mode:'manual',quantity:0,countThrough:baseline});
  for (const id of [gloves,masks]) {
    store.addSupplier(id,{name:'Example supplier A',url:'https://www.mckesson.com/'});
    store.addSupplier(id,{name:'Example supplier B',url:'https://www.medline.com/'});
  }
  store.saveDay({day:store.today(),patients:20,actuals:[]});
}
