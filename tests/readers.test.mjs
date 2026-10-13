import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

process.env.READING_AUTH_MODE='skill';
process.env.READING_DATA_DIR=mkdtempSync(join(tmpdir(),'reading-social-data-'));
process.env.READING_CONFIG_DIR=mkdtempSync(join(tmpdir(),'reading-social-auth-'));
const store=await import('../server/storage.mjs');
const domain=await import('../server/domain.mjs');
const readers=await import('../server/readers.mjs');
const {runCli}=await import('../server/cli.mjs');
let n=0;
function fixture(){process.env.WEREAD_API_KEY='wrk-ReadersFixture'+(++n);store.saveProfile('live',domain.newProfile());}
const response=d=>({ok:true,status:200,json:async()=>d});
const thought=(vid,likes,extra={})=>({reviewId:vid+'_thought',...(likes===null?{}:{likesCount:likes}),review:{bookId:'book',content:'认真读原文以后，我愿意从具体问题出发重新理解。',abstract:'原文',author:{userVid:vid,name:'读友'+vid},createTime:1770000000,...extra}});
async function cli(args){let out='',err='';const code=await runCli(args,{stdout:t=>out=t,stderr:t=>err=t});return {code,json:out?JSON.parse(out):null,error:err?JSON.parse(err):null};}
function passageMock(rows){const calls=[];globalThis.fetch=async(_u,o)=>{const q=JSON.parse(o.body);calls.push(q);if(q.api_name==='/book/info')return response({title:'书'});return response({reviews:[{range:'10-20',pageReviews:rows,hasMore:0,maxIdx:20}]});};return calls;}

test('passage discovery uses actual authors, nullable likes and review share links; has no author promotion',async()=>{
 fixture();const duplicate={...thought(1,100),reviewId:'1_second'};
 const calls=passageMock([thought(1,12),thought(2,null),duplicate,thought(3,0),thought(4,50,{author:{name:'anonymous'}}),thought(5,60,{author:{userVid:5,name:'hidden',isHide:1}})]);
 const result=await cli(['readers','book','--chapter-uid','2','--range','10-20']);assert.equal(result.code,0,JSON.stringify(result.error));
 assert.equal(result.json.authorRecommendation,undefined);
 assert.deepEqual(result.json.readers.map(r=>r.userVid),['1','5','3']);assert.equal(result.json.readers[0].likes,100);
 assert.match(result.json.readers[0].url,/review-detail\?reviewid=1_second$/);
 assert.equal(result.json.coverage.missingLikes,1);assert.equal(result.json.coverage.sampled,5);
 assert.equal(calls.length,2);assert.equal(calls[1].reviews[0].synckey,undefined);
 assert.ok(calls.every(c=>!JSON.stringify(c).includes('question')));
 assert.equal(statSync(store.profileFile('live')).mode&0o777,0o600);
 assert.ok(!readFileSync(store.profileFile('live'),'utf8').includes('wrk-'));
});

test('discovery reuses identical recent query, refreshes explicitly and isolates accounts',async()=>{
 fixture();const calls=passageMock([thought(1,5)]);const q={bookId:'book',chapterUid:2,range:'10-20',question:'具体问题'};
 await readers.discoverReaders(q);assert.equal((await readers.discoverReaders(q)).cached,true);assert.equal(calls.length,2);
 await readers.discoverReaders(q,{refresh:true});assert.equal(calls.length,4);
 fixture();assert.equal(store.readProfile().readerDiscoveries.length,0);await readers.discoverReaders(q);assert.equal(calls.length,6);
});

test('book discovery handles double review nesting, maxIdx and a bounded number of requests',async()=>{
 fixture();const calls=[];globalThis.fetch=async(_u,o)=>{const q=JSON.parse(o.body);calls.push(q);
  if(q.api_name==='/book/info')return response({title:'书'});
  if(q.api_name==='/book/bestbookmarks')return response({items:[{chapterUid:1,range:'0-10',markText:'划线',userVid:999},{chapterUid:2,range:'10-20',markText:'另一段'}]});
  if(q.api_name==='/book/readreviews'){assert.equal(q.reviews[0].synckey,undefined);return response({reviews:[{range:q.reviews[0].range,pageReviews:[thought(q.chapterUid*100+q.reviews[0].maxIdx,3)],hasMore:1,maxIdx:q.reviews[0].maxIdx+20,synckey:987}]});}
  assert.equal(q.api_name,'/review/list');if(q.maxIdx)assert.equal(q.synckey,456);
  return response({reviews:[{idx:q.maxIdx+20,review:thought(500+q.maxIdx,40)}],reviewsHasMore:1,synckey:456});
 };
 const {session}=await readers.discoverReaders({bookId:'book'});assert.equal(calls.length,8);assert.equal(session.candidates.length,6);assert.equal(session.coverage.limited,true);
 assert.ok(session.candidates.some(c=>c.source==='review'));assert.ok(!session.candidates.some(c=>c.userVid==='999'));
 assert.ok(!calls.some(c=>['/review/list/mine','/shelf/sync','/book/bookmarklist'].includes(c.api_name)));
});

test('network failure and server upgrade preserve the previous discovery',async()=>{
 fixture();passageMock([thought(1,5)]);const q={bookId:'book',chapterUid:2,range:'10-20'};
 await readers.discoverReaders(q);const before=store.readProfile();
 globalThis.fetch=async()=>{throw Error('offline');};await assert.rejects(readers.discoverReaders(q,{refresh:true}));assert.deepEqual(store.readProfile(),before);
 globalThis.fetch=async()=>response({upgrade_info:{message:'upgrade'}});await assert.rejects(readers.discoverReaders(q,{refresh:true}),e=>e.status===409);assert.deepEqual(store.readProfile(),before);
});

