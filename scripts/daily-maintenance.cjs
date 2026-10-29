#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function out(key, value) {
  const line = String(key) + '=' + String(value ?? '').replace(/[\r\n]/g, ' ');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, line + '\n');
  console.log(line);
}
function info(message) { console.log('[daily-maintenance] ' + message); }
function norm(value) { return String(value || '').toLocaleLowerCase().replace(/\s+/g, ' ').trim(); }

function matchingBracket(source, open) {
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error('Unclosed bracket at offset ' + open);
}

function arraySpan(source, marker, from = 0) {
  const at = source.indexOf(marker, from);
  if (at < 0) throw new Error('Missing array marker: ' + marker);
  const open = source.indexOf('[', at + marker.length);
  if (open < 0) throw new Error('Missing array opening bracket: ' + marker);
  return { open, close: matchingBracket(source, open), markerAt: at };
}

function splitTopLevelItems(source, open, close) {
  const items = [];
  let start = open + 1, depth = 0, quote = '', escaped = false;
  for (let i = open + 1; i < close; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      const item = source.slice(start, i).trim();
      if (item) items.push(item);
      start = i + 1;
    }
  }
  const last = source.slice(start, close).trim();
  if (last) items.push(last);
  return items;
}

function parseItems(source, span) {
  return splitTopLevelItems(source, span.open, span.close).map(raw => {
    try { return JSON.parse(raw.replace(/,\s*$/, '')); }
    catch { return { __raw: raw }; }
  });
}

function insertArrayItem(source, span, item) {
  const before = source.slice(span.open + 1, span.close).trimEnd();
  const separator = before.length === 0 || before.endsWith(',') ? '' : ',';
  return source.slice(0, span.close) + separator + JSON.stringify(item) + source.slice(span.close);
}

function parseApiJson(content) {
  try { return JSON.parse(content); } catch {}
  const first = content.indexOf('{'), last = content.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(content.slice(first, last + 1));
  throw new Error('Model response was not valid JSON.');
}

function questionText(item, kind) {
  if (kind === 'english-listening') return item && item.question || '';
  if (kind === 'japanese-case' || kind === 'db-question') return item && item.q || '';
  if (Array.isArray(item)) {
    if (kind === 'biology-row6' || kind === 'science-row5') return item[1] || '';
    return item[0] || '';
  }
  return '';
}
function validateOptions(options) {
  if (!Array.isArray(options) || options.length !== 4 || options.some(x => typeof x !== 'string' || !x.trim())) {
    throw new Error('Generated question must have exactly four non-empty options.');
  }
  const normalized = options.map(norm);
  if (new Set(normalized).size !== 4) throw new Error('Generated question options must be unique.');
}
function validateIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index > 3) throw new Error('Answer index must be 0, 1, 2, or 3.');
}

function writesEnabled(value) { return value === 'true'; }

function targetFor(repo, day) {
  // Only add to expandable question banks. Fixed-length common-test arrays are
  // validation-only until they have a separate candidate bank and group-aware sampler.
  const rotation = [
    { repo: 'pass-juken-academy2026/english-study', target: { file: 'index.html', kind: 'db-question' } },
    { repo: 'pass-juken-academy2026/math-juken-saitama', target: { file: 'index.html', kind: 'db-question' } },
    { repo: 'pass-juken-academy2026/junior-japanese', target: { file: 'index.html', kind: 'db-question' } },
    { repo: 'pass-juken-academy2026/junior-science', target: { file: 'index.html', kind: 'db-question' } },
    { repo: 'pass-juken-academy2026/junior-social-studies', target: { file: 'index.html', kind: 'db-question' } },
    { repo: 'pass-juken-academy2026/highschool-japanese', target: { file: 'index.html', kind: 'japanese-case' } },
    { repo: 'pass-juken-academy2026/highschool-biology', target: { file: 'index.html', kind: 'biology-row4', marker: 'qs:' } },
    { repo: 'pass-juken-academy2026/highschool-information', target: { file: 'index.html', kind: 'db-question' } },
    { repo: 'pass-juken-academy2026/highschool-math', target: { file: 'practice.html', kind: 'math-row5', marker: 'const COMMON_TEST=' } }
  ];
  const selected = rotation[Math.abs(Number(day) || 0) % rotation.length];
  return selected && repo === selected.repo ? selected.target : null;
}

