// Loan Payback Calculator — shared maths (browser + Node tests).
// Pure functions, no DOM, no Node-only APIs. All money is rounded to whole
// rupees. Models are documented in ~/workspace/new-projects/p6-loan-calculator-research.md
// and on the How it works page. Nothing here lends money or stores data.
//
// Models:
//  weekly-compound — Easypaisa Easycash app: % of the outstanding loan each week, compounded.
//  weekly-simple   — JazzCash ReadyCash/ReadyLoad: % of the original loan each week, simple.
//  flat-term       — one flat % for the whole term (USSD, BNPL, Daraz, Yeylo).
//  annual-reducing — bank / MFB personal loans and card instalments: fixed monthly
//                    instalment (EMI) on a reducing balance.
//  kibor-spread    — same EMI maths, rate = 1-year KIBOR + spread (KIBOR is an input).
//  annual-flat     — Islamic Musawamah: fixed sale price, profit = rate x years, no compounding.
//  price-markup    — BNPL price markup: down payment, then the financed amount plus a
//                    fixed markup, in instalments.
//  flat-fee        — earned-wage access: one flat Rs fee per drawdown, repaid next payday.
//  rate-on-request — the lender publishes no rate: not calculable, by design.
//  custom          — the user's own numbers.
//
// For the fee models the borrower is assumed to pay everything on the planned
// repayment date. For the EMI models the borrower is assumed to pay every
// monthly instalment on its due date; the planned repayment date is the day
// they settle the loan (early settlement = the remaining balance, before any
// early-settlement fee the bank charges separately).
'use strict';

function roundRs(x) { return Math.round(x); }

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
function fmtDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
function daysBetween(aMs, bMs) { return Math.round((bMs - aMs) / 86400000); }
function addDays(ms, n) { return ms + n * 86400000; }

// Pick the tier rate (%) for a loan-cycle count, e.g. [{upto:30,rate:5},{upto:60,rate:4.5},{upto:null,rate:4}]
function tierRate(tiers, cycles) {
  const c = Math.max(1, Math.floor(Number(cycles) || 1));
  for (const t of tiers || []) {
    if (t.upto == null || c <= t.upto) return t.rate;
  }
  return (tiers && tiers.length) ? tiers[tiers.length - 1].rate : 0;
}

// The selected option of a rate_options / spread_options list.
function rateOption(preset, input) {
  const opts = preset.rate_options || preset.spread_options || null;
  if (!opts || !opts.length) return null;
  const i = Math.max(0, Math.min(opts.length - 1, Math.floor(Number(input.rate_option) || 0)));
  return opts[i];
}

// Spread (%) for a kibor-spread preset: from the selected option, an editable
// field, or the preset's own value.
function spreadFor(preset, input) {
  const opt = rateOption(preset, input);
  if (opt && opt.spread != null) return Number(opt.spread);
  if (preset.spread_editable && input.spread_pct != null) return Number(input.spread_pct) || 0;
  return Number(preset.spread_pct) || 0;
}

// Effective annual rate (%) for the EMI-like models.
function effectiveAnnualRate(preset, input) {
  if (preset.model === 'kibor-spread') {
    const kibor = input.kibor_rate != null ? Number(input.kibor_rate) : Number(preset.kibor_default || 12.8);
    return kibor + spreadFor(preset, input);
  }
  if (preset.model === 'annual-reducing' || preset.model === 'annual-flat') {
    const opt = rateOption(preset, input);
    if (opt && opt.rate != null) return Number(opt.rate);
    if (preset.rate_editable && input.annual_rate_pct != null) return Number(input.annual_rate_pct);
    return Number(preset.annual_rate_pct) || 0;
  }
  return null;
}

// Loan term in months for the EMI-like models. A rate option may fix it
// (PM Youth tiers); otherwise the term-months input, else the preset default.
function termMonths(preset, input) {
  const opt = rateOption(preset, input);
  if (opt && opt.months != null) return Math.max(1, Math.floor(opt.months));
  if (input.term_months != null) return Math.max(1, Math.floor(Number(input.term_months) || 1));
  if (preset.term_months_default != null) return preset.term_months_default;
  if (preset.term_months_options && preset.term_months_options.length) return preset.term_months_options[0];
  return 12;
}

// Fixed monthly instalment (EMI) on a reducing balance. Rate 0 => P / n.
function emiMonthly(P, annualRatePct, months) {
  const r = (annualRatePct || 0) / 100 / 12;
  if (months <= 0) return P;
  if (r === 0) return P / months;
  const f = Math.pow(1 + r, months);
  return P * r * f / (f - 1);
}

// Remaining balance after k monthly instalments (reducing balance).
function emiBalance(P, annualRatePct, months, k) {
  const r = (annualRatePct || 0) / 100 / 12;
  const inst = emiMonthly(P, annualRatePct, months);
  let bal = P;
  for (let i = 0; i < Math.min(k, months); i++) {
    bal -= (inst - bal * r);
  }
  return Math.max(0, bal);
}

