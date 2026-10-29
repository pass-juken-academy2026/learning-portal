'use strict';
const assert = require('node:assert/strict');
const { targetFor, validateOptions, validateIndex, questionText, writesEnabled } = require('../scripts/daily-maintenance.cjs');

const day = 20261023;
const eligible = [
  'pass-juken-academy2026/english-study',
  'pass-juken-academy2026/math-juken-saitama',
  'pass-juken-academy2026/junior-japanese',
  'pass-juken-academy2026/junior-science',
  'pass-juken-academy2026/junior-social-studies',
  'pass-juken-academy2026/highschool-japanese',
  'pass-juken-academy2026/highschool-biology',
  'pass-juken-academy2026/highschool-information',
  'pass-juken-academy2026/highschool-social-studies'
];
const selected = eligible[day % eligible.length];
assert.ok(targetFor(selected, day), 'exactly one safe target should be selected for the day');
assert.equal(eligible.filter(repo => targetFor(repo, day)).length, 1, 'rotation should target only one repository per day');
for (const repo of eligible) {
  const target = targetFor(repo, day);
  if (repo === selected) assert.ok(target.kind === 'db-question' || target.kind === 'japanese-case' || target.kind === 'biology-row4' || target.kind === 'social-row6');
  else assert.equal(target, null);
}
for (const repo of [
  'pass-juken-academy2026/highschool-math',
  'pass-juken-academy2026/highschool-math',
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
assert.equal(questionText(['地理','資料から読み取れることは？',['A','B','C','D'],0,'解説','資料読解'], 'social-row6'), '資料から読み取れることは？');
for (let i = 0; i < eligible.length; i++) {
  const dateForSlot = i;
  const matches = eligible.filter(repo => targetFor(repo, dateForSlot));
  assert.equal(matches.length, 1, 'every rotation slot must select exactly one repository');
  assert.equal(matches[0], eligible[i], 'each supported repository must be reachable in the rotation');
}
console.log('A-plan maintenance safety tests passed.');
