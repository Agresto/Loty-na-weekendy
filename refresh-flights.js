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
 * Użycie lokalnie:
 *   node refresh-flights.js
 *
 * Co robi (krok po kroku):
 *   1. Generuje listę weekendów na najbliższe 6 miesięcy
 *   2. Dla każdej trasy z ROUTES odpytuje Ryanair lub Wizzair API
 *   3. Filtruje wyniki: tylko weekend trips ≤ 500 PLN R/T
 *   4. Wzbogaca o metadane (kraj, waluta, paszport, LGBT, etc.)
 *   5. Zapisuje wszystko do flights.json
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

// Surowe próbki odpowiedzi API zapisywane do api-samples.json,
// żeby można było zweryfikować zgodność cen z tym, co pokazują strony linii.
const API_SAMPLES = {
  ryanair: { url: null, status: null, sampleResponse: null },
  wizzair: { url: null, status: null, sampleResponse: null },
};

/**
 * Zapisuje api-samples.json TERAZ — wywoływane okresowo, żeby nawet jeśli
 * workflow zostanie ubity timeoutem, plik diagnostyczny istniał.
 */
function saveApiSamplesNow() {
  try {
    const samplesPath = path.join(__dirname, 'api-samples.json');
    fs.writeFileSync(samplesPath, JSON.stringify({
      capturedAt:  new Date().toISOString(),
      note:        'Surowe próbki odpowiedzi z API Ryanair i Wizzair (zapis okresowy).',
      ryanair:     API_SAMPLES.ryanair,
      wizzair:     API_SAMPLES.wizzair,
      proxyMode:   WIZZAIR_PROXY_MODE || 'nieustalone',
    }, null, 2), 'utf8');
  } catch (e) {
    // ignoruj błędy zapisu — to tylko diagnostyka
  }
}

/**
 * Wywołuje Ryanair Fare Finder API dla pary lotnisk.
 *
 * Endpoint:
 *   https://www.ryanair.com/api/farfnd/v4/roundTripFares
 *
 * To jest ten sam endpoint, którego używa Fare Finder na stronie ryanair.com,
 * np. URL:
 *   https://www.ryanair.com/pl/pl/fare-finder?originIata=KRK&destinationIata=ANY
 *     &isReturn=true&adults=1&dateOut=2026-05-01&dateIn=2027-03-31
 *     &daysTrip=2&nightsFrom=1&nightsTo=3&dayOfWeek=FRIDAY,SATURDAY,SUNDAY
 *     &isFlexibleDay=true
 *
 * Zwraca obiekt {fares: [...]}, gdzie każdy element to pełna trasa
 * powrotna z dwoma lotami (outbound + inbound) i sumaryczną ceną
 * round-trip w `summary.price.value`.
 *
 * Parametry są dobrane tak, aby odpowiadać Fare Finderowi:
 *   • outboundDepartureDaysOfWeek=FRIDAY,SATURDAY,SUNDAY — tylko weekendy
 *   • durationFrom=1 / durationTo=3                       — od 1 do 3 nocy
 *   • priceValueTo=500                                     — limit budżetu R/T
 *   • currency=PLN, market=pl-pl                           — polski rynek
 */