// Price-markup maths (BNPL): down payment first, then the financed amount
// plus a fixed profit, in equal instalments.
function priceMarkupParts(P, downPct, markupPct, instalments) {
  const down = (P * (downPct || 0)) / 100;
  const financed = P - down;
  const markupTotal = (financed * (markupPct || 0)) / 100;
  const n = Math.max(1, Math.floor(instalments || 1));
  const inst = (financed + markupTotal) / n;
  return { down, financed, markupTotal, instalments: n, inst };
}

// Price-markup parts for a preset (either the price-markup model or a Custom
// loan with fee_kind 'price-markup'); null for other models.
function markupPartsFor(preset, input, P) {
  if (preset.model === 'price-markup') {
    const opt = (preset.term_options || [])[input.term_option || 0] || (preset.term_options || [])[0] || {};
    return priceMarkupParts(P, preset.down_pct || 0, opt.markup_pct || 0, opt.instalments || 1);
  }
  if (preset.model === 'custom' && preset.fee_kind === 'price-markup') {
    return priceMarkupParts(P, preset.down_pct || 0, preset.rate_pct || 0, preset.instalments || 1);
  }
  return null;
}

// SECP nano-loan guardrails (Circular 15 of 2022 + Circular 10 of 2023, as
// reported by Which.pk, updated 19 Oct 2026). Whether they survived the Nov
// 2025 amendments (SRO 2120(I)/2025) is UNCONFIRMED — these are the published
// guardrails, not a guarantee. Caps: Rs 25,000 per app, Rs 75,000 across all
// apps, tenure at most 90 days, total cost at most the loan itself, APR at
// most 10x the SBP policy rate (= 120% a year at the current 12%).
function nanoCheck(o) {
  const violations = [];
  if (o.amount > 25000) violations.push('Over the Rs 25,000 per-app limit');
  if (o.totalBorrowed != null && o.totalBorrowed > 75000) violations.push('Over the Rs 75,000 total-across-apps limit');
  if (o.days > 90) violations.push('Over the 90-day maximum tenure');
  if (o.totalCost != null && o.totalCost > o.amount) violations.push('Total cost is more than the loan itself');
  if (o.apr != null && o.apr > 120) violations.push('APR over 120% (10x the 12% SBP policy rate)');
  return { ok: violations.length === 0, violations };
}

// Resolve the effective preset: 'custom' presets take their numbers from input.custom.
function resolvePreset(preset, input) {
  if (preset.id !== 'custom') return preset;
  const c = input.custom || {};
  // Clamp user-typed numbers: a negative rate, fee or cap would make the
  // loan look cheaper than the amount borrowed (or pay the borrower).
  const nonNeg = (v) => Math.max(0, Number(v) || 0);
  const rate = nonNeg(c.rate_pct);
  const termDays = Math.max(1, Math.floor(Number(c.term_days) || 30));
  const termMonths = Math.max(1, Math.floor(Number(c.term_months) || 12));
  const feeKind = c.fee_kind || 'flat-term';
  const p = {
    id: 'custom', name: 'Custom loan', name_ur: 'اپنی مرضی کا قرض',
    lender: 'Your own numbers', model: 'custom',
    fee_kind: feeKind, rate_pct: rate, term_days: termDays,
    term_months: termMonths,
    instalments: Math.max(1, Math.floor(Number(c.instalments) || 1)),
    down_pct: Math.min(100, nonNeg(c.down_pct)),
    fee_rs: nonNeg(c.fee_rs),
    due_days: feeKind === 'annual-emi' || feeKind === 'price-markup' ? termMonths * 30 : termDays,
    late_fee: {
      kind: c.late_kind || 'none',
      pct: nonNeg(c.late_pct),
      flat_rs: nonNeg(c.late_flat_rs),
      cap_rs: nonNeg(c.late_cap_rs),
      grace_days: Math.max(0, Math.floor(Number(c.grace_days) || 0)),
    },
    cap: {
      kind: c.cap_kind || 'none',
      pct: nonNeg(c.cap_pct),
      rs: nonNeg(c.cap_rs),
    },
    source: 'Your own numbers', source_url: '', as_of: '', verified: false,
    notes: 'Custom loan — the numbers are whatever you typed.',
  };
  return p;
}

function capAmount(preset, principal) {
  const cap = preset.cap;
  if (!cap) return null;
  if (cap.kind === 'pct' && cap.pct > 0) return (principal * cap.pct) / 100;
  if (cap.kind === 'rs' && cap.rs > 0) return cap.rs;
  return null;
}

// Late fee for the EMI-like models on day `d` (days since the borrow date).
// Monthly instalments are assumed paid on time, so a late fee only arises
// once the final instalment is past its due date (day 30 x months).
function emiLateFee(preset, input, d, instalment) {
  const n = termMonths(preset, input);
  const lf = preset.late_fee || { kind: 'none' };
  const grace = lf.grace_days || 0;
  if (d <= 30 * n + grace) return 0;
  if (lf.kind === 'flat-rs-per-instalment') return lf.flat_rs || 0;
  if (lf.kind === 'pct_instalment') return (instalment * (lf.pct || 0)) / 100;
  // 'charity' (goes to charity, not the bank) and 'unverified' (in the
  // schedule of charges, not published) are not added to the total here.
  return 0;
}

