import { createClient } from '@supabase/supabase-js';

const config=globalThis.CLINIC_CONFIG;
const client=createClient(config.url,config.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let session,ready,clear,approved=false,generation=0,setupPending=false;
const setupParams=new URLSearchParams(location.hash.slice(1));
const setupToken=setupParams.get('setup_token');
if(setupToken){setupPending=true;history.replaceState(null,'',location.pathname+location.search);}
const panel=document.createElement('section');
panel.id='staff-sign-in';panel.className='auth-panel shell';panel.dataset.cloudUi='';
panel.innerHTML=`<div class="auth-card"><p class="eyebrow">Florida Maxillofacial and Reconstructive Surgery</p><h1>Clinic Inventory</h1><p class="help">Sign in with your approved staff email to access the clinic’s shared supplies.</p><form id="staff-auth-form"><label>Email address<input name="email" type="email" autocomplete="username" maxlength="254" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="primary-button" type="submit">Sign in</button></form><form id="staff-password-form" hidden><label>Choose your password<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><label>Confirm password<input name="confirm" type="password" autocomplete="new-password" minlength="12" required></label><button class="primary-button" type="submit">Save password & open inventory</button></form><p id="auth-message" class="form-error" role="alert" hidden></p><p class="help" id="account-help">Need an account or a password reset? Ask your clinic administrator for a one-time setup link.</p></div>`;
$('main').before(panel);
const controls=document.createElement('div');controls.className='account-controls';controls.dataset.cloudUi='';controls.hidden=true;
controls.innerHTML='<span id="signed-in-email"></span><button class="text-button" id="manage-staff" type="button" hidden>Staff access</button><button class="text-button" id="staff-sign-out" type="button">Sign out</button>';
$('.app-header .shell').append(controls);
const staffDialog=document.createElement('dialog');staffDialog.dataset.cloudUi='';staffDialog.id='staff-access-dialog';staffDialog.setAttribute('aria-labelledby','staff-access-heading');document.body.append(staffDialog);

function message(text,success=false){const box=$('#auth-message');box.hidden=false;box.classList.toggle('auth-success',success);box.textContent=text;}
function hideInventory(){approved=false;$('main').hidden=true;$('.app-footer').hidden=true;$('#demo-banner').hidden=true;panel.hidden=false;clear?.();}
async function request(path,body){
  const token=session?.access_token;
  if(!token)throw new Error('Please sign in to your staff account.');
  const response=await fetch(path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':'application/json','X-Clinic-Request':'1'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let result;try{result=await response.json();}catch{throw new Error('The inventory service could not be reached. Please try again.');}
  if(!response.ok){if(response.status===401||response.status===403){hideInventory();message(response.status===401?'Please sign in again.':'Your account is not approved for this action. Contact the clinic administrator.');}throw new Error(result.error||'Unable to complete this request.');}
  return result;
}
async function showSession(next){
  const current=++generation;session=next;
  if(setupPending)return;
  if(!next){controls.hidden=true;hideInventory();return;}
  try{
    const info=await request('/api/session');if(current!==generation)return;
    approved=true;panel.hidden=true;controls.hidden=false;$('main').hidden=false;$('.app-footer').hidden=false;
    $('#signed-in-email').textContent=info.email;$('#manage-staff').hidden=info.role!=='admin';
    await ready();
  }catch(error){if(current===generation){hideInventory();controls.hidden=false;$('#manage-staff').hidden=true;$('#signed-in-email').textContent=next.user?.email||'';message(error.message);}}
}

$('#staff-auth-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target;const button=form.querySelector('button[type="submit"]');button.disabled=true;
  $('#auth-message').hidden=true;
  try{const values=Object.fromEntries(new FormData(form));const {error}=await client.auth.signInWithPassword({email:values.email.trim(),password:values.password});if(error)message('Sign-in failed. Check your email and password.');else form.elements.password.value='';}
  catch{message('Sign-in could not be completed. Please try again.');}finally{button.disabled=false;}
});
$('#staff-password-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target;const values=Object.fromEntries(new FormData(form));
  if(values.password!==values.confirm){message('The passwords do not match.');return;}
  if(values.password.length<12){message('Choose a password with at least 12 characters.');return;}
  const button=form.querySelector('button');button.disabled=true;
  try{const {error}=await client.auth.updateUser({password:values.password});if(error)throw error;
    form.reset();setupPending=false;form.hidden=true;$('#staff-auth-form').hidden=false;$('#auth-message').hidden=true;
    await showSession((await client.auth.getSession()).data.session);
  }catch{message('Your password could not be saved. Please try again.');}finally{button.disabled=false;}
});
$('#staff-sign-out').addEventListener('click',async()=>{await client.auth.signOut();session=null;controls.hidden=true;hideInventory();$('#staff-auth-form').reset();});

