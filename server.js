// Loan Payback Calculator (قرض واپسی کیلکولیٹر) — what a loan from a Pakistani
// app really costs: the increase and the late fee as days pass.
// Node.js 24+, native node:http + node:sqlite only. No external dependencies.
// Port 3035. Data: data/loan.sqlite (presets table, seeded from presets.json).
// No accounts, no login, no admin panel, no personal data collected — the
// calculation runs in the visitor's browser (public/calc.js); the server only
// serves the pages and the preset list.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3035);
// Deploy-only writable-location fallback (FoodScope pattern, no behaviour
// change on a normal PC): on a local run __dirname is writable, so the
// default data/loan.sqlite below is used exactly as before. Only when the
// app directory cannot be written (e.g. SnapDeploy's read-only /app) does
// the database move to a writable temp directory. The DB is only a presets
// cache re-seeded from presets.json on every start, so a fresh temp copy
// is harmless. An explicit DB_FILE always wins over both locations.
function writableBase(appDir) {
  try { fs.accessSync(appDir, fs.constants.W_OK); return appDir; }
  catch { return path.join(os.tmpdir(), 'loan-payback-calculator'); }
}
function resolveDbFile(appDir, envDbFile) {
  if (envDbFile) return envDbFile;
  const base = writableBase(appDir);
  return base === appDir
    ? path.join(appDir, 'data', 'loan.sqlite')
    : path.join(base, 'loan.sqlite');
}
const DB_FILE = resolveDbFile(__dirname, process.env.DB_FILE);
if (!process.env.DB_FILE && DB_FILE !== path.join(__dirname, 'data', 'loan.sqlite')) {
  console.log('Loan DB directory (read-only app dir fallback):', path.dirname(DB_FILE));
}
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_ur TEXT NOT NULL,
  lender TEXT NOT NULL, rate_line TEXT NOT NULL, source TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '', as_of TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL
);
`);

// ---- seed: presets.json is the single source of truth ----
const presetFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'presets.json'), 'utf8'));
const upPreset = db.prepare(`INSERT OR REPLACE INTO presets
  (id, name, name_ur, lender, rate_line, source, source_url, as_of, verified, body)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
for (const p of presetFile.presets) {
  upPreset.run(p.id, p.name, p.name_ur, p.lender, p.rate_line, p.source,
    p.source_url || '', p.as_of || '', p.verified ? 1 : 0, JSON.stringify(p));
}
function presets() {
  return db.prepare('SELECT body FROM presets ORDER BY rowid').all().map((r) => JSON.parse(r.body));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};
function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function serveFile(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
  }
  send(res, 200, MIME[path.extname(full)] || 'application/octet-stream', fs.readFileSync(full));
}

const server = http.createServer((req, res) => {
  try {
    handle(req, res);
  } catch (e) {
    // Never let one bad request kill the process: answer 500 and stay up.
    try { send(res, 500, 'text/plain; charset=utf-8', 'Server error'); } catch {}
  }
});

function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  if (req.method === 'GET' && p === '/health') {
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true }));
  }
  if (req.method === 'GET' && p === '/api/presets') {
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({
      presets: presets(), as_of: presetFile.as_of, note: presetFile.note,
      benchmarks: presetFile.benchmarks || null,
      nano_apps: presetFile.nano_apps || [],
      nano_guardrails: presetFile.nano_guardrails || null,
      nano_avoid: presetFile.nano_avoid || '',
    }));
  }
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, 'index.html');
  if (req.method === 'GET' && p === '/how.html') return serveFile(res, 'how.html');
  if (req.method === 'GET' && p === '/sources.html') return serveFile(res, 'sources.html');
  if (req.method === 'GET' && p === '/calculator.html') return serveFile(res, 'calculator.html');
  if (req.method === 'GET' && (p === '/styles.css' || p === '/calc.js' || p === '/nav.js' || p === '/picker.js' || p === '/manual.js' || p === '/calcpage.js' || p === '/favicon.ico')) {
    return serveFile(res, p.slice(1));
  }
  return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
}

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('Loan Payback Calculator listening on :' + PORT);
  });
}

module.exports = { resolveDbFile, writableBase };
