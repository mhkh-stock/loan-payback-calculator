// Manual loan calculator (home page) — "Calculate any loan yourself".
// The visitor enters everything: amount, rate, how it is charged, tenure,
// late fee, fee cap and an optional early-repayment note. Maths is shared
// with the presets through LoanCalc.manualInput + LoanCalc.compute
// (public/calc.js); nothing entered here is sent anywhere.
'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return 'Rs ' + Number(n).toLocaleString('en-PK'); };

  function todayISO() {
    var d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function readForm() {
    var mode = $('mMode').value;
    var instalments = 1;
    if (!$('mDownWrap').hidden) instalments = Number($('mInstalments').value) || 1;
    else if (!$('mInstWrap2').hidden) instalments = Number($('mInstalments2').value) || 1;
    return {
      amount: Number($('mAmount').value) || 0,
      rate: Number($('mRate').value) || 0,
      mode: mode,
      tenure_value: Number($('mTenureValue').value) || 30,
      tenure_unit: $('mTenureUnit').value,
      down_pct: Number($('mDownPct').value) || 0,
      instalments: instalments,
      fee_rs: Number($('mFeeRs').value) || 0,
      late_kind: $('mLateKind').value,
      late_value: Number($('mLateValue').value) || 0,
      late_cap_rs: Number($('mLateCapRs').value) || 0,
      grace_days: Number($('mGraceDays').value) || 0,
      cap_kind: $('mCapKind').value,
      cap_value: Number($('mCapValue').value) || 0,
      early_note: $('mEarlyNote').value,
      borrow_date: $('mBorrowDate').value,
    };
  }

  function formulaText(form, r) {
    var P = form.amount;
    var line = '';
    if (form.mode === 'weekly-simple') {
      line = 'Fee = loan × ' + form.rate + '% × weeks (simple, not compounded). Rs ' +
        P.toLocaleString('en-PK') + ' × ' + form.rate + '% × ' + (r.days / 7).toFixed(1) +
        ' weeks = Rs ' + r.markup.toLocaleString('en-PK') + '.';
    } else if (form.mode === 'weekly-compound') {
      line = 'Fee compounds every 7 days: each week the fee is charged on the loan plus the fee so far. Rs ' +
        P.toLocaleString('en-PK') + ' for ' + r.days + ' days → fee Rs ' + r.markup.toLocaleString('en-PK') + '.';
    } else if (form.mode === 'monthly-simple') {
      line = 'Fee = loan × ' + form.rate + '% × months (simple). Rs ' +
        P.toLocaleString('en-PK') + ' × ' + form.rate + '% × ' + (r.days / 30).toFixed(1) +
        ' months = Rs ' + r.markup.toLocaleString('en-PK') + '.';
    } else if (form.mode === 'flat-term') {
      line = 'Flat fee ' + form.rate + '% of the loan = Rs ' + r.markup.toLocaleString('en-PK') + '.';
      if (r.instalment != null) {
        line += ' Paid in ' + (form.instalments || 1) + ' instalment' + ((form.instalments || 1) > 1 ? 's' : '') +
          ' of Rs ' + r.instalment.toLocaleString('en-PK') + ' each.';
      }
    } else if (form.mode === 'annual-emi') {
      line = 'Monthly instalment (EMI) = loan × r × (1+r)^n ÷ ((1+r)^n − 1), where r is the monthly rate and n is ' +
        r.due_days / 30 + ' months. Rate ' + form.rate + '% a year → instalment Rs ' +
        (r.instalment != null ? r.instalment.toLocaleString('en-PK') : '—') +
        ', total interest Rs ' + r.markup.toLocaleString('en-PK') + '.';
    } else if (form.mode === 'price-markup') {
      line = 'Down payment Rs ' + (r.down_payment != null ? r.down_payment.toLocaleString('en-PK') : '—') +
        ', financed Rs ' + (r.financed_amount != null ? r.financed_amount.toLocaleString('en-PK') : '—') +
        ' plus ' + form.rate + '% profit = Rs ' + r.markup.toLocaleString('en-PK') +
        '. ' + (form.instalments || 1) + ' instalments of Rs ' +
        (r.instalment != null ? r.instalment.toLocaleString('en-PK') : '—') + ' each.';
    } else if (form.mode === 'flat-fee') {
      line = 'Flat fee Rs ' + (form.fee_rs || 0).toLocaleString('en-PK') +
        ' per drawdown, repaid from your next salary. Rs ' +
        P.toLocaleString('en-PK') + ' → Rs ' + r.total.toLocaleString('en-PK') + '.';
    }
    if (r.late_fee > 0) line += ' Late fee Rs ' + r.late_fee.toLocaleString('en-PK') + '.';
    if (r.cap_hit) line += ' The fee cap stopped the fee growing further.';
    return line;
  }

  function render() {
    var form = readForm();
    var input = LoanCalc.manualInput(form);
    var r = LoanCalc.compute({ id: 'custom' }, input);
    var res = $('mResults');
    var err = $('mError');
    if (r.error) {
      res.classList.remove('show');
      if (err) { err.textContent = r.error; err.hidden = false; }
      return;
    }
    if (err) err.hidden = true;
    res.classList.add('show');
    $('mrDate').textContent = r.repay_date;
    $('mrTotal').textContent = fmt(r.total);
    $('mrPrincipal').textContent = fmt(r.principal);
    $('mrMarkup').textContent = fmt(r.markup);
    $('mrLate').textContent = fmt(r.late_fee);
    $('mrCost').textContent = '+' + fmt(r.cost) + ' (' + r.cost_pct + '%)';
    $('mrDue').textContent = r.due_date + ' (' + r.due_days + ' days)';
    $('mrInstRow').hidden = r.instalment == null;
    if (r.instalment != null) $('mrInst').textContent = fmt(r.instalment);
    $('mrDownRow').hidden = r.down_payment == null;
    if (r.down_payment != null) {
      $('mrDown').textContent = fmt(r.down_payment) + ' down, Rs ' + r.financed_amount.toLocaleString('en-PK') + ' financed';
    }
    $('mrAnnual').textContent = r.annualised_pct != null ? ('~' + r.annualised_pct + '% a year (simple annualisation)') : '—';
    $('mrCapWarn').hidden = !r.cap_hit;
    if (r.cap_hit) $('mrCapWarn').textContent = '⚠ ' + r.cap_note;
    $('mrVerdict').textContent = r.verdict;
    $('mrPlanDate').textContent = r.repay_date;
    function lateCard(prefix, card) {
      $(prefix).textContent = fmt(card.total);
      $(prefix + 'x').textContent = card.extra > 0 ? ('+' + fmt(card.extra) + ' extra') : 'no extra';
      $(prefix + 'd').textContent = card.date;
    }
    lateCard('mrLate1', r.late.plus1);
    lateCard('mrLate7', r.late.plus7);
    lateCard('mrLate30', r.late.plus30);
    $('mrTimeline').innerHTML = r.timeline.map(function (row) {
      return '<tr><td>' + row.date + '</td><td>' + row.day + '</td><td>' + fmt(row.markup) +
        '</td><td>' + fmt(row.late_fee) + '</td><td><strong>' + fmt(row.owed) + '</strong></td></tr>';
    }).join('');
    $('mrFormula').textContent = formulaText(form, r);
    var notes = r.notes.slice();
    if (input.early_note) notes.push('Your early-repayment note: ' + input.early_note + '.');
    $('mrNotes').innerHTML = notes.map(function (n) {
      return '<p class="note">• ' + n + '</p>';
    }).join('');
  }

  function refreshVisibility() {
    var mode = $('mMode').value;
    var isFlatFee = mode === 'flat-fee';
    var isMarkup = mode === 'price-markup';
    var isEmi = mode === 'annual-emi';
    // Rate field: hidden for flat-fee (the fee field replaces it).
    $('mRateCell').hidden = isFlatFee;
    $('mFeeWrap').hidden = !isFlatFee;
    $('mDownWrap').hidden = !isMarkup;
    // Month-based modes use months as the tenure unit.
    if ((isMarkup || isEmi) && $('mTenureUnit').value !== 'months') $('mTenureUnit').value = 'months';
    // Rate label per mode.
    $('mRateLabel').textContent = isMarkup ? 'Markup (%)' : isEmi ? 'Rate (% per year)' :
      mode === 'weekly-simple' || mode === 'weekly-compound' ? 'Rate (% per week)' :
      mode === 'monthly-simple' ? 'Rate (% per month)' : 'Rate (%)';
    // Late fee rows.
    var lk = $('mLateKind').value;
    $('mLateWrap').hidden = lk === 'none';
    $('mLateValueLabel').textContent = lk === 'flat-rs' ? 'Late fee (Rs)' : 'Late fee (%)';
    // Instalments field for "% of each instalment" (price-markup has its own).
    $('mInstWrap2').hidden = lk !== 'per-instalment-pct' || isMarkup;
    // Fee cap rows.
    var ck = $('mCapKind').value;
    $('mCapValWrap').hidden = ck === 'none';
    $('mCapHint').textContent = ck === 'pct'
      ? 'Enter the cap as a % of the loan (e.g. 40).'
      : 'Enter the cap in rupees (e.g. 5000).';
  }

  function init() {
    if (!$('mBorrowDate').value) $('mBorrowDate').value = todayISO();
    var form = $('manualForm');
    form.addEventListener('submit', function (e) { e.preventDefault(); refreshVisibility(); render(); });
    form.addEventListener('input', function () { refreshVisibility(); render(); });
    form.addEventListener('change', function () { refreshVisibility(); render(); });
    refreshVisibility();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
