import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBookReview } from '../server/book-review.mjs';
import { appendBookmark } from '../server/bookmarks.mjs';
import { demoProfile, newProfile } from '../server/domain.mjs';

const profile = newProfile();
const selection = {title:'桥边',pasted:[
  {quote:'她停在桥边。',thought:'我第一次把停下理解成害怕。',chapter:'第一章'},
  {quote:'她等老人走过才向前。',thought:'读到这里，我改变了想法。',chapter:'第三章'}
]};
const support = [{source:'S1',field:'thought',exact:'把停下理解成害怕'}];
const counter = {source:'S2',field:'quote',exact:'等老人走过才向前'};
const options = [
  {claim:'同一动作在后文有了另一种解释',support,counter,gap:'还缺更早的一段对照。'},
  {claim:'叙述顺序改变了读者的判断',support:[{source:'S2',field:'thought',exact:'我改变了想法'}],counter:null,gap:'需要核对叙述者最初给了哪些提示。'}
];
const run = value => buildBookReview(profile,{selection,...value});
const draft = {title:'为什么停在桥边',paragraphs:[
  [{text:'起初我在笔记中写过：'},{cite:1,verbatim:true}],
  [{text:'再往后读，动作的含义变了。'},{cite:2}]
]};

test('review proceeds from attributed evidence to a chosen argument and Markdown footnotes',()=>{
  const materials=run({});
  assert.equal(materials.stage,'materials');
  assert.equal(materials.sources[0].origin,'手工笔记');
  assert.equal(run({options:[]}).stage,'need-material');
  const plan=run({options});
  assert.equal(plan.stage,'choose'); assert.ok(!plan.markdown);
  assert.throws(()=>run({options,draft}),/先取得/);
  const input={options,planId:plan.planId,choice:1};
  assert.equal(run(input).chosen.claim,options[0].claim);
  const {markdown}=run({...input,draft});
  assert.match(markdown,/起初我在笔记中写过：“把停下理解成害怕”\[\^1\]/);
  assert.match(markdown,/第一章 · 手工笔记 1 · 我的想法/);
  assert.match(markdown,/第三章 · 手工笔记 2 · 书中原文/);
  assert.doesNotMatch(markdown,/叙述顺序改变/);
  assert.throws(()=>run({...input,choice:2,draft}),/以外/);
  assert.throws(()=>run({...input,options:[{...options[0],claim:'已换题'}],draft}),/已变化/);
  assert.throws(()=>run({...input,selection:{...selection,pasted:[selection.pasted[0],{...selection.pasted[1],chapter:'第五章'}]},draft}),/已变化/);
});

test('review rejects foreign, invented and misattributed evidence including counterexamples',()=>{
  for(const e of [{...counter,field:'thought'},{...counter,source:'S3'},{...counter,exact:'原文没有说过'}])
    assert.throws(()=>run({options:[{...options[0],counter:e}]}),/逐字/);
});

test('personal selection is scoped by book, note and bookmark revision',()=>{
  const p=demoProfile();
  const n=p.snapshot.notes[0];
  const b=appendBookmark(p,{bookId:n.bookId,noteId:n.id,parent:null,question:'为什么？',judgment:'我的理解',nextQuestion:'接着读什么？'});
  const s={bookId:n.bookId,noteIds:[n.id],bookmarkIds:[b.id]};
  const r=buildBookReview(p,{selection:s});
  assert.equal(r.sources.length,2);assert.equal(r.sources[1].thought,b.judgment);
  assert.ok(!JSON.stringify(r).includes(p.snapshot.notes[1].quote));
  assert.throws(()=>buildBookReview(p,{selection:{...s,bookId:'foreign'}}),/指定书籍/);
  assert.throws(()=>buildBookReview(newProfile(),{selection:s}),/指定书籍/);
  const manual=appendBookmark(p,{title:'手工书',excerpt:'城外有山',parent:null,question:'如何看？',judgment:'我的看法',nextQuestion:'再读一章？'});
  assert.equal(buildBookReview(p,{selection:{bookmarkKey:manual.key,bookmarkIds:[manual.id]}}).sources[0].thought,manual.judgment);
});

test('large selections keep every note and both voices inside the model budget',()=>{
  const pasted=Array.from({length:54},()=>({quote:'文'.repeat(1000),thought:'感'.repeat(1000)}));
  const r=run({selection:{title:'测试',pasted}});
  assert.equal(r.sources.length,54);assert.ok(r.sources.every(n=>n.quote && n.thought && n.truncated));
  assert.ok(r.sources.reduce((a,n)=>a+n.quote.length+n.thought.length,0)<=12000);
});
