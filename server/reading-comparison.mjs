import { z } from 'zod';
import { readerQuerySchema } from './readers-schema.mjs';

const short = max => z.string().trim().min(1).max(max);
const { bookId, chapterUid, range } = readerQuerySchema.shape;
const scope = z.object({
  bookId,
  chapterUid: chapterUid.unwrap(),
  range: range.unwrap()
});
const reviewId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const pick = z.object({
  reviewId,
  anchor: z.string().trim().min(2).max(160),
  evidence: z.string().trim().min(4).max(180),
  difference: short(500),
  followUp: short(300)
}).strict();

export const comparisonInput = scope.extend({
  sessionId: short(100), fetchedAt: z.string().datetime(),
  excerpt: short(2000), judgment: short(1500),
  pick: pick.nullable().optional()
}).strict();

export const comparisonRecord = pick.extend({
  bookId: short(120), title: short(1000), judgment: short(1500),
  name: short(100), demo: z.boolean(), fetchedAt: z.string().datetime(),
  chapterUid: scope.shape.chapterUid, range: scope.shape.range
});

export function comparisonLink(record) {
  return record.demo ? null : 'https://weread.qq.com/review-detail?reviewid=' + encodeURIComponent(record.reviewId);
}

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function compareReading(profile, raw, offset = 0) {
  const input = comparisonInput.parse(raw);
  const session = profile.readerDiscoveries.find(s => s.id === input.sessionId);
  if (!session) throw fail('当前空间没有这次段落发现记录。', 404);
  if (session.fetchedAt !== input.fetchedAt) throw fail('段落记录已更新，请重新查看候选。', 409);
  if (session.query.bookId !== input.bookId || session.query.chapterUid !== input.chapterUid ||
      session.query.range !== input.range || session.coverage.scope !== 'passage')
    throw fail('请选择同一本书、同一章节及原文范围的段落发现记录。');
  if (session.demo !== (profile.mode === 'demo')) throw fail('发现记录与当前模式不一致。');

  const [start,end] = input.range.split('-').map(Number);
  const candidates = session.candidates.filter(c => {
    const [a,b] = c.range.split('-').map(Number);
    return c.source === 'thought' && c.chapterUid === input.chapterUid && c.quote.trim() &&
      Number.isSafeInteger(a) && Number.isSafeInteger(b) && Math.min(b,end) > Math.max(a,start) &&
      reviewId.safeParse(c.reviewId).success;
  });
  if (input.pick === null || (!candidates.length && input.pick === undefined))
    return {status:'no-match',demo:session.demo,message:'这次段落样本里没有找到有依据的不同读法。'};
  if (input.pick === undefined) {
    // Omit popularity signals and keep the model's input bounded.
    const page = candidates.slice(offset, offset + 8);
    return {
      status: 'choose',
      demo: session.demo,
      nextOffset: offset + page.length < candidates.length ? offset + page.length : null,
      candidates: page.map(c => ({
        reviewId: c.reviewId,
        name: c.name,
        quote: c.quote,
        content: c.content.slice(0, 500),
        truncated: c.truncated || c.content.length > 500
      }))
    };
  }
  const choice = input.pick;
  const source = candidates.find(c => c.reviewId === choice.reviewId);
  if (!source || !source.content.includes(choice.evidence))
    throw fail('读友引文须逐字来自本次选中的段落想法。');
  if (!input.excerpt.includes(choice.anchor) || !source.quote.includes(choice.anchor))
    throw fail('分歧所指的词句必须同时出现在所读原文与读友引用的原文中。');
  const record = comparisonRecord.parse({
    ...choice, bookId:input.bookId, title:session.title, judgment:input.judgment,
    name:source.name, demo:session.demo, chapterUid:input.chapterUid, range:input.range,
    fetchedAt:session.fetchedAt
  });
  return {status:'compared',record,url:comparisonLink(record)};
}