async function fetchRyanairFares(from, to, dateFrom, dateTo) {
  // Inbound (powrót) może wypaść do 3 dni po wylocie, więc rozszerzamy okno
  const inboundDateTo = new Date(dateTo);
  inboundDateTo.setDate(inboundDateTo.getDate() + 3);
  const inboundTo = inboundDateTo.toISOString().slice(0, 10);

  // ⚠️ UWAGA: parametry MUSZĄ pasować do v4 roundTripFares.
  // Niedozwolone (powodują HTTP 400): priceValueTo, outboundDepartureDaysOfWeek,
  // limit. Filtrowanie weekendów i ceny robimy w Node.js po pobraniu danych.
  const params = new URLSearchParams({
    departureAirportIataCode:        from,
    arrivalAirportIataCode:          to,
    outboundDepartureDateFrom:       dateFrom,
    outboundDepartureDateTo:         dateTo,
    inboundDepartureDateFrom:        dateFrom,
    inboundDepartureDateTo:          inboundTo,
    durationFrom:                    '1',
    durationTo:                      '3',
    outboundDepartureTimeFrom:       '00:00',
    outboundDepartureTimeTo:         '23:59',
    inboundDepartureTimeFrom:        '00:00',
    inboundDepartureTimeTo:          '23:59',
    adultPaxCount:                   '1',
    teenPaxCount:                    '0',
    childPaxCount:                   '0',
    infantPaxCount:                  '0',
    searchMode:                      'ALL',
    currency:                        'PLN',
    market:                          'pl-pl',
  });
  const url = `https://www.ryanair.com/api/farfnd/v4/roundTripFares?${params}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'accept':          'application/json, text/plain, */*',
        'user-agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'referer':         `https://www.ryanair.com/pl/pl/fare-finder?originIata=${from}&destinationIata=${to}`,
        'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) {
      // Capture body for debugging — pomocne przy 400/403/429
      const errBody = await res.text().catch(() => '');
      if (!API_SAMPLES.ryanair.errorSample) {
        API_SAMPLES.ryanair.errorSample = {
          url, status: res.status, body: errBody.slice(0, 500),
          capturedAt: new Date().toISOString(),
        };
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();

    // Zapisz pierwszą udaną odpowiedź jako próbkę do weryfikacji
    if (!API_SAMPLES.ryanair.sampleResponse && data.fares?.length) {
      API_SAMPLES.ryanair.url            = url;
      API_SAMPLES.ryanair.status         = res.status;
      API_SAMPLES.ryanair.sampleResponse = {
        route:        `${from} → ${to}`,
        firstFare:    data.fares[0],
        totalFares:   data.fares.length,
        capturedAt:   new Date().toISOString(),
      };
    }

    return data.fares || [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wizzair public search API
 *
 * Endpoint:
 *   POST https://be.wizzair.com/27.7.0/Api/search/search
 *
 * To jest ten sam endpoint, którego używa wyszukiwarka na wizzair.com,
 * np. URL:
 *   https://www.wizzair.com/pl-pl/loty/wyszukiwarka-lotow/krakow/gdziekolwiek/
 *     0/0/0/1/0/0/2026-04-30/2026-04-30?flexible=anytime&duration=weekend
 *
 * Odpowiedź zawiera tablicę `outboundFlights[]`, gdzie KAŻDY lot ma listę
 * `fares[]` z taryfami. Każda taryfa ma flagę `wdc`:
 *   - `wdc: true`  → cena Wizz Discount Club (członkowska, niższa)
 *   - `wdc: false` → cena standardowa (publiczna)
 *
 * Filtrujemy WYŁĄCZNIE taryfy `wdc: false`, żeby pokazywać ceny dostępne
 * dla wszystkich (zgodnie z preferencją użytkownika).
 *
 * UWAGA: wymaga max 3 dni zakresu w jednym requeście (search API jest
 * dokładniejsze niż timetable, ale ciaśniejsze).
 */
// Rotacja User-Agentów żeby Wizzair Cloudflare nie blokowało
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];
let WIZZAIR_COOKIES = '';
let WIZZAIR_BLOCKED = false;     // jeśli true, omijamy Wizzair API w pętli
let WIZZAIR_429_COUNT = 0;       // licznik z rzędu HTTP 429
let WIZZAIR_PROXY_MODE = null;   // 'direct' | 'corsproxy' | 'allorigins' | 'codetabs'

// Lista publicznych proxy z otwartym CORS — używane gdy Cloudflare blokuje IP
// runnera GitHub Actions. Każde proxy próbujemy po kolei dopóki któryś nie zadziała.
const PROXY_STRATEGIES = [
  {
    name: 'direct',
    transform: (url, opts) => ({ url, opts }),
  },
  {
    name: 'corsproxy',
    transform: (url, opts) => ({
      url:  `https://corsproxy.io/?${encodeURIComponent(url)}`,
      opts,
    }),
  },
  {
    name: 'allorigins',
    transform: (url, opts) => {
      // AllOrigins dla POST wymaga przekazania body w specjalny sposób
      if (opts.method === 'POST') {
        return {
          url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
          opts,
        };
      }
      return { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, opts };
    },
  },
  {
    name: 'codetabs',
    transform: (url, opts) => ({
      url:  `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
      opts,
    }),
  },
];

/**
 * Wykonuje request do Wizzair API z automatycznym fallbackiem przez proxy.
 * Po pierwszym sukcesie zapamiętuje strategię w WIZZAIR_PROXY_MODE i używa
 * jej dla wszystkich kolejnych zapytań w tym runie. Sporadyczne błędy
 * (500/502/timeout) NIE dyskwalifikują strategii — proxy bywają chwilowo
 * przeciążone, więc dajemy im 3 próby z odstępem 1s.
 */
async function wizzairFetch(url, opts) {
  // Jeśli już znaleźliśmy działającą strategię, używamy jej z retry
  if (WIZZAIR_PROXY_MODE) {
    const strategy = PROXY_STRATEGIES.find(s => s.name === WIZZAIR_PROXY_MODE);
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { url: u, opts: o } = strategy.transform(url, opts);
        const res = await fetch(u, o);
        if (res.ok || res.status === 400 || res.status === 404) return res;
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastErr = err;
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
    throw lastErr;
  }

  // Pierwsze wywołanie — próbuj kolejnych strategii dopóki któraś nie odpowie z HTTP 2xx
  let lastError = null;
  for (const strategy of PROXY_STRATEGIES) {
    try {
      const { url: u, opts: o } = strategy.transform(url, opts);
      const res = await fetch(u, o);
      if (res.status === 429 || res.status === 403) {
        console.log(`[Wizzair] ${strategy.name}: HTTP ${res.status} (zablokowane)`);
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (res.ok || res.status === 400 || res.status === 404) {
        // Strategia działa — pamiętaj ją na resztę runa
        WIZZAIR_PROXY_MODE = strategy.name;
        console.log(`[Wizzair] ✓ Działająca strategia: ${strategy.name}`);
        return res;
      }
      // Inne błędy (500, 502) — może chwilowe, też próbujmy następnej strategii
      console.log(`[Wizzair] ${strategy.name}: HTTP ${res.status} (przejściowe)`);
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      console.log(`[Wizzair] ${strategy.name}: ${err.message}`);
    }
  }
  throw lastError || new Error('Wszystkie strategie proxy zawiodły');
}

/**
 * Próba pobrania cookies z głównej strony Wizzair (mechanizm pomocniczy).
 *
 * UWAGA: w praktyce strona główna Wizzair nie ustawia cookies w odpowiedzi
 * HTTP — robi to dopiero JavaScript po załadowaniu w przeglądarce. Funkcja
 * istnieje na wypadek gdyby Wizzair zmienił to w przyszłości, ale
 * aktualnie najczęściej kończy się brakiem cookies — co NIE jest błędem
 * i nie wpływa na działanie proxy chain w wizzairFetch().
 */
async function warmupWizzairSession() {
  try {
    const res = await fetch('https://wizzair.com/pl-pl', {
      headers: {
        'user-agent':      USER_AGENTS[0],
        'accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8',
      },
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      // Parsuj wszystkie cookies do jednego stringa
      WIZZAIR_COOKIES = setCookie.split(',')
        .map(c => c.split(';')[0].trim())
        .filter(c => c.includes('='))
        .join('; ');
      console.log(`[Wizzair] Sesja zainicjalizowana (${WIZZAIR_COOKIES.length} znaków cookies)`);
    }
    // Jeśli brak cookies, nic nie logujemy — to typowa sytuacja, nie błąd.
    // Proxy chain w wizzairFetch poradzi sobie bez cookies.
  } catch (err) {
    // Cicho ignorujemy — strona główna może być nieosiągalna z runnera,
    // a proxy chain i tak ją obejdzie
  }
}

async function fetchWizzairFares(from, to, dateFrom, dateTo) {
  // search API zwraca dokładne loty na konkretne daty — chunkujemy po 3 dni
  const chunks = chunkDateRange(dateFrom, dateTo, 3);
  const allFlights = [];

  for (const chunk of chunks) {
    if (WIZZAIR_BLOCKED) break;     // pełna blokada — przerywamy

    const body = {
      isFlightChange:    false,
      isSeniorOrStudent: false,
      flightList: [{
        departureStation: from,
        arrivalStation:   to,
        departureDate:    chunk.from,
      }],
      adultCount:  1,
      childCount:  0,
      infantCount: 0,
      wdc:         false,    // ⚠️ false = pokaż ceny BEZ Wizz Discount Club
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // Rotacja user-agentów żeby zmniejszyć szansę na blokadę Cloudflare
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    try {
      const headers = {
        'authority':       'be.wizzair.com',
        'accept':          'application/json, text/plain, */*',
        'origin':          'https://wizzair.com',
        'user-agent':      ua,
        'content-type':    'application/json;charset=UTF-8',
        'referer':         `https://wizzair.com/pl-pl/loty/wyszukiwarka-lotow/${from.toLowerCase()}/${to.toLowerCase()}/0/0/0/1/0/0/${chunk.from}/${chunk.from}`,
        'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8',
        'sec-fetch-dest':  'empty',
        'sec-fetch-mode':  'cors',
        'sec-fetch-site':  'same-site',
      };
      if (WIZZAIR_COOKIES) headers['cookie'] = WIZZAIR_COOKIES;

      const res = await wizzairFetch('https://be.wizzair.com/27.7.0/Api/search/search', {
        method: 'POST',
        signal: controller.signal,
        headers,
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        // Rate limit — proxy chain w wizzairFetch już wszystkie spróbował,
        // więc nie ma sensu próbować dalej dla tej daty
        if (!API_SAMPLES.wizzair.errorSample) {
          API_SAMPLES.wizzair.errorSample = {
            url: 'https://be.wizzair.com/27.7.0/Api/search/search',
            status: 429, requestBody: body,
            note: 'Cloudflare rate limit przez wszystkie proxy',
            capturedAt: new Date().toISOString(),
          };
        }
        WIZZAIR_429_COUNT = (WIZZAIR_429_COUNT || 0) + 1;
        // Po 30 z rzędu HTTP 429 (znacznie więcej tolerancji niż wcześniej)
        // uznajemy że Wizzair jest niedostępny dla tego runa
        if (WIZZAIR_429_COUNT >= 30) {
          WIZZAIR_BLOCKED = true;
          console.warn('[Wizzair] 30 razy z rzędu HTTP 429 — przerywam dalsze próby Wizzair');
        }
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      WIZZAIR_429_COUNT = 0;       // reset licznika po sukcesie

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        if (!API_SAMPLES.wizzair.errorSample) {
          API_SAMPLES.wizzair.errorSample = {
            url: 'https://be.wizzair.com/27.7.0/Api/search/search',
            requestBody: body, status: res.status,
            body: errBody.slice(0, 500),
            capturedAt: new Date().toISOString(),
          };
        }
        throw new Error(`Wizzair HTTP ${res.status}`);
      }

      const data = await res.json();

      // Diagnostyka: zapisz próbkę pierwszej PUSTEJ odpowiedzi z sukcesem,
      // żeby odróżnić "API zwraca 200, ale brak lotów" od "API odpowiada błędem"
      if (!API_SAMPLES.wizzair.emptyResponseSample &&
          (!data.outboundFlights || data.outboundFlights.length === 0)) {
        API_SAMPLES.wizzair.emptyResponseSample = {
          route: `${from} → ${to}`,
          date: chunk.from,
          requestBody: body,
          responseKeys: Object.keys(data),
          responsePreview: JSON.stringify(data).slice(0, 500),
          capturedAt: new Date().toISOString(),
        };
      }

      // Zapisz pierwszą udaną odpowiedź jako próbkę do weryfikacji
      if (!API_SAMPLES.wizzair.sampleResponse && data.outboundFlights?.length) {
        API_SAMPLES.wizzair.url            = 'https://be.wizzair.com/27.7.0/Api/search/search';
        API_SAMPLES.wizzair.status         = res.status;
        API_SAMPLES.wizzair.sampleResponse = {
          route:        `${from} → ${to}`,
          requestBody:  body,
          firstFlight:  data.outboundFlights[0],
          totalFlights: data.outboundFlights.length,
          capturedAt:   new Date().toISOString(),
        };
      }

      // Wizzair search API zwraca outboundFlights[] z fares[] na każdy lot.
      //
      // ⚠️ WAŻNE WYJAŚNIENIE FLAGI `wdc`:
      // Wbrew pierwszej intuicji, `fare.wdc === true` NIE oznacza "to cena
      // członkowska Wizz Discount Club". Flaga ta mówi tylko, że taryfa
      // PODLEGA systemowi WDC — i dotyczy to praktycznie wszystkich taryf
      // Wizzair, w tym tych standardowych w bundle BASIC.
      //
      // To, że pokazujemy ceny BEZ Wizz Discount Club, zapewnia parametr
      // `wdc: false` w treści requestu — API zwraca wtedy `discountedPrice`
      // równe `basePrice` (rabat WDC nie jest stosowany).
      //
      // Wybieramy więc najtańszą taryfę z bundle BASIC (najtańszy bilet
      // dostępny dla każdego), bez filtrowania po fladze `wdc`.
      if (Array.isArray(data.outboundFlights)) {
        for (const f of data.outboundFlights) {
          const allFares = f.fares || [];
          if (!allFares.length) continue;

          // Preferuj BASIC bundle (najtańszy bilet); jeśli go nie ma,
          // bierz najtańszą dostępną taryfę
          const basicFares = allFares.filter(fare => fare.bundle === 'BASIC');
          const candidates = basicFares.length ? basicFares : allFares;

          // Wybieramy najtańszą — discountedPrice (po WDC), ale skoro
          // wysłaliśmy wdc:false w request, to jest cena standardowa
          const cheapest = candidates.reduce((min, fare) => {
            const p    = fare.discountedPrice?.amount ?? fare.basePrice?.amount ?? Infinity;
            const minP = min.discountedPrice?.amount ?? min.basePrice?.amount ?? Infinity;
            return p < minP ? fare : min;
          });

          const priceAmount = cheapest.discountedPrice?.amount ??
                              cheapest.basePrice?.amount ?? 0;
          const priceCurrency = cheapest.discountedPrice?.currencyCode ??
                                cheapest.basePrice?.currencyCode ?? 'PLN';

          allFlights.push({
            outbound: {
              departureAirport: { iataCode: f.departureStation },
              arrivalAirport:   { iataCode: f.arrivalStation },
              departureDate:    f.departureDateTime || `${chunk.from}T00:00:00`,
              arrivalDate:      f.arrivalDateTime,
              price: {
                value:        priceAmount,
                currencyCode: priceCurrency,
              },
              flightCode: `${f.carrierCode || 'W6'}${f.flightNumber || ''}`,
            },
          });
        }
      }
    } catch (err) {
      console.warn(`[Wizzair] ${from}→${to} ${chunk.from}: ${err.message}`);
      // Nie przerywamy — kontynuujemy następny chunk
    } finally {
      clearTimeout(timer);
    }

    // Throttle żeby nie spamić API
    await new Promise(r => setTimeout(r, 600));
  }

  return allFlights;
}

/**
 * Dzieli zakres dat na chunki maksymalnej długości (np. 42 dni dla Wizzair).
 * Zwraca tablicę {from, to} w formacie YYYY-MM-DD.
 */
function chunkDateRange(dateFrom, dateTo, maxDays) {
  const chunks = [];
  const startDate = new Date(dateFrom);
  const endDate   = new Date(dateTo);

  let current = new Date(startDate);
  // ⚠️ <= zamiast < — żeby pojedynczy dzień (dateFrom === dateTo) też produkował chunk
  while (current <= endDate) {
    const chunkEnd = new Date(current);
    chunkEnd.setDate(chunkEnd.getDate() + maxDays - 1);
    if (chunkEnd > endDate) chunkEnd.setTime(endDate.getTime());

    chunks.push({
      from: current.toISOString().slice(0, 10),
      to:   chunkEnd.toISOString().slice(0, 10),
    });

    current.setDate(current.getDate() + maxDays);
  }
  return chunks;
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
 * Buduje pojedynczy rekord lotu — wspólny dla Ryanair i Wizzair.
 *
 * @param {string} [retRawOverride] - rzeczywista data powrotu z API
 *   (Ryanair roundTripFares zwraca prawdziwy inbound.departureDate;
 *    bez tej wartości funkcja wylicza powrót na podstawie wzorca weekendu).
 */
function buildFlightRecord({ id, airline, from, to, origInfo, destInfo,
                              dateStr, dow, durMin, deptHour, price1, price2,
                              retRawOverride }) {
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
    retDay = 'niedziela'; pattern = 'fri-sun';
    dateLabel = formatRangeDate(dDate, sun, 3);
  } else if (dow === 'sat') {
    const sun = new Date(dDate); sun.setDate(sun.getDate() + 1);
    retRaw = sun.toISOString().slice(0, 10);
    retDay = 'niedziela'; pattern = 'sat-sun';
    dateLabel = formatRangeDate(dDate, sun, 2);
  }

  // Jeśli API zwróciło prawdziwą datę powrotu — nadpisz wyliczoną
  if (retRawOverride && /^\d{4}-\d{2}-\d{2}$/.test(retRawOverride) && retRawOverride !== dateStr) {
    retRaw = retRawOverride;
    const retDate = new Date(retRawOverride);
    const retDow = retDate.getDay();
    retDay = retDow === 5 ? 'piątek' : retDow === 6 ? 'sobota' : 'niedziela';
    // Aktualizuj wzorzec i etykietę daty
    const daysDiff = Math.round((retDate - dDate) / 86400000);
    if (daysDiff === 0) {
      pattern = `${dow}-only`;
      dateLabel = formatSingleDate(dDate, dow);
    } else if (dow === 'fri' && retDow === 6) {
      pattern = 'fri-sat';
      dateLabel = formatRangeDate(dDate, retDate, 2);
    } else if (dow === 'fri' && retDow === 0) {
      pattern = 'fri-sun';
      dateLabel = formatRangeDate(dDate, retDate, 3);
    } else if (dow === 'sat' && retDow === 0) {
      pattern = 'sat-sun';
      dateLabel = formatRangeDate(dDate, retDate, 2);
    }
  }

  const arrHour    = (deptHour + Math.floor(durMin / 60)) % 24;
  const arrMin     = durMin % 60;
  const retHourBase = (deptHour + 12) % 24;
  const retArrHour  = (retHourBase + Math.floor(durMin / 60)) % 24;

  return {
    id, airline, from, to,
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
  };
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

  // ── RYANAIR ──────────────────────────────────────────────────
  const ryanairRoutes = ROUTES.filter(r => r[2] === 'ryanair');
  console.log(`[refresh] Pobieranie ${ryanairRoutes.length} tras Ryanair (${dateFrom} → ${dateTo})...`);

  for (let i = 0; i < ryanairRoutes.length; i++) {
    const [from, to, , basePrice, durMin, deptHour] = ryanairRoutes[i];
    const origInfo = ORIGINS[from];
    const destInfo = DESTS[to];
    if (!origInfo || !destInfo) continue;

    process.stdout.write(`[${i+1}/${ryanairRoutes.length}] R ${from}→${to}... `);

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
    if (lastErr) { console.log(`✗ ${lastErr.message}`); errors++; continue; }
    console.log(`✓ ${fares.length} ofert`);

    for (const fare of fares) {
      // roundTripFares: każdy fare ma outbound + inbound + summary
      const out = fare.outbound;
      const inb = fare.inbound;
      if (!out || !out.departureDate) continue;

      const dateStr = out.departureDate.slice(0, 10);
      const { dow, isWeekend } = classifyWeekendDate(dateStr);
      if (!isWeekend) continue;

      // Cena round-trip pochodzi z summary; jeśli go nie ma, sumujemy obie nogi
      const rtPrice = fare.summary?.price?.value ??
                      ((out.price?.value || 0) + (inb?.price?.value || 0));
      const owPrice = out.price?.value ?? (rtPrice / 2);

      const price1 = Math.round(owPrice || basePrice);
      const price2 = Math.round(rtPrice || price1 * 1.7);
      if (price2 > MAX_BUDGET_RT) continue;

      // Dla rzeczywistych godzin lotu używamy danych z API zamiast bazowych
      const realDeptHour = parseInt(out.departureDate.slice(11, 13), 10) || deptHour;
      const inbDateStr   = inb?.departureDate?.slice(0, 10);

      flights.push(buildFlightRecord({
        id: `r${id++}`, airline: 'ryanair',
        from, to, origInfo, destInfo,
        dateStr, dow, durMin, deptHour: realDeptHour, price1, price2,
        retRawOverride: inbDateStr,    // prawdziwa data powrotu z API
      }));
    }
    await new Promise(r => setTimeout(r, 300));
  }
  saveApiSamplesNow();   // Zapisz po Ryanair (na wypadek gdyby Wizzair się nie udał)

  // ── WIZZAIR ──────────────────────────────────────────────────
  // Wizzair search API wymaga konkretnej daty (1 dzień = 1 request).
  // Iterujemy po WYBRANYCH datach weekendowych (próbka, nie wszystkie 79),
  // bo proxy chain są wolne i 79 × 46 = 3634 requestów nie zmieści się
  // w timeoucie GitHub Actions.
  const allWeekendDates = enumerateWeekendDates(dateFrom, dateTo);
  const weekendDates    = sampleWeekendDates(allWeekendDates, 2);
  const wizzairRoutes = ROUTES.filter(r => r[2] === 'wizzair');
  console.log(`\n[refresh] Pobieranie ${wizzairRoutes.length} tras Wizzair × ${weekendDates.length} dni próbkowych (z ${allWeekendDates.length} weekendowych)...`);
  console.log(`[refresh] Wizzair będzie próbować przez proxy chain: ${PROXY_STRATEGIES.map(s=>s.name).join(' → ')}`);

  // Najpierw zainicjalizuj sesję cookies (Cloudflare często wymaga tego
  // przed przyjęciem zapytań do API). To zadziała tylko dla strategii 'direct';
  // w razie blokady wizzairFetch sam fallbackuje do proxy.
  await warmupWizzairSession();

  for (let i = 0; i < wizzairRoutes.length; i++) {
    if (WIZZAIR_BLOCKED) {
      console.log(`[Wizzair] Pomijam pozostałe ${wizzairRoutes.length - i} tras (globalna blokada Cloudflare)`);
      break;
    }
    const [from, to, , basePrice, durMin, deptHour] = wizzairRoutes[i];
    const origInfo = ORIGINS[from];
    const destInfo = DESTS[to];
    if (!origInfo || !destInfo) continue;

    process.stdout.write(`[${i+1}/${wizzairRoutes.length}] W ${from}→${to}... `);

    let totalFares = 0;
    let routeError = null;

    for (const dateStr of weekendDates) {
      if (WIZZAIR_BLOCKED) break;
      let fares;
      try {
        fares = await fetchWizzairFares(from, to, dateStr, dateStr);
      } catch (err) {
        routeError = err.message;
        continue;
      }
      totalFares += fares.length;

      for (const fare of fares) {
        const out = fare.outbound;
        if (!out || !out.departureDate) continue;
        const flightDate = out.departureDate.slice(0, 10);
        const { dow, isWeekend } = classifyWeekendDate(flightDate);
        if (!isWeekend) continue;

        const price1 = Math.round(out.price?.value || basePrice);
        const price2 = Math.round(price1 * 1.7);
        if (price2 > MAX_BUDGET_RT) continue;

        flights.push(buildFlightRecord({
          id: `w${id++}`, airline: 'wizzair',
          from, to, origInfo, destInfo,
          dateStr: flightDate, dow, durMin, deptHour, price1, price2
        }));
      }
    }

    if (routeError && totalFares === 0) {
      console.log(`✗ ${routeError}`); errors++;
    } else {
      console.log(`✓ ${totalFares} ofert`);
    }
    saveApiSamplesNow();   // Zapisz po każdej trasie — żeby diagnostyka przetrwała timeout
  }

  // Jeśli Wizzair został zablokowany przez Cloudflare, uzupełnij loty
  // Wizzair statycznym generatorem, żeby UI nie miał pustego "💜 Wizzair: 0".
  // Loty Ryanair zostają z prawdziwego API.
  const wizzairCount = flights.filter(f => f.airline === 'wizzair').length;
  let source = 'ryanair+wizzair-api';
  if (wizzairCount === 0 && WIZZAIR_BLOCKED) {
    console.log('\n[refresh] Wizzair zablokowany — uzupełniam loty Wizzair generatorem statycznym');
    const staticFlights = generateFlights(new Date());
    const staticWizzair = staticFlights.filter(f => f.airline === 'wizzair');
    flights.push(...staticWizzair);
    source = 'ryanair-api+wizzair-static';
    console.log(`[refresh] Dodano ${staticWizzair.length} statycznych lotów Wizzair`);
  }

  return { flights, source, errors };
}

/**
 * Zwraca listę dat YYYY-MM-DD, które są piątkami, sobotami lub niedzielami,
 * w zakresie [dateFrom, dateTo] włącznie.
 */
function enumerateWeekendDates(dateFrom, dateTo) {
  const dates = [];
  const start = new Date(dateFrom);
  const end   = new Date(dateTo);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 5 || dow === 6) {
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return dates;
}

/**
 * Wybiera reprezentatywną próbkę weekendów z całego okna czasowego.
 * Zamiast pytać o WSZYSTKIE 79 dni weekendowych (co przekraczałoby timeout
 * GitHub Actions z proxy), bierzemy 1-2 weekendy z każdego miesiąca.
 *
 * Przy 46 trasach × 12 dni × 1s opóźnienia = ~9 minut, mieści się w timeoucie.
 */
function sampleWeekendDates(allWeekends, samplesPerMonth = 2) {
  const byMonth = {};
  for (const d of allWeekends) {
    const month = d.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(d);
  }
  const samples = [];
  for (const month in byMonth) {
    const days = byMonth[month];
    // Bierz pierwszy piątek i pierwszą sobotę w miesiącu (jeśli są)
    const firstFri = days.find(d => new Date(d).getDay() === 5);
    const firstSat = days.find(d => new Date(d).getDay() === 6);
    if (firstFri) samples.push(firstFri);
    if (firstSat && samplesPerMonth >= 2) samples.push(firstSat);
  }
  return samples;
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
      // Tylko jeśli API kompletnie nic nie zwróciło — fallback do generatora.
      // Inaczej zachowujemy nawet częściowe dane (np. samo Ryanair gdy
      // Wizzair zwrócił 403 lub odwrotnie).
      if (result.flights.length === 0) {
        console.log(`\n⚠️  API nie zwróciło ŻADNYCH lotów (${result.errors} błędów) — fallback do generatora`);
        usedFallback = true;
      } else {
        console.log(`\n✓ Pobrano ${result.flights.length} lotów z API (${result.errors} błędów po drodze)`);
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
    source  = 'static-generator-fallback';
  } else {
    flights = result.flights;
    source  = result.source;
  }

  flights.sort((a, b) => a.raw.localeCompare(b.raw));

  const output = {
    lastUpdated: new Date().toISOString(),
    source,
    maxBudgetRT: MAX_BUDGET_RT,
    totalCount: flights.length,
    flights,
  };

  // ⚠️ Plik zapisywany w katalogu głównym repo (nie w data/!)
  const outPath = path.join(__dirname, 'flights.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  // Zapisz próbki surowych odpowiedzi API (do weryfikacji zgodności cen)
  const samplesPath = path.join(__dirname, 'api-samples.json');
  fs.writeFileSync(samplesPath, JSON.stringify({
    capturedAt:  new Date().toISOString(),
    note:        'Surowe próbki odpowiedzi z API Ryanair i Wizzair. Pozwalają porównać ceny w flights.json z tym, co zwraca API.',
    ryanair:     API_SAMPLES.ryanair,
    wizzair:     API_SAMPLES.wizzair,
  }, null, 2), 'utf8');

  const ryCount = flights.filter(f => f.airline === 'ryanair').length;
  const wzCount = flights.filter(f => f.airline === 'wizzair').length;

  console.log(`\n═══════════════════════════════════════════════════`);
  console.log(`✅ Zapisano ${flights.length} lotów`);
  console.log(`   Plik:    ${outPath}`);
  console.log(`   Źródło:  ${source}`);
  console.log(`   Budżet:  ≤ ${MAX_BUDGET_RT} PLN R/T`);
  console.log(`   Linie:   Ryanair ${ryCount} · Wizzair ${wzCount}`);
  console.log(`═══════════════════════════════════════════════════`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
