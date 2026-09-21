import { randomUUID } from 'node:crypto';
import { enqueueGeneration } from './generation-jobs.mjs';
import { runOfficeTask } from './office-tasks.mjs';
import { readFile } from 'node:fs/promises';
import { HttpError, requireValue, uuid, sign, verify, encrypt, decrypt, encryptionKey, baseUrl, saveUrl, readLimited, fetchLimited, documentName, documentKey } from './security.mjs';
import { DOCX_MIME, blankDocx } from './docx.mjs';
import {XLSX_MIME,mimeFor,blankXlsx,templateSources,systemFields} from './templates.mjs';
export const PLUGIN_GUID = 'asc.{BA7A912A-0856-4677-9AB5-390CA8D4D636}';
const BUCKET = 'survey-documents';
const now = () => Math.floor(Date.now()/1000);

export function createApp({pool, supabase, env = process.env}) {
  const key = encryptionKey(env.ONLYOFFICE_SETTINGS_ENCRYPTION_KEY);
  const tokenKey = Buffer.from(key).toString('hex') + ':survey-office-capability-v1';
  const appUrl = baseUrl(env.PUBLIC_APP_URL);
  const store = supabase.storage.from(BUCKET);
  const query = async (sql,args=[]) => (await pool.query(sql,args)).rows;
  const settings = async () => (await query('select * from public.onlyoffice_settings where id=1'))[0];
  const publicSettings = s => { const {jwt_secret_encrypted, ...safe} = s; return {...safe,has_secret:Boolean(jwt_secret_encrypted)}; };
  const issue = (purpose, payload, ttl=900) => sign({purpose,...payload,iat:now(),exp:now()+ttl},tokenKey);
  function capability(token,purpose) {
    const claims=verify(token,tokenKey);
    requireValue(claims.purpose===purpose && Number.isFinite(claims.exp),'Недостаточно прав токена',401);
    return claims;
  }
  async function authenticate(req) {
    const token = (req.headers.authorization || '').replace(/^Bearer /,'');
    requireValue(token,'Требуется вход в систему',401);
    let claims=null, id;
    try { claims=capability(token,'plugin'); id=claims.sub; }
    catch {
      const {data,error}=await supabase.auth.getUser(token);
      requireValue(!error && data.user,'Сессия истекла. Войдите снова.',401);
      id=data.user.id;
    }
    const profile=(await query('select id,name,role,is_disabled from public.profiles where id=$1',[id]))[0];
    requireValue(profile && !profile.is_disabled,'Доступ сотрудника отключён',403);
    return {profile,claims};
  }
  const employeeOnly = auth => requireValue(!auth.claims,'Токен плагина не разрешает эту операцию',403);
  function adminOnly(auth) { employeeOnly(auth); requireValue(auth.profile.role==='admin','Требуются права администратора',403); }
  async function formFor(id,auth) {
    requireValue(uuid(id),'Неверный ID формы');
    requireValue(!auth.claims || auth.claims.formId===id,'Токен другой формы',403);
    const form=(await query('select * from public.forms where id=$1',[id]))[0];
    requireValue(form,'Форма не найдена',404); return form;
  }
  async function documentFor(id,auth,db=pool,lock=false) {
    requireValue(uuid(id),'Неверный ID документа');
    const doc=(await db.query(`select * from public.office_documents where id=$1${lock ? ' for update' : ''}`,[id])).rows[0];
    requireValue(doc,'Документ не найден',404);
    requireValue(!auth.claims || (auth.claims.documentId===id && auth.claims.formId===doc.form_id),'Токен другого документа',403);
    return doc;
  }
  async function download(path) {
    const {data,error}=await store.download(path);
    requireValue(!error && data,'Файл временно недоступен в хранилище',502);
    return Buffer.from(await data.arrayBuffer());
  }
  async function upload(path,bytes,format='docx') {
    const {error}=await store.upload(path,bytes,{contentType:mimeFor(format),upsert:false});
    requireValue(!error,'Не удалось сохранить файл в хранилище',502);
  }
  async function transaction(fn) {
    const db=await pool.connect();
    try { await db.query('begin'); await db.query("set local lock_timeout='15s'"); const value=await fn(db); await db.query('commit'); return value; }
    catch(error) { await db.query('rollback'); throw error; }
    finally {db.release();}
  }
  async function createDocument(form,auth,name,bytes,format='docx') {
    const {fieldCount}=await runOfficeTask({task:'inspect',bytes,format});
    const id=randomUUID(), storagePath=`forms/${form.id}/documents/${id}/${randomUUID()}.${format}`;
    await upload(storagePath,bytes,format);
    try {
      return await transaction(async db => {
        const doc=(await db.query('insert into public.office_documents(id,form_id,name,storage_path,size_bytes,created_by,updated_by,file_type,template_field_count) values($1,$2,$3,$4,$5,$6,$6,$7,$8) returning *',[id,form.id,name,storagePath,bytes.length,auth.profile.id,format,fieldCount])).rows[0];

        return doc;
      });
    } catch(error) { await store.remove([storagePath]); throw error; }
  }
  async function callback(req,res,id,s,body) {
    requireValue(uuid(id),'Неверный ID документа');
    requireValue(s.jwt_secret_encrypted,'JWT не настроен',503);
    const secret=decrypt(s.jwt_secret_encrypted,key);
    const header=req.headers[s.jwt_header.toLowerCase()];
    const prefix=s.jwt_prefix || '';
    const token=header && header.startsWith(prefix) ? header.slice(prefix.length) : body.token;
    requireValue(typeof token==='string','Нет подписи ONLYOFFICE',401);
    const signed=verify(token,secret);
    // The signed payload is authoritative. Never substitute unsigned body fields.
    const payload=signed.payload || signed;
    requireValue(typeof payload.key==='string' && [1,2,3,4,6,7].includes(payload.status),'Некорректный подписанный callback');
    try {
      await transaction(async db => {
        const doc=(await db.query('select * from public.office_documents where id=$1 for update',[id])).rows[0];
        requireValue(doc,'Документ удалён',404);
        if(payload.key!==documentKey(doc)) {
          // A retried completed callback is acknowledged without overwriting newer data.
          const prefixKey=`survey_${id.replaceAll('-','')}_v`;
          const oldVersion=payload.key.startsWith(prefixKey) ? Number(payload.key.slice(prefixKey.length)) : NaN;
          requireValue(Number.isInteger(oldVersion) && oldVersion>0 && oldVersion<doc.version,'Ключ документа не совпадает',409);
          return;
        }
        if([3,7].includes(payload.status)) {
          await db.query('update public.office_documents set last_save_error=$2,last_callback_at=now() where id=$1',[id,'ONLYOFFICE сообщил об ошибке сохранения']); return;
        }
        if(![2,6].includes(payload.status)) {
          await db.query('update public.office_documents set last_callback_at=now() where id=$1',[id]); return;
        }
        const forceTime=Number(payload.lastsave || 0);
        if(payload.status===6 && forceTime && forceTime<Number(doc.last_force_save_at)) return;
        const bytes=await fetchLimited(saveUrl(payload.url,s),{},s.max_file_mb*1024*1024);
        const path=`forms/${doc.form_id}/documents/${id}/${randomUUID()}.${doc.file_type || "docx"}`;
        const {fieldCount}=await runOfficeTask({task:'inspect',bytes,format:doc.file_type || 'docx',maxBytes:s.max_file_mb*1024*1024});
        await upload(path,bytes,doc.file_type || 'docx');
        try {
          const userId=Array.isArray(payload.users) && uuid(payload.users[0]) ? payload.users[0] : null;
          await db.query(`update public.office_documents set storage_path=$2,size_bytes=$3,version=version+$4,updated_at=now(),last_callback_at=now(),
            last_save_error=null,last_force_save_at=$5,template_field_count=$7,updated_by=coalesce((select id from public.profiles where id=$6),updated_by) where id=$1`,
            [id,path,bytes.length,payload.status===2 ? 1 : 0,payload.status===2 ? 0 : Math.max(Number(doc.last_force_save_at),forceTime || 0),userId,fieldCount]);
        } catch(error) {await store.remove([path]); throw error;}
      });
      send(res,200,{error:0});
    } catch(error) {
      await query('update public.office_documents set last_save_error=$2 where id=$1',[id,'Не удалось сохранить DOCX. Повторите сохранение в редакторе.']).catch(()=>{});
      throw error;
    }
  }
  function send(res,status,body,headers={}) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers});
    res.end(Buffer.isBuffer(body) || typeof body==='string' ? body : JSON.stringify(body));
  }
  async function command(s,payload) {
    const secret=decrypt(s.jwt_secret_encrypted,key);
    const token=sign(payload,secret);
    return JSON.parse(await fetchLimited(`${s.internal_url || s.public_url}/command`,{
      method:'POST',headers:{'Content-Type':'application/json',[s.jwt_header]:s.jwt_prefix+sign({payload},secret)},body:JSON.stringify({...payload,token}),
    }));
  }
  async function connectionTest(s) {
    const checks=[];
    const check=async(label,fn)=>{try{const detail=await fn();checks.push({label,ok:true,detail:detail || ''});}catch(e){checks.push({label,ok:false,detail:e instanceof HttpError ? e.message : 'Нет соединения; проверьте адрес, TLS и сетевой доступ'});}};
    await check('Survey-app → ONLYOFFICE',async()=>{requireValue((await fetchLimited(`${s.internal_url || s.public_url}/healthcheck`)).toString().trim()==='true','Document Server не готов');});
    await check('API редактора',async()=>{await fetchLimited(`${s.public_url}/web-apps/apps/api/documents/api.js`,{},4*1024*1024);});
    await check('JWT принят',async()=>{const r=await command(s,{c:'version'});requireValue(!r.error && r.version,'Document Server отклонил JWT',502);return r.version;});
    await check('Конфигурация плагина',async()=>{const c=JSON.parse(await fetchLimited(`${appUrl}/api/office/plugin/config.json`));requireValue(c.guid===PLUGIN_GUID,'Не совпадает плагин');});
    await check('ONLYOFFICE → Survey-app: загрузка DOCX',async()=>{
      const token=issue('probe',{},180),secret=decrypt(s.jwt_secret_encrypted,key);
      const payload={async:false,filetype:'docx',outputtype:'pdf',key:`survey_probe_${randomUUID().replaceAll('-','')}`,url:`${s.storage_url_override || appUrl}/api/office/probe?token=${token}`};
      const result=JSON.parse(await fetchLimited(`${s.internal_url || s.public_url}/converter`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',[s.jwt_header]:s.jwt_prefix+sign({payload},secret)},body:JSON.stringify({...payload,token:sign(payload,secret)})}));
      requireValue(result.endConvert===true && !result.error,'ONLYOFFICE не смог загрузить пробный DOCX. Проверьте адрес приложения и доверие TLS.',502);
    });
    checks.push({label:'Callback сохранения',ok:null,detail:'Проверяется фактическим сохранением DOCX; конвертация проверяет обратный доступ, но не заменяет callback.'});
    return checks;
  }
  const staticRoot=new URL('../public/',import.meta.url);
  async function handle(req,res) {
    const url=new URL(req.url,'http://office.local'),path=url.pathname.replace(/^\/api\/office/,'');
    const origin=req.headers.origin;
    requireValue(!origin || origin===new URL(appUrl).origin || (path.startsWith('/plugin/') && req.method==='GET'),'Недопустимый origin',403);
    if(req.method==='OPTIONS') return send(res,204,'');
    if(path==='/health') {await query('select 1'); return send(res,200,{ok:true});}
    const s=await settings();
    requireValue(s,'Office API не настроен',503);
    const dsOrigin=s.public_url ? new URL(s.public_url).origin : "'none'";
    if(path==='/editor-frame' && req.method==='GET') {
      const csp=`default-src 'none'; script-src 'self' ${dsOrigin}; style-src 'self' 'unsafe-inline'; frame-src ${dsOrigin}; connect-src 'self' ${dsOrigin}; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`;
      return send(res,200,await readFile(new URL('editor.html',staticRoot)),{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp});
    }
    if(path==='/editor-bridge.js' && req.method==='GET') return send(res,200,await readFile(new URL('editor-bridge.js',staticRoot)),{'Content-Type':'text/javascript'});
    if(path.startsWith('/plugin/') && req.method==='GET') {
      const name=path.slice('/plugin/'.length);
      const mime={'config.json':'application/json','index.html':'text/html; charset=utf-8','plugin.js':'text/javascript','plugin.css':'text/css','plugins.js':'text/javascript','icon.svg':'image/svg+xml'}[name];
      requireValue(mime,'Файл не найден',404);
      const source=await readFile(new URL(`plugin/${name}`,staticRoot));
      const content=name==='plugins.js' ? `const SURVEY_DOCUMENT_SERVER_ORIGIN=${JSON.stringify(s.public_url ? new URL(s.public_url).origin : null)};\n${source}` : source;
      return send(res,200,content,{'Content-Type':mime,'Access-Control-Allow-Origin':'*',
        'Content-Security-Policy':`default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self' ${dsOrigin}; base-uri 'none'; form-action 'none'`});
    }
    if(path==='/probe' && req.method==='GET') {capability(url.searchParams.get('token') || '','probe');return send(res,200,blankDocx(),{'Content-Type':DOCX_MIME});}
    if(path.startsWith('/file/') && req.method==='GET') {
      const claims=capability(url.searchParams.get('token') || '','file');
      requireValue(claims.documentId===path.slice(6),'Токен другого документа',403);
      const doc=(await query('select * from public.office_documents where id=$1',[claims.documentId]))[0];
      requireValue(doc,'Документ удалён',404);
      // Deliver the immutable session-start object even after a force save.
      return send(res,200,await download(claims.storagePath),{'Content-Type':mimeFor(doc.file_type)});
    }
    if(path.startsWith('/callback/') && req.method==='POST') {
      const body=JSON.parse(await readLimited(req,1024*1024));
      return callback(req,res,path.slice(10),s,body);
    }
    const auth=await authenticate(req);
    if(path==='/status' && req.method==='GET') {employeeOnly(auth);return send(res,200,{enabled:Boolean(s.enabled)});}
    let body={};
    const contentType=req.headers['content-type']?.split(';')[0];
    if(['POST','PATCH','PUT'].includes(req.method) && contentType==='application/json') {
      const bytes=await readLimited(req,128*1024);
      try {body=bytes.length ? JSON.parse(bytes) : {};} catch {throw new HttpError(400,'Некорректный JSON');}
    }
    if(path==='/settings') {
      adminOnly(auth);
      if(req.method==='GET') return send(res,200,publicSettings(s));
      requireValue(req.method==='PUT','Метод не поддерживается',405);
      const public_url=baseUrl(body.public_url,!body.enabled),internal_url=baseUrl(body.internal_url,true),override=baseUrl(body.storage_url_override,true);
      requireValue(typeof body.enabled==='boolean','Неверный переключатель');
      requireValue(typeof body.jwt_header==='string' && /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(body.jwt_header),'Некорректный JWT Header');
      requireValue(typeof body.jwt_prefix==='string' && /^[\x20-\x7e]{0,32}$/.test(body.jwt_prefix),'Некорректный JWT Prefix');
      requireValue(Number.isInteger(body.max_file_mb) && body.max_file_mb>=1 && body.max_file_mb<=100,'Размер файла: от 1 до 100 МБ');
      requireValue(Number.isInteger(body.max_table_rows) && body.max_table_rows>=1 && body.max_table_rows<=5000,'Строк в таблице: от 1 до 5000');
      const secret=body.jwt_secret ? encrypt(String(body.jwt_secret),key) : s.jwt_secret_encrypted;
      requireValue(!body.enabled || secret,'Укажите JWT Secret');
      const saved=(await query(`update public.onlyoffice_settings set enabled=$1,public_url=$2,internal_url=$3,storage_url_override=$4,jwt_header=$5,jwt_prefix=$6,
        max_file_mb=$7,max_table_rows=$8,jwt_secret_encrypted=$9,updated_by=$10,updated_at=now() where id=1 returning *`,[body.enabled,public_url,internal_url,override,body.jwt_header,body.jwt_prefix,body.max_file_mb,body.max_table_rows,secret,auth.profile.id]))[0];
      return send(res,200,publicSettings(saved));
    }
    if(path==='/settings/test' && req.method==='POST') {adminOnly(auth);return send(res,200,{checks:await connectionTest(s)});}
    const formMatch=path.match(/^\/forms\/([^/]+)\/(documents|sources|results)$/);
    if(formMatch) {
      const form=await formFor(formMatch[1],auth);
      if(formMatch[2]==='sources' && req.method==='GET') {
        return send(res,200,{fields:systemFields,questions:templateSources(form.schema).map(({definition,...q})=>q)});
      }
      employeeOnly(auth);
      if(formMatch[2]==='results' && req.method==='GET') {
        const results=await query('select r.id,r.form_id,r.template_id,r.name,r.file_type,r.files,r.size_bytes,r.created_by,r.created_at,p.name as author_name from public.office_generation_results r left join public.profiles p on p.id=r.created_by where r.form_id=$1 order by r.created_at desc limit 100',[form.id]);
        const jobs=await query("select id,form_id,name,state,error,created_at from public.office_generation_jobs where form_id=$1 and (state in ('queued','running') or (state='failed' and created_at>now()-interval '1 day')) order by created_at desc limit 100",[form.id]);
        return send(res,200,{results,jobs});
      }
      requireValue(formMatch[2]==='documents','Метод не поддерживается',405);
      if(req.method==='GET') {
        const documents=await query(`select d.*,p.name as author_name,d.template_field_count as binding_count
          from public.office_documents d left join public.profiles p on p.id=d.created_by where form_id=$1 order by updated_at desc`,[form.id]);
        const count=(await query('select count(*)::int as count from public.responses where form_id=$1',[form.id]))[0].count;
        return send(res,200,{documents,enabled:s.enabled,max_file_mb:s.max_file_mb,response_count:count});
      }
      if(req.method==='POST') {
        let bytes,name,format;
        if(contentType==='application/json') {format=body.file_type || 'xlsx';requireValue(['docx','xlsx'].includes(format),'Выберите DOCX или XLSX');bytes=format==='xlsx'?blankXlsx():blankDocx();name=documentName(body.name,format);}
        else {
          requireValue([DOCX_MIME,XLSX_MIME,'application/octet-stream','application/zip'].includes(contentType),'Недопустимый MIME type');
          const supplied=url.searchParams.get('name'); requireValue(/\.(docx|xlsx)$/i.test(supplied || ''),'Выберите DOCX или XLSX');format=supplied.split('.').pop().toLowerCase();
          name=documentName(supplied,format);bytes=await readLimited(req,s.max_file_mb*1024*1024);
        }
        return send(res,201,await createDocument(form,auth,name,bytes,format));
      }
    }
    const resultMatch=path.match(/^\/results\/([^/]+)(?:\/(download|files\/(\d+)))?$/);
    if(resultMatch) {
      employeeOnly(auth);requireValue(uuid(resultMatch[1]),'Неверный ID результата');
      const result=(await query('select * from public.office_generation_results where id=$1',[resultMatch[1]]))[0];requireValue(result,'Результат удалён',404);
      if(!resultMatch[2] && req.method==='DELETE') {
        requireValue(result.created_by===auth.profile.id || auth.profile.role==='admin','Удалить результат может его создатель или администратор',403);
        await query('delete from public.office_generation_results where id=$1',[result.id]);return send(res,200,{ok:true});
      }
      requireValue(req.method==='GET' && resultMatch[2],'Метод не поддерживается',405);
      const archive=await download(result.storage_path);
      let bytes=archive,name=result.name,contentType='application/zip';
      if(resultMatch[3]!==undefined){const index=Number(resultMatch[3]);requireValue(Number.isSafeInteger(index)&&index>=0&&index<result.files.length,'Файл не найден',404);name=result.files[index];bytes=Buffer.from((await runOfficeTask({task:'extract',bytes:archive,filename:name})).bytes);contentType=mimeFor(result.file_type);}
      return send(res,200,bytes,{'Content-Type':contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`});
    }
    const match=path.match(/^\/documents\/([^/]+)(?:\/(.*))?$/);
    if(match) {
      const doc=await documentFor(match[1],auth), action=match[2] || '';
      if(!action && req.method==='GET') {employeeOnly(auth);return send(res,200,doc);}
      if(!action && req.method==='PATCH') {
        employeeOnly(auth); const saved=(await query('update public.office_documents set name=$2,updated_at=now(),updated_by=$3 where id=$1 returning *',[doc.id,documentName(body.name,doc.file_type || 'docx'),auth.profile.id]))[0];return send(res,200,saved);
      }
      if(!action && req.method==='DELETE') {
        employeeOnly(auth);requireValue(doc.created_by===auth.profile.id || auth.profile.role==='admin','Удалить документ может его создатель или администратор',403);
        await query('delete from public.office_documents where id=$1',[doc.id]);return send(res,200,{ok:true});
      }
      if(action==='download' && req.method==='GET') {employeeOnly(auth);return send(res,200,await download(doc.storage_path),{'Content-Type':mimeFor(doc.file_type),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`});}
      if(action==='copy' && req.method==='POST') {
        employeeOnly(auth);const form=await formFor(doc.form_id,auth);
        return send(res,201,await createDocument(form,auth,documentName(doc.name.replace(/\.(docx|xlsx)$/i,'')+' (копия)',doc.file_type),await download(doc.storage_path),doc.file_type));
      }
      if(action==='editor-config' && req.method==='GET') {
        employeeOnly(auth);requireValue(s.enabled && s.jwt_secret_encrypted && s.public_url,'Редактор ONLYOFFICE отключён. Документ можно скачать.',503);
        const result=await transaction(async db=>{
          const current=await documentFor(doc.id,auth,db,true);
          const callbackBase=s.storage_url_override || appUrl;
          const config={documentType:doc.file_type==='xlsx' ? 'cell' : 'word',type:'desktop',width:'100%',height:'100%',document:{fileType:doc.file_type || 'docx',key:documentKey(current),title:current.name,
            url:`${callbackBase}/api/office/file/${doc.id}?token=${issue('file',{documentId:doc.id,storagePath:current.storage_path},3600)}`,
            permissions:{edit:true,download:true,print:true,review:true,comment:true}},editorConfig:{lang:'ru',mode:'edit',callbackUrl:`${callbackBase}/api/office/callback/${doc.id}`,
            user:{id:auth.profile.id,name:auth.profile.name || 'Сотрудник'},customization:{forcesave:true,autosave:true},
            plugins:{pluginsData:[`${appUrl}/api/office/plugin/config.json`],autostart:[PLUGIN_GUID],options:{[PLUGIN_GUID]:{
              formId:doc.form_id,documentId:doc.id,fileType:doc.file_type || 'docx',apiBaseUrl:`${appUrl}/api/office`,token:issue('plugin',{formId:doc.form_id,documentId:doc.id,sub:auth.profile.id,sessionEnd:now()+8*3600}),
            }}}}};
          await db.query('update public.office_documents set last_opened_at=now() where id=$1',[doc.id]);
          return {config:{...config,token:sign(config,decrypt(s.jwt_secret_encrypted,key))},apiJsUrl:`${s.public_url}/web-apps/apps/api/documents/api.js`,name:doc.name};
        });
        return send(res,200,result);
      }
      if(action==='save' && req.method==='POST') {
        employeeOnly(auth);
        requireValue(s.enabled && s.jwt_secret_encrypted,'Редактор отключён',503);
        const result=await command(s,{c:'forcesave',key:documentKey(doc)});
        if(result.error===4) return send(res,200,{saved:true,unchanged:true});
        requireValue(result.error===0,'Не удалось запросить сохранение. Не закрывайте редактор.',502);
        // A command acknowledgement is not a successful Storage write. Wait for
        // the signed status-6 callback to commit a new immutable object pointer.
        for(let i=0;i<30;i++) {
          await new Promise(resolve=>setTimeout(resolve,1000));
          const current=(await query('select * from public.office_documents where id=$1',[doc.id]))[0];
          requireValue(current && !current.last_save_error,'Сохранение не завершено. Не закрывайте редактор.',502);
          if(current.storage_path!==doc.storage_path) return send(res,200,{saved:true});
        }
        throw new HttpError(504,'Сохранение ещё не подтверждено. Подождите и попробуйте снова.');
      }
      if(action==='refresh-token' && req.method==='POST') {
        requireValue(auth.claims && auth.claims.sessionEnd>now(),'Сессия плагина истекла. Откройте документ снова.',401);
        return send(res,200,{token:issue('plugin',{formId:doc.form_id,documentId:doc.id,sub:auth.profile.id,sessionEnd:auth.claims.sessionEnd},Math.min(900,auth.claims.sessionEnd-now()))});
      }
      if(action==='check-template' && req.method==='GET') {
        const form=await formFor(doc.form_id,auth);
        const {fields}=await runOfficeTask({task:'inspect',bytes:await download(doc.storage_path),format:doc.file_type,form});
        return send(res,200,{fields});
      }
      if(action==='generate' && req.method==='POST') {
        employeeOnly(auth);
        requireValue(!doc.last_save_error,'У макета есть ошибка сохранения. Откройте его и сохраните ещё раз.',409);
        const ids=body.response_ids;
        requireValue(ids===undefined || (Array.isArray(ids) && ids.length>0 && ids.length<=500 && ids.every(uuid) && new Set(ids).size===ids.length),'Выберите от 1 до 500 ответов');
        requireValue(body.name_question_id===undefined || (typeof body.name_question_id==='string' && body.name_question_id.length<=200),'Некорректное поле имени файла');
        const job=await enqueueGeneration(pool,doc.id,auth.profile.id,ids,body.name_question_id);
        return send(res,202,job);
      }
    }
    throw new HttpError(404,'Метод Office API не найден');
  }
  return async(req,res)=>{
    try {await handle(req,res);}
    catch(error) {
      const id=randomUUID();
      // Do not log request bodies, URLs, tokens or Document Server download URLs.
      console.error(JSON.stringify({event:'office-request-error',requestId:id,status:error.status || 500,code:error.code || error.name}));
      if(!res.headersSent) send(res,error.status || 500,{error:1,message:error instanceof HttpError ? error.message : `Не удалось выполнить операцию (${id.slice(0,8)})`});
      else res.end();
    }
  };
}
