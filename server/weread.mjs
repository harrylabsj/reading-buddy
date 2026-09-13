import { getKey, readProfile, updateProfile, accountId } from './storage.mjs';
import { normalizePeriod, normalizeShelf, finite, safeLink, safeCover, dayKey } from './domain.mjs';
const gateway = 'https://i.weread.qq.com/api/agent/gateway';
let active = 0, queue = [], retryAfter = 0;
export const syncStatus = { running: false, stage: '', error: null, startedAt: null };
export class ReaderError extends Error { constructor(message, status=400) {super(message);this.status=status;} }
async function slot() { if(active >= 3) await new Promise(resolve => queue.push(resolve)); active++; }
function release() { active--; queue.shift()?.(); }
export async function gatewayCall(apiName, params = {}, credential = getKey()) {
  if (!credential) throw new ReaderError('请先连接微信读书。', 401);
  if (Date.now() < retryAfter) throw new ReaderError('微信读书请求较多，请一分钟后重试。', 429);
  await slot();
  try {
    const res = await fetch(gateway, { method:'POST', headers:{ Authorization:`Bearer ${credential}`, 'Content-Type':'application/json' }, body:JSON.stringify({ api_name:apiName, skill_version:'1.0.4', ...params }), signal:AbortSignal.timeout(15000) });
    if(res.status===429) { retryAfter=Date.now()+60000;throw new ReaderError('微信读书请求较多，请一分钟后重试。',429); }
    if(res.status===401||res.status===403) throw new ReaderError('微信读书授权失效，请检查凭证或重新连接。',401);
    if(!res.ok) throw new ReaderError(`微信读书服务暂不可用（${res.status}），已保留历史记录。`,502);
    const d=await res.json();
    if(d.upgrade_info) throw new ReaderError('微信读书接口要求升级技能版本，已暂停同步；请更新连接器后重试。',409);
    if(d.errcode) throw new ReaderError(`微信读书未能完成请求（错误码 ${Number(d.errcode)||'未知'}）。`,502);
    return d;
  } catch(e) { if(e instanceof ReaderError) throw e; throw new ReaderError('暂时无法连接微信读书，已保留上次成功数据。',502); }
  finally { release(); }
}
function noteDate(stamp, zone) { try { return stamp ? dayKey(new Date(Number(stamp)*1000),zone) : ''; } catch { return ''; } }
export async function fetchBookNotes(bookId) {
  const identity=accountId(), p=readProfile(), book=p.snapshot?.books.find(b=>b.id===bookId); if(!book) throw new ReaderError('没有找到这本书。',404);
  const [highlights, reviews]=await Promise.all([gatewayCall('/book/bookmarklist',{bookId}),gatewayCall('/review/list/mine',{bookid:bookId,count:100})]);
  const all=[...(reviews.reviews||[])];let cursor=reviews.synckey,more=!!reviews.hasMore, pages=1;
  while(more && pages<50) { const next=await gatewayCall('/review/list/mine',{bookid:bookId,count:100,synckey:cursor}); all.push(...(next.reviews||[])); more=!!next.hasMore;pages++;if(next.synckey===cursor)break;cursor=next.synckey; }
  const chapters=new Map((highlights.chapters||[]).map(c=>[String(c.chapterUid),c.title]));
  const notes=(highlights.updated||[]).filter(n=>n.markText).map(n=>({id:'h-'+n.bookmarkId,bookId,title:book.title,chapter:chapters.get(String(n.chapterUid))||'',quote:String(n.markText),thought:'',date:noteDate(n.createTime,p.settings.timeZone),type:'highlight',deepLink:safeLink(n.deepLink)}));
  for(const row of all){ const n=row.review||row;if(!n.content)continue;notes.push({id:'t-'+n.reviewId,bookId,title:book.title,chapter:n.chapterName||chapters.get(String(n.chapterUid))||'',quote:String(n.abstract||''),thought:String(n.content),date:noteDate(n.createTime,p.settings.timeZone),type:'thought',deepLink:safeLink(n.deepLink)}); }
  if(identity!==accountId())throw new ReaderError('连接已更改，请重新同步。',409);
  updateProfile('live',q=>{q.snapshot.notes=[...q.snapshot.notes.filter(n=>n.bookId!==bookId),...new Map(notes.map(n=>[n.id,n])).values()].sort((a,b)=>b.date.localeCompare(a.date));const b=q.snapshot.books.find(b=>b.id===bookId);if(b)b.notesFetchedAt=new Date().toISOString();if(more)q.snapshot.warnings=[...new Set([...q.snapshot.warnings,'部分想法尚未载入，请按书继续同步。'])];});
  return { count:notes.length, complete:!more };
}
export async function refreshBook(bookId) {
  const identity=accountId();const [info,progress]=await Promise.all([gatewayCall('/book/info',{bookId}),gatewayCall('/book/getprogress',{bookId})]);
  if(identity!==accountId())return;
  updateProfile('live',p=>{const b=p.snapshot?.books.find(b=>b.id===bookId);if(!b)return;const bp=progress.book||{};
    b.cover=safeCover(info.cover)||b.cover;b.deepLink=safeLink(info.deepLink)||b.deepLink;b.progress=finite(bp.progress);b.rating=finite(info.newRating);b.done=b.done||b.progress===100;
    if(b.progress===100 && bp.finishTime)b.finishDate=noteDate(bp.finishTime,p.settings.timeZone);
  });
}
export async function syncAll() {
  if(syncStatus.running)return;
  syncStatus.running=true;syncStatus.error=null;syncStatus.stage='正在同步阅读时长和书架';syncStatus.startedAt=new Date().toISOString();
  const identity=accountId(), initial=readProfile(), zone=initial.settings.timeZone;
  try {
    const results=await Promise.allSettled([gatewayCall('/readdata/detail',{mode:'weekly'}),gatewayCall('/readdata/detail',{mode:'monthly'}),gatewayCall('/shelf/sync'),gatewayCall('/user/notebooks',{count:100})]);
    if(identity!==accountId())return;
    if(results.every(r=>r.status==='rejected'))throw results[0].reason;
    const upgrade=results.find(r=>r.status==='rejected'&&r.reason.status===409);if(upgrade)throw upgrade.reason;
    const [weekly,monthly,shelf,nb]=results.map(r=>r.status==='fulfilled'?r.value:null);
    const labels=['本周统计','本月统计','书架','笔记概览'];const warnings=results.flatMap((r,i)=>r.status==='rejected'?[`${labels[i]}同步失败，保留旧记录。`]:[]);
    if(nb?.hasMore)warnings.push('笔记概览为最近100本，其余书籍可在书架中按需同步。');
    updateProfile('live',p=>{
      const prior=p.snapshot;
      const books=shelf?normalizeShelf(shelf,nb?.books||[],prior?.books||[]):prior?.books||[];
      if(weekly)for(const entry of weekly.readLongest||[]){const b=books.find(b=>b.id===String(entry.book?.bookId));if(b)b.weeklySeconds=finite(entry.readTime);}
      p.snapshot={ syncedAt:new Date().toISOString(),books,notes:prior?.notes||[],weekly:weekly?normalizePeriod(weekly,'weekly',zone):prior?.weekly||null,monthly:monthly?normalizePeriod(monthly,'monthly',zone):prior?.monthly||null,
        totals:{notebookBooks:nb?finite(nb.totalBookCount):prior?.totals.notebookBooks??null,notes:nb?finite(nb.totalNoteCount):prior?.totals.notes??null,ebooks:shelf?(shelf.books||[]).length:prior?.totals.ebooks??null,albums:shelf?(shelf.albums||[]).length:prior?.totals.albums??null,articles:shelf?(shelf.mp&&Object.keys(shelf.mp).length?1:0):prior?.totals.articles??null},warnings};
      if(!books.some(b=>b.id===p.settings.primaryBookId))p.settings.primaryBookId=books.find(b=>!b.done&&b.progress>0)?.id||books.find(b=>!b.done)?.id||books[0]?.id||null;
    });
    syncStatus.stage='正在补齐封面、进度和最近笔记';
    const p=readProfile();const ids=[...new Set([p.settings.primaryBookId,...p.snapshot.books.slice(0,11).map(b=>b.id)])].filter(Boolean);
    const detailResults=await Promise.allSettled(ids.map(refreshBook));
    if(identity!==accountId())return;
    if(detailResults.some(r=>r.status==='rejected'))updateProfile('live',p=>p.snapshot.warnings.push('部分封面或进度未更新，可以稍后重试。'));
    const noteIds=(nb?.books||[]).slice(0,2).map(b=>String(b.bookId)).filter(id=>p.snapshot.books.some(b=>b.id===id));
    const noteResults=await Promise.allSettled(noteIds.map(fetchBookNotes));
    if(identity!==accountId())return;
    if(noteResults.some(r=>r.status==='rejected'))updateProfile('live',p=>p.snapshot.warnings.push('部分笔记未更新，请在笔记页按书同步。'));
    syncStatus.stage='同步完成';
  }catch(e){syncStatus.error=e.message;syncStatus.stage='同步未完成';}
  finally{syncStatus.running=false;}
}
