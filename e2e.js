// Headless end-to-end click-through for the Loan Payback Calculator.
// Loads the REAL pages in jsdom against the REAL server (fresh throwaway DB)
// and drives them like a visitor: picker, filters, per-loan calculators,
// manual calculator, nano flow, rate-on-request flow, kebab menu.
// Run: node e2e.js  (exit 0 = all pass)
// Needs jsdom, which is NOT bundled with the app (the app stays zero-dep).
// Install once in a scratch dir: mkdir /tmp/lpc-e2e && cd /tmp/lpc-e2e &&
// npm install jsdom — then run this file from there (it finds jsdom
// next to it). It spawns the real server on port 3036 with a throwaway DB.
'use strict';
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch {
  try { ({ JSDOM } = require('/tmp/lpc-e2e/node_modules/jsdom')); }
  catch { console.error('E2E needs jsdom (not bundled — the app stays zero-dep): mkdir /tmp/lpc-e2e && cd /tmp/lpc-e2e && npm install jsdom'); process.exit(1); }
}

const PORT = 3036;
const BASE = 'http://127.0.0.1:' + PORT;
const DIR = '/home/hatch/workspace/loan-payback-calculator';
const DB = '/tmp/lpc-e2e/test.sqlite';
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
function get(p) {
  return new Promise((resolve, reject) => {
    http.get(BASE + p, (res) => {
      let raw = ''; res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, raw }));
    }).on('error', reject);
  });
}
function waitUp(tries) {
  return get('/health').then(() => true).catch(() => {
    if (tries <= 0) throw new Error('server did not come up');
    return new Promise((r) => setTimeout(r, 300)).then(() => waitUp(tries - 1));
  });
}
function fire(el, type) {
  el.dispatchEvent(new el.ownerDocument.defaultView.Event(type, { bubbles: true }));
}
async function loadPage(urlPath) {
  const { raw } = await get(urlPath);
  const dom = new JSDOM(raw, {
    url: BASE + urlPath,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    // jsdom has no fetch: bridge to Node's fetch so the pages' own
    // fetch('/api/presets') works exactly like in a real browser.
    beforeParse(window) {
      window.fetch = (u, o) => globalThis.fetch(new URL(u, window.location.href).href, o);
    },
  });
  // Wait for the page's own scripts (incl. fetch /api/presets) to settle.
  await new Promise((r) => setTimeout(r, 2500));
  return dom;
}

