// Supabase Edge Function: send-telegram (test + secure subscriber broadcast)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
 try{
  const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, token=Deno.env.get('TELEGRAM_BOT_TOKEN');
  if(!url||!anon||!service||!token)return json({error:'Supabase or Telegram secrets are not configured'},500);
  const auth=req.headers.get('Authorization');if(!auth)return json({error:'Unauthorized'},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const {data:{user},error:userErr}=await userClient.auth.getUser();if(userErr||!user)return json({error:'Unauthorized'},401);
  const admin=createClient(url,service);
  const {data:admins,error:adminErr}=await admin.from('admins').select('role,permissions').ilike('email',user.email||'').limit(1);
  if(adminErr||!admins?.length)return json({error:'Admin record not found'},403);
  const role=admins[0].role, perms=admins[0].permissions||{};
  const body=await req.json().catch(()=>({}));const message=typeof body.message==='string'?body.message.trim():'';
  if(!message||message.length>4000)return json({error:'Message must contain 1–4000 characters'},400);
  const isBroadcast=body.action==='broadcast';
  if(isBroadcast){if(role!=='super_admin'&&perms.broadcast_telegram!==true)return json({error:'Only super_admin can broadcast'},403);}
  else if(role!=='super_admin')return json({error:'Only super_admin can send test messages'},403);
  if(!isBroadcast){const chatId=Deno.env.get('TELEGRAM_CHAT_ID');if(!chatId)return json({error:'TELEGRAM_CHAT_ID is not configured'},500);const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:message,disable_web_page_preview:true})});const j=await r.json();if(!j.ok)return json({error:'Telegram API error',details:j},502);return json({ok:true,sent:1});}
  const {data:subs,error:subErr}=await admin.from('bot_subscribers').select('telegram_id,chat_id').eq('is_active',true).limit(10000);
  if(subErr)return json({error:'Cannot load bot_subscribers. Apply 001_init_database.sql.',details:subErr.message},500);
  let sent=0,failed=0;const errors:string[]=[];
  for(const sub of subs||[]){try{const sendOne=()=>fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:sub.chat_id,text:message,disable_web_page_preview:true})});let r=await sendOne(),j=await r.json();if(!j.ok&&j.error_code===429){const wait=Math.min(Number(j.parameters?.retry_after||2),15);await new Promise(resolve=>setTimeout(resolve,wait*1000+200));r=await sendOne();j=await r.json();}if(j.ok)sent++;else{failed++;if(j.error_code===403)await admin.from('bot_subscribers').update({is_active:false}).eq('telegram_id',sub.telegram_id);if(errors.length<5)errors.push(String(j.description||'Telegram error'));}}catch(e){failed++;if(errors.length<5)errors.push(String(e));}await new Promise(r=>setTimeout(r,40));}
  await admin.from('bot_logs').insert({message:`Admin broadcast: ${sent} sent, ${failed} failed`,status:failed?'partial':'sent',error_text:errors.join('; ')||null,source:'admin_broadcast'});
  return json({ok:true,total:(subs||[]).length,sent,failed,errors});
 }catch(e){return json({error:String(e)},500)}
});
