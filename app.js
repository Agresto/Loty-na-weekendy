/* ================================================================
   LOTY NA WEEKEND — app.js
   Integracje: Firebase Auth, Firebase Firestore, EmailJS
   Dane: mockowe (produkcja: zastąp wywołaniami API/scrapera)
================================================================ */

/* ================================================================
   SEKCJA 1: INICJALIZACJA FIREBASE + EMAILJS
================================================================ */

// Firebase i EmailJS są ładowane przed tym plikiem przez index.html.
// Poniższe zmienne są dostępne globalnie po załadowaniu SDKs.
let fbApp, fbAuth, fbDb;

function initFirebase() {
  // Sprawdź czy konfiguracja jest uzupełniona
  if (!window.FIREBASE_CONFIG || window.FIREBASE_CONFIG.apiKey === 'TWOJ_FIREBASE_API_KEY') {
    console.warn('[Firebase] Brak konfiguracji — tryb offline (localStorage)');
    return false;
  }
  try {
    fbApp  = firebase.initializeApp(window.FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb   = firebase.firestore();
    // Włącz offline persistence (dane dostępne bez internetu)
    fbDb.enablePersistence().catch(err => {
      if (err.code === 'failed-precondition') console.warn('[Firestore] Multi-tab — persistence wyłączona');
    });
    console.log('[Firebase] ✅ Zainicjalizowany pomyślnie');
    return true;
  } catch (e) {
    console.error('[Firebase] Błąd inicjalizacji:', e.message);
    return false;
  }
}

function initEmailJS() {
  if (!window.EMAILJS_CONFIG || window.EMAILJS_CONFIG.publicKey === 'TWOJ_EMAILJS_PUBLIC_KEY') {
    console.warn('[EmailJS] Brak konfiguracji — emaile nie będą wysyłane');
    return false;
  }
  try {
    emailjs.init(window.EMAILJS_CONFIG.publicKey);
    console.log('[EmailJS] ✅ Zainicjalizowany pomyślnie');
    return true;
  } catch (e) {
    console.error('[EmailJS] Błąd inicjalizacji:', e.message);
    return false;
  }
}

// Flagi — czy zewnętrzne serwisy są dostępne
let FIREBASE_READY = false;
let EMAILJS_READY  = false;

/* ================================================================
   SEKCJA 2: DANE — Airports, Flights, Vibes, Map Paths
================================================================ */

const AIRPORTS = [
  {code:'KTW',name:'Katowice Pyrzowice',        country:'Polska',          flag:'🇵🇱',x:490,y:148,isPL:true},
  {code:'KRK',name:'Kraków Balice',              country:'Polska',          flag:'🇵🇱',x:495,y:152,isPL:true},
  {code:'WAW',name:'Warszawa Chopin',             country:'Polska',          flag:'🇵🇱',x:505,y:140,isPL:true},
  {code:'WRO',name:'Wrocław Strachowice',         country:'Polska',          flag:'🇵🇱',x:472,y:145,isPL:true},
  {code:'GDN',name:'Gdańsk im. Wałęsy',           country:'Polska',          flag:'🇵🇱',x:488,y:126,isPL:true},
  {code:'POZ',name:'Poznań Ławica',               country:'Polska',          flag:'🇵🇱',x:468,y:136,isPL:true},
  {code:'BCN',name:'Barcelona El Prat',           country:'Hiszpania',       flag:'🇪🇸',x:362,y:168},
  {code:'MAD',name:'Madryt Barajas',              country:'Hiszpania',       flag:'🇪🇸',x:344,y:172},
  {code:'ALC',name:'Alicante',                    country:'Hiszpania',       flag:'🇪🇸',x:354,y:178},
  {code:'PMI',name:'Palma de Mallorca',           country:'Hiszpania',       flag:'🇪🇸',x:372,y:174},
  {code:'LIS',name:'Lizbona Humberto Delgado',    country:'Portugalia',      flag:'🇵🇹',x:322,y:178},
  {code:'OPO',name:'Porto Francisco Sá Carneiro', country:'Portugalia',      flag:'🇵🇹',x:318,y:170},
  {code:'FCO',name:'Rzym Fiumicino',              country:'Włochy',          flag:'🇮🇹',x:432,y:172},
  {code:'MXP',name:'Mediolan Malpensa',           country:'Włochy',          flag:'🇮🇹',x:415,y:157},
  {code:'NAP',name:'Neapol',                      country:'Włochy',          flag:'🇮🇹',x:444,y:178},
  {code:'ATH',name:'Ateny Eleftherios Venizelos', country:'Grecja',          flag:'🇬🇷',x:492,y:185},
  {code:'HER',name:'Heraklion Kreta',             country:'Grecja',          flag:'🇬🇷',x:494,y:198},
  {code:'DUB',name:'Dublin',                      country:'Irlandia',        flag:'🇮🇪',x:334,y:126},
  {code:'STN',name:'Londyn Stansted',             country:'Wielka Brytania', flag:'🇬🇧',x:366,y:126},
  {code:'AMS',name:'Amsterdam Schiphol',          country:'Holandia',        flag:'🇳🇱',x:400,y:126},
  {code:'CDG',name:'Paryż Charles de Gaulle',     country:'Francja',         flag:'🇫🇷',x:385,y:142},
  {code:'TXL',name:'Berlin Brandenburg',          country:'Niemcy',          flag:'🇩🇪',x:440,y:130},
  {code:'VIE',name:'Wiedeń',                      country:'Austria',         flag:'🇦🇹',x:462,y:150},
  {code:'BUD',name:'Budapeszt',                   country:'Węgry',           flag:'🇭🇺',x:474,y:156},
  {code:'TIA',name:'Tirana',                      country:'Albania',         flag:'🇦🇱',x:474,y:182},
  {code:'SKP',name:'Skopje',                      country:'Macedonia Pn.',   flag:'🇲🇰',x:480,y:178},
  {code:'SSH',name:'Sharm el-Sheikh',             country:'Egipt',           flag:'🇪🇬',x:532,y:208},
  {code:'HRG',name:'Hurghada',                    country:'Egipt',           flag:'🇪🇬',x:528,y:210},
  {code:'RIX',name:'Ryga',                        country:'Łotwa',           flag:'🇱🇻',x:502,y:116},
  {code:'PRG',name:'Praga Václava Havla',         country:'Czechy',          flag:'🇨🇿',x:452,y:142},
  {code:'BRU',name:'Bruksela',                    country:'Belgia',          flag:'🇧🇪',x:396,y:132},
  // Lotniska dodane w v2 (po dodaniu większej liczby tras):
  {code:'EIN',name:'Eindhoven',                   country:'Holandia',        flag:'🇳🇱',x:404,y:130},
  {code:'MLA',name:'Malta',                       country:'Malta',           flag:'🇲🇹',x:444,y:200},
  {code:'SOF',name:'Sofia',                       country:'Bułgaria',        flag:'🇧🇬',x:496,y:172},
  {code:'OSL',name:'Oslo Torp',                   country:'Norwegia',        flag:'🇳🇴',x:432,y:78},
  {code:'CIA',name:'Rzym Ciampino',               country:'Włochy',          flag:'🇮🇹',x:434,y:174},
  {code:'OTP',name:'Bukareszt',                   country:'Rumunia',         flag:'🇷🇴',x:516,y:160},
  {code:'BVA',name:'Paryż Beauvais',              country:'Francja',         flag:'🇫🇷',x:386,y:140},
  {code:'AGP',name:'Malaga',                      country:'Hiszpania',       flag:'🇪🇸',x:336,y:194},
  {code:'BGY',name:'Bergamo (Mediolan)',          country:'Włochy',          flag:'🇮🇹',x:417,y:158},
  {code:'RHO',name:'Rodos',                       country:'Grecja',          flag:'🇬🇷',x:514,y:194},
  {code:'NCE',name:'Nicea',                       country:'Francja',         flag:'🇫🇷',x:402,y:172},
  {code:'VAR',name:'Warna',                       country:'Bułgaria',        flag:'🇧🇬',x:514,y:170},
];

/**
 * FLIGHTS — dane lotów weekendowych.
 *
 * ⚙️ ARCHITEKTURA ŁADOWANIA:
 *   1. Aplikacja ładuje na starcie data/flights.json (zewnętrzny plik)
 *   2. Plik jest aktualizowany codziennie przez GitHub Actions cron
 *      (scripts/refresh-flights.js + .github/workflows/refresh-flights.yml)
 *   3. Jeśli fetch się nie powiedzie, używana jest poniższa awaryjna lista
 *      (5 lotów) — żeby aplikacja zawsze coś pokazała
 *
 * ⚠️ Pełny dataset (~340 lotów ≤500 PLN) jest w data/flights.json
 *
 * Pola w obiekcie lotu:
 *  raw       — data wylotu YYYY-MM-DD
 *  retRaw    — data powrotu YYYY-MM-DD
 *  pattern   — wzorzec dni: 'fri-sun'|'sat-sun'|'fri-sat'|'fri-only'|'sat-only'|'sun-only'
 *  distKm    — odległość lotnisko → centrum miasta (km)
 *  passport  — czy obywatel PL musi mieć paszport (false = dowód wystarczy)
 *  visa      — 'brak' | 'e-wiza' | 'wiza'
 *  currency  — waluta kraju docelowego
 *  englishOk — czy angielski jest powszechnie rozumiany w miejscu docelowym
 */

// Awaryjna lista lotów — używana TYLKO gdy fetch flights.json się nie powiedzie
const FALLBACK_FLIGHTS = [
  {id:'fb1',airline:'wizzair',from:'KTW',to:'TIA',fromCity:'Katowice',toCity:'Tirana',     flag:'🇦🇱',country:'Albania',         dept:'06:00',arr:'08:40',retDept:'18:00',retArr:'20:40',deptDay:'piątek', retDay:'niedziela',dur:'2h 40m',date:'Pt–Nd, weekend',raw:'2026-05-01',retRaw:'2026-05-03',month:5,year:2026,price1:99, price2:168,sea:false,lgbt:false,lgbtN:'Albania – brak pełnych praw LGBTQ+',distKm:4, passport:false,visa:'brak',currency:'ALL L',englishOk:false,pattern:'fri-sun'},
  {id:'fb2',airline:'ryanair',from:'KTW',to:'STN',fromCity:'Katowice',toCity:'Londyn',     flag:'🇬🇧',country:'Wielka Brytania',dept:'06:00',arr:'08:35',retDept:'18:00',retArr:'20:35',deptDay:'sobota', retDay:'niedziela',dur:'2h 35m',date:'Sb–Nd, weekend',raw:'2026-05-16',retRaw:'2026-05-17',month:5,year:2026,price1:144,price2:245,sea:false,lgbt:true, lgbtN:'Londyn – jedna z najbardziej LGBTQ+ friendly metropolii',distKm:60,passport:true,visa:'brak',currency:'GBP £',englishOk:true,pattern:'sat-sun'},
  {id:'fb3',airline:'wizzair',from:'KRK',to:'BCN',fromCity:'Kraków',  toCity:'Barcelona',  flag:'🇪🇸',country:'Hiszpania',       dept:'14:00',arr:'17:25',retDept:'02:00',retArr:'05:25',deptDay:'piątek', retDay:'niedziela',dur:'3h 25m',date:'Pt–Nd, weekend',raw:'2026-06-05',retRaw:'2026-06-07',month:6,year:2026,price1:217,price2:369,sea:true, lgbt:true, lgbtN:'Barcelona – queer-friendly stolica Europy',distKm:14,passport:false,visa:'brak',currency:'EUR €',englishOk:true,pattern:'fri-sun'},
  {id:'fb4',airline:'ryanair',from:'KRK',to:'BGY',fromCity:'Kraków',  toCity:'Bergamo (Mediolan)',flag:'🇮🇹',country:'Włochy',     dept:'17:00',arr:'19:10',retDept:'05:00',retArr:'07:10',deptDay:'sobota', retDay:'niedziela',dur:'2h 10m',date:'Sb–Nd, weekend',raw:'2026-06-13',retRaw:'2026-06-14',month:6,year:2026,price1:101,price2:172,sea:false,lgbt:true, lgbtN:'Włochy – aktywna społeczność queer w dużych miastach',distKm:50,passport:false,visa:'brak',currency:'EUR €',englishOk:true,pattern:'sat-sun'},
  {id:'fb5',airline:'wizzair',from:'KTW',to:'BUD',fromCity:'Katowice',toCity:'Budapeszt',  flag:'🇭🇺',country:'Węgry',           dept:'18:00',arr:'19:30',retDept:'06:00',retArr:'07:30',deptDay:'piątek', retDay:'piątek',   dur:'1h 30m',date:'Pt, weekend',    raw:'2026-05-08',retRaw:'2026-05-08',month:5,year:2026,price1:69, price2:117,sea:false,lgbt:false,lgbtN:'Węgry – konstytucja zakazuje małżeństw jednopłciowych',distKm:23,passport:false,visa:'brak',currency:'HUF Ft',englishOk:true,pattern:'fri-only'},
];

// Aktywna lista lotów — wczytywana dynamicznie z flights.json przez loadFlights()
let FLIGHTS = FALLBACK_FLIGHTS.slice();

// Metadane ostatniej aktualizacji (uzupełniane po fetch)
let FLIGHTS_META = {
  lastUpdated: null,        // ISO string
  source:      'fallback',  // 'remote' | 'fallback' | 'static-generator' | 'ryanair-api' | itd
  totalCount:  FALLBACK_FLIGHTS.length,
};

/**
 * Wczytuje loty z data/flights.json. Wywoływane przy starcie aplikacji
 * oraz po kliknięciu przycisku "🔄 Odśwież".
 *
 * @returns {Promise<boolean>} true jeśli załadowano nowe dane, false jeśli fallback
 */
async function loadFlights() {
  try {
    // Cache buster — żeby zawsze pobrać najnowszą wersję pliku
    const url = './flights.json?t=' + Math.floor(Date.now() / 600000);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!Array.isArray(data.flights) || data.flights.length === 0) {
      throw new Error('Brak danych lotów w flights.json');
    }

    FLIGHTS = data.flights;
    FLIGHTS_META = {
      lastUpdated: data.lastUpdated || new Date().toISOString(),
      source:      data.source || 'remote',
      totalCount:  data.flights.length,
    };
    console.log(`[loadFlights] ✅ Załadowano ${FLIGHTS.length} lotów z flights.json (źródło: ${FLIGHTS_META.source})`);
    return true;
  } catch (err) {
    console.warn(`[loadFlights] ⚠️ Nie udało się załadować flights.json: ${err.message}. Używam fallback.`);
    FLIGHTS = FALLBACK_FLIGHTS.slice();
    FLIGHTS_META = {
      lastUpdated: new Date().toISOString(),
      source:      'fallback',
      totalCount:  FALLBACK_FLIGHTS.length,
    };
    return false;
  }
}

