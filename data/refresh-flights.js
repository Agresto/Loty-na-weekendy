#!/usr/bin/env node
/**
 * scripts/refresh-flights.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pobiera prawdziwe ceny lotów z API Ryanair i Wizzair, łączy je z
 * metadanymi destynacji i zapisuje do data/flights.json.
 *
 * Wywoływany codziennie przez GitHub Actions cron
 * (.github/workflows/refresh-flights.yml).
 *
 * Użycie lokalnie:
 *   node scripts/refresh-flights.js
 *
 * Co robi (krok po kroku):
 *   1. Generuje listę weekendów na najbliższe 12 miesięcy
 *   2. Dla każdej trasy z ROUTES odpytuje Ryanair farfnd API
 *   3. Filtruje wyniki: tylko weekend trips ≤ 500 PLN R/T
 *   4. Wzbogaca o metadane (kraj, waluta, paszport, LGBT, etc.)
 *   5. Zapisuje wszystko do data/flights.json
 *
 * Jeśli API nie odpowie (CORS / błąd / timeout) — fallback do generatora,
 * który wytworzy realistyczne dane na podstawie cen bazowych.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');
const { generateFlights, ROUTES, DESTS, ORIGINS } = require('./generate-flights.js');

const MAX_BUDGET_RT = 500;
const MONTHS_AHEAD  = 6;     // Pobieraj loty na 6 mc do przodu (limit Ryanair API)
const MAX_RETRY     = 3;
const TIMEOUT_MS    = 15000;

/**
 * Wywołuje Ryanair farfnd API dla pary lotnisk.
 *
 * Endpoint:
 *   https://services-api.ryanair.com/farfnd/v4/oneWayFares
 *     ?departureAirportIataCode={FROM}
 *     &arrivalAirportIataCode={TO}
 *     &outboundDepartureDateFrom={YYYY-MM-DD}
 *     &outboundDepartureDateTo={YYYY-MM-DD}
 *     &priceValueTo={MAX}
 *     &currency=PLN
 *     &market=pl-pl
 *     &limit=50
 */
