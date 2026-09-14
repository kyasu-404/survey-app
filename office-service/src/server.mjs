import { createServer } from 'node:http';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.mjs';
const pool=new pg.Pool({host:process.env.PGHOST || 'db',port:Number(process.env.PGPORT || 5432),user:process.env.PGUSER || 'postgres',password:process.env.PGPASSWORD,database:process.env.PGDATABASE || 'postgres',max:10,connectionTimeoutMillis:10000,statement_timeout:90000});
const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const server=createServer({requestTimeout:90000,headersTimeout:15000,maxHeaderSize:16384},createApp({pool,supabase}));
server.listen(Number(process.env.PORT || 8095),'0.0.0.0',()=>console.log('Survey Office API ready'));
let cleaning=false;
const timer=setInterval(async()=>{
  if(cleaning) return; cleaning=true;
  try {
    // Keep superseded files beyond the one-hour document-download capability TTL.
    const {rows}=await pool.query("select c.storage_path from public.office_storage_cleanup c where c.created_at<now()-interval '2 hours' and not exists(select 1 from public.office_documents d where d.storage_path=c.storage_path) limit 100");
    for(const row of rows) {
      const {error}=await supabase.storage.from('survey-documents').remove([row.storage_path]);
      if(!error) await pool.query('delete from public.office_storage_cleanup where storage_path=$1',[row.storage_path]);
    }
  } catch {console.error('Office storage cleanup failed');} finally {cleaning=false;}
},60000).unref();
process.on('SIGTERM',()=>{clearInterval(timer);server.close(()=>pool.end().then(()=>process.exit(0)));});
