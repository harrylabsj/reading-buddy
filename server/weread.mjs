import {createHash} from 'node:crypto';
import {getKey,readProfile,updateProfile,accountId,acquireSyncLease,retryDeadline,persistRetryDeadline} from './storage.mjs';
import {normalizePeriod,normalizeShelf,finite,safeLink,safeCover,dayKey} from './domain.mjs';
const gateway='https://i.weread.qq.com/api/agent/gateway';
let active=0,queue=[],syncPromise=null;
const CACHE_AGE=15*60*1000;
export const syncStatus={running:false,stage:'',error:null,errorStatus:null,startedAt:null,skipped:false};
export class ReaderError extends Error {constructor(message,status=400){super(message);this.status=status;}}
async function slot(){if(active>=3)await new Promise(resolve=>queue.push(resolve));else active++;}
function release(){const next=queue.shift();if(next)next();else active--;}
function fresh(stamp,maxAge=CACHE_AGE){const age=Date.now()-Date.parse(stamp||'');return Number.isFinite(age)&&age>=0&&age<maxAge;}
export async function gatewayCall(apiName,params={},credential=getKey()){
 if(!credential)throw new ReaderError('请先配置微信读书授权。',401);
 const identity=createHash('sha256').update(credential).digest('hex').slice(0,20);
 const checkBackoff=()=>{const deadline=retryDeadline(identity);if(Date.now()<deadline)throw Object.assign(new ReaderError('微信读书请求较多，请在 retryAt 之后重试；本机历史数据仍可使用。',429),{retryAt:new Date(deadline).toISOString()});};
 checkBackoff();await slot();
 try{
  checkBackoff();
  const res=await fetch(gateway,{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({api_name:apiName,skill_version:'1.0.4',...params}),signal:AbortSignal.timeout(15000)});
  if(res.status===429){const raw=res.headers?.get?.('retry-after');const seconds=raw?Number(raw):NaN;const parsed=raw?Date.parse(raw):NaN;const wait=Number.isFinite(seconds)?seconds*1000:Number.isFinite(parsed)?parsed-Date.now():60000;const deadline=Date.now()+Math.max(1000,Math.min(wait,3600000));persistRetryDeadline(deadline,identity);throw Object.assign(new ReaderError('微信读书请求较多，请在 retryAt 之后重试；本机历史数据仍可使用。',429),{retryAt:new Date(deadline).toISOString()});}
  if(res.status===401||res.status===403)throw new ReaderError('微信读书授权失效，请重新导入本机凭证。',401);
  if(!res.ok)throw new ReaderError(`微信读书服务暂不可用（${res.status}），已保留历史记录。`,502);
  const d=await res.json();
  if(d.upgrade_info)throw new ReaderError('微信读书接口要求升级技能版本，已暂停同步；请更新读书搭子专家或内置 Skill 后重试。',409);
  if(d.errcode)throw new ReaderError(`微信读书未能完成请求（错误码 ${Number(d.errcode)||'未知'}）。`,502);
  return d;
 }catch(e){if(e instanceof ReaderError)throw e;throw new ReaderError('暂时无法连接微信读书，已保留上次成功数据。',502);}
 finally{release();}
}
function noteDate(stamp,zone){try{return stamp?dayKey(new Date(Number(stamp)*1000),zone):'';}catch{return '';}}
async function withLease(held,identity,fn){const unlock=held?null:acquireSyncLease(identity);try{return await fn();}finally{unlock?.();}}
export async function fetchBookNotes(bookId,{force=true,restart=false,leaseHeld=false}={}){
 const identity=accountId(),credential=getKey();
 return withLease(leaseHeld,identity,async()=>{
  const p=readProfile(),book=p.snapshot?.books.find(b=>b.id===bookId);if(!book)throw new ReaderError('没有找到这本书。',404);
  if(!force&&book.notesSync?.complete&&fresh(book.notesFetchedAt))return {count:p.snapshot.notes.filter(n=>n.bookId===bookId).length,complete:true,cached:true};
  const previous=book.notesSync;
  const resume=!restart&&previous?.complete===false&&previous.cursor!==null&&previous.cursor!==undefined;
  const firstParams={bookid:bookId,count:100,...(resume?{synckey:previous.cursor}:{})};
  const [highlights,reviews]=await Promise.all([gatewayCall('/book/bookmarklist',{bookId},credential),gatewayCall('/review/list/mine',firstParams,credential)]);
  if(!Array.isArray(highlights.updated)||!Array.isArray(reviews.reviews))throw new ReaderError('笔记接口返回格式不完整，历史缓存已保留。',502);
  const all=[...(reviews.reviews||[])];let cursor=reviews.synckey,more=!!reviews.hasMore,pages=1,reason=null;
  while(more&&pages<50){
   if(cursor===undefined||cursor===null){reason='missing-cursor';break;}
   const next=await gatewayCall('/review/list/mine',{bookid:bookId,count:100,synckey:cursor},credential);
   if(!Array.isArray(next.reviews))throw new ReaderError('笔记分页返回格式不完整，历史缓存已保留。',502);
   all.push(...(next.reviews||[]));more=!!next.hasMore;pages++;
   if(more&&next.synckey===cursor){reason='cursor-stalled';break;}
   cursor=next.synckey;
  }
  if(more&&!reason)reason='page-limit';
  const chapters=new Map((highlights.chapters||[]).map(c=>[String(c.chapterUid),c.title]));
  const highlightsRows=(highlights.updated||[]).filter(n=>n.markText).map(n=>({id:'h-'+n.bookmarkId,bookId,title:book.title,chapter:chapters.get(String(n.chapterUid))||'',quote:String(n.markText),thought:'',date:noteDate(n.createTime,p.settings.timeZone),...(Number.isInteger(n.chapterUid)?{chapterUid:n.chapterUid}:{}),...(typeof n.range==='string'?{range:n.range.slice(0,80)}:{}),type:'highlight',deepLink:safeLink(n.deepLink)}));
  const thoughts=[];for(const row of all){const n=row.review||row;if(!n.content)continue;thoughts.push({id:'t-'+n.reviewId,bookId,title:book.title,chapter:n.chapterName||chapters.get(String(n.chapterUid))||'',quote:String(n.abstract||''),thought:String(n.content),date:noteDate(n.createTime,p.settings.timeZone),...(Number.isInteger(n.chapterUid)?{chapterUid:n.chapterUid}:{}),...(typeof n.range==='string'?{range:n.range.slice(0,80)}:{}),type:'thought',deepLink:safeLink(n.deepLink)});}
  const receivedIds=[...new Set([...(resume?previous.reviewIds:[]),...thoughts.map(n=>n.id)])];
  if(identity!==accountId())throw new ReaderError('连接已更改，请重新同步。',409);
  const now=new Date().toISOString();
  updateProfile('live',q=>{
   const current=q.snapshot?.books.find(b=>b.id===bookId);if(!current)throw new ReaderError('书架已更新，请重新选择书籍。',409);
   const prior=q.snapshot.notes.filter(n=>n.bookId===bookId);
   // Partial pages merge into the old cache. Only a completed pass reconciles removed rows.
   const retained=more?prior:resume?prior.filter(n=>n.type==='thought'&&receivedIds.includes(n.id)):[];
   const merged=new Map([...retained,...highlightsRows,...thoughts].map(n=>[n.id,n]));
   q.snapshot.notes=[...q.snapshot.notes.filter(n=>n.bookId!==bookId),...merged.values()].sort((a,b)=>b.date.localeCompare(a.date));
   current.notesFetchedAt=now;
   current.notesSync={complete:!more,cursor:more&&(typeof cursor==='string'||typeof cursor==='number')?cursor:null,reviewIds:more?receivedIds:[],lastCompleteAt:more?(previous?.lastCompleteAt||null):now,reason};
   const warning=`书籍 ${bookId} 的笔记尚未完整载入，历史缓存已保留；可按书继续刷新。`;
   q.snapshot.warnings=q.snapshot.warnings.filter(w=>!w.startsWith(`书籍 ${bookId} 的笔记尚未完整载入`));
   if(more)q.snapshot.warnings=[...new Set([...q.snapshot.warnings,warning])].slice(-30);
  });
  return {count:readProfile().snapshot.notes.filter(n=>n.bookId===bookId).length,complete:!more,reason,pages,resumed:!!resume};
 });
}
export async function refreshBook(bookId,{force=false,leaseHeld=false}={}){
 const identity=accountId(),credential=getKey();
 return withLease(leaseHeld,identity,async()=>{
  const existing=readProfile().snapshot?.books.find(b=>b.id===bookId);if(!existing)throw new ReaderError('没有找到这本书。',404);
  if(!force&&fresh(existing.detailFetchedAt))return {cached:true};
  const [info,progress]=await Promise.all([gatewayCall('/book/info',{bookId},credential),gatewayCall('/book/getprogress',{bookId},credential)]);
  if(identity!==accountId())throw new ReaderError('连接已更改，请重新同步。',409);
  updateProfile('live',p=>{const b=p.snapshot?.books.find(b=>b.id===bookId);if(!b)return;const bp=progress.book||{};
   b.cover=safeCover(info.cover)||b.cover;b.deepLink=safeLink(info.deepLink)||b.deepLink;b.progress=finite(bp.progress);b.rating=finite(info.newRating);b.done=b.done||b.progress===100;b.detailFetchedAt=new Date().toISOString();
   if(b.progress===100&&bp.finishTime)b.finishDate=noteDate(bp.finishTime,p.settings.timeZone);
  });return {cached:false};
 });
}
export async function syncAll({scope='basic',force=true}={}){
 if(syncPromise)return syncPromise;
 syncPromise=performSync(scope,force);
 try{return await syncPromise;}finally{syncPromise=null;}
}
async function performSync(scope,force){
 Object.assign(syncStatus,{running:true,error:null,errorStatus:null,retryAt:null,skipped:false,stage:'正在同步阅读时长和书架',startedAt:new Date().toISOString()});
 const identity=accountId(),credential=getKey();let unlock;
 try{
  if(!['basic','full'].includes(scope))throw new ReaderError('同步范围仅支持 basic 或 full。');
  unlock=acquireSyncLease(identity);
  const initial=readProfile(),zone=initial.settings.timeZone,today=dayKey(new Date(),zone);
  if(!force&&fresh(initial.snapshot?.syncedAt)&&initial.snapshot?.weekly?.end===today&&initial.snapshot?.monthly?.end===today&&(scope==='basic'||initial.snapshot.syncScope==='full')&&!initial.snapshot.warnings.length){syncStatus.skipped=true;syncStatus.stage='本机数据仍在有效期内，使用已有快照';return;}
  const results=await Promise.allSettled([gatewayCall('/readdata/detail',{mode:'weekly'},credential),gatewayCall('/readdata/detail',{mode:'monthly'},credential),gatewayCall('/shelf/sync',{},credential),gatewayCall('/user/notebooks',{count:100},credential)]);
  if(identity!==accountId())throw new ReaderError('连接已更改，请重新同步。',409);
  if(results.every(r=>r.status==='rejected'))throw results[0].reason;
  const upgrade=results.find(r=>r.status==='rejected'&&r.reason.status===409);if(upgrade)throw upgrade.reason;
  const [weekly,monthly,shelf,nb]=results.map(r=>r.status==='fulfilled'?r.value:null);
  const labels=['本周统计','本月统计','书架','笔记概览'];const warnings=results.flatMap((r,i)=>r.status==='rejected'?[`${labels[i]}同步失败，保留旧记录。`]:[]);
  if(nb?.hasMore)warnings.push('笔记概览为最近100本，其余书籍可在书架中按需同步。');
  updateProfile('live',p=>{
   const prior=p.snapshot,books=shelf?normalizeShelf(shelf,nb?.books||[],prior?.books||[]):prior?.books||[];
   if(weekly)for(const entry of weekly.readLongest||[]){const b=books.find(b=>b.id===String(entry.book?.bookId));if(b)b.weeklySeconds=finite(entry.readTime);}
   else if(prior?.weekly?.end===today){const old=new Map(prior.books.map(b=>[b.id,b.weeklySeconds]));for(const b of books)b.weeklySeconds=old.get(b.id)??null;}
   p.snapshot={syncedAt:new Date().toISOString(),syncScope:scope,books,notes:prior?.notes||[],weekly:weekly?normalizePeriod(weekly,'weekly',zone):prior?.weekly||null,monthly:monthly?normalizePeriod(monthly,'monthly',zone):prior?.monthly||null,
    totals:{notebookBooks:nb?finite(nb.totalBookCount):prior?.totals.notebookBooks??null,notes:nb?finite(nb.totalNoteCount):prior?.totals.notes??null,ebooks:shelf?(shelf.books||[]).length:prior?.totals.ebooks??null,albums:shelf?(shelf.albums||[]).length:prior?.totals.albums??null,articles:shelf?(shelf.mp&&Object.keys(shelf.mp).length?1:0):prior?.totals.articles??null},warnings:[...new Set([...warnings,...(prior?.warnings||[]).filter(w=>w.includes('历史缓存已保留'))])].slice(-30)};
   if(!books.some(b=>b.id===p.settings.primaryBookId))p.settings.primaryBookId=books.find(b=>!b.done&&b.progress>0)?.id||books.find(b=>!b.done)?.id||books[0]?.id||null;
  });
  if(scope==='full'){
   syncStatus.stage='正在按完整同步范围补齐详情和最近笔记';
   const p=readProfile(),ids=[...new Set([p.settings.primaryBookId,...p.snapshot.books.slice(0,11).map(b=>b.id)])].filter(Boolean);
   const detailResults=await Promise.allSettled(ids.map(id=>refreshBook(id,{force,leaseHeld:true})));
   if(detailResults.some(r=>r.status==='rejected'))updateProfile('live',p=>p.snapshot.warnings=[...new Set([...p.snapshot.warnings,'部分封面或进度未更新，可以稍后重试。'])].slice(-30));
   const noteIds=(nb?.books||[]).slice(0,2).map(b=>String(b.bookId)).filter(id=>p.snapshot.books.some(b=>b.id===id));
   const noteResults=await Promise.allSettled(noteIds.map(id=>fetchBookNotes(id,{force,leaseHeld:true})));
   if(noteResults.some(r=>r.status==='rejected'))updateProfile('live',p=>p.snapshot.warnings=[...new Set([...p.snapshot.warnings,'部分笔记未更新，请按书刷新。'])].slice(-30));
  }
  syncStatus.stage='同步完成';
 }catch(e){syncStatus.error=e.message;syncStatus.errorStatus=e?.status??null;syncStatus.retryAt=e.retryAt||null;syncStatus.stage='同步未完成';}
 finally{unlock?.();syncStatus.running=false;}
}
