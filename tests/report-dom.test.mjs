import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';

// 在同进程加载 report 生成器前，先隔离 Skill 模式的数据/配置目录。
process.env.READING_AUTH_MODE='skill';
process.env.READING_DATA_DIR=mkdtempSync(join(tmpdir(),'reading-report-dom-data-'));
process.env.READING_CONFIG_DIR=mkdtempSync(join(tmpdir(),'reading-report-dom-config-'));
const {buildReport}=await import('../server/report.mjs');

/* ---------- 极简 DOM（仅实现本报告脚本用到的 API） ---------- */
class El{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parent=null;this.attributes={};this.listeners={};this.style={};this.dataset={};this._text='';}
  set className(v){this.attributes.class=v;}
  get className(){return this.attributes.class||'';}
  setAttribute(k,v){this.attributes[k]=String(v);if(k.startsWith('data-')){const key=k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());this.dataset[key]=String(v);}}
  getAttribute(k){return this.attributes[k];}
  appendChild(n){n.parent=this;this.children.push(n);return n;}
  replaceWith(n){if(!this.parent)return;const i=this.parent.children.indexOf(this);if(i>=0){this.parent.children[i]=n;n.parent=this.parent;}}
  addEventListener(t,fn){(this.listeners[t]??=[]).push(fn);}
  get classList(){const el=this;return{toggle(c,force){const set=new Set((el.className||'').split(/\s+/).filter(Boolean));const on=force===undefined?!set.has(c):!!force;on?set.add(c):set.delete(c);el.className=[...set].join(' ');return on;},add(c){this.toggle(c,true);},remove(c){this.toggle(c,false);},contains(c){return (el.className||'').split(/\s+/).includes(c);}};}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  set textContent(v){this.children=[];this._text=String(v??'');}
  get value(){return this.attributes.value??this._value??'';}
  set value(v){this._value=String(v);}
  get hidden(){return !!this._hidden;}
  set hidden(v){this._hidden=!!v;}
  get disabled(){return !!this._disabled;}
  set disabled(v){this._disabled=!!v;}
  get id(){return this.attributes.id||'';}
  walk(fn){fn(this);for(const c of this.children)c.walk&&c.walk(fn);}
}
class TextNode{constructor(t){this._text=String(t);this.children=[];this.parent=null;}get textContent(){return this._text;}}

function parseHtml(html){
  const root=new El('root');
  const stack=[root];
  const voidTags=new Set(['IMG','INPUT','META','BR','LINK','HR','SOURCE']);
  const re=/<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while((m=re.exec(html))){
    const [,closing,tag,attrText,selfClose,text]=m;
    if(text!==undefined){if(text.trim())stack[stack.length-1].appendChild(new TextNode(text));continue;}
    if(closing){for(let i=stack.length-1;i>0;i--)if(stack[i].tagName===tag.toUpperCase()){stack.length=i;break;}continue;}
    const el=new El(tag);
    const attrRe=/([\w-]+)(?:="([^"]*)")?/g;let a;
    while((a=attrRe.exec(attrText||'')))el.setAttribute(a[1],a[2]??'');
    stack[stack.length-1].appendChild(el);
    if(!selfClose&&!voidTags.has(el.tagName))stack.push(el);
  }
  return root;
}
function matches(el,sel){
  if(!(el instanceof El))return false;
  const m=sel.match(/^(?:([a-z][\w-]*))?((?:\.[\w-]+)*)\[([\w-]+)\]$/)||sel.match(/^(?:([a-z][\w-]*))?((?:\.[\w-]+)+)$/);
  if(!m)return false;
  const tag=m[1],classes=(m[2]||'').split('.').filter(Boolean),attr=m[3];
  if(tag&&el.tagName!==tag.toUpperCase())return false;
  const have=(el.className||'').split(/\s+/);
  if(classes.some(c=>!have.includes(c)))return false;
  if(attr&&!(attr in el.attributes))return false;
  return true;
}
function makeDocument(root){
  const all=[];root.walk(el=>{if(el instanceof El)all.push(el);});
  return {
    _root:root,
    getElementById:id=>all.find(el=>el.attributes.id===id)||null,
    querySelector:sel=>all.find(el=>matches(el,sel))||null,
    querySelectorAll:sel=>all.filter(el=>matches(el,sel)),
    createElement:tag=>new El(tag),
    createTextNode:t=>new TextNode(t),
  };
}
function fire(el,type,extra={}){for(const fn of el.listeners[type]||[])fn({target:el,...extra});}

