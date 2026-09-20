import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const CLI=resolve('server/cli.mjs');
const CANARY='wrk-CANARY0000secret';
// 注意：不设置任何 READING_AUTH_MODE 内部变量——CLI 入口必须自行初始化 Skill 模式。
const cleanEnv=()=>{const env={...process.env};delete env.READING_AUTH_MODE;delete env.WEREAD_API_KEY;delete env.READING_DATA_DIR;delete env.READING_CONFIG_DIR;delete env.READING_OFFLINE_GUARD;return env;};
const dirs=()=>({data:mkdtempSync(join(tmpdir(),'reading-cli-data-')),config:mkdtempSync(join(tmpdir(),'reading-cli-config-'))});
function run(args,{env={},cwd=resolve('.')}={}){
  const {data,config}=dirs();
  const child=spawnSync(process.execPath,[CLI,...args],{cwd,encoding:'utf8',env:{...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config,...env}});
  let json=null;try{json=JSON.parse(child.stdout);}catch{}
  let err=null;try{err=JSON.parse(child.stderr);}catch{}
  return {code:child.status,json,err,stdout:child.stdout,stderr:child.stderr,data,config};
}

test('cold start without credentials: empty own space, explicit auth errors, demo works offline',()=>{
  const status=run(['status']);
  assert.equal(status.code,0);assert.equal(status.json.ok,true);assert.equal(status.json.auth.configured,false);
  assert.equal(status.json.snapshot,null);assert.equal(status.json.connection.connected,false);
  assert.match(status.json.auth.source,/未配置/);
  const sync=run(['sync']);
  assert.equal(sync.code,3);assert.equal(sync.json,null);assert.equal(sync.err.error.code,3);
  assert.match(sync.err.error.message,/尚未配置微信读书凭证/);
  const books=run(['books']);
  assert.equal(books.code,0);assert.equal(books.json.total,0);assert.match(books.json.note,/本地尚无书架数据/);
  const demo=run(['books','--mode','demo']);
  assert.equal(demo.code,0);assert.equal(demo.json.books[0].title,'山间来信');
  assert.ok(!existsSync(join(status.data,'runtime.json')),'不得创建 runtime.json');
});

test('fake-account isolation and persistence across CLI invocations',()=>{
  const {data,config}=dirs();
  const envA={WEREAD_API_KEY:'wrk-Account000000A'},envB={WEREAD_API_KEY:'wrk-Account000000B'};
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(args,extra)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:{...base,...extra}});return {code:r.status,out:r.stdout,json:JSON.parse(r.stdout||'{}'),err:r.stderr};};
  assert.equal(cli(['save-card','--title','A的卡片','--body','只属于A'],envA).code,0);
  assert.equal(cli(['status'],envA).json.counts.cards,1);
  const asB=cli(['status'],envB);
  assert.equal(asB.json.counts.cards,0,'不同凭证必须是不同的数据空间');
  assert.notEqual(cli(['status'],envA).json.auth.account,cli(['status'],envB).json.auth.account);
  const again=cli(['status'],envA);
  assert.equal(again.json.counts.cards,1,'同一凭证跨进程恢复同一数据');
});

test('demo and live stay separated, including backup import mode validation',()=>{
  const {data,config}=dirs();
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const file=join(data,'demo-backup.json');
  const ex=spawnSync(process.execPath,[CLI,'backup','export','--mode','demo',file],{encoding:'utf8',env:base});
  assert.equal(ex.status,0);
  const intoLive=spawnSync(process.execPath,[CLI,'backup','import',file],{encoding:'utf8',env:base});
  assert.equal(intoLive.status,2,'示例备份不能导入个人模式');
  const intoDemo=spawnSync(process.execPath,[CLI,'backup','import','--mode','demo',file],{encoding:'utf8',env:base});
  assert.equal(intoDemo.status,0);
});

test('demo mode never reveals live auth information',()=>{
  const {data,config}=dirs();
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config,WEREAD_API_KEY:CANARY};
  const r=spawnSync(process.execPath,[CLI,'status','--mode','demo'],{encoding:'utf8',env:base});
  assert.equal(r.status,0);
  assert.ok(!r.stdout.includes(CANARY),'示例模式输出不得包含凭证');
  assert.match(r.stdout,/示例模式/);
  assert.doesNotMatch(r.stdout,/本机凭证文件|环境变量 WEREAD_API_KEY/,'示例模式不得泄露个人授权来源');
  const auth=spawnSync(process.execPath,[CLI,'auth','status','--mode','demo'],{encoding:'utf8',env:base});
  assert.equal(auth.status,2,'示例模式拒绝 auth 命令');
});

