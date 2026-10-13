import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
process.env.READING_AUTH_MODE='skill';
process.env.READING_DATA_DIR=mkdtempSync(join(tmpdir(),'reading-optimization-data-'));
process.env.READING_CONFIG_DIR=mkdtempSync(join(tmpdir(),'reading-optimization-auth-'));
let counter=0;
const storage=await import('../server/storage.mjs');
const domain=await import('../server/domain.mjs');
const api=await import('../server/service.mjs');
const weread=await import('../server/weread.mjs');
const {runCli}=await import('../server/cli.mjs');
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
function fixture(){process.env.WEREAD_API_KEY='wrk-OptimizationFixture'+(++counter);const p=domain.demoProfile();p.mode='live';p.snapshot.books[0].id='book';p.settings.primaryBookId='book';p.snapshot.notes=p.snapshot.notes.map((n,i)=>({...n,id:'h-'+i,bookId:'book',date:domain.dayKey()}));storage.saveProfile('live',p);return p;}
async function cli(args,extras={}){let stdout='',stderr='';const code=await runCli(args,{stdout:t=>stdout=t,stderr:t=>stderr=t,...extras});return {code,json:stdout?JSON.parse(stdout):null,error:stderr?JSON.parse(stderr).error:null};}

test('partial refresh preserves old notes and resumes until complete before reconciling removals',async()=>{
 fixture();let round=0;
 globalThis.fetch=async(_url,options)=>{const req=JSON.parse(options.body);if(req.api_name==='/book/bookmarklist')return response({updated:[],chapters:[]});
  if(round===0)return response({reviews:[{reviewId:'new1',content:'first new thought',createTime:Date.now()/1000}],hasMore:true,synckey:'cursor-a'});
  assert.equal(req.synckey,'cursor-a');return response({reviews:[{reviewId:'new2',content:'second new thought',createTime:Date.now()/1000}],hasMore:false,synckey:'cursor-b'});
 };
 const partial=await weread.fetchBookNotes('book');assert.equal(partial.complete,false);assert.equal(partial.reason,'cursor-stalled');
 assert.ok(storage.readProfile().snapshot.notes.some(n=>n.id==='h-0'),'cached older notes survive partial refresh');
 assert.equal(storage.readProfile().snapshot.books[0].notesSync.complete,false);
 round=1;const complete=await weread.fetchBookNotes('book');assert.equal(complete.resumed,true);assert.equal(complete.complete,true);
 assert.deepEqual(storage.readProfile().snapshot.notes.map(n=>n.id).sort(),['t-new1','t-new2']);
 assert.ok(storage.readProfile().snapshot.books[0].notesSync.lastCompleteAt);
});

test('50-page boundary retains cache and persists a resume cursor',async()=>{
 fixture();let end=false;globalThis.fetch=async(_url,options)=>{const req=JSON.parse(options.body);if(req.api_name==='/book/bookmarklist')return response({updated:[],chapters:[]});const page=Number(req.synckey||0);return response({reviews:[{reviewId:'page'+page,content:'thought'+page,createTime:Date.now()/1000}],hasMore:!end,synckey:page+1});};
 const first=await weread.fetchBookNotes('book');assert.equal(first.pages,50);assert.equal(first.complete,false);assert.equal(storage.readProfile().snapshot.books[0].notesSync.cursor,50);assert.ok(storage.readProfile().snapshot.notes.some(n=>n.id==='h-0'));
 end=true;await weread.fetchBookNotes('book');const p=storage.readProfile();assert.equal(p.snapshot.notes.length,51);assert.equal(p.snapshot.books[0].notesSync.complete,true);
});

test('failure while paging leaves the previous profile intact',async()=>{
 const p=fixture();globalThis.fetch=async(_url,options)=>{const req=JSON.parse(options.body);if(req.api_name==='/book/bookmarklist')return response({updated:[],chapters:[]});if(req.synckey)throw Error('synthetic outage');return response({reviews:[{reviewId:'new',content:'partial new'}],hasMore:true,synckey:'next'});};
 await assert.rejects(weread.fetchBookNotes('book'));assert.deepEqual(storage.readProfile().snapshot.notes,p.snapshot.notes);
});

