'use strict';
const assert = require('node:assert/strict');
const { normalize, auditHtml, auditSecurityPrivacy, parseDbQuestions } = require('../scripts/free-audit.cjs');

assert.equal(normalize('  Ａ   B  '), 'a b');
const html = '<div id="x"></div><div id="x"></div><script>const a = 1;</script><a href="missing.html">x</a>';
const audited = auditHtml(html);
assert.deepEqual(audited.duplicateIds, ['x']);
assert.deepEqual(audited.localLinks, ['missing.html']);
assert.equal(audited.inlineScripts.length, 1);

const templated = '<main id="app"></main><script>const html = `<div id="dynamic"></div><input id="dynamic">`;</script>';
const templateAudit = auditHtml(templated);
assert.deepEqual(templateAudit.duplicateIds, []);
assert.equal(templateAudit.inlineScripts.length, 1);

const localOnlyFeedback = '<form id="form"><select id="site"></select><textarea id="detail"></textarea></form><script>out.textContent = detail.value;</script>';
const localOnlyAudit = auditSecurityPrivacy(localOnlyFeedback, 'feedback.html');
assert.deepEqual(localOnlyAudit.errors, []);
assert.equal(localOnlyAudit.formCount, 1);

const riskyPage = '<form action="https://example.test/collect" method="post"><input type="email" name="email"></form><script>fetch("/submit"); target.innerHTML = userInput; eval(code);</script><script src="https://cdn.example.test/app.js"></script><a href="https://example.test" target="_blank">open</a>';
const riskyAudit = auditSecurityPrivacy(riskyPage, 'risky.html');
assert.ok(riskyAudit.errors.some(message => message.includes('personal-information input')));
assert.ok(riskyAudit.errors.some(message => message.includes('submission action')));
assert.ok(riskyAudit.errors.some(message => message.includes('POST')));
assert.ok(riskyAudit.errors.some(message => message.includes('network-request API')));
assert.ok(riskyAudit.errors.some(message => message.includes('eval or new Function')));
assert.ok(riskyAudit.warnings.some(message => message.includes('innerHTML')));
assert.ok(riskyAudit.warnings.some(message => message.includes('Subresource Integrity')));
assert.ok(riskyAudit.warnings.some(message => message.includes('rel=noopener')));
const printWindowAudit = auditSecurityPrivacy('<script>win.document.write(escapedHtml);</script>', 'print.html');
assert.deepEqual(printWindowAudit.errors, []);
assert.ok(printWindowAudit.warnings.some(message => message.includes('document.write')));

const validDb = 'const DB={"topics":[{"name":"基礎"}],"questions":[{"topic":"基礎","q":"問題A","options":["A","B","C","D"],"a":0,"ex":"理由"}]},key=1;';
const parsed = parseDbQuestions(validDb);
assert.equal(parsed.found, true);
assert.equal(parsed.questionCount, 1);
assert.deepEqual(parsed.malformed, []);
const fillDb = 'const DB={"topics":[],"questions":[{"type":"fill","q":"空欄問題","answer":"対比","answers":["対比","比較"],"ex":"前後の関係を確認する。"}]},key=1;';
const fillParsed = parseDbQuestions(fillDb);
assert.deepEqual(fillParsed.malformed, []);

const invalidFillDb = 'const DB={"topics":[],"questions":[{"type":"fill","q":"空欄問題","answers":[],"ex":"説明"}]},key=1;';
assert.ok(parseDbQuestions(invalidFillDb).malformed.some(message => message.includes('fill-in answer')));

const invalidTypeDb = 'const DB={"topics":[],"questions":[{"type":"essay","q":"記述問題","answer":"答え","ex":"説明"}]},key=1;';
assert.ok(parseDbQuestions(invalidTypeDb).malformed.some(message => message.includes('unsupported type')));


const duplicateDb = 'const DB={"topics":[],"questions":[{"q":"同じ問題","options":["A","B"],"a":0,"ex":"説明"},{"q":" 同じ問題 ","options":["A","B"],"a":9,"ex":""}]},key=1;';
const duplicateParsed = parseDbQuestions(duplicateDb);
assert.equal(duplicateParsed.duplicateQuestions.length, 1);
assert.ok(duplicateParsed.malformed.length >= 2);
console.log('Free API-less audit tests passed.');