async function renderStaff(){
  const {staff}=await request('/api/staff');
  staffDialog.innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">Administrator</p><h2 id="staff-access-heading">Staff access</h2></div><button class="close-button" type="button" data-close-staff aria-label="Close staff access">×</button></div><p class="help">Approve an email, then create a one-time setup link and share it directly with that person. This website does not send emails.</p><ul class="staff-list">${staff.map(person=>`<li><div><strong>${escape(person.email)}</strong><span>${escape(person.role)} · ${person.active?'Approved':'Access removed'}</span></div><div>${person.active?`<button class="quiet-button" type="button" data-setup-email="${escape(person.email)}">Setup / reset password</button>`:''}<button class="quiet-button" type="button" data-staff-email="${escape(person.email)}" data-staff-role="${escape(person.role)}" data-staff-active="${!person.active}">${person.active?'Remove access':'Restore access'}</button></div></li>`).join('')}</ul><div id="staff-setup-result" hidden><label>One-time setup link<input id="staff-setup-url" readonly></label><button class="quiet-button" type="button" data-copy-setup>Copy link</button><p class="help">Treat this link like a temporary password. Share it only with the person named. Opening the link starts password setup.</p></div><form id="staff-access-form"><div class="form-grid"><label>Staff email<input name="email" type="email" maxlength="254" required></label><label>Access role<select name="role"><option value="staff">Staff</option><option value="admin">Administrator</option></select></label></div><p class="form-error" role="alert" hidden></p><div class="form-actions"><button class="primary-button" type="submit">Approve staff</button></div></form><p id="staff-access-error" class="form-error" role="alert" hidden></p>`;
}
$('#manage-staff').addEventListener('click',async()=>{try{await renderStaff();staffDialog.showModal();}catch(error){message(error.message);}});
staffDialog.addEventListener('close',()=>$('#manage-staff').focus());
staffDialog.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-close-staff')){staffDialog.close();return;}
  if(button.hasAttribute('data-copy-setup')){try{await navigator.clipboard.writeText($('#staff-setup-url').value);button.textContent='Copied';}catch{$('#staff-setup-url').select();}return;}
  if(button.dataset.setupEmail){button.disabled=true;try{const result=await request('/api/staff/setup',{email:button.dataset.setupEmail});$('#staff-setup-url').value=result.url;$('#staff-setup-result').hidden=false;$('#staff-setup-url').focus();$('#staff-setup-url').select();}catch(error){const box=$('#staff-access-error');box.hidden=false;box.textContent=error.message;}finally{button.disabled=false;}return;}
  if(button.dataset.staffEmail){button.disabled=true;try{await request('/api/staff',{email:button.dataset.staffEmail,role:button.dataset.staffRole,active:button.dataset.staffActive==='true'});await renderStaff();$('#staff-access-heading').setAttribute('tabindex','-1');$('#staff-access-heading').focus();}catch(error){const box=$('#staff-access-error');box.hidden=false;box.textContent=error.message;button.disabled=false;}}
});
staffDialog.addEventListener('submit',async event=>{
  if(event.target.id!=='staff-access-form')return;event.preventDefault();const form=event.target;const button=form.querySelector('button');button.disabled=true;
  try{const values=Object.fromEntries(new FormData(form));await request('/api/staff',{...values,active:true});await renderStaff();$('#staff-access-form input').focus();}
  catch(error){const box=form.querySelector('.form-error');box.hidden=false;box.textContent=error.message;button.disabled=false;}
});

globalThis.ClinicCloud={request,async start(onReady,onClear){
  ready=onReady;clear=onClear;hideInventory();
  $('#sample-link').textContent='Sample inventory';
  $('.app-footer>p').lastChild.textContent=' Shared clinic inventory';
  client.auth.onAuthStateChange((event,next)=>{session=next;if(setupPending||event==='TOKEN_REFRESHED'&&approved)return;queueMicrotask(()=>showSession(next));});
  if(setupToken){
    $('#staff-auth-form').hidden=true;$('#account-help').textContent='Choose a password of at least 12 characters for your staff account.';
    message('Checking your setup link…',true);
    try{
      const {data,error}=await client.auth.verifyOtp({token_hash:setupToken,type:'recovery'});
      if(error)throw error;
      session=data.session;$('#auth-message').hidden=true;$('#staff-password-form').hidden=false;$('#staff-password-form input').focus();
    }catch{setupPending=false;$('#staff-auth-form').hidden=false;message('This setup link has expired or could not be checked. Ask the administrator for a new link.');}
  }
}};