/**
 * Formatuje "Last updated" w formie czytelnej dla użytkownika.
 * @param {string} iso - timestamp ISO 8601
 * @returns {string} np. "5 godzin temu", "wczoraj", "2026-04-26"
 */
function formatLastUpdated(iso) {
  if (!iso) return 'nieznana';
  const then = new Date(iso);
  const now  = new Date();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60)         return 'przed chwilą';
  if (diffSec < 3600)       return `${Math.floor(diffSec / 60)} min temu`;
  if (diffSec < 86400)      return `${Math.floor(diffSec / 3600)} godz. temu`;
  if (diffSec < 86400 * 2)  return 'wczoraj';
  if (diffSec < 86400 * 7)  return `${Math.floor(diffSec / 86400)} dni temu`;
  return then.toLocaleDateString('pl-PL', {day:'numeric', month:'short', year:'numeric'});
}

/**
 * Aktualizuje UI z informacją o ostatniej aktualizacji.
 * Pokazuje też ikonę źródła danych: ☁️ (zdalne) | 💾 (fallback).
 */
function updateLastUpdatedUI() {
  const el = document.getElementById('lastUpdated');
  if (!el) return;
  const ago = formatLastUpdated(FLIGHTS_META.lastUpdated);
  const isFallback = FLIGHTS_META.source === 'fallback' ||
                     FLIGHTS_META.source === 'static-generator-fallback' ||
                     FLIGHTS_META.source === 'static-generator';
  const isHybrid   = FLIGHTS_META.source === 'ryanair-api+wizzair-static';
  const sourceIcon = isFallback ? '💾' : (isHybrid ? '⚡' : '☁️');
  const sourceText = isFallback ? 'tryb awaryjny'
                   : isHybrid    ? 'Ryanair na żywo, Wizzair szacowany'
                   : 'aktualne dane';
  el.innerHTML = `${sourceIcon} <strong>${FLIGHTS_META.totalCount}</strong> lotów · aktualizacja: <strong>${ago}</strong> · ${sourceText}`;
  el.title = `Źródło: ${FLIGHTS_META.source}\nDokładny czas: ${FLIGHTS_META.lastUpdated || 'nieznany'}`;

  // Aktualizuj statystyki w hero (Bug 9)
  const heroFlights  = document.getElementById('heroFlights');
  const heroDests    = document.getElementById('heroDests');
  const heroCheapest = document.getElementById('heroCheapest');
  if (heroFlights)  heroFlights.textContent  = FLIGHTS.length.toLocaleString('pl-PL');
  if (heroDests)    heroDests.textContent    = new Set(FLIGHTS.map(f => f.to)).size;
  if (heroCheapest && FLIGHTS.length) {
    const minP = Math.min(...FLIGHTS.map(f => f.price1));
    heroCheapest.textContent = `${minP} PLN`;
  }
}

/**
 * Ręczne odświeżenie danych — wywoływane przyciskiem "🔄 Odśwież".
 */
async function refreshFlights() {
  const btn = document.getElementById('refreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Ładowanie...'; }
  toast('info','🔄','Odświeżanie...','Pobieranie aktualnych lotów');

  const ok = await loadFlights();
  updateLastUpdatedUI();
  renderResults();

  if (btn) { btn.disabled = false; btn.textContent = '🔄 Odśwież'; }

  if (ok) toast('success','✅','Zaktualizowano!',`Załadowano ${FLIGHTS.length} lotów`);
  else    toast('warning','⚠️','Tryb awaryjny','Używam zapisanych danych. Sprawdź połączenie.');
}

const VIBES = [
  {city:'Barcelona',country:'Hiszpania',      destCode:'BCN',badge:'Architektura Gaudíego',  price:'od 359 PLN',img:'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=400&h=520&fit=crop&q=80',alt:'Sagrada Família'},
  {city:'Amsterdam', country:'Holandia',      destCode:'AMS',badge:'Kanały i tulipany',       price:'od 199 PLN',img:'https://images.unsplash.com/photo-1512470876302-972faa2aa9a4?w=400&h=520&fit=crop&q=80',alt:'Kanały Amsterdamu'},
  {city:'Rzym',      country:'Włochy',        destCode:'FCO',badge:'Wieczne Miasto',          price:'od 319 PLN',img:'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=400&h=520&fit=crop&q=80',alt:'Koloseum w Rzymie'},
  {city:'Ateny',     country:'Grecja',        destCode:'ATH',badge:'Akropol i filozofia',     price:'od 279 PLN',img:'https://images.unsplash.com/photo-1555993539-1732b0258235?w=400&h=520&fit=crop&q=80',alt:'Akropol w Atenach'},
  {city:'Lizbona',   country:'Portugalia',    destCode:'LIS',badge:'Fado i tramwaje',         price:'od 419 PLN',img:'https://images.unsplash.com/photo-1558008258-3256797b43f3?w=400&h=520&fit=crop&q=80',alt:'Tramwaj w Lizbonie'},
  {city:'Dublin',    country:'Irlandia',      destCode:'DUB',badge:'Zielona wyspa',           price:'od 239 PLN',img:'https://images.unsplash.com/photo-1533105079780-92b9be482077?w=400&h=520&fit=crop&q=80',alt:'Centrum Dublina'},
  {city:'Londyn',    country:'Wielka Brytania',destCode:'STN',badge:'Big Ben i kultura',      price:'od 279 PLN',img:'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=400&h=520&fit=crop&q=80',alt:'Tower Bridge'},
  {city:'Mallorca',  country:'Hiszpania',     destCode:'PMI',badge:'Rajskie plaże',           price:'od 449 PLN',img:'https://images.unsplash.com/photo-1504512485720-7d83a16ee1a6?w=400&h=520&fit=crop&q=80',alt:'Plaża na Majorce'},
  {city:'Heraklion', country:'Grecja',        destCode:'HER',badge:'Kreta – słońce i morze', price:'od 359 PLN',img:'https://images.unsplash.com/photo-1571406252241-db0280bd36cd?w=400&h=520&fit=crop&q=80',alt:'Błękitna woda Krety'},
  {city:'Paryż',     country:'Francja',       destCode:'CDG',badge:'Wieża Eiffla',            price:'od 299 PLN',img:'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=400&h=520&fit=crop&q=80',alt:'Wieża Eiffla'},
];

const TICKER_DATA = [
  {from:'KTW',to:'Tirana',    p:'149 PLN'},{from:'KRK',to:'Skopje',    p:'169 PLN'},
  {from:'KRK',to:'Amsterdam', p:'199 PLN'},{from:'KTW',to:'Dublin',    p:'249 PLN'},
  {from:'KRK',to:'Ateny',     p:'279 PLN'},{from:'KTW',to:'Londyn',    p:'279 PLN'},
  {from:'KTW',to:'Rzym',      p:'319 PLN'},{from:'KRK',to:'Barcelona', p:'359 PLN'},
  {from:'KRK',to:'Lizbona',   p:'419 PLN'},{from:'KTW',to:'Mallorca',  p:'449 PLN'},
];

const CPATHS = [
  {n:'Norwegia',        d:'M378,58 L438,48 L464,62 L460,98 L428,110 L390,108 L376,80 Z'},
  {n:'Szwecja',         d:'M444,50 L492,44 L516,62 L520,98 L500,122 L460,124 L446,100 Z'},
  {n:'Finlandia',       d:'M500,50 L556,46 L564,78 L550,110 L516,115 L498,100 Z'},
  {n:'Dania',           d:'M414,96 L452,92 L458,108 L448,122 L418,120 Z'},
  {n:'Białoruś',        d:'M506,106 L564,100 L572,118 L562,140 L530,146 L506,136 Z',noF:true},
  {n:'Ukraina',         d:'M506,115 L582,106 L598,126 L588,155 L556,164 L510,162 L498,143 Z',noF:true},
  {n:'Łotwa',           d:'M484,104 L524,100 L530,114 L522,126 L490,126 L482,114 Z',cn:'Łotwa'},
  {n:'Litwa',           d:'M472,116 L510,112 L518,126 L508,138 L476,138 L470,126 Z'},
  {n:'Polska',          d:'M452,113 L532,105 L542,120 L536,148 L510,156 L472,156 L450,146 Z'},
  {n:'Niemcy',          d:'M394,107 L474,102 L482,120 L476,152 L454,158 L424,155 L394,147 Z',cn:'Niemcy'},
  {n:'Holandia',        d:'M382,108 L420,104 L426,122 L418,134 L386,134 Z',cn:'Holandia'},
  {n:'Belgia',          d:'M378,126 L412,122 L418,138 L408,148 L382,148 Z',cn:'Belgia'},
  {n:'Wielka Brytania', d:'M342,93 L394,89 L400,110 L390,138 L364,142 L345,136 L340,112 Z',cn:'Wielka Brytania'},
  {n:'Irlandia',        d:'M313,107 L342,103 L348,125 L338,136 L318,133 L311,120 Z',cn:'Irlandia'},
  {n:'Francja',         d:'M330,126 L398,120 L428,136 L424,162 L404,168 L366,165 L334,158 Z',cn:'Francja'},
  {n:'Szwajcaria',      d:'M396,148 L430,140 L436,154 L428,164 L398,164 Z'},
  {n:'Austria',         d:'M423,148 L480,140 L488,152 L480,165 L444,168 L422,162 Z',cn:'Austria'},
  {n:'Czechy',          d:'M432,128 L480,122 L488,136 L482,150 L456,154 L432,149 Z',cn:'Czechy'},
  {n:'Słowacja',        d:'M454,147 L504,138 L512,150 L502,161 L473,162 L454,157 Z'},
  {n:'Węgry',           d:'M452,156 L502,148 L512,162 L502,174 L472,176 L452,168 Z',cn:'Węgry'},
  {n:'Włochy',          d:'M401,146 L440,138 L463,150 L470,168 L464,186 L450,202 L440,215 L430,210 L422,196 L414,180 L405,165 L400,152 Z',cn:'Włochy'},
  {n:'Chorwacja',       d:'M432,162 L462,156 L472,172 L463,185 L443,184 Z'},
  {n:'Serbia',          d:'M455,170 L500,163 L509,177 L500,190 L473,192 L454,182 Z'},
  {n:'Rumunia',         d:'M488,138 L547,130 L556,147 L549,168 L521,175 L494,171 Z'},
  {n:'Bułgaria',        d:'M488,168 L536,162 L543,178 L530,193 L496,196 L484,183 Z'},
  {n:'Macedonia Pn.',   d:'M468,182 L500,178 L506,190 L496,200 L472,200 Z',cn:'Macedonia Pn.'},
  {n:'Albania',         d:'M462,182 L484,178 L491,194 L484,208 L465,210 Z',cn:'Albania'},
  {n:'Grecja',          d:'M456,193 L512,186 L522,200 L511,218 L490,226 L467,222 Z',cn:'Grecja'},
  {n:'Turcja',          d:'M502,178 L578,168 L592,182 L580,200 L543,204 L504,196 Z',noF:true},
  {n:'Portugalia',      d:'M303,154 L337,148 L343,170 L336,198 L303,196 Z',cn:'Portugalia'},
  {n:'Hiszpania',       d:'M314,144 L400,136 L410,153 L403,182 L378,196 L344,197 L313,180 Z',cn:'Hiszpania'},
  {n:'Maroko',          d:'M310,205 L384,200 L388,230 L368,252 L315,255 L305,235 Z',noF:true},
  {n:'Egipt',           d:'M490,197 L566,191 L573,241 L540,258 L492,261 L482,239 Z',cn:'Egipt'},
  {n:'USA',             d:'M70,130 L200,118 L215,158 L200,210 L155,230 L85,225 L62,195 Z',noF:true},
  {n:'Kanada',          d:'M65,75 L215,60 L220,118 L70,130 Z',noF:true},
];

