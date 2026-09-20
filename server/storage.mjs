import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,chmodSync,openSync,closeSync,unlinkSync,statSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {newProfile,demoProfile,profileSchema,dayKey} from './domain.mjs';
const managed=process.env.READING_AUTH_MODE==='workbuddy';
const skillMode=process.env.READING_AUTH_MODE==='skill';
function platformBase(kind){if(process.platform==='win32')return kind==='data'?(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local')):(process.env.APPDATA||join(homedir(),'AppData','Roaming'));if(process.platform==='darwin')return join(homedir(),'Library','Application Support');return kind==='data'?(process.env.XDG_DATA_HOME||join(homedir(),'.local','share')):(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'));}
// Skill 模式默认使用用户级平台数据目录，避免随工作目录散落；测试用 READING_DATA_DIR / READING_CONFIG_DIR 覆盖。
const dataDirDefault=skillMode?join(platformBase('data'),'ReadingBuddy'):'./data';
export const dataDir=resolve(process.env.READING_DATA_DIR||dataDirDefault);
mkdirSync(dataDir,{recursive:true,mode:0o700});
export function writePrivate(file,text){const tmp=file+'.'+randomBytes(5).toString('hex')+'.tmp';writeFileSync(tmp,text,{mode:0o600});renameSync(tmp,file);chmodSync(file,0o600);return file;}
export function writeJson(file,value){writePrivate(file,JSON.stringify(value));}
const keyPattern=/^wrk-[A-Za-z0-9_-]{8,}$/;
export const configDir=resolve(process.env.READING_CONFIG_DIR||join(platformBase('config'),'ReadingBuddy'));
export const credentialPath=()=>join(configDir,'credentials.json');
function storedKey(){try{const raw=JSON.parse(readFileSync(credentialPath(),'utf8'));return typeof raw.key==='string'&&keyPattern.test(raw.key)?raw.key:'';}catch{return '';}}
let saved=null;if(!managed&&!skillMode)try{saved=JSON.parse(readFileSync(join(dataDir,'connection.json'),'utf8'));}catch{}
let key=managed?(process.env.WEREAD_API_KEY||''):(skillMode?'':(saved?.disabled?'':saved?.key||process.env.WEREAD_API_KEY||''));
// Skill 模式：优先环境变量，其次本机私有凭证文件（0600，绝不随备份/报告导出）。
export const getKey=()=>skillMode?(process.env.WEREAD_API_KEY||storedKey()):key;
export function setKey(value,persist=false){if(skillMode)throw Error('Skill 模式请使用「auth import」管理授权。');if(managed)throw Error('请在 WorkBuddy 连接器中管理授权。');key=value;if(persist)writeJson(join(dataDir,'connection.json'),{key:value});}
export function disconnect(){if(skillMode)throw Error('Skill 模式请使用「auth revoke」断开授权。');if(managed)throw Error('请在 WorkBuddy 连接器中断开授权。');key='';writeJson(join(dataDir,'connection.json'),{key:'',disabled:true});}
export function importCredential(file){const raw=readFileSync(file,'utf8').trim();if(!keyPattern.test(raw))throw Object.assign(new Error('凭证格式不正确：应为 wrk- 开头的微信读书 API Key。'),{status:400});mkdirSync(configDir,{recursive:true,mode:0o700});writeJson(credentialPath(),{key:raw,importedAt:new Date().toISOString()});chmodSync(credentialPath(),0o600);}
export function revokeCredential(){try{unlinkSync(credentialPath());}catch(e){if(e.code!=='ENOENT')throw e;}}
// 凭证文件存在但无法解析/格式不对时给出明确提示（绝不回显内容）；文件正常或不存在时返回 null。
export function credentialProblem(){if(!existsSync(credentialPath()))return null;let parsed;try{parsed=JSON.parse(readFileSync(credentialPath(),'utf8'));}catch{return '本机凭证文件无法读取或已损坏（内容不会显示）；请重新执行 auth import <文件> 导入凭证。';}
  return typeof parsed?.key==='string'&&keyPattern.test(parsed.key)?null:'本机凭证文件格式不正确（内容不会显示）；请重新执行 auth import <文件> 导入凭证。';}
const fingerprint=key=>createHash('sha256').update(key).digest('hex').slice(0,20);
// getKey 只读取一次，避免两次读取之间凭证被更换导致不一致。
export function credentialInfo(){const key=getKey();const fromEnv=!!process.env.WEREAD_API_KEY;const storeExists=existsSync(credentialPath());return {configured:!!key,source:fromEnv?'环境变量 WEREAD_API_KEY':storeExists?'本机凭证文件':'未配置',storePath:credentialPath(),storeExists,storeProblem:credentialProblem(),account:key?fingerprint(key):null};}
export const accountId=()=>{const key=getKey();return key?fingerprint(key):'unconnected';};
function filename(mode){return join(dataDir,mode==='demo'?'demo.json':`profile-${accountId()}.json`);}
export const profileFile=mode=>filename(mode);
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
