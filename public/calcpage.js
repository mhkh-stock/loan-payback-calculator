// Loan Payback Calculator — per-loan calculator page (calculator.html).
// Preset comes from the URL (?preset=<id> or ?nano=<app name>). The full
// policy is shown at the top; the user enters amount + dates (+ the rate
// from their Key Fact Statement for "rate on request" loans, or from the
// app's Borrower Factsheet for nano apps). Maths lives in public/calc.js;
// nothing entered here is sent anywhere.
'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return 'Rs ' + Number(n).toLocaleString('en-PK'); };
  var presets = [];
  var presetById = {};
  var nanoApps = [];
  var nanoData = null;
  var preset = null;
  var isNano = false;
  var nanoApp = null;
  var lastPresetId = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function todayISO(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }
  function addDaysISO(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }

  // ---- policy text ----
  function howCharged(p) {
    if (p.model === 'weekly-compound') {
      var rates = p.weekly_rates || [];
      var parts = rates.map(function (w, i) {
        var from = i === 0 ? 1 : (rates[i - 1].upto + 1);
        var range = w.upto ? (from + '–' + w.upto) : (from + '+');
        return w.rate + '% (cycles ' + range + ')';
      });
      var r = parts.join(', ');
      return r ? (r + ' a week on the outstanding loan, compounded every 7 days.') : 'A % a week on the outstanding loan, compounded every 7 days.';
    }
    if (p.model === 'weekly-simple') return '5% a week on the loan, simple (not compounded).';
    if (p.model === 'flat-term') {
      var due = LoanCalc.dueInfo(p, { principal: 0, term_option: 0 });
      return 'Flat ' + (due.fee_pct != null ? due.fee_pct : '—') + '% of the loan for the whole term.';
    }
    if (p.model === 'annual-reducing') return 'A fixed % a year on the reducing balance, paid as a fixed monthly instalment (EMI).';
    if (p.model === 'kibor-spread') return '1-year KIBOR + a spread, a year, on the reducing balance (EMI). KIBOR changes daily — check today\'s rate.';
    if (p.model === 'annual-flat') return 'A fixed profit % a year on the loan (Musawamah fixed sale price — the profit does not compound).';
    if (p.model === 'price-markup') return 'Down payment first, then the financed amount plus a fixed profit, in instalments.';
    if (p.model === 'flat-fee') return 'A flat fee per drawdown, repaid automatically from your next salary. No interest.';
    if (p.model === 'rate-on-request') return 'Rate not published — ask the lender for the Key Fact Statement.';
    if (p.id === 'custom') return 'Your own numbers — you set the rate and how it is charged.';
    return '—';
  }
  function lateFeeText(p) {
    var lf = p.late_fee || {};
    if (!lf.kind || lf.kind === 'none') return 'No late fee.';
    if (lf.kind === 'charity') return 'Late payment goes to charity, not the bank\'s income — the amount is set in your contract and is not added to the total here.';
    if (lf.kind === 'unverified') return 'Set in the lender\'s schedule of charges — not published on the product page, so it is not included here.';
    if (lf.kind === 'one-off-pct') return lf.pct + '% of the loan, once, after ' + (lf.grace_days || 0) + ' grace day(s)' + (lf.cap_rs ? ', capped at Rs ' + lf.cap_rs.toLocaleString('en-PK') : '') + '.';
    if (lf.kind === 'weekly-pct') return lf.pct + '% of the loan per week late' + (lf.grace_days ? ', after ' + lf.grace_days + ' grace day(s)' : '') + '.';
    if (lf.kind === 'per-instalment-pct') return lf.pct + '% of each overdue instalment' + (lf.cap_rs ? ', capped at Rs ' + lf.cap_rs.toLocaleString('en-PK') + ' per instalment' : '') + '.';
    if (lf.kind === 'flat-rs') return 'Rs ' + (lf.flat_rs || 0).toLocaleString('en-PK') + ' flat' + (lf.grace_days ? ', after ' + lf.grace_days + ' grace day(s)' : '') + '.';
    if (lf.kind === 'flat-rs-per-instalment') return 'Rs ' + (lf.flat_rs || 0).toLocaleString('en-PK') + ' + FED per late payment' + (lf.grace_days ? ', after ' + lf.grace_days + ' grace day(s)' : '') + ' — FED is not included in the total here.';
    return '—';
  }
  function badgeHtml(p) {
    if (p.model === 'rate-on-request') return '<span class="badge badge-ror">Rate on request</span>';
    if (!p.verified) return '<span class="badge badge-unverified">Not re-verified</span>';
    return '<span class="badge badge-verified">✓ Verified</span>';
  }
  function kv(k, v) {
    return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">' + v + '</span></div>';
  }
  function renderPolicy() {
    var p = preset;
    $('policyName').innerHTML = esc(p.name) + ' ' + badgeHtml(p) +
      (p.name_ur ? '<br><span class="ur">' + esc(p.name_ur) + '</span>' : '');
    $('policySub').textContent = p.lender || '';
    var rows = '';
    rows += kv('Headline rate', esc(p.rate_line || '—'));
    rows += kv('How it is charged', esc(howCharged(p)));
    var due = null;
    try { due = LoanCalc.dueInfo(p, { principal: Number($('amount').value) || 0, term_option: 0 }); } catch (e) { due = null; }
    if (due) rows += kv('Due date', esc(due.due_days + ' days from borrowing' + (due.instalments > 1 ? ' · ' + due.instalments + ' instalments' : '')));
    rows += kv('Late fee', esc(lateFeeText(p)));
    if (p.early) rows += kv('Early repayment', esc(p.early));
    if (p.eligibility) rows += kv('Who can get it', esc(p.eligibility));
    if (p.source) {
      rows += kv('Source', p.source_url
        ? '<a href="' + esc(p.source_url) + '" target="_blank" rel="noopener">' + esc(p.source) + '</a>'
        : esc(p.source));
    }
    if (p.as_of) rows += kv('As of', esc(p.as_of));
    $('policyRows').innerHTML = rows;
    // Nano guardrails box (static SECP list, from the API payload).
    var g = nanoData && nanoData.nano_guardrails;
    if (isNano && g) {
      $('nanoGuard').hidden = false;
      $('nanoGuard').innerHTML = '<strong>SECP guardrails for nano loans:</strong><ul>' +
        '<li>At most Rs ' + g.max_per_app_rs.toLocaleString('en-PK') + ' per app and Rs ' + g.max_total_rs.toLocaleString('en-PK') + ' across all apps</li>' +
        '<li>Tenure at most ' + g.max_tenure_days + ' days (max ' + g.max_rollovers + ' rollovers)</li>' +
        '<li>' + esc(g.total_cost_cap) + '</li>' +
        '<li>' + esc(g.apr_cap_note) + '</li>' +
        '<li>No compounding, no upfront fee deduction, ' + g.cooling_off_hours + '-hour cooling-off</li>' +
        '</ul><p class="small">' + esc(g.note) + '</p>';
    }
  }

  // ---- formula text (check-it-yourself line under the results) ----
  function formulaText(p, input, r) {
    if (p.id === 'easycash-app') {
      var rate = LoanCalc.tierRate(p.weekly_rates, input.cycles);
      return 'Weekly rate ' + rate + '% on the outstanding loan, compounded every 7 days' +
        ' (a part-week counts daily at ' + rate + '% ÷ 7). Markup stops at 40% of the loan.' +
        ' Rs ' + input.principal.toLocaleString('en-PK') + ' for ' + r.days + ' days → fee Rs ' +
        r.markup.toLocaleString('en-PK') + '.';
    }
    if (p.id === 'jazzcash-readycash' || p.id === 'jazzcash-readyload') {
      return 'Fee = loan × 5% × weeks (simple, not compounded). Rs ' +
        input.principal.toLocaleString('en-PK') + ' × 5% × ' + (r.days / 7).toFixed(1) +
        ' weeks = Rs ' + r.markup.toLocaleString('en-PK') + '. Cap 40% (8 weeks).';
    }
    if (p.model === 'flat-term') {
      var due = LoanCalc.dueInfo(p, input);
      var line = 'Flat fee ' + due.fee_pct + '% of the loan = Rs ' + r.markup.toLocaleString('en-PK') + '.';
      if (p.id === 'daraz-paylater' || p.id === 'jazzcash-bnpl') {
        line += ' Paid in ' + due.instalments + ' instalment' + (due.instalments > 1 ? 's' : '') +
          ' of Rs ' + (r.instalment != null ? r.instalment.toLocaleString('en-PK') : '—') + ' each.';
      }
      if (r.late_fee > 0) line += ' Late fee Rs ' + r.late_fee.toLocaleString('en-PK') + '.';
      return line;
    }
    if (p.model === 'annual-reducing' || p.model === 'kibor-spread') {
      var due2 = LoanCalc.dueInfo(p, input);
      var txt = 'Monthly instalment (EMI) = loan × r × (1+r)^n ÷ ((1+r)^n − 1), where r is the monthly rate and n is ' +
        due2.term_months + ' months. Rate ' + due2.annual_rate + '% a year → instalment Rs ' +
        (r.instalment != null ? r.instalment.toLocaleString('en-PK') : '—') +
        ', total interest Rs ' + r.markup.toLocaleString('en-PK') + '.';
      if (p.model === 'kibor-spread') {
        txt += ' Rate = 1-year KIBOR ' + (input.kibor_rate != null ? input.kibor_rate : p.kibor_default) +
          '% + spread ' + LoanCalc.spreadFor(p, input) + '%.';
      }
      return txt;
    }
    if (p.model === 'annual-flat') {
      var due3 = LoanCalc.dueInfo(p, input);
      return 'Fixed sale price (Musawamah): profit = loan × ' + due3.annual_rate + '% × ' +
        (due3.term_months / 12) + ' years = Rs ' + r.markup.toLocaleString('en-PK') +
        '. Total Rs ' + r.total.toLocaleString('en-PK') + ' in ' + due3.term_months +
        ' monthly instalments of Rs ' + (r.instalment != null ? r.instalment.toLocaleString('en-PK') : '—') + '.';
    }
    if (p.model === 'price-markup') {
      var due4 = LoanCalc.dueInfo(p, input);
      return 'Down payment Rs ' + (r.down_payment != null ? r.down_payment.toLocaleString('en-PK') : '—') +
        ', financed Rs ' + (r.financed_amount != null ? r.financed_amount.toLocaleString('en-PK') : '—') +
        ' plus ' + due4.markup_pct + '% profit = Rs ' + r.markup.toLocaleString('en-PK') +
        '. ' + due4.instalments + ' instalments of Rs ' +
        (r.instalment != null ? r.instalment.toLocaleString('en-PK') : '—') + ' each.';
    }
    if (p.model === 'flat-fee') {
      return 'Flat fee Rs ' + (p.fee_rs || 0).toLocaleString('en-PK') +
        ' per drawdown, repaid from your next salary. Rs ' +
        input.principal.toLocaleString('en-PK') + ' → Rs ' + r.total.toLocaleString('en-PK') + '.';
    }
    if (p.id === 'custom' || isNano) {
      var c = input.custom || {};
      var kind = c.fee_kind === 'flat-term' ? 'flat ' + c.rate_pct + '%' :
        c.fee_kind === 'weekly-simple' ? c.rate_pct + '% per week, simple' :
        c.fee_kind === 'weekly-compound' ? c.rate_pct + '% per week, compounded' :
        c.fee_kind === 'monthly-simple' ? c.rate_pct + '% per month, simple' :
        c.fee_kind === 'annual-emi' ? c.rate_pct + '% a year, reducing balance (EMI)' :
        c.fee_kind === 'price-markup' ? c.rate_pct + '% price markup' :
        c.fee_kind === 'flat-fee' ? 'flat fee Rs ' + (c.fee_rs || 0) : c.rate_pct + '%';
      return (isNano ? 'From the app\'s Borrower Factsheet: ' : 'Custom: ') + kind +
        ' on Rs ' + input.principal.toLocaleString('en-PK') + ' for ' + r.days + ' days → fee Rs ' +
        r.markup.toLocaleString('en-PK') + (r.late_fee > 0 ? ', late fee Rs ' + r.late_fee.toLocaleString('en-PK') : '') + '.';
    }
    return 'Fee Rs ' + r.markup.toLocaleString('en-PK') + ', late fee Rs ' + r.late_fee.toLocaleString('en-PK') + '.';
  }

  // ---- read the form ----
  function readInput() {
    var p = preset;
    var input = {
      principal: Number($('amount').value) || 0,
      cycles: Number($('cycles').value) || 1,
      borrow_date: $('borrowDate').value,
      repay_date: $('repayDate').value,
      term_option: 0,
      rate_option: 0,
    };
    var checked = document.querySelector('input[name="termOpt"]:checked');
    if (checked) input.term_option = Number(checked.value) || 0;
    var rchecked = document.querySelector('input[name="rateOpt"]:checked');
    if (rchecked) input.rate_option = Number(rchecked.value) || 0;
    if ($('termMonths') && $('termMonths').value) input.term_months = Number($('termMonths').value) || 0;
    if ($('kiborRate') && $('kiborRate').value !== '') input.kibor_rate = Number($('kiborRate').value);
    if ($('spreadPct') && $('spreadPct').value !== '') input.spread_pct = Number($('spreadPct').value);
    if ($('annualRatePct') && $('annualRatePct').value !== '') input.annual_rate_pct = Number($('annualRatePct').value);
    if (isNano) {
      var days = LoanCalc.daysBetween($('borrowDate').value, $('repayDate').value);
      input.custom = {
        fee_kind: $('nanoFreq').value,
        rate_pct: Number($('nanoRate').value) || 0,
        term_days: Math.max(1, days),
        late_kind: (Number($('nanoLatePct').value) || 0) > 0 ? 'one-off-pct' : 'none',
        late_pct: Number($('nanoLatePct').value) || 0,
        late_flat_rs: 0,
        grace_days: Number($('nanoGraceDays').value) || 0,
        cap_kind: 'none',
      };
      input.nano = { otherBorrowed: Number($('nanoOtherBorrowed').value) || 0 };
    } else if (p && p.model === 'rate-on-request') {
      input.kfs = {
        fee_kind: $('kfsFeeKind').value,
        rate_pct: Number($('kfsRate').value) || 0,
        term_days: Number($('kfsTermDays').value) || 365,
        term_months: Math.max(1, Math.round((Number($('kfsTermDays').value) || 365) / 30)),
        late_kind: $('kfsLateKind').value,
        late_pct: Number($('kfsLateValue').value) || 0,
        late_flat_rs: $('kfsLateKind').value === 'flat-rs' ? (Number($('kfsLateValue').value) || 0) : 0,
        grace_days: Number($('kfsGraceDays').value) || 0,
        cap_kind: $('kfsCapKind').value,
        cap_pct: $('kfsCapKind').value === 'pct' ? (Number($('kfsCapValue').value) || 0) : 0,
        cap_rs: $('kfsCapKind').value === 'rs' ? (Number($('kfsCapValue').value) || 0) : 0,
      };
    } else if (p && p.id === 'custom') {
      var fk = $('feeKind').value;
      input.custom = {
        fee_kind: fk,
        rate_pct: Number($('ratePct').value) || 0,
        term_days: Number($('termDays').value) || 30,
        term_months: Math.max(1, Math.round((Number($('termDays').value) || 30) / 30)),
        instalments: Number($('instalments').value) || 1,
        down_pct: Number($('downPct').value) || 0,
        fee_rs: Number($('feeRs').value) || 0,
        late_kind: $('lateKind').value,
        late_pct: Number($('latePct').value) || 0,
        late_flat_rs: Number($('lateFlatRs').value) || 0,
        late_cap_rs: Number($('lateCapRs').value) || 0,
        grace_days: Number($('graceDays').value) || 0,
        cap_kind: $('capKind').value,
        cap_pct: $('capKind').value === 'pct' ? (Number($('capValue').value) || 0) : 0,
        cap_rs: $('capKind').value === 'rs' ? (Number($('capValue').value) || 0) : 0,
      };
    }
    return { preset: p, input: input };
  }

  function render() {
    var got = readInput();
    var p = got.preset;
    var input = got.input;
    if (!p) return;
    var effPreset = isNano ? { id: 'custom' } : p;
    var r = LoanCalc.compute(effPreset, input);
    var res = $('results');
    var hint = $('presetHint');
    if (r.error) {
      res.classList.remove('show');
      hint.hidden = false;
      hint.textContent = p.model === 'rate-on-request'
        ? 'No published rate for this lender — enter the rate from your Key Fact Statement in the box above and the calculator will work.'
        : r.error;
      return;
    }
    hint.hidden = true;
    res.classList.add('show');
    $('rDate').textContent = r.repay_date;
    $('rTotal').textContent = fmt(r.total);
    $('rPrincipal').textContent = fmt(r.principal);
    $('rMarkup').textContent = fmt(r.markup);
    $('rLate').textContent = fmt(r.late_fee);
    $('rCost').textContent = '+' + fmt(r.cost) + ' (' + r.cost_pct + '%)';
    $('rDue').textContent = r.due_date + ' (' + r.due_days + ' days)';
    $('rInstRow').hidden = r.instalment == null;
    if (r.instalment != null) $('rInst').textContent = fmt(r.instalment);
    $('rDownRow').hidden = r.down_payment == null;
    if (r.down_payment != null) {
      $('rDown').textContent = fmt(r.down_payment) + ' down, Rs ' + r.financed_amount.toLocaleString('en-PK') + ' financed';
    }
    $('rAnnual').textContent = r.annualised_pct != null ? ('~' + r.annualised_pct + '% a year (simple annualisation)') : '—';
    $('rCapWarn').hidden = !r.cap_hit;
    if (r.cap_hit) $('rCapWarn').textContent = '⚠ ' + r.cap_note;
    // Amount outside the preset's published range: warn, don't block.
    var rw = $('rangeWarn');
    var rangeWarn = LoanCalc.amountRangeWarning ? LoanCalc.amountRangeWarning(p, input, input.principal) : '';
    if (rw) { rw.hidden = !rangeWarn; if (rangeWarn) rw.textContent = '⚠ ' + rangeWarn; }
    $('rVerdict').textContent = r.verdict;
    $('rPlanDate').textContent = r.repay_date;
    function lateCard(prefix, card) {
      $(prefix).textContent = fmt(card.total);
      $(prefix + 'x').textContent = card.extra > 0 ? ('+' + fmt(card.extra) + ' extra') : 'no extra';
      $(prefix + 'd').textContent = card.date;
    }
    lateCard('rLate1', r.late.plus1);
    lateCard('rLate7', r.late.plus7);
    lateCard('rLate30', r.late.plus30);
    $('rTimeline').innerHTML = r.timeline.map(function (row) {
      return '<tr><td>' + row.date + '</td><td>' + row.day + '</td><td>' + fmt(row.markup) +
        '</td><td>' + fmt(row.late_fee) + '</td><td><strong>' + fmt(row.owed) + '</strong></td></tr>';
    }).join('');
    $('rFormula').textContent = formulaText(p, input, r);
    var notes = r.notes.slice();
    if (r.kfs_note) notes.push(r.kfs_note);
    if (isNano && !(Number($('nanoRate').value) || 0)) {
      notes.push('No rate entered yet — open the app, read the Borrower Factsheet, and type the rate above.');
    }
    $('rNotes').innerHTML = notes.map(function (n) {
      return '<p class="note">• ' + esc(n) + '</p>';
    }).join('');
    // Nano guardrail warnings (plain, beside the result).
    var nw = $('nanoWarnings');
    if (isNano && r.guardrails) {
      nw.innerHTML = r.guardrails.ok
        ? '<p class="okbox">✓ Within the SECP guardrails (as published — whether they survived the Nov 2025 amendments is unconfirmed).</p>'
        : '<div class="warn"><strong>⚠ This would breach the SECP guardrails:</strong><ul>' +
          r.guardrails.violations.map(function (v) { return '<li>' + esc(v) + '</li>'; }).join('') +
          '</ul></div>';
    } else if (isNano) {
      nw.innerHTML = '';
    }
  }

  function refreshPresetUI() {
    var p = preset;
    if (!p) return;
    var presetChanged = p.id !== lastPresetId;
    lastPresetId = p.id;
    renderPolicy();
    var needsCycles = p.id === 'easycash-app' || p.id === 'easycash-ussd';
    $('cyclesWrap').hidden = !needsCycles;
    var hasTerms = p.term_options && p.term_options.length > 1;
    $('termWrap').hidden = !hasTerms;
    if (hasTerms) {
      var termChecked = document.querySelector('input[name="termOpt"]:checked');
      var termIdx = termChecked ? (Number(termChecked.value) || 0) : 0;
      if (termIdx >= p.term_options.length) termIdx = 0;
      $('termOptions').innerHTML = p.term_options.map(function (o, i) {
        var pct = o.fee_pct != null ? o.fee_pct : (o.markup_pct != null ? o.markup_pct : 0);
        return '<label><input type="radio" name="termOpt" value="' + i + '"' + (i === termIdx ? ' checked' : '') +
          '> ' + esc(o.label) + ' — ' + pct + '%' +
          (o.instalments ? ' (' + o.instalments + ' instalment' + (o.instalments > 1 ? 's' : '') + ')' : '') + '</label>';
      }).join('');
    }
    var rateOpts = p.rate_options || p.spread_options || null;
    var hasRateOpts = rateOpts && rateOpts.length > 1;
    $('rateOptionsWrap').hidden = !hasRateOpts;
    if (hasRateOpts) {
      var rateChecked = document.querySelector('input[name="rateOpt"]:checked');
      var rateIdx = rateChecked ? (Number(rateChecked.value) || 0) : 0;
      if (rateIdx >= rateOpts.length) rateIdx = 0;
      $('rateOptions').innerHTML = rateOpts.map(function (o, i) {
        return '<label><input type="radio" name="rateOpt" value="' + i + '"' + (i === rateIdx ? ' checked' : '') +
          '> ' + esc(o.label) + '</label>';
      }).join('');
    }
    var selOpt = null;
    var rchecked = document.querySelector('input[name="rateOpt"]:checked');
    if (rchecked) selOpt = (p.rate_options || p.spread_options || [])[Number(rchecked.value) || 0] || null;
    var maxAmt = p.max_amount || 0;
    if (selOpt && selOpt.max_amount) maxAmt = selOpt.max_amount;
    $('amountHint').textContent = 'Loan range for this preset: Rs ' +
      (p.min_amount || 1).toLocaleString('en-PK') + ' – Rs ' +
      maxAmt.toLocaleString('en-PK') + '.';
    var emiLike = p.model === 'annual-reducing' || p.model === 'kibor-spread' || p.model === 'annual-flat';
    var optFixesTerm = selOpt && selOpt.months != null;
    var hasTerms2 = emiLike && p.term_months_options && p.term_months_options.length > 1 && !optFixesTerm;
    $('termMonthsWrap').hidden = !hasTerms2;
    if (hasTerms2) {
      var cur = $('termMonths').value;
      $('termMonths').innerHTML = p.term_months_options.map(function (m) {
        return '<option value="' + m + '"' + (Number(cur) === m || (!cur && m === p.term_months_default) ? ' selected' : '') +
          '>' + m + ' months' + (m === 12 ? ' (1 year)' : m % 12 === 0 ? ' (' + (m / 12) + ' years)' : '') + '</option>';
      }).join('');
    }
    var isKibor = p.model === 'kibor-spread';
    $('kiborWrap').hidden = !isKibor;
    if (isKibor) {
      if (presetChanged || !$('kiborRate').value) $('kiborRate').value = p.kibor_default != null ? p.kibor_default : 12.8;
      var spreadEditable = p.spread_editable || false;
      var spreadFixed = rateOpts && rateOpts.length > 0;
      $('spreadPctWrap').hidden = !spreadEditable;
      $('spreadFixedWrap').hidden = spreadEditable || !spreadFixed;
      if (spreadEditable && (presetChanged || !$('spreadPct').value)) {
        $('spreadPct').value = p.spread_pct != null ? p.spread_pct : '';
      }
      $('kiborHint').textContent = spreadEditable
        ? 'Your spread is set by the bank per customer. Type the spread from your Key Fact Statement (leave 0 and the rate shown is KIBOR only).'
        : 'KIBOR changes daily — check today\'s rate. The spread is fixed for this preset.';
    }
    var rateEditable = (p.model === 'annual-reducing') && p.rate_editable && !hasRateOpts;
    $('rateWrap').hidden = !rateEditable;
    if (rateEditable) {
      if (presetChanged || !$('annualRatePct').value) $('annualRatePct').value = p.annual_rate_pct;
      $('rateHint').textContent = 'Published range: ' + (p.annual_rate_min != null ? p.annual_rate_min + '% – ' + p.annual_rate_max + '%' : 'up to ' + p.annual_rate_max + '%') +
        ' a year. The calculator uses ' + p.annual_rate_pct + '% — type your exact rate if the bank quoted one.';
    }
    if (emiLike && presetChanged) {
      var months = 12;
      if (selOpt && selOpt.months != null) months = selOpt.months;
      else if (p.term_months_default != null) months = p.term_months_default;
      else if (p.term_months_options && p.term_months_options.length) months = p.term_months_options[0];
      var b = $('borrowDate').value || todayISO(0);
      $('repayDate').value = addDaysISO(b, months * 30);
    }
    // Custom / KFS / nano wraps.
    var isCustom = p.id === 'custom';
    $('customWrap').hidden = !isCustom;
    if (isCustom) refreshCustomVisibility();
    var isRor = p.model === 'rate-on-request';
    $('kfsWrap').hidden = !isRor;
    if (isRor) {
      $('nbpWrap').hidden = p.id !== 'nbp-advance-salary';
      refreshKfsVisibility();
    }
    $('nanoWrap').hidden = !isNano;
    render();
  }

  function refreshCustomVisibility() {
    var fk = $('feeKind').value;
    $('rateCell').hidden = fk === 'flat-fee';
    $('feeRsWrap').hidden = fk !== 'flat-fee';
    $('downWrap').hidden = fk !== 'price-markup';
    $('ratePctLabel').textContent = fk === 'price-markup' ? 'Markup (%)' :
      fk === 'annual-emi' ? 'Rate (% per year)' :
      fk === 'weekly-simple' || fk === 'weekly-compound' ? 'Rate (% per week)' :
      fk === 'monthly-simple' ? 'Rate (% per month)' : 'Rate (%)';
    var lk = $('lateKind').value;
    $('lateWrap').hidden = lk === 'none';
    $('latePctCell').hidden = lk === 'flat-rs';
    $('lateFlatCell').hidden = lk !== 'flat-rs';
    $('latePctLabel').textContent = lk === 'weekly-pct' ? 'Late fee (% per week)' : 'Late fee (%)';
    $('lateCapWrap').hidden = lk !== 'per-instalment-pct';
    $('capValWrap').hidden = $('capKind').value === 'none';
    $('capHint').textContent = $('capKind').value === 'pct'
      ? 'Enter the cap as a % of the loan (e.g. 40).'
      : 'Enter the cap in rupees (e.g. 5000).';
  }

  function refreshKfsVisibility() {
    var lk = $('kfsLateKind').value;
    $('kfsLateWrap').hidden = lk === 'none';
    $('kfsLateValueLabel').textContent = lk === 'flat-rs' ? 'Late fee (Rs)' : 'Late fee (%)';
    $('kfsCapValWrap').hidden = $('kfsCapKind').value === 'none';
  }

  function init() {
    if (!$('borrowDate').value) $('borrowDate').value = todayISO(0);
    if (!$('repayDate').value) $('repayDate').value = todayISO(30);
    fetch('/api/presets').then(function (r) { return r.json(); }).then(function (d) {
      presets = d.presets || [];
      nanoApps = d.nano_apps || [];
      nanoData = d;
      presets.forEach(function (p) { presetById[p.id] = p; });
      var pid = param('preset');
      var nano = param('nano');
      if (nano) {
        isNano = true;
        nanoApp = nanoApps.filter(function (a) { return a.app === nano; })[0] || null;
        if (!nanoApp) {
          $('policyName').textContent = 'Unknown nano app';
          $('policySub').innerHTML = 'That app is not on the SECP whitelist in our list. <a href="/">Pick a loan from the home page.</a>';
          $('calcForm').hidden = true;
          return;
        }
        preset = {
          id: 'nano-' + nanoApp.app, name: nanoApp.app, name_ur: '',
          lender: nanoApp.nbfc + ' (licensed NBFC)',
          model: 'custom', verified: true,
          rate_line: 'Rate shown only in the app (Borrower Factsheet) — no public rate.',
          eligibility: 'Licensed nano app (SECP whitelist, 29 Sep 2026). Terms shown in-app only.',
          early: 'Per the app\'s Borrower Factsheet.',
          source: 'SECP whitelist of licensed digital lending apps (29 Sep 2026)',
          source_url: '',
          as_of: '29 Sep 2026',
          min_amount: 1, max_amount: 25000,
          late_fee: { kind: 'unverified' },
        };
      } else if (pid && presetById[pid]) {
        preset = presetById[pid];
      } else {
        $('policyName').textContent = 'No loan selected';
        $('policySub').innerHTML = '<a href="/">Pick a loan from the home page.</a>';
        $('calcForm').hidden = true;
        return;
      }
      document.title = preset.name + ' — Loan Payback Calculator';
      // NBP conflict chips: fill the KFS rate from the figure the user picks.
      Array.prototype.forEach.call(document.querySelectorAll('[data-nbp-rate]'), function (btn) {
        btn.addEventListener('click', function () {
          var v = btn.getAttribute('data-nbp-rate');
          if (v === 'kibor') {
            $('nbpHint').textContent = 'KIBOR + 9–12%: type today\'s 1-year KIBOR (about 12.8%) plus the spread your Key Fact Statement quotes — e.g. 12.8 + 9 = 21.8%.';
            $('kfsRate').value = '';
          } else {
            $('nbpHint').textContent = '';
            $('kfsRate').value = v;
          }
          refreshKfsVisibility();
          render();
        });
      });
      var form = $('calcForm');
      form.addEventListener('submit', function (e) { e.preventDefault(); refreshPresetUI(); });
      form.addEventListener('input', function () { refreshPresetUI(); });
      form.addEventListener('change', function () { refreshPresetUI(); });
      refreshPresetUI();
    }).catch(function () {
      $('policyName').textContent = 'Could not load the loan list';
      $('policySub').textContent = 'Please reload the page.';
      $('calcForm').hidden = true;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