// Najtańsze loty per kraj (dla mapy) — przeliczane po każdym loadFlights()
let CHEAPEST_BY_COUNTRY = {};
let TOP3 = new Set();

/**
 * Przelicza CHEAPEST_BY_COUNTRY i TOP3 na podstawie aktualnej tablicy FLIGHTS.
 * Wywoływane po każdym załadowaniu / odświeżeniu danych lotów.
 */
function recomputeCheapest() {
  CHEAPEST_BY_COUNTRY = {};
  FLIGHTS.forEach(f => {
    const ap = AIRPORTS.find(a => a.code === f.to);
    if (!ap) return;
    const k = ap.country;
    if (!CHEAPEST_BY_COUNTRY[k] || CHEAPEST_BY_COUNTRY[k].price1 > f.price1) {
      CHEAPEST_BY_COUNTRY[k] = {
        price1: f.price1, from: f.from, to: f.to,
        toCity: f.toCity, airline: f.airline,
      };
    }
  });
  const sorted = Object.entries(CHEAPEST_BY_COUNTRY).sort((a, b) => a[1].price1 - b[1].price1);
  TOP3 = new Set(sorted.slice(0, 3).map(([k]) => k));
}

// Pierwszy raz dla danych fallback (przed pobraniem z sieci)
recomputeCheapest();

/* ================================================================
   SEKCJA 3: STAN APLIKACJI
================================================================ */
const S = {
  airlines:   {ryanair:true, wizzair:true},
  days:       ['fri-sun','sat-sun','fri-sat','fri-only','sat-only','sun-only'], // wszystkie wzorce na start
  months:     [],       // aktywne miesiące jako 'YYYY-M', np. ['2025-6','2025-7']
  yearMode:   'any',    // 'current' | 'next' | 'any'
  budget:     500,
  roundtrip:  true,
  seaOnly:    false,
  lgbtOnly:   false,
  filter:     'all',
  sort:       'price',
  destFilter: '',
  favorites:  new Set(),
  loggedIn:   false,
  user:       null,    // {uid, email, name}
  favAp:      null,    // {code, name}
  origins:    [],
  history:    [],
  alerts:     [],
};

const MO_PL = ['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paź','Lis','Gru'];
const NOW    = new Date();
const CUR_YR = NOW.getFullYear();
const YEARS  = [CUR_YR, CUR_YR + 1];

/* ================================================================
   SEKCJA 4: FIRESTORE — zapis i odczyt danych użytkownika
================================================================ */

/**
 * Wczytaj dane użytkownika z Firestore.
 * Wywoływane po zalogowaniu.
 */
async function loadUserDataFromFirestore(uid) {
  if (!FIREBASE_READY) return;
  try {
    const doc = await fbDb.collection('users').doc(uid).get();
    if (doc.exists) {
      const d = doc.data();
      S.favorites = new Set(d.favorites || []);
      S.alerts    = d.alerts    || [];
      S.history   = d.history   || [];
      S.favAp     = d.favAp     || null;
      console.log('[Firestore] ✅ Dane użytkownika wczytane');
    } else {
      // Nowy użytkownik — utwórz dokument
      await fbDb.collection('users').doc(uid).set({
        favorites: [], alerts: [], history: [], favAp: null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    showSyncBadge();
  } catch (e) {
    console.error('[Firestore] Błąd odczytu:', e.message);
    // Fallback — LocalStorage
    loadFromLocalStorage();
  }
}

/**
 * Zapisz dane użytkownika do Firestore.
 * Wywoływane przy każdej zmianie (debounced).
 */
let saveDebounceTimer;
function saveUserDataToFirestore() {
  if (!FIREBASE_READY || !S.loggedIn || !S.user?.uid) {
    saveToLocalStorage(); // Fallback
    return;
  }
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    try {
      await fbDb.collection('users').doc(S.user.uid).update({
        favorites: [...S.favorites],
        alerts:    S.alerts,
        history:   S.history.slice(0, 15),
        favAp:     S.favAp,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      console.log('[Firestore] ✅ Dane zapisane');
      showSyncBadge();
    } catch (e) {
      console.error('[Firestore] Błąd zapisu:', e.message);
      saveToLocalStorage(); // Fallback
    }
  }, 800); // Debounce 800ms — nie wysyłaj przy każdym kliknięciu
}

function showSyncBadge() {
  const badge = document.getElementById('syncBadge');
  if (badge) { badge.style.display = 'block'; setTimeout(() => badge.style.display = 'none', 4000); }
}

/* ================================================================
   SEKCJA 5: LOCALSTORAGE — fallback gdy Firebase niedostępny
================================================================ */
function saveToLocalStorage() {
  localStorage.setItem('lnw_favs',   JSON.stringify([...S.favorites]));
  localStorage.setItem('lnw_alerts', JSON.stringify(S.alerts));
  localStorage.setItem('lnw_hist',   JSON.stringify(S.history.slice(0,15)));
  if (S.favAp) localStorage.setItem('lnw_fa', JSON.stringify(S.favAp));
  else         localStorage.removeItem('lnw_fa');
}

function loadFromLocalStorage() {
  const favs    = localStorage.getItem('lnw_favs');
  const alerts  = localStorage.getItem('lnw_alerts');
  const hist    = localStorage.getItem('lnw_hist');
  const favAp   = localStorage.getItem('lnw_fa');
  if (favs)   S.favorites = new Set(JSON.parse(favs));
  if (alerts) S.alerts    = JSON.parse(alerts);
  if (hist)   S.history   = JSON.parse(hist);
  if (favAp)  S.favAp     = JSON.parse(favAp);
}

/* ================================================================
   SEKCJA 6: INICJALIZACJA APLIKACJI
================================================================ */
window.addEventListener('DOMContentLoaded', async () => {
  // 1. Zainicjalizuj zewnętrzne usługi
  FIREBASE_READY = initFirebase();
  EMAILJS_READY  = initEmailJS();

  // 2. Nasłuchuj zmian stanu auth (Firebase utrzymuje sesję automatycznie)
  if (FIREBASE_READY) {
    fbAuth.onAuthStateChanged(async user => {
      if (user) {
        // Użytkownik zalogowany (także po odświeżeniu strony)
        S.user     = {uid: user.uid, email: user.email, name: user.displayName || user.email.split('@')[0]};
        S.loggedIn = true;
        await loadUserDataFromFirestore(user.uid);
        updateAuthUI();
        if (S.favAp) applyFavAp();
        renderResults();
        if (document.getElementById('userPanel').classList.contains('open')) renderPanel();
      } else {
        // Wylogowany
        if (S.loggedIn) { // Tylko jeśli wcześniej był zalogowany
          S.loggedIn = false; S.user = null;
          S.favorites = new Set(); S.alerts = []; S.history = []; S.favAp = null;
          updateAuthUI(); renderResults();
        }
      }
    });
  } else {
    // Firebase niedostępny — wczytaj z localStorage
    const savedUser = localStorage.getItem('lnw_u');
    if (savedUser) { S.user = JSON.parse(savedUser); S.loggedIn = true; }
    loadFromLocalStorage();
    updateAuthUI();
  }

  // 3. Motyw
  const savedTheme = localStorage.getItem('lnw_th');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.getElementById('themeBtn').textContent = savedTheme === 'light' ? '☀️' : '🌙';
  }

  // 4. ⚡ ŁADOWANIE LOTÓW Z PLIKU JSON
  // Wykonaj zanim wyrenderujemy wyniki, żeby od razu pokazać pełny dataset
  await loadFlights();
  recomputeCheapest();
  updateLastUpdatedUI();

  // Ustaw counter targets na podstawie rzeczywistych danych (Bug 10)
  const cntF = document.getElementById('cntFlights');
  const cntD = document.getElementById('cntDests');
  const cntO = document.getElementById('cntOrigins');
  if (cntF) cntF.dataset.target = FLIGHTS.length;
  if (cntD) cntD.dataset.target = new Set(FLIGHTS.map(f => f.to)).size;
  if (cntO) cntO.dataset.target = new Set(FLIGHTS.map(f => f.from)).size;

  // 5. Init UI
  initTicker(); initVibes(); initVibeScroll(); initMonths();
  setupOriginChips(); setupDestAC();
  renderResults(); initMap(); initTW(); initCounters(); initIO();

  // 6. Event listeners
  document.getElementById('loginBtn').onclick    = () => openModal('login');
  document.getElementById('registerBtn').onclick = () => openModal('reg');
  document.getElementById('panelBtn').onclick    = () => openUserPanel();
  document.getElementById('authModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closePanel(); } });
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshFlights);

  // 6. Symulacja bg sync
  let syncTimer;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) syncTimer = setTimeout(() => {
      if (S.loggedIn) toast('info','🔔','Nowy tani lot!','KTW → AMS od 179 PLN – niższa cena!');
    }, 8000);
    else clearTimeout(syncTimer);
  });

  setTimeout(() => {
    const ago = formatLastUpdated(FLIGHTS_META.lastUpdated);
    toast('info','✈','Witaj!',`${FLIGHTS.length} lotów · dane z ${ago}`);
  }, 1200);
});

/* ================================================================
   SEKCJA 7: AUTENTYKACJA — Firebase Auth
================================================================ */

/** Logowanie przez Firebase Auth */
async function doLogin() {
  const email = document.getElementById('lEmail').value.trim();
  const pass  = document.getElementById('lPass').value;
  if (!email || !pass) { showAuthError('Uzupełnij email i hasło'); return; }

  showAuthSpinner(true);
  try {
    if (FIREBASE_READY) {
      await fbAuth.signInWithEmailAndPassword(email, pass);
      // onAuthStateChanged obsługuje resztę
    } else {
      // Tryb offline — mock
      S.user = {uid: 'local_' + Date.now(), email, name: email.split('@')[0]};
      S.loggedIn = true;
      localStorage.setItem('lnw_u', JSON.stringify(S.user));
      updateAuthUI();
      toast('success','👋',`Witaj, ${S.user.name}!`,'(tryb offline — Firebase niedostępny)');
    }
    closeModal();
  } catch (e) {
    showAuthError(firebaseErrorToPolish(e.code));
  } finally {
    showAuthSpinner(false);
  }
}

/** Rejestracja przez Firebase Auth */
async function doRegister() {
  const email = document.getElementById('rEmail').value.trim();
  const name  = document.getElementById('rName').value.trim();
  const pass  = document.getElementById('rPass').value;
  const pass2 = document.getElementById('rPass2').value;

  if (!email || !pass)  { showAuthError('Uzupełnij email i hasło'); return; }
  if (pass !== pass2)   { showAuthError('Hasła się nie zgadzają'); return; }
  if (pass.length < 8)  { showAuthError('Hasło musi mieć min. 8 znaków'); return; }

  showAuthSpinner(true);
  try {
    if (FIREBASE_READY) {
      const cred = await fbAuth.createUserWithEmailAndPassword(email, pass);
      // Ustaw displayName
      if (name) await cred.user.updateProfile({displayName: name});
      // Wyślij email powitalny przez EmailJS
      await sendWelcomeEmail(email, name || email.split('@')[0]);
      // onAuthStateChanged obsługuje resztę
    } else {
      S.user = {uid:'local_'+Date.now(), email, name: name || email.split('@')[0]};
      S.loggedIn = true;
      localStorage.setItem('lnw_u', JSON.stringify(S.user));
      updateAuthUI();
      toast('success','🎉',`Konto utworzone!`,`Witaj, ${S.user.name}!`);
    }
    closeModal();
  } catch (e) {
    showAuthError(firebaseErrorToPolish(e.code));
  } finally {
    showAuthSpinner(false);
  }
}

