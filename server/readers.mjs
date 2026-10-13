import {createHash} from 'node:crypto';
import {z} from 'zod';
import {readerQuerySchema,readerSessionSchema,readerPickSchema} from './readers-schema.mjs';
import {gatewayCall,ReaderError} from './weread.mjs';
import {accountId,getKey,readProfile,updateProfile,acquireSyncLease} from './storage.mjs';
import {dayKey,safeLink,finite} from './domain.mjs';

// A bounded discovery, not a global leaderboard: two passages and two pages per source.
const PAGES=2,HIGHLIGHTS=2,COUNT=20,CACHE_MS=15*60*1000;
const text=(v,n)=>typeof v==='string'?v.slice(0,n):'';
const id=v=>typeof v==='string'||Number.isSafeInteger(v)?String(v):'';
const more=v=>v===true||v===1;
const count=v=>Number.isInteger(v)&&v>=0?v:null;
const fail=message=>new ReaderError(message,400);
function stamp(v,zone){try{return typeof v==='number'&&v>0?dayKey(new Date(v*1000),zone):'';}catch{return '';}}
export function thoughtLink(reviewId,returned){
 const link=safeLink(returned);
 if(link)return link;
 // Official HTTPS share page verified with a real public thought on 2026-10-04.
 // userVid is never turned into a profile URL or a fabricated weread:// route.
 return /^[A-Za-z0-9_-]{1,200}$/.test(reviewId)?`https://weread.qq.com/review-detail?reviewid=${encodeURIComponent(reviewId)}`:null;
}
function normalize(row,source,zone,scope){
 const wrapper=source==='review'?row?.review:row;
 const r=wrapper?.review;
 if(!r||typeof r!=='object')return null;
 const reviewId=id(wrapper.reviewId||r.reviewId),a=r.author||{},userVid=id(a.userVid);
 // Missing authors cannot be presented as people. Never use bestbookmarks.userVid here.
 // Undocumented author flags such as isHide are not content-visibility signals.
 // Only use public author/content fields returned by this public-review endpoint.
 if(!reviewId||!userVid||!text(r.content,800).trim())return null;
 if(r.bookId&&String(r.bookId)!==scope.bookId)return null;
 if(scope.range){
  if(r.chapterUid!==undefined&&r.chapterUid!==scope.chapterUid)return null;
  if(r.range){const [a,b]=String(r.range).split('-').map(Number),[c,d]=scope.range.split('-').map(Number);if(![a,b,c,d].every(Number.isFinite)||Math.min(b,d)<=Math.max(a,c))return null;}
 }
 const candidate={reviewId,userVid,name:text(a.name||a.nick,100)||'未提供昵称',
  content:text(r.content,800),quote:text(r.abstract||scope.quote,240),truncated:r.content.length>800||(r.abstract||scope.quote||'').length>240,
  likes:count(wrapper.likesCount)??count(r.likesCount),date:stamp(r.createTime,zone),
  chapterUid:Number.isInteger(r.chapterUid)?r.chapterUid:(scope.chapterUid??null),range:text(r.range||scope.range,80),
  source,url:thoughtLink(reviewId,wrapper.deepLink||r.deepLink)};
 const parsed=readerSessionSchema.shape.candidates.element.safeParse(candidate);
 return parsed.success?parsed.data:null;
}
const keyFor=q=>createHash('sha256').update(JSON.stringify(q)).digest('hex').slice(0,20);
const fresh=s=>Date.now()-Date.parse(s.fetchedAt)>=0&&Date.now()-Date.parse(s.fetchedAt)<CACHE_MS;