// Amount owed on day `d` (days since the borrow date). Returns
// { markup, late_fee, total, owed } in whole rupees (unrounded parts kept exact
// inside, rounded only at the end so the timeline adds up).
//   total = what you pay if you settle the loan on day d.
//   owed  = what is still unpaid on day d (for the fee models this is the total;
//           for the EMI models it is the remaining balance, which falls to 0).
//   markup = the fee / interest charged so far.
function owedOnDay(preset, input, d) {
  const P = input.principal;
  const days = Math.max(0, Math.floor(d));
  let markup = 0;
  let late = 0;
  let total = P;
  let owed = P;

  if (preset.model === 'weekly-compound') {
    const r = tierRate(preset.weekly_rates, input.cycles) / 100;
    const cap = preset.cap_pct != null ? (P * preset.cap_pct) / 100 : null;
    const maxWeeks = preset.cap_weeks != null ? preset.cap_weeks : 8;
    let outstanding = P;
    const fullWeeks = Math.min(Math.floor(days / 7), maxWeeks);
    for (let w = 0; w < fullWeeks; w++) {
      const wk = outstanding * r;
      markup += wk;
      outstanding += wk;
      if (cap != null && markup >= cap) { markup = cap; outstanding = P + cap; break; }
    }
    const rem = days % 7;
    if (rem > 0 && fullWeeks < maxWeeks && (cap == null || markup < cap)) {
      markup += outstanding * r * (rem / 7);
      if (cap != null && markup > cap) markup = cap;
    }
    total = P + markup;
    owed = total;
  } else if (preset.model === 'weekly-simple') {
    const r = (preset.weekly_rate_pct || 0) / 100;
    const maxWeeks = preset.max_weeks != null ? preset.max_weeks : 8;
    const weeks = Math.min(days / 7, maxWeeks);
    markup = P * r * weeks;
    const cap = preset.cap_pct != null ? (P * preset.cap_pct) / 100 : null;
    if (cap != null && markup > cap) markup = cap;
    total = P + markup;
    owed = total;
  } else if (preset.model === 'flat-term') {
    const opt = (preset.term_options || [])[input.term_option || 0] || (preset.term_options || [])[0] || {};
    // Some flat-term presets price by loan cycle (USSD) instead of by term choice.
    const feePct = preset.fee_tiers
      ? tierRate(preset.fee_tiers.map((t) => ({ upto: t.upto, rate: t.fee })), input.cycles)
      : (opt.fee_pct != null ? opt.fee_pct : (preset.fee_pct || 0));
    markup = (P * feePct) / 100;
    const due = opt.days != null ? opt.days : (preset.due_days || 30);
    const lf = preset.late_fee || { kind: 'none' };
    const grace = lf.grace_days || 0;
    if (preset.id === 'daraz-paylater') {
      // Late fee per OVERDUE instalment: min(5% of the instalment, Rs 800).
      const tot = P + markup;
      const n = opt.instalments || 1;
      const inst = tot / n;
      let overdue = 0;
      for (let k = 1; k <= n; k++) {
        if (days > 30 * k + grace) overdue++;
      }
      late = overdue * Math.min((inst * (lf.pct || 0)) / 100, lf.cap_rs || Infinity);
    } else if (preset.id === 'jazzcash-bnpl') {
      const tot = P + markup;
      const n = opt.instalments || 3;
      const inst = tot / n;
      let overdue = 0;
      for (let k = 1; k <= n; k++) {
        if (days > 30 * k + grace) overdue++;
      }
      late = overdue * (inst * (lf.pct || 0)) / 100;
    } else if (lf.kind === 'one-off-pct') {
      if (days > due + grace) late = (P * (lf.pct || 0)) / 100;
    }
    total = P + markup + late;
    owed = total;
  } else if (preset.model === 'annual-reducing' || preset.model === 'kibor-spread') {
    const rate = effectiveAnnualRate(preset, input);
    const n = termMonths(preset, input);
    const inst = emiMonthly(P, rate, n);
    const fullTotal = inst * n;
    const k = Math.min(Math.floor(days / 30), n);
    const bal = emiBalance(P, rate, n, k);
    if (days <= 30 * n) {
      // Settle on day d: the instalments paid so far + the remaining balance.
      total = k * inst + bal;
      markup = total - P;
      late = 0;
      owed = bal;
    } else {
      total = fullTotal + emiLateFee(preset, input, days, inst);
      markup = fullTotal - P;
      late = emiLateFee(preset, input, days, inst);
      owed = late;
    }
  } else if (preset.model === 'annual-flat') {
    // Musawamah: fixed sale price, profit = rate x years, split evenly.
    const rate = effectiveAnnualRate(preset, input);
    const n = termMonths(preset, input);
    const markupTotal = P * (rate / 100) * (n / 12);
    const inst = (P + markupTotal) / n;
    const k = Math.min(Math.floor(days / 30), n);
    const bal = (P + markupTotal) - k * inst;
    if (days <= 30 * n) {
      total = k * inst + bal;
      markup = (k * markupTotal) / n;
      late = 0;
      owed = bal;
    } else {
      total = P + markupTotal + emiLateFee(preset, input, days, inst);
      markup = markupTotal;
      late = emiLateFee(preset, input, days, inst);
      owed = late;
    }
  } else if (preset.model === 'price-markup') {
    const parts = markupPartsFor(preset, input, P);
    const n = parts.instalments;
    const k = Math.min(Math.floor(days / 30), n);
    const bal = (parts.financed + parts.markupTotal) - k * parts.inst;
    // Total cash out is the same whenever you settle: down + financed + profit.
    total = parts.down + parts.financed + parts.markupTotal;
    markup = (k * parts.markupTotal) / n;
    late = 0;
    owed = bal;
  } else if (preset.model === 'flat-fee') {
    // Earned-wage access: one flat fee per drawdown, repaid next payday.
    markup = preset.fee_rs || 0;
    total = P + markup;
    owed = total;
  } else if (preset.model === 'custom') {
    const due = preset.due_days;
    const grace = (preset.late_fee && preset.late_fee.grace_days) || 0;
    const cap = capAmount(preset, P);
    if (preset.fee_kind === 'flat-term') {
      markup = (P * (preset.rate_pct || 0)) / 100;
    } else if (preset.fee_kind === 'weekly-simple') {
      markup = P * ((preset.rate_pct || 0) / 100) * (days / 7);
    } else if (preset.fee_kind === 'monthly-simple') {
      markup = P * ((preset.rate_pct || 0) / 100) * (days / 30);
    } else if (preset.fee_kind === 'weekly-compound') {
      const r = (preset.rate_pct || 0) / 100;
      let outstanding = P;
      const fullWeeks = Math.floor(days / 7);
      for (let w = 0; w < fullWeeks; w++) {
        const wk = outstanding * r;
        markup += wk;
        outstanding += wk;
      }
      const rem = days % 7;
      if (rem > 0) markup += outstanding * r * (rem / 7);
    } else if (preset.fee_kind === 'annual-emi') {
      // Annual rate, EMI over term_months (used by the Key Fact Statement flow).
      const rate = preset.rate_pct || 0;
      const n = preset.term_months || 12;
      const inst = emiMonthly(P, rate, n);
      const k = Math.min(Math.floor(days / 30), n);
      const bal = emiBalance(P, rate, n, k);
      if (days <= 30 * n) {
        markup = (k * inst + bal) - P;
        total = k * inst + bal;
        owed = bal;
      } else {
        markup = inst * n - P;
        total = inst * n;
        owed = 0;
      }
    } else if (preset.fee_kind === 'price-markup') {
      // BNPL-style: down payment, then the financed amount plus a fixed profit.
      const parts = markupPartsFor(preset, input, P);
      const n = parts.instalments;
      const k = Math.min(Math.floor(days / 30), n);
      const bal = (parts.financed + parts.markupTotal) - k * parts.inst;
      total = parts.down + parts.financed + parts.markupTotal;
      markup = (k * parts.markupTotal) / n;
      owed = bal;
    } else if (preset.fee_kind === 'flat-fee') {
      // Earned-wage access: one flat Rs fee per drawdown.
      markup = preset.fee_rs || 0;
      total = P + markup;
      owed = total;
    }
    if (cap != null && markup > cap) markup = cap;
    const lf = preset.late_fee || { kind: 'none' };
    const pastDue = days - (due + grace);
    if (lf.kind === 'per-instalment-pct') {
      // Late fee per OVERDUE instalment — instalments fall due during the
      // term (every 30 days), so this is checked even before the term ends.
      // For an EMI loan the instalment count is the term in months.
      const n = preset.fee_kind === 'annual-emi' ? (preset.term_months || 12) : (preset.instalments || 1);
      let inst;
      if (preset.fee_kind === 'annual-emi') inst = emiMonthly(P, preset.rate_pct, preset.term_months || 12);
      else if (preset.fee_kind === 'price-markup') inst = markupPartsFor(preset, input, P).inst;
      else inst = (P + markup) / n;
      let overdue = 0;
      for (let k = 1; k <= n; k++) {
        if (days > 30 * k + grace) overdue++;
      }
      late = overdue * Math.min((inst * (lf.pct || 0)) / 100, lf.cap_rs || Infinity);
    } else if (pastDue > 0) {
      if (lf.kind === 'one-off-pct') late = (P * (lf.pct || 0)) / 100;
      else if (lf.kind === 'weekly-pct') late = (P * (lf.pct || 0) / 100) * (pastDue / 7);
      else if (lf.kind === 'flat-rs') late = lf.flat_rs || 0;
      else if (lf.kind === 'flat-rs-per-instalment') late = lf.flat_rs || 0;
    }
    if (preset.fee_kind === 'annual-emi') {
      // total / owed were already set by the EMI maths above; the late fee
      // (if any) goes on top of the settlement amount.
      total += late;
      if (days > 30 * (preset.term_months || 12)) owed = late;
    } else if (preset.fee_kind === 'price-markup') {
      total += late;
      owed = owed + late;
    } else {
      total = P + markup + late;
      owed = total;
    }
  }

  return { markup: roundRs(markup), late_fee: roundRs(late), total: roundRs(total), owed: roundRs(owed) };
}

