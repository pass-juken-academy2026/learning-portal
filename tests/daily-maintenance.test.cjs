'use strict';
const assert = require('node:assert/strict');
const { targetFor, validateOptions, validateIndex, questionText, writesEnabled } = require('../scripts/daily-maintenance.cjs');

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
];
const selected = slots[day % slots.length];
assert.deepEqual([selected[0], targetFor(selected[0], day).kind], selected, 'daily rotation should select the expected target and kind');
assert.equal(slots.filter(([repo]) => targetFor(repo, day)).length, 1, 'rotation should target only one approved entry');
for (let i = 0; i < slots.length; i++) {
  const [repo, kind] = slots[i];
  const matches = slots.filter(([candidate]) => targetFor(candidate, i));
  assert.equal(matches.length, 1, 'each rotation slot must target exactly one approved entry');
  assert.deepEqual([matches[0][0], targetFor(matches[0][0], i).kind], [repo, kind], 'each supported question/vocabulary slot must be reachable');
}
for (const repo of [
  'pass-juken-academy2026/highschool-math',
  'pass-juken-academy2026/highschool-social-studies',
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
console.log('A-plan maintenance safety tests passed.');
