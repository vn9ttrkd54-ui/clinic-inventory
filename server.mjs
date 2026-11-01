import { createServer } from 'node:http';
import { readFile,stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve,extname,sep } from 'node:path';
import { createStore,seedDemo,InputError } from './inventory.mjs';
import { requestDenied,readJson,responseSecurityHeaders,secureDataDirectory } from './security.mjs';

const port=Number(process.env.PORT||3001);
if (!Number.isInteger(port)||port<1||port>65535) throw new Error('Choose a valid local port.');
const root=fileURLToPath(new URL('./public/',import.meta.url));
const data=fileURLToPath(new URL('./data/',import.meta.url));
// New SQLite files and journals are private to the server's operating-system account.
process.umask(0o077);
await secureDataDirectory(data);
const stores={clinic:createStore(resolve(data,'inventory.sqlite')),demo:createStore(resolve(data,'demo.sqlite'))};
seedDemo(stores.demo);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
function json(response,status,body) {response.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});response.end(JSON.stringify(body));}
const server=createServer(async(request,response)=>{
  for(const [name,value] of Object.entries(responseSecurityHeaders))response.setHeader(name,value);
  try {
    const denied=requestDenied(request,port);
    if(denied){json(response,403,{error:denied});return;}
    const url=new URL(request.url,`http://localhost:${port}`);
    const store=url.searchParams.get('workspace')==='demo'?stores.demo:stores.clinic;
    if(url.pathname==='/api/state' && request.method==='GET'){json(response,200,store.getState());return;}
    if(url.pathname==='/api/day' && request.method==='GET'){json(response,200,store.getDay(url.searchParams.get('date')));return;}
    if(url.pathname.startsWith('/api/') && request.method==='POST'){
      if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']||''))throw new InputError('Please submit JSON data.');
      const body=await readJson(request);
      let id;
      const route=url.pathname.match(/^\/api\/items\/([a-zA-Z0-9-]+)(?:\/(count|deliveries|suppliers|archive))?$/);
      const supplier=url.pathname.match(/^\/api\/suppliers\/([a-zA-Z0-9-]+)\/archive$/);
      if(url.pathname==='/api/items')id=store.createItem(body);
      else if(url.pathname==='/api/day')store.saveDay(body);
      else if(route){
        id=route[1];
        if(!route[2])store.editItem(id,body);
        if(route[2]==='count')store.recordCount(id,body);
        if(route[2]==='deliveries')store.addDelivery(id,body);
        if(route[2]==='suppliers')store.addSupplier(id,body);
        if(route[2]==='archive')store.archiveItem(id,body.archived);
      }else if(supplier)store.archiveSupplier(supplier[1],body.archived);
      else{json(response,404,{error:'Action not found.'});return;}
      json(response,200,{ok:true,id});return;
    }
    if(!['GET','HEAD'].includes(request.method)){json(response,405,{error:'Method not allowed.'});return;}
    if(url.pathname.startsWith('/api/')){json(response,404,{error:'Not found.'});return;}
    const pathname=decodeURIComponent(url.pathname);
    const path=resolve(root,pathname==='/'?'index.html':pathname.replace(/^\/+/,''));
    if(!path.startsWith(root.endsWith(sep)?root:root+sep)){response.writeHead(403);response.end('Forbidden');return;}
    if(!(await stat(path)).isFile()){response.writeHead(404);response.end('Not found');return;}
    const contents=await readFile(path);
    response.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Content-Length':contents.length});
    response.end(request.method==='HEAD'?undefined:contents);
  }catch(error){
    if(error instanceof URIError){json(response,400,{error:'Invalid request path.'});return;}
    if(error instanceof InputError){json(response,400,{error:error.message});return;}
    if(error.code==='ENOENT'||error.code==='ENOTDIR'){response.writeHead(404);response.end('Not found');return;}
    console.error(error);
    json(response,500,{error:'Unable to complete this change. Your previously saved data is retained.'});
  }
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is in use. Try PORT=3002 npm run dev.`:error.message);process.exit(1);});
server.listen(port,'127.0.0.1',()=>console.log(`\nSupply room: http://localhost:${port}/?demo=1\nReal inventory: http://localhost:${port}/\nPress Ctrl+C to stop.\n`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{stores.clinic.close();stores.demo.close();process.exit(0);}));