// Due date (ISO) and due length in days for the chosen preset/options.
function dueInfo(preset, input) {
  if (preset.model === 'flat-term') {
    const opt = (preset.term_options || [])[input.term_option || 0] || (preset.term_options || [])[0] || {};
    const feePct = preset.fee_tiers
      ? tierRate(preset.fee_tiers.map((t) => ({ upto: t.upto, rate: t.fee })), input.cycles)
      : (opt.fee_pct != null ? opt.fee_pct : (preset.fee_pct || 0));
    const dueDays = opt.days != null ? opt.days : (preset.due_days || 30);
    return { due_days: dueDays, instalments: opt.instalments || 1, fee_pct: feePct };
  }
  if (preset.model === 'price-markup') {
    const opt = (preset.term_options || [])[input.term_option || 0] || (preset.term_options || [])[0] || {};
    return { due_days: opt.days != null ? opt.days : 90, instalments: opt.instalments || 1, markup_pct: opt.markup_pct || 0 };
  }
  if (preset.model === 'annual-reducing' || preset.model === 'kibor-spread' || preset.model === 'annual-flat') {
    const n = termMonths(preset, input);
    return { due_days: n * 30, instalments: n, annual_rate: effectiveAnnualRate(preset, input), term_months: n };
  }
  if (preset.model === 'flat-fee') {
    return { due_days: preset.due_days || 30, instalments: 1, fee_rs: preset.fee_rs || 0 };
  }
  if (preset.model === 'custom' && preset.fee_kind === 'annual-emi') {
    return { due_days: (preset.term_months || 12) * 30, instalments: preset.term_months || 12, fee_pct: null };
  }
  if (preset.model === 'custom' && preset.fee_kind === 'price-markup') {
    return { due_days: preset.due_days, instalments: preset.instalments || 1, markup_pct: preset.rate_pct };
  }
  if (preset.model === 'custom') {
    return { due_days: preset.due_days || 30, instalments: preset.instalments || 1, fee_pct: null };
  }
  return { due_days: preset.due_days || 30, instalments: 1, fee_pct: null };
}

