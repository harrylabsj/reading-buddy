export const embedded=window.__READING_EMBEDDED__===true;
let csrf='',bridgePromise;
export function readMode(){if(embedded)return window.__READING_MODE__||'live';try{return localStorage.getItem('reading-buddy-mode')==='demo'?'demo':'live';}catch{return 'live';}}
export function storeMode(mode){if(embedded)window.__READING_MODE__=mode;else try{localStorage.setItem('reading-buddy-mode',mode);}catch{}}
export function assetUrl(path){return window.__READING_ASSETS__?.[path]||path;}
export async function bridge(){
 if(!bridgePromise)bridgePromise=(async()=>{
  const {App}=await import('@modelcontextprotocol/ext-apps');const app=new App({name:'读书搭子',version:'0.2.0'},{});
  const acceptMode=mode=>{if(!['demo','live'].includes(mode))return;storeMode(mode);window.dispatchEvent(new CustomEvent('reading-host-mode',{detail:mode}));};
  app.ontoolinput=p=>acceptMode(p.arguments?.mode);
  app.ontoolresult=p=>acceptMode(p.structuredContent?.mode);
  await app.connect();return app;
 })();return bridgePromise;
}
async function uiCall(name,args){const r=await(await bridge()).callServerTool({name,arguments:args});if(r.isError)throw Error(r.content?.find(c=>c.type==='text')?.text||'本地操作未完成。');if(!r._meta||!('readingData'in r._meta))throw Error('WorkBuddy 未转发界面数据，请检查客户端 MCP Apps 支持。');return r._meta.readingData;}
export async function readState(mode){if(embedded)return uiCall('reading_ui_state',{mode});const r=await fetch('/api/state?mode='+mode),d=await r.json();if(!r.ok)throw Error(d.error);csrf=d.csrf;return d;}
export async function perform(operation,mode,payload={}){if(embedded)return uiCall('reading_ui_action',{mode,operation,payload});const r=await fetch('/api/'+operation+'?mode='+mode,{method:'POST',headers:{'Content-Type':'application/json','X-Reading-Token':csrf},body:JSON.stringify(payload)}),d=await r.json();if(!r.ok)throw Error(d.error);return d;}
export async function openReadingLink(url){if(embedded){const r=await(await bridge()).openLink({url});if(r.isError)throw Error('WorkBuddy 未允许打开阅读链接。');}else window.location.assign(url);}
export async function downloadText(name,text,mimeType='text/markdown'){
 if(embedded){const r=await(await bridge()).downloadFile({contents:[{type:'resource',resource:{uri:'file:///'+encodeURIComponent(name),mimeType,text}}]});if(r.isError)throw Error('文件未导出，可能已取消或客户端不支持。');return;}
 const u=URL.createObjectURL(new Blob([text],{type:mimeType+';charset=utf-8'})),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);
}
export async function exportBackup(mode){const p=embedded?await perform('export',mode):(await(await fetch('/api/export?mode='+mode)).json());await downloadText('reading-buddy-'+mode+'.json',JSON.stringify(p,null,2),'application/json');}
export async function sendToWorkBuddy(text){const r=await(await bridge()).sendMessage({role:'user',content:[{type:'text',text}]});if(r.isError)throw Error('WorkBuddy 未接收任务，请检查客户端支持。');}
