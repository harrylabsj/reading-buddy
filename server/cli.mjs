#!/usr/bin/env node
// 读书搭子 · 免连接器 Skill 命令行入口。直接调用本进程内的领域/存储/服务逻辑，不启动 HTTP 服务。
//
// 关键启动顺序：必须先初始化 Skill 模式（决定数据目录、凭证解析顺序与授权管理方式），
// 再导入 storage/service 等模块；静态 import 会被提升，因此这里用动态 import 保证顺序，
// 无论是否设置 READING_AUTH_MODE、无论从哪个工作目录运行（源码或打包脚本）。
process.env.READING_AUTH_MODE='skill';

import {fileURLToPath} from 'node:url';
import {realpathSync,existsSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {mkdirSync,readFileSync} from 'node:fs';
import {z} from 'zod';
import {spawn} from 'node:child_process';
import {noteCatalog,noteExcerpts} from './selection.mjs';

const storage=await import('./storage.mjs');
const service=await import('./service.mjs');
const weread=await import('./weread.mjs');
const reportMod=await import('./report.mjs');
const readersMod=await import('./readers.mjs');
const {readProfile,getKey,accountId,credentialPath,importCredential,revokeCredential,credentialInfo,credentialProblem,writePrivate,profileFile,dataDir,profileHistory,historicalProfile,hasProfileHistory,managedDataPaths,retryDeadline}=storage;
const {getState,action}=service;
const {syncAll,syncStatus,fetchBookNotes,refreshBook}=weread;
const {buildReport}=reportMod;

const VERSION='0.6.0-skill';
const USAGE=`读书搭子 Skill 命令（stdout 始终输出 JSON；错误以 JSON 写入 stderr）
用法: reading-buddy <命令> [选项] [--mode live|demo]

命令:
  status                                连接、凭证与本地数据状态（无需网络）
  doctor                                本机环境、授权配置、快照与恢复提示（离线）
  sync [--scope basic|full] [--if-stale]  默认只同步书架、统计与笔记目录
  book <bookId> [--refresh]              按需补齐指定书的详情与进度
  books [--query t] [--status all|reading|finished] [--offset n] [--limit n]
                                        分页搜索已同步电子书（无需网络）
  notes <bookId> [--refresh] [--offset n] [--limit n]
                                        查看某本书的已载入笔记；refresh 需联网更新
  find-book <书名>                       联网搜索公开书籍，返回可选择的书籍 ID
  highlights <bookId>                    查看可定位的热门划线（联网）
  readers <bookId> [--question t] [--chapter-uid n --range a-b] [--refresh]
                                        发现公开想法作者；默认复用 15 分钟缓存
  readers-list [--session id] [--view popular|resonance|perspective] [--offset n]
                                        本地发现与最多 20 条候选摘录（离线）
  readers-curate --input <json文件>      保存有原文依据的 AI 推荐理由（仅本机）
  settings [set --goal n --timezone tz --primary-book id|null]
                                        查看或修改每日目标、时区、主读书
  reflect --note-id <id> --text <t>|--text-file <文件>|--input <json文件>
                                        保存一条笔记的个人回顾
  draft --notes <id,id> [--reflection t|--reflection-file <文件>]
                                        由选定笔记生成本机读书卡片草稿
  review --period weekly|monthly [--note-ids id,id]
                                        默认仅统计和目录；指定 ID 才读取所选正文
  save-card --title t --body b|--body-file <文件> [--kind card|weekly|monthly] [--note-ids id,id] [--id 既有卡片]
                                        保存已确认的卡片或复盘（仅本机）
  backup export|import <路径>           导出/校验并合并导入备份（0600 私有权限）
  report <输出.html> [--open]           从本机快照生成并可打开只读 HTML 阅读报告
  workspace [输出.html] [--sync] [--force] [--open]
                                        状态检查、可选基础同步、生成与打开
  auth status|import <文件>|revoke      本机凭证状态 / 从文件安全导入 / 移除
  auth history                          历史空间目录（不含笔记正文）
  auth export-history <账户标识> <文件> 导出指定历史备份；确认归属后再 backup import

长文本（含引号、反引号、美元符）请用 --body-file / --reflection-file / --text-file
从本机文件读取，或用 --input <json文件> 提供结构化字段，避免 shell 转义。

退出码: 0 成功 · 2 参数或数据校验 · 3 缺少或失效授权 · 4 记录不存在 · 5 请求过于频繁 · 1 其他错误
凭证绝不作为命令参数，也绝不写入输出、备份或报告。`;

// 每个命令各自允许的选项与位置参数个数；列表之外一律视为参数错误，而不是静默忽略。
// 选项取值只允许这些值；错误消息不得回显用户输入的内容（可能是凭证形态）。
const SPECS={
  status:{flags:['mode'],pos:[0,0]},
  doctor:{flags:['mode'],pos:[0,0]},
  sync:{flags:['mode','scope','if-stale'],pos:[0,0]},
  book:{flags:['mode','refresh'],pos:[1,1]},
  books:{flags:['mode','query','status','offset','limit'],pos:[0,0]},
  notes:{flags:['mode','refresh','restart','list','note-ids','offset','limit'],pos:[1,1]},
  'find-book':{flags:['mode'],pos:[1,1]},
  highlights:{flags:['mode'],pos:[1,1]},
  readers:{flags:['mode','question','chapter-uid','range','refresh'],pos:[1,1]},
  'readers-list':{flags:['mode','session','view','offset'],pos:[0,0]},
  'readers-curate':{flags:['mode','input'],pos:[0,0]},
  settings:{flags:['mode','goal','timezone','primary-book'],pos:[0,1]},
  reflect:{flags:['mode','note-id','text','text-file','input'],pos:[0,0]},
  draft:{flags:['mode','notes','reflection','reflection-file'],pos:[0,0]},
  review:{flags:['mode','period','note-ids'],pos:[0,0]},
  'save-card':{flags:['mode','title','body','body-file','kind','note-ids','id','input','origin'],pos:[0,0]},
  backup:{flags:['mode'],pos:[2,2]},
  report:{flags:['mode','open'],pos:[1,1]},
  workspace:{flags:['mode','sync','force','open'],pos:[0,1]},
  auth:{flags:['mode'],pos:[1,3]},
};
const BOOLEAN_FLAGS=new Set(['help','refresh','restart','list','if-stale','open','sync','force']);

function parseArgs(argv){
  const args={_:[]};
  for(let i=0;i<argv.length;i++){const a=argv[i];
    if(a==='--help'||a==='-h'){if(args.help)throw badArgs('存在重复提供的选项。');args.help=true;}
    else if(a.startsWith('--')){const k=a.slice(2),eq=k.indexOf('=');
      if((eq>=0?k.slice(0,eq):k) in args)throw badArgs('存在重复提供的选项。');
      if(eq>=0)args[k.slice(0,eq)]=k.slice(eq+1);
      else if(argv[i+1]!==undefined&&!argv[i+1].startsWith('--')){args[k]=argv[i+1];i++;}
      else args[k]=true;}
    else args._.push(a);}
  return args;
}
const list=value=>String(value||'').split(',').map(s=>s.trim()).filter(Boolean);
const isTrue=v=>v===true||v==='true';
const badArgs=message=>Object.assign(new Error(message),{status:400});
// 校验整数值参数：必须是纯数字且在范围内，拒绝 NaN/小数/越界，而不是静默回退。
function intArg(value,name,min,max){if(value===undefined||value===true)return null;const text=String(value).trim();
  if(!/^-?\d+$/.test(text))throw badArgs(`--${name} 必须是 ${min} 到 ${max} 之间的整数。`);
  const n=Number(text);if(n<min||n>max)throw badArgs(`--${name} 必须在 ${min} 到 ${max} 之间。`);return n;}
function readTextFileArg(value,flag){if(value===undefined||value===true)throw badArgs(`${flag} 需要一个本机文件路径。`);
  let text;try{text=readFileSync(resolve(String(value)),'utf8');}catch(e){throw badArgs(`${flag} 指定的本机文件无法读取，请检查路径与权限。`);}
  return text;}
function readJsonInputArg(value){if(value===true||value===undefined)return {};let parsed;
  try{parsed=JSON.parse(readFileSync(resolve(String(value)),'utf8'));}catch(e){throw badArgs('--input 文件必须是有效的 JSON。');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw badArgs('--input 文件必须是 JSON 对象。');return parsed;}
// 规范化路径：对已存在的祖先目录做 realpath（处理 macOS /var → /private/var 与符号链接），
// 再拼回不存在的尾部，确保同一文件的不同拼写被识别为同一路径。
function canonicalPath(p){const resolved=resolve(p);let probe=resolved;const tail=[];
  while(!existsSync(probe)){const parent=dirname(probe);if(parent===probe)break;tail.unshift(basename(probe));probe=parent;}
  try{probe=realpathSync(probe);}catch{}
  return tail.length?join(probe,...tail):probe;}
// 报告/备份导出不得覆盖凭证文件或任一模式（live/demo）的受管数据文件。
function ensureSafeOutput(target){
  const t=canonicalPath(target);
  if(dirname(t)===canonicalPath(dataDir)&&/^(profile-|request-state-|before-import-)/.test(basename(t)))throw badArgs('输出路径与受保护的凭证或数据文件冲突，请换一个路径。');
  for(const protectedPath of managedDataPaths())
    if(t===canonicalPath(protectedPath))throw badArgs('输出路径与受保护的凭证或数据文件冲突，请换一个路径。');
  return resolve(target);}
function prepareOutput(target){mkdirSync(dirname(resolve(target)),{recursive:true,mode:0o700});return resolve(target);}
const exitFor=e=>e?.status===429?5:e?.status===401||e?.status===403?3:e?.status===404?4:e?.status===400||e instanceof z.ZodError?2:1;
async function openLocalReport(file){const command=process.platform==='darwin'?'open':process.platform==='win32'?'explorer.exe':'xdg-open';return new Promise(resolve=>{const child=spawn(command,[file],{stdio:'ignore',shell:false});child.once('error',()=>resolve(false));child.once('exit',code=>resolve(code===0));});}

export async function runCli(argv,io={}){
  const out=io.stdout||(text=>console.log(text));
  const failOut=(code,message,extra={})=>{(io.stderr||((text)=>console.error(text)))(JSON.stringify({ok:false,error:{code,message,...extra}}));return code;};
  try{
    const args=parseArgs(argv);
    const [cmd,...rest]=args._;
    if(args.help||cmd==='help'){out(USAGE);return 0;}
    if(!cmd)return failOut(2,USAGE);
    const spec=Object.hasOwn(SPECS,cmd)?SPECS[cmd]:null;
    if(!spec)return failOut(2,'未知命令。请用 --help 查看支持的命令。');
    // 所有校验都在任何副作用之前完成；消息不回显用户输入。
    for(const flag of Object.keys(args))if(flag!=='_'&&!spec.flags.includes(flag)&&flag!=='help')return failOut(2,'存在该命令不支持的选项。请用 --help 查看该命令的用法。');
    if(rest.length<spec.pos[0]||rest.length>spec.pos[1])return failOut(2,'参数个数不正确。请用 --help 查看该命令的用法。');
    for(const flag of spec.flags)if(args[flag]===true&&!BOOLEAN_FLAGS.has(flag))return failOut(2,'部分选项缺少取值。请用 --help 查看该命令的用法。');
    for(const flag of BOOLEAN_FLAGS)if(args[flag]!==undefined&&args[flag]!==true&&args[flag]!==false&&!['true','false'].includes(args[flag]))return failOut(2,`--${flag} 仅接受 true 或 false。`);
    if(args.mode!==undefined&&!['live','demo'].includes(args.mode))return failOut(2,'--mode 仅支持 live 或 demo。');
    const mode=args.mode==='demo'?'demo':'live';
    if(args.scope!==undefined&&!['basic','full'].includes(args.scope))return failOut(2,'--scope 仅支持 basic 或 full。');
    if(isTrue(args.restart)&&!isTrue(args.refresh))return failOut(2,'--restart 需要同时指定 --refresh。');
    if(isTrue(args.force)&&!isTrue(args.sync))return failOut(2,'--force 需要同时指定 --sync。');
    const send=value=>{out(JSON.stringify(value,null,2));return 0;};
    // 缺少凭证时给出可操作提示；凭证文件损坏时明确说明（不回显内容）。
    const authRequired=()=>{const problem=credentialProblem();return failOut(3,problem||'尚未配置微信读书凭证。',{hint:'先用 auth import <文件> 导入本机凭证，或设置 WEREAD_API_KEY 环境变量。'});};

    if(cmd==='doctor'){
      const p=readProfile(mode),configured=mode==='demo'?true:!!getKey();
      const state=mode==='demo'?'demo':p.snapshot?'ready':configured?'needs-sync':'needs-auth';
      return send({ok:true,version:VERSION,nodeVersion:process.versions.node,nodeCompatible:Number(process.versions.node.split('.')[0])>=20,mode,state,configured,authorizationVerified:false,snapshotAvailable:!!p.snapshot,syncedAt:p.snapshot?.syncedAt||null,historyAvailable:mode==='live'&&hasProfileHistory(),retryAt:mode==='live'&&retryDeadline()>Date.now()?new Date(retryDeadline()).toISOString():null,keyUrl:'https://weread.qq.com/r/weread-skills',hint:state==='needs-auth'?'获取 Key 后通过本机文件导入；也可运行 workspace --mode demo 先体验。':state==='needs-sync'?'如用户已要求同步，运行 sync --scope basic。':'优先使用本机数据；只有用户要求刷新时才联网。'});
    }
    if(cmd==='status'){
      const state=getState(mode);
      // 示例模式不得泄露个人授权状态或账户指纹。
      const auth=mode==='live'?credentialInfo():{configured:true,source:'示例模式',account:null};
      const connection=mode==='live'?state.connection:{connected:false,source:'示例数据（无需连接）',managedByWorkBuddy:false,managedBySkill:true};
      return send({ok:true,mode,today:state.today,auth,connection,
        sync:{running:state.sync.running,stage:state.sync.stage,error:state.sync.error},
        snapshot:state.snapshot?{syncedAt:state.snapshot.syncedAt,books:state.snapshot.books.length,notes:state.snapshot.notes.length,weekly:state.snapshot.weekly,monthly:state.snapshot.monthly,totals:state.snapshot.totals,warnings:state.snapshot.warnings}:null,
        settings:state.settings,counts:{cards:state.cards.length,reflections:state.reflections.length}});
    }
    if(cmd==='sync'){
      if(mode==='demo')return send({ok:true,demo:true,note:'示例模式使用独立虚构数据，无需同步。'});
      if(!getKey())return authRequired();
      await syncAll({scope:args.scope||'basic',force:!isTrue(args['if-stale'])});
      if(syncStatus.error){
        const st=syncStatus.errorStatus;
        const code=st===401||st===403?3:st===429?5:1;
        return failOut(code,syncStatus.error,{stage:syncStatus.stage,retryAt:syncStatus.retryAt,warnings:readProfile(mode).snapshot?.warnings||[],hint:st===401||st===403?'凭证可能已撤销或过期，可用 auth status 查看状态、auth import 重新导入。':undefined});
      }
      const p=readProfile(mode);
      return send({ok:true,stage:syncStatus.stage,scope:args.scope||'basic',cached:syncStatus.skipped,syncedAt:p.snapshot?.syncedAt||null,warnings:p.snapshot?.warnings||[],totals:p.snapshot?.totals||null});
    }
    if(cmd==='book'){
      if(mode==='live'){if(!getKey())return authRequired();await refreshBook(rest[0],{force:isTrue(args.refresh)});}
      const book=readProfile(mode).snapshot?.books.find(b=>b.id===rest[0]);if(!book)return failOut(4,'书籍不存在于当前书架。');
      return send({ok:true,book});
    }
    if(cmd==='books'){
      if(args.status!==undefined&&!['all','reading','finished'].includes(args.status))return failOut(2,'--status 仅支持 all、reading 或 finished。');
      const offset=intArg(args.offset,'offset',0,100000)??0,limit=intArg(args.limit,'limit',1,30)??15;
      const p=readProfile(mode);
      if(!p.snapshot)return send({ok:true,connected:mode==='demo'?true:!!getKey(),total:0,books:[],nextOffset:null,note:'本地尚无书架数据；配置凭证后运行 sync。'});
      const query=String(args.query||'').toLowerCase();
      const statusArg=args.status||'all';
      const all=(p.snapshot.books||[]).filter(b=>(b.title+b.author).toLowerCase().includes(query)&&(statusArg==='all'||(statusArg==='finished'?b.done:!b.done)));
      return send({ok:true,total:all.length,books:all.slice(offset,offset+limit).map(b=>({id:b.id,title:b.title,author:b.author,progress:b.progress,done:b.done,deepLink:b.deepLink,weeklySeconds:b.weeklySeconds,finishDate:b.finishDate})),nextOffset:offset+limit<all.length?offset+limit:null});
    }
    if(cmd==='notes'){
      const bookId=rest[0];
      const offset=intArg(args.offset,'offset',0,100000)??0,limit=intArg(args.limit,'limit',1,30)??15;
      if(!bookId)return failOut(2,'请提供书籍 ID：notes <bookId>。可用 books 命令查询。');
      if(mode==='live'&&isTrue(args.refresh)){if(!getKey())return authRequired();await fetchBookNotes(bookId,{restart:isTrue(args.restart)});}
      const p=readProfile(mode),book=p.snapshot?.books.find(b=>b.id===bookId);
      if(!book)return failOut(4,'书籍不存在于当前书架；可运行 books 查看已同步书籍。');
      let rows=(p.snapshot?.notes||[]).filter(n=>n.bookId===bookId);
      if(args['note-ids']!==undefined){const ids=[...new Set(list(args['note-ids']))];if(!ids.length||ids.length>20)return failOut(2,'请指定 1 到 20 条用户选定的笔记。');const selected=ids.map(id=>rows.find(n=>n.id===id));if(selected.some(n=>!n))return failOut(4,'所选笔记不在指定书籍中。');rows=selected;}
      const page=rows.slice(offset,offset+limit),notes=isTrue(args.list)?noteCatalog(page):noteExcerpts(page);
      return send({ok:true,book:{id:book.id,title:book.title,author:book.author,notesFetchedAt:book.notesFetchedAt},
        totalLoaded:rows.length,notes,complete:book.notesSync?.complete??null,truncated:notes.some(n=>n.truncated),metadataOnly:isTrue(args.list),nextOffset:offset+limit<rows.length?offset+limit:null,
        note:book.notesFetchedAt?'该书的笔记已在本机更新过；结果仍为已载入部分，refresh 可再次更新。':'该书的笔记尚未从微信读书载入；结果为已同步范围内已有的部分内容。'});
    }
    if(cmd==='find-book'){
      if(mode==='demo')return send({ok:true,books:[{bookId:'demo-mountain',title:'山间来信（虚构示例）',author:'林禾'}]});
      if(!getKey())return authRequired();return send({ok:true,...await readersMod.searchReaderBooks(rest[0])});
    }
    if(cmd==='highlights'){
      if(mode==='demo')return send({ok:true,bookId:rest[0],highlights:[{chapterUid:1,range:'0-18',quote:'时间从不匆忙，匆忙的是我们。',readers:100}],demo:true});
      if(!getKey())return authRequired();return send({ok:true,...await readersMod.readerHighlights(rest[0])});
    }
    if(cmd==='readers'){
      const chapterUid=intArg(args['chapter-uid'],'chapter-uid',0,2147483647);
      const {session,cached}=await readersMod.discoverReaders({bookId:rest[0],question:args.question||'',...(chapterUid!==null?{chapterUid}:{}),...(args.range?{range:args.range}:{})},{mode,refresh:isTrue(args.refresh)});
      return send({ok:true,sessionId:session.id,fetchedAt:session.fetchedAt,title:session.title,query:session.query,cached,coverage:session.coverage,readers:readersMod.readerView(session),hint:'高赞仅按本次样本中有点赞数据的内容排序；同频观点与不同视角由专家基于候选原文整理。候选内容可用 readers-list 查看。'});
    }
    if(cmd==='readers-list'){
      const offset=intArg(args.offset,'offset',0,120)??0,view=args.view||'popular';
      if(!['popular','resonance','perspective'].includes(view))return failOut(2,'--view 仅支持 popular、resonance 或 perspective。');
      const sessions=readProfile(mode).readerDiscoveries||[];
      const session=args.session?sessions.find(s=>s.id===args.session):sessions[0];
      if(!session)return send({ok:true,sessions:[],readers:[],candidates:[],note:'尚未找到这次发现记录，请先选书查找读友。'});
      const sorted=[...session.candidates].sort((a,b)=>(b.likes??-1)-(a.likes??-1)||a.reviewId.localeCompare(b.reviewId));
      return send({ok:true,sessionId:session.id,fetchedAt:session.fetchedAt,title:session.title,query:session.query,coverage:session.coverage,
        sessions:sessions.map(s=>({id:s.id,title:s.title,query:s.query,fetchedAt:s.fetchedAt})),view,readers:readersMod.readerView(session,view),
        candidates:sorted.slice(offset,offset+20).map(c=>({...c,content:c.content.slice(0,500),quote:c.quote.slice(0,100),truncated:c.truncated||c.content.length>500||c.quote.length>100})),nextOffset:offset+20<sorted.length?offset+20:null});
    }
    if(cmd==='readers-curate'){
      if(!args.input)return failOut(2,'请用 --input 提供推荐理由 JSON 文件。');
      const session=readersMod.curateReaders(readJsonInputArg(args.input),mode);
      return send({ok:true,sessionId:session.id,curatedAt:session.curatedAt,note:'AI 推荐理由已保存到本机，可重新生成工作台查看。'});
    }
    if(cmd==='settings'){
      if(rest[0]!==undefined&&rest[0]!=='set')return failOut(2,'用法：settings [set --goal n --timezone tz --primary-book id|null]。');
      if(rest[0]===undefined&&(args.goal!==undefined||args.timezone!==undefined||args['primary-book']!==undefined))return failOut(2,'settings 的修改选项仅在 set 子命令下可用。');
      if(rest[0]==='set'){
        const current=readProfile(mode).settings;
        const input={...current};
        if(args.goal!==undefined){const goal=intArg(args.goal,'goal',5,600);if(goal===null)return failOut(2,'--goal 必须是 5 到 600 之间的整数（分钟）。');input.goal=goal;}
        if(args.timezone!==undefined){const tz=String(args.timezone);try{new Intl.DateTimeFormat('en',{timeZone:tz});}catch{return failOut(2,'--timezone 不是有效的时区名称（例如 Asia/Shanghai）。');}input.timeZone=tz;}
        if(args['primary-book']!==undefined)input.primaryBookId=args['primary-book']==='null'?null:String(args['primary-book']);
        await action('/api/settings',mode,input);
        return send({ok:true,settings:readProfile(mode).settings});
      }
      return send({ok:true,settings:readProfile(mode).settings});
    }
    if(cmd==='reflect'){
      if(args['text-file']!==undefined&&args.text!==undefined)return failOut(2,'--text 与 --text-file 只能任选其一。');
      if(args.input!==undefined&&(args.text!==undefined||args['text-file']!==undefined||args['note-id']!==undefined))return failOut(2,'--input 不能与其他取值选项同时使用。');
      const input=readJsonInputArg(args.input);
      const noteId=args['note-id']??input.noteId;
      const text=args['text-file']!==undefined?readTextFileArg(args['text-file'],'--text-file'):(args.text!==undefined?String(args.text):input.text);
      if(!noteId||text===undefined||text===null)return failOut(2,'请提供 --note-id <id> 与 --text <text>（或 --text-file / --input）。');
      const r=await action('/api/reflection',mode,{noteId:String(noteId),text:String(text)});
      return send({ok:true,noteId:String(noteId),updatedAt:new Date().toISOString()});
    }
    if(cmd==='draft'){
      if(args['reflection-file']!==undefined&&args.reflection!==undefined)return failOut(2,'--reflection 与 --reflection-file 只能任选其一。');
      const noteIds=list(args.notes);
      if(!noteIds.length)return failOut(2,'请用 --notes <id,id> 指定至少一条已载入笔记。');
      const reflection=args['reflection-file']!==undefined?readTextFileArg(args['reflection-file'],'--reflection-file'):String(args.reflection||'');
      const draft=await action('/api/draft',mode,{noteIds,reflection});
      return send({ok:true,...draft});
    }
    if(cmd==='review'){
      const period=args.period==='monthly'?'monthly':'weekly';
      if(args.period!==undefined&&!['weekly','monthly'].includes(args.period))return failOut(2,'--period 仅支持 weekly 或 monthly。');
      const review=await action('/api/review',mode,{period,noteIds:list(args['note-ids'])});
      return send({ok:true,...review});
    }
    if(cmd==='save-card'){
      if(args['body-file']!==undefined&&args.body!==undefined)return failOut(2,'--body 与 --body-file 只能任选其一。');
      if(args.input!==undefined&&['title','body','body-file','kind','note-ids','id','origin'].some(f=>args[f]!==undefined))return failOut(2,'--input 不能与其他取值选项同时使用。');
      const input=readJsonInputArg(args.input);
      const body=args['body-file']!==undefined?readTextFileArg(args['body-file'],'--body-file'):(args.body!==undefined?String(args.body):input.body);
      const title=args.title!==undefined?String(args.title):input.title;
      if(!title||body===undefined||body===null||body==='')return failOut(2,'请提供 --title 与 --body（或 --body-file / --input）。');
      if(args.kind!==undefined&&!['card','weekly','monthly'].includes(args.kind))return failOut(2,'--kind 仅支持 card、weekly 或 monthly。');
      const kind=args.kind||input.kind||'card';
      const origin=args.origin||input.origin||'local';if(!['local','workbuddy'].includes(origin))return failOut(2,'--origin 仅支持 local 或 workbuddy。');
      const card=await action('/api/cards',mode,{id:args.id?String(args.id):input.id,title:String(title),body:String(body),kind,noteIds:list(args['note-ids']).length?list(args['note-ids']):(input.noteIds||[]),origin});
      return send({ok:true,card});
    }
    if(cmd==='backup'){
      const sub=rest[0],file=rest[1];
      if(!sub||!['export','import'].includes(sub)||!file)return failOut(2,'用法：backup export|import <路径>。');
      if(sub==='export'){
        const p=readProfile(mode);
        const target=writePrivate(prepareOutput(ensureSafeOutput(file)),JSON.stringify(p,null,2));
        return send({ok:true,path:target,mode,cards:p.cards.length,reflections:p.reflections.length,note:'备份仅含本机阅读数据，不含任何凭证。'});
      }
      let raw;try{raw=JSON.parse(readFileSync(resolve(file),'utf8'));}catch(e){return failOut(2,'备份文件无法读取或不是有效的 JSON。');}
      const r=await action('/api/import',mode,raw);
      return send({ok:true,...r,mode});
    }
    if(cmd==='report'||cmd==='workspace'){
      const file=rest[0]||(cmd==='workspace'?join(dataDir,'reports',`${mode==='demo'?'demo':accountId()}-reading.html`):null);
      if(!file)return failOut(2,'请提供输出路径：report <输出.html>。');
      const output=ensureSafeOutput(file);
      if(cmd==='workspace'&&mode==='live'&&isTrue(args.sync)){
        if(!getKey())return authRequired();await syncAll({scope:'basic',force:isTrue(args.force)});
        if(syncStatus.error&&!readProfile(mode).snapshot)return failOut(exitFor({status:syncStatus.errorStatus}),syncStatus.error,{retryAt:syncStatus.retryAt});
      }
      const p=readProfile(mode);
      if(cmd==='workspace'&&mode==='live'&&!p.snapshot&&!p.cards.length&&!p.readerDiscoveries.length)return failOut(getKey()?1:3,'本机尚无个人阅读数据。',{hint:getKey()?'用户要求联网时加 --sync；也可用 --mode demo 体验。':'通过官方入口获取 Key 后从本机文件导入；也可用 --mode demo 体验。',keyUrl:'https://weread.qq.com/r/weread-skills'});
      const target=writePrivate(prepareOutput(output),buildReport(p,{mode,syncError:cmd==='workspace'&&isTrue(args.sync)?syncStatus.error:null}));
      const opened=isTrue(args.open)?await (io.openFile||openLocalReport)(target):false;
      return send({ok:true,path:target,mode,opened,snapshotAvailable:!!p.snapshot,syncedAt:p.snapshot?.syncedAt||null,generatedAt:new Date().toISOString(),warnings:p.snapshot?.warnings||[],syncError:cmd==='workspace'&&isTrue(args.sync)?syncStatus.error:null,areas:['today','shelf','notes','readers','review'],note:'工作台为本机只读快照；更新时再次运行 workspace。未能自动打开时可用返回路径打开。'});
    }
    if(cmd==='auth'){
      if(mode!=='live')return failOut(2,'auth 仅用于个人模式（live）；示例模式不需要凭证，也不会显示任何个人授权信息。');
      const sub=rest[0];
      if(!['status','import','revoke','history','export-history'].includes(sub))return failOut(2,'用法：auth status|import <文件>|revoke|history|export-history <账户标识> <文件>。');
      if(rest.length!==(sub==='export-history'?3:sub==='import'?2:1))return failOut(2,'用法：auth status|import <文件>|revoke|history|export-history <账户标识> <文件>。');
      if(sub==='status')return send({ok:true,...credentialInfo(),historyAvailable:hasProfileHistory(),authorizationVerified:false});
      if(sub==='history')return send({ok:true,profiles:profileHistory(),note:'只显示历史空间标识、数量和更新时间；选择前请确认数据属于本人。'});
      if(sub==='export-history'){const p=historicalProfile(rest[1]),target=writePrivate(prepareOutput(ensureSafeOutput(rest[2])),JSON.stringify(p,null,2));return send({ok:true,path:target,cards:p.cards.length,reflections:p.reflections.length,note:'历史数据已导出，原文件保留。确认是本人同一账户的数据后，可用 backup import 显式恢复到当前空间。'});}
      if(sub==='import'){
        const file=rest[1];
        try{importCredential(resolve(file));}catch(e){
          if(e?.status===400)throw e; // 格式错误已有固定提示，不含文件内容
          return failOut(2,'无法读取指定的凭证文件（路径与内容不会显示）。请确认文件存在且有读取权限，不要把 Key 直接写在命令里。');
        }
        return send({ok:true,...credentialInfo(),historyAvailable:hasProfileHistory(),authorizationVerified:false,note:'凭证已以 0600 权限保存；若历史卡片暂不可见，可用 auth history 查看历史空间，再确认归属并恢复。环境变量配置存在时仍优先使用环境变量。'});
      }
      if(sub==='revoke'){
        revokeCredential();
        const remaining=!!getKey();
        const note=process.env.WEREAD_API_KEY?'已移除本机凭证文件；当前环境变量 WEREAD_API_KEY 仍提供凭证，授权仍然有效。如需彻底断开，请同时移除该环境变量后再执行 auth revoke。':'已移除本机凭证文件。';
        return send({ok:true,configured:remaining,note});
      }
    }
    return failOut(2,'未知命令。请用 --help 查看支持的命令。');
  }catch(e){
    return failOut(exitFor(e),e instanceof z.ZodError?'数据格式不正确，请检查输入。':(e.message||'操作未完成。'),{retryAt:e.retryAt});
  }
}

let isMain=false;
try{isMain=!!process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url));}catch{}
if(isMain){
  runCli(process.argv.slice(2)).then(code=>process.exit(code),e=>{console.error(JSON.stringify({ok:false,error:{code:1,message:e?.message||'操作未完成。'}}));process.exit(1);});
}