/** 生成报告并在迷你 DOM 中真实执行其页内脚本，返回可操作文档。 */
function renderReport(profile,{mode='demo'}={}){
  const html=buildReport(profile,{mode});
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  assert.ok(scripts.length>=2,'报告应包含数据与交互两段脚本');
  const root=parseHtml(html);
  const document=makeDocument(root);
  const opened=[];
  const sandbox={document,open:url=>{opened.push(url);},URL}; // URL 在浏览器中原生存在；vm 裸上下文需显式提供
  sandbox.window=sandbox;
  const context=vm.createContext(sandbox);
  for(const code of scripts)vm.runInContext(code,context);
  return {document,opened,html};
}

function syntheticProfile(){
  const now=new Date().toISOString();
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const books=[
    {id:'a',title:'进度之书',author:'作者甲',cover:'https://wf.qpic.com/a.png',progress:42,done:false,lastRead:1,deepLink:'https://weread.qq.com/web/reader/a',rating:null,weeklySeconds:600,reviewCount:null,highlightCount:null,bookmarkCount:null,finishDate:null,notesFetchedAt:now},
    {id:'b',title:'未知进度之书',author:'作者乙',cover:null,progress:null,done:false,lastRead:2,deepLink:null,rating:null,weeklySeconds:null,reviewCount:null,highlightCount:null,bookmarkCount:null,finishDate:null,notesFetchedAt:null},
    {id:'c',title:'已读完之书',author:'作者丙',cover:null,progress:100,done:true,lastRead:3,deepLink:null,rating:null,weeklySeconds:null,reviewCount:null,highlightCount:null,bookmarkCount:null,finishDate:today,notesFetchedAt:null},
    {id:'d',title:'零进度之书',author:'作者丁',cover:null,progress:0,done:false,lastRead:4,deepLink:null,rating:null,weeklySeconds:null,reviewCount:null,highlightCount:null,bookmarkCount:null,finishDate:null,notesFetchedAt:null},
    {id:'e',title:'坏链接之书',author:'作者戊',cover:'https://evil.example.com/x.png',progress:5,done:false,lastRead:5,deepLink:'https://evil.example.com/steal',rating:null,weeklySeconds:null,reviewCount:null,highlightCount:null,bookmarkCount:null,finishDate:null,notesFetchedAt:null},
    {id:'f',title:'协议外封面之书',author:'作者己',cover:'javascript:alert(1)',progress:5,done:false,lastRead:6,deepLink:null,rating:null,weeklySeconds:null,reviewCount:null,highlightCount:null,finishDate:null,notesFetchedAt:null},
    ...Array.from({length:130},(_,i)=>({id:'bulk-'+i,title:'批量书'+i,author:'作者',cover:null,progress:10,done:false,lastRead:100+i,deepLink:null,rating:null,weeklySeconds:null,reviewCount:null,highlightCount:null,bookmarkCount:null,finishDate:null,notesFetchedAt:null})),
  ];
  const notes=[
    {id:'n1',bookId:'a',title:'进度之书',chapter:'第一章',quote:'划线的原文',thought:'',date:today,type:'highlight',deepLink:'https://weread.qq.com/web/reader/a'},
    {id:'n2',bookId:'a',title:'进度之书',chapter:'第二章',quote:'',thought:'只有想法没有划线',date:today,type:'thought',deepLink:null},
    {id:'n3',bookId:'a',title:'进度之书',chapter:'第三章',quote:'原文与想法同在',thought:'我的想法同在',date:today,type:'thought',deepLink:null},
    {id:'evil-1',bookId:'a',title:'</script><script>alert(1)</script>',chapter:'<img src=x onerror=alert(1)>',quote:'"><script>alert(2)</script>',thought:'\'--></style><iframe onload=alert(3)>',date:today,type:'thought',deepLink:'https://evil.example.com/x'},
  ];
  return {schema:1,mode:'demo',settings:{goal:30,timeZone:'Asia/Shanghai',primaryBookId:'a'},
    snapshot:{syncedAt:now,books,notes,
      weekly:{start:today,end:today,totalSeconds:600,readDays:1,days:{[today]:600},fetchedAt:now,source:'测试'},
      monthly:{start:today.slice(0,8)+'01',end:today,totalSeconds:600,readDays:1,days:{[today]:600},fetchedAt:now,source:'测试'},
      totals:{notebookBooks:1,notes:4,ebooks:books.length,albums:0,articles:0},warnings:[]},
    cards:[{id:'card-1',title:'已存卡片',body:'卡片正文',kind:'card',createdAt:now,updatedAt:now,noteIds:[],origin:'local'}],
    reflections:[]};
}

test('report UI: shelf cards show progress text and initial rendering is bounded with working paging',()=>{
  const {document}=renderReport(syntheticProfile());
  const grid=document.getElementById('shelf-grid');
  const rendered=()=>grid.children.filter(c=>c.tagName==='ARTICLE');
  assert.ok(rendered().length===60,'首屏最多渲染 60 本，实际 '+rendered().length);
  assert.ok(rendered().some(c=>c.textContent.includes('已读 42%')),'书架卡片必须显示阅读进度');
  const more=document.getElementById('shelf-more');
  assert.equal(more.hidden,false,'130+ 本书时“再看 60 本”应可用');
  fire(more,'click');
  assert.ok(rendered().length===120,'点击后应渲染 120 本');
  fire(more,'click');
  assert.equal(more.hidden,true,'全部渲染后加载按钮应隐藏');
});

