import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {join, resolve} from 'node:path';

const root=resolve('.');
const out=join(root,'dist','expert','reading-buddy-expert');

test('build produces a standalone reading buddy expert with its local Skill',()=>{
  const built=spawnSync(process.execPath,['scripts/build-expert.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(built.status,0,built.stderr);
  for(const file of [
    '.codebuddy-plugin/plugin.json',
    'agents/reading-buddy-expert.md',
    'avatars/reading-buddy.png',
    'skills/reading-buddy/SKILL.md',
    'skills/reading-buddy/scripts/reading-buddy.mjs'
  ])assert.ok(existsSync(join(out,file)),'缺少 '+file);
  const manifest=JSON.parse(readFileSync(join(out,'.codebuddy-plugin','plugin.json'),'utf8'));
  assert.equal(manifest.name,'reading-buddy-expert');
  assert.equal(manifest.expertType,'agent');
  assert.equal(manifest.version,'0.9.0');
  assert.equal(manifest.agentName,'reading-buddy-expert');
  assert.deepEqual(manifest.skills,['./skills/reading-buddy']);
  assert.equal(manifest.categoryId,'15-Education');
  assert.equal(manifest.plugin,manifest.name);
  assert.equal(manifest.quickPrompts.length,3);
  assert.deepEqual(manifest.defaultInitPrompt,manifest.quickPrompts[0]);
  assert.deepEqual(manifest.quickPrompts[0],{
    zh:'帮我整理一本书的笔记，生成一张读书卡片',
    en:"Organize one book's notes into a reading card"
  });
  assert.deepEqual(manifest.quickPrompts[1],{
    zh:'帮我生成本地阅读工作台',
    en:'Generate my local reading workspace'
  });
  assert.deepEqual(manifest.tags.map(tag=>tag.zh),['阅读工作台','阅读复盘','共读书签']);
  const chinese=(manifest.displayDescription.zh.match(/[\u3400-\u9fff]/gu)||[]).length;
  assert.ok(chinese>=40&&chinese<=50,'中文市场简介须为 40—50 字');
  assert.ok(statSync(join(out,'avatars','reading-buddy.png')).size<=500*1024);
  const agent=readFileSync(join(out,'agents','reading-buddy-expert.md'),'utf8');
  assert.match(agent,/auth import/);
  assert.match(agent,/不依赖 Buddy 应用 OAuth/);
  assert.doesNotMatch(agent,/reading_prepare_card|reading_save_card/);
});

test('expert candidate archive is complete and does not contain a credential fixture',()=>{
  const packed=spawnSync(process.execPath,['scripts/package-expert.mjs'],{cwd:root,encoding:'utf8'});
  assert.equal(packed.status,0,packed.stderr);
  const zip=join(root,'dist','expert','reading-buddy-expert-0.9.0.zip');
  assert.ok(existsSync(zip));
  const listed=spawnSync('unzip',['-Z1',zip],{encoding:'utf8'});
  assert.equal(listed.status,0,listed.stderr);
  for(const name of ['reading-buddy-expert/.codebuddy-plugin/plugin.json','reading-buddy-expert/agents/reading-buddy-expert.md','reading-buddy-expert/skills/reading-buddy/scripts/reading-buddy.mjs'])assert.match(listed.stdout,new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(listed.stdout,/node_modules|workbuddy\//);
});

test('packaged book review exports the approved Markdown offline and preserves existing files',()=>{
  const dir=mkdtempSync(join(tmpdir(),'reading-review-'));
  const zip=join(root,'dist/expert/reading-buddy-expert-0.9.0.zip');
  const unpack=spawnSync('unzip',['-q',zip,'-d',dir],{encoding:'utf8'});
  assert.equal(unpack.status,0,unpack.stderr);
  const bin=join(dir,'reading-buddy-expert/skills/reading-buddy/scripts/reading-buddy.mjs');
  const inputFile=join(dir,'selection.json'), target=join(dir,'reading','桥边.md');
  const env={...process.env,READING_DATA_DIR:join(dir,'data'),READING_CONFIG_DIR:join(dir,'config'),
    WEREAD_API_KEY:'',READING_OFFLINE_GUARD:'1',NODE_OPTIONS:'--import='+pathToFileURL(join(root,'tests/offline-guard.mjs')).href};
  const selection={title:'桥边',pasted:[{chapter:'第一章',quote:'她在桥头停了下来。',thought:'我喜欢她停下来的那一刻。'}]};
  const options=[{claim:'一个停顿改变了叙事节奏',support:[
    {source:'S1',field:'thought',exact:'我喜欢她停下来的那一刻。'}
  ],counter:null,gap:'还需要一处动作描写作为对照。'}];
  function run(input,output) {
    writeFileSync(inputFile,JSON.stringify({selection,...input}));
    return spawnSync(process.execPath,[bin,'book-review','--input',inputFile,...(output?['--output',output]:[])],
      {cwd:dir,env,encoding:'utf8'});
  }
  const plan=run({options});
  assert.equal(plan.status,0,plan.stderr);
  assert.equal(run({options},target).status,2);
  assert.ok(!existsSync(target));
  const input={options,planId:JSON.parse(plan.stdout).planId,choice:1,draft:{
    title:'桥边的停顿',paragraphs:[[{text:'我在笔记里写过：'},{cite:1,verbatim:true}]]
  }};
  const preview=run(input);
  assert.equal(preview.status,0,preview.stderr);
  const output=run(input,target);
  assert.equal(output.status,0,output.stderr);
  assert.equal(JSON.parse(output.stdout).path,target);
  const markdown=readFileSync(target,'utf8');
  assert.equal(markdown,JSON.parse(preview.stdout).markdown);
  assert.match(markdown,/“我喜欢她停下来的那一刻。”\[\^1\]/);
  assert.match(markdown,/第一章 · 手工笔记 1 · 我的想法/);
  assert.equal(statSync(target).mode&0o777,0o600);
  assert.equal(run(input,target).status,0);
  writeFileSync(target,'读者的修订稿');
  assert.equal(run(input,target).status,2);
  assert.equal(readFileSync(target,'utf8'),'读者的修订稿');
});
