import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore,supplierUrl } from '../inventory.mjs';

const clock=()=>new Date('2026-10-30T16:00:00Z');
const definition={name:'Gloves',unit:'gloves',location:'Cabinet 1',packSize:100,threshold:200,mode:'patients',rate:4,quantity:1000,countThrough:'2026-10-28'};
function setup(t, overrides={}){const store=createStore(':memory:',clock);t.after(()=>store.close());const id=store.createItem({...definition,...overrides});return{store,id,item:()=>store.getState().items.find(row=>row.id===id)};}

test('patient-based usage is calculated in the chosen tracking unit',t=>{
  const{store,item}=setup(t);store.saveDay({day:'2026-10-29',patients:20,actuals:[]});assert.equal(item().remaining,920);assert.equal(item().hasEstimates,true);
});
test('actual use replaces an estimate instead of adding to it',t=>{
  const{store,id,item}=setup(t);store.saveDay({day:'2026-10-29',patients:20,actuals:[{itemId:id,quantity:60}]});assert.equal(item().remaining,940);assert.equal(item().hasEstimates,false);
});
test('zero actual use is a valid override and clearing it restores the estimate',t=>{
  const{store,id,item}=setup(t);store.saveDay({day:'2026-10-29',patients:20,actuals:[{itemId:id,quantity:0}]});assert.equal(item().remaining,1000);store.saveDay({day:'2026-10-29',patients:20,actuals:[{itemId:id,quantity:null}]});assert.equal(item().remaining,920);
});
test('saving or correcting the same day does not deduct it twice',t=>{
  const{store,item}=setup(t);for(let i=0;i<3;i++)store.saveDay({day:'2026-10-29',patients:20,actuals:[]});assert.equal(item().remaining,920);store.saveDay({day:'2026-10-29',patients:10,actuals:[]});assert.equal(item().remaining,960);
});
test('rate changes preserve saved days and apply to newly recorded days',t=>{
  const{store,id,item}=setup(t);store.saveDay({day:'2026-10-29',patients:20,actuals:[]});store.editItem(id,{...definition,rate:6});assert.equal(item().remaining,920);store.saveDay({day:'2026-10-30',patients:10,actuals:[]});assert.equal(item().remaining,860);store.saveDay({day:'2026-10-29',patients:10,actuals:[]});assert.equal(item().remaining,900);
});
test('a physical count replaces previous stock and only includes later deliveries and usage',t=>{
  const{store,id,item}=setup(t);store.addDelivery(id,{quantity:100});store.saveDay({day:'2026-10-29',patients:20,actuals:[]});store.recordCount(id,{quantity:500,countThrough:'2026-10-29'});assert.equal(item().remaining,500);store.saveDay({day:'2026-10-30',patients:10,actuals:[]});assert.equal(item().remaining,460);store.addDelivery(id,{quantity:50});assert.equal(item().remaining,510);
});
test('low-stock threshold is inclusive and excess use reports a shortfall',t=>{
  const{store,id,item}=setup(t,{quantity:280});store.saveDay({day:'2026-10-29',patients:20,actuals:[]});assert.equal(item().remaining,200);assert.equal(item().status,'low');store.saveDay({day:'2026-10-29',patients:100,actuals:[]});assert.equal(item().remaining,0);assert.equal(item().status,'out');assert.equal(item().shortfall,120);
});
test('manual tracking does not use patient totals',t=>{
  const{store,id,item}=setup(t,{mode:'manual'});store.saveDay({day:'2026-10-29',patients:20,actuals:[]});assert.equal(item().remaining,1000);store.saveDay({day:'2026-10-29',patients:20,actuals:[{itemId:id,quantity:75}]});assert.equal(item().remaining,925);
});
test('supplier links belong to their supply and can be archived and restored',t=>{
  const{store,id,item}=setup(t);const other=store.createItem({...definition,name:'Masks'});store.addSupplier(id,{name:'Company A',url:'https://example.com/gloves'});store.addSupplier(id,{name:'Company B',url:'https://example.org/gloves'});assert.equal(item().suppliers.length,2);assert.equal(store.getState().items.find(row=>row.id===other).suppliers.length,0);const supplier=item().suppliers[0];store.archiveSupplier(supplier.id,true);assert.equal(item().suppliers.filter(row=>!row.archived).length,1);store.archiveSupplier(supplier.id,false);assert.equal(item().suppliers.filter(row=>!row.archived).length,2);
});
test('duplicate and unsafe supplier links are rejected',t=>{
  const{store,id}=setup(t);assert.throws(()=>supplierUrl('javascript:alert(1)'));assert.throws(()=>supplierUrl('https://user:pass@example.com/'));store.addSupplier(id,{name:'Company A',url:'https://example.com/gloves'});assert.throws(()=>store.addSupplier(id,{name:'Duplicate',url:'https://example.com/gloves'}));
});
test('invalid daily entries do not partly overwrite an existing day',t=>{
  const{store,id,item}=setup(t);store.saveDay({day:'2026-10-29',patients:20,actuals:[]});assert.throws(()=>store.saveDay({day:'2026-10-29',patients:10,actuals:[{itemId:id,quantity:-1}]}));assert.equal(store.getDay('2026-10-29').patients,20);assert.equal(item().remaining,920);assert.throws(()=>store.saveDay({day:'2026-11-01',patients:10,actuals:[]}));
});
test('archiving and restoring a supply retains its saved history and links',t=>{
  const{store,id,item}=setup(t);store.addSupplier(id,{name:'Company A',url:'https://example.com/'});store.saveDay({day:'2026-10-29',patients:20,actuals:[]});store.archiveItem(id,true);assert.equal(item().archived,1);store.archiveItem(id,false);assert.equal(item().remaining,920);assert.equal(item().suppliers.length,1);
});
test('inventory, daily use, and supplier links survive a database restart',()=>{
  const directory=mkdtempSync(join(tmpdir(),'clinic-inventory-test-'));const filename=join(directory,'test.sqlite');let store;
  try{store=createStore(filename,clock);const id=store.createItem(definition);store.addSupplier(id,{name:'Company A',url:'https://example.com/'});store.saveDay({day:'2026-10-29',patients:20,actuals:[]});store.close();store=createStore(filename,clock);assert.equal(store.getState().items[0].remaining,920);assert.equal(store.getState().items[0].suppliers.length,1);assert.equal(store.getDay('2026-10-29').patients,20);}finally{store?.close();rmSync(directory,{recursive:true,force:true});}
});
test('changing tracking units requires a separate supply',t=>{
  const{store,id}=setup(t);assert.throws(()=>store.editItem(id,{...definition,unit:'boxes'}));
});