async function fetchRyanairFares(from, to, dateFrom, dateTo) {
  const params = new URLSearchParams({
    departureAirportIataCode:    from,
    arrivalAirportIataCode:      to,
    outboundDepartureDateFrom:   dateFrom,
    outboundDepartureDateTo:     dateTo,
    priceValueTo:                String(MAX_BUDGET_RT),
    currency:                    'PLN',
    market:                      'pl-pl',
    limit:                       '50',
  });
  const url = `https://services-api.ryanair.com/farfnd/v4/oneWayFares?${params}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'LotyNaWeekend-Bot/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.fares || [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wizzair public API
 *
 * Endpoint:
 *   POST https://be.wizzair.com/27.7.0/Api/search/timetable
 *   Body: { flightList: [{ departureStation, arrivalStation, from, to }] }
 *
 * UWAGA: Wizzair używa POST + custom headers + cookies.
 * W praktyce wymaga to headless browsera (Playwright/Puppeteer)
 * — nie wszystkie środowiska CI to obsługują.
 *
 * Tymczasowo: zwracamy [] (Wizzair fallback do generatora cen bazowych).
 */
async function fetchWizzairFares(/* from, to, date */) {
  // TODO: zaimplementować Wizzair API. Wymaga session cookies z głównej strony.
  // Patrz: https://github.com/cohaolain/ryanair-py/issues (similar approach for Wizz)
  return [];
}

/**
 * Sprawdza czy data to weekend (Pt/Sb/Nd) i zwraca informacje o wzorcu.
 */
function classifyWeekendDate(dateStr) {
  const d = new Date(dateStr);
  const dow = d.getDay();
  if (dow === 5) return { dow: 'fri', isWeekend: true };
  if (dow === 6) return { dow: 'sat', isWeekend: true };
  if (dow === 0) return { dow: 'sun', isWeekend: true };
  return { dow: null, isWeekend: false };
}

/**
 * Główna funkcja — pobiera prawdziwe loty z API.
 * @returns {Promise<{flights: Array, source: string, errors: number}>}
 */
async function fetchRealFlights() {
  const today = new Date();
  const dateFrom = today.toISOString().slice(0, 10);
  const dateToObj = new Date(today);
  dateToObj.setMonth(dateToObj.getMonth() + MONTHS_AHEAD);
  const dateTo = dateToObj.toISOString().slice(0, 10);

  const flights = [];
  let id = 1;
  let errors = 0;
  const ryanairRoutes = ROUTES.filter(r => r[2] === 'ryanair');
  const totalRoutes = ryanairRoutes.length;
  console.log(`[refresh] Pobieranie ${totalRoutes} tras Ryanair (${dateFrom} → ${dateTo})...`);

  for (let i = 0; i < ryanairRoutes.length; i++) {
    const [from, to, , basePrice, durMin, deptHour] = ryanairRoutes[i];
    const origInfo = ORIGINS[from];
    const destInfo = DESTS[to];
    if (!origInfo || !destInfo) continue;

    process.stdout.write(`[${i+1}/${totalRoutes}] ${from}→${to}... `);

    let fares = [];
    let lastErr;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        fares = await fetchRyanairFares(from, to, dateFrom, dateTo);
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRY) await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
    if (lastErr) {
      console.log(`✗ ${lastErr.message}`);
      errors++;
      continue;
    }
    console.log(`✓ ${fares.length} ofert`);

    // Filtruj tylko weekendy
    for (const fare of fares) {
      const out = fare.outbound;
      if (!out || !out.departureDate) continue;
      const dateStr = out.departureDate.slice(0, 10); // YYYY-MM-DD
      const { dow, isWeekend } = classifyWeekendDate(dateStr);
      if (!isWeekend) continue;

      const price1 = Math.round(out.price?.value || basePrice);
      const price2 = Math.round(price1 * 1.7);
      if (price2 > MAX_BUDGET_RT) continue;

      // Zbuduj rekord lotu
      // Powrót: zakładamy ten sam weekend (Pt→Nd, Sb→Nd, single-day)
      const dDate = new Date(dateStr);
      let retRaw = dateStr;
      let pattern = `${dow}-only`;
      let deptDay = dow === 'fri' ? 'piątek' : dow === 'sat' ? 'sobota' : 'niedziela';
      let retDay = deptDay;
      let dateLabel = formatSingleDate(dDate, dow);
      if (dow === 'fri') {
        // Domyślnie sugerujemy powrót w niedzielę
        const sun = new Date(dDate); sun.setDate(sun.getDate() + 2);
        retRaw = sun.toISOString().slice(0, 10);
        retDay = 'niedziela';
        pattern = 'fri-sun';
        dateLabel = formatRangeDate(dDate, sun, 3);
      } else if (dow === 'sat') {
        const sun = new Date(dDate); sun.setDate(sun.getDate() + 1);
        retRaw = sun.toISOString().slice(0, 10);
        retDay = 'niedziela';
        pattern = 'sat-sun';
        dateLabel = formatRangeDate(dDate, sun, 2);
      }

      const arrHour = (deptHour + Math.floor(durMin / 60)) % 24;
      const arrMin  = durMin % 60;
      const retHourBase = (deptHour + 12) % 24;
      const retArrHour = (retHourBase + Math.floor(durMin / 60)) % 24;

      flights.push({
        id:        `r${id++}`,
        airline:   'ryanair',
        from, to,
        fromCity:  origInfo.city,
        toCity:    destInfo.city,
        flag:      destInfo.flag,
        country:   destInfo.country,
        dept:      `${String(deptHour).padStart(2,'0')}:00`,
        arr:       `${String(arrHour).padStart(2,'0')}:${String(arrMin).padStart(2,'0')}`,
        retDept:   `${String(retHourBase).padStart(2,'0')}:00`,
        retArr:    `${String(retArrHour).padStart(2,'0')}:${String(arrMin).padStart(2,'0')}`,
        deptDay, retDay,
        dur:       `${Math.floor(durMin/60)}h ${String(durMin%60).padStart(2,'0')}m`,
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
      });
    }
    // Throttle żeby nie spamić API
    await new Promise(r => setTimeout(r, 300));
  }

  return { flights, source: 'ryanair-api', errors };
}

const MO_PL = ['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paź','Lis','Gru'];
function formatSingleDate(d, dow) {
  const lbl = dow === 'fri' ? 'Pt' : dow === 'sat' ? 'Sb' : 'Nd';
  return `${lbl}, ${d.getDate()} ${MO_PL[d.getMonth()]} ${d.getFullYear()}`;
}
function formatRangeDate(d1, d2, days) {
  const lbl = days === 3 ? 'Pt–Nd' : 'Sb–Nd';
  if (d1.getMonth() === d2.getMonth()) {
    return `${lbl}, ${d1.getDate()}–${d2.getDate()} ${MO_PL[d1.getMonth()]} ${d1.getFullYear()}`;
  }
  return `${lbl}, ${d1.getDate()} ${MO_PL[d1.getMonth()]} – ${d2.getDate()} ${MO_PL[d2.getMonth()]} ${d1.getFullYear()}`;
}

/**
 * Główna funkcja — wykonuje refresh i zapisuje plik.
 */
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  REFRESH FLIGHTS — Ryanair + Wizzair');
  console.log('═══════════════════════════════════════════════════\n');

  let result;
  let usedFallback = false;

  // Sprawdź czy fetch jest dostępny (Node 18+)
  if (typeof fetch === 'undefined') {
    console.log('⚠️  fetch() niedostępny — wymagany Node.js 18+');
    console.log('   Używam fallback generatora\n');
    usedFallback = true;
  } else {
    try {
      result = await fetchRealFlights();
      if (result.flights.length === 0 && result.errors > 5) {
        console.log(`\n⚠️  API zwróciło 0 lotów (${result.errors} błędów) — fallback do generatora`);
        usedFallback = true;
      }
    } catch (err) {
      console.error(`\n✗ Krytyczny błąd: ${err.message}`);
      console.log('   Używam fallback generatora');
      usedFallback = true;
    }
  }

  let flights, source;
  if (usedFallback) {
    flights = generateFlights(new Date());
    source = 'static-generator-fallback';
  } else {
    flights = result.flights;
    source = result.source;
  }

  flights.sort((a, b) => a.raw.localeCompare(b.raw));

  const output = {
    lastUpdated: new Date().toISOString(),
    source,
    maxBudgetRT: MAX_BUDGET_RT,
    totalCount: flights.length,
    flights,
  };

  const outPath = path.join(__dirname, '..', 'data', 'flights.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`✅ Zapisano ${flights.length} lotów`);
  console.log(`   Plik:    ${outPath}`);
  console.log(`   Źródło:  ${source}`);
  console.log(`   Budżet:  ≤ ${MAX_BUDGET_RT} PLN R/T`);
  console.log(`═══════════════════════════════════════════════════`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