/** Reset hasła przez Firebase Auth */
async function sendPasswordReset(e) {
  if (e) e.preventDefault();
  const email = document.getElementById('lEmail').value.trim();
  if (!email) { showAuthError('Wpisz swój email powyżej, by zresetować hasło'); return; }
  if (!FIREBASE_READY) { showAuthError('Firebase niedostępny — sprawdź konfigurację'); return; }
  try {
    await fbAuth.sendPasswordResetEmail(email);
    showAuthError('📧 Wysłano link do resetowania hasła na ' + email, true);
  } catch (e) {
    showAuthError(firebaseErrorToPolish(e.code));
  }
}

/** Wylogowanie */
async function doLogout() {
  try {
    if (FIREBASE_READY) await fbAuth.signOut();
    else { S.loggedIn = false; S.user = null; localStorage.removeItem('lnw_u'); }
    S.favorites = new Set(); S.alerts = []; S.history = []; S.favAp = null;
    S.origins = []; renderChips(); updateMapRoutes();
    closePanel(); updateAuthUI(); renderResults();
    toast('info','👋','Wylogowano','Do zobaczenia!');
  } catch (e) {
    toast('error','⚠️','Błąd wylogowania', e.message);
  }
}

/** Tłumaczenie błędów Firebase na polski */
function firebaseErrorToPolish(code) {
  const map = {
    'auth/user-not-found':      'Nie znaleziono konta z tym emailem',
    'auth/wrong-password':      'Nieprawidłowe hasło',
    'auth/invalid-credential':  'Nieprawidłowy email lub hasło',
    'auth/email-already-in-use':'Ten email jest już zarejestrowany',
    'auth/weak-password':       'Hasło jest za słabe (min. 8 znaków)',
    'auth/invalid-email':       'Nieprawidłowy format adresu email',
    'auth/too-many-requests':   'Za dużo prób — odczekaj chwilę i spróbuj ponownie',
    'auth/network-request-failed':'Brak połączenia z internetem',
    'auth/user-disabled':       'To konto zostało zablokowane',
  };
  return map[code] || 'Wystąpił błąd. Spróbuj ponownie.';
}

function showAuthError(msg, success = false) {
  const el = document.getElementById('authError');
  el.style.display = 'block';
  el.style.color   = success ? '#70d890' : '#f59090';
  el.style.background = success ? 'rgba(80,200,80,.08)' : 'rgba(200,60,60,.1)';
  el.textContent   = msg;
}

function showAuthSpinner(show) {
  document.getElementById('authSpinner').style.display = show ? 'block' : 'none';
  document.getElementById('loginF').style.opacity     = show ? '0.4' : '1';
  document.getElementById('regF').style.opacity       = show ? '0.4' : '1';
}

function updateAuthUI() {
  const l = document.getElementById('loginBtn');
  const r = document.getElementById('registerBtn');
  const p = document.getElementById('panelBtn');
  if (S.loggedIn && S.user) {
    l.style.display = 'none'; r.style.display = 'none';
    p.style.display = 'flex'; p.textContent = `👤 ${S.user.name}`;
  } else {
    l.style.display = 'flex'; r.style.display = 'flex';
    p.style.display = 'none';
  }
}

/* ================================================================
   SEKCJA 8: EMAILJS — wysyłanie emaili
================================================================ */

/**
 * Wyślij email powitalny po rejestracji.
 */
async function sendWelcomeEmail(email, name) {
  if (!EMAILJS_READY) { console.log('[EmailJS] Pominięto — brak konfiguracji'); return; }
  try {
    await emailjs.send(
      window.EMAILJS_CONFIG.serviceId,
      window.EMAILJS_CONFIG.templateWelcome,
      {
        to_email:  email,
        to_name:   name,
        app_name:  window.APP_SETTINGS?.appName || 'Loty na Weekend',
        app_url:   window.APP_SETTINGS?.appUrl  || 'https://lotynaweekend.pl',
        reply_to:  window.APP_SETTINGS?.fromEmail || 'noreply@lotynaweekend.pl',
      }
    );
    console.log('[EmailJS] ✅ Email powitalny wysłany do', email);
  } catch (e) {
    console.warn('[EmailJS] Nie udało się wysłać emaila powitalnego:', e.text || e.message);
  }
}

/**
 * Newsletter — formularz zapisu na alerty.
 * Wysyła email z potwierdzeniem przez EmailJS, zapisuje subskrypcję w Firestore.
 */
async function submitNL(e) {
  e.preventDefault();
  const email  = document.getElementById('nlEmail').value.trim();
  const originRaw = document.getElementById('nlOrigin').value.trim();
  const origin = AIRPORTS.find(a => a.code === originRaw.toUpperCase() ||
                                     a.name.toLowerCase().includes(originRaw.toLowerCase()))?.code || 'KTW';
  const dest   = document.getElementById('nlDest').value.trim()   || 'Gdziekolwiek';
  const btn    = document.getElementById('nlBtn');
  const status = document.getElementById('nlStatus');

  if (!email || !email.includes('@')) {
    toast('error','⚠️','Nieprawidłowy email','Wpisz poprawny adres e-mail'); return;
  }

  // Blokuj przycisk podczas wysyłki
  btn.disabled   = true;
  btn.textContent = '⏳ Wysyłanie...';
  status.style.display = 'none';

  let emailSent = false;

  // 1. Wyślij email potwierdzający przez EmailJS
  if (EMAILJS_READY) {
    try {
      await emailjs.send(
        window.EMAILJS_CONFIG.serviceId,
        window.EMAILJS_CONFIG.templateSubscribe,
        {
          to_email:    email,
          from_origin: origin,
          to_dest:     dest,
          days:        'Piątek–Niedziela (weekendowe)',
          app_name:    window.APP_SETTINGS?.appName || 'Loty na Weekend',
          app_url:     window.APP_SETTINGS?.appUrl  || 'https://lotynaweekend.pl',
          reply_to:    window.APP_SETTINGS?.fromEmail || 'noreply@lotynaweekend.pl',
        }
      );
      emailSent = true;
      console.log('[EmailJS] ✅ Potwierdzenie subskrypcji wysłane do', email);
    } catch (err) {
      console.warn('[EmailJS] Błąd wysyłki:', err.text || err.message);
      // Nie przerywaj zapisu mimo błędu emaila
    }
  }

  // 2. Zapisz subskrypcję w Firestore (jeśli zalogowana) lub localStorage
  const alertData = {
    id:      'a' + Date.now(),
    email,
    route:   `${origin} → ${dest}`,
    days:    'Pt–Nd',
    added:   new Date().toLocaleDateString('pl-PL',{day:'numeric',month:'short',year:'numeric'}),
    active:  true
  };

  S.alerts.push(alertData);
  saveUserDataToFirestore();

  // Zapis do Firestore dla anonimowych subskrybentów
  if (FIREBASE_READY && !S.loggedIn) {
    try {
      await fbDb.collection('newsletter_subscribers').add({
        email, origin, dest, createdAt: firebase.firestore.FieldValue.serverTimestamp(), active: true
      });
    } catch (err) { console.warn('[Firestore] Błąd zapisu subskrybenta:', err.message); }
  }

  // UI — sukces
  btn.disabled    = false;
  btn.textContent = '🔔 Zapisz się';
  document.getElementById('nlForm').reset();

  const msg = emailSent
    ? `✅ Zapisano! Sprawdź skrzynkę ${email} — wysłaliśmy potwierdzenie.`
    : `✅ Zapisano alerty dla ${origin} → ${dest}!`;
  status.style.display = 'block';
  status.style.color   = '#70d890';
  status.textContent   = msg;
  setTimeout(() => status.style.display = 'none', 6000);

  toast('success','🔔','Zapisano na alerty!', `${origin} → ${dest}`);
  if (document.getElementById('userPanel').classList.contains('open')) renderPanel();
}

/**
 * Wyślij alert o nowym tanim locie (wywoływane przez cron/admin).
 * W produkcji: wywoływane z backend / GitHub Actions, nie z frontendu.
 */
async function sendPriceAlertEmail(toEmail, flight) {
  if (!EMAILJS_READY) return false;
  try {
    await emailjs.send(
      window.EMAILJS_CONFIG.serviceId,
      window.EMAILJS_CONFIG.templatePriceAlert,
      {
        to_email:   toEmail,
        from_city:  flight.fromCity,
        to_city:    flight.toCity,
        flight_date:flight.date,
        price_one:  `${flight.price1} PLN`,
        price_rt:   `${flight.price2} PLN`,
        airline:    flight.airline === 'ryanair' ? 'Ryanair' : 'Wizzair',
        has_sea:    flight.sea     ? 'Tak ✅' : 'Nie',
        is_lgbtfr:  flight.lgbt    ? 'Tak 🏳️‍🌈' : 'Nie',
        book_url:   flight.airline === 'ryanair' ? 'https://ryanair.com' : 'https://wizzair.com',
        app_url:    window.APP_SETTINGS?.appUrl || 'https://lotynaweekend.pl',
      }
    );
    return true;
  } catch (e) {
    console.error('[EmailJS] Błąd wysyłki alertu:', e.text || e.message);
    return false;
  }
}

/* ================================================================
   SEKCJA 9: UI — Ticker, Vibe Cards, Miesiące
================================================================ */

function initTicker() {
  const items = [...TICKER_DATA, ...TICKER_DATA];
  document.getElementById('tickerInner').innerHTML =
    items.map(t => `<span class="ticker-item">✈ ${t.from} → ${t.to} <strong>${t.p}</strong></span><span class="ticker-div">|</span>`).join('');
}

function initVibes() {
  document.getElementById('vibeGrid').innerHTML = VIBES.map(d => `
    <div class="vibe-card si" role="listitem" tabindex="0"
         onclick="pickDest('${d.destCode}','${d.city}')"
         onkeydown="if(event.key==='Enter')pickDest('${d.destCode}','${d.city}')"
         aria-label="${d.city}, ${d.country} – ${d.price}">
      <img src="${d.img}" alt="${d.alt}" loading="lazy"/>
      <div class="vibe-overlay" aria-hidden="true"></div>
      <div class="vibe-badge">${d.country}</div>
      <div class="vibe-content">
        <div class="vibe-city">${d.city}</div>
        <div class="vibe-ctry">${d.badge}</div>
        <div class="vibe-price">${d.price}</div>
      </div>
    </div>`).join('');
}

function initVibeScroll() {
  const g = document.getElementById('vibeGrid');
  let down=false, sx, sl;
  g.addEventListener('mousedown', e => { down=true; g.classList.add('grabbing'); sx=e.pageX-g.offsetLeft; sl=g.scrollLeft; });
  g.addEventListener('mouseleave', () => { down=false; g.classList.remove('grabbing'); });
  g.addEventListener('mouseup',   () => { down=false; g.classList.remove('grabbing'); });
  g.addEventListener('mousemove', e => { if(!down)return; e.preventDefault(); g.scrollLeft = sl-(e.pageX-g.offsetLeft-sx)*1.2; });
  let tx;
  g.addEventListener('touchstart', e => { tx=e.touches[0].clientX; sl=g.scrollLeft; }, {passive:true});
  g.addEventListener('touchmove',  e => { g.scrollLeft = sl+(tx-e.touches[0].clientX); }, {passive:true});
}

function scrollVibe(dir) { document.getElementById('vibeGrid').scrollBy({left:dir*400,behavior:'smooth'}); }

function pickDest(code, city) {
  const ap = AIRPORTS.find(a => a.code === code);
  document.getElementById('destIn').value = ap ? `${ap.name} (${ap.code})` : city;
  S.destFilter = code.toLowerCase();
  showDestBadge(city);
  document.getElementById('search').scrollIntoView({behavior:'smooth'});
  toast('info','✈',`Wybrany cel: ${city}`,'Naciśnij "Szukaj lotów"');
}

function clearDest() {
  S.destFilter = '';
  document.getElementById('destIn').value = '';
  document.getElementById('activeDestBadge').style.display = 'none';
}