test('offline commands are proven offline by a runtime guard, not by absence of runtime.json',()=>{
  const {data,config}=dirs();
  const guard=pathToFileURL(resolve('tests/offline-guard.mjs')).href;
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config,WEREAD_API_KEY:CANARY,
    READING_OFFLINE_GUARD:'1',NODE_OPTIONS:`--import=${guard}`};
  const report=join(data,'report.html');
  for(const args of [['status'],['books'],['draft','--mode','demo','--notes','demo-note-0'],['review','--mode','demo','--period','weekly'],['backup','export','--mode','demo',join(data,'backup.json')],['report','--mode','demo',report]]){
    const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:base});
    assert.equal(r.status,0,args.join(' ')+'\n'+r.stderr);
    assert.ok(!r.stdout.includes(CANARY)&&!r.stderr.includes(CANARY),'输出不得包含凭证');
  }
  assert.ok(!existsSync(join(data,'runtime.json')),'不得创建 runtime.json');
  const html=readFileSync(report,'utf8');
  assert.ok(!html.includes(CANARY),'报告不得包含凭证');
  assert.ok((statSync(report).mode&0o777)===0o600,'报告需 0600 权限');
  assert.ok((statSync(join(data,'backup.json')).mode&0o777)===0o600,'备份需 0600 权限');
  // 守卫本身确实会拦截网络：同环境下直接 fetch 必须失败
  const probe=spawnSync(process.execPath,['-e','try{fetch("http://127.0.0.1:9/")}catch(e){console.error(e.message);process.exit(7)}'],{encoding:'utf8',env:base});
  assert.equal(probe.status,7,'离线守卫应对网络尝试直接抛错');
  assert.match(probe.stderr,/offline-guard/);
});

test('CLI rejects invalid options instead of silently defaulting',()=>{
  const cases=[
    [['status','--mode','typo'],/--mode 仅支持/],
    [['status','--definitely-unknown'],/不支持的选项/],
    [['books','--limit','abc'],/--limit 必须是/],
    [['books','--limit','3.5'],/--limit 必须是/],
    [['books','--offset','-1'],/--offset 必须在/],
    [['books','--status','typo'],/--status 仅支持/],
    [['notes','demo-mountain','--limit','NaN','--mode','demo'],/--limit 必须是/],
    [['settings','bogus'],/用法：settings/],
    [['settings','set','--goal','abc','--mode','demo'],/--goal 必须是/],
    [['settings','set','--timezone','Mars/Olympus','--mode','demo'],/--timezone 不是有效/],
    [['save-card','--mode','demo','--title','t','--body','b','--kind','typo'],/--kind 仅支持/],
    [['review','--period','daily','--mode','demo'],/--period 仅支持/],
    [['draft','--mode','demo','--notes','demo-note-0','--reflection-file',join('/nonexistent-dir-xyz','r.txt')],/--reflection-file/],
  ];
  for(const [args,match] of cases){
    const r=run(args);
    assert.equal(r.code,2,args.join(' ')+' 应以 2 失败，实际 '+r.code+' stdout='+r.stdout+' stderr='+r.stderr);
    assert.match(r.stderr,match);
  }
});