export function readerView(session,view='popular'){
 if(!['popular','resonance','perspective'].includes(view))throw fail('读友视角仅支持 popular、resonance 或 perspective。');
 const seen=new Set();
 if(view==='popular')return [...session.candidates].filter(c=>c.likes!==null).sort((a,b)=>b.likes-a.likes||a.reviewId.localeCompare(b.reviewId)).filter(c=>{if(seen.has(c.userVid))return false;seen.add(c.userVid);return true;}).slice(0,5).map(c=>({...c,
  reason:`这条${c.source==='thought'?'想法':'书评'}获得 ${c.likes} 个赞，位于本次已获取且有点赞数据的内容前列。`,
  connection:session.query.question?'是否回应你的问题，需要结合原文判断。':session.query.range?'围绕你选定或与之重叠的原文展开，请结合卡片原文判断。':'来自这本书的公开讨论，可从具体观点继续了解作者。',
  evidence:'',origin:'data'}));
 return session.picks[view].flatMap(p=>{const c=session.candidates.find(c=>c.reviewId===p.reviewId);if(!c||seen.has(c.userVid))return [];seen.add(c.userVid);return [{...c,...p,origin:'ai'}];});
}
function saveSession(mode,session){updateProfile(mode,p=>{p.readerDiscoveries=[session,...(p.readerDiscoveries||[]).filter(s=>s.id!==session.id)].slice(0,10);});}
export async function searchReaderBooks(keyword){
 keyword=z.string().trim().min(1).max(200).parse(keyword);
 const raw=await gatewayCall('/store/search',{keyword,scope:10});
 if(!Array.isArray(raw.results))throw new ReaderError('找书结果格式不完整，请稍后再试。',502);
 const books=[],seen=new Set();
 for(const g of raw.results)for(const row of Array.isArray(g.books)?g.books:[]){const b=row.bookInfo||{};const bookId=id(b.bookId);if(!bookId||seen.has(bookId))continue;seen.add(bookId);books.push({bookId,title:text(b.title,1000),author:text(b.author,1000),rating:finite(row.newRating),deepLink:safeLink(b.deepLink)});if(books.length===15)return {books,limited:true};}
 return {books,limited:more(raw.hasMore)};
}
export async function readerHighlights(bookId){
 bookId=readerQuerySchema.parse({bookId}).bookId;
 const raw=await gatewayCall('/book/bestbookmarks',{bookId,chapterUid:0});
 if(!Array.isArray(raw.items))throw new ReaderError('热门划线结果格式不完整，请稍后再试。',502);
 return {bookId,limited:true,total:count(raw.totalCount),highlights:raw.items.slice(0,20).filter(h=>Number.isInteger(h.chapterUid)&&typeof h.range==='string'&&/^\d+-\d+$/.test(h.range)).map(h=>({chapterUid:h.chapterUid,range:h.range,quote:text(h.markText,600),readers:count(h.totalCount)})),note:'平台最多返回 20 条热门划线；划线人数不是想法点赞数。'};
}
export async function discoverReaders(input,{refresh=false,mode='live'}={}){
 const query=readerQuerySchema.parse(input),key=keyFor(query),identity=accountId(),credential=getKey();
 const profile=readProfile(mode),previous=(profile.readerDiscoveries||[]).find(s=>s.id===key);
 if(mode==='demo'){
  const session=demoReaders(query,key);saveSession(mode,session);return {session,cached:false};
 }
 if(previous&&!refresh&&fresh(previous))return {session:previous,cached:true};
 const unlock=acquireSyncLease(identity);
 let requests=0;const call=async(api,params)=>{requests++;return gatewayCall(api,params,credential);};
 try{
  let title=profile.snapshot?.books.find(b=>b.id===query.bookId)?.title;
  if(!title){const info=await call('/book/info',{bookId:query.bookId});if(!info.title)throw new ReaderError('未找到有效书籍信息，请先确认书籍。',404);title=text(info.title,1000);}
  const candidates=new Map(),warnings=[];let limited=!query.range;
  const add=(rows,source,scope)=>{for(const row of rows){const c=normalize(row,source,profile.settings.timeZone,scope);if(c&&!candidates.has(c.reviewId))candidates.set(c.reviewId,c);}};
  const passages=query.range?[{chapterUid:query.chapterUid,range:query.range}]:[];
  if(!query.range){
   const raw=await call('/book/bestbookmarks',{bookId:query.bookId,chapterUid:0});
   if(!Array.isArray(raw.items))throw new ReaderError('热门划线结果格式不完整，旧发现记录已保留。',502);
   const seen=new Set();for(const h of raw.items){const k=h.chapterUid+':'+h.range;
    if(!Number.isInteger(h.chapterUid)||typeof h.range!=='string'||!/^\d+-\d+$/.test(h.range)||seen.has(k))continue;
    seen.add(k);passages.push({chapterUid:h.chapterUid,range:h.range,quote:text(h.markText,240)});if(passages.length===HIGHLIGHTS)break;}
  }
  for(const passage of passages){
   let maxIdx=0;
   for(let page=0;page<PAGES;page++){
    // Full pages need maxIdx and the default synckey=0. Passing a returned delta
    // synckey here yielded empty pages in the 2026-10-04 live API probe.
    const raw=await call('/book/readreviews',{bookId:query.bookId,chapterUid:passage.chapterUid,reviews:[{range:passage.range,count:COUNT,maxIdx}]});
    const result=Array.isArray(raw.reviews)?raw.reviews.find(r=>r.range===passage.range):null;
    if(!result||!Array.isArray(result.pageReviews))throw new ReaderError('段落想法结果格式不完整，旧发现记录已保留。',502);
    add(result.pageReviews,'thought',{...passage,bookId:query.bookId});
    if(!more(result.hasMore))break;
    limited=true;
    if(!Number.isInteger(result.maxIdx)||result.maxIdx<=maxIdx||!result.pageReviews.length){warnings.push('段落想法分页未继续，当前只展示已取得的内容。');break;}
    maxIdx=result.maxIdx;
   }
  }
  if(!query.range){
   let maxIdx=0,synckey=0;
   for(let page=0;page<PAGES;page++){
    const raw=await call('/review/list',{bookId:query.bookId,reviewListType:0,count:COUNT,maxIdx,synckey});
    if(!Array.isArray(raw.reviews))throw new ReaderError('公开书评结果格式不完整，旧发现记录已保留。',502);
    add(raw.reviews,'review',{bookId:query.bookId});
    if(!more(raw.reviewsHasMore))break;
    const idx=raw.reviews.at(-1)?.idx;
    if(!Number.isInteger(idx)||idx<=maxIdx){warnings.push('公开书评分页未继续，当前只展示已取得的内容。');break;}
    maxIdx=idx;synckey=raw.synckey??0;
   }
  }
  if(identity!==accountId())throw new ReaderError('连接已更改，请重新查找读友。',409);
  const rows=[...candidates.values()].slice(0,120);
  const session=readerSessionSchema.parse({id:key,query,title,fetchedAt:new Date().toISOString(),candidates:rows,
   coverage:{requests,sampled:rows.length,missingLikes:rows.filter(c=>c.likes===null).length,scope:query.range?'passage':'book-sample',limited,warnings:[...new Set(warnings)].slice(0,10)},
   picks:{resonance:[],perspective:[]},curatedAt:null,demo:false});
  saveSession(mode,session);return {session,cached:false};
 }finally{unlock();}
}
export function curateReaders(input,mode='live'){
 const value=z.object({sessionId:z.string(),fetchedAt:z.string().datetime(),view:z.enum(['resonance','perspective']),picks:z.array(readerPickSchema).max(5)}).parse(input);
 let result;
 updateProfile(mode,p=>{
  const session=p.readerDiscoveries.find(s=>s.id===value.sessionId);
  if(!session)throw new ReaderError('发现记录不存在，请先查找读友。',404);
  if(session.fetchedAt!==value.fetchedAt)throw new ReaderError('发现记录已更新，请按最新内容重新整理。',409);
  if(value.view==='resonance'&&!session.query.question)throw fail('同频观点需要用户明确关心的问题，请带 --question 重新查找。');
  const seen=new Set();
  for(const pick of value.picks){
   const c=session.candidates.find(c=>c.reviewId===pick.reviewId);
   if(!c||seen.has(c.userVid))throw fail('推荐项必须来自本次发现，且每位作者只出现一次。');
   if(!c.content.includes(pick.evidence))throw fail('推荐依据必须是该条想法中实际存在的连续短摘录。');
   seen.add(c.userVid);
  }
  session.picks[value.view]=value.picks;session.curatedAt=new Date().toISOString();result=session;
 });return result;
}
export function demoReaders(query={bookId:'demo-mountain',question:'怎样把慢阅读融入忙碌生活？'},key=keyFor(query)){
 const content=['我把慢阅读安排在晚饭后的十分钟。先不追求读完，只记一个今天能用上的问题。','慢不一定意味着更投入。带着问题快速读一遍，再回到重要章节，也可以让理解更深。','读完这章，我开始在通勤时回想书里的问题，晚上再写两句话。阅读逐渐和生活连在了一起。'];
 return readerSessionSchema.parse({id:key,query,title:'山间来信（虚构示例）',fetchedAt:new Date().toISOString(),
  candidates:content.map((c,i)=>({reviewId:'demo-thought-'+i,userVid:'demo-reader-'+i,name:['山间读者','翻页的人','晚风'][i]+'（示例）',content:c,quote:'时间从不匆忙，匆忙的是我们。',truncated:false,likes:[42,27,null][i],date:'2026-10-05',chapterUid:query.chapterUid??1,range:query.range||'0-18',source:'thought',url:null})),
  coverage:{requests:0,sampled:3,missingLikes:1,scope:query.range?'passage':'book-sample',limited:true,warnings:[]},
  picks:{resonance:query.question?[{reviewId:'demo-thought-0',reason:'用十分钟的小实践，把慢阅读放进日常。',connection:'回应了如何在忙碌生活中留出阅读时间。',evidence:'我把慢阅读安排在晚饭后的十分钟'}]:[],perspective:[{reviewId:'demo-thought-1',reason:'提醒我们阅读速度与投入程度并不相同。',connection:'提供先快读、再回看的另一种做法。',evidence:'慢不一定意味着更投入'}]},curatedAt:new Date().toISOString(),demo:true});
}