function showDestBadge(city) {
  document.getElementById('activeDestBadge').style.display = 'flex';
  document.getElementById('activeDestLabel').textContent   = city;
}

/**
 * Inicjalizuje selektor roku/miesiąca z trzema trybami:
 *  • 'current' — rok bieżący (CUR_YR)  + wybór miesięcy
 *  • 'next'    — rok przyszły (CUR_YR+1) + wybór miesięcy
 *  • 'any'     — "Bez znaczenia" — data nie jest filtrem
 */
function initMonths() {
  const tabsEl  = document.getElementById('yrTabs');
  const gridsEl = document.getElementById('monthGridsWrap');
  tabsEl.innerHTML = ''; gridsEl.innerHTML = '';

  // ── Trzy przyciski trybu ──────────────────────────────────────
  const modes = [
    { id:'current', label:`${CUR_YR} (ten rok)`,    icon:'📅' },
    { id:'next',    label:`${CUR_YR+1} (następny)`, icon:'📆' },
    { id:'any',     label:'Bez znaczenia',           icon:'🔄' },
  ];

  modes.forEach(m => {
    const btn = document.createElement('button');
    btn.className   = 'yr-tab' + (m.id === S.yearMode ? ' on' : '');
    btn.dataset.mode = m.id;
    btn.setAttribute('role','tab');
    btn.setAttribute('aria-selected', m.id === S.yearMode ? 'true' : 'false');
    btn.innerHTML = `${m.icon} ${m.label}`;
    btn.onclick = () => setYearMode(m.id);
    tabsEl.appendChild(btn);
  });

  // ── Dwie siatki miesięcy (current + next) ────────────────────
  YEARS.forEach(yr => {
    const grid = document.createElement('div');
    grid.className = 'months-grid';
    grid.id        = `mGrid${yr}`;
    // Widoczna tylko gdy tryb odpowiada temu rokowi
    grid.style.display = (
      (yr === CUR_YR && S.yearMode === 'current') ||
      (yr === CUR_YR+1 && S.yearMode === 'next')
    ) ? 'grid' : 'none';
    grid.style.marginTop = '12px';
    grid.innerHTML = MO_PL.map((mo, i) => {
      const monthNum = i + 1;
      const isPast   = yr < NOW.getFullYear() ||
                       (yr === NOW.getFullYear() && monthNum < NOW.getMonth() + 1);
      const isOn     = S.months.includes(`${yr}-${monthNum}`);
      return `<button
        class="mo-btn${isPast?' past':''}${isOn?' on':''}"
        data-m="${monthNum}" data-y="${yr}"
        ${isPast ? 'disabled aria-disabled="true" title="Miniony miesiąc"' : ''}
        onclick="togMonth(this,${yr},${monthNum})"
        aria-label="${mo} ${yr}" aria-pressed="${isOn}">${mo}</button>`;
    }).join('');
    gridsEl.appendChild(grid);
  });

  // ── Komunikat "Bez znaczenia" ─────────────────────────────────
  const anyMsg = document.createElement('p');
  anyMsg.id        = 'anyModeMsg';
  anyMsg.style.cssText = `
    font-size:.82rem; color:var(--text-secondary); margin-top:12px;
    padding:10px 14px; background:var(--bg-glass); border-radius:var(--radius-sm);
    border:1px solid var(--border-subtle); display:${S.yearMode==='any'?'block':'none'};
  `;
  anyMsg.innerHTML = '🔄 Szukasz we <strong>wszystkich dostępnych terminach</strong> — rok i miesiąc nie mają znaczenia.';
  gridsEl.appendChild(anyMsg);
}

/**
 * Przełącza tryb roku. Czyści zaznaczone miesiące przy zmianie trybu.
 */
function setYearMode(mode) {
  if (S.yearMode === mode) return; // Bez zmian
  S.yearMode = mode;
  S.months   = [];                 // Resetuj miesiące przy zmianie trybu

  // Aktualizuj przyciski trybu
  document.querySelectorAll('.yr-tab').forEach(t => {
    const isOn = t.dataset.mode === mode;
    t.classList.toggle('on', isOn);
    t.setAttribute('aria-selected', isOn);
  });

  // Pokaż/ukryj siatki miesięcy i komunikat
  const gridCur = document.getElementById(`mGrid${CUR_YR}`);
  const gridNxt = document.getElementById(`mGrid${CUR_YR+1}`);
  const anyMsg  = document.getElementById('anyModeMsg');
  if (gridCur) gridCur.style.display = mode === 'current' ? 'grid' : 'none';
  if (gridNxt) gridNxt.style.display = mode === 'next'    ? 'grid' : 'none';
  if (anyMsg)  anyMsg.style.display  = mode === 'any'     ? 'block': 'none';

  // Odznacz wszystkie miesiące wizualnie
  document.querySelectorAll('.mo-btn.on').forEach(b => {
    b.classList.remove('on');
    b.setAttribute('aria-pressed','false');
  });
}

function togMonth(btn, yr, m) {
  const k = `${yr}-${m}`;
  if (S.months.includes(k)) {
    S.months = S.months.filter(x => x !== k);
    btn.classList.remove('on');
    btn.setAttribute('aria-pressed','false');
  } else {
    S.months.push(k);
    btn.classList.add('on');
    btn.setAttribute('aria-pressed','true');
  }
}

// Alias zachowany dla wstecznej kompatybilności (stary setYr w HTML)
function setYr(btn, yr) {
  setYearMode(yr === String(CUR_YR) ? 'current' : 'next');
}

/* ================================================================
   SEKCJA 10: ORIGIN CHIPS + DEST AUTOCOMPLETE
================================================================ */
function setupOriginChips() {
  const inp  = document.getElementById('chipInput');
  const drop = document.getElementById('originDrop');
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { drop.classList.remove('open'); return; }
    const m = AIRPORTS.filter(a => a.isPL &&
      (a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)) &&
      !S.origins.find(o=>o.code===a.code)).slice(0,6);
    if (!m.length) { drop.classList.remove('open'); return; }
    drop.innerHTML = m.map(a=>`<div class="ac-item" role="option" tabindex="0" onclick="addOrigin('${a.code}','${a.name}')" onkeydown="if(event.key==='Enter')addOrigin('${a.code}','${a.name}')"><span class="ap-flag">${a.flag}</span><div><div class="ap-name">${a.name}</div><div class="ap-ctry">${a.country}</div></div><span class="ap-code">${a.code}</span></div>`).join('');
    drop.classList.add('open');
  });
  inp.addEventListener('keydown', e => { if(e.key==='Backspace'&&!inp.value&&S.origins.length) rmOrigin(S.origins[S.origins.length-1].code); });
  document.addEventListener('click', e => { if(!document.getElementById('chipsWrap').contains(e.target)) drop.classList.remove('open'); });
}

function addOrigin(code, name) {
  if (S.origins.find(o=>o.code===code)) return;
  S.origins.push({code,name}); renderChips();
  document.getElementById('chipInput').value=''; document.getElementById('originDrop').classList.remove('open');
  updateMapRoutes();
}
function rmOrigin(code) { S.origins=S.origins.filter(o=>o.code!==code); renderChips(); updateMapRoutes(); }
function renderChips() {
  document.getElementById('originChips').innerHTML = S.origins.map(o=>
    `<span class="a-chip">${o.code}<span class="a-chip-rm" onclick="rmOrigin('${o.code}')" role="button" tabindex="0">×</span></span>`
  ).join('');
}

function setupDestAC() {
  const inp  = document.getElementById('destIn');
  const drop = document.getElementById('destDrop');
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { drop.classList.remove('open'); return; }
    const extras = 'gdziekolwiek'.includes(q) ? [{code:'ANY',name:'Gdziekolwiek',country:'Wszystkie destynacje',flag:'🌍'}] : [];
    const m = AIRPORTS.filter(a => !a.isPL && (a.name.toLowerCase().includes(q)||a.code.toLowerCase().includes(q)||a.country.toLowerCase().includes(q))).slice(0,7);
    const all = [...extras,...m]; if(!all.length){drop.classList.remove('open');return;}
    drop.innerHTML = all.map(a=>`<div class="ac-item" role="option" tabindex="0" onclick="pickDestAC('${a.code}','${a.name}')" onkeydown="if(event.key==='Enter')pickDestAC('${a.code}','${a.name}')"><span class="ap-flag">${a.flag}</span><div><div class="ap-name">${a.name}</div><div class="ap-ctry">${a.country}</div></div><span class="ap-code">${a.code}</span></div>`).join('');
    drop.classList.add('open');
  });
  document.addEventListener('click', e => { if(!inp.contains(e.target)&&!drop.contains(e.target)) drop.classList.remove('open'); });
}
function pickDestAC(code,name) {
  document.getElementById('destIn').value = code==='ANY'?'Gdziekolwiek':`${name} (${code})`;
  document.getElementById('destDrop').classList.remove('open');
  if (code==='ANY') { S.destFilter=''; document.getElementById('activeDestBadge').style.display='none'; }
  else { S.destFilter=code.toLowerCase(); showDestBadge(name); }
}

/* ================================================================
   SEKCJA 11: FILTRY WYSZUKIWANIA
================================================================ */
function togAirline(a) {
  S.airlines[a]=!S.airlines[a];
  const btn=document.getElementById(a==='ryanair'?'togRy':'togWz');
  btn.classList.toggle(`a-${a}`,S.airlines[a]); btn.setAttribute('aria-pressed',S.airlines[a]);
}
function togDay(btn) { const d=btn.dataset.day; if(S.days.includes(d)){S.days=S.days.filter(x=>x!==d);btn.classList.remove('on');btn.setAttribute('aria-pressed','false');}else{S.days.push(d);btn.classList.add('on');btn.setAttribute('aria-pressed','true');} }
function updBudget(v) { S.budget=+v; document.getElementById('budgetV').textContent=S.budget>=3000?'Bez limitu':`${S.budget} PLN`; document.querySelectorAll('.b-chip').forEach(c=>c.classList.remove('on')); }
function setBudget(v) { S.budget=v; document.getElementById('budgetR').value=v; document.getElementById('budgetV').textContent=v>=3000?'Bez limitu':`${v} PLN`; document.querySelectorAll('.b-chip').forEach(c=>c.classList.toggle('on',c.textContent.includes(v>=3000?'limit':v))); }
function togSw(el) { el.classList.toggle('on'); const on=el.classList.contains('on'); el.setAttribute('aria-checked',on); if(el.id==='swRound')S.roundtrip=on; if(el.id==='swSea')S.seaOnly=on; if(el.id==='swLgbt')S.lgbtOnly=on; }

/* ================================================================
   SEKCJA 12: WYSZUKIWANIE I RENDEROWANIE WYNIKÓW
================================================================ */
function runSearch() {
  showLoad();
  setTimeout(() => {
    hideLoad(); renderResults();
    document.getElementById('results').scrollIntoView({behavior:'smooth'});
    if (S.loggedIn) {
      const o = S.origins.map(x=>x.code).join('+')||S.favAp?.code||'KTW';
      const d = document.getElementById('destIn').value||'Gdziekolwiek';
      S.history.unshift({route:`${o} → ${d}`, date:new Date().toLocaleDateString('pl-PL',{day:'numeric',month:'short'}), price:'–'});
      if(S.history.length>15) S.history.pop();
      saveUserDataToFirestore();
    }
    toast('success','✈','Loty znalezione!','Aktualne oferty na weekendy');
  }, 900);
}
function showLoad() { document.getElementById('loadingDiv').style.display='block'; document.getElementById('resultsGrid').style.display='none'; document.getElementById('emptyDiv').style.display='none'; }
function hideLoad() { document.getElementById('loadingDiv').style.display='none'; document.getElementById('resultsGrid').style.display='grid'; }

