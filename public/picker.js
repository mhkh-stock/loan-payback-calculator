// Loan Payback Calculator — picker (home page). Renders every loan as a card
// grouped by category, with a search box and category filter chips. Clicking
// a card opens that loan's calculator (calculator.html?preset=<id>); nano apps
// open the nano flow (calculator.html?nano=<app>). Nothing entered here is
// sent anywhere.
'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var CATEGORY_ORDER = ['Wallet loans', 'Buy Now Pay Later', 'Microfinance banks',
    'Bank personal loans', 'Islamic financing', 'Card instalments',
    'Government & welfare schemes', 'Salary advance (EWA)', 'Rate on request'];
  var presets = [];
  var nanoApps = [];
  var activeCat = 'All';
  var query = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtRs(n) { return 'Rs ' + Number(n).toLocaleString('en-PK'); }

  function badge(p) {
    if (p.model === 'rate-on-request') return '<span class="badge badge-ror">Rate on request</span>';
    if (!p.verified) return '<span class="badge badge-unverified">Not re-verified</span>';
    return '<span class="badge badge-verified">✓ Verified</span>';
  }
  function tenureLine(p) {
    if (p.term_months_options && p.term_months_options.length) {
      var min = Math.min.apply(null, p.term_months_options);
      var max = Math.max.apply(null, p.term_months_options);
      return min === max ? (min + (min === 1 ? ' month' : ' months')) : (min + '–' + max + ' months');
    }
    if (p.term_options && p.term_options.length) {
      return p.term_options.map(function (o) { return o.label; }).join(' / ');
    }
    if (p.due_days) return p.due_days + ' days';
    return '';
  }
  function cardHtml(p) {
    var href = '/calculator.html?preset=' + encodeURIComponent(p.id);
    return '<a class="loan-card" href="' + href + '">' +
      '<div class="lc-name">' + esc(p.name) + ' ' + badge(p) + '<br><span class="ur">' + esc(p.name_ur || '') + '</span></div>' +
      '<div class="lc-lender">' + esc(p.lender) + '</div>' +
      '<div class="lc-rate">' + esc(p.rate_line) + '</div>' +
      '<div class="lc-meta">' + fmtRs(p.min_amount || 1) + ' – ' + fmtRs(p.max_amount || 0) +
      (tenureLine(p) ? ' · ' + esc(tenureLine(p)) : '') + '</div>' +
      '</a>';
  }
  function matches(p) {
    if (activeCat !== 'All' && p.category !== activeCat) return false;
    if (!query) return true;
    var hay = (p.name + ' ' + (p.name_ur || '') + ' ' + p.lender + ' ' + p.category + ' ' + p.rate_line).toLowerCase();
    return hay.indexOf(query) !== -1;
  }

  function render() {
    var picker = $('picker');
    var cats = CATEGORY_ORDER.filter(function (c) {
      return presets.some(function (p) { return p.category === c && matches(p); });
    });
    if (!cats.length) {
      picker.innerHTML = '<p class="empty-note">No loan matches that search. Try another name — or pick Custom loan below.</p>';
      return;
    }
    var html = '';
    cats.forEach(function (c) {
      var list = presets.filter(function (p) { return p.category === c && matches(p); });
      if (!list.length) return;
      html += '<h2 class="cat-title">' + esc(c) + ' <span class="cat-count">(' + list.length + ')</span></h2>' +
        '<div class="loan-grid">' + list.map(cardHtml).join('') + '</div>';
    });
    // Custom loan always at the end (unless filtered out by search).
    if (activeCat === 'All' || query === '') {
      var custom = presets.filter(function (p) { return p.id === 'custom'; })[0];
      if (custom && matches(custom)) {
        html += '<h2 class="cat-title">Your own numbers</h2><div class="loan-grid">' + cardHtml(custom) + '</div>';
      }
    }
    picker.innerHTML = html;
  }

  function renderChips() {
    var cats = ['All'].concat(CATEGORY_ORDER.filter(function (c) {
      return presets.some(function (p) { return p.category === c; });
    }));
    $('chips').innerHTML = cats.map(function (c) {
      return '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === activeCat) + '">' + esc(c) + '</button>';
    }).join('');
    Array.prototype.forEach.call($('chips').querySelectorAll('.chip'), function (btn) {
      btn.addEventListener('click', function () {
        activeCat = btn.getAttribute('data-cat');
        renderChips();
        render();
      });
    });
  }

  function renderNano(d) {
    var b = d.benchmarks || {};
    var bench = $('benchmarks');
    if (bench && b.sbp_policy_rate_pct != null) {
      bench.textContent = 'SBP policy rate ' + b.sbp_policy_rate_pct + '% (from ' + b.sbp_policy_as_of +
        ') · 1-year KIBOR ≈' + b.kibor_1y_pct + '% (' + b.kibor_1y_as_of +
        ') · Next SBP meeting: ' + b.next_mpc + '. KIBOR changes daily — check today\'s rate.';
    }
    var grid = $('nanoApps');
    if (grid && nanoApps.length) {
      grid.innerHTML = nanoApps.map(function (a) {
        return '<a class="loan-card" href="/calculator.html?nano=' + encodeURIComponent(a.app) + '">' +
          '<div class="lc-name">' + esc(a.app) + ' <span class="badge badge-verified">Licensed</span></div>' +
          '<div class="lc-lender">' + esc(a.nbfc) + '</div>' +
          '<div class="lc-tag">Terms shown in-app only (Borrower Factsheet) — no public rate.</div>' +
          '</a>';
      }).join('');
    }
    var g = d.nano_guardrails || {};
    var gr = $('nanoGuardrails');
    if (gr && g.max_per_app_rs != null) {
      gr.innerHTML = '<div class="guard-box"><strong>SECP guardrails for nano loans:</strong><ul>' +
        '<li>At most Rs ' + g.max_per_app_rs.toLocaleString('en-PK') + ' per app and Rs ' + g.max_total_rs.toLocaleString('en-PK') + ' across all apps</li>' +
        '<li>Tenure at most ' + g.max_tenure_days + ' days (max ' + g.max_rollovers + ' rollovers)</li>' +
        '<li>' + esc(g.total_cost_cap) + '</li>' +
        '<li>' + esc(g.apr_cap_note) + '</li>' +
        '<li>No compounding, no upfront fee deduction, ' + g.cooling_off_hours + '-hour cooling-off</li>' +
        '</ul><p class="small">' + esc(g.note) + '</p></div>';
    }
    var av = $('nanoAvoid');
    if (av && d.nano_avoid) av.innerHTML = '<div class="warn"><strong>Avoid:</strong> ' + esc(d.nano_avoid) + '</div>';
  }

  fetch('/api/presets').then(function (r) { return r.json(); }).then(function (d) {
    presets = d.presets || [];
    nanoApps = d.nano_apps || [];
    renderChips();
    render();
    renderNano(d);
  }).catch(function () {
    $('picker').innerHTML = '<p class="empty-note">Could not load the loan list — please reload the page.</p>';
  });

  $('search').addEventListener('input', function (e) {
    query = (e.target.value || '').trim().toLowerCase();
    render();
  });
})();
