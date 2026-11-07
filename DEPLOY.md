# Deploy — Loan Payback Calculator

Deploy-ready (final review 6 Nov 2026: full test suite green, smoke green,
no secrets, no database file to ship). The app is a static calculator: it
stores nothing about the visitor, has no accounts, no login, no admin
panel, and no third-party requests.

## What you need
- This repo on GitHub: https://github.com/mhkh-stock/loan-payback-calculator
- A SnapDeploy account (sign in with "Continue with GitHub") and one free
  container slot (the free tier allows 4 containers and 5 deploys per
  12-hour window — check the dashboard before pushing, the budget is rolling).

## Steps (SnapDeploy)
1. SnapDeploy dashboard → **New Container** (or "Create app").
2. Connect the repo `mhkh-stock/loan-payback-calculator` (branch `main`).
3. Runtime: **Node 24** (the app needs Node 24+ for `node:sqlite`; no
   `npm install` — there are zero dependencies and no `package.json`
   scripts to run).
4. Start command: `node server.js`
5. Port: **3035** (the server binds `0.0.0.0` and reads `PORT` from the
   environment if the platform sets one).
6. No environment variables are required. Optional: `DB_FILE` to move the
   SQLite file (default `data/loan.sqlite`, created on first run). If the
   app directory is read-only, the database automatically falls back to
   `/tmp/loan-payback-calculator/loan.sqlite` (re-seeded from
   `presets.json` on every start, so nothing is lost).
7. Deploy. SnapDeploy auto-deploys on every GitHub push after the first one.

## After deploy — check it works
- Open the site URL. The home page (loan picker + manual calculator)
  must load.
- `GET /health` must return `{"ok":true}`.
- `GET /api/presets` must return 51 presets.
- Spot-check one calculation: Easypaisa Easycash app, Rs 10,000, 4 weeks
  → total **Rs 12,155**. ReadyCash, Rs 20,000, 28 days → **Rs 24,000**.
- If the first open shows SnapDeploy's "Waking up your container..." page,
  wait a moment and reload — free containers sleep after ~15 minutes idle.

## Notes
- The SQLite file (`data/loan.sqlite`) is created on the container at
  first start and seeded from `presets.json` — do NOT upload a local
  database file; it is gitignored on purpose.
- The app serves only files under `public/` plus `/health` and
  `/api/presets`. Nothing else is reachable (`/data/loan.sqlite`,
  `/presets.json`, `/README.md` all return 404).
- Rates change every quarter (Easypaisa's schedule is Oct–Dec 2026).
  Update `presets.json`, run `node test.js` (must print ALL TESTS PASSED),
  then push — the container redeploys automatically.