test('per-command flags, positional counts, missing values, duplicates and refresh values',()=>{
  const {data,config}=dirs();
  const keyFile=join(data,'key.txt');writeFileSync(keyFile,CANARY);
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(...args)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:base});return {code:r.status,stdout:r.stdout,stderr:r.stderr,json:JSON.parse(r.stdout||'{}')};};
  // 各命令只接受自己的选项；--goal 对 auth 无意义，必须在任何副作用之前被拒绝
  const bad=cli('auth','revoke','--goal','invalid');
  assert.equal(bad.code,2);assert.match(bad.stderr,/不支持的选项/);
  assert.equal(cli('auth','status').json.configured,false,'凭证不得被删除');
  assert.equal(cli('auth','import',keyFile).code,0);
  for(const args of [['auth','revoke','--goal','5'],['auth','revoke','--query','x'],['status','--body','x'],['sync','--limit','5'],['report','--limit','5']]){
    const r=cli(...args);
    assert.equal(r.code,2,args.join(' '));assert.match(r.stderr,/不支持的选项/);
  }
  assert.equal(cli('auth','status').json.configured,true,'拒绝后凭证仍完好');
  // 位置参数个数
  for(const args of [['books','extra'],['notes'],['notes','a','b'],['report'],['report','a','b'],['backup','export'],['auth','status','extra'],['auth','import'],['auth','revoke','x']]){
    const r=cli(...args);
    assert.equal(r.code,2,args.join(' '));assert.match(r.stderr,/参数个数不正确|用法：auth/);
  }
  // 缺少取值
  for(const args of [['books','--limit'],['books','--limit','--status','reading'],['save-card','--mode','demo','--title'],['draft','--mode','demo','--notes']]){
    const r=cli(...args);
    assert.equal(r.code,2,args.join(' '));assert.match(r.stderr,/缺少取值/);
  }
  // 重复选项
  for(const args of [['books','--limit','5','--limit','6'],['books','--limit=5','--limit=6'],['books','--limit','5','--limit=6'],['status','--mode','demo','--mode','demo']]){
    const r=cli(...args);
    assert.equal(r.code,2,args.join(' '));assert.match(r.stderr,/重复/);
  }
  // refresh 只允许 true/false
  const badRefresh=cli('notes','demo-mountain','--refresh','maybe','--mode','demo');
  assert.equal(badRefresh.code,2);assert.match(badRefresh.stderr,/--refresh 仅接受/);
  const okRefresh=cli('notes','demo-mountain','--refresh','false','--mode','demo');
  assert.equal(okRefresh.code,0,'refresh=false 不触发联网刷新');
});

test('conflicting text sources are rejected rather than silently picked',()=>{
  const {data,config}=dirs();
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const bodyFile=join(data,'b.txt'),inputFile=join(data,'i.json'),textFile=join(data,'t.txt'),reflFile=join(data,'r.txt');
  writeFileSync(bodyFile,'文件正文');writeFileSync(inputFile,JSON.stringify({noteId:'demo-note-0',text:'JSON'}));
  writeFileSync(textFile,'文件文本');writeFileSync(reflFile,'文件反思');
  const cli=(...args)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:base});return {code:r.status,stdout:r.stdout,stderr:r.stderr};};
  const cases=[
    ['reflect','--mode','demo','--note-id','demo-note-0','--text','直给','--text-file',textFile],
    ['reflect','--mode','demo','--note-id','demo-note-0','--text','直给','--input',inputFile],
    ['reflect','--mode','demo','--input',inputFile,'--text-file',textFile],
    ['reflect','--mode','demo','--input',inputFile,'--note-id','demo-note-0'],
    ['draft','--mode','demo','--notes','demo-note-0','--reflection','直给','--reflection-file',reflFile],
    ['save-card','--mode','demo','--title','t','--body','直给','--body-file',bodyFile],
    ['save-card','--mode','demo','--input',inputFile,'--title','t'],
  ];
  for(const args of cases){
    const r=cli(...args);
    assert.equal(r.code,2,args.join(' ')+'\n'+r.stdout+r.stderr);
    assert.match(r.stderr,/只能任选其一|不能与其他取值选项/);
  }
  const status=JSON.parse(cli('status','--mode','demo').stdout);
  assert.equal(status.counts.cards,0,'冲突被拒绝后不得写入');
  assert.equal(status.counts.reflections,0);
});

test('errors never echo credential-like input strings',()=>{
  const canary='wrk-SyntheticPrivateCanary123';
  const {data,config}=dirs();
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(...args)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:base});return {code:r.status,stdout:r.stdout,stderr:r.stderr};};
  const attempts=[
    [canary],                       // 未知命令
    ['--'+canary],                  // 未知选项
    ['status','--'+canary],         // 该命令不支持的选项
    ['auth','import',join('/nonexistent-'+canary,'key.txt')], // 文件错误
    ['backup','import',join('/nonexistent-'+canary,'b.json')],
    ['report','--input',canary],    // 不支持的选项 + 凭证形态值
  ];
  for(const args of attempts){
    const r=cli(...args);
    assert.equal(r.code,2,args.join(' '));
    assert.ok(!r.stdout.includes(canary)&&!r.stderr.includes(canary),args.join(' ')+' 不得回显输入');
  }
});

