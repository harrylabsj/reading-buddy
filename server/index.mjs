import {action,getState} from './service.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { dataDir, writeJson, readProfile, updateProfile, getKey, setKey, disconnect } from './storage.mjs';
import { settingsSchema, cardSchema, validateBackup, mergeBackup, dayKey, periodRange, cardDraft, duration } from './domain.mjs';
import { gatewayCall, syncAll, syncStatus, refreshBook, fetchBookNotes } from './weread.mjs';

const port = Number(process.env.PORT || 3788), token = randomBytes(32).toString('hex');
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const origins = new Set([...hosts].map(h=>'http://'+h));
const devPort=process.env.READING_DEV_PORT;if(devPort){origins.add('http://localhost:'+devPort);origins.add('http://127.0.0.1:'+devPort);hosts.add('localhost:'+devPort);hosts.add('127.0.0.1:'+devPort);}
const mime = { '.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon' };
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function tokenValid(value) { const a=Buffer.from(String(value||'')),b=Buffer.from(token);return a.length===b.length&&timingSafeEqual(a,b); }
async function body(req) { let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>25*1024*1024)throw fail('文件过大，请使用小于25MB的备份。',413);}try{return JSON.parse(text||'{}');}catch{throw fail('内容不是有效 JSON。');} }
function state(mode) {return {...getState(mode),csrf:token};}
const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');
  const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  try{
    if(!hosts.has(req.headers.host))throw fail('不允许的访问地址。',403);
    if(req.headers.origin&&!origins.has(req.headers.origin))throw fail('不允许的页面来源。',403);
    const url=new URL(req.url,'http://localhost:'+port), path=url.pathname,mode=url.searchParams.get('mode')==='demo'?'demo':'live';
    if(path==='/api/state'&&req.method==='GET')return send(state(mode));
    if(path==='/api/health')return send({ok:true,name:'读书搭子',version:'0.2.0'});
    if(path==='/api/card-file'&&req.method==='GET'){
      const card=readProfile(mode).cards.find(c=>c.id===url.searchParams.get('id'));
      if(!card)throw fail('卡片不存在。',404);
      res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="reading-card.md"; filename*=UTF-8''${encodeURIComponent(card.title+'.md')}`});
      return res.end(card.body);
    }
    if(path==='/api/export'&&req.method==='GET'){
      res.setHeader('Content-Disposition',`attachment; filename="reading-buddy-${mode}-${dayKey()}.json"`);return send(readProfile(mode));
    }
    if(path.startsWith('/api/')&&req.method!=='GET'){
      if(!tokenValid(req.headers['x-reading-token']))throw fail('页面已过期，请刷新后重试。',403);
      const input=await body(req);
      return send(await action(path,mode,input));
    }
    if(path.startsWith('/api/'))throw fail('没有这个接口。',404);
    if(req.method!=='GET')throw fail('不支持的请求。',405);
    const root=resolve('dist/client');let file=resolve(root,'.'+decodeURIComponent(path));
    if(!file.startsWith(root+'/'))file=join(root,'index.html');
    if(!existsSync(file)||!statSync(file).isFile())file=join(root,'index.html');
    if(!existsSync(file))throw fail('请先构建前端或使用开发预览。',503);
    res.setHeader('Content-Type',mime[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
  }catch(e){send({error:e instanceof z.ZodError?'数据格式不正确，请检查输入或备份文件。':e.message||'操作未完成。'},e.status||400);}
});
server.listen(port,'127.0.0.1',()=>{
  writeJson(join(dataDir,'runtime.json'),{url:`http://127.0.0.1:${port}`,token,pid:process.pid});
  console.log(`读书搭子已启动：http://localhost:${port}`);
  if(getKey()&&!readProfile().snapshot)void syncAll();
});
