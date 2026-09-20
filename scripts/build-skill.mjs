import {build} from 'esbuild';
import {mkdirSync,writeFileSync,copyFileSync,rmSync,readdirSync,readFileSync,statSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';

const root=resolve('.');
const out=resolve('dist/skill/reading-buddy');
const src=resolve('skills/reading-buddy');
rmSync(out,{recursive:true,force:true});
mkdirSync(join(out,'scripts'),{recursive:true});
mkdirSync(join(out,'references'),{recursive:true});
mkdirSync(join(out,'assets'),{recursive:true});

const result=await build({entryPoints:['server/cli.mjs'],bundle:true,minify:true,platform:'node',format:'esm',target:'es2022',write:false,external:['node:*']});
const code=result.outputFiles[0].text.replace(/^(#![^\n]*\n)+/,'');
writeFileSync(join(out,'scripts','reading-buddy.mjs'),'#!/usr/bin/env node\n'+code,{mode:0o755});
copyFileSync(join(src,'SKILL.md'),join(out,'SKILL.md'));
for(const name of readdirSync(join(src,'references')))copyFileSync(join(src,'references',name),join(out,'references',name));
// 报告需要复用已生成的图片素材（内嵌进 HTML）；随包分发，脚本按自身位置查找，不依赖仓库路径。
for(const name of ['reading-light.png','demo-book.png'])copyFileSync(join(root,'public','assets',name),join(out,'assets',name));

// 交付边界自检：文本文件内不得出现 node_modules、连接器清单、凭证、MCP 运行时、本机绝对路径或开发端口。
const banned=[/node_modules/,/connector-meta/,/token-schema/,/mcp\.json/,/runtime\.json/,/localhost:3788/,/@modelcontextprotocol/,/StdioServerTransport/,new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))];
const files=[];
(function walk(dir){for(const name of readdirSync(dir)){const p=join(dir,name);if(statSync(p).isDirectory())walk(p);else files.push(p);}})(out);
const textFiles=files.filter(p=>/\.(mjs|md|json|html)$/.test(p));
for(const file of textFiles){const text=readFileSync(file,'utf8');for(const pattern of banned)if(pattern.test(text))throw new Error(`Skill 包包含不允许的内容（${pattern}）：${relative(root,file)}`);}
console.log(`已生成免连接器 Skill 包：${relative(root,out)}/（${files.length} 个文件，含打包脚本、SKILL.md、references 与内嵌报告素材；无 node_modules、凭证、连接器清单或 MCP 运行时）。`);