test('auth revoke with an invalid --mode must not remove anything',()=>{
  const {data,config}=dirs();
  const keyFile=join(data,'weread-key.txt');
  writeFileSync(keyFile,CANARY);
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(args,extra)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:{...base,...extra}});return {code:r.status,stdout:r.stdout,stderr:r.stderr};};
  assert.equal(cli(['auth','import',keyFile]).code,0);
  const bad=cli(['auth','revoke','--mode','typo']);
  assert.equal(bad.code,2,'无效 --mode 必须先于命令执行被拒绝');
  const after=cli(['auth','status']);
  assert.equal(JSON.parse(after.stdout).configured,true,'凭证文件必须仍然存在');
});

test('file-based text input avoids shell-embedding hazards',()=>{
  const {data,config}=dirs();
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(...args)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:base});return {code:r.status,json:JSON.parse(r.stdout||'{}'),raw:r.stdout,stderr:r.stderr};};
  const tricky='# 标题\n含 "双引号"、`反引号`、$HOME 与 ${VAR} 的正文\n第二行';
  const bodyFile=join(data,'body.md'),reflFile=join(data,'refl.txt'),inputFile=join(data,'input.json');
  writeFileSync(bodyFile,tricky);writeFileSync(reflFile,'文件里的个人理解');
  writeFileSync(inputFile,JSON.stringify({noteId:'demo-note-0',text:'JSON 输入的回顾 $x'}));
  const saved=cli('save-card','--mode','demo','--title','文件卡片','--body-file',bodyFile);
  assert.equal(saved.code,0);assert.equal(saved.json.card.body,tricky,'body-file 内容必须原样保存');
  const draft=cli('draft','--mode','demo','--notes','demo-note-0','--reflection-file',reflFile);
  assert.equal(draft.code,0);assert.match(draft.json.body,/文件里的个人理解/);
  assert.equal(draft.json.title,'我的读书卡片');
  const reflected=cli('reflect','--mode','demo','--input',inputFile);
  assert.equal(reflected.code,0);
  const status=cli('status','--mode','demo');
  assert.equal(status.json.counts.reflections,1);
});

test('malformed or unreadable credential file gets a clear error without echoing contents',()=>{
  const {data,config}=dirs();
  const store=join(config,'credentials.json');
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(...args)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:base});return {code:r.status,json:JSON.parse(r.stdout||'{}'),stderr:r.stderr,raw:r.stdout};};
  const garbage='not-json{{{secret-ish-content';
  writeFileSync(store,garbage,{mode:0o600});
  const status=cli('auth','status');
  assert.equal(status.json.configured,false);
  assert.match(status.json.storeProblem,/凭证文件无法读取或已损坏（内容不会显示）/);
  assert.ok(!status.raw.includes(garbage),'错误不得回显凭证文件内容');
  const sync=cli('sync');
  assert.equal(sync.code,3,'凭证损坏按缺少/失效授权处理');
  assert.match(sync.stderr,/凭证文件无法读取或已损坏/);
  assert.ok(!sync.stderr.includes(garbage));
  // 重新导入可修复
  const keyFile=join(data,'key.txt');writeFileSync(keyFile,CANARY);
  assert.equal(cli('auth','import',keyFile).code,0);
  assert.equal(cli('auth','status').json.storeProblem,null);
});

test('revoke accurately reports when an environment credential remains active',()=>{
  const {data,config}=dirs();
  const keyFile=join(data,'key.txt');writeFileSync(keyFile,CANARY);
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(args,extra)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:{...base,...extra}});return {code:r.status,json:JSON.parse(r.stdout||'{}')};};
  assert.equal(cli(['auth','import',keyFile]).code,0);
  const envKey={WEREAD_API_KEY:'wrk-EnvStillActive0001'};
  const withEnv=cli(['auth','revoke'],envKey);
  assert.equal(withEnv.json.configured,true,'环境变量仍在提供凭证');
  assert.match(withEnv.json.note,/授权仍然有效/);
  const clean=cli(['auth','revoke']);
  assert.equal(clean.json.configured,false);
});

