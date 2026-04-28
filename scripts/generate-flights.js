#!/usr/bin/env node
/**
 * scripts/generate-flights.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generuje data/flights.json z kompaktowych reguł routes × dates.
 *
 * Użycie:
 *   node scripts/generate-flights.js
 *
 * Co robi:
 *   • Łączy ROUTES (lotnisko-lotnisko-linia-cena) z DATES (weekendy w przyszłości)
 *   • Każdy lot ma realistyczne ceny (1-stronną i powrót) + dane miejsca docelowego
 *   • Filtruje wyniki: tylko loty ≤ MAX_BUDGET PLN w obie strony (domyślnie 500)
 *   • Zapisuje do data/flights.json z timestamp ostatniej aktualizacji
 *
 * UWAGA - PRODUKCJA:
 *   W produkcji ten skrypt NIE generuje randomowych danych — jest wywoływany
 *   przez GitHub Actions cron i pobiera prawdziwe ceny z:
 *     • Ryanair farfnd API:  https://services-api.ryanair.com/farfnd/v4/...
 *     • Wizzair public API:  https://wizzair.com/api/timetable/...
 *   Patrz: scripts/refresh-flights.js i .github/workflows/refresh-flights.yml
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs = require('fs');
const path = require('path');

const MAX_BUDGET_RT = 500; // Maksymalna cena w obie strony (PLN)

// ═════════════════════════════════════════════════════════════════════════════
// DESTYNACJE — jeden wpis = stałe metadane miejsca docelowego
// ═════════════════════════════════════════════════════════════════════════════
const DESTS = {
  TIA: {city:'Tirana',           country:'Albania',          flag:'🇦🇱',distKm:4, passport:false,visa:'brak',  currency:'ALL L',  englishOk:false,sea:false,lgbt:false,lgbtN:'Albania – brak pełnych praw LGBTQ+'},
  SKP: {city:'Skopje',           country:'Macedonia Pn.',    flag:'🇲🇰',distKm:21,passport:false,visa:'brak',  currency:'MKD ден',englishOk:false,sea:false,lgbt:false,lgbtN:'Macedonia Pn. – brak pełnych praw LGBTQ+'},
  SOF: {city:'Sofia',            country:'Bułgaria',         flag:'🇧🇬',distKm:8, passport:false,visa:'brak',  currency:'BGN лв',englishOk:true, sea:false,lgbt:false,lgbtN:'Bułgaria – ograniczone prawa LGBTQ+'},
  OTP: {city:'Bukareszt',        country:'Rumunia',          flag:'🇷🇴',distKm:18,passport:false,visa:'brak',  currency:'RON lei',englishOk:true,sea:false,lgbt:false,lgbtN:'Rumunia – ograniczone prawa LGBTQ+'},
  BUD: {city:'Budapeszt',        country:'Węgry',            flag:'🇭🇺',distKm:23,passport:false,visa:'brak',  currency:'HUF Ft', englishOk:true, sea:false,lgbt:false,lgbtN:'Węgry – konstytucja zakazuje małżeństw jednopłciowych'},
  VIE: {city:'Wiedeń',           country:'Austria',          flag:'🇦🇹',distKm:18,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:true, lgbtN:'Wiedeń – stolica przyjazna LGBTQ+, doroczny Vienna Pride'},
  PRG: {city:'Praga',            country:'Czechy',           flag:'🇨🇿',distKm:18,passport:false,visa:'brak',  currency:'CZK Kč', englishOk:true, sea:false,lgbt:true, lgbtN:'Czechy – tolerancyjny kraj, Prague Pride co rok'},
  BGY: {city:'Bergamo (Mediolan)',country:'Włochy',          flag:'🇮🇹',distKm:50,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:true, lgbtN:'Włochy – aktywna społeczność queer w dużych miastach'},
  CIA: {city:'Rzym Ciampino',    country:'Włochy',           flag:'🇮🇹',distKm:15,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:true, lgbtN:'Rzym – aktywna społeczność queer'},
  FCO: {city:'Rzym Fiumicino',   country:'Włochy',           flag:'🇮🇹',distKm:30,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:true, lgbtN:'Rzym – aktywna społeczność queer'},
  NAP: {city:'Neapol',           country:'Włochy',           flag:'🇮🇹',distKm:7, passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:true, lgbt:true, lgbtN:'Włochy – aktywna społeczność queer w dużych miastach'},
  BCN: {city:'Barcelona',        country:'Hiszpania',        flag:'🇪🇸',distKm:14,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:true, lgbt:true, lgbtN:'Barcelona – queer-friendly stolica Europy'},
  PMI: {city:'Palma Mallorca',   country:'Hiszpania',        flag:'🇪🇸',distKm:9, passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:true, lgbt:true, lgbtN:'Mallorca – przyjazna LGBTQ+'},
  ALC: {city:'Alicante',         country:'Hiszpania',        flag:'🇪🇸',distKm:11,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:true, lgbt:true, lgbtN:'Hiszpania – jeden z najbardziej tolerancyjnych krajów Europy'},
  AGP: {city:'Malaga',           country:'Hiszpania',        flag:'🇪🇸',distKm:8, passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:true, lgbt:true, lgbtN:'Hiszpania – jeden z najbardziej tolerancyjnych krajów Europy'},
  MAD: {city:'Madryt',           country:'Hiszpania',        flag:'🇪🇸',distKm:13,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:true, lgbtN:'Hiszpania – jeden z najbardziej tolerancyjnych krajów Europy'},
  LIS: {city:'Lizbona',          country:'Portugalia',       flag:'🇵🇹',distKm:11,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:true, lgbtN:'Portugalia – jeden z najbardziej tolerancyjnych krajów Europy'},
  OPO: {city:'Porto',            country:'Portugalia',       flag:'🇵🇹',distKm:11,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:true, lgbtN:'Portugalia – jeden z najbardziej tolerancyjnych krajów Europy'},
  ATH: {city:'Ateny',            country:'Grecja',           flag:'🇬🇷',distKm:35,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:true, lgbt:true, lgbtN:'Ateny – aktywna społeczność LGBTQ+'},
  HER: {city:'Heraklion (Kreta)',country:'Grecja',           flag:'🇬🇷',distKm:5, passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:true, lgbt:true, lgbtN:'Kreta – popularna wśród turystów LGBTQ+'},
  RHO: {city:'Rodos',            country:'Grecja',           flag:'🇬🇷',distKm:14,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:true, lgbt:true, lgbtN:'Grecja – ślubuje LGBTQ+ od 2024'},
  DUB: {city:'Dublin',           country:'Irlandia',         flag:'🇮🇪',distKm:12,passport:true, visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:true, lgbtN:'Irlandia – pierwsze referendum za małżeństwami jednopłciowymi'},
  STN: {city:'Londyn Stansted',  country:'Wielka Brytania',  flag:'🇬🇧',distKm:60,passport:true, visa:'brak',  currency:'GBP £',  englishOk:true, sea:false,lgbt:true, lgbtN:'Londyn – jedna z najbardziej LGBTQ+ friendly metropolii'},
  AMS: {city:'Amsterdam',        country:'Holandia',         flag:'🇳🇱',distKm:18,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:true, lgbtN:'Holandia – ojczyzna pierwszego małżeństwa jednopłciowego'},
  EIN: {city:'Eindhoven',        country:'Holandia',         flag:'🇳🇱',distKm:9, passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:true, lgbtN:'Holandia – ojczyzna pierwszego małżeństwa jednopłciowego'},
  BVA: {city:'Paryż Beauvais',   country:'Francja',          flag:'🇫🇷',distKm:85,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:true, lgbtN:'Paryż – aktywna społeczność LGBTQ+, Marais district'},
  NCE: {city:'Nicea',             country:'Francja',          flag:'🇫🇷',distKm:7, passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:true, lgbt:true, lgbtN:'Francja – progresywna polityka LGBTQ+'},
  OSL: {city:'Oslo',             country:'Norwegia',         flag:'🇳🇴',distKm:50,passport:false,visa:'brak',  currency:'NOK kr', englishOk:true, sea:false,lgbt:true, lgbtN:'Norwegia – zalegalizowane małżeństwa jednopłciowe od 2009'},
  RIX: {city:'Ryga',             country:'Łotwa',            flag:'🇱🇻',distKm:10,passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:false,lgbt:false,lgbtN:'Łotwa – ograniczone prawa LGBTQ+'},
  VAR: {city:'Warna',            country:'Bułgaria',         flag:'🇧🇬',distKm:8, passport:false,visa:'brak',  currency:'BGN лв',englishOk:true, sea:true, lgbt:false,lgbtN:'Bułgaria – ograniczone prawa LGBTQ+'},
  MLA: {city:'Malta',            country:'Malta',            flag:'🇲🇹',distKm:8, passport:false,visa:'brak',  currency:'EUR €',  englishOk:true, sea:true, lgbt:true, lgbtN:'Malta – #1 w Europie pod względem praw LGBTQ+ wg ILGA'},
};

// ═════════════════════════════════════════════════════════════════════════════
// LOTNISKA STARTOWE (polskie)
// ═════════════════════════════════════════════════════════════════════════════
const ORIGINS = {
  KTW: {city:'Katowice'},
  KRK: {city:'Kraków'},
  WAW: {city:'Warszawa'},
  WRO: {city:'Wrocław'},
  GDN: {city:'Gdańsk'},
  POZ: {city:'Poznań'},
};

// ═════════════════════════════════════════════════════════════════════════════
// TRASY — [origin, dest, airline, basePrice1way, durationMin, deptHour]
// Cena to przybliżenie, w finalnym locie zostanie zmodyfikowana sezonowo.
// ═════════════════════════════════════════════════════════════════════════════
const ROUTES = [
  // ── KTW ──
  ['KTW','TIA','wizzair', 99,  160, 6],
  ['KTW','SKP','wizzair', 119, 145, 10],
  ['KTW','SOF','wizzair', 139, 175, 8],
  ['KTW','OTP','wizzair', 129, 130, 14],
  ['KTW','BUD','wizzair', 99,  90,  18],
  ['KTW','BCN','wizzair', 199, 200, 6],
  ['KTW','BCN','ryanair', 189, 200, 7],
  ['KTW','ALC','ryanair', 219, 230, 6],
  ['KTW','PMI','wizzair', 229, 220, 10],
  ['KTW','FCO','wizzair', 169, 145, 11],
  ['KTW','CIA','ryanair', 159, 150, 6],
  ['KTW','NAP','wizzair', 189, 165, 13],
  ['KTW','STN','ryanair', 169, 155, 6],
  ['KTW','DUB','ryanair', 199, 195, 8],
  ['KTW','AMS','ryanair', 149, 115, 7],
  ['KTW','EIN','wizzair', 129, 115, 18],
  ['KTW','VAR','wizzair', 159, 150, 5],
  ['KTW','RHO','wizzair', 239, 195, 9],
  ['KTW','MAD','ryanair', 219, 230, 13],
  // ── KRK ──
  ['KRK','ATH','wizzair', 199, 220, 7],
  ['KRK','BCN','ryanair', 179, 200, 9],
  ['KRK','BCN','wizzair', 189, 205, 14],
  ['KRK','OPO','ryanair', 169, 195, 12],
  ['KRK','LIS','ryanair', 199, 185, 9],
  ['KRK','LIS','wizzair', 209, 190, 10],
  ['KRK','BGY','ryanair', 119, 130, 17],
  ['KRK','CIA','ryanair', 149, 140, 18],
  ['KRK','BVA','ryanair', 159, 150, 13],
  ['KRK','NCE','wizzair', 199, 175, 11],
  ['KRK','MLA','ryanair', 229, 200, 6],
  ['KRK','EIN','wizzair', 119, 110, 20],
  ['KRK','OSL','wizzair', 149, 150, 16],
  ['KRK','STN','ryanair', 159, 150, 7],
  ['KRK','DUB','ryanair', 169, 195, 6],
  ['KRK','RIX','wizzair', 119, 110, 14],
  ['KRK','PMI','ryanair', 229, 215, 10],
  ['KRK','VIE','wizzair', 79,  85,  20],
  // ── WAW ──
  ['WAW','BCN','wizzair', 199, 195, 7],
  ['WAW','PMI','wizzair', 229, 215, 8],
  ['WAW','OSL','wizzair', 149, 145, 17],
  ['WAW','RIX','wizzair', 119, 90,  19],
  ['WAW','MLA','wizzair', 219, 200, 11],
  ['WAW','BGY','wizzair', 139, 130, 15],
  ['WAW','SOF','wizzair', 159, 145, 13],
  ['WAW','AGP','wizzair', 209, 230, 9],
  ['WAW','TIA','wizzair', 159, 165, 13],
  // ── WRO ──
  ['WRO','BCN','ryanair', 169, 200, 8],
  ['WRO','FCO','wizzair', 179, 150, 12],
  ['WRO','AGP','wizzair', 209, 235, 9],
  ['WRO','ATH','wizzair', 209, 215, 10],
  ['WRO','PMI','ryanair', 229, 220, 7],
  ['WRO','DUB','ryanair', 179, 195, 9],
  ['WRO','MLA','ryanair', 219, 200, 16],
  ['WRO','BVA','ryanair', 139, 150, 14],
  ['WRO','OSL','wizzair', 149, 145, 18],
  // ── GDN ──
  ['GDN','BCN','wizzair', 189, 205, 8],
  ['GDN','PMI','wizzair', 229, 220, 11],
  ['GDN','AGP','wizzair', 219, 235, 10],
  ['GDN','OSL','wizzair', 99,  110, 17],
  ['GDN','LIS','wizzair', 209, 200, 14],
  ['GDN','STN','ryanair', 169, 155, 8],
  ['GDN','DUB','ryanair', 189, 195, 6],
  ['GDN','AMS','ryanair', 159, 115, 7],
  ['GDN','MLA','ryanair', 229, 210, 13],
  // ── POZ ──
  ['POZ','STN','ryanair', 159, 145, 8],
  ['POZ','DUB','ryanair', 189, 190, 11],
  ['POZ','PMI','ryanair', 229, 220, 12],
  ['POZ','OSL','wizzair', 129, 125, 16],
  ['POZ','ATH','wizzair', 219, 220, 14],
];

// ═════════════════════════════════════════════════════════════════════════════
// DATY WEEKENDOWE — generowane od dziś do dziś + 12 miesięcy
// Każda data ma typ: 'fri-sun' (3 dni), 'sat-sun' / 'fri-sat' (2 dni),
//                    'fri-only' / 'sat-only' / 'sun-only' (1 dzień)
// ═════════════════════════════════════════════════════════════════════════════
function generateWeekendDates(startDate, monthsAhead = 12) {
  const dates = [];
  const start = new Date(startDate);
  start.setHours(0,0,0,0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + monthsAhead);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay(); // 0=Nd, 5=Pt, 6=Sb
    if (dow === 5) {
      // Piątek — generuj różne warianty weekendów
      const fri  = isoDate(d);
      const sat  = isoDate(addDays(d, 1));
      const sun  = isoDate(addDays(d, 2));

      dates.push({raw:fri, retRaw:sun, deptDay:'piątek', retDay:'niedziela',
                  pattern:'fri-sun', display:fmtRange(fri, sun, 3)});
      dates.push({raw:fri, retRaw:sat, deptDay:'piątek', retDay:'sobota',
                  pattern:'fri-sat', display:fmtRange(fri, sat, 2)});
      dates.push({raw:fri, retRaw:fri, deptDay:'piątek', retDay:'piątek',
                  pattern:'fri-only',display:fmtSingle(fri, 'Pt')});
    } else if (dow === 6) {
      // Sobota
      const sat = isoDate(d);
      const sun = isoDate(addDays(d, 1));

      dates.push({raw:sat, retRaw:sun, deptDay:'sobota', retDay:'niedziela',
                  pattern:'sat-sun', display:fmtRange(sat, sun, 2)});
      dates.push({raw:sat, retRaw:sat, deptDay:'sobota', retDay:'sobota',
                  pattern:'sat-only',display:fmtSingle(sat, 'Sb')});
    } else if (dow === 0) {
      // Niedziela
      const sun = isoDate(d);
      dates.push({raw:sun, retRaw:sun, deptDay:'niedziela', retDay:'niedziela',
                  pattern:'sun-only',display:fmtSingle(sun, 'Nd')});
    }
  }
  return dates;
}

const MO_PL = ['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paź','Lis','Gru'];

function isoDate(d) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmtSingle(raw, dayLabel) {
  const d = new Date(raw);
  return `${dayLabel}, ${d.getDate()} ${MO_PL[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtRange(raw1, raw2, daysCount) {
  const d1 = new Date(raw1), d2 = new Date(raw2);
  const days = daysCount === 3 ? 'Pt–Nd' : daysCount === 2 ?
    (d1.getDay() === 5 ? 'Pt–Sb' : 'Sb–Nd') : '';
  if (d1.getMonth() === d2.getMonth()) {
    return `${days}, ${d1.getDate()}–${d2.getDate()} ${MO_PL[d1.getMonth()]} ${d1.getFullYear()}`;
  }
  return `${days}, ${d1.getDate()} ${MO_PL[d1.getMonth()]} – ${d2.getDate()} ${MO_PL[d2.getMonth()]} ${d1.getFullYear()}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// CENA — modyfikacja bazowej ceny w zależności od miesiąca i dnia
// ═════════════════════════════════════════════════════════════════════════════
function adjustPrice(base, date, pattern) {
  const d = new Date(date);
  const month = d.getMonth() + 1;
  // Sezon wysoki: lipiec/sierpień/Boże Narodzenie — droższe
  let factor = 1.0;
  if (month === 7 || month === 8) factor = 1.3;       // Wakacje
  else if (month === 12) factor = 1.4;                 // Boże Narodzenie
  else if (month === 1 || month === 2 || month === 11) factor = 0.85; // Niski sezon
  else if (month === 6 || month === 9) factor = 1.15; // Średni sezon
  // 1-dniowe loty są tańsze
  if (pattern === 'fri-only' || pattern === 'sat-only' || pattern === 'sun-only') factor *= 0.7;
  // 2-dniowe taniej niż 3-dniowe
  if (pattern === 'fri-sat' || pattern === 'sat-sun') factor *= 0.85;
  return Math.round(base * factor);
}

// ═════════════════════════════════════════════════════════════════════════════
// FORMATOWANIE GODZIN
// ═════════════════════════════════════════════════════════════════════════════
function fmtTime(h, m = 0) {
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function fmtDuration(min) {
  return `${Math.floor(min/60)}h ${String(min%60).padStart(2,'0')}m`;
}

// ═════════════════════════════════════════════════════════════════════════════
// GENERATOR LOTÓW
// ═════════════════════════════════════════════════════════════════════════════
function generateFlights(today = new Date()) {
  const flights = [];
  const dates = generateWeekendDates(today, 12);

  let id = 1;
  for (const route of ROUTES) {
    const [origin, dest, airline, basePrice, durMin, deptHour] = route;
    const origInfo = ORIGINS[origin];
    const destInfo = DESTS[dest];
    if (!origInfo || !destInfo) continue;

    // Każda trasa pojawia się w ~5-8 różnych terminach (różne wzorce, różne miesiące)
    // Wybieramy daty deterministycznie żeby plik się nie zmieniał za każdym uruchomieniem
    // (stabilne ID, ale jednocześnie pokrycie różnych wzorców)
    const pickedDates = pickDatesForRoute(dates, origin + dest, 5);

    for (const dInfo of pickedDates) {
      // Oblicz cenę
      const p1 = adjustPrice(basePrice, dInfo.raw, dInfo.pattern);
      const p2 = Math.round(p1 * 1.7); // round-trip ≈ 1.7 × one-way
      if (p2 > MAX_BUDGET_RT) continue; // Filtr: tylko ≤ 500 PLN R/T

      // Oblicz godziny
      const arrHour = (deptHour + Math.floor(durMin / 60)) % 24;
      const arrMin  = durMin % 60;
      // Powrót: ~10h później dla weekend trip, lub tej samej daty dla single-day
      const retHourBase = (deptHour + 12) % 24;
      const retArrHour  = (retHourBase + Math.floor(durMin / 60)) % 24;
      const retArrMin   = (durMin) % 60;

      // Nazwa weekday → ID stabilne
      flights.push({
        id:        `f${id++}`,
        airline,
        from:      origin,
        to:        dest,
        fromCity:  origInfo.city,
        toCity:    destInfo.city,
        flag:      destInfo.flag,
        country:   destInfo.country,
        dept:      fmtTime(deptHour, 0),
        arr:       fmtTime(arrHour, arrMin),
        retDept:   fmtTime(retHourBase, 0),
        retArr:    fmtTime(retArrHour, retArrMin),
        deptDay:   dInfo.deptDay,
        retDay:    dInfo.retDay,
        dur:       fmtDuration(durMin),
        date:      dInfo.display,
        raw:       dInfo.raw,
        retRaw:    dInfo.retRaw,
        month:     parseInt(dInfo.raw.slice(5,7), 10),
        year:      parseInt(dInfo.raw.slice(0,4), 10),
        price1:    p1,
        price2:    p2,
        sea:       destInfo.sea,
        lgbt:      destInfo.lgbt,
        lgbtN:     destInfo.lgbtN,
        distKm:    destInfo.distKm,
        passport:  destInfo.passport,
        visa:      destInfo.visa,
        currency:  destInfo.currency,
        englishOk: destInfo.englishOk,
        pattern:   dInfo.pattern, // 'fri-sun' | 'sat-sun' | 'fri-sat' | 'fri-only' | etc
      });
    }
  }

  // Posortuj według daty rosnąco
  flights.sort((a, b) => a.raw.localeCompare(b.raw));
  return flights;
}

/**
 * Wybiera N dat dla danej trasy w sposób deterministyczny — bazuje na hashu
 * route key + indeks. Zapewnia różnorodność wzorców (Pt-Nd, Sb-Nd, etc).
 */
