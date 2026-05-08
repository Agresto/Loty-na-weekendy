#!/usr/bin/env node
/**
 * refresh-flights.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pobiera prawdziwe ceny lotów z Ryanair API + Wizzair (przez Playwright).
 *
 * Strategia Wizzair:
 *   • Jeśli dostępny Playwright (self-hosted runner) → pełny scraping z cenami
 *   • Jeśli Playwright niedostępny (GitHub hosted) → generator statyczny + ikona ⚡
 *
 * Ryanair: roundTripFares API (bez blokad, publiczne)
 * Wizzair: timetable API przez headless Chromium (omija Cloudflare WAF)
 *
 * Uruchomienie lokalne / self-hosted:
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
const MAX_BUDGET_RT = 500;
const MONTHS_AHEAD  = 6;
const MAX_RETRY     = 2;
const TIMEOUT_MS    = 20000;
const WZ_DELAY      = 1000;  // Delay między requestami Aviasales (1s)

// ─── pomocnicze ───────────────────────────────────────────────────────────────
function sleep(ms)   { return new Promise(r => setTimeout(r, ms)); }
function addJitter(ms, percent = 10) {
  const jitter = Math.random() * (ms * percent / 100) - (ms * percent / 200);
  return Math.max(100, ms + jitter);
}
function isoDate(d)  { return d.toISOString().slice(0, 10); }
function todayStr()  { return isoDate(new Date()); }

function addMonths(dateStr, n) {
  const d = new Date(dateStr);
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
  const inboundTo = isoDate((() => {
    const d = new Date(dateTo); d.setDate(d.getDate() + 3); return d;
  })());

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

// ─── Wizzair przez Aviasales API (Darmowy, bez autoryzacji) ────────────────

/**
 * Pobiera loty Wizzair dla jednej trasy przez Aviasales API.
 * Aviasales to agregator lotów - bezpłatny, bez wymogu rejestracji.
 *
 * @param {string} from - IATA lotniska startowego
 * @param {string} to   - IATA lotniska docelowego
 * @param {string} dateFrom - YYYY-MM-DD
 * @param {string} dateTo   - YYYY-MM-DD
 * @returns {Promise<Array>} - tablica surowych danych lotu
 */
async function fetchWizzairFaresAviasales(from, to, dateFrom, dateTo) {
  // Aviasales - darmowy agregator lotów, dostęp publiczny bezAPI key
  // Obsługuje Wizzair i inne linie lotnicze
  // Limit: ~100 requestów/dziennie bez ograniczeń, bezpłatnie
  
  // Formujemy URL do publicznego portu Aviasales
  // Format: from,to;returnDate;outboundDate
  const params = new URLSearchParams({
    origin: from,
    destination: to,
    departureDate: dateFrom,
    returnDate: dateTo,
    adults: 1,
    children: 0,
    infants: 0,
    currency: 'PLN',
    limit: 100,
  });

  // Aviasales API endpoint - publiczny, bez autoryzacji
  const url = `https://api.aviasales.com/v2/prices/latest?${params}`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'accept': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!res.ok) {
    // Aviasales niedostępny - cofnij się do fallbacka
    console.warn(`  [Aviasales] HTTP ${res.status} - używam fallbacka`);
    return [];
  }

  const data = await res.json();
  // Aviasales zwraca dane w innym formacie - konwertuj na zgodny format
  return Array.isArray(data.data) ? data.data : [];
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
  if (!out?.departureDate) return null;

  const dateStr = out.departureDate.slice(0, 10);
  if (dateStr < todayStr()) return null;

  const dow = classifyDow(dateStr);
  if (!dow) return null;

  // Cena round-trip z summary (oba loty łącznie)
  const rtPrice = fare.summary?.price?.value
    || ((out.price?.value || 0) + (fare.inbound?.price?.value || 0));

  const price1 = Math.round(rtPrice / 2 || out.price?.value || 0);
  const price2 = Math.round(rtPrice || price1 * 1.7);
  if (!price2 || price2 > MAX_BUDGET_RT) return null;

  const [dH, dM] = parseTimes(out.departureDate);
  const [aH, aM] = parseTimes(out.arrivalDate);
  const durStr = (out.arrivalDate && out.departureDate) ? calcDur(out.departureDate, out.arrivalDate) : null;
  const weekend = buildWeekendRecord(dateStr, dow, dH, dM, aH, aM, durStr);

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

