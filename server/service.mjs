import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {z} from 'zod';
import {dataDir,writeJson,readProfile,updateProfile,getKey,setKey,disconnect} from './storage.mjs';
import {settingsSchema,cardSchema,validateBackup,mergeBackup,dayKey,periodRange,cardDraft,duration} from './domain.mjs';
import {gatewayCall,syncAll,syncStatus,refreshBook,fetchBookNotes} from './weread.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export function getState(mode='live') {const p=readProfile(mode);return {...p,connection:{connected:!!getKey(),source:getKey()?'已配置个人凭证':'未连接',managedByWorkBuddy:process.env.READING_AUTH_MODE==='workbuddy'},sync:{...syncStatus},today:dayKey(new Date(),p.settings.timeZone)};}
export async function action(path,mode='live',input={}) {
 const send=value=>value;
 if (process.env.READING_AUTH_MODE==='workbuddy'&&['/api/connect','/api/disconnect'].includes(path))throw fail('请在 WorkBuddy 的连接器设置中管理微信读书授权。',403);
      if(path==='/api/settings'){
        const value=settingsSchema.parse(input);const p=readProfile(mode);
        if(value.primaryBookId&&!p.snapshot?.books.some(b=>b.id===value.primaryBookId))throw fail('主读书不在当前书架中。');
        const zoneChanged=value.timeZone!==p.settings.timeZone;
        updateProfile(mode,p=>{p.settings=value;if(zoneChanged&&p.snapshot){p.snapshot.weekly=null;p.snapshot.monthly=null;p.snapshot.warnings.push('时区已更改，请重新同步阅读统计。');}});return send({ok:true});
      }
      if(path==='/api/connect'){
        if(syncStatus.running)throw fail('请等待当前同步完成后更换连接。',409);
        const {key,persist}=z.object({key:z.string().regex(/^wrk-[A-Za-z0-9_-]{8,}$/),persist:z.boolean().default(false)}).parse(input);
        await gatewayCall('/readdata/detail',{mode:'weekly'},key);setKey(key,persist);void syncAll();return send({ok:true});
      }
      if(path==='/api/disconnect'){
        if(syncStatus.running)throw fail('请等待当前同步完成。',409);disconnect();return send({ok:true});
      }
      if(path==='/api/sync'){
        if(mode==='demo')return send({ok:true,demo:true});if(!getKey())throw fail('请先连接微信读书。',401);void syncAll();return send({ok:true,started:true},202);
      }
      if(path==='/api/book'){
        if(mode==='demo')return send({ok:true});const {id}=z.object({id:z.string().max(120)}).parse(input);
        if(!readProfile().snapshot?.books.some(b=>b.id===id))throw fail('书籍不存在。',404);await refreshBook(id);return send({ok:true});
      }
      if(path==='/api/notes'){
        if(mode==='demo')return send({ok:true});const {bookId}=z.object({bookId:z.string().max(120)}).parse(input);return send(await fetchBookNotes(bookId));
      }
      if(path==='/api/reflection'){
        const {noteId,text}=z.object({noteId:z.string().max(200),text:z.string().max(10000)}).parse(input);
        if(!readProfile(mode).snapshot?.notes.some(n=>n.id===noteId))throw fail('笔记不存在。',404);
        updateProfile(mode,p=>{const row={noteId,text,updatedAt:new Date().toISOString()},i=p.reflections.findIndex(r=>r.noteId===noteId);if(i<0)p.reflections.push(row);else p.reflections[i]=row;});return send({ok:true});
      }
      if(path==='/api/draft'||path==='/api/prepare-workbuddy'){
        const {noteIds,reflection}=z.object({noteIds:z.array(z.string()).min(1).max(20),reflection:z.string().max(10000).default('')}).parse(input);
        const p=readProfile(mode),notes=noteIds.map(id=>p.snapshot?.notes.find(n=>n.id===id));if(notes.some(n=>!n))throw fail('有笔记尚未载入。');
        const draft=cardDraft(notes,reflection,dayKey(new Date(),p.settings.timeZone));
        const prompt=`请使用读书搭子连接器，根据这些已选笔记写一份读书卡片草稿。不要编造个人经历或原文，区分摘录、我的理解和AI建议，保留来源。模式：${mode}，笔记ID：${noteIds.join('、')}。先调用 reading_prepare_card 获取这些笔记；我的补充理解：${reflection||'尚未提供，不代写为我的感悟'}。完成后展示草稿供我确认；我确认后再用 reading_save_card 保存。`;
        return send({title:reflection.trim()?'我的读书卡片':'阅读摘录整理',body:draft,prompt,noteIds,kind:'card'});
      }
      if(path==='/api/review'){
        const {period}=z.object({period:z.enum(['weekly','monthly'])}).parse(input);const p=readProfile(mode),today=dayKey(new Date(),p.settings.timeZone),range=periodRange(today,period),stats=p.snapshot?.[period];
        const valid=stats&&stats.start===range.start&&stats.end===today;
        const notes=(p.snapshot?.notes||[]).filter(n=>n.date>=range.start&&n.date<=today),finished=(p.snapshot?.books||[]).filter(b=>b.finishDate&&b.finishDate>=range.start&&b.finishDate<=today);
        const text=`# ${period==='weekly'?'本周':'本月'}阅读复盘\n\n${range.start} — ${today}\n\n## 阅读节奏\n\n总时长：${valid?duration(stats.totalSeconds):'当前周期尚未同步'}\n有效阅读天数：${valid?(stats.readDays??'暂不可用'):'暂不可用'}\n数据更新：${stats?.fetchedAt||'尚未同步'}\n\n## 已核对的读完记录\n\n${finished.length?finished.map(b=>'- 《'+b.title+'》 · '+b.finishDate).join('\n'):'暂无已核对的本期完成日期；不等于本期没有读完。'}\n\n## 已载入的本期笔记\n\n${notes.length?notes.slice(0,12).map(n=>`- 《${n.title}》${n.chapter?' · '+n.chapter:''}：${(n.thought||n.quote).slice(0,500)}`).join('\n\n'):'当前未载入本期笔记，可按书继续同步。'}\n\n## 我的收获\n\n（写下一个值得记住的想法）\n\n## 下一步阅读\n\n（决定接下来继续读什么）\n\n---\n本机数据整理，笔记和完成记录可能仅为已载入部分；未使用AI改写。`;
        return send({title:period==='weekly'?'本周阅读复盘':'本月阅读复盘',body:text,kind:period,noteIds:notes.slice(0,12).map(n=>n.id)});
      }
      if(path==='/api/cards'){
        const p=readProfile(mode),now=new Date().toISOString();const {id,title,body,kind,noteIds,origin}=z.object({id:z.string().optional(),title:z.string(),body:z.string(),kind:z.enum(['card','weekly','monthly']),noteIds:z.array(z.string()).default([]),origin:z.enum(['local','workbuddy']).default('local')}).parse(input);
        const prior=p.cards.find(c=>c.id===id);const card=cardSchema.parse({id:prior?.id||randomUUID(),title,body,kind,noteIds,origin,createdAt:prior?.createdAt||now,updatedAt:now});
        updateProfile(mode,p=>{const i=p.cards.findIndex(c=>c.id===card.id);if(i<0)p.cards.unshift(card);else p.cards[i]=card;});return send(card);
      }
      if(path==='/api/import'){
        const imported=validateBackup(input,mode);const before=readProfile(mode);writeJson(join(dataDir,`before-import-${Date.now()}.json`),before);updateProfile(mode,p=>Object.assign(p,mergeBackup(p,imported)));return send({ok:true,cards:imported.cards.length,reflections:imported.reflections.length});
      }
      throw fail('没有这个操作。',404);
}
