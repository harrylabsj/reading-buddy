import { createHash } from 'node:crypto';
import { compareReading, comparisonInput, comparisonRecord } from './reading-comparison.mjs';
import { z } from 'zod';

const text = max => z.string().trim().min(1).max(max);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const revisionId = z.string().regex(/^[a-f0-9]{64}$/);
const fields = {
  question: text(500),
  judgment: text(1500),
  nextQuestion: text(500)
};

export const bookmarkEntrySchema = z.object({
  id: revisionId,
  parent: revisionId.nullable(),
  key: text(210),
  title: text(1000),
  savedAt: z.string().datetime(),
  ...fields,
  comparison: comparisonRecord.optional(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('manual'), excerpt: text(2000) }),
    z.object({
      kind: z.literal('note'), noteId: text(200), chapter: z.string().max(1000),
      quote: z.string().max(800), thought: z.string().max(800), truncated: z.boolean()
    })
  ])
});

const inputSchema = z.object({
  title: text(1000).optional(), bookId: text(120).optional(),
  parent: revisionId.nullable(), ...fields, comparison: comparisonInput.optional(),
  excerpt: text(2000).optional(), noteId: text(200).optional()
}).strict();

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const newest = (a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id);

export function listBookmarks(entries) {
  const books = new Map();
  for (const entry of entries) {
    const prior = books.get(entry.key);
    if (!prior || newest(entry, prior) < 0) books.set(entry.key, entry);
  }
  return [...books.values()].sort(newest);
}

export function bookmarkHistory(entries, key) {
  const history = entries.filter(entry => entry.key === key).sort(newest);
  if (!history.length) throw fail('当前空间没有这本书的共读书签。', 404);
  return history;
}

// Called inside updateProfile so parent validation and appending share one file lock.
export function appendBookmark(profile, raw) {
  const input = inputSchema.parse(raw);
  if (Boolean(input.title) === Boolean(input.bookId))
    throw fail('请提供书名或已选书架书籍的 ID，两者选一。');
  if (Boolean(input.excerpt) === Boolean(input.noteId) || (input.noteId && !input.bookId))
    throw fail('请提供手工摘录，或指定书架书籍及该书的一条笔记。');

  const key = input.bookId ? 'weread-' + input.bookId : 'manual-' + digest(input.title.normalize('NFC'));
  const { parent, question, judgment, nextQuestion } = input;
  const identity = [key, parent, question, judgment, nextQuestion, input.noteId ?? null, input.excerpt ?? null];
  if (input.comparison) identity.push(input.comparison);
  const id = digest(identity);
  const priorSave = profile.bookmarkEntries.find(entry => entry.id === id);
  if (priorSave) return priorSave;

  const latest = listBookmarks(profile.bookmarkEntries).find(entry => entry.key === key);
  if ((latest?.id ?? null) !== parent)
    throw fail('书签已有其他进展。请先恢复最新判断，再确认要追加的内容。', 409);
  const book = input.bookId && profile.snapshot?.books.find(b => b.id === input.bookId);
  const result = input.comparison && compareReading(profile, input.comparison);
  if (result && result.status !== 'compared') throw fail('请选择一条已经核对的不同读法。');
  const comparison = result?.record;
  if (comparison && (input.bookId ? comparison.bookId !== input.bookId : comparison.title !== input.title))
    throw fail('对读来自另一本书，请核对书名或书籍 ID。');
  const title = input.title ?? book?.title ?? latest?.title ?? comparison?.title;
  if (!title) throw fail('当前书架中没有这本书。', 404);
  let source = { kind: 'manual', excerpt: input.excerpt };
  if (input.noteId) {
    const note = profile.snapshot?.notes.find(n => n.id === input.noteId && n.bookId === input.bookId);
    if (!note) throw fail('当前书籍中没有选定的笔记。', 404);
    if (comparison && ((note.chapterUid !== undefined && note.chapterUid !== comparison.chapterUid) ||
        (note.range && note.range !== comparison.range)))
      throw fail('所选笔记与对读段落的位置不一致。');
    if (!note.quote.trim() && !note.thought.trim()) throw fail('所选笔记没有可用文字。');
    source = {
      kind: 'note', noteId: note.id, chapter: note.chapter,
      quote: note.quote.slice(0, 800), thought: note.thought.slice(0, 800),
      truncated: note.quote.length > 800 || note.thought.length > 800
    };
  }
  if (comparison) {
    const passage = source.kind === 'note' ? source.quote : source.excerpt;
    if (!passage.includes(comparison.anchor) ||
        !(passage.includes(input.comparison.excerpt) || input.comparison.excerpt.includes(passage)))
      throw fail('此书签的摘录与对读原文不一致。');
  }
  const savedAt = new Date(Math.max(Date.now(), latest ? Date.parse(latest.savedAt) + 1 : 0)).toISOString();
  const entry = bookmarkEntrySchema.parse({ id, parent, key, title, question, judgment, nextQuestion, source, savedAt, comparison });
  profile.bookmarkEntries.push(entry);
  return entry;
}