test('review is statistics-only by default and only selected in-period notes expose body',async()=>{
 const p=fixture();p.snapshot.notes[0].quote='SELECTED_SYNTHETIC';p.snapshot.notes[1].quote='UNSELECTED_SYNTHETIC';storage.saveProfile('live',p);
 const summary=await cli(['review','--period','weekly']);assert.equal(summary.code,0);assert.equal(summary.json.scope,'statistics-only');assert.deepEqual(summary.json.noteIds,[]);assert.ok(!JSON.stringify(summary.json).includes('UNSELECTED_SYNTHETIC'));assert.ok(summary.json.noteCatalog.length);
 const selected=await cli(['review','--period','weekly','--note-ids','h-0']);assert.ok(selected.json.body.includes('SELECTED_SYNTHETIC'));assert.ok(!selected.json.body.includes('UNSELECTED_SYNTHETIC'));assert.deepEqual(selected.json.noteIds,['h-0']);
 assert.equal((await cli(['review','--note-ids','missing'])).code,2);
 p.snapshot.notes[0].date='2000-01-01';storage.saveProfile('live',p);assert.equal((await cli(['review','--note-ids','h-0'])).code,2);
});

test('note catalog omits body and excerpts bound model text without mutating originals',async()=>{
 const p=fixture();p.snapshot.notes=Array.from({length:30},(_,i)=>({...p.snapshot.notes[0],id:'long-'+i,quote:'Q'.repeat(30000),thought:'T'.repeat(30000)}));storage.saveProfile('live',p);
 const catalog=await cli(['notes','book','--list','--limit','30']);assert.ok(catalog.json.notes.every(n=>n.quote===undefined&&n.thought===undefined));
 const excerpt=await cli(['notes','book','--limit','30']);assert.equal(excerpt.json.truncated,true);assert.ok(excerpt.json.notes.reduce((s,n)=>s+n.quote.length+n.thought.length,0)<=12000);
 const draft=await cli(['draft','--notes',p.snapshot.notes.slice(0,20).map(n=>n.id).join(',')]);assert.equal(draft.json.truncated,true);assert.ok(draft.json.body.length<17000);assert.equal(storage.readProfile().snapshot.notes[0].quote.length,30000);
});

test('basic sync makes only four calls, if-stale reuses cache and details are fetched for one book',async()=>{
 fixture();const calls=[];globalThis.fetch=async(_url,options)=>{const req=JSON.parse(options.body);calls.push(req.api_name);if(req.api_name==='/shelf/sync')return response({books:[{bookId:'book',title:'Synthetic',author:'A'}]});if(req.api_name==='/user/notebooks')return response({books:[],totalBookCount:1,totalNoteCount:3});if(req.api_name==='/book/getprogress')return response({book:{progress:42}});return response({totalReadTime:1200,readDays:1,readTimes:{}});};
 const first=await cli(['sync']);assert.equal(first.code,0);assert.equal(calls.length,4);assert.ok(!calls.includes('/review/list/mine'));
 const second=await cli(['sync','--if-stale']);assert.equal(second.json.cached,true);assert.equal(calls.length,4);
 await cli(['book','book']);assert.equal(calls.length,6);await cli(['book','book']);assert.equal(calls.length,6);await cli(['book','book','--refresh']);assert.equal(calls.length,8);
});

test('operation lease prevents another process from starting sync and recovers after owner exits',async()=>{
 fixture();const child=spawn(process.execPath,['--input-type=module','-e',"const s=await import('./server/storage.mjs');s.acquireSyncLease();console.log('ready');setInterval(()=>{},1000);"],{cwd:resolve('.'),env:{...process.env},stdio:['ignore','pipe','pipe']});
 try{await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('lease child exited '+code)));});
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected network');};await weread.syncAll();assert.equal(weread.syncStatus.errorStatus,409);assert.equal(calls,0);
 }finally{await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}
 const unlock=storage.acquireSyncLease();unlock();
});

