#!/usr/bin/env node
/**
 * refresh-flights.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pobiera prawdziwe ceny lotów z Ryanair API + Wizzair (przez Playwright).
 *
 * Strategia Wizzair:
 *   • Playwright → Wizzair farechart API (omija Kasada/Cloudflare WAF)
 *   • Jeśli Playwright niedostępny → generator statyczny + ikona ⚡
 *
 * Ryanair: roundTripFares API (bez blokad, publiczne)
 * Wizzair: farechart API przez headless Chromium (ominięcie Kasada)
 *
 * Uruchomienie:
 *   npm install playwright
 *   npx playwright install chromium
 *   node refresh-flights.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';
const fs   = require('fs');
const path = require('path');
const { generateFlights, ROUTES, DESTS, ORIGINS } = require('./generate-flights.js');

// ─── konfiguracja ─────────────────────────────────────────────────────────────
const MAX_BUDGET_RT       = 800;
const MONTHS_AHEAD        = 6;
const MAX_RETRY           = 2;
const TIMEOUT_MS          = 20000;
const WIZZAIR_API_VERSION = '28.9.0'; // Aktualna wersja API Wizzair (auto-wykrywana)
const FARECHART_INTERVAL  = 10;       // Pokrycie każdego zapytania (±10 dni); API nie akceptuje >10
const KASADA_MAX_REQUESTS = 42;       // Maks. farechart calls per sesję (Kasada limit ~42-45)

// ─── Patchright (stealth Playwright — omija Kasada fingerprinting) ───────────
// Fallback: zwykły Playwright, ostateczny fallback: generator statyczny
let chromium = null;
try {
  chromium = require('patchright').chromium;
} catch(e) {
  try {
    chromium = require('playwright').chromium;
    console.warn('[Browser] Patchright niedostępny — używam playwright (może być blokowany przez Kasada)');
  } catch(e2) {
    // Żaden browser niedostępny - Wizzair będzie z generatora statycznego
  }
}

// ─── pomocnicze ───────────────────────────────────────────────────────────────
function sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function todayStr() { return isoDate(new Date()); }

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function addMonths(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setMonth(d.getMonth() + n);
  return isoDate(d);
}

async function fetchWithTimeout(url, opts = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Ryanair ──────────────────────────────────────────────────────────────────
async function fetchRyanairFares(from, to, dateFrom, dateTo) {
  const inboundTo = addDays(dateTo, 3);

  const params = new URLSearchParams({
    departureAirportIataCode:  from,
    arrivalAirportIataCode:    to,
    outboundDepartureDateFrom: dateFrom,
    outboundDepartureDateTo:   dateTo,
    inboundDepartureDateFrom:  dateFrom,
    inboundDepartureDateTo:    inboundTo,
    durationFrom:              '1',
    durationTo:                '3',
    outboundDepartureTimeFrom: '00:00',
    outboundDepartureTimeTo:   '23:59',
    inboundDepartureTimeFrom:  '00:00',
    inboundDepartureTimeTo:    '23:59',
    adultPaxCount:             '1',
    teenPaxCount:              '0',
    childPaxCount:             '0',
    infantPaxCount:            '0',
    searchMode:                'ALL',
    currency:                  'PLN',
    market:                    'pl-pl',
  });

  const url = `https://www.ryanair.com/api/farfnd/v4/roundTripFares?${params}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'accept':          'application/json',
      'user-agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
      'referer':         `https://www.ryanair.com/pl/pl/fare-finder?originIata=${from}&destinationIata=${to}`,
      'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.fares) ? data.fares : [];
}

// ─── Wizzair przez Playwright + farechart API ─────────────────────────────────
/**
 * Tworzy nowy kontekst przeglądarki z świeżą sesją Kasada.
 * Każdy nowy kontekst ma nowe tokeny JS i cookie.
 */
