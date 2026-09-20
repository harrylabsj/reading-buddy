import {cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=resolve('.');
const source=join(root,'experts','reading-buddy-expert');
const skill=join(root,'dist','skill','reading-buddy');
const out=join(root,'dist','expert','reading-buddy-expert');

if(!existsSync(source))throw Error('找不到读书搭子专家源码。');
await import(pathToFileURL(join(root,'scripts','build-skill.mjs')).href);
rmSync(out,{recursive:true,force:true});
mkdirSync(out,{recursive:true});
cpSync(source,out,{recursive:true});
cpSync(skill,join(out,'skills','reading-buddy'),{recursive:true});

const required=[
  '.codebuddy-plugin/plugin.json',
  'agents/reading-buddy-expert.md',
  'avatars/reading-buddy.png',
  'skills/reading-buddy/SKILL.md',
  'skills/reading-buddy/scripts/reading-buddy.mjs'
];
for(const file of required){
  const path=join(out,file);
  if(!existsSync(path))throw Error(`专家包缺少 ${file}`);
  if(lstatSync(path).isSymbolicLink())throw Error(`专家包不允许符号链接：${file}`);
}

const avatar=statSync(join(out,'avatars','reading-buddy.png'));
if(avatar.size>500*1024)throw Error('专家头像超过 500KB。');
const files=[];
function walk(dir){for(const name of readdirSync(dir)){const path=join(dir,name);const stat=lstatSync(path);if(stat.isSymbolicLink())throw Error(`专家包不允许符号链接：${relative(out,path)}`);if(stat.isDirectory())walk(path);else files.push(path);}}
walk(out);
for(const file of files){
  if(/\.(mjs|md|json)$/u.test(file)){
    const text=readFileSync(file,'utf8');
    if(/wrk-[A-Za-z0-9_-]{8,}/.test(text))throw Error(`专家包疑似包含凭证：${relative(out,file)}`);
    if(text.includes(root))throw Error(`专家包包含本机绝对路径：${relative(out,file)}`);
  }
}
console.log(`已生成读书搭子专家包：${relative(root,out)}/`);
