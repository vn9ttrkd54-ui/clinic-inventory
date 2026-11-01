import { createClient } from '@supabase/supabase-js';
import { InputError } from '../inventory.mjs';
import { inventoryRequest } from '../cloud/service.mjs';
import { responseSecurityHeaders } from '../security.mjs';

const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...responseSecurityHeaders,'Content-Type':'application/json; charset=utf-8'}});
export async function handle(request) {
  try{
    const url=new URL(request.url);
    const route=url.searchParams.get('route');
    const path=route?`/api/${route}`:url.pathname;
    const workspace=url.searchParams.get('workspace')==='demo'?'demo':'clinic';
    if(!['GET','POST'].includes(request.method))return json(405,{error:'Method not allowed.'});
    if(request.headers.get('sec-fetch-site') && !['same-origin','none'].includes(request.headers.get('sec-fetch-site')))return json(403,{error:'Open the inventory website directly.'});
    if(request.method==='POST'){
      if(request.headers.get('x-clinic-request')!=='1')return json(403,{error:'Please submit changes from the inventory website.'});
      const origin=request.headers.get('origin');
      if(origin && origin!==url.origin)return json(403,{error:'Please submit changes from the inventory website.'});
    }
    const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)?.[1];
    if(!token)return json(401,{error:'Please sign in to your staff account.'});
    const {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,CLINIC_API_SECRET}=process.env;
    if(!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !CLINIC_API_SECRET)return json(503,{error:'Staff access is being configured. Please try again shortly.'});
    const client=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const {data,error:authError}=await client.auth.getUser(token);
    if(authError || !data.user)return json(401,{error:'Please sign in again.'});
    const rpc=async(name,args={})=>{
      const {data,error}=await client.rpc(name,{p_secret:CLINIC_API_SECRET,...args});
      if(error){const failure=new Error(error.code==='42501'?'This account does not have access to this action.':error.message);failure.status=error.code==='42501'?403:error.code==='22023'?400:503;throw failure;}
      return data;
    };
    let body;
    if(request.method==='POST'){
      if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw new InputError('Please submit JSON data.');
      const reader=request.body?.getReader();const parts=[];let length=0;
      if(reader)for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536){await reader.cancel();return json(413,{error:'This request is too large.'});}parts.push(value);}
      try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new InputError('The submitted data could not be read.');}
      if(body===null || typeof body!=='object' || Array.isArray(body))throw new InputError('Please submit a JSON object.');
    }
    if(path==='/api/staff'){
      if(request.method==='GET')return json(200,{staff:await rpc('ci_staff_list')});
      return json(200,await rpc('ci_staff_set',{p_email:body.email,p_role:body.role,p_active:body.active}));
    }
    if(path==='/api/staff/setup' && request.method==='POST'){
      const staff=await rpc('ci_staff_list');
      const target=staff.find(person=>person.active && person.email===String(body.email||'').trim().toLowerCase());
      if(!target)throw new InputError('Approve this staff email before creating a setup link.');
      const response=await fetch(`${SUPABASE_URL}/functions/v1/staff-setup`,{method:'POST',headers:{'Content-Type':'application/json','x-clinic-api-secret':CLINIC_API_SECRET},body:JSON.stringify({email:target.email})});
      const result=await response.json();
      if(!response.ok)return json(response.status,{error:result.error||'A setup link could not be created.'});
      return json(200,{url:`${url.origin}/#setup_token=${encodeURIComponent(result.tokenHash)}&setup_type=recovery`});
    }
    const result=await inventoryRequest({rpc,workspace,path,method:request.method,day:url.searchParams.get('date'),body});
    return json(200,result);
  }catch(error){
    const status=error instanceof InputError?400:error.status||500;
    return json(status,{error:status===500?'Unable to complete this change. Please refresh and try again.':error.message});
  }
}
export default {fetch:handle};