test('429 cooldown persists across processes and carries an explicit next retry time',async()=>{
 fixture();globalThis.fetch=async()=>({...response({},429),headers:{get:()=> '60'}});
 await assert.rejects(weread.gatewayCall('/test'),e=>e.status===429&&!!e.retryAt);
 const child=spawnSync(process.execPath,['--input-type=module','-e',"const w=await import('./server/weread.mjs');let calls=0;globalThis.fetch=async()=>{calls++;};try{await w.gatewayCall('/test')}catch(e){console.log(JSON.stringify({status:e.status,retryAt:e.retryAt,calls}))}"],{cwd:resolve('.'),env:{...process.env},encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);assert.equal(result.status,429);assert.equal(result.calls,0);assert.ok(Date.parse(result.retryAt)>Date.now());
});

test('key rotation exposes a recovery directory without merging until explicit backup import',async()=>{
 fixture();const now=new Date().toISOString();storage.updateProfile('live',p=>p.cards.push({id:'historic',title:'Old',body:'HISTORY_SYNTHETIC',createdAt:now,updatedAt:now,kind:'card',origin:'local',noteIds:[]}));const old=storage.accountId(),oldPath=storage.profileFile('live');
 process.env.WEREAD_API_KEY='wrk-NewRotatedFixture'+counter;assert.equal(storage.readProfile().cards.length,0);
 const history=await cli(['auth','history']);assert.ok(history.json.profiles.some(p=>p.account===old&&p.cards===1));assert.ok(!JSON.stringify(history.json).includes('HISTORY_SYNTHETIC'));
 const blocked=await cli(['report',oldPath]);assert.equal(blocked.code,2);
 const backup=join(process.env.READING_DATA_DIR,'history-backup.json');assert.equal((await cli(['auth','export-history',old,backup])).code,0);assert.equal(storage.readProfile().cards.length,0);assert.ok(existsSync(oldPath));
 assert.equal(statSync(backup).mode&0o777,0o600);assert.equal((await cli(['backup','import',backup])).code,0);assert.equal(storage.readProfile().cards[0].id,'historic');assert.ok(!readFileSync(backup,'utf8').includes('wrk-'));
});

test('doctor and demo workspace work offline, report opening is opt-in, paths stay private',async()=>{
 fixture();delete process.env.WEREAD_API_KEY;globalThis.fetch=async()=>{throw Error('unexpected network');};
 const doctor=await cli(['doctor']);assert.equal(doctor.json.state,'needs-auth');assert.equal(doctor.json.authorizationVerified,false);
 assert.equal((await cli(['workspace'])).code,3);
 let opened=0;const work=await cli(['workspace','--mode','demo','--open'],{openFile:async file=>{opened++;assert.ok(existsSync(file));return true;}});assert.equal(work.code,0);assert.equal(work.json.opened,true);assert.equal(opened,1);assert.equal(statSync(work.json.path).mode&0o777,0o600);assert.ok(readFileSync(work.json.path,'utf8').includes('只读快照'));
 const plain=await cli(['workspace','--mode','demo']);assert.equal(plain.json.opened,false);assert.equal(opened,1);
});

test('malformed successful gateway response cannot erase prior notes',async()=>{
 const p=fixture();globalThis.fetch=async()=>response({});await assert.rejects(weread.fetchBookNotes('book'),e=>e.status===502);assert.deepEqual(storage.readProfile().snapshot.notes,p.snapshot.notes);
});

test('failed workspace update still delivers a clearly labelled old snapshot',async()=>{
 fixture();globalThis.fetch=async()=>response({},401);
 const work=await cli(['workspace','--sync','--force']);assert.equal(work.code,0);assert.ok(work.json.syncError);assert.ok(readFileSync(work.json.path,'utf8').includes('本次更新未完成，显示已有快照'));
 const before=storage.readProfile();let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected');};
 const blocked=await cli(['workspace',storage.profileFile('live'),'--sync']);assert.equal(blocked.code,2);assert.equal(calls,0);assert.deepEqual(storage.readProfile(),before);
});
