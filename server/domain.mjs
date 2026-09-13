import { z } from 'zod';

export const dayKey = (date = new Date(), zone = 'Asia/Shanghai') => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export const shiftDay = (day, amount) => new Date(Date.parse(day + 'T12:00:00Z') + amount * 86400000).toISOString().slice(0, 10);
export function periodRange(today, mode = 'weekly') {
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  return { start: mode === 'monthly' ? today.slice(0, 8) + '01' : shiftDay(today, -((dow + 6) % 7)), end: today };
}
export const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function safeLink(value) {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return u.protocol === 'weread:' || (u.protocol === 'https:' && (u.hostname === 'weread.qq.com' || u.hostname.endsWith('.weread.qq.com'))) ? value : null; } catch { return null; }
}
export function safeCover(value) {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return u.protocol === 'https:' && ['qpic.cn', 'qq.com', 'qlogo.cn'].some(h => u.hostname === h || u.hostname.endsWith('.' + h)) ? value : null; } catch { return null; }
}
export function normalizePeriod(raw, mode, zone, now = new Date()) {
  const today = dayKey(now, zone), range = periodRange(today, mode), days = {};
  for (const [k, v] of Object.entries(raw.readTimes || {})) {
    let d; const stamp = Number(k);
    try { d = Number.isFinite(stamp) && stamp > 0 ? dayKey(new Date(stamp > 1e12 ? stamp : stamp * 1000), zone) : k.slice(0, 10); } catch { continue; }
    if (d >= range.start && d <= today && finite(v) !== null) days[d] = v;
  }
  return { ...range, totalSeconds: finite(raw.totalReadTime), readDays: finite(raw.readDays), days, fetchedAt: now.toISOString(), source: '微信读书' };
}
export function normalizeShelf(raw, notebookRows = [], previous = []) {
  const old = new Map(previous.map(b => [b.id, b])), notes = new Map(notebookRows.map(b => [String(b.bookId), b]));
  return (raw.books || []).map(item => {
    const id = String(item.bookId), n = notes.get(id), prior = old.get(id);
    const progress = n ? finite(n.readingProgress) : prior?.progress ?? null;
    const done = item.finishReading === 1 || n?.markedStatus === 1 || progress === 100;
    return { id, title: String(item.title || n?.book?.title || '未命名书籍'), author: String(item.author || n?.book?.author || ''), cover: safeCover(item.cover || n?.book?.cover) || prior?.cover || null,
      progress, done, lastRead: finite(item.readUpdateTime), deepLink: safeLink(item.deepLink) || prior?.deepLink || null,
      rating: prior?.rating ?? null, weeklySeconds: null, reviewCount: n ? finite(n.reviewCount) : prior?.reviewCount ?? null,
      highlightCount: n ? finite(n.noteCount) : prior?.highlightCount ?? null, bookmarkCount: n ? finite(n.bookmarkCount) : prior?.bookmarkCount ?? null,
      finishDate: prior?.finishDate || null, notesFetchedAt: prior?.notesFetchedAt || null };
  }).sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0));
}

const iso = z.string().datetime();
const nullableNumber = z.number().finite().nonnegative().nullable();
const periodSchema = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), totalSeconds: nullableNumber, readDays: nullableNumber, days: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().finite().nonnegative()), fetchedAt: iso, source: z.string().max(80) }).nullable();
const bookSchema = z.object({ id: z.string().min(1).max(120), title: z.string().max(1000), author: z.string().max(1000), cover: z.string().max(3000).nullable(), progress: z.number().min(0).max(100).nullable(), done: z.boolean(), lastRead: nullableNumber, deepLink: z.string().max(3000).nullable(), rating: nullableNumber, weeklySeconds: nullableNumber, reviewCount: nullableNumber, highlightCount: nullableNumber, bookmarkCount: nullableNumber, finishDate: z.string().nullable(), notesFetchedAt: z.string().nullable() });
export const noteSchema = z.object({ id: z.string().min(1).max(200), bookId: z.string().max(120), title: z.string().max(1000), chapter: z.string().max(1000), quote: z.string().max(50000), thought: z.string().max(50000), date: z.string().max(40), type: z.enum(['highlight', 'thought']), deepLink: z.string().max(3000).nullable() });
export const settingsSchema = z.object({ goal: z.number().int().min(5).max(600), timeZone: z.string().refine(v => { try { new Intl.DateTimeFormat('en', { timeZone: v }); return true; } catch { return false; } }), primaryBookId: z.string().max(120).nullable() });
export const cardSchema = z.object({ id: z.string().min(1).max(100), title: z.string().min(1).max(200), body: z.string().min(1).max(100000), createdAt: iso, updatedAt: iso, kind: z.enum(['card', 'weekly', 'monthly']), noteIds: z.array(z.string().max(200)).max(100), origin: z.enum(['local', 'workbuddy']) });
export const profileSchema = z.object({ schema: z.literal(1), mode: z.enum(['live', 'demo']), settings: settingsSchema,
  snapshot: z.object({ syncedAt: iso, books: z.array(bookSchema).max(20000), notes: z.array(noteSchema).max(100000), weekly: periodSchema, monthly: periodSchema, totals: z.object({ notebookBooks: nullableNumber, notes: nullableNumber, ebooks: nullableNumber, albums: nullableNumber, articles: nullableNumber }), warnings: z.array(z.string().max(500)).max(30) }).nullable(),
  cards: z.array(cardSchema).max(10000), reflections: z.array(z.object({ noteId: z.string().max(200), text: z.string().max(10000), updatedAt: iso })).max(50000) });
