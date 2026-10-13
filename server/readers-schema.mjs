import {z} from 'zod';

export const readerQuerySchema=z.object({
 bookId:z.string().min(1).max(120),
 chapterUid:z.number().int().nonnegative().optional(),
 range:z.string().regex(/^\d+-\d+$/).max(80).refine(v=>{const [a,b]=v.split('-').map(Number);return Number.isSafeInteger(a)&&Number.isSafeInteger(b)&&b>a;}).optional(),
 question:z.string().trim().max(300).default(''),
}).refine(q=>(q.chapterUid!==undefined)===!!q.range,'章节与原文范围必须一起提供。');
export const readerCandidateSchema=z.object({
 reviewId:z.string().min(1).max(200),userVid:z.string().min(1).max(100),name:z.string().max(100),
 content:z.string().max(800),quote:z.string().max(240),truncated:z.boolean(),
 likes:z.number().int().nonnegative().nullable(),date:z.string().max(10),
 chapterUid:z.number().int().nonnegative().nullable(),range:z.string().max(80),
 source:z.enum(['thought','review']),url:z.string().max(3000).nullable(),
});
export const readerPickSchema=z.object({
 reviewId:z.string().min(1).max(200),reason:z.string().trim().min(1).max(240),
 connection:z.string().trim().min(1).max(240),evidence:z.string().trim().min(4).max(180),
});
export const readerSessionSchema=z.object({
 id:z.string().min(1).max(100),query:readerQuerySchema,title:z.string().max(1000),fetchedAt:z.string().datetime(),
 candidates:z.array(readerCandidateSchema).max(120),
 coverage:z.object({requests:z.number().int().nonnegative(),sampled:z.number().int().nonnegative(),missingLikes:z.number().int().nonnegative(),scope:z.enum(['book-sample','passage']),limited:z.boolean(),warnings:z.array(z.string().max(300)).max(10)}),
 picks:z.object({resonance:z.array(readerPickSchema).max(5),perspective:z.array(readerPickSchema).max(5)}),
 curatedAt:z.string().datetime().nullable(),demo:z.boolean().default(false),
});
