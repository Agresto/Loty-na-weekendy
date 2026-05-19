#!/usr/bin/env node
/**
 * server.js — Serwer deweloperski Loty na Weekend
 *
 * Uruchomienie:  node server.js
 * Zatrzymanie:   Ctrl+C
 *
 * Endpointy:
 *   GET  /                       → index.html
 *   GET  /flights.json           → aktualna baza lotów
 *   POST /api/refresh            → uruchamia refresh-flights.js
 *   GET  /api/refresh/status     → status i log aktualnego zadania
 *   POST /api/refresh/stop       → anuluje zadanie
 */

'use strict';

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { spawn } = require('child_process');

const PORT = 3000;
const ROOT = __dirname;

// ── MIME types ────────────────────────────────────────────────────────────────
const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.ico':   'image/x-icon',
  '.svg':   'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.txt':   'text/plain; charset=utf-8',
};

// ── Stan zadania odświeżania ──────────────────────────────────────────────────
const job = {
  status:     'idle',   // 'idle' | 'running' | 'done' | 'error'
  startedAt:  null,
  finishedAt: null,
  exitCode:   null,
  log:        [],
};
let child = null;

// ── Pomocnicze ────────────────────────────────────────────────────────────────
function jsonResp(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function pushLog(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  job.log.push(trimmed);
  if (job.log.length > 300) job.log.shift();
}

function serveStatic(res, urlPath) {
  // Security: block path traversal
  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  const rel = path.relative(ROOT, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  let data;
  try { data = fs.readFileSync(filePath); } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end(`Not found: ${urlPath}`);
  }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
  res.end(data);
}

// ── Serwer HTTP ───────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // ── POST /api/refresh — uruchamia scraper ───────────────────────────────────
  if (pathname === '/api/refresh' && req.method === 'POST') {
    if (job.status === 'running') {
      return jsonResp(res, 200, { status: 'already-running', startedAt: job.startedAt });
    }

    job.status     = 'running';
    job.startedAt  = new Date().toISOString();
    job.finishedAt = null;
    job.exitCode   = null;
    job.log        = ['[server] Uruchamianie scrapera…'];

    child = spawn('node', ['refresh-flights.js'], {
      cwd: ROOT,
      env: { ...process.env },
    });

    child.stdout.on('data', d => d.toString().split('\n').forEach(pushLog));
    child.stderr.on('data', d => d.toString().split('\n').forEach(l => l.trim() && pushLog('[błąd] ' + l)));

    child.on('close', code => {
      job.status     = code === 0 ? 'done' : 'error';
      job.finishedAt = new Date().toISOString();
      job.exitCode   = code;
      pushLog(code === 0 ? '[server] ✅ Zakończono pomyślnie' : `[server] ❌ Błąd (kod ${code})`);
      child = null;
    });

    return jsonResp(res, 200, { status: 'started' });
  }

  // ── GET /api/refresh/status — stan zadania + ostatnie 60 linii logu ─────────
  if (pathname === '/api/refresh/status' && req.method === 'GET') {
    return jsonResp(res, 200, {
      status:     job.status,
      startedAt:  job.startedAt,
      finishedAt: job.finishedAt,
      exitCode:   job.exitCode,
      log:        job.log.slice(-60),
    });
  }

  // ── POST /api/refresh/stop — anuluje zadanie ────────────────────────────────
  if (pathname === '/api/refresh/stop' && req.method === 'POST') {
    if (child) {
      child.kill('SIGTERM');
      job.status = 'idle';
      pushLog('[server] Zatrzymano przez użytkownika');
      child = null;
    }
    return jsonResp(res, 200, { status: 'stopped' });
  }

  // ── Pliki statyczne ─────────────────────────────────────────────────────────
  serveStatic(res, pathname);
});

server.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log(`║  🚀  Loty na Weekend  →  http://localhost:${PORT}  ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Przycisk "🔄 Odśwież" uruchamia scraper    ║');
  console.log('║  Ctrl+C — zatrzymuje serwer                  ║');
  console.log('╚══════════════════════════════════════════════╝\n');
});