export function newProfile(mode = 'live') { return { schema: 1, mode, settings: { goal: 30, timeZone: 'Asia/Shanghai', primaryBookId: null }, snapshot: null, cards: [], reflections: [] }; }
export function validateBackup(raw, expectedMode) {
  const parsed = profileSchema.parse(raw);
  if (parsed.mode !== expectedMode) throw new Error('示例数据与个人数据不能混合导入，请切换对应模式。');
  if (parsed.snapshot) {
    for (const b of parsed.snapshot.books) { b.deepLink = safeLink(b.deepLink); b.cover = parsed.mode === 'demo' && b.cover === '/assets/demo-book.png' ? b.cover : safeCover(b.cover); }
    for (const n of parsed.snapshot.notes) n.deepLink = safeLink(n.deepLink);
  }
  return parsed;
}
export function mergeBackup(current, incoming) {
  const merge = (a, b, key, stamp = 'updatedAt') => {
    const map = new Map(a.map(x => [x[key], x]));
    for (const x of b) { const old = map.get(x[key]); if (!old || x[stamp] > old[stamp]) map.set(x[key], x); }
    return [...map.values()];
  };
  return { ...current, snapshot: !current.snapshot || (incoming.snapshot && incoming.snapshot.syncedAt > current.snapshot.syncedAt) ? incoming.snapshot : current.snapshot,
    cards: merge(current.cards, incoming.cards, 'id'), reflections: merge(current.reflections, incoming.reflections, 'noteId') };
}
export function demoProfile(zone = 'Asia/Shanghai') {
  const p = newProfile('demo'), now = new Date(), today = dayKey(now,zone), range = periodRange(today), dayCount = Math.round((Date.parse(today) - Date.parse(range.start)) / 86400000) + 1;
  const vals = [30, 25, 40, 35, 20, 15, 20], days = Object.fromEntries(Array.from({ length: dayCount }, (_, i) => [shiftDay(range.start, i), vals[i] * 60]));
  const book = { id: 'demo-mountain', title: '山间来信', author: '林禾', cover: '/assets/demo-book.png', progress: 42, done: false, lastRead: Math.floor(now.getTime()/1000), deepLink: null, rating: null, weeklySeconds: Object.values(days).reduce((a,b)=>a+b,0), reviewCount: 2, highlightCount: 3, bookmarkCount: 0, finishDate: null, notesFetchedAt: now.toISOString() };
  const notes = ['把日常过好，就是一种不平凡。', '山不只是风景，也是一种与自己的对话。', '时间从不匆忙，匆忙的是我们。'].map((quote,i)=>({id:'demo-note-'+i,bookId:book.id,title:book.title,chapter:'第 '+(i+1)+' 章 · 示例摘录',quote,thought:'',date:shiftDay(today,-i),type:'highlight',deepLink:null}));
  const weekly = {...range,days,totalSeconds:Object.values(days).reduce((a,b)=>a+b,0),readDays:dayCount,fetchedAt:now.toISOString(),source:'示例数据'};
  p.settings.primaryBookId=book.id;p.settings.timeZone=zone;
  p.snapshot={syncedAt:now.toISOString(),books:[book],notes,weekly,monthly:{...weekly,start:today.slice(0,8)+'01'},totals:{notebookBooks:1,notes:5,ebooks:1,albums:0,articles:0},warnings:[]};
  return p;
}
export const duration = seconds => seconds === null || seconds === undefined ? '暂不可用' : (Math.floor(seconds/3600) ? Math.floor(seconds/3600)+'小时' : '') + Math.round(seconds%3600/60)+'分钟';
export function cardDraft(notes, reflection, today) {
  const source = notes.map(n => [`### 《${n.title}》`, n.chapter, n.quote ? '> '+n.quote.replaceAll('\n','\n> ') : '', n.thought ? '**原有想法**\n\n'+n.thought : '', `来源：${n.date || '日期未提供'}${n.deepLink ? '\n'+n.deepLink : ''}`].filter(Boolean).join('\n\n')).join('\n\n');
  return `# ${reflection.trim() ? '我的读书卡片' : '阅读摘录整理'}\n\n${today}\n\n${source}\n\n## 我的理解\n\n${reflection.trim() || '（写下你自己的理解）'}\n\n---\n根据所选笔记在本机整理；未使用 AI 改写。`;
}