test('report and backup export refuse to overwrite credential file or active profile',()=>{
  const {data,config}=dirs();
  const keyFile=join(data,'key.txt');writeFileSync(keyFile,CANARY);
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(...args)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:base});return {code:r.status,stderr:r.stderr};};
  assert.equal(cli('auth','import',keyFile).code,0);
  const account=JSON.parse(spawnSync(process.execPath,[CLI,'auth','status'],{encoding:'utf8',env:base}).stdout).account;
  // 个人模式：凭证文件与当前凭证的激活数据文件都受保护
  for(const target of [join(config,'credentials.json'),join(data,`profile-${account}.json`)]){
    for(const args of [['report',target],['backup','export',target]]){
      const r=cli(...args);
      assert.equal(r.code,2,args.join(' ')+' → '+target);
      assert.match(r.stderr,/受保护的凭证或数据文件冲突/);
    }
  }
  // 示例模式：demo.json 受保护（credential 在两种模式下都受保护）
  for(const args of [['report','--mode','demo',join(data,'demo.json')],['backup','export','--mode','demo',join(data,'demo.json')],['report','--mode','demo',join(config,'credentials.json')]]){
    const r=cli(...args);
    assert.equal(r.code,2,args.join(' '));
    assert.match(r.stderr,/受保护的凭证或数据文件冲突/);
  }
  // 凭证与激活数据都未被破坏
  assert.equal(cli('auth','status').code,0);
  assert.ok(existsSync(join(data,`profile-${account}.json`)));
});

test('canonical aliases and symlinked parents cannot bypass output protection',()=>{
  const {data,config}=dirs();
  const keyFile=join(data,'key.txt');writeFileSync(keyFile,CANARY);
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(...args)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:base});return {code:r.status,stderr:r.stderr};};
  assert.equal(cli('auth','import',keyFile).code,0);
  assert.equal(cli('save-card','--title','活数据','--body','x').code,0);
  const account=JSON.parse(spawnSync(process.execPath,[CLI,'auth','status'],{encoding:'utf8',env:base}).stdout).account;
  const store=join(config,'credentials.json');
  const liveProfile=join(data,`profile-${account}.json`);
  const storeBytes=readFileSync(store,'utf8');
  const variants=[];
  // macOS /var ↔ /private/var 是同一目录的两种拼写
  const alias=s=>s.startsWith('/private/var/')?'/var/'+s.slice('/private/var/'.length)
    :s.startsWith('/var/')?'/private/var/'+s.slice('/var/'.length):null;
  for(const target of [store,liveProfile,join(data,'demo.json')]){
    const a=alias(target);
    if(a&&a!==target)variants.push([a,'路径别名']);
  }
  // 符号链接父目录指向同一位置
  const linkRoot=mkdtempSync(join(tmpdir(),'reading-link-root-'));
  const linkDir=join(linkRoot,'linked-config');
  symlinkSync(config,linkDir,'dir');
  const linkDataDir=join(linkRoot,'linked-data');
  symlinkSync(data,linkDataDir,'dir');
  variants.push([join(linkDir,'credentials.json'),'符号链接父目录']);
  variants.push([join(linkDataDir,`profile-${account}.json`),'符号链接父目录']);
  assert.ok(variants.length>=2,'本平台应至少覆盖路径别名或符号链接之一');
  for(const [target,label] of variants){
    for(const args of [['report',target],['report','--mode','demo',target],['backup','export',target]]){
      const r=cli(...args);
      assert.equal(r.code,2,label+' '+args.join(' ')+' → '+target);
      assert.match(r.stderr,/受保护的凭证或数据文件冲突/);
      assert.equal(readFileSync(store,'utf8'),storeBytes,'凭证文件字节必须保持原样');
      assert.ok(readFileSync(liveProfile,'utf8').includes('活数据'),'个人数据文件必须保持原样');
    }
  }
  // 跨模式：demo 模式也不能写 live 的 profile，反之亦然
  assert.equal(cli('report','--mode','demo',liveProfile).code,2);
  assert.equal(cli('report',join(data,'demo.json')).code,2);
  assert.equal(readFileSync(store,'utf8'),storeBytes);
  // 同一目录下的其他文件名仍是合法输出
  assert.equal(cli('report',join(config,'reading-report.html')).code,0);
  assert.equal(cli('report','--mode','demo',join(data,'demo-report.html')).code,0);
  assert.equal(cli('backup','export',join(data,'backup-copy.json')).code,0);
});

