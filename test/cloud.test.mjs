import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../inventory.mjs';
import {inventoryRequest} from '../cloud/service.mjs';
import {handle} from '../api/index.mjs';

const definition={name:'Gloves',unit:'gloves',quantity:1000,threshold:200,mode:'patients',rate:4,countThrough:'2026-10-28'};
const clock=()=>new Date('2026-10-30T16:00:00Z');
test('cloud snapshots retain counts, saved estimates, actual use, deliveries and suppliers',()=>{
  const source=createStore(':memory:',clock),restored=createStore(':memory:',clock);
  try{
    const id=source.createItem(definition);
    source.addSupplier(id,{name:'Supplier',url:'https://example.com/gloves'});
    source.saveDay({day:'2026-10-29',patients:10,actuals:[{itemId:id,quantity:30}]});
    source.editItem(id,{...definition,rate:8});
    source.addDelivery(id,{quantity:100});
    source.recordCount(id,{quantity:500,countThrough:'2026-10-29'});
    source.saveDay({day:'2026-10-30',patients:10,actuals:[]});
    source.addDelivery(id,{quantity:50});
    restored.restoreSnapshot(JSON.parse(JSON.stringify(source.exportSnapshot())));
    assert.deepEqual(restored.getState(),source.getState());
    assert.deepEqual(restored.getDay('2026-10-29'),source.getDay('2026-10-29'));
    assert.equal(restored.getState().items[0].remaining,470);
  }finally{source.close();restored.close();}
});
test('concurrent cloud updates retry against the latest version without duplicating a delivery',async()=>{
  const store=createStore();const id=store.createItem({...definition,mode:'manual'});
  let snapshot=store.exportSnapshot(),version=0,writes=0;store.close();
  const rpc=async(name,args)=>{
    if(name==='ci_read')return {snapshot:structuredClone(snapshot),version};
    writes++;
    if(writes===1){const concurrent=createStore();try{concurrent.restoreSnapshot(snapshot);concurrent.addDelivery(id,{quantity:7});snapshot=concurrent.exportSnapshot();version++;}finally{concurrent.close();}return false;}
    assert.equal(args.p_version,version);snapshot=args.p_snapshot;version++;return true;
  };
  await inventoryRequest({rpc,workspace:'demo',path:`/api/items/${id}/deliveries`,method:'POST',body:{quantity:20}});
  const result=createStore();try{result.restoreSnapshot(snapshot);assert.equal(result.getState().items[0].remaining,1027);assert.equal(snapshot.tables.deliveries.length,2);assert.equal(writes,2);}finally{result.close();}
});
test('invalid cloud mutations never reach the persistent write',async()=>{
  const store=createStore();const snapshot=store.exportSnapshot();store.close();let writes=0;
  const rpc=async name=>{if(name==='ci_read')return{snapshot,version:0};writes++;};
  await assert.rejects(inventoryRequest({rpc,workspace:'clinic',path:'/api/items',method:'POST',body:{...definition,quantity:-1}}));
  assert.equal(writes,0);
});
test('repeated cloud conflicts return a retryable error',async()=>{
  const store=createStore();const snapshot=store.exportSnapshot();store.close();
  const rpc=async name=>name==='ci_read'?{snapshot,version:0}:false;
  await assert.rejects(inventoryRequest({rpc,workspace:'clinic',path:'/api/items',method:'POST',body:definition}),{status:409});
});
test('cloud API blocks unauthenticated, cross-site and unsupported requests before touching data',async()=>{
  const request=(method,headers={})=>handle(new Request('https://clinic.example/api/state',{method,headers}));
  assert.equal((await request('GET')).status,401);
  assert.equal((await request('DELETE')).status,405);
  assert.equal((await request('GET',{'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await request('POST',{'x-clinic-request':'1',origin:'https://foreign.example'})).status,403);
  assert.equal((await request('POST')).status,403);
});