async function createFreshWizzairPage(browser, apiVersionRef) {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale:    'pl-PL',
    viewport:  { width: 1280, height: 800 },
    extraHTTPHeaders: { 'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8' },
  });
  const page = await ctx.newPage();

  // Wykryj wersję API Wizzair z pierwszego żądania
  page.on('response', (response) => {
    const match = response.url().match(/be\.wizzair\.com\/([0-9]+\.[0-9]+\.[0-9]+)\//);
    if (match && apiVersionRef) apiVersionRef.value = match[1];
  });

  try {
    await page.goto('https://wizzair.com/pl-pl', { waitUntil: 'domcontentloaded', timeout: 20000 });
  } catch(e) { /* timeout OK */ }

  await sleep(8000); // Poczekaj na inicjalizację Kasada (8s wymagane przy odnowieniu)

  return { ctx, page };
}

/**
 * Inicjalizuje przeglądarkę Playwright.
 */
// Argumenty launch wspólne dla local + CI (GitHub Actions wymaga --no-sandbox)
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

async function initWizzairBrowser() {
  if (!chromium) return null;

  try {
    const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });
    const apiVersionRef = { value: WIZZAIR_API_VERSION };

    console.log('[Wizzair] Inicjalizacja Patchright...');
    const { ctx, page } = await createFreshWizzairPage(browser, apiVersionRef);
    console.log(`[Wizzair] Wersja API Wizzair: ${apiVersionRef.value}`);

    return { browser, page, ctx, apiVersionRef };
  } catch(e) {
    console.error('[Wizzair] Błąd Playwright:', e.message);
    return null;
  }
}

/**
 * Wywołuje farechart API dla jednej trasy i daty środkowej.
 * Zwraca tablicę wylotów lub [] przy błędzie.
 */
async function callFarechart(page, from, to, centerDateStr, apiVersion) {
  const body = JSON.stringify({
    isRescueFare:   false,
    adultCount:     1,
    childCount:     0,
    dayInterval:    FARECHART_INTERVAL,
    wdc:            false,
    isFlightChange: false,
    flightList: [
      { departureStation: from, arrivalStation: to, date: centerDateStr + 'T00:00:00' },
      { departureStation: to,   arrivalStation: from, date: centerDateStr + 'T00:00:00' },
    ],
  });

  try {
    const result = await page.evaluate(async ({ body, apiVersion }) => {
      const r = await fetch(`https://be.wizzair.com/${apiVersion}/Api/asset/farechart`, {
        method:  'POST',
        headers: {
          'content-type': 'application/json;charset=UTF-8',
          'accept':        'application/json, text/plain, */*',
          'origin':        'https://wizzair.com',
          'referer':       'https://wizzair.com/pl-pl',
        },
        body,
      });
      if (!r.ok) return { ok: false, status: r.status };
      const data = await r.json();
      return { ok: true, status: r.status, outbound: data.outboundFlights || [], inbound: data.inboundFlights || [] };
    }, { body, apiVersion });

    return result;
  } catch(e) {
    return { ok: false, status: 0, error: e.message };
  }
}

/**
 * Pobiera wszystkie ceny Wizzair dla podanych tras przez farechart API.
 *
 * Strategia "okno-pierwsze" (transponowana pętla):
 *   Zewnętrzna pętla = okna dat (co 20 dni, łącznie 9 okien na 180 dni)
 *   Wewnętrzna pętla = wszystkie trasy dla danego okna (1 request/trasę)
 *
 * Każde okno = świeża przeglądarka (brak odnowień wewnątrz okna).
 * 46 tras × 1 req = ~46 req/okno — poniżej limitu Kasada (42-45).
 * Między oknami: 45s przerwa (cooldown IP Kasada).
 */
