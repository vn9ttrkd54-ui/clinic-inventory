import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
const json=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async request=>{
  if(request.method!=='POST')return json(405,{error:'Method not allowed.'});
  const secret=request.headers.get('x-clinic-api-secret');
  if(!secret || secret.length<32 || secret.length>128)return json(403,{error:'Access denied.'});
  try{
    const reader=request.body?.getReader();const parts:Uint8Array[]=[];let size=0;
    if(reader)for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4096){await reader.cancel();return json(413,{error:'Request too large.'});}parts.push(chunk.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    const body=JSON.parse(new TextDecoder().decode(bytes));
    if(typeof body.email!=='string')return json(400,{error:'Email required.'});
    const url=Deno.env.get('SUPABASE_URL');const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url || !key)return json(503,{error:'Account setup is not configured.'});
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:target,error:gateError}=await admin.rpc('ci_service_target',{p_secret:secret,p_email:body.email});
    if(gateError || !target?.email)return json(403,{error:'Access denied.'});
    const created=await admin.auth.admin.createUser({email:target.email,email_confirm:true});
    if(created.error && !['email_exists','user_already_exists'].includes(created.error.code||''))return json(400,{error:'Account could not be prepared.'});
    const {data,error}=await admin.auth.admin.generateLink({type:'recovery',email:target.email});
    if(error || !data.properties?.hashed_token)return json(503,{error:'A setup link could not be created.'});
    return json(200,{tokenHash:data.properties.hashed_token,type:'recovery'});
  }catch{return json(400,{error:'Account setup could not be completed.'});}
});
