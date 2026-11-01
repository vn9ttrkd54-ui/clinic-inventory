import { createStore, InputError } from '../inventory.mjs';

export function applyMutation(store,path,body) {
  let id;
  const item=path.match(/^\/api\/items\/([a-zA-Z0-9-]+)(?:\/(count|deliveries|suppliers|archive))?$/);
  const supplier=path.match(/^\/api\/suppliers\/([a-zA-Z0-9-]+)\/archive$/);
  if(path==='/api/items') id=store.createItem(body);
  else if(path==='/api/day') store.saveDay(body);
  else if(item){
    id=item[1];
    if(!item[2])store.editItem(id,body);
    if(item[2]==='count')store.recordCount(id,body);
    if(item[2]==='deliveries')store.addDelivery(id,body);
    if(item[2]==='suppliers')store.addSupplier(id,body);
    if(item[2]==='archive')store.archiveItem(id,body.archived);
  } else if(supplier)store.archiveSupplier(supplier[1],body.archived);
  else throw new InputError('Action not found.');
  return {ok:true,id};
}

export async function inventoryRequest({rpc,workspace,path,method,day,body}) {
  for(let attempt=0;attempt<4;attempt++){
    const saved=await rpc('ci_read',{p_workspace:workspace});
    const store=createStore();
    try{
      store.restoreSnapshot(saved.snapshot);
      if(method==='GET') {
        if(path==='/api/session')return {email:saved.email,role:saved.role};
        if(path==='/api/state')return store.getState();
        if(path==='/api/day')return store.getDay(day);
        throw new InputError('Action not found.');
      }
      const result=applyMutation(store,path,body);
      const committed=await rpc('ci_write',{p_workspace:workspace,p_version:saved.version,p_snapshot:store.exportSnapshot(),p_action:path});
      if(committed)return result;
    } finally {store.close();}
  }
  const error=new Error('Another staff member is updating inventory. Please try again.');error.status=409;throw error;
}