function extractDb(source) {
  const marker = 'const DB=';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('Could not locate the existing DB object.');
  const jsonStart = start + marker.length;
  const end = source.indexOf(',key=', jsonStart);
  if (end < 0) throw new Error('Could not locate the end of the DB object.');
  const db = JSON.parse(source.slice(jsonStart, end));
  return { db, questionSpan: arraySpan(source, '"questions":[', jsonStart) };
}

function japaneseQuestionSpan(source, day) {
  const marker = 'const JAPANESE_COMMON_CASES=';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('Could not locate Japanese common-test cases.');
  const end = source.indexOf('function start(', start);
  const section = source.slice(start, end > start ? end : source.length);
  const matches = [...section.matchAll(/questions\s*:\s*\[/g)];
  if (!matches.length) throw new Error('No Japanese common-test question arrays found.');
  const chosen = matches[day % matches.length];
  const open = start + chosen.index + chosen[0].lastIndexOf('[');
  return { open, close: matchingBracket(source, open), caseCount: matches.length };
}
function decodeQuoted(value) {
  try { return JSON.parse('"' + value + '"'); } catch { return value; }
}

async function generate(apiKey, model, context) {
  const system = 'You write original Japanese educational practice questions. Never reproduce official exam questions or copyrighted passages. Return JSON only. Check the correct answer independently, ensure exactly one correct choice, use plausible distractors, and explain the answer briefly. Do not invent new subjects or change exam formats.';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: context }]
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error('OpenAI API error ' + response.status + ': ' + JSON.stringify(body).slice(0, 700));
  const text = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  if (!text) throw new Error('OpenAI API returned no message content.');
  return parseApiJson(text);
}

function chooseLowestTopic(db) {
  const topics = Array.isArray(db.topics) ? db.topics : [];
  const questions = Array.isArray(db.questions) ? db.questions : [];
  if (!topics.length) throw new Error('No existing topics in DB.');
  const counts = topics.map(t => ({ name: t.name, count: questions.filter(q => q.topic === t.name).length }));
  counts.sort((a, b) => a.count - b.count);
  return counts[0].name;
}