// Warn when the amount is outside the preset's published range — or the
// selected rate option's own max (e.g. PM Youth tiers, each with its own
// ceiling). Returns a plain sentence, or '' when the amount is in range.
// Never blocks: the user may still want an estimate outside the range.
function amountRangeWarning(preset, input, principal) {
  if (!preset) return '';
  var min = preset.min_amount;
  var max = preset.max_amount;
  if (input && input.rate_option != null && Array.isArray(preset.rate_options) && preset.rate_options[input.rate_option]) {
    var ro = preset.rate_options[input.rate_option];
    if (ro.max_amount) max = ro.max_amount;
  }
  if (min && principal < min) return 'This loan starts at Rs ' + Number(min).toLocaleString('en-PK') + ' — the amount you typed is below the minimum.';
  if (max && principal > max) return 'This loan goes up to Rs ' + Number(max).toLocaleString('en-PK') + ' — the amount you typed is above the maximum.';
  return '';
}

// Full calculation for a planned repayment date.
function compute(presetIn, input) {
  // "Rate on request" loans: the lender publishes no rate, so the user types
  // the rate from their Key Fact Statement — the calculation then runs on the
  // Custom maths (input.kfs). Without those numbers the loan is not calculable.
  if (presetIn.model === 'rate-on-request') {
    // A zero rate means "not entered yet" — without it the maths would
    // silently show the loan as free (total = amount, 0% cost).
    if (!input.kfs || !(Number(input.kfs.rate_pct) || 0)) {
      return {
        error: 'No published rate for this lender — ask for the Key Fact Statement and use Custom loan with the rate they quote.',
        not_calculable: true, preset_id: presetIn.id,
      };
    }
    const synth = resolvePreset({ id: 'custom' }, { custom: input.kfs });
    const r = compute(synth, { ...input, custom: input.kfs });
    if (!r.error) {
      r.preset_id = presetIn.id;
      r.kfs_note = 'Calculated from the rate you entered from the Key Fact Statement — not from a published rate.';
    }
    return r;
  }
  const preset = resolvePreset(presetIn, input);
  const P = Math.max(0, Math.round(Number(input.principal) || 0));
  const borrowMs = parseDate(input.borrow_date);
  const repayMs = parseDate(input.repay_date);
  if (borrowMs == null || repayMs == null) return { error: 'Enter a borrow date and a repayment date.' };
  const days = daysBetween(borrowMs, repayMs);
  if (days < 0) return { error: 'The repayment date is before the borrow date.' };
  if (P <= 0) return { error: 'Enter a loan amount above Rs 0.' };

  const due = dueInfo(preset, input);
  const dueDateMs = addDays(borrowMs, due.due_days);
  const now = owedOnDay(preset, { ...input, principal: P }, days);
  const markup = now.markup;
  const lateFee = now.late_fee;
  const total = now.total;
  // Extra cost = the fee / interest + any late fee (for price-markup the down
  // payment is part of the price, not extra cost).
  const cost = markup + lateFee;
  const costPct = P > 0 ? Math.round((cost / P) * 1000) / 10 : 0;
  const annualised = days > 0 ? Math.round(((cost / P) * (365 / days)) * 1000) / 10 : null;

  // Cap hit?
  let capHit = false;
  let capNote = '';
  if (preset.model === 'weekly-compound' && preset.cap_pct != null) {
    const cap = (P * preset.cap_pct) / 100;
    if (markup >= cap) { capHit = true; capNote = 'Markup cap reached: the fee cannot grow past ' + preset.cap_pct + '% of the loan (Rs ' + roundRs(cap).toLocaleString('en-PK') + ').'; }
  } else if (preset.model === 'weekly-simple' && preset.cap_pct != null) {
    const cap = (P * preset.cap_pct) / 100;
    if (markup >= cap) { capHit = true; capNote = 'Markup cap reached: the fee cannot grow past ' + preset.cap_pct + '% of the loan (Rs ' + roundRs(cap).toLocaleString('en-PK') + ').'; }
  } else if (preset.model === 'custom') {
    const cap = capAmount(preset, P);
    if (cap != null && markup >= cap) { capHit = true; capNote = 'Your cap is reached: the fee cannot grow past Rs ' + roundRs(cap).toLocaleString('en-PK') + '.'; }
  }

  // Timeline: monthly steps for the EMI-like models (and very long loans),
  // weekly otherwise. Rows show the fee so far, the late fee, and what is
  // still owed on that date.
  const isPM = preset.model === 'price-markup' || (preset.model === 'custom' && preset.fee_kind === 'price-markup');
  const emiLike = preset.model === 'annual-reducing' || preset.model === 'kibor-spread' ||
    preset.model === 'annual-flat' || isPM ||
    (preset.model === 'custom' && preset.fee_kind === 'annual-emi');
  const step = emiLike ? 30 : (days > 120 ? 30 : 7);
  const timeline = [];
  for (let d = 0; d < days; d += step) {
    const o = owedOnDay(preset, { ...input, principal: P }, d);
    timeline.push({
      date: fmtDate(addDays(borrowMs, d)), day: d,
      label: d === 0 ? (isPM ? 'Purchase day' : 'Borrow day') : (step === 7 ? 'Week ' + Math.round(d / 7) : 'Month ' + Math.round(d / 30)),
      owed: o.owed, markup: o.markup, late_fee: o.late_fee,
    });
  }
  const last = owedOnDay(preset, { ...input, principal: P }, days);
  timeline.push({
    date: fmtDate(repayMs), day: days, label: 'Repayment day',
    owed: last.owed, markup: last.markup, late_fee: last.late_fee,
  });

  // "Pay late" cards, relative to the planned repayment date.
  function lateCard(extraDays) {
    const o = owedOnDay(preset, { ...input, principal: P }, days + extraDays);
    return { date: fmtDate(addDays(repayMs, extraDays)), total: o.total, extra: o.total - total, markup: o.markup, late_fee: o.late_fee };
  }
  const late = { plus1: lateCard(1), plus7: lateCard(7), plus30: lateCard(30) };

  // Instalment: the scheduled monthly instalment for the EMI-like and
  // price-markup models; for flat-term instalment plans, (principal + markup) / n.
  let instalment = null;
  if (emiLike) {
    if (isPM) {
      instalment = roundRs(markupPartsFor(preset, input, P).inst);
    } else if (preset.model === 'annual-flat') {
      const rate = effectiveAnnualRate(preset, input);
      const n = termMonths(preset, input);
      const markupTotal = P * (rate / 100) * (n / 12);
      instalment = roundRs((P + markupTotal) / n);
    } else if (preset.model === 'custom' && preset.fee_kind === 'annual-emi') {
      instalment = roundRs(emiMonthly(P, preset.rate_pct, preset.term_months || 12));
    } else {
      instalment = roundRs(emiMonthly(P, effectiveAnnualRate(preset, input), termMonths(preset, input)));
    }
  } else if ((preset.model === 'flat-term' || (preset.model === 'custom' && preset.fee_kind === 'flat-term')) && due.instalments > 1) {
    instalment = roundRs((P + markup) / due.instalments);
  }

  // Down payment and financed amount (price-markup only).
  let downPayment = null;
  let financedAmount = null;
  if (isPM) {
    const parts = markupPartsFor(preset, input, P);
    downPayment = roundRs(parts.down);
    financedAmount = roundRs(parts.financed);
  }

  let verdict;
  if (isPM) {
    verdict = 'Rs ' + P.toLocaleString('en-PK') + ' price: Rs ' + downPayment.toLocaleString('en-PK') +
      ' down, then ' + due.instalments + ' instalments of Rs ' + (instalment || 0).toLocaleString('en-PK') +
      ' — you pay Rs ' + total.toLocaleString('en-PK') + ' in total (' +
      'Rs ' + cost.toLocaleString('en-PK') + ' extra on the financed Rs ' +
      financedAmount.toLocaleString('en-PK') + ').';
  } else {
    verdict = 'Rs ' + P.toLocaleString('en-PK') + ' for ' + days + (days === 1 ? ' day' : ' days') +
      ' costs Rs ' + cost.toLocaleString('en-PK') + ' extra — you pay back Rs ' +
      total.toLocaleString('en-PK') + ' (' + costPct + '% more).';
  }

  // SECP nano-loan guardrails (input.nano is set by the nano-app flow):
  // warn plainly when the rate the user entered would breach a cap.
  let guardrails = null;
  if (input.nano) {
    guardrails = nanoCheck({
      amount: P,
      totalBorrowed: P + (Number(input.nano.otherBorrowed) || 0),
      days,
      totalCost: cost,
      apr: annualised,
    });
  }

  return {
    preset_id: preset.id, principal: P, days,
    borrow_date: fmtDate(borrowMs), repay_date: fmtDate(repayMs),
    due_date: fmtDate(dueDateMs), due_days: due.due_days, instalments: due.instalments,
    instalment, down_payment: downPayment, financed_amount: financedAmount,
    markup, late_fee: lateFee, total, cost, cost_pct: costPct,
    annualised_pct: annualised, cap_hit: capHit, cap_note: capNote,
    guardrails,
    timeline, late, verdict, notes: notesFor(preset, due, input, lateFee),
  };
}

