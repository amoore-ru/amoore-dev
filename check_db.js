#!/usr/bin/env node
/* Amoore Supabase preflight. No dependencies; Node 18+. */
const base = (process.env.SUPABASE_URL || process.env.AMOORE_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const required = ['admins','ecosystem_sites','news'];
const optional = ['bot_status','bot_subscribers'];
const headers = () => ({ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' });
async function request(path, opts={}) { const r=await fetch(base+path,{...opts,headers:{...headers(),...(opts.headers||{})},signal:AbortSignal.timeout(10000)}); const body=await r.text(); return {ok:r.ok,status:r.status,body}; }
async function main(){
 if(!base||!key){console.error('CONFIG ERROR: задайте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (локально, не публикуйте ключ).');process.exitCode=2;return;}
 console.log('Amoore DB preflight:',base);
 let failed=false;
 for(const t of required){try{const r=await request(`/rest/v1/${t}?select=*&limit=0`);const ok=r.ok;console.log(`${ok?'OK':'FAIL'} table ${t}: HTTP ${r.status}`);if(!ok){failed=true;console.log(`  → Проверьте миграцию amoore-dev/shared/sql/001_amoore_schema.sql и grants/RLS для service_role.`);}}catch(e){failed=true;console.log(`FAIL table ${t}: ${e.message}`)}}
 for(const t of optional){try{const r=await request(`/rest/v1/${t}?select=*&limit=0`);console.log(`${r.ok?'OK':'INFO'} optional table ${t}: HTTP ${r.status}`);if(!r.ok)console.log(`  → Для функций v0.4 выполните миграцию 003_v04_onboarding_broadcast.sql (bot_subscribers); bot_status создаётся миграцией 002_v202_bot_leads.sql.`);}catch(e){console.log(`INFO optional table ${t}: ${e.message}`)}}
 try{const r=await request('/storage/v1/bucket');let buckets=[];if(r.ok){try{buckets=JSON.parse(r.body).map(x=>x.name)}catch{}}const ok=r.ok&&buckets.includes('media');console.log(`${ok?'OK':'FAIL'} Storage bucket media`);if(!ok){failed=true;console.log('  → Supabase Dashboard → Storage → New bucket → name: media. Проверьте политики доступа и публичность согласно README.')}}catch(e){failed=true;console.log('FAIL Storage:',e.message)}
 if(process.env.DATABASE_URL){
   const {spawnSync}=require('child_process');const sql="select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('admins','ecosystem_sites','news') order by c.relname;";
   const p=spawnSync('psql',[process.env.DATABASE_URL,'-At','-F','|','-c',sql],{encoding:'utf8'});
   if(p.status===0){for(const line of p.stdout.trim().split(/\n/).filter(Boolean)){const [name,rls]=line.split('|');const ok=rls==='t';console.log(`${ok?'OK':'FAIL'} RLS ${name}: ${ok?'enabled':'DISABLED'}`);if(!ok)failed=true;} }else{console.log('WARN RLS introspection: psql не выполнен. Установите psql и задайте DATABASE_URL; REST API не раскрывает pg_class/relrowsecurity.');console.log((p.stderr||'').trim())}
 }else console.log('WARN RLS: для точной проверки задайте DATABASE_URL и установите psql.');
 console.log(failed?'\nPreflight завершён: есть блокирующие проблемы.':'\nPreflight завершён: проверенные endpoints доступны.');if(failed)process.exitCode=1;
}
main().catch(e=>{console.error('FATAL',e);process.exitCode=2});