async function fetchWizzairViaPlaywright(wRoutes) {
  if (!chromium) return null;

  const today   = todayStr();
  const maxDate = addMonths(today, MONTHS_AHEAD);
  const seen          = new Set();
  const allFlights    = [];
  const returnPriceMap = new Map();
  let totalAdded   = 0;
  let windowsDone  = 0;

  const WINDOW_STEP    = 20; // dni między centrami okien (step=interval*2 = brak przerw)
  // GitHub Actions (CI=true) dostaje świeże IP → cooldown zbędny; lokalnie 45s na reset Kasada
  const WINDOW_COOLDOWN = process.env.CI ? 8000 : 45000;

  for (let daysOffset = 0; daysOffset < 180; daysOffset += WINDOW_STEP) {
    const centerD = new Date(today + 'T12:00:00');
    centerD.setDate(centerD.getDate() + daysOffset);
    const centerStr = isoDate(centerD);
    if (centerStr > maxDate) break;

    process.stdout.write(`\n[Wizzair] Okno ${windowsDone + 1} (centrum ${centerStr}): `);

    // Świeża przeglądarka dla każdego okna
    let browser, page, ctx, apiVersionRef;
    try {
      const init = await initWizzairBrowser();
      if (!init) break;
      browser = init.browser;
      page = init.page;
      ctx = init.ctx;
      apiVersionRef = init.apiVersionRef;
    } catch(e) {
      console.error(`init błąd: ${e.message}`);
      break;
    }

    let windowAdded = 0;
    let reqCount    = 0;

    try {
      for (const route of wRoutes) {
        const [from, to] = route;
        if (!ORIGINS[from] || !DESTS[to]) continue;

        // Zatrzymaj gdy Kasada zaczyna blokować
        if (reqCount >= KASADA_MAX_REQUESTS) break;

        const result = await callFarechart(page, from, to, centerStr, apiVersionRef.value);
        reqCount++;

        if (!result.ok) {
          if (result.status === 503 || result.status === 429) break; // limit osiągnięty
          continue;
        }

        for (const f of result.outbound || []) {
          if (f.departureStation !== from || f.arrivalStation !== to) continue;
          const dateStr = f.date ? f.date.slice(0, 10) : null;
          if (!dateStr || dateStr < today || dateStr > maxDate) continue;
          const key = `${from}-${to}-${dateStr}`;
          if (seen.has(key)) continue;
          seen.add(key);
          allFlights.push({ ...f, _route: route });
          windowAdded++;
          totalAdded++;
        }

        for (const f of result.inbound || []) {
          const dateStr = f.date ? f.date.slice(0, 10) : null;
          if (!dateStr || dateStr < today || dateStr > maxDate) continue;
          const amount = f.price?.amount || 0;
          if (amount > 0) {
            const key = `${f.departureStation}-${f.arrivalStation}-${dateStr}`;
            if (!returnPriceMap.has(key) || returnPriceMap.get(key) > amount)
              returnPriceMap.set(key, amount);
          }
        }

        await sleep(200);
      }
    } catch(e) {
      console.error(`błąd okna: ${e.message}`);
    }

    // Zamknij przeglądarkę
    try { await ctx.close(); } catch(e) {}
    try { await browser.close(); } catch(e) {}

    console.log(`${windowAdded} nowych lotów (${reqCount} req)`);
    windowsDone++;

    // Przerwa między oknami (nie po ostatnim)
    if (daysOffset + WINDOW_STEP < 180) {
      process.stdout.write(`[Wizzair] Cooldown ${WINDOW_COOLDOWN/1000}s... `);
      await sleep(WINDOW_COOLDOWN);
      process.stdout.write('gotowe\n');
    }
  }

  console.log(`\n[Wizzair] Łącznie: ${totalAdded} lotów (${windowsDone} okien)`);
  return { allFlights, returnPriceMap };
}

