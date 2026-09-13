import test from 'node:test';import assert from 'node:assert/strict';import {startApp} from './helpers.mjs';
test('HTTP journey: isolation, protection, persistence, export/import and restored cards',async()=>{
 let app=await startApp();try{
  const live=await app.api('state?mode=live');assert.equal(live.data.snapshot,null);assert.equal(live.data.connection.connected,false);
  assert.equal((await app.api('settings',{goal:30,timeZone:'Asia/Shanghai',primaryBookId:null},{headers:{'X-Reading-Token':'bad'}})).status,403);
  assert.equal((await app.api('state',null,{headers:{Origin:'https://untrusted.test'}})).status,403);
  const original=(await app.api('state')).data;assert.equal(original.snapshot.books[0].title,'山间来信');
  assert.equal((await app.api('settings',{...original.settings,goal:45})).status,200);
  assert.equal((await app.api('reflection',{noteId:'demo-note-0',text:'给日常留一点余地。'})).status,200);
  const draft=await app.api('draft',{noteIds:['demo-note-0'],reflection:'给日常留一点余地。'});assert.match(draft.data.body,/给日常留一点余地/);
  const saved=await app.api('cards',{title:'测试卡片',body:draft.data.body,kind:'card',noteIds:['demo-note-0']});assert.equal(saved.status,200);
  const download=await fetch(app.url+'/api/card-file?mode=demo&id='+saved.data.id);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);assert.equal(await download.text(),draft.data.body);
  const weekly=await app.api('review',{period:'weekly'});assert.match(weekly.data.body,/未使用AI改写/);
  const backup=(await app.api('export')).data;assert.equal(JSON.stringify(backup).includes('csrf'),false);assert.equal(JSON.stringify(backup).includes('WEREAD_API_KEY'),false);
  assert.equal((await app.api('import',{...backup,mode:'live'})).status,400);
  await app.api('import',backup);await app.api('import',backup);assert.equal((await app.api('state')).data.cards.length,1);
  assert.equal((await app.api('state?mode=live')).data.cards.length,0);
  const dir=app.dir;await app.stop();app=await startApp(dir);const restored=(await app.api('state')).data;assert.equal(restored.settings.goal,45);assert.equal(restored.reflections[0].text,'给日常留一点余地。');assert.equal(restored.cards[0].id,saved.data.id);
 }finally{await app.stop();}
});
