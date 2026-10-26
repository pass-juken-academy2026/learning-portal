const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = process.cwd();
const base = 'http://127.0.0.1:4173';
const viewports = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1365, height: 900 },
];
const failures = [];
const reviewFlags = [];
const screenshots = path.join(root, 'test-results', 'ui-audit');
fs.mkdirSync(screenshots, { recursive: true });

function walk(dir) {
  const found = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'test-results', 'playwright-report'].includes(ent.name)) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) found.push(...walk(abs));
    else if (ent.isFile() && ent.name.toLowerCase().endsWith('.html')) found.push(abs);
  }
  return found;
}
const pages = walk(root).sort();
if (!pages.length) throw new Error('No HTML pages found to audit.');

function localPathFromUrl(raw, currentFile) {
  try {
    const currentUrl = base + '/' + currentFile.split(path.sep).join('/');
    const u = new URL(raw, currentUrl);
    if (u.origin !== base) return null;
    let pathname = decodeURIComponent(u.pathname);
    if (pathname === '/') pathname = '/index.html';
    const target = path.resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) return path.join(target, 'index.html');
    return target;
  } catch { return null; }
}
function silentActionAllowed(label) {
  return /^(コピー|copy|共有|share|ダウンロード|download|リセット|reset|クリア|clear|解除|消去|削除|delete|閉じる|close|戻る|back|トップ|top|再生|play|一時停止|pause|ミュート|mute|音量|volume|メニュー|menu|詳細|more|拡大|縮小|zoom|前へ|次へ|prev|next|テーマ|theme|表示切替|toggle)$/i.test(label.trim())
    || /(コピー|copy|共有|share|ダウンロード|download|閉じる|close|メニュー|menu|音量|mute|再生|play|拡大|縮小|zoom)/i.test(label);
}
function cleanText(v) { return String(v || '').replace(/\s+/g, ' ').trim(); }

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const abs of pages) {
      const rel = path.relative(root, abs).split(path.sep).join('/');
      const route = base + '/' + rel.split('/').map(encodeURIComponent).join('/');
      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
        const jsErrors = [];
        const badResponses = [];
        page.on('pageerror', e => jsErrors.push(e.stack || e.message));
        page.on('response', r => {
          if (r.url().startsWith(base) && r.status() >= 400) badResponses.push(r.status() + ' ' + r.url());
        });
        try {
          const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20000 });
          if (!response || response.status() !== 200) failures.push(rel + ' [' + viewport.name + '] did not load with HTTP 200');
          await page.waitForTimeout(250);
          const state = await page.evaluate(() => ({
            title: document.title,
            text: (document.body?.innerText || '').trim(),
            bodyChildren: document.body?.children.length || 0,
            width: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          }));
          if (!state.bodyChildren || (state.text.length < 20 && state.bodyChildren < 2)) failures.push(rel + ' [' + viewport.name + '] appears blank (title: ' + state.title + ')');
          if (state.scrollWidth > state.width + 8) failures.push(rel + ' [' + viewport.name + '] horizontal overflow: ' + state.scrollWidth + 'px > ' + state.width + 'px');
          if (badResponses.length) failures.push(rel + ' [' + viewport.name + '] failed local resources: ' + Array.from(new Set(badResponses)).join('; '));
          if (jsErrors.length) failures.push(rel + ' [' + viewport.name + '] uncaught JS errors: ' + Array.from(new Set(jsErrors)).join('; '));
          await page.screenshot({ path: path.join(screenshots, rel.replace(/[^a-z0-9_-]/gi, '_') + '-' + viewport.name + '.png'), fullPage: true }).catch(() => {});
          
          const localRefs = await page.locator('a[href],script[src],link[rel="stylesheet"][href],img[src]').evaluateAll(els => els.map(el => {
            const raw = el.getAttribute('href') || el.getAttribute('src');
            if (!raw || /^(#|mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return null;
            let u; try { u = new URL(raw, location.href); } catch { return null; }
            if (u.origin !== location.origin) return null;
            return { tag: el.tagName.toLowerCase(), raw: raw, pathname: u.pathname };
          }).filter(Boolean));
          for (const ref of localRefs) {
            const target = localPathFromUrl(ref.pathname, rel);
            if (target && !fs.existsSync(target)) failures.push(rel + ': missing local ' + ref.tag + ' target ' + ref.raw);
          }
          const unlabeled = await page.locator('button, input:not([type="hidden"]), select, textarea, [role="button"]').evaluateAll(els => els.filter(el => {
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden' || !el.getClientRects().length || el.disabled) return false;
            const id = el.id;
            const hasLabel = (el.getAttribute('aria-label') || '').trim()
              || (el.getAttribute('title') || '').trim()
              || (el.labels && Array.from(el.labels).some(l => l.innerText.trim()))
              || (id && document.querySelector('label[for="' + CSS.escape(id) + '"]'))
              || (el.innerText || el.textContent || el.value || el.getAttribute('placeholder') || '').trim();
            return !hasLabel;
          }).map(el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '')));
          if (unlabeled.length) reviewFlags.push(rel + ' [' + viewport.name + '] controls without accessible labels: ' + unlabeled.join(', '));
          const emptyContainers = await page.locator('[data-cards],[data-results],[data-items],[data-questions],[data-lesson],[data-tips],[data-quick],[data-app],[data-data],[data-mock],[data-reviews],[id*="results"],[id*="list"],[id*="grid"],[class*="results"],[class*="cards"],[class*="grid"],[class*="list"]').evaluateAll(els => els.filter(el => {
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden' || !el.getClientRects().length) return false;
            if (el.id === 'sws-results' && !(document.getElementById('sws-query')?.value || '').trim()) return false;
            return !el.children.length && !(el.textContent || '').trim();
          }).map(el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ').join('.'))).slice(0, 8));
          if (emptyContainers.length) reviewFlags.push(rel + ' [' + viewport.name + '] visible content containers without items (review): ' + emptyContainers.join(', '));
          const tinyText = await page.locator('body *').evaluateAll(els => els.filter(el => {
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden' || !el.getClientRects().length) return false;
            if (!/^(P|H1|H2|H3|H4|LI|LABEL|BUTTON|A|TD|TH|SMALL|SPAN)$/.test(el.tagName)) return false;
            const directText = Array.from(el.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
            return directText.length > 2 && parseFloat(s.fontSize) < 12;
          }).map(el => ({ tag: el.tagName.toLowerCase(), id: el.id, size: getComputedStyle(el).fontSize, text: (el.textContent || '').trim().slice(0, 45) })).slice(0, 6));
          if (tinyText.length) reviewFlags.push(rel + ' [' + viewport.name + '] small visible text under 12px (review): ' + tinyText.map(x => x.tag + (x.id ? '#' + x.id : '') + ' ' + x.size + ' "' + x.text + '"').join('; '));
        } catch (e) {
          failures.push(rel + ' [' + viewport.name + '] ' + e.message);
          await page.screenshot({ path: path.join(screenshots, 'failure-' + rel.replace(/[^a-z0-9_-]/gi, '_') + '-' + viewport.name + '.png'), fullPage: true }).catch(() => {});
        } finally {
          await page.close();
        }
      }

      const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
      const jsErrors = [];
      page.on('pageerror', e => jsErrors.push(e.stack || e.message));
      try {
        await page.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(200);
        const count = await page.locator('button:visible:not([disabled])').count();
        for (let i = 0; i < count; i++) {
          await page.goto('about:blank');
          await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(100);
          const buttons = page.locator('button:visible:not([disabled])');
          if (i >= await buttons.count()) continue;
          const button = buttons.nth(i);
          const label = cleanText(await button.innerText().catch(() => '')) || await button.getAttribute('aria-label') || await button.getAttribute('title') || '(button ' + (i + 1) + ')';
          const before = await page.evaluate(() => ({
            url: location.href,
            html: document.body?.innerHTML || '',
            formState: JSON.stringify(Array.from(document.querySelectorAll('input,select,textarea')).map(el => ({ id: el.id, tag: el.tagName, value: el.value, checked: !!el.checked, selectedIndex: el.selectedIndex }))),
          }));
          try {
            await button.click({ timeout: 2500 });
            await page.waitForTimeout(150);
          } catch (e) {
            failures.push(rel + ': button "' + label + '" could not be clicked: ' + e.message.split('\n')[0]);
            continue;
          }
          const after = await page.evaluate(() => ({
            url: location.href,
            html: document.body?.innerHTML || '',
            formState: JSON.stringify(Array.from(document.querySelectorAll('input,select,textarea')).map(el => ({ id: el.id, tag: el.tagName, value: el.value, checked: !!el.checked, selectedIndex: el.selectedIndex }))),
          }));
          const emptyAfterClick = await page.locator('[data-cards],[data-results],[data-items],[data-questions],[data-lesson],[data-tips],[data-quick],[data-app],[data-data],[data-mock],[data-reviews],[id*="results"],[id*="list"],[id*="grid"],[class*="results"],[class*="cards"],[class*="grid"],[class*="list"]').evaluateAll(els => els.filter(el => {
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden' || !el.getClientRects().length) return false;
            if (el.id === 'sws-results' && !(document.getElementById('sws-query')?.value || '').trim()) return false;
            return !el.children.length && !(el.textContent || '').trim();
          }).map(el => el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ').join('.')).slice(0, 8));
          if (emptyAfterClick.length && /search|検索|学ぶ|開始|start|practice|演習|問題|表示|show|次へ|next|選択/i.test(label)) {
            reviewFlags.push(rel + ': after button "' + label + '", visible content containers have no items (review): ' + emptyAfterClick.join(', '));
          }
          if (before.url === after.url && before.html === after.html && before.formState === after.formState && !silentActionAllowed(label)) {
            failures.push(rel + ': button "' + label + '" had no observable effect when clicked');
          }
          if (jsErrors.length) {
            failures.push(rel + ': JS error after button "' + label + '": ' + Array.from(new Set(jsErrors)).join('; '));
            break;
          }
        }
      } catch (e) {
        failures.push(rel + ': button interaction audit failed: ' + e.message);
      } finally {
        await page.close();
      }
      console.log('Audited ' + rel);
    }
  } finally {
    await browser.close();
  }

  console.log('\nUI audit summary: ' + pages.length + ' HTML page(s), ' + (pages.length * viewports.length) + ' responsive page loads.');
  if (reviewFlags.length) {
    console.log('\nREVIEW FLAGS (' + reviewFlags.length + '; inspect manually):');
    for (const item of reviewFlags) console.log('- ' + item);
  }
  if (failures.length) {
    console.error('\nFAILURES (' + failures.length + '):');
    for (const item of failures) console.error('- ' + item);
    process.exitCode = 1;
  } else {
    console.log('PASS: no blocking browser, missing local resource, blank page, or horizontal overflow issues detected.');
  }
})().catch(e => { console.error(e); process.exit(1); });