function notesFor(preset, due, input, lateFee) {
  const notes = [];
  // Instalment plans (Daraz, JazzCash BNPL, manual flat-term with a
  // per-instalment late fee): the result assumes the borrower pays
  // everything on the final day, so instalments due earlier already count
  // as overdue. Say plainly what paying on time would cost instead.
  const isFlatInstalments = (preset.model === 'flat-term' ||
    (preset.model === 'custom' && preset.fee_kind === 'flat-term')) &&
    (due.instalments || 1) > 1;
  if (isFlatInstalments && (lateFee || 0) > 0) {
    const feePct = preset.model === 'flat-term' ? (due.fee_pct || 0) : (preset.rate_pct || 0);
    const onTime = Math.round(input.principal + (input.principal * feePct) / 100);
    notes.push('Pay each instalment on time and you pay Rs ' + onTime.toLocaleString('en-PK') +
      ' in total — no late fee. This result assumes you pay everything on the final day, so instalments due earlier count as overdue.');
  }
  if (preset.id === 'easycash-app') {
    notes.push('No late fee on the app route — the weekly charge itself is the cost of keeping the loan longer. Markup stops at the 40% cap (8 weeks).');
    notes.push('Markup is charged per day of use; repaying early means markup already taken for unused days is charged as an early-repayment fee.');
  }
  if (preset.id === 'easycash-ussd') {
    notes.push('The 30-day flat fee applies in full for the term. The 5% late fee is one-off, charged only after the 2-day grace period.');
  }
  if (preset.id === 'easypaisa-bnpl') {
    notes.push('The late fee is one-off 5% of the loan, charged from the first day past the due date (no grace period is stated).');
  }
  if (preset.id === 'jazzcash-readycash') {
    notes.push('The fee is 5% of the original loan each week — it does not compound. After 56 days the fee stops at the 40% cap, but the loan is in default and can be reported to SBP eCIB.');
    notes.push('Partial repayment lowers the fee, because the weekly fee then runs on what is left. This calculator assumes you repay the whole loan at once.');
  }
  if (preset.id === 'daraz-paylater') {
    notes.push('The late fee is charged per overdue instalment: 5% of that instalment, capped at Rs 800.');
  }
  if (preset.id === 'jazzcash-bnpl') {
    notes.push('Instalments at purchase, +30 days, +60 days. Early repayment is free.');
  }
  if (preset.id === 'custom') {
    notes.push('Custom loan — the numbers are whatever you typed. They are not checked against any lender.');
  }
  // New models — generic notes.
  const emiLike = preset.model === 'annual-reducing' || preset.model === 'kibor-spread' || preset.model === 'annual-flat';
  if (emiLike) {
    notes.push('You pay a fixed monthly instalment (EMI). The calculator assumes you pay every instalment on its due date — a late fee only counts if you pay after the loan\'s end date. Early-settlement fees are not included; the bank charges them separately (see the preset notes).');
  }
  if (preset.model === 'kibor-spread') {
    const kibor = input && input.kibor_rate != null ? Number(input.kibor_rate) : Number(preset.kibor_default || 12.8);
    notes.push('KIBOR changes daily — this uses 1-year KIBOR ' + kibor + '% (late Oct 2026). Check today\'s KIBOR before you borrow.');
    if (preset.spread_editable && spreadFor(preset, input || {}) === 0) {
      notes.push('Your spread is NOT set — this shows KIBOR only, not your real rate. Type the spread your bank quoted in the Key Fact Statement.');
    }
  }
  if (preset.model === 'annual-flat') {
    notes.push('Musawamah: the bank sells you the asset at an agreed fixed total price. The profit does not compound like interest.');
  }
  if (preset.model === 'price-markup') {
    notes.push('The profit is built into the price — you pay the down payment first, then the financed amount plus profit in instalments.');
  }
  if (preset.model === 'custom' && preset.fee_kind === 'price-markup') {
    notes.push('The profit is built into the price — you pay the down payment first, then the financed amount plus profit in instalments.');
  }
  if (preset.model === 'flat-fee') {
    notes.push('Earned-wage access, not a loan: a flat fee per drawdown, repaid automatically from your next salary. No interest and no late fee.');
  }
  if (preset.model === 'custom' && preset.fee_kind === 'flat-fee') {
    notes.push('One flat fee — no interest. The late fee only applies if you set one above.');
  }
  if (preset.late_fee && preset.late_fee.kind === 'charity') {
    notes.push('Late payment goes to charity, not the bank\'s income — the amount is set in your contract and is not added to the total here.');
  }
  if (preset.late_fee && preset.late_fee.kind === 'unverified') {
    notes.push('The late fee is set in the lender\'s schedule of charges and is not published on the product page, so it is not included here.');
  }
  if (preset.late_fee && preset.late_fee.kind === 'flat-rs-per-instalment') {
    notes.push('The late fee is Rs ' + (preset.late_fee.flat_rs || 0).toLocaleString('en-PK') + ' + FED per late payment — FED (federal excise duty) is charged on top and is not included in the total here.');
  }
  if (preset.id === 'pm-youth') {
    notes.push('Business and agriculture loans only — not general personal cash.');
  }
  if (preset.id === 'akhuwat') {
    notes.push('Interest-free (Qarz-e-Hasna). Indicative only — verify at an Akhuwat branch.');
  }
  if (preset.early_fee_note) {
    notes.push(preset.early_fee_note + ' (early-settlement fee — not included in the total above).');
  }
  if (preset.verified === false) {
    notes.push('This preset was not independently re-verified against a live source — check the app before you borrow.');
  }
  return notes;
}