test('draft/save/report flow with malicious note text is fully escaped',()=>{
  const {data,config}=dirs();
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(...args)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:base});return {code:r.status,json:JSON.parse(r.stdout||'{}'),raw:r.stdout,stderr:r.stderr};};
  const draft=cli('draft','--mode','demo','--notes','demo-note-0','--reflection','我自己的理解');
  assert.equal(draft.code,0);assert.match(draft.json.body,/我自己的理解/);
  assert.doesNotMatch(draft.json.prompt,/reading_prepare_card|reading_save_card|连接器/,'Skill 草稿提示不得包含连接器工具指令');
  const saved=cli('save-card','--mode','demo','--title','测试卡片','--body',draft.json.body,'--note-ids','demo-note-0');
  assert.equal(saved.code,0);assert.ok(saved.json.card.id);
  // 注入恶意笔记与书名，并确保新快照真的取代当前快照（syncedAt 必须更新）
  const backupFile=join(data,'demo-backup.json');
  cli('backup','export','--mode','demo',backupFile);
  const backup=JSON.parse(readFileSync(backupFile,'utf8'));
  backup.snapshot.syncedAt='2999-01-01T00:00:00.000Z';
  backup.snapshot.notes.push({id:'evil-1',bookId:'demo-mountain',title:'</script><script>alert(1)</script>',chapter:'<img src=x onerror=alert(1)>',quote:'"><script>alert(2)</script>',thought:'\'--></style><iframe onload=alert(3)>',date:'2026-09-14',type:'thought',deepLink:null});
  writeFileSync(backupFile,JSON.stringify(backup));
  assert.equal(cli('backup','import','--mode','demo',backupFile).code,0);
  const notes=cli('notes','demo-mountain','--mode','demo');
  assert.equal(notes.code,0);
  assert.ok(notes.raw.includes('evil-1'),'恶意笔记必须真实到达数据（fixture 生效）');
  const report=join(data,'evil.html');
  assert.equal(cli('report','--mode','demo',report).code,0);
  const html=readFileSync(report,'utf8');
  // 负向：原始注入串不得以可执行形式出现；正向：负载以转义后的安全形式完整存在
  assert.ok(!html.includes('</script><script>alert'),'不得出现未转义的脚本注入');
  assert.ok(!html.includes('<img src=x'),'不得出现未转义的标签注入');
  assert.ok(!html.includes('</style><iframe'),'不得出现未转义的样式突破');
  assert.ok(html.includes('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>'),'内嵌 JSON 需转义 < 且负载确实进入报告');
  assert.ok(html.includes('\\u003cimg src=x onerror=alert(1)>'),'章节负载确实进入报告');
});

test('backup roundtrip dedups by id and keeps the newer version',()=>{
  const {data,config}=dirs();
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(...args)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:base});return {code:r.status,json:JSON.parse(r.stdout||'{}'),stderr:r.stderr};};
  assert.equal(cli('save-card','--mode','demo','--title','原始','--body','v1').code,0);
  const file=join(data,'backup.json');
  const ex=cli('backup','export','--mode','demo',file);
  assert.equal(ex.code,0);
  assert.equal(ex.json.path,resolve(file),'backup export 必须返回写入路径');
  const backup=JSON.parse(readFileSync(file,'utf8'));
  backup.cards[0].body='v2';backup.cards[0].updatedAt='2999-01-01T00:00:00.000Z';
  writeFileSync(file,JSON.stringify(backup));
  assert.equal(cli('backup','import','--mode','demo',file).code,0);
  assert.equal(cli('backup','import','--mode','demo',file).code,0,'重复导入需幂等');
  const status=cli('status','--mode','demo');
  assert.equal(status.json.counts.cards,1);
  const report=join(data,'check.html');cli('report','--mode','demo',report);
  assert.ok(readFileSync(report,'utf8').includes('v2'));
});

