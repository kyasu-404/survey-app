import { createServer } from 'node:http';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { startGenerationWorker } from './generation-jobs.mjs';
import { createApp } from './app.mjs';
const pool=new pg.Pool({host:process.env.PGHOST || 'db',port:Number(process.env.PGPORT || 5432),user:process.env.PGUSER || 'office_service',password:process.env.PGPASSWORD,database:process.env.PGDATABASE || 'postgres',max:10,connectionTimeoutMillis:10000,statement_timeout:90000});
pool.on('error',error=>console.error(JSON.stringify({event:'office-pg-pool-error',code:error?.code || error?.name || 'ERROR'})));
const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options={})=>fetch(url,{...options,signal:options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000)})}});
const server=createServer({requestTimeout:90000,headersTimeout:15000,maxHeaderSize:16384},createApp({pool,supabase}));
server.listen(Number(process.env.PORT || 8095),'0.0.0.0',()=>console.log('Survey Office API ready'));
const stopGenerationWorker=startGenerationWorker({pool,store:supabase.storage.from('survey-documents')});
let cleaning=false;
const timer=setInterval(async()=>{
  if(cleaning) return; cleaning=true;
  try {
    // Keep superseded files beyond the one-hour document-download capability TTL.
    const {rows}=await pool.query("select c.storage_path from public.office_storage_cleanup c where c.created_at<now()-interval '2 hours' and not exists(select 1 from public.office_documents d where d.storage_path=c.storage_path) and not exists(select 1 from public.office_generation_jobs j where j.storage_path=c.storage_path and j.state in ('queued','running')) limit 100");
    await pool.query("delete from public.office_generation_jobs where state in ('succeeded','failed') and finished_at<now()-interval '7 days'");
    for(const row of rows) {
      const {error}=await supabase.storage.from('survey-documents').remove([row.storage_path]);
      if(!error) await pool.query('delete from public.office_storage_cleanup where storage_path=$1',[row.storage_path]);
    }
  } catch {console.error('Office storage cleanup failed');} finally {cleaning=false;}
},60000).unref();
let shuttingDown=false;
for(const signal of ['SIGTERM','SIGINT']) {
  process.on(signal,()=>{
    if(shuttingDown) return;
    shuttingDown=true;
    setTimeout(()=>{console.error('Office service shutdown timed out');process.exit(1);},85000).unref();
    clearInterval(timer);
    const closeServer=new Promise(resolve=>server.close(()=>resolve()));
    server.closeIdleConnections?.();
    Promise.all([closeServer,stopGenerationWorker()])
      .then(()=>pool.end())
      .then(()=>process.exit(0))
      .catch(error=>{console.error(JSON.stringify({event:'office-shutdown-error',code:error?.code || error?.name || 'ERROR'}));process.exit(1);});
  });
}