// Map the Manual loan calculator form to a compute() input.
// form = { amount, rate, mode, tenure_value, tenure_unit ('days'|'weeks'|'months'),
//   down_pct, instalments, fee_rs, late_kind, late_value, late_cap_rs,
//   grace_days, cap_kind, cap_value, early_note, borrow_date }
// The repayment date is the borrow date + the tenure. mode is one of
// 'weekly-simple' | 'weekly-compound' | 'monthly-simple' | 'flat-term' |
// 'annual-emi' | 'price-markup' | 'flat-fee'.
function manualInput(form) {
  const amount = Math.max(0, Math.round(Number(form.amount) || 0));
  const tenureValue = Math.max(1, Math.floor(Number(form.tenure_value) || 30));
  const unit = form.tenure_unit || 'days';
  const termDays = unit === 'weeks' ? tenureValue * 7 : unit === 'months' ? tenureValue * 30 : tenureValue;
  const termMonths = unit === 'months' ? tenureValue : Math.max(1, Math.round(termDays / 30));
  const borrowMs = parseDate(form.borrow_date);
  const repayDate = borrowMs != null ? fmtDate(addDays(borrowMs, termDays)) : '';
  const custom = {
    fee_kind: form.mode || 'flat-term',
    rate_pct: Number(form.rate) || 0,
    term_days: termDays,
    term_months: termMonths,
    instalments: Math.max(1, Math.floor(Number(form.instalments) || 1)),
    down_pct: Number(form.down_pct) || 0,
    fee_rs: Number(form.fee_rs) || 0,
    late_kind: form.late_kind || 'none',
    late_pct: Number(form.late_value) || 0,
    late_flat_rs: Number(form.late_value) || 0,
    late_cap_rs: Number(form.late_cap_rs) || 0,
    grace_days: Math.max(0, Math.floor(Number(form.grace_days) || 0)),
    cap_kind: form.cap_kind || 'none',
    cap_pct: form.cap_kind === 'pct' ? (Number(form.cap_value) || 0) : 0,
    cap_rs: form.cap_kind === 'rs' ? (Number(form.cap_value) || 0) : 0,
  };
  return {
    principal: amount,
    cycles: 1,
    borrow_date: form.borrow_date,
    repay_date: repayDate,
    term_option: 0,
    custom,
    early_note: String(form.early_note || '').trim(),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { roundRs, parseDate, fmtDate, daysBetween, addDays, tierRate, rateOption, spreadFor, effectiveAnnualRate, termMonths, emiMonthly, emiBalance, priceMarkupParts, markupPartsFor, nanoCheck, resolvePreset, owedOnDay, dueInfo, amountRangeWarning, compute, manualInput };
}
if (typeof window !== 'undefined') window.LoanCalc = { roundRs, parseDate, fmtDate, daysBetween, addDays, tierRate, rateOption, spreadFor, effectiveAnnualRate, termMonths, emiMonthly, emiBalance, priceMarkupParts, markupPartsFor, nanoCheck, resolvePreset, owedOnDay, dueInfo, amountRangeWarning, compute, manualInput };
