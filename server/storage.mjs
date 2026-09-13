import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,chmodSync,openSync,closeSync,unlinkSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {newProfile,demoProfile,profileSchema,dayKey} from './domain.mjs';
export const dataDir=resolve(process.env.READING_DATA_DIR||'./data');
mkdirSync(dataDir,{recursive:true,mode:0o700});
export function writeJson(file,value){const tmp=file+'.'+randomBytes(5).toString('hex')+'.tmp';writeFileSync(tmp,JSON.stringify(value),{mode:0o600});renameSync(tmp,file);chmodSync(file,0o600);}
const managed=process.env.READING_AUTH_MODE==='workbuddy';
let saved=null;if(!managed)try{saved=JSON.parse(readFileSync(join(dataDir,'connection.json'),'utf8'));}catch{}
let key=managed?(process.env.WEREAD_API_KEY||''):(saved?.disabled?'':saved?.key||process.env.WEREAD_API_KEY||'');
export const getKey=()=>key;
export function setKey(value,persist=false){if(managed)throw Error('请在 WorkBuddy 连接器中管理授权。');key=value;if(persist)writeJson(join(dataDir,'connection.json'),{key:value});}
export function disconnect(){if(managed)throw Error('请在 WorkBuddy 连接器中断开授权。');key='';writeJson(join(dataDir,'connection.json'),{key:'',disabled:true});}
export const accountId=()=>key?createHash('sha256').update(key).digest('hex').slice(0,20):'unconnected';
function filename(mode){return join(dataDir,mode==='demo'?'demo.json':`profile-${accountId()}.json`);}
function locked(path,fn){const lock=path+'.lock',deadline=Date.now()+2500;let fd;
 while(fd===undefined){try{fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid}));}catch(e){if(e.code!=='EEXIST')throw e;
  try{const owner=JSON.parse(readFileSync(lock,'utf8'));try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH'){unlinkSync(lock);continue;}}}catch{}
  if(Date.now()>deadline)throw Error('阅读数据正在保存，请稍后重试。');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
 }}
 try{return fn();}finally{closeSync(fd);unlinkSync(lock);}
}
function load(path,mode){let p;if(existsSync(path))p=profileSchema.parse(JSON.parse(readFileSync(path,'utf8')));else{p=mode==='demo'?demoProfile():newProfile();writeJson(path,p);}
 if(mode==='demo'&&p.snapshot?.weekly?.end!==dayKey(new Date(),p.settings.timeZone)){p.snapshot=demoProfile(p.settings.timeZone).snapshot;writeJson(path,p);}return p;
}
export function readProfile(mode='live'){const path=filename(mode);return locked(path,()=>load(path,mode));}
export function saveProfile(mode,profile){const path=filename(mode);return locked(path,()=>{const p=profileSchema.parse(profile);writeJson(path,p);return p;});}
export function updateProfile(mode,fn){const path=filename(mode);return locked(path,()=>{const p=load(path,mode);fn(p);const parsed=profileSchema.parse(p);writeJson(path,parsed);return parsed;});}