test('curation requires current source, evidence and unique authors; no inferred resonance without question',async()=>{
 fixture();passageMock([thought(1,5),{...thought(1,9),reviewId:'1_other'},thought(2,null)]);
 const {session}=await readers.discoverReaders({bookId:'book',chapterUid:2,range:'10-20',question:'如何理解？'});
 const pick={reviewId:'1_thought',reason:'提出具体问题',connection:'回应理解方法',evidence:'我愿意从具体问题出发'};
 const value={sessionId:session.id,fetchedAt:session.fetchedAt,view:'resonance',picks:[pick]};
 const saved=readers.curateReaders(value);assert.equal(readers.readerView(saved,'resonance')[0].origin,'ai');
 assert.throws(()=>readers.curateReaders({...value,picks:[{...pick,evidence:'不存在的文字'}]}));
 assert.throws(()=>readers.curateReaders({...value,picks:[pick,{...pick,reviewId:'1_other'}]}));
 assert.throws(()=>readers.curateReaders({...value,fetchedAt:'2000-01-01T00:00:00.000Z'}));
 assert.throws(()=>readers.curateReaders({...value,picks:[{...pick,reviewId:'foreign'}]}));
 const noQuestion=await readers.discoverReaders({bookId:'book',chapterUid:2,range:'10-20'});
 assert.throws(()=>readers.curateReaders({...value,sessionId:noQuestion.session.id,fetchedAt:noQuestion.session.fetchedAt}));
});

test('invalid location is rejected before network; unknown likes do not turn into high scores',async()=>{
 fixture();let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected');};
 assert.equal((await cli(['readers','book','--range','10-20'])).code,2);assert.equal((await cli(['readers','book','--chapter-uid','-1','--range','10-20'])).code,2);assert.equal(calls,0);
 assert.equal((await cli(['readers','book','--chapter-uid','1','--range','20-10'])).code,2);assert.equal(calls,0);
 passageMock([thought(1,null)]);const {session}=await readers.discoverReaders({bookId:'book',chapterUid:1,range:'10-20'});assert.deepEqual(readers.readerView(session),[]);
});

test('public thoughts returned for overlapping ranges are retained without interpreting undocumented author flags',async()=>{
 fixture();passageMock([thought(1,100,{range:'8-19',chapterUid:1,author:{userVid:1,name:'public',isHide:1}}),thought(2,500,{range:'30-40',chapterUid:1}),thought(3,600,{range:'10-20',chapterUid:2})]);
 const {session}=await readers.discoverReaders({bookId:'book',chapterUid:1,range:'10-20'});
 assert.equal(session.candidates.length,1);assert.equal(session.candidates[0].range,'8-19');assert.equal(readers.readerView(session)[0].likes,100);
});

test('legacy backup remains readable; public discovery survives backup merge with link sanitization',async()=>{
 fixture();passageMock([thought(1,5)]);await readers.discoverReaders({bookId:'book',chapterUid:1,range:'10-20'});
 const current=store.readProfile(),legacy=domain.newProfile();delete legacy.readerDiscoveries;
 assert.deepEqual(domain.validateBackup(legacy,'live').readerDiscoveries,[]);
 current.readerDiscoveries[0].candidates[0].url='javascript:alert(1)';const clean=domain.validateBackup(current,'live');assert.equal(clean.readerDiscoveries[0].candidates[0].url,null);
 assert.equal(domain.mergeBackup(domain.newProfile(),clean).readerDiscoveries.length,1);
});

test('public book search handles scope 17 and demo report is offline with no real reader links',async()=>{
 fixture();globalThis.fetch=async(_u,o)=>{assert.equal(JSON.parse(o.body).scope,10);return response({results:[{scope:17,books:[{bookInfo:{bookId:'b',title:'公开书籍',author:'作者'}}]}]});};
 assert.equal((await readers.searchReaderBooks('书')).books[0].bookId,'b');
 globalThis.fetch=async()=>{throw Error('demo must be offline');};
 const r=await cli(['readers','demo-mountain','--mode','demo']);assert.equal(r.code,0);
 const workspace=await cli(['workspace','--mode','demo']);assert.equal(workspace.code,0);const html=readFileSync(workspace.json.path,'utf8');assert.ok(!html.includes('readerAuthor'));assert.ok(!html.includes('作者推荐位')); assert.ok(html.includes('谁也在认真读这里'));assert.ok(!html.includes('review-detail?reviewid=demo'));
});

test('reader candidates are bounded and an account with only discoveries can generate workspace',async()=>{
 fixture();passageMock(Array.from({length:40},(_,i)=>thought(i+1,i,{content:'文'.repeat(3000),abstract:'引'.repeat(2000)})));
 await readers.discoverReaders({bookId:'book',chapterUid:1,range:'10-20'});
 const listed=await cli(['readers-list']);assert.equal(listed.json.candidates.length,20);assert.ok(listed.json.candidates.every(c=>c.content.length<=500&&c.quote.length<=100));assert.equal(listed.json.nextOffset,20);
 const work=await cli(['workspace']);assert.equal(work.code,0,JSON.stringify(work.error));assert.equal(work.json.snapshotAvailable,false);
 const file=join(process.env.READING_DATA_DIR,'curate.json');writeFileSync(file,JSON.stringify({sessionId:listed.json.sessionId,fetchedAt:listed.json.fetchedAt,view:'perspective',picks:[]}));assert.equal((await cli(['readers-curate','--input',file])).code,0);
});