function getFlights() {
  const today=new Date(); today.setHours(0,0,0,0);
  const destRaw=document.getElementById('destIn').value.trim().toLowerCase();
  const codeMatch=destRaw.match(/\(([a-z]{3})\)$/i);
  const destCode=codeMatch?codeMatch[1].toUpperCase():'';
  const destCity=destRaw.replace(/\s*\([a-z]{3}\)$/i,'').trim();

  let fl = FLIGHTS.filter(f => {
    const flDate=new Date(f.raw); flDate.setHours(0,0,0,0);
    if (flDate<today) return false;                            // Zawsze odrzucaj przeszłe
    if (!S.airlines[f.airline]) return false;
    // Filtr po wzorcu weekendu (Pt-Nd, Sb-Nd, etc.) — pole f.pattern
    // Backward-compat: jeśli stary lot nie ma pattern, dopuść go (chyba że żadne
    // przyciski dni nie są zaznaczone — wtedy domyślnie pokaż wszystkie)
    if (S.days.length > 0 && f.pattern && !S.days.includes(f.pattern)) return false;
    const p=S.roundtrip?f.price2:f.price1;
    if (S.budget<3000&&p>S.budget) return false;
    if (S.seaOnly&&!f.sea) return false;
    if (S.lgbtOnly&&!f.lgbt) return false;

    // ── Filtr roku (na podstawie trybu) ──────────────────────
    // 'any'     → nie filtruj po roku w ogóle
    // 'current' → tylko rok bieżący (CUR_YR); jeśli wybrano miesiące — tylko one
    // 'next'    → tylko rok następny (CUR_YR+1); jeśli wybrano miesiące — tylko one
    if (S.yearMode === 'current') {
      if (f.year !== CUR_YR) return false;
      if (S.months.length > 0 && !S.months.includes(`${f.year}-${f.month}`)) return false;
    } else if (S.yearMode === 'next') {
      if (f.year !== CUR_YR + 1) return false;
      if (S.months.length > 0 && !S.months.includes(`${f.year}-${f.month}`)) return false;
    }
    // 'any' — miesiące ignorujemy (siatka ukryta, S.months zawsze [])

    if (S.origins.length>0&&!S.origins.find(o=>o.code===f.from)) return false;
    const activeDest=S.destFilter||destCity;
    if (activeDest&&activeDest!=='gdziekolwiek') {
      if (destCode) { if(f.to!==destCode)return false; }
      else { const df=activeDest.toLowerCase(); if(!f.to.toLowerCase().includes(df)&&!f.toCity.toLowerCase().includes(df)&&!f.country.toLowerCase().includes(df))return false; }
    }
    if (S.filter==='sea'&&!f.sea)return false;
    if (S.filter==='lgbt'&&!f.lgbt)return false;
    if (S.filter==='novisa'&&f.visa!=='brak')return false;
    if (S.filter==='english'&&!f.englishOk)return false;
    if (S.filter==='close'&&f.distKm>15)return false;
    if (S.filter==='cheapest'){const mn=Math.min(...FLIGHTS.map(x=>S.roundtrip?x.price2:x.price1));if(p>mn*1.65)return false;}
    return true;
  });

  fl.sort((a,b)=>{
    const pa=S.roundtrip?a.price2:a.price1, pb=S.roundtrip?b.price2:b.price1;
    if(S.sort==='price')return pa-pb; if(S.sort==='price-desc')return pb-pa;
    if(S.sort==='date')return new Date(a.raw)-new Date(b.raw);
    if(S.sort==='dur')return parseDur(a.dur)-parseDur(b.dur);
    if(S.sort==='dist')return a.distKm-b.distKm;
    return 0;
  });
  return fl;
}
function parseDur(d){const m=d.match(/(\d+)h (\d+)m/);return m?+m[1]*60+ +m[2]:999;}

function renderResults() {
  const fl=getFlights(), grid=document.getElementById('resultsGrid');
  const ryCount = fl.filter(f => f.airline === 'ryanair').length;
  const wzCount = fl.filter(f => f.airline === 'wizzair').length;
  document.getElementById('resNum').innerHTML =
    `${fl.length} <span style="font-size:.75rem;opacity:.7">(🔵 ${ryCount} · 💜 ${wzCount})</span>`;
  if (!fl.length) {
    grid.innerHTML=''; grid.style.display='none'; document.getElementById('emptyDiv').style.display='block';
    let title='Nie znaleziono lotów', msg='Zmień kryteria lub zwiększ budżet.';

    if (S.yearMode === 'current' && S.months.length > 0) {
      const mn = S.months.map(k=>{const[y,m]=k.split('-');return `${MO_PL[+m-1]}`;});
      title = `Brak lotów w ${CUR_YR} — ${mn.join(', ')}`;
      msg   = `Nie znaleziono lotów w roku <strong>${CUR_YR}</strong> w miesiącach: <strong>${mn.join(', ')}</strong>. Wybierz inne miesiące lub przełącz na rok następny.`;
    } else if (S.yearMode === 'current') {
      title = `Brak lotów w roku ${CUR_YR}`;
      msg   = `Nie znaleziono lotów spełniających kryteria w roku ${CUR_YR}. Spróbuj rok następny lub "Bez znaczenia".`;
    } else if (S.yearMode === 'next' && S.months.length > 0) {
      const mn = S.months.map(k=>{const[y,m]=k.split('-');return `${MO_PL[+m-1]}`;});
      title = `Brak lotów w ${CUR_YR+1} — ${mn.join(', ')}`;
      msg   = `Nie znaleziono lotów w roku <strong>${CUR_YR+1}</strong> w miesiącach: <strong>${mn.join(', ')}</strong>. Wybierz inne miesiące lub sprawdź rok bieżący.`;
    } else if (S.yearMode === 'next') {
      title = `Brak lotów w roku ${CUR_YR+1}`;
      msg   = `Nie znaleziono lotów w roku ${CUR_YR+1}. Loty na ten rok mogą być jeszcze niedostępne w ofercie. Spróbuj rok bieżący.`;
    } else {
      // 'any' lub bez filtra roku
      const dr = document.getElementById('destIn').value.trim();
      if (dr && dr !== 'Gdziekolwiek') {
        title = `Brak lotów do: ${dr.split('(')[0].trim()}`;
        msg   = 'Brak dostępnych lotów do tego miejsca. Spróbuj inne lotnisko lub zmień kryteria.';
      }
    }

    document.getElementById('emptyTitle').textContent=title;
    document.getElementById('emptyMsg').innerHTML=msg; return;
  }
  document.getElementById('emptyDiv').style.display='none'; grid.style.display='grid';
  grid.innerHTML=fl.map((f,i)=>cardHTML(f,i)).join('');
}

/**
 * Formatuje datę YYYY-MM-DD na "DD.MM.YYYY" (format wyświetlany na przyciskach)
 */