async function main() {
  try { fs.unlinkSync(DB); } catch {}
  try { fs.unlinkSync(DB + '-wal'); } catch {}
  try { fs.unlinkSync(DB + '-shm'); } catch {}
  const child = spawn(process.execPath, [path.join(DIR, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    await waitUp(40);

    // ---- 1. API sanity ----
    const ap = JSON.parse((await get('/api/presets')).raw);
    check('API: 51 presets, 17 nano apps', ap.presets.length === 51 && ap.nano_apps.length === 17, ap.presets.length);

    // ---- 2. Home page: picker renders, chips filter, manual works ----
    const home = await loadPage('/');
    const hd = home.window.document;
    const cards = hd.querySelectorAll('#picker .loan-card');
    check('Home: picker renders 51 loan cards', cards.length === 51, cards.length);
    const nanoCards = hd.querySelectorAll('#nanoApps .loan-card');
    check('Home: nano section renders 17 app cards', nanoCards.length === 17, nanoCards.length);
    const nanoText = (hd.getElementById('nanoApps') || { textContent: '' }).textContent;
    check('Home: nano section lists all 17 apps', /Paisayaar/.test(nanoText) && /Fori Raqam/.test(nanoText), nanoText.slice(0, 120));
    check('Home: no undefined/NaN anywhere', !/undefined|NaN/.test(hd.body.textContent), null);
    // Search filter: type "jazzcash" -> only JazzCash cards visible.
    const search = hd.getElementById('loanSearch') || hd.querySelector('.search-box input');
    if (search) {
      search.value = 'jazzcash'; fire(search, 'input');
      await new Promise((r) => setTimeout(r, 300));
      const visible = Array.from(hd.querySelectorAll('#picker .loan-card'));
      check('Home: search "jazzcash" narrows the list to 3 cards', visible.length === 3 && visible.every((c) => /jazzcash/i.test(c.textContent)), visible.length);
      search.value = ''; fire(search, 'input');
      await new Promise((r) => setTimeout(r, 300));
    } else {
      check('Home: search box exists', false, null);
    }
    // Category chip: click "Card instalments" -> 9 cards.
    const chips = Array.from(hd.querySelectorAll('.chip'));
    const cardChip = chips.find((c) => /Card instalments/.test(c.textContent));
    if (cardChip) {
      cardChip.click();
      await new Promise((r) => setTimeout(r, 300));
      const visible = Array.from(hd.querySelectorAll('#picker .loan-card'));
      check('Home: "Card instalments" chip shows 9 cards (incl. 3 new)', visible.length === 9, visible.length);
      const allChip = chips.find((c) => /All/.test(c.textContent));
      if (allChip) { allChip.click(); await new Promise((r) => setTimeout(r, 300)); }
    } else {
      check('Home: "Card instalments" chip exists', false, null);
    }
    // Manual calculator: 10,000 at 5%/week simple x 2 weeks -> 11,000.
    const setVal = (id, v) => { const el = hd.getElementById(id); if (!el) return false; el.value = v; fire(el, 'input'); fire(el, 'change'); return true; };
    setVal('mAmount', '10000'); setVal('mRate', '5');
    setVal('mTenureValue', '2');
    const mMode = hd.getElementById('mMode'); if (mMode) { mMode.value = 'weekly-simple'; fire(mMode, 'change'); }
    const mUnit = hd.getElementById('mTenureUnit'); if (mUnit) { mUnit.value = 'weeks'; fire(mUnit, 'change'); }
    await new Promise((r) => setTimeout(r, 300));
    check('Manual: 10,000 at 5%/wk simple x 2 weeks -> Rs 11,000', (hd.getElementById('mrTotal') || {}).textContent === 'Rs 11,000', (hd.getElementById('mrTotal') || {}).textContent);
    check('Manual: no undefined/NaN in results', !/undefined|NaN/.test((hd.getElementById('mResults') || { textContent: '' }).textContent), null);
    // Early-repayment note with markup must render as text, not as HTML.
    const noteEl = hd.getElementById('mEarlyNote');
    if (noteEl) {
      noteEl.value = '<img src=x onerror="window.__xss=1">'; fire(noteEl, 'input');
      await new Promise((r) => setTimeout(r, 300));
      const notesBox = hd.getElementById('mrNotes');
      check('Manual: early note with HTML renders as text, not an element', notesBox && !notesBox.querySelector('img') && notesBox.textContent.includes('<img src=x'), notesBox && notesBox.textContent.slice(0, 200));
      check('Manual: note markup did not execute', !hd.defaultView.__xss, null);
      noteEl.value = ''; fire(noteEl, 'input');
      await new Promise((r) => setTimeout(r, 200));
    } else { check('Manual: early note field exists', false, null); }
    // Manual error: clear the amount -> visible error message, no results.
    setVal('mAmount', '');
    await new Promise((r) => setTimeout(r, 300));
    const mErr = hd.getElementById('mError');
    check('Manual: empty amount shows a clear error (not silent)', mErr && !mErr.hidden && mErr.textContent.length > 5, mErr && mErr.textContent);
    setVal('mAmount', '10000');
    await new Promise((r) => setTimeout(r, 300));
    // Kebab menu opens and lists pages.
    const menuBtn = hd.querySelector('.menu-btn');
    if (menuBtn) {
      menuBtn.click();
      await new Promise((r) => setTimeout(r, 200));
      const menu = hd.querySelector('.overflow-menu');
      check('Home: kebab menu opens with page links', menu && !menu.hidden && /How it works/.test(menu.textContent) && /Sources/.test(menu.textContent), menu && menu.textContent.slice(0, 80));
    } else { check('Home: kebab menu button exists', false, null); }
    home.window.close();

    // ---- 3. Per-loan calculator: Easycash Rs 10,000 x 4 wks = Rs 12,155 ----
    const ec = await loadPage('/calculator.html?preset=easycash-app');
    const ed = ec.window.document;
    const policyText = (ed.getElementById('policyRows') || { textContent: '' }).textContent;
    check('Easycash policy: weekly rates read "5% (cycles 1–30)" not undefined', /5% \(cycles 1–30\), 4\.5% \(cycles 31–60\), 4% \(cycles 61\+\)/.test(policyText) && !/undefined/.test(policyText), policyText.slice(0, 200));
    const setEc = (id, v) => { const el = ed.getElementById(id); if (!el) return false; el.value = v; fire(el, 'input'); fire(el, 'change'); return true; };
    setEc('amount', '10000');
    setEc('borrowDate', '2026-11-06'); setEc('repayDate', '2026-12-04');
    const cyc = ed.getElementById('cycles'); if (cyc) { cyc.value = '4'; fire(cyc, 'input'); fire(cyc, 'change'); }
    await new Promise((r) => setTimeout(r, 400));
    check('Easycash: Rs 10,000 x 4 weeks = Rs 12,155', (ed.getElementById('rTotal') || {}).textContent === 'Rs 12,155', (ed.getElementById('rTotal') || {}).textContent);
    check('Easycash: no undefined/NaN on the page', !/undefined|NaN/.test(ed.body.textContent), null);
    // Range warning: 30,000 is above the Rs 25,000 max.
    setEc('amount', '30000');
    await new Promise((r) => setTimeout(r, 400));
    const rw = ed.getElementById('rangeWarn');
    check('Easycash: amount above max shows the range warning', rw && !rw.hidden && /25,000/.test(rw.textContent), rw && rw.textContent);
    ec.window.close();

    // ---- 4. ReadyCash Rs 20,000 x 28d = Rs 24,000 ----
    const rc = await loadPage('/calculator.html?preset=jazzcash-readycash');
    const rd = rc.window.document;
    const rcPolicy = (rd.getElementById('policyRows') || { textContent: '' }).textContent;
    check('ReadyCash policy: charged line reads "5% a week on the loan, simple"', /5% a week on the loan, simple \(not compounded\)/.test(rcPolicy), rcPolicy.slice(0, 200));
    const setRc = (id, v) => { const el = rd.getElementById(id); if (!el) return false; el.value = v; fire(el, 'input'); fire(el, 'change'); return true; };
    setRc('amount', '20000');
    setRc('borrowDate', '2026-11-06'); setRc('repayDate', '2026-12-04');
    await new Promise((r) => setTimeout(r, 400));
    check('ReadyCash: Rs 20,000 x 28 days = Rs 24,000', (rd.getElementById('rTotal') || {}).textContent === 'Rs 24,000', (rd.getElementById('rTotal') || {}).textContent);
    rc.window.close();

    // ---- 5. HBL: late-fee line reads "Rs 1,500 + FED", not "—" ----
    const hb = await loadPage('/calculator.html?preset=hbl-personal');
    const hbd = hb.window.document;
    const hPolicy = (hbd.getElementById('policyRows') || { textContent: '' }).textContent;
    check('HBL policy: late fee reads "Rs 1,500 + FED per late payment"', /Rs 1,500 \+ FED per late payment/.test(hPolicy), hPolicy.slice(0, 400));
    check('HBL policy: no bare "—" late fee', !/Late fee—/.test(hPolicy.replace(/\s+/g, '')), null);
    hb.window.close();

    // ---- 6. New card instalment: SCB Asaan renders + computes ----
    const sc = await loadPage('/calculator.html?preset=scb-asaan');
    const scd = sc.window.document;
    const scPolicy = (scd.getElementById('policyRows') || { textContent: '' }).textContent;
    check('SCB Asaan: policy shows up to 46% + editable rate', /46%/.test(scPolicy), scPolicy.slice(0, 200));
    const setSc = (id, v) => { const el = scd.getElementById(id); if (!el) return false; el.value = v; fire(el, 'input'); fire(el, 'change'); return true; };
    setSc('amount', '100000');
    await new Promise((r) => setTimeout(r, 400));
    const scTotal = (scd.getElementById('rTotal') || {}).textContent;
    check('SCB Asaan: Rs 100,000 at 46% x 12 months computes', /^Rs 1[0-9]{2},/.test(scTotal || ''), scTotal);
    sc.window.close();

    // ---- 7. Rate on request: UBL CashPlus needs the KFS rate ----
    const ror = await loadPage('/calculator.html?preset=ubl-cashplus');
    const rord = ror.window.document;
    const hint = rord.getElementById('presetHint');
    check('ROR: hint asks for the Key Fact Statement rate', hint && !hint.hidden && /Key Fact Statement/.test(hint.textContent), hint && hint.textContent);
    const setRor = (id, v) => { const el = rord.getElementById(id); if (!el) return false; el.value = v; fire(el, 'input'); fire(el, 'change'); return true; };
    setRor('amount', '100000');
    const kfsRate = rord.getElementById('kfsRate'); if (kfsRate) { kfsRate.value = '25'; fire(kfsRate, 'input'); fire(kfsRate, 'change'); }
    await new Promise((r) => setTimeout(r, 400));
    const rorTotal = (rord.getElementById('rTotal') || {}).textContent;
    check('ROR: after typing 25% from the KFS it computes', /^Rs /.test(rorTotal || '') && !/undefined|NaN/.test(rorTotal || ''), rorTotal);
    // KFS per-instalment late fee shows the instalments field (for a
    // flat-term KFS loan — for EMI the instalments are the term in months).
    const kfsLateKind = rord.getElementById('kfsLateKind');
    const kfsFeeKind = rord.getElementById('kfsFeeKind');
    if (kfsLateKind && kfsFeeKind) {
      kfsFeeKind.value = 'flat-term'; fire(kfsFeeKind, 'change');
      kfsLateKind.value = 'per-instalment-pct'; fire(kfsLateKind, 'change');
      await new Promise((r) => setTimeout(r, 300));
      const kfsInstWrap = rord.getElementById('kfsInstWrap');
      check('ROR: per-instalment late fee shows the instalments field', kfsInstWrap && !kfsInstWrap.hidden, kfsInstWrap && kfsInstWrap.hidden);
    } else { check('ROR: KFS late fee selector exists', false, null); }
    ror.window.close();

    // ---- 8. Nano flow: Paisayaar, breach warning shows ----
    const nz = await loadPage('/calculator.html?nano=Paisayaar');
    const nzd = nz.window.document;
    const setNz = (id, v) => { const el = nzd.getElementById(id); if (!el) return false; el.value = v; fire(el, 'input'); fire(el, 'change'); return true; };
    setNz('amount', '10000');
    const nFreq = nzd.getElementById('nanoFreq'); if (nFreq) { nFreq.value = 'flat-term'; fire(nFreq, 'input'); fire(nFreq, 'change'); }
    const nRate = nzd.getElementById('nanoRate'); if (nRate) { nRate.value = '10'; fire(nRate, 'input'); fire(nRate, 'change'); }
    await new Promise((r) => setTimeout(r, 400));
    const nzTotal = (nzd.getElementById('rTotal') || {}).textContent;
    check('Nano: Paisayaar 10,000 at 10% flat 30d -> Rs 11,000', nzTotal === 'Rs 11,000', nzTotal);
    // Breach: 200% flat for 30 days breaks the APR cap (120%).
    if (nRate) { nRate.value = '200'; fire(nRate, 'input'); fire(nRate, 'change'); }
    await new Promise((r) => setTimeout(r, 400));
    const nw = nzd.getElementById('nanoWarnings');
    check('Nano: 200% rate shows a guardrail breach warning', nw && /breach|cap|exceed/i.test(nw.textContent), nw && nw.textContent.slice(0, 200));
    nz.window.close();

    // ---- 9. Unknown preset + all internal links ----
    const unk = await loadPage('/calculator.html?preset=nope-123');
    const unkd = unk.window.document;
    check('Unknown preset: page says so plainly', /Unknown|not found|Pick a loan/i.test(unkd.body.textContent), unkd.body.textContent.slice(0, 120));
    unk.window.close();
    for (const page of ['/', '/how.html', '/sources.html', '/calculator.html?preset=easycash-app']) {
      const { raw } = await get(page);
      const hrefs = Array.from(raw.matchAll(/href="(\/[^"#]*)"/g)).map((m) => m[1]);
      const uniq = [...new Set(hrefs)];
      let bad = [];
      for (const h of uniq) {
        const r = await get(h.split('?')[0] === '/calculator.html' ? h : h);
        if (r.status !== 200) bad.push(h + ':' + r.status);
      }
      check('Links on ' + page + ' all return 200 (' + uniq.length + ' links)', bad.length === 0, bad.join(', '));
    }
    // Mobile CSS: collapse rules exist for small screens.
    const css = fs.readFileSync(path.join(DIR, 'public', 'styles.css'), 'utf8');
    check('Mobile CSS: 520px breakpoint collapses grids', /@media \(max-width: 520px\)/.test(css) && /\.late-cards \{[^}]*grid-template-columns: 1fr/.test(css), null);
    check('Mobile CSS: 44px minimum tap targets', /min-height: 44px/.test(css) && /min-height: 48px/.test(css), null);
    // No external dependencies: only <script src> and stylesheet <link>
    // count as deps (plain <a href> source links are content, not deps).
    for (const page of ['/', '/calculator.html', '/how.html', '/sources.html']) {
      const { raw } = await get(page);
      const ext = [
        ...Array.from(raw.matchAll(/<script[^>]+src="(https?:[^"]+)"/g)).map((m) => m[1]),
        ...Array.from(raw.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(https?:[^"]+)"/g)).map((m) => m[1]),
      ];
      check('Self-contained: ' + page + ' has no external script/style deps', ext.length === 0, ext.join(', '));
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    try { fs.unlinkSync(DB); } catch {}
    try { fs.unlinkSync(DB + '-wal'); } catch {}
    try { fs.unlinkSync(DB + '-shm'); } catch {}
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) { console.log('E2E FAILED'); process.exit(1); }
  console.log('E2E ALL PASSED');
}
main().catch((e) => { console.error('E2E CRASHED:', e); process.exit(1); });
