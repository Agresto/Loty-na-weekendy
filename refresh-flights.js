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
const KASADA_MAX_REQUESTS = 48;       // Maks. farechart calls per sesję — testowane do ~48 bez blokady

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
/**
 * Pobiera taryfy dla jednej trasy i jednego zakresu długości pobytu.
 * Dwa wywołania per trasa:
 *   durationNights=1 → 1-nocne weekendy (Sb→Nd, Pt→Sb)
 *   durationNights=2 → 2-nocne weekendy (Pt→Nd)
 * Dzięki temu inbound ZAWSZE ląduje w weekendowym dniu, a nie w poniedziałek/wtorek.
 */
async function fetchRyanairFaresForDuration(from, to, dateFrom, dateTo, durationNights) {
  const inboundTo = addDays(dateTo, durationNights + 1);

  const params = new URLSearchParams({
    departureAirportIataCode:  from,
    arrivalAirportIataCode:    to,
    outboundDepartureDateFrom: dateFrom,
    outboundDepartureDateTo:   dateTo,
    inboundDepartureDateFrom:  dateFrom,
    inboundDepartureDateTo:    inboundTo,
    durationFrom:              String(durationNights),
    durationTo:                String(durationNights),
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

/**
 * Pobiera WSZYSTKIE weekendowe taryfy dla trasy:
 * 1-nocne (Sb→Nd, Pt→Sb) + 2-nocne (Pt→Nd), deduplikowane po dacie wylotu.
 * Dla tej samej daty wylotu zachowujemy tańszą opcję.
 */
async function fetchRyanairFares(from, to, dateFrom, dateTo) {
  const [fares1, fares2] = await Promise.all([
    fetchRyanairFaresForDuration(from, to, dateFrom, dateTo, 1),
    fetchRyanairFaresForDuration(from, to, dateFrom, dateTo, 2),
  ]);

  // Deduplikacja: dla tej samej daty wylotu bierz tańszą opcję
  const byDate = new Map();
  for (const fare of [...fares1, ...fares2]) {
    const dateKey = fare.outbound?.departureDate?.slice(0, 10);
    if (!dateKey) continue;
    const existing = byDate.get(dateKey);
    const price = fare.summary?.price?.value || Infinity;
    if (!existing || price < (existing.summary?.price?.value || Infinity)) {
      byDate.set(dateKey, fare);
    }
  }
  return [...byDate.values()];
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
  const seen           = new Set();
  const allFlights     = [];
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

    // Forward routes → allFlights; reverse routes → returnPriceMap (real return prices)
    const allDirections = [
      ...wRoutes.map(r => ({ route: r, isReturn: false })),
      ...wRoutes.map(([f, t, ...rest]) => ({ route: [t, f, ...rest], isReturn: true })),
    ];

    try {
      for (const { route, isReturn } of allDirections) {
        const [from, to] = route;
        if (!isReturn && (!ORIGINS[from] || !DESTS[to])) continue;

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

          if (!isReturn) {
            const key = `${from}-${to}-${dateStr}`;
            if (seen.has(key)) continue;
            seen.add(key);
            allFlights.push({ ...f, _route: route });
            windowAdded++;
            totalAdded++;
          } else {
            const amount = f.price?.amount || 0;
            if (amount > 0) {
              const key = `${from}-${to}-${dateStr}`;
              if (!returnPriceMap.has(key) || returnPriceMap.get(key) > amount)
                returnPriceMap.set(key, amount);
            }
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

// ─── Wizzair: pobieranie godzin lotów przez asset/map API ────────────────────
// asset/map zwraca operationStartDate = czas najbliższego odlotu dla każdej trasy.
// Ten endpoint działa bez blokady Kasada (inaczej niż search/search).
// Czas jest stały w ramach sezonu — stosujemy go do wszystkich weekendowych dat.
async function fetchWizzairTimesViaMap(wRoutes) {
  if (!chromium) return new Map();

  const timesMap = new Map();
  const today    = todayStr();
  const maxDate  = addMonths(today, MONTHS_AHEAD);

  const init = await initWizzairBrowser();
  if (!init) return timesMap;
  const { browser, ctx, page, apiVersionRef } = init;

  try {
    const mapResult = await page.evaluate(async ({ apiVersion }) => {
      const r = await fetch(
        `https://be.wizzair.com/${apiVersion}/Api/asset/map?languageCode=pl-pl&withConnections=true`,
        { headers: { accept: 'application/json', origin: 'https://wizzair.com', referer: 'https://wizzair.com/pl-pl' } }
      );
      if (!r.ok) return { ok: false, status: r.status };
      const data = await r.json();
      return { ok: true, cities: data.cities || [] };
    }, { apiVersion: apiVersionRef.value });

    if (!mapResult.ok) {
      console.log(`\n[Wizzair Times] asset/map błąd: ${mapResult.status}`);
      return timesMap;
    }

    // Buduj mapę: "from-to" → czas odlotu z operationStartDate
    const deptByRoute = new Map();
    for (const city of mapResult.cities) {
      for (const conn of city.connections || []) {
        const osd = conn.operationStartDate;
        if (!osd || osd.startsWith('0001') || osd.startsWith('1900')) continue;
        const t = osd.slice(11, 16);
        if (t === '00:00') continue;
        deptByRoute.set(`${city.iata}-${conn.iata}`, t);
      }
    }

    // Buduj timesMap: forward + reverse, wszystkie weekendowe daty
    const pairs = [
      ...wRoutes.map(r => ({ from: r[0], to: r[1], durMin: r[4] || 120 })),
      ...wRoutes.map(r => ({ from: r[1], to: r[0], durMin: r[4] || 120 })),
    ];

    let routesFound = 0;
    for (const { from, to, durMin } of pairs) {
      const deptTime = deptByRoute.get(`${from}-${to}`);
      if (!deptTime) continue;
      routesFound++;

      const [dH, dM] = deptTime.split(':').map(Number);
      const arrMins  = dH * 60 + dM + durMin;
      const arrTime  = `${String(Math.floor(arrMins / 60) % 24).padStart(2,'0')}:${String(arrMins % 60).padStart(2,'0')}`;
      const durStr   = `${Math.floor(durMin / 60)}h ${String(durMin % 60).padStart(2,'0')}m`;

      // Wypełnij wszystkie Pt/Sb/Nd w zakresie
      const end = new Date(maxDate + 'T12:00:00');
      for (let d = new Date(today + 'T12:00:00'); d <= end; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay(); // 0=Nd, 5=Pt, 6=Sb
        if (dow !== 0 && dow !== 5 && dow !== 6) continue;
        timesMap.set(`${from}-${to}-${isoDate(d)}`, { dept: deptTime, arr: arrTime, dur: durStr });
      }
    }

    console.log(`\n[Wizzair Times] ${routesFound} tras z mapy API → ${timesMap.size} wpisów`);
  } catch(e) {
    console.error('[Wizzair Times] błąd:', e.message);
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }

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

  return {
    deptDay, retDay, pattern,
    date: dateLabel, raw: dateStr, retRaw,
    month: parseInt(dateStr.slice(5, 7), 10),
    year:  parseInt(dateStr.slice(0, 4), 10),
    dept:  deptH != null ? `${String(deptH).padStart(2,'0')}:${String(deptM).padStart(2,'0')}` : null,
    arr:   arrH  != null ? `${String(arrH).padStart(2,'0')}:${String(arrM).padStart(2,'0')}` : null,
    retDept: null,
    retArr:  null,
    dur: durStr || null,
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

  if (inb?.departureDate && inb.departureDate.length >= 16) {
    const actualRetDate = inb.departureDate.slice(0, 10);
    const retDow = new Date(actualRetDate + 'T12:00:00').getDay();
    const actualRetDow = classifyDow(actualRetDate);

    // Dozwolone wzorce weekendowe:
    //   Pt/Sb/Nd → Pt/Sb/Nd (weekendowy powrót) ✓
    //   Pt → Pn (długi weekend Pt→Pn, 3 noce) ✓
    //   Sb → Pn (2 noce: Sb wieczór + Nd w miejscu) ✓
    //   Nd → Pn/Wt (start w niedzielę = nie weekend) ✗
    if (!actualRetDow) {
      // Powrót w dzień powszedni — odrzuć jeśli wylot w niedzielę
      if (dow === 'sun') return null;
      // Odrzuć powroty wtorek–czwartek (zostawiamy tylko Pn)
      if (retDow !== 1) return null;
    }

    const [rDH, rDM] = parseTimes(inb.departureDate);
    weekend.retDept = `${String(rDH).padStart(2,'0')}:${String(rDM).padStart(2,'0')}`;
    if (inb.arrivalDate && inb.arrivalDate.length >= 16) {
      const [rAH, rAM] = parseTimes(inb.arrivalDate);
      weekend.retArr = `${String(rAH).padStart(2,'0')}:${String(rAM).padStart(2,'0')}`;
    }
    if (actualRetDate !== weekend.retRaw) {
      weekend.retRaw = actualRetDate;
      const retDayNames = ['niedziela','poniedziałek','wtorek','środa','czwartek','piątek','sobota'];
      weekend.retDay = retDayNames[retDow];
      if (actualRetDow === 'sat') weekend.pattern = dow === 'fri' ? 'fri-sat' : 'sat-only';
      else if (actualRetDow === 'fri') weekend.pattern = 'fri-only';
      else if (!actualRetDow) weekend.pattern = 'fri-mon'; // tylko Pt→Pn
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
  // Niedzielny wylot Wizzair = brak sensu weekendowego (powrót byłby ten sam dzień)
  if (dow === 'sun') return null;
  const retDate = dow === 'sat' ? addDays(dateStr, 1)   // Sb → Nd
    : addDays(dateStr, 2);                               // Pt → Nd
  const retPrice = returnPriceMap?.get(`${to}-${from}-${retDate}`) || 0;
  if (retPrice === 0) return null; // brak rzeczywistej ceny powrotu → nie pokazuj
  const price2 = Math.round(price1 + retPrice);
  if (price2 > MAX_BUDGET_RT) return null;

  // Godziny wylotu: tylko z search API (jeśli pobrane) — brak szacunków
  const outTimes = timesMap?.get(`${from}-${to}-${dateStr}`);
  const weekend = buildWeekendRecord(dateStr, dow, null, null, null, null, null);
  if (outTimes?.dept) {
    weekend.dept = outTimes.dept;
    weekend.arr  = outTimes.arr || null;
    weekend.dur  = outTimes.dur || null;
  }

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
    // 1. Godziny lotów z asset/map API (bez blokady Kasada)
    wizzTimesMap = await fetchWizzairTimesViaMap(wRoutes);

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
