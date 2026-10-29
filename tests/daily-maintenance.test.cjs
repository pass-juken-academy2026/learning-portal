'use strict';
const assert = require('node:assert/strict');
const { targetFor, validateOptions, validateIndex, validateLinkedCommonSet, insertArrayItems, questionText, writesEnabled } = require('../scripts/daily-maintenance.cjs');

const day = 20261023;
const slots = [
  ['pass-juken-academy2026/english-study', 'db-question'],
  ['pass-juken-academy2026/english-study', 'vocabulary'],
  ['pass-juken-academy2026/math-juken-saitama', 'db-question'],
  ['pass-juken-academy2026/junior-japanese', 'db-question'],
  ['pass-juken-academy2026/junior-science', 'db-question'],
  ['pass-juken-academy2026/junior-social-studies', 'db-question'],
  ['pass-juken-academy2026/highschool-japanese', 'japanese-case'],
  ['pass-juken-academy2026/highschool-biology', 'biology-row4'],
  ['pass-juken-academy2026/highschool-information', 'db-question'],
  ['pass-juken-academy2026/highschool-math', 'practice-row4'],
  ['pass-juken-academy2026/highschool-math', 'linked-common-set'],
  ['pass-juken-academy2026/highschool-social-studies', 'practice-row4'],
  ['pass-juken-academy2026/highschool-social-studies', 'linked-common-set'],
];
const selected = slots[day % slots.length];
assert.deepEqual([selected[0], targetFor(selected[0], day).kind], selected, 'daily rotation should select the expected target and kind');
assert.equal(slots.filter(([repo, kind]) => { const target = targetFor(repo, day); return target && target.kind === kind; }).length, 1, 'rotation should target only one approved entry');
for (let i = 0; i < slots.length; i++) {
  const [repo, kind] = slots[i];
  const matches = slots.filter(([candidate, candidateKind]) => { const target = targetFor(candidate, i); return target && target.kind === candidateKind; });
  assert.equal(matches.length, 1, 'each rotation slot must target exactly one approved entry');
  assert.deepEqual([matches[0][0], targetFor(matches[0][0], i).kind], [repo, kind], 'each supported question/vocabulary slot must be reachable');
}
for (const repo of [
  'pass-juken-academy2026/learning-portal'
]) assert.equal(targetFor(repo, day), null, repo + ' must stay validation-only');
assert.equal(writesEnabled(undefined), false, 'writes must be disabled by default');
assert.equal(writesEnabled('false'), false, 'false must not enable writes');
assert.equal(writesEnabled('TRUE'), false, 'only the exact string true enables writes');
assert.equal(writesEnabled('true'), true, 'explicit opt-in enables the gate');
assert.doesNotThrow(() => validateOptions(['A','B','C','D']));
assert.throws(() => validateOptions(['A','A','C','D']), /unique/);
assert.doesNotThrow(() => validateIndex(0));
assert.doesNotThrow(() => validateIndex(3));
assert.throws(() => validateIndex(4), /Answer index/);
assert.equal(questionText({q:'例題'}, 'db-question'), '例題');
assert.equal(questionText({en:'environment',jp:'環境'}, 'vocabulary'), 'environment');
const commonSet = {
  stimulus: { title: '文化祭の売上', text: '商品Aは1個300円、商品Bは1個200円で販売する。' },
  questions: [
    { question: '商品Aを2個売った売上は？', options: ['300円','500円','600円','900円'], answerIndex: 2, explanation: '300×2=600円。' },
    { question: '商品Bを3個売った売上は？', options: ['200円','400円','600円','800円'], answerIndex: 2, explanation: '200×3=600円。' },
    { question: 'Aを2個、Bを3個売った合計は？', options: ['800円','1000円','1200円','1500円'], answerIndex: 2, explanation: '600+600=1200円。' }
  ]
};
const checkedSet = validateLinkedCommonSet(commonSet, [], [], 4);
assert.equal(checkedSet.questions.length, 3);
assert.equal(checkedSet.stimulus.table, '', 'generated stimuli must provide a safe empty table field when no table markup is supplied');
assert.throws(() => validateLinkedCommonSet({ ...commonSet, stimulus: { ...commonSet.stimulus, text: '<script>alert(1)</script>' } }, [], [], 0), /plain text/);
assert.equal(checkedSet.questions[2][4], 4, 'all subquestions must reference the newly appended stimulus');
assert.throws(() => validateLinkedCommonSet({ ...commonSet, questions: commonSet.questions.slice(0, 2) }, [], [], 0), /3 to 5/);
assert.throws(() => validateLinkedCommonSet(commonSet, ['商品Aを2個売った売上は？'], [], 0), /duplicated/);
assert.throws(() => validateLinkedCommonSet(commonSet, [], [{ title: '文化祭の売上', text: 'other' }], 0), /stimulus is duplicated/);
const sampleArraySource = 'const ITEMS=[{"old":1}];';
const arrayOpen = sampleArraySource.indexOf('['), arrayClose = sampleArraySource.lastIndexOf(']');
const insertedArraySource = insertArrayItems(sampleArraySource, { open: arrayOpen, close: arrayClose }, [{ id: 2 }, { id: 3 }]);
const insertedArrayStart = insertedArraySource.indexOf('['), insertedArrayEnd = insertedArraySource.lastIndexOf(']');
assert.equal(JSON.parse(insertedArraySource.slice(insertedArrayStart, insertedArrayEnd + 1)).length, 3, 'multiple linked items must be appended to the array in one operation');
console.log('A-plan maintenance safety tests passed.');