async function main() {
  const repo = process.env.TARGET_REPOSITORY || process.env.GITHUB_REPOSITORY || '';
  const date = new Date().toISOString().slice(0, 10);
  const day = Number(date.replace(/-/g, '')) || 0;
  const apiKey = process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  const target = targetFor(repo, day);

  if (!target) {
    info(repo + ' has no question bank targeted for automated additions; validation-only run.');
    out('changed', 'false'); out('summary', 'No question bank in this repository; validation only.');
    return;
  }

  if (!writesEnabled(process.env.A_PLAN_WRITE_ENABLED)) {
    info('A_PLAN_WRITE_ENABLED is not true; automatic generation is disabled.');
    out('changed', 'false'); out('summary', 'Automatic generation disabled by explicit write gate.');
    return;
  }
  const filePath = path.resolve(target.file);
  if (!fs.existsSync(filePath)) throw new Error('Target file not found: ' + target.file);
  const source = fs.readFileSync(filePath, 'utf8');

  if (!apiKey) {
    info('OPENAI_API_KEY is not available; question generation is skipped. Static and UI tests will still run.');
    out('changed', 'false'); out('summary', 'Question generation skipped: OPENAI_API_KEY secret is not configured.');
    return;
  }

  let span, items, sampleItems, stimulus = null, stimulusIndex = 0, db = null, topic = null;
  const kind = target.kind;
  if (kind === 'db-question') {
    const parsed = extractDb(source);
    db = parsed.db; span = parsed.questionSpan; items = db.questions || [];
    topic = chooseLowestTopic(db);
    sampleItems = items.slice(-8);
  } else if (kind === 'japanese-case') {
    span = japaneseQuestionSpan(source, day);
    const rawItems = splitTopLevelItems(source, span.open, span.close);
    items = rawItems.map(raw => {
      const m = raw.match(/\bq\s*:\s*"((?:\\.|[^"])*)"/);
      return { q: m ? decodeQuoted(m[1]) : '', __raw: raw };
    });
    sampleItems = items.slice(-6);
    const sectionStart = source.indexOf('const JAPANESE_COMMON_CASES=');
    const caseTitles = [...source.slice(sectionStart, span.open).matchAll(/title\s*:\s*"((?:\\.|[^"])*)"/g)];
    const title = caseTitles.length ? decodeQuoted(caseTitles[caseTitles.length - 1][1]) : '高校国語 共通テスト型';
    const passages = [...source.slice(sectionStart, span.open).matchAll(/passage\s*:\s*"((?:\\.|[^"])*)"/g)];
    stimulus = { title: title, passage: passages.length ? decodeQuoted(passages[passages.length - 1][1]).slice(0, 2400) : '' };
  } else {
    span = arraySpan(source, target.marker);
    items = parseItems(source, span);
    sampleItems = items.slice(-8);
    if (kind === 'stimulus-row5') {
      const stimSpan = arraySpan(source, target.stimuliMarker);
      const stimRaw = source.slice(stimSpan.open, stimSpan.close + 1);
      const stimuli = JSON.parse(stimRaw);
      stimulusIndex = day % stimuli.length;
      stimulus = stimuli[stimulusIndex];
    } else if (kind === 'biology-row6') {
      const last = items.length ? items[items.length - 1] : null;
      stimulus = Array.isArray(last) ? last[5] : '';
    }
  }

  const existing = new Set(items.map(item => norm(questionText(item, kind))).filter(Boolean));
  let context = '';
  if (kind === 'english-listening') {
    context = 'Repository: ' + repo + '. Add exactly one new item to the existing English common-test listening bank. Output JSON object with keys title, audioText, question, options, answer, explain. audioText must be a short original English announcement/dialogue suitable for browser speech synthesis; question is in English; options is exactly 4 English strings; answer must exactly match one option; explain is a concise Japanese explanation. Do not use an official exam script. Existing recent questions: ' + JSON.stringify(sampleItems.map(x => ({ title: x.title, audioText: x.audioText, question: x.question, options: x.options, answer: x.answer }))).slice(0, 6500);
  } else if (kind === 'db-question') {
    context = 'Repository: ' + repo + '. Add exactly one original multiple-choice question to the existing DB.questions array. Output JSON object with keys topic, q, options, a, ex. topic must be exactly "' + topic + '". options must have exactly four Japanese strings; a is a zero-based integer from 0 to 3; ex is a concise Japanese explanation. Use existing topics only. Existing topics and counts: ' + JSON.stringify(db.topics.map(t => ({ name: t.name, count: (db.questions || []).filter(q => q.topic === t.name).length }))) + '. Recent questions: ' + JSON.stringify(sampleItems.map(x => ({ topic: x.topic, q: x.q, options: x.options, a: x.a }))).slice(0, 4500);
  } else if (kind === 'japanese-case') {
    context = 'Repository: ' + repo + '. Add one original question to an existing high-school Japanese common-test passage. Output JSON object with keys q, c, a, e. c must be exactly four Japanese options; a is a zero-based index 0-3; e is a concise Japanese explanation. The existing passage is: ' + JSON.stringify(stimulus) + '. Recent questions in this passage: ' + JSON.stringify(sampleItems.map(x => x.q)).slice(0, 2500);
  } else if (kind === 'biology-row6') {
    context = 'Repository: ' + repo + '. Add one original biology common-test question based on this existing stimulus: ' + String(stimulus || '').slice(0, 2200) + '. Output JSON object with keys question, options, answerIndex, explanation. options must be four Japanese strings; answerIndex is 0-3; explanation is concise Japanese. Recent questions: ' + JSON.stringify(sampleItems.map(x => Array.isArray(x) ? x[1] : '')).slice(0, 3000);
  } else if (kind === 'biology-row4') {
    context = 'Repository: ' + repo + '. Add one original high-school biology practice question in the existing four-field row format. Output JSON object with keys question, options, answerIndex, explanation. question must be self-contained and factually accurate; options must be exactly four Japanese strings with one correct answer; answerIndex is 0-3; explanation is concise Japanese. Recent questions: ' + JSON.stringify(sampleItems.map(x => Array.isArray(x) ? x[0] : '')).slice(0, 2800);
  } else if (kind === 'science-row5') {
    context = 'Repository: ' + repo + ', target file ' + target.file + '. Add one original question appropriate to the existing subject common-test practice. Each question prompt must contain enough original context/data to be answerable by itself. Output JSON object with keys question, options, answerIndex, explanation. options must be four Japanese strings; answerIndex is 0-3; explanation is concise Japanese. Recent questions: ' + JSON.stringify(sampleItems.map(x => Array.isArray(x) ? x[1] : '')).slice(0, 3200);
  } else if (kind === 'stimulus-row5') {
    context = 'Repository: ' + repo + '. Add one original question based only on this existing synthetic practice stimulus: ' + JSON.stringify(stimulus) + '. Output JSON object with keys question, options, answerIndex, explanation. options must be four Japanese strings; answerIndex is 0-3; explanation is concise Japanese. Use no outside facts not needed for the question. Recent questions: ' + JSON.stringify(sampleItems.map(x => Array.isArray(x) ? x[0] : '')).slice(0, 3200);
  } else if (kind === 'math-row5') {
    context = 'Repository: ' + repo + '. Add one original high-school mathematics common-test style question. Output JSON object with keys question, options, answerIndex, explanation. options must be four Japanese strings; answerIndex is 0-3; explanation must show a short correct calculation/reasoning. Use the existing question bank style and do not copy official exams. Recent questions: ' + JSON.stringify(sampleItems.map(x => Array.isArray(x) ? x[0] : '')).slice(0, 3500);
  }

  const generated = await generate(apiKey, model, context);
  let newItem;
  if (kind === 'english-listening') {
    validateOptions(generated.options);
    if (!generated.answer || !generated.options.includes(generated.answer) || !generated.audioText || !generated.question || !generated.explain) throw new Error('Invalid English listening item.');
    newItem = { id: 'ct-listen-auto-' + date.replace(/-/g, '') + '-' + (items.length + 1), examType: 'common-listening', title: String(generated.title || '追加リスニング問題').slice(0, 100), audioText: String(generated.audioText).slice(0, 900), question: String(generated.question).slice(0, 350), options: generated.options.map(String), answer: String(generated.answer), explain: String(generated.explain).slice(0, 500) };
  } else if (kind === 'db-question') {
    validateOptions(generated.options); validateIndex(generated.a);
    if (generated.topic !== topic || !generated.q || !generated.ex) throw new Error('Invalid DB question.');
    newItem = { topic: topic, q: String(generated.q).slice(0, 350), options: generated.options.map(String), a: generated.a, ex: String(generated.ex).slice(0, 500) };
  } else if (kind === 'japanese-case') {
    validateOptions(generated.c); validateIndex(generated.a);
    if (!generated.q || !generated.e) throw new Error('Invalid Japanese common-test question.');
    newItem = { q: String(generated.q).slice(0, 350), c: generated.c.map(String), a: generated.a, e: String(generated.e).slice(0, 500) };
  } else {
    validateOptions(generated.options); validateIndex(generated.answerIndex);
    if (!generated.question || !generated.explanation) throw new Error('Invalid generated question.');
    const prompt = String(generated.question).slice(0, 500);
    if (kind === 'biology-row6') newItem = ['ct-bio-auto-' + date.replace(/-/g, '') + '-' + (items.length + 1), prompt, generated.options.map(String), generated.answerIndex, String(generated.explanation).slice(0, 500), String(stimulus || '')];
    else if (kind === 'biology-row4') newItem = [prompt, generated.options.map(String), generated.answerIndex, String(generated.explanation).slice(0, 500)];
    else if (kind === 'science-row5') {
      const prefix = target.file.startsWith('chemistry/') ? 'ct-chem-auto-' : target.file.startsWith('physics/') ? 'ct-phys-auto-' : target.file.startsWith('earth-science/') ? 'ct-earth-auto-' : 'ct-sci-auto-';
      newItem = [prefix + date.replace(/-/g, '') + '-' + (items.length + 1), prompt, generated.options.map(String), generated.answerIndex, String(generated.explanation).slice(0, 500)];
    } else if (kind === 'stimulus-row5') newItem = [prompt, generated.options.map(String), generated.answerIndex, String(generated.explanation).slice(0, 500), stimulusIndex];
    else if (kind === 'math-row5') newItem = [prompt, generated.options.map(String), generated.answerIndex, String(generated.explanation).slice(0, 500), 0];
  }

  const newPrompt = norm(questionText(newItem, kind));
  if (!newPrompt || existing.has(newPrompt)) {
    info('Generated question was empty or duplicated; no change made.');
    out('changed', 'false'); out('summary', 'Generated question was duplicate/empty; no change applied.');
    return;
  }
  const updated = insertArrayItem(source, span, newItem);
  fs.writeFileSync(filePath, updated, 'utf8');
  info('Added one original question to ' + target.file + ' (' + kind + ').');
  out('changed', 'true'); out('file', target.file); out('summary', 'Added one original question to ' + target.file + ' (' + kind + ').');
}

if (require.main === module) {
  main().catch(error => {
    console.error('[daily-maintenance] ' + (error && error.stack || error));
    out('changed', 'false'); out('summary', 'Maintenance failed: ' + (error && error.message || error));
    process.exitCode = 1;
  });
}

module.exports = { targetFor, validateOptions, validateIndex, questionText, norm, writesEnabled };
