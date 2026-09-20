import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,readdirSync,statSync,cpSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const root=resolve('.');
const OUT=join(root,'dist','skill','reading-buddy');

function listFiles(dir){const out=[];(function walk(d){for(const name of readdirSync(d)){const p=join(d,name);if(statSync(p).isDirectory())walk(p);else out.push(p);}})(dir);return out;}

test('build produces a portable connector-free Skill package with required metadata',()=>{
  const build=spawnSync(process.execPath,['scripts/build-skill.mjs'],{cwd:root,encoding:'utf8',env:{...process.env,WEREAD_API_KEY:''}});
  assert.equal(build.status,0,build.stderr);
  const files=listFiles(OUT);
  assert.ok(files.length>=6);
  for(const name of ['SKILL.md','scripts/reading-buddy.mjs','references/commands.md','references/security.md','assets/reading-light.png','assets/demo-book.png'])
    assert.ok(existsSync(join(OUT,name)),'缺少 '+name);
  // 不得包含连接器清单、MCP 运行时、node_modules 目录或 runtime.json
  for(const name of ['mcp.json','connector-meta.json','token-schema.json','runtime.json','package.json'])assert.ok(!existsSync(join(OUT,name)),'不得包含 '+name);
  assert.ok(!files.some(f=>f.includes('node_modules')));
  // 市场元数据
  const skill=readFileSync(join(OUT,'SKILL.md'),'utf8');
  for(const field of ['description:','description_zh:','description_en:','version:','author:','name:','display_name:'])
    assert.ok(skill.includes(field),'SKILL.md 缺少元数据 '+field);
  assert.ok(skill.includes('北京海纳福星文化传媒有限公司'));
  // 包内文本文件不得包含本机绝对路径、开发端口、凭证或 node_modules 引用
  const canary='wrk-CANARY0000secret';
  const textFiles=files.filter(p=>/\.(mjs|md|json|html)$/.test(p));
  for(const file of textFiles){const text=readFileSync(file,'utf8');
    assert.ok(!text.includes(root),'不得包含仓库绝对路径: '+file);
    assert.ok(!text.includes('localhost:3788'),'不得包含开发端口: '+file);
    assert.ok(!text.includes(canary),'不得包含凭证: '+file);
    assert.ok(!text.includes('node_modules'),'不得引用 node_modules: '+file);
  }
  // 有意义的依赖/运行边界断言：打包脚本不得捆绑 MCP SDK / stdio 传输实现（真实 MCP 运行时依赖）
  const script=readFileSync(join(OUT,'scripts/reading-buddy.mjs'),'utf8');
  assert.ok(!script.includes('@modelcontextprotocol'),'脚本不得捆绑 MCP SDK');
  assert.ok(!script.includes('StdioServerTransport'),'脚本不得包含 MCP stdio 传输实现');
  assert.ok(!script.includes('McpServer'),'脚本不得包含 MCP 服务器实现');
});

test('built Skill launches from a path with spaces and an arbitrary cwd without internal flags',()=>{
  const spaced=join(mkdtempSync(join(tmpdir(),'reading skill ')),'搭子 skill 包');
  cpSync(OUT,spaced,{recursive:true});
  const other=mkdtempSync(join(tmpdir(),'elsewhere-'));
  const data=mkdtempSync(join(tmpdir(),'reading-skill-data-')),config=mkdtempSync(join(tmpdir(),'reading-skill-config-'));
  // 不设置 READING_AUTH_MODE：入口必须自行初始化 Skill 模式（使用平台级配置目录语义）
  const env={...process.env,READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  delete env.READING_AUTH_MODE;delete env.WEREAD_API_KEY;
  const bin=join(spaced,'scripts','reading-buddy.mjs');
  const status=spawnSync(process.execPath,[bin,'status','--mode','demo'],{cwd:other,encoding:'utf8',env});
  assert.equal(status.status,0,status.stderr);
  const json=JSON.parse(status.stdout);
  assert.equal(json.ok,true);assert.equal(json.mode,'demo');
  // Skill 模式的凭证管理可用且使用隔离配置目录
  const keyFile=join(data,'key.txt');
  writeFileSync(keyFile,'wrk-SkillLaunchTest001\n');
  const imported=spawnSync(process.execPath,[bin,'auth','import',keyFile],{cwd:other,encoding:'utf8',env});
  assert.equal(imported.status,0,imported.stderr);
  const auth=JSON.parse(spawnSync(process.execPath,[bin,'auth','status'],{cwd:other,encoding:'utf8',env}).stdout);
  assert.equal(auth.configured,true,'导入后必须显示已配置');
  assert.equal(auth.storePath,join(config,'credentials.json'),'必须使用隔离配置目录中的凭证文件');
  assert.equal(statSync(auth.storePath).mode&0o777,0o600);
  const draft=spawnSync(process.execPath,[bin,'draft','--mode','demo','--notes','demo-note-0'],{cwd:other,encoding:'utf8',env});
  assert.equal(draft.status,0,draft.stderr);
  assert.match(draft.stdout,/阅读摘录整理/);
  assert.doesNotMatch(draft.stdout,/reading_prepare_card|reading_save_card/,'Skill 路径输出不得包含连接器工具指令');
  // 帮助在任意 cwd 可用
  const help=spawnSync(process.execPath,[bin,'--help'],{cwd:other,encoding:'utf8',env});
  assert.equal(help.status,0);assert.match(help.stdout,/auth status\|import <文件>\|revoke/);
});

test('built Skill generates a self-contained demo report with embedded generated assets',()=>{
  const spaced=join(mkdtempSync(join(tmpdir(),'reading skill ')),'搭子 skill 包');
  cpSync(OUT,spaced,{recursive:true});
  const other=mkdtempSync(join(tmpdir(),'elsewhere-'));
  const data=mkdtempSync(join(tmpdir(),'reading-skill-data-')),config=mkdtempSync(join(tmpdir(),'reading-skill-config-'));
  const env={...process.env,READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  delete env.READING_AUTH_MODE;delete env.WEREAD_API_KEY;
  const report=join(data,'报告 demo.html');
  const r=spawnSync(process.execPath,[join(spaced,'scripts','reading-buddy.mjs'),'report','--mode','demo',report],{cwd:other,encoding:'utf8',env});
  assert.equal(r.status,0,r.stderr);
  const html=readFileSync(report,'utf8');
  // 示例报告完全自包含：复用已生成素材（内嵌 data URI），不产生任何外部资源请求
  assert.ok((html.match(/data:image\/png;base64,/g)||[]).length>=2,'报告需内嵌生成的阅读灯与示例书素材');
  assert.ok(!/src="https?:\/\//.test(html),'示例报告不得引用外部图片地址');
  assert.ok(!/<script[^>]+src=/.test(html),'报告不得引用外部脚本');
  assert.ok(html.includes('山间来信'),'示例书名需出现在报告中');
  assert.equal(statSync(report).mode&0o777,0o600);
});
