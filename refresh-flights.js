#!/usr/bin/env node
/**
 * refresh-flights.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pobiera prawdziwe ceny lotów z API Ryanair i Wizzair, łączy je z
 * metadanymi destynacji i zapisuje do flights.json.
 *
 * Wywoływany codziennie przez GitHub Actions cron
 * (.github/workflows/refresh-flights.yml).
 *
 * Strategia Wizzair:
 *   POST https://be.wizzair.com/Api/search/timetable
 *   Jeden request = cały zakres dat dla trasy.
 *   Fallback: allorigins /raw proxy jeśli direct HTTP 429.
 *   Jeśli proxy też padnie → fallback generator + ikona ⚡ w UI.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';
const fs   = require('fs');
const path = require('path');
const { generateFlights, ROUTES, DESTS, ORIGINS } = require('./generate-flights.js');

// ─── konfiguracja ──────────────────────────────────────────────────────────
const MAX_BUDGET_RT  = 500;
const MONTHS_AHEAD   = 6;
const MAX_RETRY      = 2;
const TIMEOUT_MS     = 12000;
const WIZZAIR_DELAY  = 600;   // ms między requestami Wizzair

// Wizzair API — wersja wykrywana dynamicznie; jeśli się zmieni, spróbuj fallbacku
const WZ_API_VERSIONS = ['27.7.0', '26.6.0', '28.0.0'];

// allorigins /raw zwraca surową odpowiedź (nie opakowuje w JSON)
const ALLORIGINS_RAW = 'https://api.allorigins.win/raw?url=';

// ─── pomocnicze ───────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isoDate(d) { return d.toISOString().slice(0, 10); }

function todayStr() { return isoDate(new Date()); }

function addMonths(dateStr, n) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return isoDate(d);
}

/** fetch z timeoutem */
async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Ryanair ──────────────────────────────────────────────────────────────────
/**
 * Ryanair farfnd v4 roundTripFares — pobiera pary lotów dla trasy.
 * Jeden request = cały zakres dat (do 6 miesięcy).
 */
