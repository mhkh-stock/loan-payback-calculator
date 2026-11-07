// Loan Payback Calculator tests. Checks the shared maths (public/calc.js)
// against the published examples, then spawns the real server on a fresh
// throwaway DB and checks the pages + the presets API.
// Run: node test.js  (exit 0 = all pass)
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const M = require('./public/calc.js');
const PRESETS = JSON.parse(fs.readFileSync(path.join(__dirname, 'presets.json'), 'utf8')).presets;
const byId = {};
for (const p of PRESETS) byId[p.id] = p;

const PORT = 3055;
const DB = path.join(__dirname, 'data', 'test.sqlite');
const BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = require('node:http').request(BASE + p, {
      method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, raw }); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
function waitUp(tries) {
  return req('GET', '/health').then(() => true).catch(() => {
    if (tries <= 0) throw new Error('server did not come up');
    return new Promise((r) => setTimeout(r, 300)).then(() => waitUp(tries - 1));
  });
}
const B = '2026-11-06';
function D(days) {
  const d = new Date(B + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function calc(id, principal, days, extra) {
  return M.compute(byId[id], { principal, cycles: 1, borrow_date: B, repay_date: D(days), term_option: 0, ...(extra || {}) });
}

async function main() {
  // ---- 1. Published examples (the numbers the lenders print) ----
  // Easypaisa Play Store example: Rs 20,000 at flat 32% -> Rs 26,400.
  const ex32 = M.compute(byId.custom, {
    principal: 20000, cycles: 1, borrow_date: B, repay_date: D(60),
    custom: { fee_kind: 'flat-term', rate_pct: 32, term_days: 60, late_kind: 'none', grace_days: 0, cap_kind: 'none' },
  });
  check('Easypaisa example: Rs 20,000 at flat 32% -> Rs 26,400', ex32.total === 26400 && ex32.markup === 6400, ex32);
  // JazzCash ReadyCash: Rs 5,000 for 1 week -> Rs 5,250.
  const rc1 = calc('jazzcash-readycash', 5000, 7);
  check('ReadyCash: Rs 5,000 x 1 week -> Rs 5,250', rc1.total === 5250 && rc1.markup === 250, rc1);
  // ReadyCash fee table: Rs 100 -> 105 / 110 / 115 / 120 over weeks 1-4.
  const rcTab = [7, 14, 21, 28].map((d) => calc('jazzcash-readycash', 100, d).total);
  check('ReadyCash table: 100 -> 105/110/115/120', JSON.stringify(rcTab) === '[105,110,115,120]', rcTab);
  // Easycash App compounding: Rs 10,000 x 4 weeks at 5% -> Rs 12,155.
  const ea4 = calc('easycash-app', 10000, 28);
  check('Easycash App: Rs 10,000 x 4 weeks compounded -> Rs 12,155', ea4.total === 12155, ea4);

  // ---- 2. Caps ----
  const eaCap = calc('easycash-app', 10000, 56);
  check('Easycash App cap: 10,000 x 56 days -> Rs 14,000 (40% cap), cap_hit', eaCap.total === 14000 && eaCap.markup === 4000 && eaCap.cap_hit === true, eaCap);
  const rcCap = calc('jazzcash-readycash', 10000, 56);
  check('ReadyCash cap: 10,000 x 56 days -> Rs 14,000 (40% cap)', rcCap.total === 14000 && rcCap.markup === 4000 && rcCap.cap_hit === true, rcCap);

  // ---- 3. Cycle tiers ----
  const eaT2 = M.compute(byId['easycash-app'], { principal: 10000, cycles: 40, borrow_date: B, repay_date: D(7) });
  check('Easycash App cycle 40 -> 4.5%/wk: 10,000 x 7d -> 10,450', eaT2.total === 10450, eaT2);
  const eaT3 = M.compute(byId['easycash-app'], { principal: 10000, cycles: 70, borrow_date: B, repay_date: D(7) });
  check('Easycash App cycle 70 -> 4%/wk: 10,000 x 7d -> 10,400', eaT3.total === 10400, eaT3);
  const usT2 = M.compute(byId['easycash-ussd'], { principal: 10000, cycles: 40, borrow_date: B, repay_date: D(30) });
  check('USSD cycle 40 -> 18% flat: 10,000 x 30d -> 11,800', usT2.total === 11800, usT2);
  const usT3 = M.compute(byId['easycash-ussd'], { principal: 10000, cycles: 70, borrow_date: B, repay_date: D(30) });
  check('USSD cycle 70 -> 16% flat: 10,000 x 30d -> 11,600', usT3.total === 11600, usT3);

  // ---- 4. Partial week (Easycash App, per-day-of-use) ----
  const eaPart = calc('easycash-app', 10000, 10);
  check('Easycash App partial week: 10,000 x 10d -> 10,725', eaPart.total === 10725, eaPart);

  // ---- 5. Grace periods: no fee inside grace, fee after ----
  const usOnTime = calc('easycash-ussd', 10000, 30);
  check('USSD on time: 10,000 x 30d -> 12,000, no late fee', usOnTime.total === 12000 && usOnTime.late_fee === 0, usOnTime);
  const usGrace = calc('easycash-ussd', 10000, 32);
  check('USSD day 32 (inside 2-day grace): still 12,000', usGrace.total === 12000 && usGrace.late_fee === 0, usGrace);
  const usLate = calc('easycash-ussd', 10000, 33);
  check('USSD day 33 (past grace): 12,500, late fee 500', usLate.total === 12500 && usLate.late_fee === 500, usLate);
  const bnplLate = M.compute(byId['easypaisa-bnpl'], { principal: 10000, cycles: 1, borrow_date: B, repay_date: D(31), term_option: 1 });
  check('BNPL 30d term, day 31: 12,500 (5% late fee, no grace)', bnplLate.total === 12500 && bnplLate.late_fee === 500, bnplLate);
  const bnpl14 = M.compute(byId['easypaisa-bnpl'], { principal: 10000, cycles: 1, borrow_date: B, repay_date: D(14), term_option: 0 });
  check('BNPL 14d term: 10,000 -> 11,000', bnpl14.total === 11000, bnpl14);

  // ---- 6. Daraz PayLater instalments + late-fee cap ----
  // Daraz 3mo: paying each instalment on its due date costs 26,000 in total.
  // (At day 90 the first two instalments are already overdue, so late fees apply.)
  const dz3 = M.compute(byId['daraz-paylater'], { principal: 20000, cycles: 1, borrow_date: B, repay_date: D(30), term_option: 1 });
  check('Daraz 3mo on time: Rs 20,000 -> total 26,000, instalment 8,667', dz3.total === 26000 && dz3.instalment === 8667 && dz3.late_fee === 0, dz3);
  const dz90 = M.compute(byId['daraz-paylater'], { principal: 20000, cycles: 1, borrow_date: B, repay_date: D(90), term_option: 1 });
  check('Daraz 3mo repaid day 90: instalments 1+2 overdue -> total 26,867, late 867', dz90.total === 26867 && dz90.late_fee === 867 && dz90.instalment === 8667, dz90);
  const dzLate = M.compute(byId['daraz-paylater'], { principal: 20000, cycles: 1, borrow_date: B, repay_date: D(31), term_option: 1 });
  check('Daraz 1 overdue instalment: late fee Rs 433 (under Rs 800 cap)', dzLate.late_fee === 433, dzLate);
  const dzCap = M.compute(byId['daraz-paylater'], { principal: 46154, cycles: 1, borrow_date: B, repay_date: D(31), term_option: 1 });
  check('Daraz late fee capped at Rs 800 (5% of a 20,000 instalment would be 1,000)', dzCap.late_fee === 800, dzCap);
  const dz1 = M.compute(byId['daraz-paylater'], { principal: 20000, cycles: 1, borrow_date: B, repay_date: D(30), term_option: 0 });
  check('Daraz 1mo: Rs 20,000 -> Rs 23,200', dz1.total === 23200, dz1);

  // ---- 7. JazzCash BNPL ----
  const jbn = M.compute(byId['jazzcash-bnpl'], { principal: 10000, cycles: 1, borrow_date: B, repay_date: D(30) });
  check('JazzCash BNPL on time: 10,000 -> 11,500, instalment 3,833', jbn.total === 11500 && jbn.instalment === 3833 && jbn.late_fee === 0, jbn);
  const jbnLate = calc('jazzcash-bnpl', 10000, 31);
  check('JazzCash BNPL 1 overdue instalment: late fee Rs 383', jbnLate.late_fee === 383, jbnLate);

  // ---- 8. Custom loans ----
  const cuSimple = M.compute(byId.custom, {
    principal: 10000, cycles: 1, borrow_date: B, repay_date: D(14),
    custom: { fee_kind: 'weekly-simple', rate_pct: 10, term_days: 14, late_kind: 'none', grace_days: 0, cap_kind: 'none' },
  });
  check('Custom weekly-simple 10%/wk: 10,000 x 14d -> 12,000', cuSimple.total === 12000, cuSimple);
  const cuComp = M.compute(byId.custom, {
    principal: 10000, cycles: 1, borrow_date: B, repay_date: D(14),
    custom: { fee_kind: 'weekly-compound', rate_pct: 5, term_days: 14, late_kind: 'none', grace_days: 0, cap_kind: 'none' },
  });
  check('Custom weekly-compound 5%/wk: 10,000 x 14d -> 11,025', cuComp.total === 11025, cuComp);
  const cuLate = M.compute(byId.custom, {
    principal: 10000, cycles: 1, borrow_date: B, repay_date: D(33),
    custom: { fee_kind: 'flat-term', rate_pct: 0, term_days: 30, late_kind: 'one-off-pct', late_pct: 5, grace_days: 2, cap_kind: 'none' },
  });
  check('Custom one-off late fee past grace: 10,000 -> 10,500', cuLate.total === 10500 && cuLate.late_fee === 500, cuLate);
  const cuLateGrace = M.compute(byId.custom, {
    principal: 10000, cycles: 1, borrow_date: B, repay_date: D(32),
    custom: { fee_kind: 'flat-term', rate_pct: 0, term_days: 30, late_kind: 'one-off-pct', late_pct: 5, grace_days: 2, cap_kind: 'none' },
  });
  check('Custom late fee inside grace: no fee', cuLateGrace.total === 10000 && cuLateGrace.late_fee === 0, cuLateGrace);
  const cuCap = M.compute(byId.custom, {
    principal: 10000, cycles: 1, borrow_date: B, repay_date: D(56),
    custom: { fee_kind: 'weekly-simple', rate_pct: 10, term_days: 56, late_kind: 'none', grace_days: 0, cap_kind: 'pct', cap_pct: 40 },
  });
  check('Custom cap 40%: 10,000 x 56d at 10%/wk -> 14,000', cuCap.total === 14000 && cuCap.cap_hit === true, cuCap);

  // ---- 9. Timeline + late cards + verdict + errors ----
  const rcT = calc('jazzcash-readycash', 5000, 7);
  const lastRow = rcT.timeline[rcT.timeline.length - 1];
  check('Timeline: first row is the loan, last row is the total', rcT.timeline[0].owed === 5000 && lastRow.owed === rcT.total, rcT.timeline);
  check('Late cards: +7 days on ReadyCash 5,000 -> 5,500', rcT.late.plus7.total === 5500, rcT.late);
  check('Late cards: +1 day costs more than on time', rcT.late.plus1.total > rcT.total && rcT.late.plus30.total > rcT.late.plus7.total, rcT.late);
  check('Verdict names the amount, the cost and the total', rcT.verdict.includes('Rs 5,000') && rcT.verdict.includes('Rs 5,250'), rcT.verdict);
  const errDate = M.compute(byId['jazzcash-readycash'], { principal: 5000, cycles: 1, borrow_date: D(7), repay_date: B });
  check('Error: repayment before borrow', !!errDate.error, errDate);
  const errAmt = M.compute(byId['jazzcash-readycash'], { principal: 0, cycles: 1, borrow_date: B, repay_date: D(7) });
  check('Error: zero amount', !!errAmt.error, errAmt);
  check('Cost %: ReadyCash 5,000 x 7d = 5%', rc1.cost_pct === 5, rc1);

  // ---- 10. EMI (annual-reducing) — hand-computed cases ----
  // Rs 100,000 at 12% for 12 months: EMI = 100000 x 0.01 x 1.01^12 / (1.01^12 - 1) = 8,885; total 106,619.
  const emi1 = M.compute(byId['hbl-personal'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(360), term_months: 12, annual_rate_pct: 12 });
  check('EMI: 100,000 at 12% x 12mo -> instalment 8,885, total 106,619', emi1.instalment === 8885 && emi1.total === 106619 && emi1.markup === 6619 && emi1.late_fee === 0, emi1);
  // 0% rate (Akhuwat): instalment is just P / n.
  const emi0 = M.compute(byId.akhuwat, { principal: 120000, cycles: 1, borrow_date: B, repay_date: D(720), term_months: 24 });
  check('EMI 0%: Akhuwat 120,000 x 24mo -> instalment 5,000, total 120,000', emi0.instalment === 5000 && emi0.total === 120000 && emi0.markup === 0, emi0);
  // Early settlement: settle a 12mo loan at 6 months -> instalments paid + remaining balance.
  const emiEarly = M.compute(byId['hbl-personal'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(180), term_months: 12, annual_rate_pct: 12 });
  check('EMI early settlement at 6mo: total 104,801, balance 51,492', emiEarly.total === 104801 && emiEarly.markup === 4801 && emiEarly.timeline[emiEarly.timeline.length - 1].owed === 51492, emiEarly);
  // Timeline for EMI: first row is the loan, balance falls to 0 at term end.
  check('EMI timeline: first row owed = 100,000, last row owed = 0', emi1.timeline[0].owed === 100000 && emi1.timeline[emi1.timeline.length - 1].owed === 0, emi1.timeline);
  // HBL late fee: 1 day past the 12-month term -> Rs 1,500.
  const hblLate = M.compute(byId['hbl-personal'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(361), term_months: 12, annual_rate_pct: 35.99 });
  check('HBL 1 day past term: late fee Rs 1,500', hblLate.late_fee === 1500 && hblLate.total === 122049, hblLate);
  const hblFull = M.compute(byId['hbl-personal'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(360), term_months: 12, annual_rate_pct: 35.99 });
  check('HBL 100,000 at 35.99% x 12mo -> instalment 10,046, total 120,549', hblFull.instalment === 10046 && hblFull.total === 120549, hblFull);

  // ---- 11. KIBOR + spread ----
  // MCB qualifying: 12.8 + 14 = 26.8% -> 100,000 x 12mo = 9,592 / 115,104.
  const mcbQ = M.compute(byId['mcb-personal'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(360), term_months: 12, kibor_rate: 12.8, rate_option: 0 });
  check('KIBOR MCB qualifying 26.8%: instalment 9,592, total 115,104', mcbQ.instalment === 9592 && mcbQ.total === 115104, mcbQ);
  const mcbN = M.compute(byId['mcb-personal'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(360), term_months: 12, kibor_rate: 12.8, rate_option: 1 });
  check('KIBOR MCB non-qualifying 28.8%: instalment 9,690, total 116,277', mcbN.instalment === 9690 && mcbN.total === 116277, mcbN);
  // JS CashAsaan with no spread typed: rate = KIBOR only, and the note warns.
  const js0 = M.compute(byId['js-cashasaan'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(360), term_months: 12, kibor_rate: 12.8, spread_pct: 0 });
  check('JS spread blank: rate is KIBOR only, warning note present', js0.instalment === 8922 && js0.notes.some((n) => n.includes('NOT set')), js0);
  // PM Youth Tier 1: 0% for 36 months, months fixed by the tier.
  const pm1 = M.compute(byId['pm-youth'], { principal: 500000, cycles: 1, borrow_date: B, repay_date: D(1080), rate_option: 0 });
  check('PM Youth Tier 1: 500,000 at 0% x 36mo -> instalment 13,889, total 500,000', pm1.instalment === 13889 && pm1.total === 500000 && pm1.due_days === 1080, pm1);

  // ---- 12. Islamic fixed price (annual-flat) ----
  // Meezan: 100,000 at 16.55% for 24mo -> profit 33,100, total 133,100, instalment 5,546.
  const mz = M.compute(byId['meezan-personal'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(720), term_months: 24 });
  check('Meezan: 100,000 at 16.55% x 24mo -> total 133,100, instalment 5,546', mz.total === 133100 && mz.instalment === 5546 && mz.markup === 33100, mz);

  // ---- 13. Price markup (BNPL) ----
  // QistBazaar: 100,000 price, 30% down, financed 70,000 + 8% over 3 months.
  const qb = M.compute(byId.qistbazaar, { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(90), term_option: 0 });
  check('QistBazaar 3mo: total 105,600, down 30,000, instalment 25,200, markup 5,600', qb.total === 105600 && qb.down_payment === 30000 && qb.financed_amount === 70000 && qb.instalment === 25200 && qb.markup === 5600 && qb.cost === 5600, qb);
  // Baadmay: 10,000 + 15% over 3 instalments.
  const bm = M.compute(byId.baadmay, { principal: 10000, cycles: 1, borrow_date: B, repay_date: D(90), term_option: 0 });
  check('Baadmay: 10,000 -> total 11,500, instalment 3,833', bm.total === 11500 && bm.instalment === 3833 && bm.markup === 1500, bm);

  // ---- 14. Flat fee (EWA) ----
  const ab = M.compute(byId['abhi-ewa'], { principal: 10000, cycles: 1, borrow_date: B, repay_date: D(30) });
  check('Abhi: 10,000 drawn -> total 10,150 (flat Rs 150 fee)', ab.total === 10150 && ab.markup === 150 && ab.late_fee === 0, ab);

  // ---- 15. Rate on request + BNPL other ratings ----
  const ror = M.compute(byId['ubl-cashplus'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(360) });
  check('Rate on request: UBL CashPlus is not calculable', !!ror.error && ror.not_calculable === true, ror);
  const rorNbp = M.compute(byId['nbp-advance-salary'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(360) });
  check('Rate on request: NBP Advance Salary is not calculable', !!rorNbp.error && rorNbp.not_calculable === true, rorNbp);
  const w3b = M.compute(byId['easypaisa-bnpl-other'], { principal: 10000, cycles: 1, borrow_date: B, repay_date: D(14), term_option: 1 });
  check('BNPL other ratings: 14d Good 17.5% -> 11,750', w3b.total === 11750 && w3b.markup === 1750, w3b);

  // ---- 16. SECP nano guardrails ----
  const nanoOk = M.nanoCheck({ amount: 25000, totalBorrowed: 25000, days: 90, totalCost: 20000, apr: 100 });
  check('Nano guardrails: at the caps, no violations', nanoOk.ok === true && nanoOk.violations.length === 0, nanoOk);
  const nanoBad = M.nanoCheck({ amount: 30000, totalBorrowed: 80000, days: 120, totalCost: 35000, apr: 150 });
  check('Nano guardrails: all five caps breached', nanoBad.ok === false && nanoBad.violations.length === 5, nanoBad);
  const nanoCost = M.nanoCheck({ amount: 10000, totalBorrowed: 10000, days: 30, totalCost: 12000, apr: 50 });
  check('Nano guardrails: total cost over the loan is a violation', nanoCost.ok === false && nanoCost.violations.some((v) => v.includes('more than the loan')), nanoCost);

  // ---- 17. Manual loan calculator (home page) — one hand-computed case per charging mode ----
  function man(f) { return M.compute({ id: 'custom' }, M.manualInput({ borrow_date: B, ...f })); }
  const m1 = man({ amount: 10000, rate: 5, mode: 'weekly-simple', tenure_value: 2, tenure_unit: 'weeks' });
  check('Manual: weekly simple 10,000 at 5%/wk x 2 weeks -> 11,000', m1.total === 11000 && m1.markup === 1000, m1);
  const m2 = man({ amount: 10000, rate: 5, mode: 'weekly-compound', tenure_value: 2, tenure_unit: 'weeks' });
  check('Manual: weekly compound 10,000 at 5%/wk x 2 weeks -> 11,025', m2.total === 11025 && m2.markup === 1025, m2);
  const m3 = man({ amount: 10000, rate: 5, mode: 'monthly-simple', tenure_value: 2, tenure_unit: 'months' });
  check('Manual: monthly simple 10,000 at 5%/mo x 2 months -> 11,000', m3.total === 11000 && m3.markup === 1000, m3);
  const m4 = man({ amount: 10000, rate: 20, mode: 'flat-term', tenure_value: 30, tenure_unit: 'days' });
  check('Manual: flat term 10,000 at 20% x 30 days -> 12,000', m4.total === 12000 && m4.markup === 2000, m4);
  const m5 = man({ amount: 100000, rate: 12, mode: 'annual-emi', tenure_value: 12, tenure_unit: 'months' });
  check('Manual: annual EMI 100,000 at 12% x 12 months -> 106,619, instalment 8,885', m5.total === 106619 && m5.instalment === 8885, m5);
  const m6 = man({ amount: 100000, rate: 8, mode: 'price-markup', tenure_value: 3, tenure_unit: 'months', down_pct: 30, instalments: 3 });
  check('Manual: price markup 100,000, 30% down, 8%, 3 instalments -> 105,600 / 25,200', m6.total === 105600 && m6.instalment === 25200 && m6.down_payment === 30000, m6);
  const m7 = man({ amount: 10000, fee_rs: 150, mode: 'flat-fee', tenure_value: 30, tenure_unit: 'days' });
  check('Manual: flat fee 10,000 + Rs 150 -> 10,150', m7.total === 10150 && m7.markup === 150, m7);
  const m8 = man({ amount: 20000, rate: 30, mode: 'flat-term', tenure_value: 90, tenure_unit: 'days', instalments: 3, late_kind: 'per-instalment-pct', late_value: 5, grace_days: 0 });
  check('Manual: per-instalment late fee, 2 overdue at day 90 -> late 867', m8.total === 26867 && m8.late_fee === 867 && m8.instalment === 8667, m8);
  const m9 = M.manualInput({ borrow_date: B, amount: 1000, tenure_value: 2, tenure_unit: 'weeks' });
  check('Manual: tenure 2 weeks -> 14 days, repay 2026-11-20', m9.custom.term_days === 14 && m9.repay_date === '2026-11-20', m9);
  const m10 = M.manualInput({ borrow_date: B, amount: 1000, tenure_value: 3, tenure_unit: 'months' });
  check('Manual: tenure 3 months -> 3 months, repay 2027-02-04', m10.custom.term_months === 3 && m10.repay_date === '2027-02-04', m10);
  const m11 = man({ amount: 50000, rate: 25, mode: 'annual-emi', tenure_value: 12, tenure_unit: 'months', late_kind: 'one-off-pct', late_value: 5, grace_days: 0 });
  check('Manual: EMI loan computes with a late fee set', m11.total > 50000 && m11.instalment != null, m11);

  // ---- 18. Glass design contrast (WCAG AA, 4.5:1 for normal text) ----
  // Glass surfaces are translucent, so the effective background is the rgba
  // blended over what sits beneath it (page #0b1220, or the card glass).
  function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function blend(rgba, base) { const a = rgba[3]; return rgba.slice(0, 3).map((v, i) => Math.round(v * a + base[i] * (1 - a))); }
  function lum(rgb) { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); }
  function ratio(fg, bg) { const l1 = lum(fg), l2 = lum(bg); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
  const PAGE = hexRgb('#0b1220');
  const CARD = blend([17, 28, 51, 0.62], PAGE);
  const PANEL = blend([15, 23, 42, 0.60], PAGE);
  const GHOST = blend([30, 41, 59, 0.55], PAGE);
  const HEADER = blend([15, 23, 42, 0.65], PAGE);
  const WARN = blend([127, 29, 29, 0.45], CARD);
  const OKB = blend([20, 83, 45, 0.40], CARD);
  const BLUEB = blend([30, 58, 138, 0.55], CARD);
  const AMBERB = blend([120, 53, 15, 0.45], CARD);
  const pairs = [
    ['body text on page', '#e6edf7', PAGE],
    ['body text on card', '#e6edf7', CARD],
    ['muted text on page', '#94a3b8', PAGE],
    ['muted text on card', '#94a3b8', CARD],
    ['blue accent on card', '#60a5fa', CARD],
    ['white on solid primary button', '#ffffff', hexRgb('#2563eb')],
    ['body text on ghost button', '#e6edf7', GHOST],
    ['accent text on ghost chip', '#60a5fa', GHOST],
    ['white on pressed chip', '#ffffff', hexRgb('#2563eb')],
    ['input text on glass input', '#e6edf7', PANEL],
    ['white logo on glass header', '#ffffff', HEADER],
    ['danger text on warn box', '#fca5a5', WARN],
    ['ok text on ok box', '#86efac', OKB],
    ['verified badge text', '#bfdbfe', BLUEB],
    ['rate-on-request badge text', '#fde68a', AMBERB],
    ['unverified badge text', '#fca5a5', WARN],
  ];
  for (const [name, fg, bg] of pairs) {
    const r = ratio(hexRgb(fg), bg);
    check('Contrast AA: ' + name + ' (' + r.toFixed(2) + ':1)', r >= 4.5, Number(r.toFixed(2)));
  }
  const css = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
  check('Glass CSS: card uses translucent rgba(17,28,51,.62) + blur 14px', /rgba\(17, 28, 51, 0\.62\)/.test(css) && /backdrop-filter: blur\(14px\)/.test(css), null);
  check('Glass CSS: header uses rgba(15,23,42,.65) + blur 16px', /rgba\(15, 23, 42, 0\.65\)/.test(css) && /blur\(16px\)/.test(css), null);
  check('Glass CSS: diagonal sheen gradient present', /linear-gradient\(135deg, rgba\(255, 255, 255, 0\.09\)/.test(css), null);
  check('Glass CSS: inset top highlight present', /inset 0 1px 0 rgba\(255, 255, 255, 0\.12\)/.test(css), null);
  check('Glass CSS: primary button is solid blue #2563eb', /--primary: #2563eb/.test(css) && /background: var\(--primary\)/.test(css), null);
  check('Glass CSS: no teal/gold theme left', !/#0c3b3c/.test(css) && !/#d9a441/.test(css) && !/--teal/.test(css) && !/--gold/.test(css), null);

  // ---- 19. Final review fixes (6 Nov 2026) ----
  // HBL flat Rs 1,500 + FED late fee: charged once past the term, and the
  // notes say the FED is extra (not in the total).
  const hblLateFee = M.compute(byId['hbl-personal'], { principal: 100000, cycles: 1, borrow_date: '2026-01-01', repay_date: '2029-01-01', term_months: 36 });
  check('HBL late fee: Rs 1,500 flat once past the 36-month term', hblLateFee.late_fee === 1500, hblLateFee);
  check('HBL notes: FED is extra and not in the total', hblLateFee.notes.some((n) => n.includes('FED')), hblLateFee.notes);
  // Amount-range warnings (warn, never block).
  check('Range warning: Easycash above Rs 25,000 max warns', M.amountRangeWarning(byId['easycash-app'], {}, 30000).includes('25,000'), M.amountRangeWarning(byId['easycash-app'], {}, 30000));
  check('Range warning: HBL below Rs 25,000 min warns', M.amountRangeWarning(byId['hbl-personal'], {}, 10000).includes('25,000'), M.amountRangeWarning(byId['hbl-personal'], {}, 10000));
  check('Range warning: PM Youth Tier 2 above Rs 1,500,000 warns', M.amountRangeWarning(byId['pm-youth'], { rate_option: 1 }, 2000000).includes('1,500,000'), M.amountRangeWarning(byId['pm-youth'], { rate_option: 1 }, 2000000));
  check('Range warning: in-range amount returns empty', M.amountRangeWarning(byId['hbl-personal'], {}, 100000) === '', M.amountRangeWarning(byId['hbl-personal'], {}, 100000));
  // New card instalments from the research report's card table.
  check('SCB Asaan: up to 46% APR, editable, verified', byId['scb-asaan'] && byId['scb-asaan'].annual_rate_pct === 46 && byId['scb-asaan'].rate_editable === true && byId['scb-asaan'].verified === true, byId['scb-asaan']);
  check('SCB Asaan: EMI maths at 46% works', M.compute(byId['scb-asaan'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(360), term_months: 12 }).total > 100000, null);
  const rorZero = M.compute(byId['ubl-cashplus'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(360), kfs: { fee_kind: 'flat-term', rate_pct: 0, term_days: 365 } });
  check('Rate on request: KFS rate 0 (not entered) is not calculable — never a free loan', !!rorZero.error && rorZero.not_calculable === true, rorZero);
  const rorAllied = M.compute(byId['allied-easy'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(360) });
  check('Rate on request: Allied Easy is not calculable', !!rorAllied.error && rorAllied.not_calculable === true, rorAllied);
  const rorNoor = M.compute(byId['faysal-noor'], { principal: 100000, cycles: 1, borrow_date: B, repay_date: D(360) });
  check('Rate on request: Faysal Noor is not calculable', !!rorNoor.error && rorNoor.not_calculable === true, rorNoor);
  check('Faysal Noor: no late fee, no early fee', byId['faysal-noor'].late_fee.kind === 'none' && byId['faysal-noor'].early === 'None.', byId['faysal-noor']);
  check('QistBazaar notes: Pakera phone-check discrepancy stated', byId['qistbazaar'].notes.includes('78,100') && byId['qistbazaar'].notes.includes('75,600'), byId['qistbazaar'].notes);
  // SECP whitelist edition is 29 Sep 2026 everywhere; no stale 11 Sep text.
  const pubFiles = ['index.html', 'calculator.html', 'how.html', 'sources.html', 'calcpage.js', 'picker.js', 'manual.js', 'nav.js', 'calc.js'];
  const pubText = pubFiles.map((f) => fs.readFileSync(path.join(__dirname, 'public', f), 'utf8')).join('\n');
  const presetsText = fs.readFileSync(path.join(__dirname, 'presets.json'), 'utf8');
  // "11 Sep 2026" survives only inside the two comparison sentences that
  // say the 29 Sep edition was checked against it — never as the current
  // whitelist date.
  const stripped = (pubText + presetsText).replace(/Checked against\s*\n?\s*the 11 Sep 2026 edition/g, '').replace(/Compared with the 11 Sep 2026 edition/g, '');
  check('SECP whitelist: no stale "11 Sep 2026" as the current date', !/11 Sep 2026/.test(stripped), null);
  check('SECP whitelist: 29 Sep 2026 on home, how, sources + calcpage', /29 Sep 2026/.test(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')) && /29 Sep 2026/.test(fs.readFileSync(path.join(__dirname, 'public', 'how.html'), 'utf8')) && /29 Sep 2026/.test(fs.readFileSync(path.join(__dirname, 'public', 'sources.html'), 'utf8')) && /29 Sep 2026/.test(fs.readFileSync(path.join(__dirname, 'public', 'calcpage.js'), 'utf8')), null);
  check('JazzCash BNPL: stale unverified note gone from how.html', !/not independently re-verified against a live source/.test(fs.readFileSync(path.join(__dirname, 'public', 'how.html'), 'utf8')) && /Yeylo/.test(fs.readFileSync(path.join(__dirname, 'public', 'how.html'), 'utf8')), null);
  // Error + warning elements exist on the pages.
  check('Manual page: error line element exists', /id="mError"/.test(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')), null);
  check('Calculator page: range warning element exists', /id="rangeWarn"/.test(fs.readFileSync(path.join(__dirname, 'public', 'calculator.html'), 'utf8')), null);
  // Favicon file + link on every page.
  check('Favicon file exists', fs.existsSync(path.join(__dirname, 'public', 'favicon.ico')), null);
  for (const f of ['index.html', 'calculator.html', 'how.html', 'sources.html']) {
    check('Favicon link on ' + f, /rel="icon" href="\/favicon\.ico"/.test(fs.readFileSync(path.join(__dirname, 'public', f), 'utf8')), null);
  }
  // Deploy docs.
  check('DEPLOY.md exists with SnapDeploy steps', fs.existsSync(path.join(__dirname, 'DEPLOY.md')) && /SnapDeploy/.test(fs.readFileSync(path.join(__dirname, 'DEPLOY.md'), 'utf8')) && /node server\.js/.test(fs.readFileSync(path.join(__dirname, 'DEPLOY.md'), 'utf8')) && /3035/.test(fs.readFileSync(path.join(__dirname, 'DEPLOY.md'), 'utf8')), null);
  check('README: deploy-ready + PORT env documented', /Deploy-ready/.test(fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8')) && /PORT/.test(fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8')), null);

  // ---- 20. Review fixes (7 Nov 2026) ----
  // JazzCash BNPL: instalments fall at purchase / +30 / +60 days, so the
  // loan is due at 60 days, not 90 (Yeylo page + merchant terms).
  check('JazzCash BNPL: due 60 days (last instalment +60), not 90', M.dueInfo(byId['jazzcash-bnpl'], { principal: 10000, term_option: 0 }).due_days === 60, M.dueInfo(byId['jazzcash-bnpl'], { principal: 10000, term_option: 0 }));
  const jbnDue = M.compute(byId['jazzcash-bnpl'], { principal: 10000, cycles: 1, borrow_date: B, repay_date: D(60) });
  check('JazzCash BNPL: due date is borrow + 60 days', jbnDue.due_date === D(60), jbnDue.due_date);
  // Instalment plans: repaying everything on the final day already counts
  // earlier instalments as overdue — the result must say what on-time costs.
  check('Daraz day 90: note gives the on-time total Rs 26,000', dz90.notes.some((n) => n.includes('26,000') && n.includes('on time')), dz90.notes);
  check('Daraz day 30: no on-time note needed (no late fee)', !dz3.notes.some((n) => n.includes('Pay each instalment')), dz3.notes);
  const jbn90 = M.compute(byId['jazzcash-bnpl'], { principal: 10000, cycles: 1, borrow_date: B, repay_date: D(90) });
  check('JazzCash BNPL day 90: note gives the on-time total Rs 11,500', jbn90.notes.some((n) => n.includes('11,500') && n.includes('on time')), jbn90.notes);
  // Negative user-typed numbers are clamped, never a loan that pays you.
  const cuNeg = M.compute(byId.custom, {
    principal: 10000, cycles: 1, borrow_date: B, repay_date: D(14),
    custom: { fee_kind: 'weekly-simple', rate_pct: -5, term_days: 14, late_kind: 'none', grace_days: 0, cap_kind: 'none' },
  });
  check('Custom negative rate: clamped to 0, total = loan', cuNeg.total === 10000 && cuNeg.markup === 0, cuNeg);
  const cuNegLate = M.compute(byId.custom, {
    principal: 10000, cycles: 1, borrow_date: B, repay_date: D(33),
    custom: { fee_kind: 'flat-term', rate_pct: 0, term_days: 30, late_kind: 'one-off-pct', late_pct: -5, grace_days: 0, cap_kind: 'none' },
  });
  check('Custom negative late fee: clamped to 0, total = loan', cuNegLate.total === 10000 && cuNegLate.late_fee === 0, cuNegLate);
  // KFS per-instalment late fee now counts the instalments the user enters
  // (before, it always counted 1 — the KFS form had no instalments field).
  const kfsInst = M.compute(byId['ubl-cashplus'], { principal: 20000, cycles: 1, borrow_date: B, repay_date: D(90), kfs: { fee_kind: 'flat-term', rate_pct: 30, term_days: 90, instalments: 3, late_kind: 'per-instalment-pct', late_pct: 5, grace_days: 0, cap_kind: 'none' } });
  check('KFS per-instalment late fee, 3 instalments at day 90 -> late 867', kfsInst.late_fee === 867 && kfsInst.total === 26867, kfsInst);
  // Manual page escapes the user-typed early-repayment note (no raw HTML).
  const manualJs = fs.readFileSync(path.join(__dirname, 'public', 'manual.js'), 'utf8');
  check('Manual: early note is escaped before rendering', /function esc\(/.test(manualJs) && /esc\(n\)/.test(manualJs), null);
  // Weekly-simple policy text uses the preset's own rate, not a hard-coded 5%.
  check('Calcpage: weekly-simple text uses preset rate', /weekly_rate_pct/.test(fs.readFileSync(path.join(__dirname, 'public', 'calcpage.js'), 'utf8')), null);

  // ---- 21. Server smoke (fresh DB) ----
  try { fs.unlinkSync(DB); } catch {}
  try { fs.unlinkSync(DB + '-wal'); } catch {}
  try { fs.unlinkSync(DB + '-shm'); } catch {}
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: DB }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    await waitUp(40);
    const h = await req('GET', '/health');
    check('GET /health -> {ok:true}', h.status === 200 && h.json && h.json.ok === true, h);
    const home = await req('GET', '/');
    check('GET / -> 200, picker + manual calculator present', home.status === 200 && /Loan Payback Calculator/.test(home.raw) && /id="picker"/.test(home.raw) && /id="manualSection"/.test(home.raw) && /Calculate any loan yourself/.test(home.raw) && /calc\.js/.test(home.raw), home.status);
    check('GET / -> nano apps section present', /Licensed nano loan apps/.test(home.raw) && /id="nanoApps"/.test(home.raw) && /id="benchmarks"/.test(home.raw), home.status);
    const how = await req('GET', '/how.html');
    check('GET /how.html -> 200, formulas present', how.status === 200 && /How it works/.test(how.raw) && /12,155/.test(how.raw), how.status);
    const src = await req('GET', '/sources.html');
    check('GET /sources.html -> 200, sources listed', src.status === 200 && /Sources/.test(src.raw) && /jazzcash\.com\.pk/.test(src.raw), src.status);
    check('GET /sources.html -> could-not-verify section present', /What we could not verify/.test(src.raw) && /NBP Advance Salary/.test(src.raw), src.status);
    const ap = await req('GET', '/api/presets');
    check('GET /api/presets -> 51 presets, each with source + rate', ap.status === 200 && Array.isArray(ap.json.presets) && ap.json.presets.length === 51 && ap.json.presets.every((p) => p.source && p.rate_line), ap.json && ap.json.presets && ap.json.presets.length);
    check('GET /api/presets -> 19 rate-on-request presets', ap.json.presets.filter((p) => p.model === 'rate-on-request').length === 19, ap.json.presets.filter((p) => p.model === 'rate-on-request').length);
    check('GET /api/presets -> 17 nano apps + guardrails + benchmarks', Array.isArray(ap.json.nano_apps) && ap.json.nano_apps.length === 17 && ap.json.nano_guardrails && ap.json.nano_guardrails.max_per_app_rs === 25000 && ap.json.benchmarks && ap.json.benchmarks.sbp_policy_rate_pct === 12 && ap.json.benchmarks.kibor_1y_pct === 12.8, ap.json && ap.json.nano_apps && ap.json.nano_apps.length);
    const calcJs = await req('GET', '/calc.js');
    check('GET /calc.js -> 200', calcJs.status === 200 && /compute/.test(calcJs.raw), calcJs.status);
    const navJs = await req('GET', '/nav.js');
    check('GET /nav.js -> 200', navJs.status === 200, navJs.status);
    const pickerJs = await req('GET', '/picker.js');
    check('GET /picker.js -> 200', pickerJs.status === 200 && /loan-card/.test(pickerJs.raw), pickerJs.status);
    const manualJs = await req('GET', '/manual.js');
    check('GET /manual.js -> 200', manualJs.status === 200 && /manualInput/.test(manualJs.raw), manualJs.status);
    const calcPageJs = await req('GET', '/calcpage.js');
    check('GET /calcpage.js -> 200', calcPageJs.status === 200 && /renderPolicy/.test(calcPageJs.raw) && /Key Fact Statement/.test(calcPageJs.raw), calcPageJs.status);
    const calcPage = await req('GET', '/calculator.html?preset=easycash-app');
    check('GET /calculator.html -> 200, policy card + form present', calcPage.status === 200 && /id="policyCard"/.test(calcPage.raw) && /id="calcForm"/.test(calcPage.raw) && /id="results"/.test(calcPage.raw), calcPage.status);
    const cssServed = await req('GET', '/styles.css');
    check('GET /styles.css -> 200, glass tokens served', cssServed.status === 200 && /rgba\(17, 28, 51, 0\.62\)/.test(cssServed.raw) && /#2563eb/.test(cssServed.raw) && /backdrop-filter: blur\(14px\)/.test(cssServed.raw), cssServed.status);
    const fav = await req('GET', '/favicon.ico');
    check('GET /favicon.ico -> 200, icon', fav.status === 200, fav.status);
    const howFav = await req('GET', '/how.html');
    check('GET /how.html -> favicon link present', /rel="icon" href="\/favicon\.ico"/.test(howFav.raw), howFav.status);
    const db404 = await req('GET', '/data/loan.sqlite');
    check('DB file is NOT served (404)', db404.status === 404, db404.status);
    const nf = await req('GET', '/nope.html');
    check('Unknown page -> 404', nf.status === 404, nf.status);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    try { fs.unlinkSync(DB); } catch {}
    try { fs.unlinkSync(DB + '-wal'); } catch {}
    try { fs.unlinkSync(DB + '-shm'); } catch {}
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) { console.log('TESTS FAILED'); process.exit(1); }
  console.log('ALL TESTS PASSED');
}
main().catch((e) => { console.error('TEST RUN CRASHED:', e); process.exit(1); });