function pickDatesForRoute(allDates, routeKey, count) {
  const hash = simpleHash(routeKey);
  const picked = [];
  const patterns = ['fri-sun', 'sat-sun', 'fri-sat', 'sat-only', 'fri-only', 'sun-only'];

  // Zapewnij mix wzorców: 40% Pt-Nd, 25% Sb-Nd, 15% Pt-Sb, 20% jednodniowe
  const targetPattern = (i) => {
    const r = (hash + i * 7) % 100;
    if (r < 40)      return 'fri-sun';
    else if (r < 65) return 'sat-sun';
    else if (r < 80) return 'fri-sat';
    else if (r < 88) return 'sat-only';
    else if (r < 95) return 'sun-only';
    else             return 'fri-only';
  };

  // Rozłóż na różne miesiące: weź z różnych przedziałów
  const monthlyBuckets = {};
  for (const d of allDates) {
    const monthKey = d.raw.slice(0, 7);
    if (!monthlyBuckets[monthKey]) monthlyBuckets[monthKey] = [];
    monthlyBuckets[monthKey].push(d);
  }
  const months = Object.keys(monthlyBuckets).sort();

  for (let i = 0; i < count && i < months.length; i++) {
    const monthKey = months[(hash + i * 3) % months.length];
    const candidates = monthlyBuckets[monthKey].filter(x => x.pattern === targetPattern(i));
    if (candidates.length === 0) {
      // fallback: dowolny wzorzec w tym miesiącu
      const any = monthlyBuckets[monthKey];
      if (any.length) picked.push(any[(hash + i * 11) % any.length]);
    } else {
      picked.push(candidates[(hash + i * 11) % candidates.length]);
    }
  }

  return picked;
}

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN — generuj i zapisz JSON
// ═════════════════════════════════════════════════════════════════════════════
function main() {
  const today = new Date();
  const flights = generateFlights(today);

  const output = {
    lastUpdated: today.toISOString(),
    source:      'static-generator', // Lub 'ryanair-api', 'wizzair-api' jeśli prawdziwy fetch
    maxBudgetRT: MAX_BUDGET_RT,
    totalCount:  flights.length,
    flights:     flights,
  };

  const outPath = path.join(__dirname, '..', 'data', 'flights.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  console.log(`✅ Wygenerowano ${flights.length} lotów do ${outPath}`);
  console.log(`   Budżet maks: ${MAX_BUDGET_RT} PLN w obie strony`);
  console.log(`   Wzorce:`);
  const patternCounts = flights.reduce((acc, f) => {
    acc[f.pattern] = (acc[f.pattern] || 0) + 1; return acc;
  }, {});
  for (const [p, n] of Object.entries(patternCounts)) {
    console.log(`     ${p}: ${n}`);
  }
  console.log(`   Linie: Ryanair ${flights.filter(f => f.airline === 'ryanair').length}, Wizzair ${flights.filter(f => f.airline === 'wizzair').length}`);
}

if (require.main === module) main();

module.exports = { generateFlights, DESTS, ORIGINS, ROUTES };
