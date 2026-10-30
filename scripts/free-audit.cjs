#!/usr/bin/env node
'use strict';

// Free, deterministic audit for the existing education repositories.
// This script is read-only: it never edits the target repository and needs no API key.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\\s+/g, ' ').trim();
}

function auditHtml(html, filename = 'index.html') {
  const ids = [];
  const links = [];
  const inlineScripts = [];
  const idPattern = /\\bid\\s*=\\s*(["'])(.*?)\\1/gi;
  let match;
  while ((match = idPattern.exec(html))) ids.push(match[2]);
  const duplicateIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];

  const linkPattern = /<(?:a|script|link|img|iframe)\\b[^>]*?(?:href|src)\\s*=\\s*(["'])(.*?)\\1[^>]*>/gi;
  while ((match = linkPattern.exec(html))) {
    const url = match[2].trim();
    if (url && !/^(?:https?:|data:|mailto:|tel:|#|javascript:|\\/\\/)/i.test(url)) {
      links.push(url.split(/[?#]/)[0]);
    }
  }

  const scriptPattern = /<script\\b([^>]*)>([\\s\\S]*?)<\\/script\\s*>/gi;
  while ((match = scriptPattern.exec(html))) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const external = /\\bsrc\\s*=/.test(attrs);
    const typeMatch = attrs.match(/\\btype\\s*=\\s*(["'])(.*?)\\1/i);
    const type = typeMatch ? typeMatch[2].toLowerCase() : '';
    if (!external && body.trim() && (!type || ['text/javascript', 'application/javascript', 'module'].includes(type))) {
      inlineScripts.push(body);
    }
  }
  return { filename, bytes: Buffer.byteLength(html, 'utf8'), idCount: ids.length, duplicateIds, localLinks: [...new Set(links)], inlineScripts };
}

function parseDbQuestions(html) {
  const marker = 'const DB=';
  const start = html.indexOf(marker);
  if (start < 0) return { found: false, questionCount: null, duplicateQuestions: [], malformed: [] };
  const jsonStart = start + marker.length;
  const end = html.indexOf(',key=', jsonStart);
  if (end < 0) return { found: true, questionCount: null, duplicateQuestions: [], malformed: ['Could not locate DB terminator (,key=).'] };
  let db;
  try { db = JSON.parse(html.slice(jsonStart, end)); }
  catch (error) { return { found: true, questionCount: null, duplicateQuestions: [], malformed: ['DB JSON parse failed: ' + error.message] }; }
  const questions = Array.isArray(db.questions) ? db.questions : [];
  const seen = new Set();
  const duplicateQuestions = [];
  const malformed = [];
  questions.forEach((q, i) => {
    const key = normalize(q && (q.q || q.question));
    if (key && seen.has(key)) duplicateQuestions.push({ index: i, question: String(q.q || q.question).slice(0, 120) });
    if (key) seen.add(key);
    if (!q || typeof q !== 'object') malformed.push('Question ' + i + ' is not an object.');
    else {
      if (!key) malformed.push('Question ' + i + ' has no prompt.');
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.some(v => typeof v !== 'string' || !v.trim())) malformed.push('Question ' + i + ' has invalid options.');
      if (!Number.isInteger(q.a) || q.a < 0 || q.a >= (Array.isArray(q.options) ? q.options.length : 0)) malformed.push('Question ' + i + ' has invalid answer index.');
      if (typeof q.ex !== 'string' || !q.ex.trim()) malformed.push('Question ' + i + ' has no explanation.');
    }
  });
  return { found: true, topicCount: Array.isArray(db.topics) ? db.topics.length : 0, questionCount: questions.length, duplicateQuestions, malformed };
}

function checkScriptSyntax(scripts) {
  const failures = [];
  scripts.forEach((source, i) => {
    const tmp = path.join(os.tmpdir(), 'free-audit-' + process.pid + '-' + i + '.js');
    try {
      fs.writeFileSync(tmp, source, 'utf8');
      const result = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
      if (result.status !== 0) failures.push({ script: i + 1, error: (result.stderr || result.stdout || 'node --check failed').trim().slice(0, 1000) });
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  });
  return failures;
}

function runAudit(targetDir, repo) {
  const htmlFiles = fs.readdirSync(targetDir).filter(name => name.toLowerCase().endsWith('.html')).sort();
  const files = [];
  const errors = [];
  const warnings = [];
  if (!htmlFiles.length) errors.push('No top-level HTML files found.');
  for (const name of htmlFiles) {
    const full = path.join(targetDir, name);
    const html = fs.readFileSync(full, 'utf8');
    const result = auditHtml(html, name);
    const syntaxFailures = checkScriptSyntax(result.inlineScripts);
    const missingLinks = result.localLinks.filter(link => link && !fs.existsSync(path.resolve(targetDir, link)) && !link.startsWith('/'));
    if (result.duplicateIds.length) errors.push(name + ': duplicate IDs: ' + result.duplicateIds.join(', '));
    if (syntaxFailures.length) errors.push(name + ': inline JavaScript syntax errors: ' + syntaxFailures.map(x => 'script ' + x.script).join(', '));
    if (missingLinks.length) warnings.push(name + ': possibly missing local assets: ' + [...new Set(missingLinks)].slice(0, 20).join(', '));
    files.push({
      filename: name, bytes: result.bytes, idCount: result.idCount,
      duplicateIds: result.duplicateIds, inlineScriptCount: result.inlineScripts.length,
      inlineScriptFailures: syntaxFailures, missingLocalLinks: [...new Set(missingLinks)]
    });
  }
  const primaryName = fs.existsSync(path.join(targetDir, 'practice.html')) &&
    /highschool-(?:math|social-studies)$/.test(repo) ? 'practice.html' : 'index.html';
  const primaryPath = path.join(targetDir, primaryName);
  let bank = { found: false, questionCount: null, duplicateQuestions: [], malformed: [] };
  if (fs.existsSync(primaryPath)) {
    bank = parseDbQuestions(fs.readFileSync(primaryPath, 'utf8'));
    if (bank.malformed.length) errors.push(primaryName + ': question bank structural issues: ' + bank.malformed.slice(0, 10).join(' | '));
    if (bank.duplicateQuestions.length) warnings.push(primaryName + ': duplicate DB question prompts: ' + bank.duplicateQuestions.length);
  } else {
    warnings.push('Primary file ' + primaryName + ' not found; DB-specific checks skipped.');
  }
  return {
    repository: repo, generatedAt: new Date().toISOString(), mode: 'free-read-only-audit',
    files, bank, errors, warnings, passed: errors.length === 0
  };
}

function main() {
  const repo = process.env.TARGET_REPOSITORY || 'unknown';
  const targetDir = path.resolve(process.env.TARGET_DIR || process.cwd());
  const report = runAudit(targetDir, repo);
  const json = JSON.stringify(report, null, 2) + '\\n';
  const md = [
    '# Free automated audit',
    '',
    '- Repository: ' + report.repository,
    '- Generated: ' + report.generatedAt,
    '- Result: ' + (report.passed ? 'PASS' : 'FAIL'),
    '- Mode: read-only; no API key; no repository changes',
    '',
    '## Files',
    ...report.files.map(f => '- ' + f.filename + ': ' + f.bytes + ' bytes, ' + f.idCount + ' IDs, ' + f.inlineScriptCount + ' inline scripts, ' + f.inlineScriptFailures.length + ' syntax failures'),
    '',
    '## Question bank',
    '- DB found: ' + report.bank.found,
    '- Topics: ' + (report.bank.topicCount ?? 'n/a'),
    '- Questions: ' + (report.bank.questionCount ?? 'n/a'),
    '- Duplicate prompts: ' + (report.bank.duplicateQuestions?.length ?? 0),
    '- Structural issues: ' + (report.bank.malformed?.length ?? 0),
    '',
    '## Errors',
    ...(report.errors.length ? report.errors.map(e => '- ' + e) : ['- None']),
    '',
    '## Warnings',
    ...(report.warnings.length ? report.warnings.map(w => '- ' + w) : ['- None']),
    ''
  ].join('\\n');
  const reportPath = process.env.AUDIT_REPORT_PATH;
  if (reportPath) fs.writeFileSync(reportPath, json, 'utf8');
  console.log(md);
  if (!report.passed) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { normalize, auditHtml, parseDbQuestions, checkScriptSyntax, runAudit };
