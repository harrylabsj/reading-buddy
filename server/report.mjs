import {readerView,demoReaders} from './readers.mjs';
import {writePrivate} from './storage.mjs';
import {dayKey,periodRange,duration,safeCover,safeLink} from './domain.mjs';
import {readFileSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsonForScript=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');

// 复用仓库已生成的图片素材（不新造插图）：优先取 Skill 包内 assets/，其次源码仓库 public/assets/。
const here=dirname(fileURLToPath(import.meta.url));
const ASSET_DIRS=[join(here,'..','assets'),join(here,'assets'),join(here,'..','public','assets')];
function loadAsset(name){for(const dir of ASSET_DIRS){try{return readFileSync(join(dir,name));}catch{}}return null;}
const pngDataUri=buf=>buf?'data:image/png;base64,'+buf.toString('base64'):null;

function bars(period,today,goal){
 if(!period)return '<p class="muted">本周期统计数据尚未同步。</p>';
 const days=period.days||{},max=Math.max(goal*60,...Object.values(days),1);
 const cells=[];const range=periodRange(today,period.end===period.start||period.start.endsWith('01')&&period.end.slice(0,7)===period.start.slice(0,7)?'monthly':'weekly');
 for(let d=new Date(range.start+'T12:00:00Z'),end=new Date(today+'T12:00:00Z');d<=end;d=new Date(d.getTime()+86400000)){const key=d.toISOString().slice(0,10),v=days[key];
  cells.push(`<div class="bar-column${key===today?' is-today':''}" title="${key}${v!=null?' · '+duration(v):' · 暂不可用'}"><div class="bar-track">${v!=null?`<span class="bar" style="height:${Math.round(v/max*100)}%"></span>`:'<span class="bar unknown"></span>'}</div><small>${d.getUTCDate()}日</small></div>`);}
 return `<div class="chart-area"><div class="chart-guide"><span>${duration(max)}</span><span>0</span></div><div class="bar-row">${cells.join('')}</div></div>`;
}

export function buildReport(profile,{mode='live',generatedAt=new Date().toISOString(),syncError=null}={}){
 const settings=profile.settings,snapshot=profile.snapshot,today=dayKey(new Date(),settings.timeZone);
 const weekly=snapshot?.weekly,monthly=snapshot?.monthly,validWeekly=weekly?.end===today,validMonthly=monthly?.end===today;
 const primary=snapshot?.books.find(b=>b.id===settings.primaryBookId)||snapshot?.books[0]||null;
 const todaySeconds=validWeekly&&weekly.days[today]!=null?weekly.days[today]:null;
 const todayMins=todaySeconds===null?null:Math.floor(todaySeconds/60);
 const gap=todayMins===null?null:Math.max(0,settings.goal-todayMins);
 const finished=(snapshot?.books||[]).filter(b=>b.finishDate&&weekly&&b.finishDate>=weekly.start&&b.finishDate<=today);
 const demoCoverUri=pngDataUri(loadAsset('demo-book.png'));
 const heroImageUri=pngDataUri(loadAsset('reading-light.png'));
 const reportCover=cover=>cover==='/assets/demo-book.png'?(demoCoverUri||null):(safeCover(cover)||null);
 const discoveries=profile.readerDiscoveries?.length?profile.readerDiscoveries:(mode==='demo'?[demoReaders()]:[]);
 const data={readers:discoveries.map(s=>({id:s.id,title:s.title,query:s.query,fetchedAt:s.fetchedAt,coverage:s.coverage,demo:s.demo,views:Object.fromEntries(['popular','resonance','perspective'].map(v=>[v,readerView(s,v).map(c=>({...c,url:s.demo?null:safeLink(c.url)}))]))})),mode,today,settings:{goal:settings.goal},primaryBookId:settings.primaryBookId,
  books:(snapshot?.books||[]).map(b=>({id:b.id,title:b.title,author:b.author,cover:reportCover(b.cover),progress:b.progress,done:b.done,weeklySeconds:b.weeklySeconds,finishDate:b.finishDate,deepLink:safeLink(b.deepLink)})),
  notes:(snapshot?.notes||[]).map(n=>({id:n.id,bookId:n.bookId,title:n.title,chapter:n.chapter,quote:n.quote,thought:n.thought,date:n.date,chapterUid:n.chapterUid,range:n.range,type:n.type,deepLink:safeLink(n.deepLink)})),
  weekly:weekly?{start:weekly.start,end:weekly.end,totalSeconds:weekly.totalSeconds,readDays:weekly.readDays,days:weekly.days,fetchedAt:weekly.fetchedAt,valid:validWeekly}:null,
  monthly:monthly?{start:monthly.start,end:monthly.end,totalSeconds:monthly.totalSeconds,readDays:monthly.readDays,days:monthly.days,fetchedAt:monthly.fetchedAt,valid:validMonthly}:null,
  cards:(profile.cards||[]).map(c=>({id:c.id,title:c.title,body:c.body,kind:c.kind,updatedAt:c.updatedAt}))};
 return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>读书搭子 · 本机阅读报告</title>
<style>
:root{--paper:#faf8f3;--card:#fffdf8;--ink:#302d28;--muted:#8a8c91;--amber:#9d5523;--line:#e9e4da;--serif:"Noto Serif SC","Songti SC",STSong,serif}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
button,input,select{font:inherit}button{cursor:pointer;border:0;background:none;color:inherit}h1,h2,h3,p{margin:0}
a{color:var(--amber)}
.layout{display:grid;grid-template-columns:220px 1fr;min-height:100vh}
.side{border-right:1px solid var(--line);padding:34px 18px;position:sticky;top:0;height:100vh;background:var(--paper)}
.brand{font-family:var(--serif);font-size:24px;letter-spacing:2px;color:#242520;font-weight:700}
.brand small{display:block;font-size:11px;letter-spacing:3px;color:var(--muted);margin-top:8px;font-weight:400}
.side nav{display:flex;flex-direction:column;gap:8px;margin-top:42px}
.side nav button{text-align:left;padding:14px 16px;border-radius:9px;font-size:16px;color:#686b73;letter-spacing:.05em}
.side nav button:hover{background:#f2ede5}.side nav button.active{color:var(--amber);background:#f6eadb}
.side .foot{position:absolute;bottom:26px;left:18px;right:18px;font-size:11px;color:#a09e97;line-height:1.9}
main{padding:38px 46px;max-width:1180px;min-width:0;width:100%}
.page{display:none}.page.active{display:block}
.intro h1{font-family:var(--serif);font-size:clamp(28px,3vw,40px);letter-spacing:.03em;line-height:1.6;color:#242720}
.intro p{font-family:var(--serif);color:#7c8084;letter-spacing:1.5px;margin-top:6px;font-size:15px}
.hero{position:relative;display:flex;gap:34px;align-items:center;background:#f2ece1;padding:38px;margin-top:24px;overflow:hidden;border-radius:4px;min-height:280px}
.hero-background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;opacity:.55;z-index:0}
.hero-book{flex:0 0 150px;text-align:center;z-index:1}
.cover{width:100%;max-width:150px;aspect-ratio:2/3;object-fit:cover;border-radius:2px;box-shadow:3px 10px 20px #4335231c}
.cover-ph{width:100%;max-width:150px;aspect-ratio:2/3;margin:0 auto;display:flex;align-items:center;justify-content:center;background:#ebe6da;border:1px solid #dfd8ca;color:#ab9b85;font-size:11px;letter-spacing:2px;padding:10px;text-align:center}
.hero-copy{flex:1;min-width:0;z-index:1;max-width:520px}
.eyebrow{font-size:10px;letter-spacing:2.5px;color:#aa7a50;margin-bottom:10px;display:block}
.hero-copy h2{font-family:var(--serif);font-size:clamp(24px,2.4vw,34px);color:#805025;font-weight:500;letter-spacing:1.5px;line-height:1.6;margin-bottom:16px}
.author{font-size:12px;color:#6a6b63;margin:4px 0 18px}
.progress-caption{display:flex;gap:14px;align-items:center;font-size:12px;color:#6e6c65;margin-bottom:8px}.progress-caption strong{color:var(--amber);font-size:15px;font-weight:500}
.progress-track{background:#dfdbd1;height:5px;border-radius:5px;overflow:hidden;max-width:330px}.progress-track>span{display:block;background:#b27944;height:100%;border-radius:5px}
.muted{color:#83868b;font-size:14px;line-height:1.85}.small{font-size:12px}
.today-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;margin-top:30px}
.today-grid>section{padding:0 32px}.today-grid>section:first-child{padding-left:0;border-right:1px solid var(--line)}
.today-grid h2,.panel h2{font-family:var(--serif);font-size:21px;display:flex;align-items:center;gap:10px}
.today-grid h2::before,.panel h2::before{content:"";width:6px;height:20px;background:var(--amber);border-radius:3px}
.stat-strong{font-family:var(--serif);font-size:30px;color:#965b29;font-weight:500;margin-top:12px}
.chart-area{display:flex;gap:12px;height:160px;padding-top:14px;overflow-x:auto}
.chart-guide{display:flex;flex-direction:column;justify-content:space-between;padding-bottom:34px;min-width:46px;font-size:10px;color:#93969e}
.bar-row{flex:1;display:flex;gap:12px;border-top:1px solid #eeeae2;min-width:0}
.bar-column{flex:1;display:flex;flex-direction:column;align-items:center;min-width:0;gap:4px;font-size:10px;color:#9597a1}
.bar-column small{white-space:nowrap}
.bar-track{height:106px;display:flex;align-items:flex-end;width:100%;max-width:30px;border-bottom:1px solid var(--line)}
.bar{width:100%;background:#e2c6a5;border-radius:3px 3px 0 0}.bar-column.is-today .bar{background:#be8b52}.bar-column.is-today{color:var(--amber)}
.bar.unknown{border:1px dashed #cfcac0;background:transparent}
.toolbar{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:22px 0 8px}
.tabs{display:flex;gap:7px;flex-wrap:wrap}.tabs button{padding:10px 16px;border-radius:8px;font-size:13px;background:#f1eee7;color:#72736e}.tabs button.active{background:var(--amber);color:#fff}
.search{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:8px;padding:0 12px;background:#fffdfa;color:#93958c}
.search input{border:0;padding:9px 0;width:200px;background:none;font-size:13px;outline:none}
select{border:1px solid var(--line);border-radius:8px;background:#fffdfa;padding:9px 12px;font-size:13px;max-width:280px}
.count-caption{font-size:11px;color:#96968e;margin:10px 0 18px;line-height:1.8}
.book-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:30px 22px}
.book-card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:16px;text-align:center}
.book-card .cover,.book-card .cover-ph{max-width:110px;margin:0 auto}
.book-card h3{font-family:var(--serif);font-size:15px;margin-top:12px;line-height:1.6}
.book-card p{font-size:11px;color:#8a8c8d;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{display:inline-block;font-size:10px;background:#f6eadb;color:#985c2a;padding:3px 8px;border-radius:3px;margin-top:8px}
.note-list{border-top:1px solid var(--line)}
.note-row{padding:18px 6px;border-bottom:1px solid var(--line)}
.note-quote{font-family:var(--serif);font-size:15px;line-height:1.9;overflow-wrap:anywhere}
.note-thought{font-size:13px;color:#7b7a70;margin-top:10px;line-height:1.8;overflow-wrap:anywhere}
.note-meta{font-size:11px;color:#929390;margin-top:10px}
.load-more{display:flex;margin:26px auto;padding:11px 18px;border-radius:8px;border:1px solid #d6b894;color:var(--amber);font-size:13px;background:#fffdf866}
.panel{background:#f3ede2;border-radius:4px;padding:26px 30px;margin-top:22px}
.review-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.review-stats span{display:block;font-size:12px;color:#8b8984}.review-stats strong{display:block;font-family:var(--serif);font-size:30px;color:#965b29;margin-top:10px;font-weight:500}
.finished-row{display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--line);font-size:13px}.finished-row>span{flex:1}.finished-row small{color:#9e9e96}
.card-row{padding:16px 6px;border-bottom:1px solid var(--line)}
.card-row h3{font-family:var(--serif);font-size:16px;font-weight:500}.card-row small{color:#95948e;font-size:11px;display:block;margin-top:6px}
.card-body{font-family:var(--serif);font-size:13px;color:#6e6c65;margin-top:10px;white-space:pre-wrap;line-height:1.9;max-height:130px;overflow:hidden;overflow-wrap:anywhere}
.reader-grid{display:grid;gap:16px;margin-top:18px}.reader-card{padding:24px;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow-wrap:anywhere}.reader-card h3{font-family:var(--serif);font-size:20px}.reader-card blockquote{margin:16px 0;padding-left:16px;border-left:3px solid #d8c2a3;font-size:15px;line-height:1.9;white-space:pre-wrap}.reader-card .reader-reason{margin:14px 0 8px;font-size:14px;line-height:1.8}.reader-card a{display:inline-block;margin-top:16px;font-size:14px}.reader-entry{display:block;margin-top:12px;color:var(--amber);font-size:13px;border:1px solid #d6b894;border-radius:6px;padding:8px 12px}.request-box{margin-top:24px;padding:20px;background:#f3ede2;border-radius:8px}.request-box label{display:block;font-size:14px;margin-bottom:10px}.request-box textarea{font:inherit;width:100%;min-height:88px;resize:vertical;border:1px solid #d6cec0;border-radius:6px;background:#fffdf8;padding:12px;line-height:1.7}.request-box button{margin-top:8px;padding:9px 14px;background:var(--amber);color:white;border-radius:6px}.reader-toolbar select{max-width:100%}.reader-question{margin:12px 0;line-height:1.8;color:#805025}
.empty{padding:50px 20px;text-align:center;color:#96958f;line-height:2}
.notice{padding:12px 15px;background:#fff0df;color:#8c4c23;font-size:12px;margin:16px 0;border:1px solid #efd6b4;border-radius:8px;line-height:1.8}
footer{margin-top:40px;border-top:1px solid var(--line);padding:20px 0;font-size:10px;color:#a09e97;letter-spacing:1px;line-height:2}
@media(max-width:820px){.layout{grid-template-columns:1fr}.side{position:static;height:auto;display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:16px}.side nav{flex-direction:row;margin:0;flex-wrap:wrap}.side nav button{padding:9px 12px;font-size:13px}.side .foot{display:none}main{padding:22px 18px}.today-grid{grid-template-columns:1fr}.today-grid>section{padding:0;border:0}.today-grid>section+section{margin-top:26px}.hero{flex-direction:column;align-items:flex-start}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
@media(max-width:480px){.review-stats strong{font-size:24px}}
</style>
</head>
<body>
<div class="layout">
<aside class="side">
<div class="brand">读书搭子<small>本机阅读报告</small></div>
<nav aria-label="报告导航">
<button data-tab="today" class="active">今日阅读</button>
<button data-tab="shelf">我的书架</button>
<button data-tab="notes">笔记回顾</button>
<button data-tab="readers">发现读友</button>
<button data-tab="review">阅读复盘</button>
</nav>
<p class="foot">个人数据保存在用户本机<br>此报告为只读快照，不含任何凭证</p>
</aside>
<main>
<div class="notice" role="status">${mode==='demo'?'这是独立的示例工作台，展示虚构书籍和笔记。':`数据更新于 ${esc(snapshot?.syncedAt||'尚未同步')}。${snapshot?.weekly?.end!==today?'阅读统计需要刷新。':''}`} 页面为只读快照；需要最新内容时，让读书搭子“更新我的阅读工作台”。${syncError?'<br>本次更新未完成，显示已有快照：'+esc(syncError):''}${(snapshot?.books||[]).some(b=>b.notesSync?.complete===false)?'<br>部分书籍笔记仍在补齐中，已保留历史缓存。':''}${(snapshot?.warnings||[]).length?'<br>'+snapshot.warnings.map(esc).join('；'):''}</div>
<section class="page active" id="page-today">
<div class="intro"><h1>今天，给自己留一段专注时间</h1><p>${esc(today)} · ${mode==='demo'?'示例数据':'个人数据'} · 每日目标 ${esc(settings.goal)} 分钟</p></div>
${primary?`<div class="hero">${heroImageUri?`<img class="hero-background" src="${heroImageUri}" alt="" aria-hidden="true" referrerpolicy="no-referrer">`:''}<div class="hero-book">${reportCover(primary.cover)?`<img class="cover" src="${esc(reportCover(primary.cover))}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'cover-ph',textContent:'封面暂不可用'}))">`:`<div class="cover-ph">封面暂不可用</div>`}</div>
<div class="hero-copy"><span class="eyebrow">TODAY'S READING</span><h2>${todayMins===null?`给自己 ${esc(settings.goal)} 分钟，慢慢进入一本书。`:gap?`再读 ${esc(gap)} 分钟，给今天一个留白。`:`今天的阅读，已经好好留下。`}</h2>
<p class="author" data-book-title></p>
<div class="progress-caption"><span>阅读进度</span><strong data-book-progress></strong></div>
<div class="progress-track"><span data-book-bar style="width:0%"></span></div>
<p class="muted small" style="margin-top:10px">${todayMins===null?'今日时长待同步':`今日已读 ${esc(todayMins)} 分钟`} · 每日目标 ${esc(settings.goal)} 分钟</p></div></div>`:`<div class="empty">尚无主读书。连接并同步后，这里会显示今天值得继续的那本。<br>可以让 WorkBuddy 同步微信读书数据。</div>`}
<div class="today-grid"><section><h2>本周阅读节奏</h2><p class="stat-strong">${validWeekly?esc(duration(weekly.totalSeconds)):'待同步'}</p><div id="today-chart"></div><p class="count-caption">${validWeekly?'统计更新于 '+esc(weekly.fetchedAt):'本周统计尚未同步'} · 每日达到 1 分钟计为有效阅读日</p></section>
<section><h2>留住一个想法</h2><div id="today-note"></div></section></div>
</section>
<section class="page" id="page-shelf">
<div class="intro"><h1>把书架，变成下一次出发</h1><p>共 ${(snapshot?.books||[]).length} 本电子书${snapshot?.totals?.albums?` · 另有 ${esc(snapshot.totals.albums)} 个有声书/专辑（不展开）`:''}${snapshot?.totals?.articles?' · 1 个文章收藏入口（不展开）':''}</p></div>
<div class="toolbar"><div class="tabs" id="shelf-tabs">${['all|全部','reading|继续阅读','unread|未开始','finished|已读完'].map(s=>{const[id,label]=s.split('|');return `<button data-shelf="${id}" class="${id==='all'?'active':''}">${label}</button>`}).join('')}</div><label class="search">搜索 <input id="shelf-search" placeholder="书名或作者" aria-label="搜索书名或作者"></label></div>
<p class="count-caption" id="shelf-count"></p>
<div class="book-grid" id="shelf-grid"></div>
<button class="load-more" id="shelf-more" hidden>再看 60 本</button>
</section>
<section class="page" id="page-notes">
<div class="intro"><h1>读过的，慢慢变成自己的</h1><p>已载入 ${(snapshot?.notes||[]).length} 条划线与想法${snapshot?.totals?.notes!=null?` · 笔记总数 ${esc(snapshot.totals.notes)}（含书签数量）`:''}</p></div>
<div class="toolbar"><label class="search">搜索 <input id="notes-search" placeholder="笔记内容" aria-label="搜索笔记"></label><select id="notes-book" aria-label="按书籍筛选"></select></div>
<p class="count-caption" id="notes-count"></p>
<div class="note-list" id="notes-list"></div>
<button class="load-more" id="notes-more" hidden>再看 50 条</button>
<div class="panel"><h2>已保存的读书卡片</h2><div id="cards-list"></div></div>
</section>
<section class="page" id="page-readers">
<div class="intro"><h1>谁也在认真读这里</h1><p>从一段有共鸣的想法，发现值得继续了解的人。</p></div>
<div class="toolbar reader-toolbar"><select id="reader-session" aria-label="选择读友发现记录"></select></div>
<p class="reader-question" id="reader-question"></p>
<div class="tabs" id="reader-tabs"><button data-reader-view="popular" class="active">高赞想法</button><button data-reader-view="resonance">同频观点</button><button data-reader-view="perspective">不同视角</button></div>
<p class="count-caption" id="reader-coverage"></p>
<div class="reader-grid" id="reader-grid"></div>
<div class="request-box"><label for="reader-request">继续发现 · 把这句话发给读书搭子</label><textarea id="reader-request" readonly></textarea><button id="reader-copy">复制请求</button><p class="muted small" id="reader-copy-status" role="status">在对话中查找后，重新生成工作台即可看到结果。</p></div>
<p class="muted small" style="margin-top:20px">高赞来自本次取得的公开内容。推荐理由关注具体观点，不代表对作者本人的评价。点击“查看原始想法”在微信读书中继续了解对方。</p>
</section>
<section class="page" id="page-review">
<div class="intro"><h1>每一页，都算数</h1><p>只呈现已核对的完成日期与已载入笔记，缺口保持空白。</p></div>
<div class="toolbar"><div class="tabs" id="review-tabs"><button data-period="weekly" class="active">本周回顾</button><button data-period="monthly">本月回顾</button></div></div>
<div class="panel"><div class="review-stats">
<div><span>累计阅读与收听</span><strong id="rv-total"></strong></div>
<div><span>有效阅读天数</span><strong id="rv-days"></strong></div>
<div><span>本机已保存回顾</span><strong>${(profile.reflections||[]).length} 次</strong></div>
</div><div id="rv-chart"></div><p class="count-caption" id="rv-caption"></p></div>
<div class="panel"><h2>读完，值得记一笔</h2><div id="rv-finished"></div><p class="muted small">仅展示有明确完成日期的记录；暂无记录不等于本期没有读完。</p></div>
<div class="panel"><h2>已保存的复盘</h2><div id="rv-cards"></div></div>
</section>
<footer>读书搭子 · 本机阅读报告 · 生成于 ${esc(generatedAt)}<br>此报告为只读快照：页内的搜索、筛选与切换只影响显示，不会修改或上传任何数据；需要更新数据或保存卡片时，请在 WorkBuddy 中让读书搭子同步或保存。<br>${mode==='demo'?'示例报告的插图与封面完全内嵌，打开时不会产生任何外部网络请求。':'报告插图已内嵌；微信读书的书籍封面会在浏览时从其图片域名加载，其余内容不联网。'}</footer>
</main>
</div>
<noscript><p class="notice">此报告的搜索与筛选需要浏览器脚本支持；数据本身已完整保存在生成它的本机。</p></noscript>
<script>window.__READING_REPORT__=${jsonForScript(data)};</script>
<script>
(function(){
"use strict";
var D=window.__READING_REPORT__;
var NOTE_BOOK_CAP=1000;
function $(id){return document.getElementById(id);}
function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined&&text!==null)n.textContent=String(text);return n;}
function fmtSec(s){if(s===null||s===undefined)return '暂不可用';var h=Math.floor(s/3600),m=Math.round(s%3600/60);return (h?h+'小时':'')+m+'分钟';}
// 客户端再做一层链接/封面白名单校验：封面只允许 https 的微信读书图片域名或本报告内嵌的 data URI；链接只允许微信读书域名或 weread: 深链。
function safeCoverUrl(u){if(typeof u!=='string'||!u)return null;if(u.indexOf('data:image/png;base64,')===0)return u;var x;try{x=new URL(u);}catch(e){return null;}if(x.protocol!=='https:')return null;var h=x.hostname;
 return h==='qpic.cn'||h==='qq.com'||h==='qlogo.cn'||h.indexOf('.qpic.cn')===h.length-8||h.indexOf('.qq.com')===h.length-7||h.indexOf('.qlogo.cn')===h.length-9?u:null;}
function safeLinkUrl(u){if(typeof u!=='string'||!u)return null;var x;try{x=new URL(u);}catch(e){return null;}
 return x.protocol==='weread:'||(x.protocol==='https:'&&(x.hostname==='weread.qq.com'||x.hostname.indexOf('.weread.qq.com')===x.hostname.length-13))?u:null;}
function coverNode(book){var u=safeCoverUrl(book.cover);if(!u)return el('div','cover-ph','封面暂不可用');var img=el('img');img.className='cover';img.referrerPolicy='no-referrer';img.loading='lazy';img.decoding='async';img.alt='';img.src=u;img.onerror=function(){img.replaceWith(el('div','cover-ph','封面暂不可用'));};return img;}
function barChart(node,period,goal){node.textContent='';if(!period){node.appendChild(el('p','muted','本周期统计数据尚未同步。'));return;}
 var days=period.days||{},max=Math.max(goal*60,1),k;for(k in days)if(days[k]>max)max=days[k];
 var area=el('div','chart-area'),guide=el('div','chart-guide');guide.appendChild(el('span','',fmtSec(max)));guide.appendChild(el('span','','0'));area.appendChild(guide);
 var row=el('div','bar-row'),start=new Date(period.start+'T12:00:00Z'),end=new Date(period.end+'T12:00:00Z');
 row.style.minWidth=(Math.max(1,Math.round((end-start)/86400000)+1)*24)+'px';
 for(var d=new Date(start);d<=end;d=new Date(d.getTime()+86400000)){var key=d.toISOString().slice(0,10),v=days[key];var col=el('div','bar-column'+(key===D.today?' is-today':''));col.title=key+(v!=null?' · '+fmtSec(v):' · 暂不可用');
 var track=el('div','bar-track');if(v!=null){var bar=el('span','bar');bar.style.height=Math.round(v/max*100)+'%';track.appendChild(bar);}else track.appendChild(el('span','bar unknown'));
 col.appendChild(track);col.appendChild(el('small','',d.getUTCDate()+'日'));row.appendChild(col);}
 area.appendChild(row);node.appendChild(area);}
// 主导航
var navButtons=document.querySelectorAll('[data-tab]');
function switchPage(tab){navButtons.forEach(function(x){x.classList.toggle('active',x.dataset.tab===tab);});document.querySelectorAll('.page').forEach(function(p){p.classList.toggle('active',p.id==='page-'+tab);});}
navButtons.forEach(function(b){b.addEventListener('click',function(){switchPage(b.dataset.tab);});});
// 今日
var pb=D.books.find(function(b){return b.id===D.primaryBookId;})||D.books[0];
if(pb){var at=document.querySelector('.author[data-book-title]');if(at)at.textContent=pb.title+(pb.author?' · '+pb.author:'');
 var ps=document.querySelector('[data-book-progress]');if(ps)ps.textContent=pb.done?'已读完':pb.progress===null?'待同步':pb.progress+'%';
 var pbar=document.querySelector('[data-book-bar]');if(pbar)pbar.style.width=(pb.progress||0)+'%';}
barChart($('today-chart'),D.weekly,D.settings.goal);
(function(){var box=$('today-note');var notes=D.notes.filter(function(n){return n.quote||n.thought;});
 if(!notes.length){box.appendChild(el('p','muted','还没有已载入的笔记。同步后，最近的想法会出现在这里。'));return;}
 var n=notes[0];box.appendChild(el('p','note-quote',n.thought||n.quote));
 box.appendChild(el('p','note-meta','《'+n.title+'》'+(n.chapter?' · '+n.chapter:'')+(n.type==='thought'?' · 我的想法':' · 划线')+' · '+(n.date||'日期待同步')));})();
// 书架：首屏限定渲染数量并提供“再看 60 本”，搜索/筛选重置计数；进度未知不等于未开始。
var shelfFilter='all',shelfQuery='',shelfLimit=60;
function shelfMatch(b){if(shelfFilter==='reading'&&(b.done||!(b.progress>0)))return false;
 if(shelfFilter==='unread'&&(b.done||b.progress==null||b.progress>0))return false;
 if(shelfFilter==='finished'&&!b.done)return false;
 if(shelfQuery&&(b.title+b.author).toLowerCase().indexOf(shelfQuery)<0)return false;return true;}
function renderShelf(){var grid=$('shelf-grid');grid.textContent='';var list=D.books.filter(shelfMatch);
 $('shelf-count').textContent='显示 '+Math.min(shelfLimit,list.length)+' / '+list.length+' 本'+(list.length!==D.books.length?'（书架共 '+D.books.length+' 本）':'')+' · 点击封面在微信读书中查看';
 list.slice(0,shelfLimit).forEach(function(b){var card=el('article','book-card');var btn=el('button');btn.style.cssText='width:100%;background:none;padding:0;text-align:center;';btn.appendChild(coverNode(b));
 var link=safeLinkUrl(b.deepLink);if(link)btn.addEventListener('click',function(){window.open(link,'_blank','noopener');});else btn.disabled=true;card.appendChild(btn);
 card.appendChild(el('h3','',b.title));card.appendChild(el('p','',b.author||'作者待同步'));
 card.appendChild(el('p','small',(b.done?'已读完':b.progress===null?'进度待同步':'已读 '+b.progress+'%')+(b.weeklySeconds!=null?' · 本周 '+fmtSec(b.weeklySeconds):'')));
 if(b.id===D.primaryBookId)card.appendChild(el('span','tag','主读中'));var discover=el('button','reader-entry','找这本书的读友');discover.addEventListener('click',function(){openReaders(b);});card.appendChild(discover);grid.appendChild(card);});
 if(!list.length)grid.appendChild(el('p','empty','没有找到符合条件的书籍。'));
 $('shelf-more').hidden=list.length<=shelfLimit;}
document.querySelectorAll('[data-shelf]').forEach(function(b){b.addEventListener('click',function(){shelfFilter=b.dataset.shelf;shelfLimit=60;document.querySelectorAll('[data-shelf]').forEach(function(x){x.classList.toggle('active',x===b);});renderShelf();});});
$('shelf-search').addEventListener('input',function(e){shelfQuery=e.target.value.trim().toLowerCase();shelfLimit=60;renderShelf();});
$('shelf-more').addEventListener('click',function(){shelfLimit+=60;renderShelf();});
renderShelf();
// 笔记：书籍下拉只列“已载入笔记”的书（而不是整库书架），首项固定 value='all'；正文支持只有想法的笔记。
var bookSel=$('notes-book');
var bookById={};D.books.forEach(function(b){bookById[b.id]=b;});
var noteBookIds=[],seenBook={};D.notes.forEach(function(n){if(n.bookId&&!seenBook[n.bookId]){seenBook[n.bookId]=1;noteBookIds.push(n.bookId);}});
var oAll=el('option','','所有已载入笔记');oAll.value='all';bookSel.appendChild(oAll);
noteBookIds.slice(0,NOTE_BOOK_CAP).forEach(function(id){var b=bookById[id];var o=el('option','',b?(b.title+(b.author?' · '+b.author:'')):id);o.value=id;bookSel.appendChild(o);});
var noteQuery='',noteBook='all',noteLimit=50,bookCapped=noteBookIds.length>NOTE_BOOK_CAP;
function renderNotes(){var list=$('notes-list');list.textContent='';var all=D.notes.filter(function(n){return (noteBook==='all'||n.bookId===noteBook)&&(!noteQuery||((n.quote||'')+(n.thought||'')+(n.chapter||'')).toLowerCase().indexOf(noteQuery)>=0);});
 $('notes-count').textContent='显示 '+Math.min(noteLimit,all.length)+' / '+all.length+' 条'+(noteBook==='all'&&D.notes.length!==all.length?'（筛选后）':'')+(bookCapped?' · 书籍筛选仅列出前 '+NOTE_BOOK_CAP+' 本有笔记的书，可配合搜索进一步定位':'')+' · 笔记为本机已载入部分，可按书继续同步';
 all.slice(0,noteLimit).forEach(function(n){var row=el('div','note-row');
  if(n.quote)row.appendChild(el('p','note-quote',n.quote));
  if(n.thought)row.appendChild(el('p',n.quote?'note-thought':'note-quote',n.quote?'我的想法：'+n.thought:n.thought));
  if(!n.quote&&!n.thought)row.appendChild(el('p','note-quote','（这条笔记没有文字内容）'));
  var meta='《'+n.title+'》'+(n.chapter?' · '+n.chapter:'')+' · '+(n.type==='thought'?'想法':'划线')+' · '+(n.date||'日期待同步');
  var link=safeLinkUrl(n.deepLink);var mp=el('p','note-meta',meta);if(link){var a=el('a','',link);a.href=link;a.target='_blank';a.rel='noopener';mp.textContent='';mp.appendChild(document.createTextNode(meta+' · '));mp.appendChild(a);}row.appendChild(mp);var discover=el('button','reader-entry','谁也在认真读这里');discover.addEventListener('click',function(){openReaders({id:n.bookId,title:n.title},n);});row.appendChild(discover);list.appendChild(row);});
 if(!all.length)list.appendChild(el('p','empty','当前条件下没有已载入的笔记。'));
 $('notes-more').hidden=all.length<=noteLimit;}
$('notes-search').addEventListener('input',function(e){noteQuery=e.target.value.trim().toLowerCase();noteLimit=50;renderNotes();});
bookSel.addEventListener('change',function(e){noteBook=e.target.value;noteLimit=50;renderNotes();});
$('notes-more').addEventListener('click',function(){noteLimit+=50;renderNotes();});
renderNotes();
(function(){var box=$('cards-list');var cards=D.cards.filter(function(c){return c.kind==='card';});
 if(!cards.length){box.appendChild(el('p','muted','还没有保存读书卡片。可以在 WorkBuddy 中让读书搭子根据选中的笔记整理草稿，确认后再保存。'));return;}
 cards.forEach(function(c){var row=el('div','card-row');row.appendChild(el('h3','',c.title));row.appendChild(el('small','','更新于 '+c.updatedAt));row.appendChild(el('p','card-body',c.body));box.appendChild(row);});})();
// 发现读友：数据在生成时写入，页面不调用接口、不建立账户或关系网络。
var readerViewName='popular',readerTarget=null;
var readerSelect=$('reader-session');
var readerPlaceholder=el('option','','选择一次发现，或从书架 / 笔记开始');readerPlaceholder.value='';readerSelect.appendChild(readerPlaceholder);
D.readers.forEach(function(s){var o=el('option','',s.title+(s.query.range?' · 一段原文':' · 全书讨论')+(s.query.question?' · '+s.query.question:''));o.value=s.id;readerSelect.appendChild(o);});
readerSelect.value=D.readers.length?D.readers[0].id:'';
function openReaders(book,note){
 readerTarget={book:book,note:note};
 var match=D.readers.find(function(s){return s.query.bookId===book.id&&(note?!!note.range&&s.query.range===note.range&&s.query.chapterUid===note.chapterUid:!s.query.range);});
 readerSelect.value=match?match.id:'';readerViewName='popular';switchPage('readers');renderReaders();
}
function renderReaders(){
 var s=D.readers.find(function(s){return s.id===readerSelect.value;});
 var box=$('reader-grid');box.textContent='';
 document.querySelectorAll('[data-reader-view]').forEach(function(b){b.classList.toggle('active',b.dataset.readerView===readerViewName);});
 $('reader-question').textContent=s?(s.query.question?'你关心的是：'+s.query.question:'从具体观点开始，慢慢了解一个人。'):(readerTarget?'《'+readerTarget.book.title+'》'+(readerTarget.note?' · 选定原文':''):'先选一本书，或一句让你停下来的话。');
 $('reader-coverage').textContent=s?(s.demo?'虚构示例 · ': '')+'采样于 '+new Date(s.fetchedAt).toLocaleString('zh-CN')+' · 已取得 '+s.coverage.sampled+' 条公开内容，其中 '+s.coverage.missingLikes+' 条未返回点赞数 · '+(s.query.range?'选定段落的讨论':'部分热门段落与书评')+'，不代表全书排行榜。'+s.coverage.warnings.join('；'):'';
 var rows=s?s.views[readerViewName]:[];
 rows.forEach(function(c){
  var card=el('article','reader-card');card.appendChild(el('h3','',c.name));
  card.appendChild(el('p','note-meta',(c.likes===null?'点赞数未提供':c.likes+' 个赞')+(c.date?' · '+c.date:'')+' · '+(c.source==='review'?'公开书评':'段落想法')));
  if(c.quote)card.appendChild(el('p','muted small','原文片段：'+c.quote));
  card.appendChild(el('blockquote','',c.content.slice(0,300)+(c.content.length>300||c.truncated?'…':'')));
  card.appendChild(el('p','reader-reason',(c.origin==='ai'?'值得读的理由 · AI 建议：':'发现线索：')+c.reason));
  card.appendChild(el('p','muted small',(c.origin==='ai'?'与你的关联 · AI 建议：':'与你的关联：')+c.connection));
  if(c.evidence)card.appendChild(el('p','note-meta','判断依据：「'+c.evidence+'」'));
  var link=s.demo?null:safeLinkUrl(c.url);if(link){var a=el('a','','查看原始想法 ↗');a.href=link;a.target='_blank';a.rel='noopener noreferrer';card.appendChild(a);}else card.appendChild(el('p','note-meta',s.demo?'虚构示例，不关联真实账号':'暂未取得可用的原文链接'));
  box.appendChild(card);
 });
 if(!rows.length)box.appendChild(el('p','empty',!s?'这里还没有读友发现记录。可以从下面这句话开始。':readerViewName==='popular'?'本次没有取得可用于高赞排序的内容；可以让专家阅读候选想法，看看是否有值得讨论的观点。':readerViewName==='resonance'&&!s.query.question?'先告诉读书搭子你关心的问题，再寻找相关的观点。':'这个视角还没有整理好的推荐。有依据的读友不足时，保持留白。'));
 var book=s?{id:s.query.bookId,title:s.title}:readerTarget?.book;
 var q='帮我找'+(book?'《'+book.title+'》':'一本我正在读的书')+'里值得继续了解的读友';
 var note=readerTarget?.note;
 if(note&&!s)q='帮我找《'+book.title+'》这段话下值得继续了解的读友：「'+(note.quote||note.thought).slice(0,240)+'」'+(note.range&&note.chapterUid!==undefined?'（章节 '+note.chapterUid+'，原文范围 '+note.range+'）':'。请先核对能否定位这段原文，找不到时不要替换为其他段落');
 else if(s?.query.range)q='帮我继续找《'+s.title+'》同一段原文下的读友（章节 '+s.query.chapterUid+'，原文范围 '+s.query.range+'）';
 q+='。'+(s?.query.question?'我关心的是：'+s.query.question+'。':'请先问我关心的问题。')+'请分别整理高赞想法、同频观点和不同视角，说明理由，保留原始想法链接，并更新本地工作台。';
 $('reader-request').value=q;
 $('reader-copy-status').textContent='在对话中查找后，重新生成工作台即可看到结果。';
}
readerSelect.addEventListener('change',function(){readerTarget=null;renderReaders();});
document.querySelectorAll('[data-reader-view]').forEach(function(b){b.addEventListener('click',function(){readerViewName=b.dataset.readerView;renderReaders();});});
$('reader-copy').addEventListener('click',async function(){try{await navigator.clipboard.writeText($('reader-request').value);$('reader-copy-status').textContent='已复制，请粘贴到与读书搭子的对话中。';}catch(e){$('reader-request').focus();$('reader-request').select();$('reader-copy-status').textContent='文字已选中，请复制后粘贴到对话中。';}});
renderReaders();
// 复盘
var period='weekly';
function renderReview(){var p=D[period];var valid=p&&p.valid;
 $('rv-total').textContent=valid?fmtSec(p.totalSeconds):'待同步';
 $('rv-days').textContent=valid?(p.readDays!=null?p.readDays+' 天':'—'):'—';
 barChart($('rv-chart'),p,D.settings.goal);
 $('rv-caption').textContent=p?('统计区间 '+p.start+' — '+p.end+' · 更新于 '+p.fetchedAt+(valid?'':' · 本期统计尚未同步')):'本周期统计数据尚未同步。';
 var box=$('rv-finished');box.textContent='';
 var fin=D.books.filter(function(b){return b.finishDate&&p&&b.finishDate>=p.start&&b.finishDate<=p.end;});
 if(!fin.length)box.appendChild(el('p','muted','暂无已核对的完成日期记录；不代表本期没有读完。'));
 fin.forEach(function(b){var row=el('div','finished-row');row.appendChild(el('span','',b.title));row.appendChild(el('small','',b.finishDate));box.appendChild(row);});
 var cb=$('rv-cards');cb.textContent='';
 var cards=D.cards.filter(function(c){return c.kind!=='card';});
 if(!cards.length)cb.appendChild(el('p','muted','还没有保存复盘。可以在 WorkBuddy 中让读书搭子生成本周/本月复盘草稿，确认后保存。'));
 cards.forEach(function(c){var row=el('div','card-row');row.appendChild(el('h3','',c.title));row.appendChild(el('small','','更新于 '+c.updatedAt));row.appendChild(el('p','card-body',c.body));cb.appendChild(row);});}
document.querySelectorAll('[data-period]').forEach(function(b){b.addEventListener('click',function(){period=b.dataset.period;document.querySelectorAll('[data-period]').forEach(function(x){x.classList.toggle('active',x===b);});renderReview();});});
renderReview();
})();
</script>
</body>
</html>`;
}

export function writeReport(file,profile,options={}){const target=resolve(file);writePrivate(target,buildReport(profile,options));return target;}
