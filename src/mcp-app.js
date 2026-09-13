import { App } from '@modelcontextprotocol/ext-apps';
const app=new App({name:'读书搭子',version:'0.1.0'},{});
let state=null;
const $=id=>document.getElementById(id);
const duration=s=>s==null?'待同步':`${Math.floor(s/3600)?Math.floor(s/3600)+'小时':''}${Math.floor(s%3600/60)}分钟`;
function show(result){const d=result.structuredContent;if(!d)return;state=d;$('mode').textContent=d.mode==='demo'?'示例体验':'我的微信读书';$('title').textContent=d.primaryBook?.title||'今天，给自己留一段专注时间';$('author').textContent=d.primaryBook?.author||'连接微信读书后，开始你的阅读。';$('today').textContent=duration(d.todaySeconds);$('week').textContent=duration(d.weeklySeconds);$('progress').textContent=d.primaryBook?.progress==null?'进度待同步':`已读 ${d.primaryBook.progress}%`;$('status').textContent=d.syncedAt?'记录更新于 '+new Date(d.syncedAt).toLocaleString('zh-CN'):'尚未同步';}
app.ontoolresult=show;
$('refresh').addEventListener('click',async()=>{try{$('refresh').disabled=true;show(await app.callServerTool({name:'reading_open_dashboard',arguments:{mode:state?.mode||'live'}}));}catch{$('status').textContent='暂时无法刷新，请打开完整看板。';}finally{$('refresh').disabled=false;}});
$('open').addEventListener('click',async()=>{if(!state?.url)return;try{const r=await app.openLink({url:state.url});if(r.isError)$('status').textContent='请在浏览器打开：'+state.url;}catch{$('status').textContent='请在浏览器打开：'+state.url;}});
app.connect().catch(()=>{$('status').textContent='此界面需要支持 MCP Apps 的 WorkBuddy 客户端。请使用独立阅读看板。';});
