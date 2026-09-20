import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
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
  assert.equal(manifest.agentName,'reading-buddy-expert');
  assert.deepEqual(manifest.skills,['./skills/reading-buddy']);
  assert.equal(manifest.categoryId,'15-Education');
  assert.equal(manifest.plugin,manifest.name);
  assert.equal(manifest.quickPrompts.length,3);
  assert.deepEqual(manifest.defaultInitPrompt,manifest.quickPrompts[0]);
  assert.equal(manifest.tags.length,3);
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
  const zip=join(root,'dist','expert','reading-buddy-expert-0.3.0.zip');
  assert.ok(existsSync(zip));
  const listed=spawnSync('unzip',['-Z1',zip],{encoding:'utf8'});
  assert.equal(listed.status,0,listed.stderr);
  for(const name of ['reading-buddy-expert/.codebuddy-plugin/plugin.json','reading-buddy-expert/agents/reading-buddy-expert.md','reading-buddy-expert/skills/reading-buddy/scripts/reading-buddy.mjs'])assert.match(listed.stdout,new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(listed.stdout,/node_modules|workbuddy\//);
});