function formatDateShort(raw) {
  if (!raw) return '';
  const [y, m, d] = raw.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Buduje deep-link URL prowadzący bezpośrednio do wyszukiwania KONKRETNEGO lotu.
 *
 * ── RYANAIR ──────────────────────────────────────────────────────────────────
 * Format URL search results page (zweryfikowany na ryanair.com — generowany
 * przez ich własną stronę dla featured flights):
 *
 *   https://www.ryanair.com/pl/pl/trip/flights/select
 *     ?adults=1&teens=0&children=0&infants=0
 *     &dateOut=YYYY-MM-DD          ← data wylotu
 *     &isConnectedFlight=false
 *     &isReturn=false
 *     &discount=0
 *     &originIata=KTW
 *     &destinationIata=BCN
 *     &tpAdults=1&tpTeens=0&tpChildren=0&tpInfants=0
 *     &tpStartDate=YYYY-MM-DD
 *     &tpDiscount=0
 *     &tpOriginIata=KTW
 *     &tpDestinationIata=BCN
 *
 * URL `/trip/flights/select` to bezpośrednio strona z wynikami lotów,
 * gdzie użytkownik widzi wszystkie loty na dany dzień i wybiera ten o
 * pasującej godzinie (wyświetlonej na przycisku w naszej aplikacji).
 * Parametry tp* (trip parameters) są wymagane — bez nich Ryanair SPA
 * resetuje hydration i pokazuje pustą wyszukiwarkę.
 *
 * ── WIZZAIR ──────────────────────────────────────────────────────────────────
 * Format REST URL (stabilny od 2022):
 *   https://www.wizzair.com/pl-pl/booking/select-flight
 *     /{FROM}/{TO}/{YYYY-MM-DD}/null/{ADULTS}/{CHILDREN}/{INFANTS}/{PROMO}
 *
 * @param {string} airline  — 'ryanair' | 'wizzair'
 * @param {string} from     — kod IATA lotniska wylotu (np. 'KTW')
 * @param {string} to       — kod IATA lotniska przylotu (np. 'BCN')
 * @param {string} date     — data w formacie YYYY-MM-DD
 * @returns {string}        — pełny URL gotowy do href
 */
function buildFlightUrl(airline, from, to, date) {
  // Walidacja wejścia — zabezpieczenie przed nieprawidłowymi danymi.
  // Fallback do strony głównej linii jeśli dane są niepoprawne.
  if (!from || !to || !date) {
    console.error('[buildFlightUrl] Brak wymaganych parametrów:', {airline, from, to, date});
    return airline === 'ryanair' ? 'https://www.ryanair.com/pl/pl' : 'https://www.wizzair.com/pl-pl';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('[buildFlightUrl] Zły format daty (oczekiwane YYYY-MM-DD):', date);
    return airline === 'ryanair' ? 'https://www.ryanair.com/pl/pl' : 'https://www.wizzair.com/pl-pl';
  }
  const fromU = from.toUpperCase(), toU = to.toUpperCase();

  if (airline === 'ryanair') {
    // Format zweryfikowany na ryanair.com — kolejność i nazwy parametrów
    // dokładnie jak w URL-ach generowanych przez ich własną stronę.
    const params = new URLSearchParams([
      ['adults', '1'], ['teens', '0'], ['children', '0'], ['infants', '0'],
      ['dateOut', date],
      ['isConnectedFlight', 'false'],
      ['isReturn', 'false'],
      ['discount', '0'],
      ['originIata', fromU], ['destinationIata', toU],
      // Trip parameters (tp*) — wymagane przez Ryanair SPA do hydration
      ['tpAdults', '1'], ['tpTeens', '0'], ['tpChildren', '0'], ['tpInfants', '0'],
      ['tpStartDate', date],
      ['tpDiscount', '0'],
      ['tpOriginIata', fromU], ['tpDestinationIata', toU],
    ]);
    return `https://www.ryanair.com/pl/pl/trip/flights/select?${params.toString()}`;
  }

  // Wizzair — REST URL (stabilny format, z prefiksem www.)
  // /select-flight/{FROM}/{TO}/{DATE}/{DATE_IN}/{ADU}/{CHI}/{INF}/{PROMO}
  return `https://www.wizzair.com/pl-pl/booking/select-flight/${fromU}/${toU}/${date}/null/1/0/0/null`;
}

function cardHTML(f, i) {
  const p   = S.roundtrip ? f.price2 : f.price1;
  const fav = S.favorites.has(f.id);
  const atCls = f.airline === 'ryanair' ? 'at-ry' : 'at-wz';
  const atN   = f.airline === 'ryanair' ? '🔵 Ryanair' : '💜 Wizzair';

  // Data powrotu — z pola retRaw (dokładna data, nie przeliczana)
  const retDt  = new Date(f.retRaw);
  const retStr = `${cap(f.retDay)}, ${retDt.getDate()} ${MO_PL[retDt.getMonth()]}`;

  // ── Deep-linki do zakupu biletów ──────────────────────────────────────────
  // Wylot: od lotniska startowego do docelowego, na datę wylotu
  const urlOut = buildFlightUrl(f.airline, f.from, f.to, f.raw);
  // Powrót: od lotniska docelowego z powrotem do startowego, na datę powrotu
  const urlRet = buildFlightUrl(f.airline, f.to, f.from, f.retRaw);

  // Etykiety przycisków z datą i godziną wylotu — żeby użytkownik wiedział
  // który lot wybrać po otwarciu strony linii
  const outDateFmt = formatDateShort(f.raw);    // np. "17.04.2026"
  const retDateFmt = formatDateShort(f.retRaw); // np. "19.04.2026"
  // Skrócony format na przycisku: "17.04 · 06:40"
  const outLabel = `${outDateFmt.slice(0,5)} · ${f.dept}`;   // "17.04 · 06:40"
  const retLabel = `${retDateFmt.slice(0,5)} · ${f.retDept}`; // "19.04 · 20:00"

  // Badges
  const seaB  = f.sea  ? `<span class="badge badge-sea">🌊 Przy morzu</span>` : '';
  const lgbtB = f.lgbt
    ? `<span class="badge badge-lgbt" title="${f.lgbtN}">🏳️‍🌈 LGBT+ friendly</span>`
    : `<span class="badge badge-nolg" title="${f.lgbtN}">⚠️ Nieodp. LGBTQ+</span>`;
  const visaB = f.visa === 'brak'
    ? `<span class="badge badge-novisa">✅ Bez wizy</span>`
    : `<span class="badge badge-visa">📋 ${f.visa}</span>`;
  const passB = f.passport
    ? `<span class="badge badge-passport">🛂 Paszport wymagany</span>`
    : `<span class="badge badge-novisa" style="background:rgba(80,200,80,.08)">🪪 Dowód wystarczy</span>`;
  const engB  = f.englishOk
    ? `<span class="badge badge-english">🗣 Angielski OK</span>`
    : `<span class="badge badge-noenglish">🗣 Słaby angielski</span>`;

  // Sekcja powrotu
  const retSec = S.roundtrip ? `
    <hr class="leg-divider"/>
    <div class="return-leg">
      <div class="leg-lbl">
        ↩ Powrót: ${retStr} &nbsp;·&nbsp;
        <span style="color:var(--color-accent)">${f.to}</span> →
        <span style="color:var(--color-accent)">${f.from}</span>
      </div>
      <div class="leg-row">
        <div class="t-block">
          <div class="t-val">${f.retDept}</div>
          <div class="t-city">${f.toCity}</div>
          <div style="font-size:.62rem;color:var(--text-muted)">${f.to}</div>
        </div>
        <div class="dur-center">
          <div class="dur-txt">${f.dur}</div>
          <div class="dur-line"></div>
        </div>
        <div class="t-block" style="text-align:right">
          <div class="t-val">${f.retArr}</div>
          <div class="t-city">${f.fromCity}</div>
          <div style="font-size:.62rem;color:var(--text-muted)">${f.from}</div>
        </div>
      </div>
    </div>` : '';

  // ── Przyciski zakupu ────────────────────────────────────────────────────────
  // Tooltip wyjaśnia, że po kliknięciu użytkownik trafi na stronę linii z
  // wynikami dla tej daty — powinien wybrać lot o godzinie widocznej na przycisku.
  const outTooltip = `Otworzy ${f.airline === 'ryanair' ? 'Ryanair' : 'Wizzair'} z wynikami dla ${f.from}→${f.to} dnia ${outDateFmt}. Wybierz lot o godz. ${f.dept}.`;
  const retTooltip = `Otworzy ${f.airline === 'ryanair' ? 'Ryanair' : 'Wizzair'} z wynikami dla ${f.to}→${f.from} dnia ${retDateFmt}. Wybierz lot o godz. ${f.retDept}.`;

  const buyButtons = S.roundtrip ? `
    <div class="fc-buy-btns">
      <a href="${urlOut}"
         target="_blank" rel="noopener noreferrer"
         class="btn-book"
         title="${outTooltip}"
         aria-label="Kup bilet: ${f.fromCity} → ${f.toCity}, ${outDateFmt} godz. ${f.dept}">
        ✈ Tam &nbsp;${outLabel} ↗
      </a>
      <a href="${urlRet}"
         target="_blank" rel="noopener noreferrer"
         class="btn-book btn-book-ret"
         title="${retTooltip}"
         aria-label="Kup bilet powrotny: ${f.toCity} → ${f.fromCity}, ${retDateFmt} godz. ${f.retDept}">
        ↩ Powrót &nbsp;${retLabel} ↗
      </a>
    </div>` : `
    <a href="${urlOut}"
       target="_blank" rel="noopener noreferrer"
       class="btn-book"
       title="${outTooltip}"
       aria-label="Kup bilet: ${f.fromCity} → ${f.toCity}, ${outDateFmt} godz. ${f.dept}">
      ✈ Kup bilet &nbsp;${outLabel} ↗
    </a>`;

  return `
  <article class="flight-card" role="listitem" style="animation:stag .4s ease ${Math.min(i*.07,.5)}s both"
           aria-label="Lot ${f.fromCity}–${f.toCity}, ${p} PLN">

    <div class="fc-country">
      <span class="fc-flag">${f.flag}</span>
      <span class="fc-name">${f.country}</span>
      <span class="fc-route">${f.from} → ${f.to}</span>
    </div>

    <div class="fc-date">
      <span>📅</span>
      <span class="fc-date-txt">${f.date}</span>
      <span class="fc-date-dur">${f.dur} lotu</span>
    </div>

    <div class="fc-times">
      <div class="leg-lbl">✈ Wylot: ${cap(f.deptDay)} · ${f.from} → ${f.to} · ${f.toCity}</div>
      <div class="leg-row">
        <div class="t-block">
          <div class="t-val">${f.dept}</div>
          <div class="t-city">${f.fromCity}</div>
          <div style="font-size:.62rem;color:var(--text-muted)">${f.from}</div>
        </div>
        <div class="dur-center">
          <div class="dur-txt">${f.dur}</div>
          <div class="dur-line"></div>
          <div class="dur-txt" style="font-size:.67rem">bezpośredni</div>
        </div>
        <div class="t-block" style="text-align:right">
          <div class="t-val">${f.arr}</div>
          <div class="t-city">${f.toCity}</div>
          <div style="font-size:.62rem;color:var(--text-muted)">${f.to}</div>
        </div>
      </div>
      ${retSec}
    </div>

    <div class="fc-meta">${seaB}${lgbtB}${visaB}${passB}${engB}</div>

    <div class="fc-extra">
      <div class="fc-extra-item" title="Odległość lotniska od centrum miasta">
        <div class="fc-extra-val">~${f.distKm} km</div>
        <div class="fc-extra-lbl">Do centrum</div>
      </div>
      <div class="fc-extra-item" title="Waluta w miejscu docelowym">
        <div class="fc-extra-val">${f.currency}</div>
        <div class="fc-extra-lbl">Waluta</div>
      </div>
      <div class="fc-extra-item" title="Wymagania wizowe dla obywateli PL">
        <div class="fc-extra-val" style="${f.visa==='brak'?'color:#70d890':'color:#f0a850'}">
          ${f.visa === 'brak' ? 'Brak' : f.visa}
        </div>
        <div class="fc-extra-lbl">Wiza</div>
      </div>
      <div class="fc-extra-item" title="Czy angielski jest powszechnie rozumiany">
        <div class="fc-extra-val" style="${f.englishOk?'color:#78b8f8':'color:#c8a060'}">
          ${f.englishOk ? '✓ Tak' : '✗ Słaby'}
        </div>
        <div class="fc-extra-lbl">Angielski</div>
      </div>
    </div>

    <div class="fc-footer">
      <div>
        <div class="fc-price-main">${p} PLN</div>
        <div class="fc-price-sub">
          ${S.roundtrip ? `1 strona: ${f.price1} PLN` : `W obie: ${f.price2} PLN`} / os.
        </div>
        <span class="airline-tag ${atCls}">${atN}</span>
      </div>
      <div class="fc-actions">
        <button class="heart-btn${fav?' active':''}" onclick="togFav('${f.id}',this)"
                aria-label="${fav?'Usuń z':'Dodaj do'} ulubionych">
          ${fav ? '❤️' : '🤍'}
        </button>
        ${buyButtons}
      </div>
    </div>
  </article>`;
}

function cap(s){return s?s.charAt(0).toUpperCase()+s.slice(1):'';}
function setFilter(btn,f){document.querySelectorAll('.filt-chip').forEach(c=>c.classList.remove('on'));btn.classList.add('on');S.filter=f;renderResults();}
function doSort(v){S.sort=v;renderResults();}

function togFav(id,btn) {
  if (!S.loggedIn) { openModal('login'); toast('info','🔐','Zaloguj się','By zapisać ulubione'); return; }
  if (S.favorites.has(id)) {
    S.favorites.delete(id); btn.classList.remove('active'); btn.innerHTML='🤍';
    toast('info','🤍','Usunięto z ulubionych','');
  } else {
    S.favorites.add(id); btn.classList.add('active'); btn.innerHTML='❤️';
    toast('success','❤️','Dodano do ulubionych!','Znajdziesz w panelu.');
  }
  saveUserDataToFirestore();
  if (document.getElementById('userPanel').classList.contains('open')) renderPanel();
}

/* ================================================================
   SEKCJA 13: MAPA SVG
================================================================ */
function initMap() {
  const cg=document.getElementById('cPaths');
  CPATHS.forEach(c => {
    const fi=CHEAPEST_BY_COUNTRY[c.n]||CHEAPEST_BY_COUNTRY[c.cn];
    const isCheap=TOP3.has(c.n)||TOP3.has(c.cn);
    const hasFl=!!fi&&!c.noF;
    let cls='cp'; if(isCheap&&!c.noF)cls+=' cheapest'; else if(hasFl)cls+=' has-f';
    const p=document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d',c.d); p.setAttribute('class',cls);
    if(hasFl){p.addEventListener('mouseenter',e=>showCTT(e,c.n,fi));p.addEventListener('mouseleave',hideTT);p.addEventListener('click',()=>goToMap(fi.to,fi.toCity));}
    cg.appendChild(p);
  });
  drawRoutes(); drawDots();
}

function drawRoutes(origins=['KTW','KRK']) {
  const lg=document.getElementById('rLines'); lg.innerHTML='';
  const ors=AIRPORTS.filter(a=>origins.includes(a.code));
  FLIGHTS.forEach(f => {
    const o=ors.find(x=>x.code===f.from), d=AIRPORTS.find(a=>a.code===f.to);
    if(!o||!d)return;
    const l=document.createElementNS('http://www.w3.org/2000/svg','line');
    l.setAttribute('x1',o.x);l.setAttribute('y1',o.y);l.setAttribute('x2',d.x);l.setAttribute('y2',d.y);
    l.setAttribute('class',`route-line rl-${f.airline}`);l.setAttribute('data-from',f.from);l.setAttribute('data-to',f.to);
    lg.appendChild(l);
  });
}

function drawDots() {
  const dg=document.getElementById('aDots');
  AIRPORTS.forEach(a => {
    const g=document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('class','ap-dot');g.setAttribute('role','button');g.setAttribute('tabindex','0');g.setAttribute('aria-label',a.name);
    if(a.isPL){const ring=document.createElementNS('http://www.w3.org/2000/svg','circle');ring.setAttribute('cx',a.x);ring.setAttribute('cy',a.y);ring.setAttribute('r',10);ring.setAttribute('fill','var(--color-accent)');ring.setAttribute('opacity','.14');g.appendChild(ring);}
    const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');
    dot.setAttribute('cx',a.x);dot.setAttribute('cy',a.y);dot.setAttribute('r',a.isPL?6:4);
    dot.setAttribute('fill',a.isPL?'var(--color-accent)':'var(--color-secondary)');dot.setAttribute('opacity','.9');
    g.appendChild(dot);
    if(a.isPL){const lbl=document.createElementNS('http://www.w3.org/2000/svg','text');lbl.setAttribute('x',a.x+9);lbl.setAttribute('y',a.y+4);lbl.setAttribute('fill','var(--text-primary)');lbl.setAttribute('font-size','8');lbl.setAttribute('font-family','Source Sans 3,sans-serif');lbl.setAttribute('opacity','.72');lbl.textContent=a.code;g.appendChild(lbl);}
    const cf=FLIGHTS.filter(f=>f.to===a.code).sort((x,y)=>x.price1-y.price1)[0];
    g.addEventListener('mouseenter',e=>{showATT(e,a,cf);if(cf)hlRoutes(a.code);});
    g.addEventListener('mouseleave',()=>{hideTT();clRoutes();});
    g.addEventListener('click',()=>{if(!a.isPL)goToMap(a.code,a.name);});
    dg.appendChild(g);
  });
}

function updateMapRoutes(){const codes=S.origins.map(o=>o.code);if(S.favAp&&!codes.includes(S.favAp.code))codes.push(S.favAp.code);drawRoutes(codes.length?codes:['KTW','KRK']);}
function hlRoutes(code){document.querySelectorAll('.route-line').forEach(l=>{const m=l.getAttribute('data-to')===code;l.style.opacity=m?'0.9':'0.07';l.style.strokeWidth=m?'2.5':'';});}
function clRoutes(){document.querySelectorAll('.route-line').forEach(l=>{l.style.opacity='.3';l.style.strokeWidth='';});}
function showCTT(e,name,fi){const tt=document.getElementById('mapTt'),r=document.getElementById('worldMap').getBoundingClientRect();tt.innerHTML=`<div class="map-tt-name">${name}</div><div class="map-tt-price">od ${fi.price1} PLN</div><div class="map-tt-sub">${fi.from} → ${fi.to} · ${fi.airline==='ryanair'?'Ryanair':'Wizzair'}</div>`;tt.classList.add('vis');tt.style.left=(e.clientX-r.left+12)+'px';tt.style.top=Math.max(8,e.clientY-r.top-62)+'px';}
function showATT(e,a,f){const tt=document.getElementById('mapTt'),r=document.getElementById('worldMap').getBoundingClientRect();tt.innerHTML=`<div class="map-tt-name">${a.flag} ${a.name}</div>${f?`<div class="map-tt-price">od ${f.price1} PLN</div><div class="map-tt-sub">${f.from} → ${a.code}</div>`:`<div class="map-tt-sub">${a.country}</div>`}`;tt.classList.add('vis');tt.style.left=(e.clientX-r.left+12)+'px';tt.style.top=Math.max(8,e.clientY-r.top-52)+'px';}
function hideTT(){document.getElementById('mapTt').classList.remove('vis');}
function goToMap(code,name){document.getElementById('destIn').value=`${name} (${code})`;S.destFilter=code.toLowerCase();showDestBadge(name);document.getElementById('search').scrollIntoView({behavior:'smooth'});}

/* ================================================================
   SEKCJA 13b: PANEL WERYFIKACJI CEN
   Pozwala szybko porównać cenę z flights.json z tym, co pokazuje
   ryanair.com / wizzair.com (Wizzair: ceny BEZ Wizz Discount Club).
================================================================ */
function openVerifyPanel() {
  const panel = document.getElementById('verifyPanel');
  if (!panel) return;
  panel.style.display = 'block';
  pickRandomFlightForVerify();
  panel.scrollIntoView({behavior:'smooth', block:'center'});
}
function closeVerifyPanel() {
  const panel = document.getElementById('verifyPanel');
  if (panel) panel.style.display = 'none';
}
function pickRandomFlightForVerify() {
  const content = document.getElementById('verifyContent');
  if (!content || !FLIGHTS.length) {
    if (content) content.innerHTML = '<p style="color:var(--text-muted)">Brak lotów w bazie.</p>';
    return;
  }
  const f = FLIGHTS[Math.floor(Math.random() * FLIGHTS.length)];
  // Build verification URL identical to what we used for the buy buttons
  const carrierUrl  = buildFlightUrl(f.airline, f.from, f.to, f.raw);
  const fareFinderUrl = f.airline === 'ryanair'
    ? `https://www.ryanair.com/pl/pl/fare-finder?originIata=${f.from}&destinationIata=${f.to}&isReturn=true&adults=1&dateOut=${f.raw}&dateIn=${f.retRaw}&daysTrip=2&nightsFrom=1&nightsTo=3&dayOfWeek=FRIDAY,SATURDAY,SUNDAY&isFlexibleDay=true`
    : `https://www.wizzair.com/pl-pl/loty/wyszukiwarka-lotow/${f.from.toLowerCase()}/${f.to.toLowerCase()}/0/0/0/1/0/0/${f.raw}/${f.retRaw}?flexible=anytime&duration=weekend`;
  const airlineLbl = f.airline === 'ryanair' ? '🔵 Ryanair' : '💜 Wizzair';
  const note = f.airline === 'wizzair'
    ? '<p style="font-size:.78rem;color:var(--color-accent);margin-top:6px">⚠ Na stronie Wizzair przełącz widok na <strong>Ceny standardowe</strong> (nie Wizz Discount Club).</p>'
    : '';

  content.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;background:var(--bg-glass);padding:14px;border-radius:8px">
      <div>
        <div style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Trasa (${airlineLbl})</div>
        <div style="font-size:1rem;font-weight:600;margin-top:4px">${f.fromCity} → ${f.toCity}</div>
        <div style="font-size:.78rem;color:var(--text-secondary)">${f.from} → ${f.to}</div>
      </div>
      <div>
        <div style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Termin</div>
        <div style="font-size:1rem;margin-top:4px">${f.date}</div>
        <div style="font-size:.78rem;color:var(--text-secondary)">${f.raw} ⇄ ${f.retRaw}</div>
      </div>
      <div>
        <div style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Cena 1 strona</div>
        <div style="font-size:1.3rem;font-weight:700;color:var(--color-accent);margin-top:4px">${f.price1} PLN</div>
      </div>
      <div>
        <div style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Cena R/T</div>
        <div style="font-size:1.3rem;font-weight:700;color:var(--color-accent);margin-top:4px">${f.price2} PLN</div>
      </div>
    </div>
    ${note}
    <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap">
      <a href="${fareFinderUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-accent" style="flex:1;justify-content:center;text-decoration:none">
        🔎 Sprawdź na stronie linii
      </a>
      <a href="${carrierUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost" style="flex:1;justify-content:center;text-decoration:none">
        🎫 Otwórz konkretny lot
      </a>
    </div>
  `;
}

/* ================================================================
   SEKCJA 14: ULUBIONE LOTNISKO
================================================================ */
function filterFavAp(q){
  const s=document.getElementById('favApSugg');
  if(!q.trim()){s.style.display='none';return;}
  const m=AIRPORTS.filter(a=>a.isPL&&(a.name.toLowerCase().includes(q.toLowerCase())||a.code.toLowerCase().includes(q.toLowerCase())));
  if(!m.length){s.style.display='none';return;}
  s.innerHTML=m.map(a=>`<div class="ac-item" onclick="setFavAp('${a.code}','${a.name}')" style="cursor:pointer"><span class="ap-flag">${a.flag}</span><div><div class="ap-name">${a.name}</div></div><span class="ap-code">${a.code}</span></div>`).join('');
  s.style.display='block';
}
function setFavAp(code,name){
  S.favAp={code,name};
  document.getElementById('favApIn').value=''; document.getElementById('favApSugg').style.display='none';
  document.getElementById('favApCur').style.display='flex'; document.getElementById('favApCode').textContent=code; document.getElementById('favApName').textContent=name;
  applyFavAp(); saveUserDataToFirestore();
  toast('success','⭐',`Ulubione lotnisko: ${code}`,'Auto-uzupełni wyszukiwarkę i mapę');
}
function clearFavAp(){S.favAp=null;document.getElementById('favApCur').style.display='none';document.getElementById('favApIn').value='';document.getElementById('favApBadge').style.display='none';saveUserDataToFirestore();updateMapRoutes();}
function applyFavAp(){
  if(!S.favAp)return;
  if(!S.origins.find(o=>o.code===S.favAp.code))addOrigin(S.favAp.code,S.favAp.name);
  document.getElementById('favApBadge').style.display='flex';document.getElementById('favApLabel').textContent=`${S.favAp.code} – ${S.favAp.name}`;
  document.getElementById('favApCur').style.display='flex';document.getElementById('favApCode').textContent=S.favAp.code;document.getElementById('favApName').textContent=S.favAp.name;
  updateMapRoutes();
}

/* ================================================================
   SEKCJA 15: PANEL UŻYTKOWNIKA
================================================================ */
function openUserPanel(){document.getElementById('userPanel').classList.add('open');renderPanel();}
function closePanel(){document.getElementById('userPanel').classList.remove('open');}

function renderPanel(){
  if(!S.loggedIn)return;
  document.getElementById('pAvatar').textContent=S.user.name.charAt(0).toUpperCase();
  document.getElementById('pName').textContent=S.user.name;
  document.getElementById('pEmail').textContent=S.user.email;
  if(S.favAp){document.getElementById('favApCur').style.display='flex';document.getElementById('favApCode').textContent=S.favAp.code;document.getElementById('favApName').textContent=S.favAp.name;}
  document.getElementById('pHistory').innerHTML=!S.history.length?'<p style="color:var(--text-muted);font-size:.83rem">Brak historii</p>':S.history.map(x=>`<div class="hist-item" onclick="replaySearch('${x.route}')"><span style="opacity:.5">↺</span><div class="hist-route">${x.route}</div><div class="hist-date">${x.date}</div><div class="hist-price">${x.price}</div></div>`).join('');
  const favs=FLIGHTS.filter(f=>S.favorites.has(f.id));
  document.getElementById('pFavs').innerHTML=!favs.length?'<p style="color:var(--text-muted);font-size:.83rem">Brak ulubionych. Kliknij ❤️ przy locie.</p>':favs.map(f=>`<div class="fav-item"><span>${f.flag}</span><div class="fav-route">${f.fromCity} → ${f.toCity}</div><div class="fav-price">${S.roundtrip?f.price2:f.price1} PLN</div><button class="fav-rm" onclick="rmFav('${f.id}')">✕</button></div>`).join('');
  document.getElementById('pAlerts').innerHTML=!S.alerts.length?'<p style="color:var(--text-muted);font-size:.83rem">Brak alertów</p>':S.alerts.map(a=>`<div class="alert-item"><div class="alert-route">✈ ${a.route}</div><div class="alert-meta">📅 ${a.days} · Dodano: ${a.added}</div><button class="alert-rm" onclick="rmAlert('${a.id}')">✕</button></div>`).join('');
}

function rmFav(id){S.favorites.delete(id);saveUserDataToFirestore();renderResults();renderPanel();toast('info','🤍','Usunięto z ulubionych','');}
function rmAlert(id){S.alerts=S.alerts.filter(a=>a.id!==id);saveUserDataToFirestore();renderPanel();toast('info','🔕','Alert usunięty','');}
function replaySearch(r){const p=r.split(' → ');if(p[0]){const codes=p[0].split('+');codes.forEach(c=>{const a=AIRPORTS.find(x=>x.code===c);if(a)addOrigin(a.code,a.name);});}if(p[1])document.getElementById('destIn').value=p[1];closePanel();document.getElementById('search').scrollIntoView({behavior:'smooth'});}

/* ================================================================
   SEKCJA 16: MODAL AUTH
================================================================ */
function openModal(tab='login'){document.getElementById('authModal').classList.add('open');switchTab(tab);document.getElementById('authError').style.display='none';document.getElementById('authSpinner').style.display='none';}
function closeModal(){document.getElementById('authModal').classList.remove('open');}
function switchTab(t){document.getElementById('loginF').style.display=t==='login'?'block':'none';document.getElementById('regF').style.display=t==='reg'?'block':'none';document.getElementById('tabL').classList.toggle('on',t==='login');document.getElementById('tabR').classList.toggle('on',t==='reg');document.getElementById('authError').style.display='none';}

/* ================================================================
   SEKCJA 17: MOTYW
================================================================ */
function toggleTheme(){const h=document.documentElement,d=h.getAttribute('data-theme')==='dark';h.setAttribute('data-theme',d?'light':'dark');document.getElementById('themeBtn').textContent=d?'☀️':'🌙';localStorage.setItem('lnw_th',d?'light':'dark');}

/* ================================================================
   SEKCJA 18: TOAST
================================================================ */
function toast(type,icon,title,msg){
  const c=document.getElementById('toastWrap'),t=document.createElement('div');
  t.className='toast';t.setAttribute('role','alert');
  t.innerHTML=`<span class="toast-ico">${icon}</span><div><div class="toast-title">${title}</div>${msg?`<div class="toast-msg">${msg}</div>`:''}</div>`;
  c.appendChild(t);
  setTimeout(()=>{t.style.transition='all .3s ease';t.style.transform='translateX(110%)';t.style.opacity='0';setTimeout(()=>t.remove(),300);},3500);
}

/* ================================================================
   SEKCJA 19: TYPEWRITER, COUNTERS, INTERSECTION OBSERVER
================================================================ */
const TW_PH=['Najtańsze loty z Katowic i Krakowa','Znajdź swój idealny weekend!','Ryanair i Wizzair w jednym miejscu','Loty z dostępem do morza?','Destynacje LGBT+ friendly?','Filtruj po miesiącu i budżecie'];
let twI=0,twC=0,twD=false;
function initTW(){const el=document.getElementById('twEl');function tick(){const ph=TW_PH[twI];if(!twD){el.textContent=ph.slice(0,++twC);if(twC>=ph.length){twD=true;setTimeout(tick,2100);return;}}else{el.textContent=ph.slice(0,--twC);if(!twC){twD=false;twI=(twI+1)%TW_PH.length;}}setTimeout(tick,twD?38:70);}tick();}
function initCounters(){const io=new IntersectionObserver(es=>{es.forEach(e=>{if(!e.isIntersecting)return;const el=e.target,tg=+el.dataset.target,step=Math.ceil(tg/60);let c=0;const t=setInterval(()=>{c=Math.min(c+step,tg);el.textContent=c.toLocaleString('pl-PL');if(c>=tg)clearInterval(t);},22);io.unobserve(el);});},{threshold:.5});document.querySelectorAll('[data-target]').forEach(x=>io.observe(x));}
function initIO(){const io=new IntersectionObserver(es=>{es.forEach((e,i)=>{if(!e.isIntersecting)return;e.target.style.animationDelay=`${i*.07}s`;e.target.classList.add('vis');io.unobserve(e.target);});},{threshold:.08});document.querySelectorAll('.si').forEach(el=>io.observe(el));}