// ─── Wizzair: pobieranie godzin lotów przez search API ───────────────────────
async function fetchWizzairTimesViaSearch(wRoutes, allFlights) {
  if (!chromium) return new Map();

  const timesMap = new Map();
  const today = todayStr();
  const eightWeeksOut = addDays(today, 56);

  // Jeśli allFlights dostarczone — filtruj do tras z bliskimi lotami
  // Jeśli null — pobierz godziny dla WSZYSTKICH tras (wywołanie przed farechart)
  let routePairs;
  if (allFlights && allFlights.length) {
    const nearRoutes = new Set();
    for (const f of allFlights) {
      const dateStr = f.date ? f.date.slice(0, 10) : null;
      if (!dateStr || dateStr > eightWeeksOut) continue;
      const [from, to] = f._route;
      nearRoutes.add(`${from}|${to}`);
      nearRoutes.add(`${to}|${from}`);
    }
    if (!nearRoutes.size) return timesMap;
    routePairs = [...nearRoutes].map(k => k.split('|'));
  } else {
    // Przed farechart: szukaj godzin dla wszystkich tras (oba kierunki)
    const allPairs = new Set();
    wRoutes.forEach(([from, to]) => { allPairs.add(`${from}|${to}`); allPairs.add(`${to}|${from}`); });
    routePairs = [...allPairs].map(k => k.split('|'));
  }
  const CHUNK = 38; // Zapytań na sesję — poniżej limitu Kasada (42-45)
  const chunks = [];
  for (let i = 0; i < routePairs.length; i += CHUNK) chunks.push(routePairs.slice(i, i + CHUNK));
  console.log(`\n[Wizzair Times] ${routePairs.length} kierunków → ${chunks.length} sesji (max ${CHUNK}/sesja)...`);

  let totalReq = 0;

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    process.stdout.write(`[Wizzair Times] Sesja ${ci + 1}/${chunks.length}: `);

    const init = await initWizzairBrowser();
    if (!init) { console.log('Playwright niedostępny'); break; }
    const { browser, ctx, page, apiVersionRef } = init;

    try {
      let chunkReq = 0;
      for (const [from, to] of chunk) {
        const body = JSON.stringify({
          flightList: [{ departureStation: from, arrivalStation: to, from: today, to: eightWeeksOut }],
          priceType: 'regular', adultCount: 1, childCount: 0, infantCount: 0,
        });

        const result = await page.evaluate(async ({ body, apiVersion }) => {
          const r = await fetch(`https://be.wizzair.com/${apiVersion}/Api/search/search`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json;charset=UTF-8',
              'accept': 'application/json, text/plain, */*',
              'origin': 'https://wizzair.com',
              'referer': 'https://wizzair.com/pl-pl',
            },
            body,
          });
          if (!r.ok) return { ok: false, status: r.status };
          const data = await r.json();
          return { ok: true, outbound: data.outboundFlights || [] };
        }, { body, apiVersion: apiVersionRef.value });

        chunkReq++; totalReq++;

        if (!result.ok) {
          if (result.status === 503 || result.status === 429) break;
          continue;
        }

        for (const f of result.outbound || []) {
          const depStr = f.scheduledDepartureDateTime || f.departureDateTime || f.departureDatTime;
          const arrStr = f.scheduledArrivalDateTime  || f.arrivalDateTime   || f.arrivalDatTime;
          if (!depStr || depStr.length < 16) continue;
          const dateStr = depStr.slice(0, 10);
          if (dateStr < today || dateStr > eightWeeksOut) continue;
          const key = `${from}-${to}-${dateStr}`;
          if (!timesMap.has(key)) {
            const dept   = depStr.slice(11, 16);
            const arr    = arrStr && arrStr.length >= 16 ? arrStr.slice(11, 16) : null;
            const durMin = arr ? Math.round((new Date(arrStr.slice(0, 19)) - new Date(depStr.slice(0, 19))) / 60000) : 0;
            const dur    = durMin > 0 && durMin < 720
              ? `${Math.floor(durMin / 60)}h ${String(durMin % 60).padStart(2, '0')}m`
              : null;
            timesMap.set(key, { dept, arr, dur });
          }
        }
        await sleep(300);
      }
      console.log(`${timesMap.size} godzin (${chunkReq} req)`);
    } catch(e) {
      console.error(`błąd: ${e.message}`);
    } finally {
      await ctx.close().catch(() => {});
      await browser.close().catch(() => {});
    }

    // Cooldown między sesjami (nie po ostatniej)
    if (ci + 1 < chunks.length) {
      const cd = process.env.CI ? 8000 : 45000;
      process.stdout.write(`[Wizzair Times] Cooldown ${cd / 1000}s... `);
      await sleep(cd);
      process.stdout.write('gotowe\n');
    }
  }

  console.log(`[Wizzair Times] Łącznie: ${timesMap.size} godzin (${totalReq} zapytań)`);
  return timesMap;
}

// ─── Formatowanie dat ─────────────────────────────────────────────────────────
const MO_PL = ['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paź','Lis','Gru'];