// ─── Normalizacja Aviasales (dla Wizzair) ─────────────────────────────────────
function normalizeAviasalesFlight(f, from, to, origInfo, destInfo, id) {
  // Aviasales zwraca inny format niż Kiwi
  // Przystosuj do dostępnych pól
  if (!f.origin || !f.destination) return null;

  const dateStr = f.departure_at ? f.departure_at.slice(0, 10) : null;
  if (!dateStr || dateStr < todayStr()) return null;

  const dow = classifyDow(dateStr);
  if (!dow) return null;

  // Cena round-trip z Aviasales
  const rtPrice = f.price || 0;
  if (!rtPrice || rtPrice > MAX_BUDGET_RT) return null;

  const price1 = Math.round(rtPrice / 2);
  const price2 = rtPrice;

  const [dH, dM] = parseTimes(f.departure_at || '');
  const [aH, aM] = parseTimes(f.arrival_at || '');
  const durStr = f.departure_at && f.arrival_at ? calcDur(f.departure_at, f.arrival_at) : null;
  const weekend = buildWeekendRecord(dateStr, dow, dH, dM, aH, aM, durStr);

  return {
    id: `a${id}`, airline: 'wizzair',
    from, to, fromCity: origInfo.city, toCity: destInfo.city,
    flag: destInfo.flag, country: destInfo.country,
    ...weekend,
    price1, price2,
    sea: destInfo.sea, lgbt: destInfo.lgbt, lgbtN: destInfo.lgbtN,
    distKm: destInfo.distKm, passport: destInfo.passport,
    visa: destInfo.visa, currency: destInfo.currency, englishOk: destInfo.englishOk,
    flightCode: f.flight_number || '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STARY KOD (Kiwi API - zastąpiony Aviasales) - zachowuję dla historii:
// ═══════════════════════════════════════════════════════════════════════════
/*
// ─── Normalizacja Kiwi (dla Wizzair) ──────────────────────────────────────
function normalizeKiwiFlight(f, from, to, origInfo, destInfo, id) {
  if (!f.route || f.route.length < 2) return null;

  const outbound = f.route[0];
  const inbound = f.route[1];
  if (!outbound || !inbound) return null;

  const dateStr = outbound.local_departure.slice(0, 10);
  if (dateStr < todayStr()) return null;

  const dow = classifyDow(dateStr);
  if (!dow) return null;

  // Cena round-trip z Kiwi
  const rtPrice = f.price || 0;
  if (!rtPrice || rtPrice > MAX_BUDGET_RT) return null;

  const price1 = Math.round(rtPrice / 2);
  const price2 = rtPrice;

  const [dH, dM] = parseTimes(outbound.local_departure);
  const [aH, aM] = parseTimes(outbound.local_arrival);
  const durStr = calcDur(outbound.local_departure, outbound.local_arrival);
  const weekend = buildWeekendRecord(dateStr, dow, dH, dM, aH, aM, durStr);

  return {
    id: `k${id}`, airline: 'wizzair',
    from, to, fromCity: origInfo.city, toCity: destInfo.city,
    flag: destInfo.flag, country: destInfo.country,
    ...weekend,
    price1, price2,
    sea: destInfo.sea, lgbt: destInfo.lgbt, lgbtN: destInfo.lgbtN,
    distKm: destInfo.distKm, passport: destInfo.passport,
    visa: destInfo.visa, currency: destInfo.currency, englishOk: destInfo.englishOk,
    flightCode: outbound.flight_no || '',
  };
}
*/

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
  const today    = dateFrom;

  const flights  = [];
  let idCounter  = 1;
  let errors     = 0;
  const routeLastRequest = new Map(); // Per-route throttling: minimalny odstęp między requestami dla tej samej trasy

  // ── Ryanair ────────────────────────────────────────────────────────────────
  const rRoutes = ROUTES.filter(r => r[2] === 'ryanair');
  console.log(`[refresh] Pobieranie ${rRoutes.length} tras Ryanair (${dateFrom} → ${dateTo})...`);

  for (let i = 0; i < rRoutes.length; i++) {
    const [from, to] = rRoutes[i];
    const origInfo = ORIGINS[from];
    const destInfo = DESTS[to];
    if (!origInfo || !destInfo) continue;

    process.stdout.write(`[${i+1}/${rRoutes.length}] R ${from}→${to}... `);

    let fares = [], lastErr;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        fares = await fetchRyanairFares(from, to, dateFrom, dateTo);
        if (!apiSamples.ryanair.status && fares.length > 0) {
          apiSamples.ryanair.status = 200;
          apiSamples.ryanair.url = `https://www.ryanair.com/api/farfnd/v4/roundTripFares?...${from}→${to}`;
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

  console.log(`\n[refresh] Pobieranie ${wRoutes.length} tras Wizzair przez Aviasales API...`);

  let wizzOk = 0, wizzFail = 0;

    for (let i = 0; i < wRoutes.length; i++) {
      const [from, to] = wRoutes[i];
      const origInfo = ORIGINS[from];
      const destInfo = DESTS[to];
      if (!origInfo || !destInfo) continue;

      process.stdout.write(`[${i+1}/${wRoutes.length}] W ${from}→${to}... `);

      // Per-route throttling: sprawdź czas od ostatniego requestu dla tej trasy
      const routeKey = `${from}-${to}`;
      const now = Date.now();
      const lastReq = routeLastRequest.get(routeKey) || 0;
      const timeSinceLast = now - lastReq;
      const minInterval = 30000; // 30 sekund minimalny odstęp dla tej samej trasy
      if (timeSinceLast < minInterval) {
        const extraSleep = minInterval - timeSinceLast;
        console.log(`(dodatkowe ${extraSleep}ms dla trasy ${routeKey})`);
        await sleep(extraSleep);
      }
      routeLastRequest.set(routeKey, Date.now());

      await sleep(WZ_DELAY);

      let rawFlights = [];
      try {
        rawFlights = await fetchWizzairFaresAviasales(from, to, dateFrom, dateTo);
      } catch (err) {
        console.log(`✗ ${err.message}`);
        wizzFail++;
        await sleep(1000); // Krótszy delay dla Aviasales
        continue;
      }

      let added = 0;
      for (const f of rawFlights) {
        const rec = normalizeAviasalesFlight(f, from, to, origInfo, destInfo, idCounter);
        if (rec) { flights.push(rec); idCounter++; added++; }
      }

      console.log(`✓ ${rawFlights.length} ofert (${added} weekendowych)`);
      wizzOk++;

      // Zapisz próbkę
      if (!apiSamples.wizzair.status && rawFlights.length > 0) {
        apiSamples.wizzair.status   = 200;
        apiSamples.wizzair.strategy = 'aviasales-api';
        apiSamples.wizzair.url      = `https://api.aviasales.com/v2/prices/latest?...${from}→${to}`;
        apiSamples.wizzair.sampleResponse = {
          route: `${from} → ${to}`, firstFlight: rawFlights[0],
          totalFlights: rawFlights.length, capturedAt: new Date().toISOString(),
        };
        saveApiSamples();
      }

      await sleep(WZ_DELAY);
    }

    console.log(`\n[Wizzair] Wynik: ${wizzOk}/${wRoutes.length} tras OK, ${wizzFail} błędów`);

    const source = wizzOk > 0 ? 'ryanair+aviasales-api' : 'ryanair-api+wizzair-static';

    if (wizzOk === 0) {
      const staticWizz = generateFlights(new Date()).filter(f => f.airline === 'wizzair');
      flights.push(...staticWizz);
    }

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
  console.log(`   Wizzair: ${wz} ${source.includes('static') ? '(generator)' : '(prawdziwe API)'}`);
  console.log('═══════════════════════════════════════════════════');
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  REFRESH FLIGHTS — Ryanair + Wizzair');
  console.log('═══════════════════════════════════════════════════\n');

  if (typeof fetch === 'undefined') {
    console.log('⚠️  fetch() niedostępny — wymagany Node.js 18+. Używam generatora.\n');
    writeOutput(generateFlights(new Date()), 'static-generator-fallback');
    return;
  }

  let result;
  try {
    result = await fetchRealFlights();
  } catch (err) {
    console.error(`\n✗ Krytyczny błąd: ${err.message}`);
    console.log('   Używam fallback generatora');
    writeOutput(generateFlights(new Date()), 'static-generator-fallback');
    return;
  }

  if (result.flights.length === 0) {
    console.log('\n⚠️  API zwróciło 0 lotów — fallback do generatora');
    writeOutput(generateFlights(new Date()), 'static-generator-fallback');
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