test('auth import/status/revoke with private store, env override and no key in output',()=>{
  const {data,config}=dirs();
  const keyFile=join(data,'weread-key.txt');
  writeFileSync(keyFile,CANARY);
  const base={...cleanEnv(),READING_DATA_DIR:data,READING_CONFIG_DIR:config};
  const cli=(...args)=>{const r=spawnSync(process.execPath,[CLI,...args],{encoding:'utf8',env:base});return {code:r.status,json:JSON.parse(r.stdout||'{}'),stderr:r.stderr,raw:r.stdout};};
  const bad=cli('auth','import',join(data,'missing.txt'));
  assert.equal(bad.code,2);
  assert.ok(!bad.stderr.includes(join(data,'missing.txt')),'文件错误不得回显路径');
  const imported=cli('auth','import',keyFile);
  assert.equal(imported.code,0);
  assert.ok(!imported.raw.includes(CANARY)&&!imported.stderr.includes(CANARY));
  const store=join(config,'credentials.json');
  assert.equal(statSync(store).mode&0o777,0o600);
  const sameAccount=cli('auth','status');
  assert.equal(sameAccount.json.storeProblem,null);
  // 环境变量优先于凭证文件
  const withEnv=spawnSync(process.execPath,[CLI,'auth','status'],{encoding:'utf8',env:{...base,WEREAD_API_KEY:'wrk-EnvOverride0001'}});
  assert.equal(JSON.parse(withEnv.stdout).source,'环境变量 WEREAD_API_KEY');
  const revoked=cli('auth','revoke');
  assert.equal(revoked.code,0);assert.equal(revoked.json.configured,false,'移除凭证文件后不再配置');
});

// —— 以下为同进程测试：mock 网关验证 sync 的 await-and-exit 语义 ——
// 注意：本文件前段已用 spawn 证明 CLI 入口自行初始化 Skill 模式，此处仅在同进程复用入口逻辑。
process.env.READING_DATA_DIR=mkdtempSync(join(tmpdir(),'reading-cli-sync-'));
process.env.READING_CONFIG_DIR=mkdtempSync(join(tmpdir(),'reading-cli-sync-config-'));
process.env.WEREAD_API_KEY='wrk-SyncTest000001';
const {runCli}=await import('../server/cli.mjs');

const jsonResponse=(body,status=200)=>({status,ok:status>=200&&status<300,json:async()=>body});
function mockGateway(responder){globalThis.fetch=async(_url,options)=>{const body=JSON.parse(String(options.body));return responder(body.api_name,body);};}

test('sync awaits completion and exits with updated snapshot (mocked gateway)',async()=>{
  mockGateway(apiName=>{
    switch(apiName){
      case '/readdata/detail':return jsonResponse({readLongest:[{book:{bookId:'b1'},readTime:600}],readTimes:{},totalReadTime:3600,readDays:2});
      case '/shelf/sync':return jsonResponse({books:[{bookId:'b1',title:'同步测试书',author:'作者甲',finishReading:0}],albums:[],mp:{}});
      case '/user/notebooks':return jsonResponse({books:[],totalBookCount:1,totalNoteCount:0});
      case '/book/info':return jsonResponse({cover:'https://wf.qpic.com/cover.png',deepLink:'https://weread.qq.com/web/reader/b1'});
      case '/book/getprogress':return jsonResponse({book:{progress:10}});
      case '/book/bookmarklist':return jsonResponse({chapters:[],updated:[]});
      case '/review/list/mine':return jsonResponse({reviews:[],hasMore:false});
      default:return jsonResponse({errcode:1},500);
    }});
  let stdout='';
  const code=await runCli(['sync'],{stdout:text=>{stdout=text;}});
  assert.equal(code,0,'sync 应等待完成并以 0 退出');
  const out=JSON.parse(stdout);
  assert.ok(out.syncedAt);assert.equal(out.ok,true);
  const {readProfile}=await import('../server/storage.mjs');
  const p=readProfile();
  assert.equal(p.snapshot.books[0].title,'同步测试书');
  assert.equal(p.snapshot.books[0].weeklySeconds,600);
  assert.equal(p.snapshot.weekly.totalSeconds,3600);
});

test('sync classifies revoked/expired credentials as authorization exit code 3 (mocked gateway)',async()=>{
  mockGateway(()=>jsonResponse({errcode:401},401));
  let stderr='';
  const code=await runCli(['sync'],{stderr:text=>{stderr=text;}});
  assert.equal(code,3,'401/授权失效应退出 3 而不是 1');
  assert.match(stderr,/授权失效/);
});

test('sync classifies rate limiting as exit code 5 (mocked gateway)',async()=>{
  mockGateway(()=>jsonResponse({errcode:429},429));
  let stderr='';
  const code=await runCli(['sync'],{stderr:text=>{stderr=text;}});
  assert.equal(code,5,'429 应退出 5');
  assert.match(stderr,/请求较多/);
});