function fmtSingle(d, dow) {
  const lbl = dow === 'fri' ? 'Pt' : dow === 'sat' ? 'Sb' : 'Nd';
  return `${lbl}, ${d.getDate()} ${MO_PL[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtRange(d1, d2, days) {
  const lbl = days === 3 ? 'Pt–Nd' : 'Sb–Nd';
  if (d1.getMonth() === d2.getMonth())
    return `${lbl}, ${d1.getDate()}–${d2.getDate()} ${MO_PL[d1.getMonth()]} ${d1.getFullYear()}`;
  return `${lbl}, ${d1.getDate()} ${MO_PL[d1.getMonth()]} – ${d2.getDate()} ${MO_PL[d2.getMonth()]} ${d1.getFullYear()}`;
}

function classifyDow(dateStr) {
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  if (dow === 5) return 'fri';
  if (dow === 6) return 'sat';
  if (dow === 0) return 'sun';
  return null;
}

function calcDur(dep, arr) {
  const diff = Math.round((new Date(arr) - new Date(dep)) / 60000);
  if (diff <= 0 || diff > 720) return null;
  return `${Math.floor(diff / 60)}h ${String(diff % 60).padStart(2,'0')}m`;
}

function buildWeekendRecord(dateStr, dow, deptH, deptM, arrH, arrM, durStr) {
  const dDate   = new Date(dateStr + 'T12:00:00');
  let retRaw    = dateStr;
  let pattern   = `${dow}-only`;
  let deptDay   = dow === 'fri' ? 'piątek' : dow === 'sat' ? 'sobota' : 'niedziela';
  let retDay    = deptDay;
  let dateLabel = fmtSingle(dDate, dow);

  if (dow === 'fri') {
    const sun = new Date(dDate); sun.setDate(sun.getDate() + 2);
    retRaw    = isoDate(sun);
    retDay    = 'niedziela';
    pattern   = 'fri-sun';
    dateLabel = fmtRange(dDate, sun, 3);
  } else if (dow === 'sat') {
    const sun = new Date(dDate); sun.setDate(sun.getDate() + 1);
    retRaw    = isoDate(sun);
    retDay    = 'niedziela';
    pattern   = 'sat-sun';
    dateLabel = fmtRange(dDate, sun, 2);
  }

  const retDeptH = (deptH + 12) % 24;
  const retArrH  = (arrH  + 12) % 24;

  return {
    deptDay, retDay, pattern,
    date: dateLabel, raw: dateStr, retRaw,
    month: parseInt(dateStr.slice(5, 7), 10),
    year:  parseInt(dateStr.slice(0, 4), 10),
    dept:  `${String(deptH).padStart(2,'0')}:${String(deptM).padStart(2,'0')}`,
    arr:   `${String(arrH).padStart(2,'0')}:${String(arrM).padStart(2,'0')}`,
    retDept: `${String(retDeptH).padStart(2,'0')}:00`,
    retArr:  `${String(retArrH).padStart(2,'0')}:${String(arrM).padStart(2,'0')}`,
    dur: durStr || '2h 00m',
  };
}

function parseTimes(dateTimeStr) {
  if (!dateTimeStr || dateTimeStr.length <= 10) return [0, 0];
  const t = dateTimeStr.slice(11, 16).split(':');
  return [parseInt(t[0], 10), parseInt(t[1] || '0', 10)];
}

// ─── Normalizacja Ryanair ─────────────────────────────────────────────────────
function normalizeRyanairFare(fare, from, to, origInfo, destInfo, id) {
  const out = fare.outbound;
  const inb = fare.inbound;
  if (!out?.departureDate) return null;

  const dateStr = out.departureDate.slice(0, 10);
  if (dateStr < todayStr()) return null;

  const dow = classifyDow(dateStr);
  if (!dow) return null;

  const rtPrice = fare.summary?.price?.value
    || ((out.price?.value || 0) + (inb?.price?.value || 0));

  // Use real outbound leg price, not half of round-trip (legs are often asymmetric)
  const price1 = Math.round(out.price?.value || rtPrice / 2 || 0);
  const price2 = Math.round(rtPrice || price1 * 1.7);
  if (!price2 || price2 > MAX_BUDGET_RT) return null;

  const [dH, dM] = parseTimes(out.departureDate);
  const [aH, aM] = parseTimes(out.arrivalDate);
  const durStr = (out.arrivalDate && out.departureDate) ? calcDur(out.departureDate, out.arrivalDate) : null;
  const weekend = buildWeekendRecord(dateStr, dow, dH, dM, aH, aM, durStr);

  // Override return times with real inbound flight data from API
  // Only when inbound falls on a weekend day (Fri/Sat/Sun) — if cheapest inbound
  // is Mon-Thu, keep the buildWeekendRecord estimate so dates/patterns stay consistent
  if (inb?.departureDate && inb.departureDate.length >= 16) {
    const actualRetDate = inb.departureDate.slice(0, 10);
    const actualRetDow = classifyDow(actualRetDate);
    if (actualRetDow) {
      const [rDH, rDM] = parseTimes(inb.departureDate);
      weekend.retDept = `${String(rDH).padStart(2,'0')}:${String(rDM).padStart(2,'0')}`;
      if (inb.arrivalDate && inb.arrivalDate.length >= 16) {
        const [rAH, rAM] = parseTimes(inb.arrivalDate);
        weekend.retArr = `${String(rAH).padStart(2,'0')}:${String(rAM).padStart(2,'0')}`;
      }
      if (actualRetDate !== weekend.retRaw) {
        weekend.retRaw = actualRetDate;
        if (actualRetDow === 'sat') { weekend.retDay = 'sobota'; weekend.pattern = dow === 'fri' ? 'fri-sat' : 'sat-only'; }
        else if (actualRetDow === 'fri') { weekend.retDay = 'piątek'; }
        // 'sun' → retDay already 'niedziela' from buildWeekendRecord
      }
    }
  }

  return {
    id: `r${id}`, airline: 'ryanair',
    from, to, fromCity: origInfo.city, toCity: destInfo.city,
    flag: destInfo.flag, country: destInfo.country,
    ...weekend,
    price1, price2,
    sea: destInfo.sea, lgbt: destInfo.lgbt, lgbtN: destInfo.lgbtN,
    distKm: destInfo.distKm, passport: destInfo.passport,
    visa: destInfo.visa, currency: destInfo.currency, englishOk: destInfo.englishOk,
  };
}

// ─── Normalizacja Wizzair farechart ───────────────────────────────────────────
function normalizeFarechartFlight(f, from, to, origInfo, destInfo, route, id, returnPriceMap, timesMap) {
  const dateStr = f.date ? f.date.slice(0, 10) : null;
  if (!dateStr || dateStr < todayStr()) return null;

  const dow = classifyDow(dateStr);
  if (!dow) return null;

  const price1 = Math.round(f.price?.amount || 0);
  if (!price1 || price1 <= 0) return null;

  // Rzeczywista cena powrotu z farechart (jeśli dostępna), inaczej szacunek ×2
  const retDate = dow === 'sat' ? addDays(dateStr, 1)
    : dow === 'fri' ? addDays(dateStr, 2)
    : dateStr;
  const retPrice = returnPriceMap?.get(`${to}-${from}-${retDate}`) || 0;
  const price2 = retPrice > 0 ? Math.round(price1 + retPrice) : Math.round(price1 * 2);
  if (price2 > MAX_BUDGET_RT) return null;

  // Godziny wylotu: z search API (jeśli pobrane), inaczej ze statycznych ROUTES
  const outTimes = timesMap?.get(`${from}-${to}-${dateStr}`);
  let deptH, deptM, arrH, arrM, durStr;
  if (outTimes?.dept) {
    [deptH, deptM] = outTimes.dept.split(':').map(Number);
    [arrH,  arrM]  = (outTimes.arr || '00:00').split(':').map(Number);
    durStr = outTimes.dur;
  } else {
    const [, , , , durMin, deptHour] = route;
    const totalMin = durMin || 120;
    deptH = deptHour || 8; deptM = 0;
    const arrTotal = deptH * 60 + totalMin;
    arrH = Math.floor(arrTotal / 60) % 24;
    arrM = arrTotal % 60;
    durStr = `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`;
  }

  const weekend = buildWeekendRecord(dateStr, dow, deptH, deptM, arrH, arrM, durStr);

  // Godziny powrotu z search API (jeśli dostępne)
  if (retDate !== dateStr) {
    const retTimes = timesMap?.get(`${to}-${from}-${retDate}`);
    if (retTimes?.dept) {
      weekend.retDept = retTimes.dept;
      if (retTimes.arr) weekend.retArr = retTimes.arr;
    }
  }

  return {
    id:      `w${id}`,
    airline: 'wizzair',
    from, to,
    fromCity: origInfo.city,
    toCity:   destInfo.city,
    flag:     destInfo.flag,
    country:  destInfo.country,
    ...weekend,
    price1,
    price2,
    sea:       destInfo.sea,
    lgbt:      destInfo.lgbt,
    lgbtN:     destInfo.lgbtN,
    distKm:    destInfo.distKm,
    passport:  destInfo.passport,
    visa:      destInfo.visa,
    currency:  destInfo.currency,
    englishOk: destInfo.englishOk,
  };
}

// ─── api-samples ─────────────────────────────────────────────────────────────
const apiSamples = {
  capturedAt:  new Date().toISOString(),
  note:        'Surowe próbki odpowiedzi z API Ryanair i Wizzair (zapis okresowy).',
  ryanair:     { url: null, status: null, sampleResponse: null },
  wizzair:     { url: null, status: null, sampleResponse: null, strategy: null },
};

function saveApiSamples() {
  try {
    apiSamples.capturedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(__dirname, 'api-samples.json'),
      JSON.stringify(apiSamples, null, 2), 'utf8'
    );
  } catch {}
}

// ─── Główna pętla ─────────────────────────────────────────────────────────────
async function fetchRealFlights() {
  const dateFrom = todayStr();
  const dateTo   = addMonths(dateFrom, MONTHS_AHEAD);

  const flights  = [];
  let idCounter  = 1;
  let errors     = 0;

  // ── Ryanair ────────────────────────────────────────────────────────────────
  const rRoutes = ROUTES.filter(r => r[2] === 'ryanair');
  console.log(`[refresh] Pobieranie ${rRoutes.length} tras Ryanair (${dateFrom} → ${dateTo})...`);

  for (let i = 0; i < rRoutes.length; i++) {
    const route = rRoutes[i];
    const [from, to] = route;
    const origInfo = ORIGINS[from];
    const destInfo = DESTS[to];
    if (!origInfo || !destInfo) continue;

    process.stdout.write(`[${i + 1}/${rRoutes.length}] R ${from}→${to}... `);

    let fares = [], lastErr;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        fares = await fetchRyanairFares(from, to, dateFrom, dateTo);
        if (!apiSamples.ryanair.status && fares.length > 0) {
          apiSamples.ryanair.status = 200;
          apiSamples.ryanair.url = `ryanair/farfnd/v4/roundTripFares ${from}→${to}`;
          apiSamples.ryanair.sampleResponse = {
            route: `${from} → ${to}`, firstFare: fares[0],
            totalFares: fares.length, capturedAt: new Date().toISOString(),
          };
          saveApiSamples();
        }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRY) await sleep(1000 * attempt);
      }
    }

    if (lastErr) {
      console.log(`✗ ${lastErr.message}`);
      errors++;
    } else {
      let added = 0;
      for (const fare of fares) {
        const rec = normalizeRyanairFare(fare, from, to, origInfo, destInfo, idCounter);
        if (rec) { flights.push(rec); idCounter++; added++; }
      }
      console.log(`✓ ${fares.length} ofert (${added} weekendowych)`);
    }

    await sleep(300);
  }

  // ── Wizzair ────────────────────────────────────────────────────────────────
  const wRoutes = ROUTES.filter(r => r[2] === 'wizzair');
  console.log(`\n[refresh] Pobieranie ${wRoutes.length} tras Wizzair przez farechart API (Playwright)...`);

  let wizzSource = 'wizzair-static';
  let rawWizzFlights = null;
  let wizzReturnPriceMap = new Map();
  let wizzTimesMap = new Map();

  if (chromium) {
    // 1. Godziny lotów PRZED farechart — świeża sesja Kasada, brak limitu
    wizzTimesMap = await fetchWizzairTimesViaSearch(wRoutes, null);

    const wizzResult = await fetchWizzairViaPlaywright(wRoutes);
    rawWizzFlights    = wizzResult?.allFlights || null;
    wizzReturnPriceMap = wizzResult?.returnPriceMap || new Map();
  } else {
    console.log('[Wizzair] Playwright niedostępny — używam generatora statycznego');
  }

  if (rawWizzFlights && rawWizzFlights.length > 0) {
    // Normalizuj loty z farechart
    let wizzAdded = 0;
    for (const f of rawWizzFlights) {
      const route    = f._route;
      const [from, to] = route;
      const origInfo = ORIGINS[from];
      const destInfo = DESTS[to];
      if (!origInfo || !destInfo) continue;

      const rec = normalizeFarechartFlight(f, from, to, origInfo, destInfo, route, idCounter, wizzReturnPriceMap, wizzTimesMap);
      if (rec) { flights.push(rec); idCounter++; wizzAdded++; }
    }

    console.log(`[Wizzair] Znormalizowano ${wizzAdded} weekendowych lotów`);

    // Zapisz próbkę
    if (rawWizzFlights.length > 0) {
      apiSamples.wizzair.status   = 200;
      apiSamples.wizzair.strategy = 'playwright-farechart';
      apiSamples.wizzair.url      = `be.wizzair.com/${WIZZAIR_API_VERSION}/Api/asset/farechart`;
      apiSamples.wizzair.sampleResponse = {
        totalRaw:   rawWizzFlights.length,
        normalized: wizzAdded,
        sample:     rawWizzFlights[0],
        capturedAt: new Date().toISOString(),
      };
      saveApiSamples();
    }

    wizzSource = 'wizzair-farechart-live';
  } else {
    // Fallback: generator statyczny
    console.log('[Wizzair] Brak danych z farechart — fallback do generatora statycznego');
    const staticWizz = (await generateFlights(new Date())).filter(f => f.airline === 'wizzair');
    flights.push(...staticWizz);
    wizzSource = 'wizzair-static';
  }

  const source = `ryanair-api+${wizzSource}`;
  return { flights, source, errors };
}

// ─── Zapis i podsumowanie ─────────────────────────────────────────────────────
function writeOutput(flights, source) {
  flights.sort((a, b) => a.raw.localeCompare(b.raw));

  const output = {
    lastUpdated: new Date().toISOString(),
    source,
    maxBudgetRT: MAX_BUDGET_RT,
    totalCount:  flights.length,
    flights,
  };

  const outPath = path.join(__dirname, 'flights.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  saveApiSamples();

  const ry = flights.filter(f => f.airline === 'ryanair').length;
  const wz = flights.filter(f => f.airline === 'wizzair').length;

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`✅ Zapisano ${flights.length} lotów`);
  console.log(`   Plik:    ${outPath}`);
  console.log(`   Źródło:  ${source}`);
  console.log(`   Ryanair: ${ry}`);
  console.log(`   Wizzair: ${wz} ${source.includes('static') ? '(generator)' : '(prawdziwe ceny)'}`);
  console.log('═══════════════════════════════════════════════════');
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  REFRESH FLIGHTS — Ryanair + Wizzair');
  console.log(`  Playwright: ${chromium ? '✓ dostępny' : '✗ niedostępny'}`);
  console.log('═══════════════════════════════════════════════════\n');

  if (typeof fetch === 'undefined') {
    console.log('⚠️  fetch() niedostępny — wymagany Node.js 18+. Używam generatora.\n');
    writeOutput(await generateFlights(new Date()), 'static-generator-fallback');
    return;
  }

  let result;
  try {
    result = await fetchRealFlights();
  } catch (err) {
    console.error(`\n✗ Krytyczny błąd: ${err.message}`);
    console.log('   Używam fallback generatora');
    writeOutput(await generateFlights(new Date()), 'static-generator-fallback');
    return;
  }

  if (!result || !Array.isArray(result.flights) || result.flights.length === 0) {
    console.log('\n⚠️  API zwróciło 0 lotów — fallback do generatora');
    writeOutput(await generateFlights(new Date()), 'static-generator-fallback');
    return;
  }

  writeOutput(result.flights, result.source);
}

if (require.main === module) {
  main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