async function fetchRyanairFares(from, to, dateFrom, dateTo) {
  const inboundTo = isoDate((() => {
    const d = new Date(dateTo); d.setDate(d.getDate() + 3); return d;
  })());

  const params = new URLSearchParams({
    departureAirportIataCode:   from,
    arrivalAirportIataCode:     to,
    outboundDepartureDateFrom:  dateFrom,
    outboundDepartureDateTo:    dateTo,
    inboundDepartureDateFrom:   dateFrom,
    inboundDepartureDateTo:     inboundTo,
    durationFrom:               '1',
    durationTo:                 '3',
    outboundDepartureTimeFrom:  '00:00',
    outboundDepartureTimeTo:    '23:59',
    inboundDepartureTimeFrom:   '00:00',
    inboundDepartureTimeTo:     '23:59',
    adultPaxCount:              '1',
    teenPaxCount:               '0',
    childPaxCount:              '0',
    infantPaxCount:             '0',
    searchMode:                 'ALL',
    currency:                   'PLN',
    market:                     'pl-pl',
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

// ─── Wizzair ──────────────────────────────────────────────────────────────────

/**
 * Buduje body dla Wizzair timetable.
 * Endpoint zwraca outboundFlights[] dla całego zakresu dat naraz.
 */
function buildWizzairBody(from, to, dateFrom, dateTo) {
  return {
    flightList: [{
      departureStation: from,
      arrivalStation:   to,
      from:             dateFrom,
      to:               dateTo,
    }],
    priceType:   'regular',
    adultCount:  1,
    childCount:  0,
    infantCount: 0,
  };
}

const WZ_HEADERS = {
  'accept':          'application/json, text/plain, */*',
  'content-type':    'application/json;charset=UTF-8',
  'origin':          'https://wizzair.com',
  'referer':         'https://wizzair.com/pl-pl/flights/timetable',
  'user-agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8',
  'x-requestedwith': 'XMLHttpRequest',
};

/**
 * Jeden request direct do Wizzair timetable.
 * Zwraca tablicę surowych lotów lub rzuca błąd.
 */
async function wizzairDirect(from, to, dateFrom, dateTo, apiVersion) {
  const url  = `https://be.wizzair.com/${apiVersion}/Api/search/timetable`;
  const body = JSON.stringify(buildWizzairBody(from, to, dateFrom, dateTo));

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: WZ_HEADERS,
    body,
  });

  if (res.status === 429) throw new Error('HTTP 429');
  if (res.status === 404) throw new Error('HTTP 404');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  return Array.isArray(data.outboundFlights) ? data.outboundFlights : [];
}

/**
 * Request przez allorigins /raw proxy.
 * /raw zwraca surową treść odpowiedzi — bez opakowania JSON.
 */
async function wizzairViaProxy(from, to, dateFrom, dateTo, apiVersion) {
  const targetUrl = `https://be.wizzair.com/${apiVersion}/Api/search/timetable`;
  const body      = JSON.stringify(buildWizzairBody(from, to, dateFrom, dateTo));

  // allorigins /raw obsługuje POST przez parametr method i body w URL jest niemożliwy —
  // użyjemy /get?url= z zakodowanym JSON jako fallback GET do timetable nie działa,
  // więc próbujemy z innym proxy: corsproxy.io który przepuszcza POST
  const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`;

  const res = await fetchWithTimeout(proxyUrl, {
    method: 'POST',
    headers: { ...WZ_HEADERS, 'x-cors-api-key': 'temp_public' },
    body,
  });

  if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);

  const text = await res.text();
  if (!text || text.length < 10) throw new Error('pusta odpowiedź proxy');

  let data;
  try { data = JSON.parse(text); } catch { throw new Error('proxy: zły JSON'); }
  return Array.isArray(data.outboundFlights) ? data.outboundFlights : [];
}

/**
 * Pobiera loty Wizzair dla trasy — próbuje:
 *  1. Direct (kilka wersji API)
 *  2. Proxy POST przez corsproxy.io
 *  3. Zwraca [] jeśli wszystko padnie
 *
 * @returns {{ flights: Array, blocked: boolean }}
 */
async function fetchWizzairFares(from, to, dateFrom, dateTo) {
  // Krok 1: direct
  for (const ver of WZ_API_VERSIONS) {
    try {
      const flights = await wizzairDirect(from, to, dateFrom, dateTo, ver);
      return { flights, blocked: false };
    } catch (err) {
      if (err.message.includes('404')) continue; // złe API version → następna
      if (err.message.includes('429')) break;    // zablokowany → idź do proxy
      // inne błędy (timeout, network) → też idź do proxy
      break;
    }
  }

  await sleep(300);

  // Krok 2: proxy
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const ver     = WZ_API_VERSIONS[0];
      const flights = await wizzairViaProxy(from, to, dateFrom, dateTo, ver);
      return { flights, blocked: false };
    } catch (err) {
      if (attempt < MAX_RETRY) await sleep(1000 * attempt);
    }
  }

  // Krok 3: poddajemy się dla tej trasy
  return { flights: [], blocked: true };
}

// ─── Normalizacja danych Ryanair ──────────────────────────────────────────────

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
  const dow = new Date(dateStr).getDay();
  if (dow === 5) return 'fri';
  if (dow === 6) return 'sat';
  if (dow === 0) return 'sun';
  return null;
}

/**
 * Przetwarza jedno fare Ryanair (roundTrip) na rekord lotu.
 */
function normalizeRyanairFare(fare, from, to, origInfo, destInfo, id) {
  const out = fare.outbound;
  if (!out?.departureDate) return null;

  const dateStr = out.departureDate.slice(0, 10);
  const dow = classifyDow(dateStr);
  if (!dow) return null;

  // Cena round-trip z summary lub suma outbound+inbound
  const rtPrice = fare.summary?.price?.value
    || ((out.price?.value || 0) + (fare.inbound?.price?.value || 0));

  const price1 = Math.round(rtPrice / 2 || out.price?.value || 0);
  const price2 = Math.round(rtPrice || price1 * 1.7);
  if (price2 > MAX_BUDGET_RT || price2 === 0) return null;

  const dDate   = new Date(dateStr);
  let retRaw    = dateStr;
  let pattern   = `${dow}-only`;
  let deptDay   = dow === 'fri' ? 'piątek' : dow === 'sat' ? 'sobota' : 'niedziela';
  let retDay    = deptDay;
  let dateLabel = fmtSingle(dDate, dow);

  if (dow === 'fri') {
    const sun = new Date(dDate); sun.setDate(sun.getDate() + 2);
    retRaw    = sun.toISOString().slice(0, 10);
    retDay    = 'niedziela';
    pattern   = 'fri-sun';
    dateLabel = fmtRange(dDate, sun, 3);
  } else if (dow === 'sat') {
    const sun = new Date(dDate); sun.setDate(sun.getDate() + 1);
    retRaw    = sun.toISOString().slice(0, 10);
    retDay    = 'niedziela';
    pattern   = 'sat-sun';
    dateLabel = fmtRange(dDate, sun, 2);
  }

  // Czasy lotów z API lub przybliżone
  let deptH = 6, deptM = 0, arrH = 8, arrM = 30;
  if (out.departureDate.length > 10) {
    const t = out.departureDate.slice(11, 16).split(':');
    deptH = parseInt(t[0], 10); deptM = parseInt(t[1], 10);
  }
  if (out.arrivalDate?.length > 10) {
    const t = out.arrivalDate.slice(11, 16).split(':');
    arrH = parseInt(t[0], 10); arrM = parseInt(t[1], 10);
  }
  const retDeptH = (deptH + 12) % 24;
  const retArrH  = (arrH + 12) % 24;

  return {
    id:        `r${id}`,
    airline:   'ryanair',
    from, to,
    fromCity:  origInfo.city,
    toCity:    destInfo.city,
    flag:      destInfo.flag,
    country:   destInfo.country,
    dept:      `${String(deptH).padStart(2,'0')}:${String(deptM).padStart(2,'0')}`,
    arr:       `${String(arrH).padStart(2,'0')}:${String(arrM).padStart(2,'0')}`,
    retDept:   `${String(retDeptH).padStart(2,'0')}:00`,
    retArr:    `${String(retArrH).padStart(2,'0')}:${String(arrM).padStart(2,'0')}`,
    deptDay,   retDay,
    dur:       out.arrivalDate && out.departureDate
                 ? calcDur(out.departureDate, out.arrivalDate)
                 : '2h 00m',
    date:      dateLabel,
    raw:       dateStr,
    retRaw,
    month:     parseInt(dateStr.slice(5, 7), 10),
    year:      parseInt(dateStr.slice(0, 4), 10),
    price1, price2,
    sea:       destInfo.sea,
    lgbt:      destInfo.lgbt,
    lgbtN:     destInfo.lgbtN,
    distKm:    destInfo.distKm,
    passport:  destInfo.passport,
    visa:      destInfo.visa,
    currency:  destInfo.currency,
    englishOk: destInfo.englishOk,
    pattern,
  };
}

function calcDur(dep, arr) {
  const diff = Math.round((new Date(arr) - new Date(dep)) / 60000);
  if (diff <= 0 || diff > 600) return '2h 00m';
  return `${Math.floor(diff / 60)}h ${String(diff % 60).padStart(2,'0')}m`;
}

// ─── Normalizacja danych Wizzair ──────────────────────────────────────────────

/**
 * Przetwarza jeden rekord outboundFlight z Wizzair timetable.
 * Wizzair zwraca: departureStation, arrivalStation, departureDate, arrivalDate,
 *                 price: { amount, currencyCode }, flightCode, duration
 */
function normalizeWizzairFlight(f, from, to, origInfo, destInfo, id) {
  if (!f.departureDate) return null;

  const dateStr = f.departureDate.slice(0, 10);
  const today   = todayStr();
  if (dateStr < today) return null;

  const dow = classifyDow(dateStr);
  if (!dow) return null;

  const price1 = Math.round(f.price?.amount || f.regularFare?.fares?.[0]?.amount || 0);
  if (price1 === 0) return null;
  const price2 = Math.round(price1 * 1.7);
  if (price2 > MAX_BUDGET_RT) return null;

  const dDate   = new Date(dateStr);
  let retRaw    = dateStr;
  let pattern   = `${dow}-only`;
  let deptDay   = dow === 'fri' ? 'piątek' : dow === 'sat' ? 'sobota' : 'niedziela';
  let retDay    = deptDay;
  let dateLabel = fmtSingle(dDate, dow);

  if (dow === 'fri') {
    const sun = new Date(dDate); sun.setDate(sun.getDate() + 2);
    retRaw    = sun.toISOString().slice(0, 10);
    retDay    = 'niedziela';
    pattern   = 'fri-sun';
    dateLabel = fmtRange(dDate, sun, 3);
  } else if (dow === 'sat') {
    const sun = new Date(dDate); sun.setDate(sun.getDate() + 1);
    retRaw    = sun.toISOString().slice(0, 10);
    retDay    = 'niedziela';
    pattern   = 'sat-sun';
    dateLabel = fmtRange(dDate, sun, 2);
  }

  let deptH = 6, deptM = 0, arrH = 8, arrM = 30;
  if (f.departureDate?.length > 10) {
    const t = f.departureDate.slice(11, 16).split(':');
    deptH = parseInt(t[0], 10); deptM = parseInt(t[1], 10);
  }
  if (f.arrivalDate?.length > 10) {
    const t = f.arrivalDate.slice(11, 16).split(':');
    arrH = parseInt(t[0], 10); arrM = parseInt(t[1], 10);
  }
  const retDeptH = (deptH + 12) % 24;
  const retArrH  = (arrH + 12) % 24;

  return {
    id:        `w${id}`,
    airline:   'wizzair',
    from, to,
    fromCity:  origInfo.city,
    toCity:    destInfo.city,
    flag:      destInfo.flag,
    country:   destInfo.country,
    dept:      `${String(deptH).padStart(2,'0')}:${String(deptM).padStart(2,'0')}`,
    arr:       `${String(arrH).padStart(2,'0')}:${String(arrM).padStart(2,'0')}`,
    retDept:   `${String(retDeptH).padStart(2,'0')}:00`,
    retArr:    `${String(retArrH).padStart(2,'0')}:${String(arrM).padStart(2,'0')}`,
    deptDay,   retDay,
    dur:       f.arrivalDate && f.departureDate
                 ? calcDur(f.departureDate, f.arrivalDate)
                 : (f.duration || '2h 00m'),
    date:      dateLabel,
    raw:       dateStr,
    retRaw,
    month:     parseInt(dateStr.slice(5, 7), 10),
    year:      parseInt(dateStr.slice(0, 4), 10),
    price1, price2,
    sea:       destInfo.sea,
    lgbt:      destInfo.lgbt,
    lgbtN:     destInfo.lgbtN,
    distKm:    destInfo.distKm,
    passport:  destInfo.passport,
    visa:      destInfo.visa,
    currency:  destInfo.currency,
    englishOk: destInfo.englishOk,
    pattern,
    flightCode: f.flightCode || '',
  };
}

// ─── Zapis api-samples.json ───────────────────────────────────────────────────

let apiSamples = {
  capturedAt: new Date().toISOString(),
  note: 'Surowe próbki odpowiedzi z API Ryanair i Wizzair (zapis okresowy).',
  ryanair: { url: null, status: null, sampleResponse: null },
  wizzair: { url: null, status: null, sampleResponse: null, strategy: null },
};

function saveApiSamples() {
  try {
    apiSamples.capturedAt = new Date().toISOString();
    fs.writeFileSync('api-samples.json', JSON.stringify(apiSamples, null, 2), 'utf8');
  } catch {}
}

// ─── Główna pętla fetch ───────────────────────────────────────────────────────

async function fetchRealFlights() {
  const dateFrom = todayStr();
  const dateTo   = addMonths(dateFrom, MONTHS_AHEAD);

  const flights  = [];
  let idCounter  = 1;
  let errors     = 0;

  // ── Ryanair ──────────────────────────────────────────────────────────────
  const rRoutes = ROUTES.filter(r => r[2] === 'ryanair');
  console.log(`[refresh] Pobieranie ${rRoutes.length} tras Ryanair (${dateFrom} → ${dateTo})...`);

  for (let i = 0; i < rRoutes.length; i++) {
    const [from, to, , basePrice, durMin, deptHour] = rRoutes[i];
    const origInfo = ORIGINS[from];
    const destInfo = DESTS[to];
    if (!origInfo || !destInfo) continue;

    process.stdout.write(`[${i+1}/${rRoutes.length}] R ${from}→${to}... `);

    let fares = [], lastErr;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        fares = await fetchRyanairFares(from, to, dateFrom, dateTo);

        // Zapisz próbkę pierwszego udanego requesta
        if (!apiSamples.ryanair.status) {
          apiSamples.ryanair.url    = `https://www.ryanair.com/api/farfnd/v4/roundTripFares?...${from}...${to}`;
          apiSamples.ryanair.status = 200;
          if (fares[0]) {
            apiSamples.ryanair.sampleResponse = {
              route: `${from} → ${to}`,
              firstFare: fares[0],
              totalFares: fares.length,
              capturedAt: new Date().toISOString(),
            };
          }
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

  // ── Wizzair ───────────────────────────────────────────────────────────────
  const wRoutes = ROUTES.filter(r => r[2] === 'wizzair');
  console.log(`\n[refresh] Pobieranie ${wRoutes.length} tras Wizzair (${dateFrom} → ${dateTo})...`);

  let wizzBlocked   = 0;
  let wizzSuccess   = 0;
  let wizzTotal     = 0;
  let strategyLogged = false;

  for (let i = 0; i < wRoutes.length; i++) {
    const [from, to, , basePrice, durMin, deptHour] = wRoutes[i];
    const origInfo = ORIGINS[from];
    const destInfo = DESTS[to];
    if (!origInfo || !destInfo) continue;

    process.stdout.write(`[${i+1}/${wRoutes.length}] W ${from}→${to}... `);

    const { flights: rawFlights, blocked } = await fetchWizzairFares(from, to, dateFrom, dateTo);

    if (blocked) {
      wizzBlocked++;
      console.log(`⚠ zablokowane`);
    } else {
      if (!strategyLogged) {
        console.log(`\n[Wizzair] ✓ API działa`);
        strategyLogged = true;
        apiSamples.wizzair.strategy = 'api-direct-or-proxy';
        saveApiSamples();
      }
      let added = 0;
      for (const f of rawFlights) {
        const rec = normalizeWizzairFlight(f, from, to, origInfo, destInfo, idCounter);
        if (rec) { flights.push(rec); idCounter++; added++; wizzTotal++; }
      }
      wizzSuccess++;
      console.log(`✓ ${rawFlights.length} ofert (${added} weekendowych)`);

      // Próbka Wizzair
      if (!apiSamples.wizzair.status && rawFlights.length > 0) {
        apiSamples.wizzair.url    = `https://be.wizzair.com/${WZ_API_VERSIONS[0]}/Api/search/timetable`;
        apiSamples.wizzair.status = 200;
        apiSamples.wizzair.sampleResponse = {
          route: `${from} → ${to}`,
          firstFlight: rawFlights[0],
          totalFlights: rawFlights.length,
          capturedAt: new Date().toISOString(),
        };
        saveApiSamples();
      }
    }

    await sleep(WIZZAIR_DELAY);
  }

  // Ustal źródło
  const allWizzBlocked = wizzBlocked === wRoutes.length && wRoutes.length > 0;
  let source;
  if (allWizzBlocked) {
    console.log('\n[Wizzair] Wszystkie trasy zablokowane — Wizzair = generator statyczny');
    // Uzupełnij Wizzair z generatora
    const staticAll = generateFlights(new Date());
    const staticWizz = staticAll.filter(f => f.airline === 'wizzair');
    flights.push(...staticWizz);
    source = 'ryanair-api+wizzair-static';
  } else {
    source = wizzSuccess > 0 ? 'ryanair+wizzair-api' : 'ryanair-api';
  }

  console.log(`\n[Wizzair] Wynik: ${wizzSuccess}/${wRoutes.length} tras OK, ${wizzBlocked} zablokowanych, ${wizzTotal} lotów weekendowych`);

  return { flights, source, errors };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  REFRESH FLIGHTS — Ryanair + Wizzair');
  console.log('═══════════════════════════════════════════════════\n');

  if (typeof fetch === 'undefined') {
    console.log('⚠️  fetch() niedostępny — wymagany Node.js 18+. Używam generatora.\n');
    const flights = generateFlights(new Date());
    writeOutput(flights, 'static-generator-fallback');
    return;
  }

  let result;
  try {
    result = await fetchRealFlights();
  } catch (err) {
    console.error(`\n✗ Krytyczny błąd: ${err.message}`);
    console.log('   Używam fallback generatora');
    const flights = generateFlights(new Date());
    writeOutput(flights, 'static-generator-fallback');
    return;
  }

  if (result.flights.length === 0) {
    console.log('\n⚠️  API zwróciło 0 lotów — fallback do generatora');
    const flights = generateFlights(new Date());
    writeOutput(flights, 'static-generator-fallback');
    return;
  }

  writeOutput(result.flights, result.source);
}

function writeOutput(flights, source) {
  flights.sort((a, b) => a.raw.localeCompare(b.raw));

  const output = {
    lastUpdated: new Date().toISOString(),
    source,
    maxBudgetRT: MAX_BUDGET_RT,
    totalCount:  flights.length,
    flights,
  };

  // Zapisz flights.json w katalogu skryptu (root repo)
  const outPath = path.join(__dirname, 'flights.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  saveApiSamples();

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`✅ Zapisano ${flights.length} lotów`);
  console.log(`   Plik:   ${outPath}`);
  console.log(`   Źródło: ${source}`);
  console.log(`   Ryanair: ${flights.filter(f => f.airline === 'ryanair').length}`);
  console.log(`   Wizzair: ${flights.filter(f => f.airline === 'wizzair').length}`);
  console.log('═══════════════════════════════════════════════════');
}

if (require.main === module) {
  main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
