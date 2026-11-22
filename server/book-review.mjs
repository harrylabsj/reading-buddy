import { createHash } from 'node:crypto';
import { z } from 'zod';
import { safeLink } from './domain.mjs';

const text = max => z.string().trim().min(1).max(max);
const fail = message => Object.assign(new Error(message), { status: 400 });
const material = z.object({
  chapter: z.string().max(500).default(''),
  quote: z.string().max(10000).default(''),
  thought: z.string().max(10000).default('')
}).strict().refine(n => n.quote.trim() || n.thought.trim(), '材料缺少划线或想法。');
const selection = z.union([
  z.object({ title: text(500), pasted: z.array(material).min(1).max(100) }).strict(),
  z.object({ bookmarkKey:text(210), bookmarkIds:z.array(text(100)).min(1).max(100) }).strict(),
  z.object({ bookId: text(120), noteIds: z.array(text(200)).max(100).default([]),
    bookmarkIds: z.array(text(100)).max(100).default([]) }).strict()
]);
const evidence = z.object({
  source: text(10), field: z.enum(['quote','thought']), exact: text(300)
}).strict();
const option = z.object({
  claim: text(300), support: z.array(evidence).min(1).max(8),
  counter: evidence.nullable(), gap: text(500)
}).strict();
const part = z.union([
  z.object({ text: z.string().min(1).max(3500) }).strict(),
  z.object({ cite: z.number().int().min(1), verbatim: z.boolean().default(false) }).strict()
]);
const draft = z.object({ title: text(200), paragraphs: z.array(z.array(part).min(1).max(24)).min(1).max(25) }).strict();
const request = z.object({
  selection, options: z.array(option).max(3).optional(), planId: text(64).optional(),
  choice: z.number().int().min(1).max(3).optional(), draft: draft.optional()
}).strict();

function gather(profile, selection) {
  let title, rows;
  if ('pasted' in selection) {
    title = selection.title;
    rows = selection.pasted.map((n,i) => ({...n, id:String(i+1), origin:'手工笔记'}));
  } else {
    const { bookId, noteIds = [], bookmarkIds } = selection;
    const key = selection.bookmarkKey ?? 'weread-' + bookId;
    const count = noteIds.length + bookmarkIds.length;
    if (!count || count > 100 || new Set(noteIds).size + new Set(bookmarkIds).size !== count)
      throw fail('请选择同一本书的 1–100 条材料，移除重复编号。');
    const notes = noteIds.map(id => {
      const n = profile.snapshot?.notes.find(n => n.id === id && n.bookId === bookId);
      if (!n) throw fail('所选笔记不在当前账户的指定书籍中。');
      return {...n,origin:'微信读书笔记'};
    });
    const bookmarks = bookmarkIds.map(id => {
      const b = profile.bookmarkEntries.find(b => b.id === id && b.key === key);
      if (!b) throw fail('所选共读书签不在当前账户的指定书籍中。');
      return {id:b.id, title:b.title, origin:'共读书签', chapter:b.source.chapter ?? '',
        quote:b.source.kind === 'manual' ? b.source.excerpt : b.source.quote,
        thought:b.judgment, date:b.savedAt.slice(0,10), sourceTruncated:b.source.truncated};
    });
    rows = [...notes,...bookmarks];
    title = profile.snapshot?.books.find(b => b.id === bookId)?.title ?? rows[0].title;
  }
  // Reserve a share for every chosen note, including the reader's own words.
  const perNote = Math.floor(12000 / rows.length);
  const sources = rows.map((n,i) => {
    const thoughtLength = Math.min(800, n.thought.length, Math.max(perNote - n.quote.length, Math.ceil(perNote/2)));
    const quote = n.quote.slice(0, Math.min(800, perNote - thoughtLength));
    const thought = n.thought.slice(0, Math.min(800, perNote - quote.length));
    const link = safeLink(n.deepLink);
    return {
      ref:'S'+(i+1), id:n.id, origin:n.origin, chapter:(n.chapter ?? '').slice(0,120), date:n.date ?? '',
      link:link && !/[<>\\\s]/u.test(link) ? link : null, quote, thought,
      truncated:quote.length < n.quote.length || thought.length < n.thought.length || Boolean(n.sourceTruncated)
    };
  });
  return { title, sources };
}

const inline = s => s.replace(/[\r\n]+/g,' ').replace(/[\\`*_{}\[\]()<>#!|~$^=]/g,c=>'\\'+c);

function render(title, sources, chosen, article, demo) {
  const refs = chosen.counter ? [...chosen.support,chosen.counter] : chosen.support;
  const used = new Set();
  const paragraphs = article.paragraphs.map(parts => parts.map(p => {
    if ('text' in p) return inline(p.text);
    const ref = refs[p.cite - 1];
    if (!ref) throw fail('正文引用了所选论点以外的材料。');
    used.add(p.cite);
    return (p.verbatim ? '“'+inline(ref.exact)+'”' : '')+'[^'+p.cite+']';
  }).join(''));
  if (![...used].some(index => index <= chosen.support.length))
    throw fail('书评正文至少需要引用一条支持所选论点的材料。');
  const footnotes = [...used].sort((a,b)=>a-b).map(index => {
    const ref = refs[index-1], n = sources.find(s=>s.ref === ref.source);
    const label = ref.field === 'quote' ? '书中原文' : '我的想法';
    const location = [title, n.chapter, n.date, n.origin+' '+n.id].filter(Boolean).map(inline).join(' · ');
    return '[^'+index+']: '+location+' · '+label+'：“'+inline(ref.exact)+'”' +
      (n.link ? ' · [打开原笔记](<'+n.link+'>)' : '');
  });
  return ['# '+inline(article.title),...paragraphs,'---',...footnotes,
    (demo ? '虚构示例 · ' : '')+'根据读者选定的笔记，由 AI 协助整理。',''].join('\n\n');
}

export function buildBookReview(profile, raw) {
  const input = request.parse(raw);
  const {title,sources} = gather(profile,input.selection);
  if (input.options === undefined) {
    if (input.draft || input.choice || input.planId) throw fail('请先核对候选论点。');
    return {stage:'materials',title,sources,truncated:sources.some(s=>s.truncated)};
  }
  const options = input.options;
  if (new Set(options.map(o=>o.claim)).size !== options.length) throw fail('请合并重复的论点。');
  for (const o of options) {
    for (const e of [...o.support,...(o.counter ? [o.counter] : [])]) {
      const n = sources.find(s => s.ref === e.source);
      if (!n || !n[e.field].includes(e.exact)) throw fail('引文与所选材料或引文类别不符，请核对逐字出处。');
    }
  }
  const planId = createHash('sha256').update(JSON.stringify([profile.mode,title,sources,options])).digest('hex');
  if (input.planId && input.planId !== planId) throw fail('材料或论点已变化，请重新展示选题。');
  if (!input.choice) {
    if (input.draft) throw fail('请先取得读者选定的论点。');
    return {stage:options.length ? 'choose' : 'need-material',title,options,planId};
  }
  const chosen = options[input.choice-1];
  if (!chosen || !input.planId) throw fail('请使用已展示的选题编号和 planId。');
  if (!input.draft) return {stage:'outline',title,chosen};
  return {stage:'draft',title:input.draft.title,markdown:render(title,sources,chosen,input.draft,profile.mode==='demo')};
}
