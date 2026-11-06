# Loan Payback Calculator — قرض واپسی کیلکولیٹر

What a loan from a Pakistani lender really costs: pick the loan, enter the
amount and the dates, and see the total payback, the increase, and the late
fee as days pass — with the formula on screen.

## Live
Not deployed yet (hosting slots are full — 4/4 containers in use). Local:
`node server.js`, then http://127.0.0.1:3035. No install step, no dependencies.

## The idea
No calculator like this exists: generic loan calculators have no Pakistani
wallet-loan presets and no late-fee-over-time view; the lenders' own pages
show static fee tables only. This one has the real rates, the increase, and
the late fee as time passes — for wallet loans, microfinance banks,
commercial banks, Islamic financing, BNPL, card instalments, government
schemes, salary advance, and the 17 SECP-licensed nano apps.

## What it does (v2)
- **Home — loan picker** (`/`): every loan as a card, grouped by category
  (Wallet loans, Buy Now Pay Later, Microfinance banks, Bank personal loans,
  Islamic financing, Card instalments, Government & welfare schemes, Salary
  advance (EWA), Rate on request, plus the 17 licensed nano apps in their own
  section), with a search box and category filter chips. Each card shows the
  lender, amount range, headline rate, tenure, and a one-line policy.
- **Manual loan calculator** (first section on the home page — "Calculate any
  loan yourself"): for visitors who don't see their lender. Enter the amount,
  rate, how it is charged (per week simple/compounded, per month, flat for
  the term, per year reducing balance (EMI), price markup, flat fee), tenure
  (days/weeks/months), late fee (none / % of the loan / % of each instalment /
  flat Rs, with value, grace days and cap), fee cap, and an optional
  early-repayment note. Same results as the per-loan calculators.
- **Per-loan calculator** (`/calculator.html?preset=<id>`): the loan's FULL
  POLICY at the top (rate + how it is charged, tenure/due date, late fee with
  value/grace/cap, early repayment, eligibility, source + as-of date,
  verified/unverified badge), then inputs (amount, dates, cycle count where
  it matters, KIBOR field where it matters — default 12.8%, editable, with
  "KIBOR changes daily — check today's rate"), then results: total to pay
  back, extra money, effective cost %, annualised cost, week-by-week /
  month-by-month timeline, "1 day late / 7 days late / 30 days late" cards,
  cap warning, plain-language verdict line, and the formula on screen.
- **Nano apps** (`/calculator.html?nano=<app>`): the calculator says plainly
  that the rate is only shown inside the app in its Borrower Factsheet and
  asks the user to enter the rate + how often it is charged + the late fee +
  amount + dates. The SECP guardrails sit beside it (max Rs 25,000 per app,
  Rs 75,000 total, tenure ≤ 90 days, total cost ≤ principal, APR ≤ 120%,
  no compounding, no upfront fee deduction, 24-hour cooling-off — with the
  plain caveat that whether these caps survived the Nov 2025 amendments is
  unconfirmed). A rate that would breach a guardrail warns plainly on screen.
- **Rate on request** loans: the policy card says the rate is not published
  and to ask the lender for the Key Fact Statement; the user enters the rate
  from their KFS and the calculator works. Never invents a rate. NBP shows
  the conflict (23.5% permanent vs 25.5% contractual vs KIBOR+9–12%) and
  does not pick one number.
- **How it works** (`/how.html`): every formula in plain words + one worked
  example per preset.
- **Sources** (`/sources.html`): every rate with its source link + as-of date
  + a "What we could not verify" section. Benchmarks shown: SBP policy rate
  12% (27 Oct 2026), 1-year KIBOR ≈12.8% (late Oct 2026), next MPC 14 Dec 2026.
- Design: Code & Chill dark-mode dashboard (the Facebook reel design shared
  2026-11-03) — dark background, blue accents, SOFT TRANSPARENT glass look:
  translucent dark-blue panels (cards rgba(17,28,51,.62), header
  rgba(15,23,42,.65)), backdrop blur 10–18px, diagonal white sheen, inset
  top highlights, light glass edges. Primary buttons stay solid #2563eb where
  a translucent button would hurt readability. Every text colour passes
  WCAG AA (4.5:1) against the surface it sits on — checked in test.js.
  Sticky header with the site title + a designed ⋮ kebab menu holding the
  pages; Back to home on sub-pages. Mobile-first, 44px buttons, 16px font,
  Urdu + English. No accounts, no login, no admin panel. Presets live in
  `presets.json` (source + as-of date) and are seeded into SQLite; the
  calculation runs in the visitor's browser (`public/calc.js`) and nothing is
  stored.

## The maths (public/calc.js — one module, used by the browser AND the tests)
- Easycash App: weekly COMPOUND on the outstanding loan (5% cycles 1–30,
  4.5% 31–60, 4% 61+); a part-week counts daily at rate/7; markup capped at
  40% (8 weeks). No late fee.
- Easycash USSD: flat 20% / 18% / 16% for 30 days by cycle; late fee 5%
  one-off of the loan after 2 days grace.
- Easypaisa BNPL: flat 10% (14d) or 20% (30d) for "Excellent" rating only;
  other ratings 11–17.5% / 22–35%. Late fee 5% one-off from the first day
  past the due date.
- ReadyCash: SIMPLE 5% of the loan per week; due 28d, max 56d, cap 40%.
  No separate late fee — the weekly fee is the cost of being late.
- Daraz PayLater: flat 16% (1mo) or 30% (3mo); late fee per overdue
  instalment = min(5% × instalment, Rs 800).
- JazzCash BNPL: flat 15%, 3 monthly instalments; late fee 10% of each
  overdue instalment.
- Bank personal loans: EMI on the reducing balance (annual-reducing), or
  1-year KIBOR + spread (kibor-spread, KIBOR default 12.8%, editable).
- Islamic: Meezan Personal Finance is a fixed sale price (annual-flat,
  16.55% a year, late payment to charity not bank income).
- BNPL: price markup on the financed amount after the down payment
  (QistBazaar +8% 3mo / +18% 6mo / +28% 9mo / +37% 12mo).
- Salary advance (EWA): one flat fee per drawdown (Abhi Rs 100–150, fee
  unverified).
- Custom / manual / KFS / nano: flat % / % per week simple / % per week
  compound / % per month simple / % per year reducing balance (EMI) /
  price markup / flat fee, own late-fee type (none / % of the loan /
  % of each instalment / % per week late / flat Rs), grace days, and cap.

## Verified examples (all in test.js)
- Easypaisa: Rs 20,000 at flat 32% → Rs 26,400 (Play Store example).
- Easycash App: Rs 10,000 × 4 weeks at 5% compounded → Rs 12,155.
- ReadyCash: Rs 5,000 × 1 week → Rs 5,250; Rs 100 → 105/110/115/120.
- Daraz: Rs 20,000 on 3 months → Rs 26,000, instalment Rs 8,667, one late
  instalment → Rs 433 (under the Rs 800 cap).
- EMI: Rs 100,000 at 12% × 12 months → instalment Rs 8,885, total Rs 106,619.
- Manual: Rs 10,000 at 5%/week simple × 2 weeks → Rs 11,000; compounded →
  Rs 11,025; price markup Rs 100,000, 30% down, 8%, 3 instalments → Rs 105,600.

## Honest limits
- Rates change every quarter (Easypaisa's schedule is Oct–Dec 2026). Every
  preset shows its source + as-of date.
- These loans are expensive (PACRA put the annualised yield on Easypaisa's
  loan book at ~139% in 2025 — that figure itself is unverified in the app).
  The calculator shows the true cost plainly.
- It is an ESTIMATE from the published rates, not the lender's final word.
- 17 presets are "rate on request" — the lender publishes no rate, so the
  calculator never invents one; the user enters the rate from their Key Fact
  Statement. JazzCash BNPL and the Abhi fee were not independently
  re-verified against a live source — the app says so on screen.
- Whether the SECP nano guardrails survived the Nov 2025 amendments
  (SRO 2120(I)/2025) is unconfirmed — the app says so next to the guardrails.

## Files
- `server.js` — native http + sqlite, port 3035 (`/health`, `/api/presets`,
  static pages; the DB file is never served).
- `presets.json` — the 48 presets + 17 nano apps + benchmarks + guardrails,
  single source of truth.
- `public/calc.js` — shared calculator maths (browser + tests).
- `public/index.html` — home: manual calculator + loan picker.
- `public/calculator.html` — per-loan calculator (policy + inputs + results).
- `public/how.html`, `public/sources.html` — the pages.
- `public/picker.js`, `public/manual.js`, `public/calcpage.js` — browser wiring.
- `public/nav.js`, `public/styles.css` — kebab menu + glass theme.
- `test.js` — 106 checks, `node test.js` → ALL TESTS PASSED.

## Research
`~/workspace/new-projects/p6-loan-calculator-research.md` — the verified rate
table with a source + as-of date for every number, and what could not be
re-verified. Full catalogue:
`~/workspace/research_notes/pakistan-loan-providers-policies-20261106-0912/report.md`.