test('report UI: unread filter excludes unknown progress; search works and resets paging',()=>{
  const {document}=renderReport(syntheticProfile());
  const grid=document.getElementById('shelf-grid');
  const titles=()=>grid.textContent;
  const unreadTab=document.querySelectorAll('[data-shelf]').find(b=>b.dataset.shelf==='unread');
  fire(unreadTab,'click');
  assert.ok(!titles().includes('未知进度之书'),'进度未知不得计入“未开始”');
  assert.ok(titles().includes('零进度之书'),'确为 0 进度的书应在“未开始”');
  assert.ok(!titles().includes('已读完之书'),'已读完不得计入“未开始”');
  const allTab=document.querySelectorAll('[data-shelf]').find(b=>b.dataset.shelf==='all');
  fire(allTab,'click');
  const search=document.getElementById('shelf-search');
  search.value='批量书1';fire(search,'input');
  assert.ok(titles().includes('批量书1')&&!titles().includes('进度之书'),'搜索应只保留匹配书名');
  const more=document.getElementById('shelf-more');
  assert.ok(more.hidden,'匹配数 ≤60 时加载按钮应隐藏（分页计数已重置）');
});

test('report UI: notes keep thought-only content and the book filter can switch back to all',()=>{
  const {document}=renderReport(syntheticProfile());
  const list=document.getElementById('notes-list');
  assert.ok(list.textContent.includes('只有想法没有划线'),'无划线的想法笔记必须显示想法正文');
  assert.ok(list.textContent.includes('我的想法同在'),'划线+想法的笔记必须显示想法');
  assert.ok(list.textContent.includes('我的想法：我的想法同在'),'同时存在时应标注为“我的想法”');
  const sel=document.getElementById('notes-book');
  assert.equal(sel.children[0].value,'all','首项必须是 value="all" 的“所有已载入笔记”');
  assert.ok(!sel.children.some(o=>o.value==='b'),'下拉只列有已载入笔记的书');
  // 选中具体书再切回“所有”
  sel.value='a';fire(sel,'change');
  assert.ok(document.getElementById('notes-count').textContent.includes('4 / 4'),'选书后只显示该书笔记');
  sel.value='all';fire(sel,'change');
  assert.ok(document.getElementById('notes-list').textContent.includes('只有想法没有划线'),'切回 all 必须恢复显示全部笔记');
  // 搜索只命中想法正文
  const search=document.getElementById('notes-search');
  search.value='只有想法';fire(search,'input');
  assert.ok(document.getElementById('notes-count').textContent.trim().startsWith('显示 1 / 1'));
});

test('report UI: malicious note payload is present only as inert text; links and covers are sanitized',()=>{
  const {document,opened}=renderReport(syntheticProfile());
  const list=document.getElementById('notes-list');
  assert.ok(list.textContent.includes('</script><script>alert(1)</script>'),'负载必须完整呈现为纯文本');
  assert.ok(list.textContent.includes('<img src=x onerror=alert(1)>'));
  const liveTags=[];list.walk(el=>{if(['SCRIPT','IFRAME','IMG'].includes(el.tagName))liveTags.push(el.tagName);});
  assert.deepEqual(liveTags,[],'笔记区域不得生成 script/iframe/img 元素');
  // 封面白名单：不允许的 https 主机与 javascript: 协议都用占位符
  assert.ok(!list.textContent.includes('https://evil.example.com/x'),'恶意 deepLink 不得以链接形式出现');
  // 书架中的坏封面/坏链接
  const grid=document.getElementById('shelf-grid');
  const cards=grid.children.filter(c=>c.tagName==='ARTICLE');
  const badCover=cards.find(c=>c.textContent.includes('协议外封面之书'));
  assert.ok(badCover.textContent.includes('封面暂不可用'),'javascript: 封面必须降级为占位符');
  const badLink=cards.find(c=>c.textContent.includes('坏链接之书'));
  const btn=badLink.children.find(c=>c.tagName==='BUTTON');
  assert.equal(btn.disabled,true,'非微信读书域名 deepLink 不得可点击');
  const goodLink=cards.find(c=>c.textContent.includes('进度之书'));
  const goodBtn=goodLink.children.find(c=>c.tagName==='BUTTON');
  fire(goodBtn,'click');
  assert.deepEqual(opened,['https://weread.qq.com/web/reader/a'],'只允许打开微信读书域名链接');
});
