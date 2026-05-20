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
  {code:'KTW',name:'Katowice Pyrzowice',        country:'Polska',          flag:'🇵🇱',lat:50.4743,lng:19.0800,isPL:true},
  {code:'KRK',name:'Kraków Balice',              country:'Polska',          flag:'🇵🇱',lat:50.0777,lng:19.7848,isPL:true},
  {code:'WAW',name:'Warszawa Chopin',             country:'Polska',          flag:'🇵🇱',lat:52.1672,lng:20.9679,isPL:true},
  {code:'WRO',name:'Wrocław Strachowice',         country:'Polska',          flag:'🇵🇱',lat:51.1027,lng:16.8858,isPL:true},
  {code:'GDN',name:'Gdańsk im. Wałęsy',           country:'Polska',          flag:'🇵🇱',lat:54.3776,lng:18.4662,isPL:true},
  {code:'POZ',name:'Poznań Ławica',               country:'Polska',          flag:'🇵🇱',lat:52.4210,lng:16.8263,isPL:true},
  {code:'BCN',name:'Barcelona El Prat',           country:'Hiszpania',       flag:'🇪🇸',lat:41.2971,lng:2.0785},
  {code:'MAD',name:'Madryt Barajas',              country:'Hiszpania',       flag:'🇪🇸',lat:40.4983,lng:-3.5676},
  {code:'ALC',name:'Alicante',                    country:'Hiszpania',       flag:'🇪🇸',lat:38.2822,lng:-0.5582},
  {code:'PMI',name:'Palma de Mallorca',           country:'Hiszpania',       flag:'🇪🇸',lat:39.5517,lng:2.7388},
  {code:'LIS',name:'Lizbona Humberto Delgado',    country:'Portugalia',      flag:'🇵🇹',lat:38.7742,lng:-9.1342},
  {code:'OPO',name:'Porto Francisco Sá Carneiro', country:'Portugalia',      flag:'🇵🇹',lat:41.2481,lng:-8.6814},
  {code:'FCO',name:'Rzym Fiumicino',              country:'Włochy',          flag:'🇮🇹',lat:41.8003,lng:12.2389},
  {code:'MXP',name:'Mediolan Malpensa',           country:'Włochy',          flag:'🇮🇹',lat:45.6301,lng:8.7232},
  {code:'NAP',name:'Neapol',                      country:'Włochy',          flag:'🇮🇹',lat:40.8860,lng:14.2908},
  {code:'ATH',name:'Ateny Eleftherios Venizelos', country:'Grecja',          flag:'🇬🇷',lat:37.9364,lng:23.9445},
  {code:'HER',name:'Heraklion Kreta',             country:'Grecja',          flag:'🇬🇷',lat:35.3397,lng:25.1803},
  {code:'DUB',name:'Dublin',                      country:'Irlandia',        flag:'🇮🇪',lat:53.4213,lng:-6.2701},
  {code:'STN',name:'Londyn Stansted',             country:'Wielka Brytania', flag:'🇬🇧',lat:51.8850,lng:0.2350},
  {code:'AMS',name:'Amsterdam Schiphol',          country:'Holandia',        flag:'🇳🇱',lat:52.3086,lng:4.7639},
  {code:'CDG',name:'Paryż Charles de Gaulle',     country:'Francja',         flag:'🇫🇷',lat:49.0097,lng:2.5479},
  {code:'TXL',name:'Berlin Brandenburg',          country:'Niemcy',          flag:'🇩🇪',lat:52.3667,lng:13.5033},
  {code:'VIE',name:'Wiedeń',                      country:'Austria',         flag:'🇦🇹',lat:48.1103,lng:16.5697},
  {code:'BUD',name:'Budapeszt',                   country:'Węgry',           flag:'🇭🇺',lat:47.4298,lng:19.2611},
  {code:'TIA',name:'Tirana',                      country:'Albania',         flag:'🇦🇱',lat:41.4147,lng:19.7206},
  {code:'SKP',name:'Skopje',                      country:'Macedonia Pn.',   flag:'🇲🇰',lat:41.9616,lng:21.6214},
  {code:'SSH',name:'Sharm el-Sheikh',             country:'Egipt',           flag:'🇪🇬',lat:27.9773,lng:34.3950},
  {code:'HRG',name:'Hurghada',                    country:'Egipt',           flag:'🇪🇬',lat:27.1784,lng:33.7994},
  {code:'RIX',name:'Ryga',                        country:'Łotwa',           flag:'🇱🇻',lat:56.9236,lng:23.9711},
  {code:'PRG',name:'Praga Václava Havla',         country:'Czechy',          flag:'🇨🇿',lat:50.1008,lng:14.2600},
  {code:'BRU',name:'Bruksela',                    country:'Belgia',          flag:'🇧🇪',lat:50.9010,lng:4.4844},
  {code:'EIN',name:'Eindhoven',                   country:'Holandia',        flag:'🇳🇱',lat:51.4501,lng:5.3745},
  {code:'MLA',name:'Malta',                       country:'Malta',           flag:'🇲🇹',lat:35.8574,lng:14.4775},
  {code:'SOF',name:'Sofia',                       country:'Bułgaria',        flag:'🇧🇬',lat:42.6967,lng:23.4114},
  {code:'OSL',name:'Oslo Torp',                   country:'Norwegia',        flag:'🇳🇴',lat:59.1869,lng:10.2558},
  {code:'CIA',name:'Rzym Ciampino',               country:'Włochy',          flag:'🇮🇹',lat:41.7994,lng:12.5949},
  {code:'OTP',name:'Bukareszt',                   country:'Rumunia',         flag:'🇷🇴',lat:44.5711,lng:26.0850},
  {code:'BVA',name:'Paryż Beauvais',              country:'Francja',         flag:'🇫🇷',lat:49.4544,lng:2.1128},
  {code:'AGP',name:'Malaga',                      country:'Hiszpania',       flag:'🇪🇸',lat:36.6749,lng:-4.4991},
  {code:'BGY',name:'Bergamo (Mediolan)',           country:'Włochy',          flag:'🇮🇹',lat:45.6739,lng:9.7042},
  {code:'RHO',name:'Rodos',                       country:'Grecja',          flag:'🇬🇷',lat:36.4054,lng:28.0862},
  {code:'NCE',name:'Nicea',                       country:'Francja',         flag:'🇫🇷',lat:43.6584,lng:7.2150},
  {code:'VAR',name:'Warna',                       country:'Bułgaria',        flag:'🇧🇬',lat:43.2321,lng:27.8251},
  {code:'LCA',name:'Larnaka (Cypr)',              country:'Cypr',            flag:'🇨🇾',lat:34.8751,lng:33.6249},
  {code:'LTN',name:'Londyn Luton',                country:'Wielka Brytania', flag:'🇬🇧',lat:51.8747,lng:-0.3683},
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
  {id:'fb1',airline:'wizzair',from:'KTW',to:'LTN',fromCity:'Katowice',toCity:'Londyn Luton',flag:'🇬🇧',country:'Wielka Brytania',dept:'19:45',arr:'22:10',retDept:'21:55',retArr:'00:20',deptDay:'piątek', retDay:'niedziela',dur:'2h 25m',date:'Pt–Nd, weekend',raw:'2026-06-06',retRaw:'2026-06-08',month:6,year:2026,price1:163,price2:295,sea:false,lgbt:true, lgbtN:'Londyn – jedna z najbardziej LGBTQ+ friendly metropolii',distKm:60,passport:true,visa:'brak',currency:'GBP £',englishOk:true,pattern:'fri-sun'},
  {id:'fb2',airline:'ryanair',from:'KTW',to:'STN',fromCity:'Katowice',toCity:'Londyn',     flag:'🇬🇧',country:'Wielka Brytania',dept:'06:00',arr:'08:35',retDept:'18:00',retArr:'20:35',deptDay:'sobota', retDay:'niedziela',dur:'2h 35m',date:'Sb–Nd, weekend',raw:'2026-05-16',retRaw:'2026-05-17',month:5,year:2026,price1:144,price2:245,sea:false,lgbt:true, lgbtN:'Londyn – jedna z najbardziej LGBTQ+ friendly metropolii',distKm:60,passport:true,visa:'brak',currency:'GBP £',englishOk:true,pattern:'sat-sun'},
  {id:'fb3',airline:'wizzair',from:'KRK',to:'BCN',fromCity:'Kraków',  toCity:'Barcelona',  flag:'🇪🇸',country:'Hiszpania',       dept:'14:00',arr:'17:25',retDept:'02:00',retArr:'05:25',deptDay:'piątek', retDay:'niedziela',dur:'3h 25m',date:'Pt–Nd, weekend',raw:'2026-06-05',retRaw:'2026-06-07',month:6,year:2026,price1:217,price2:369,sea:true, lgbt:true, lgbtN:'Barcelona – queer-friendly stolica Europy',distKm:14,passport:false,visa:'brak',currency:'EUR €',englishOk:true,pattern:'fri-sun'},
  {id:'fb4',airline:'ryanair',from:'KRK',to:'BGY',fromCity:'Kraków',  toCity:'Bergamo (Mediolan)',flag:'🇮🇹',country:'Włochy',     dept:'17:00',arr:'19:10',retDept:'05:00',retArr:'07:10',deptDay:'sobota', retDay:'niedziela',dur:'2h 10m',date:'Sb–Nd, weekend',raw:'2026-06-13',retRaw:'2026-06-14',month:6,year:2026,price1:101,price2:172,sea:false,lgbt:true, lgbtN:'Włochy – aktywna społeczność queer w dużych miastach',distKm:50,passport:false,visa:'brak',currency:'EUR €',englishOk:true,pattern:'sat-sun'},
  {id:'fb5',airline:'ryanair',from:'KTW',to:'BUD',fromCity:'Katowice',toCity:'Budapeszt',  flag:'🇭🇺',country:'Węgry',           dept:'07:45',arr:'09:15',retDept:'15:25',retArr:'16:55',deptDay:'piątek', retDay:'niedziela',dur:'1h 30m',date:'Pt–Nd, weekend',    raw:'2026-06-06',retRaw:'2026-06-08',month:6,year:2026,price1:99, price2:187,sea:false,lgbt:false,lgbtN:'Węgry – konstytucja zakazuje małżeństw jednopłciowych',distKm:23,passport:false,visa:'brak',currency:'HUF Ft',englishOk:true,pattern:'fri-sun'},
];

// Aktywna lista lotów — wczytywana dynamicznie z flights.json przez loadFlights()
let FLIGHTS = FALLBACK_FLIGHTS.slice();

// Paginacja wyników — pokazujemy po PAGE_SIZE kart naraz
const PAGE_SIZE = 48;
let _cachedFlights = [];
let _shownCount = 0;

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
    // Pre-compute timestamps once for fast filter/sort (avoids new Date() per-item per-render)
    FLIGHTS.forEach(f => { f._ts = Date.parse(f.raw); f._tsRet = Date.parse(f.retRaw); });
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
    FLIGHTS.forEach(f => { f._ts = Date.parse(f.raw); f._tsRet = Date.parse(f.retRaw); });
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
/* ── Odświeżanie przez serwer lokalny (server.js) ─────────────────────── */
let _refreshPollTimer = null;

async function _serverAvailable() {
  try {
    const r = await fetch('/api/refresh/status', { method: 'GET', signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

function openRefreshModal() {
  const m = document.getElementById('refreshModal');
  if (m) m.classList.add('open');
}
function closeRefreshModal() {
  const m = document.getElementById('refreshModal');
  if (m) m.classList.remove('open');
  if (_refreshPollTimer) { clearInterval(_refreshPollTimer); _refreshPollTimer = null; }
}

async function stopRefresh() {
  try { await fetch('/api/refresh/stop', { method: 'POST' }); } catch {}
  closeRefreshModal();
  const btn = document.getElementById('refreshBtn');
  if (btn) { btn.disabled = false; btn.textContent = '🔄 Odśwież'; }
}

function _setRefreshStatus(txt, cls) {
  const el = document.getElementById('rfStatus');
  if (!el) return;
  el.textContent = txt;
  el.className = 'rf-status ' + (cls || '');
}

function _appendLog(lines) {
  const box = document.getElementById('rfLog');
  if (!box) return;
  lines.forEach(l => {
    const d = document.createElement('div');
    d.className = 'rf-line';
    if (l.startsWith('[błąd]') || l.includes('❌')) d.className += ' rf-err';
    else if (l.includes('✅') || l.includes('Zakończono')) d.className += ' rf-ok';
    else if (l.includes('Wizzair') || l.includes('Okno') || l.includes('Cooldown')) d.className += ' rf-wzz';
    else if (l.includes('Ryanair') || l.startsWith('[')) d.className += ' rf-ry';
    d.textContent = l;
    box.appendChild(d);
  });
  box.scrollTop = box.scrollHeight;
}

async function _pollRefreshStatus() {
  try {
    const r   = await fetch('/api/refresh/status');
    const dat = await r.json();

    const box = document.getElementById('rfLog');
    const cur = box ? box.children.length : 0;
    const newLines = dat.log.slice(cur);
    if (newLines.length) _appendLog(newLines);

    if (dat.status === 'running') {
      const sec = dat.startedAt
        ? Math.round((Date.now() - new Date(dat.startedAt)) / 1000)
        : 0;
      const min = Math.floor(sec / 60), s = sec % 60;
      _setRefreshStatus(`⏳ Pobieranie… ${min}m ${s}s`, 'rf-running');
    } else if (dat.status === 'done') {
      _setRefreshStatus('✅ Gotowe — przeładowuję dane…', 'rf-done');
      clearInterval(_refreshPollTimer); _refreshPollTimer = null;
      setTimeout(async () => {
        await loadFlights(); recomputeCheapest(); updateLastUpdatedUI(); initTicker(); renderResults();
        if (LMap) { LMarkers.forEach(m=>LMap.removeLayer(m)); LRoutes.forEach(l=>LMap.removeLayer(l)); LMarkers=[]; LRoutes=[]; drawDots(); drawRoutes(); drawChoropleth(); }
        closeRefreshModal();
        const btn = document.getElementById('refreshBtn');
        if (btn) { btn.disabled = false; btn.textContent = '🔄 Odśwież'; }
        toast('success','✅','Zaktualizowano!',`${FLIGHTS.length} lotów · świeże dane`);
      }, 1200);
    } else if (dat.status === 'error') {
      _setRefreshStatus('❌ Błąd scrapera — sprawdź log', 'rf-err');
      clearInterval(_refreshPollTimer); _refreshPollTimer = null;
      const btn = document.getElementById('refreshBtn');
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Odśwież'; }
    }
  } catch(e) {
    _setRefreshStatus('⚠️ Utracono połączenie z serwerem', 'rf-err');
  }
}

async function refreshFlights() {
  const btn = document.getElementById('refreshBtn');

  // Tryb serwerowy: POST /api/refresh i pokaż modal postępu
  if (await _serverAvailable()) {
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Pobieranie…'; }

    const box = document.getElementById('rfLog');
    if (box) box.innerHTML = '';
    _setRefreshStatus('⏳ Łączenie ze scraperem…', 'rf-running');
    openRefreshModal();

    try {
      const r   = await fetch('/api/refresh', { method: 'POST' });
      const dat = await r.json();
      if (dat.status === 'already-running') {
        _setRefreshStatus('⏳ Scraper już działa…', 'rf-running');
      }
    } catch(e) {
      _setRefreshStatus('❌ Nie udało się połączyć z serwerem', 'rf-err');
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Odśwież'; }
      return;
    }

    _refreshPollTimer = setInterval(_pollRefreshStatus, 2500);
    return;
  }

  // Tryb statyczny (fallback): przeładuj flights.json z CDN/dysku
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Ładowanie...'; }
  toast('info','🔄','Odświeżanie...','Pobieranie aktualnych lotów');
  const ok = await loadFlights();
  updateLastUpdatedUI(); renderResults();
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


// Mapowanie polskich nazw krajów → ISO 3166-1 numeric (world-atlas)
const COUNTRY_ISO = {
  'Hiszpania':       724, 'Włochy':          380, 'Francja':         250,
  'Wielka Brytania': 826, 'Irlandia':        372, 'Holandia':        528,
  'Austria':          40, 'Węgry':           348, 'Albania':           8,
  'Macedonia Pn.':   807, 'Bułgaria':        100, 'Rumunia':         642,
  'Łotwa':           428, 'Norwegia':        578, 'Malta':           470,
  'Cypr':            196, 'Niemcy':          276, 'Czechy':          203,
  'Portugalia':      620, 'Grecja':          300,
};
const ISO_COUNTRY = Object.fromEntries(Object.entries(COUNTRY_ISO).map(([k,v]) => [v, k]));

// Leaflet map state
let LMap          = null;
let LTileLayer    = null;
let LLabelsLayer  = null;
let LGeoLayer     = null;
let _geoData      = null;
let LRoutes      = [];
let LMarkers     = [];

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
  allDates:   false,   // true = pokaż wszystkie terminy w budżecie, false = jeden najtańszy na trasę
};

// Liczba alternatywnych terminów dla każdego lotu (id → count), wypełniana przez getFlights()
let _altCounts = {};

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

  // 5. Event listeners — ALWAYS set up first, before anything that can throw
  document.getElementById('loginBtn').onclick    = () => openModal('login');
  document.getElementById('registerBtn').onclick = () => openModal('reg');
  document.getElementById('panelBtn').onclick    = () => openUserPanel();
  document.getElementById('authModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closePanel(); } });
  document.getElementById('themeBtn').addEventListener('click', toggleTheme);
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshFlights);

  // 6. Init UI
  initTicker(); initVibes(); initVibeScroll(); initMonths();
  setupOriginChips(); setupDestAC();
  _syncSliderFill(document.getElementById('budgetR'));
  renderResults(); initTW(); initCounters(); initIO();
  try { initMap(); } catch(e) { console.error('[Map] initMap failed:', e); }
  // If Leaflet loaded late (async), retry once after 800ms
  if (!LMap) setTimeout(() => { try { initMap(); } catch(e) {} }, 800);

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
  const apFirst = code => {
    const ap = AIRPORTS.find(a => a.code === code);
    if (!ap) return code;
    return ap.name.replace(/\s*\(.*\)/, '').split(' ')[0];
  };

  const seen = new Set();
  const deals = FLIGHTS
    .filter(f => f.price2 > 0)
    .sort((a, b) => a.price2 - b.price2)
    .filter(f => { const k = `${f.from}-${f.to}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 10);

  if (!deals.length) return;

  const mkItem = f =>
    `<button class="ticker-item" onclick="tickerClick('${f.from}','${f.to}')" aria-label="Lot ${f.from} → ${apFirst(f.to)} od ${f.price2} PLN w obie strony">` +
    `✈ ${f.from} → ${apFirst(f.to)} <strong>${f.price2} PLN</strong></button>` +
    `<span class="ticker-div">|</span>`;

  document.getElementById('tickerInner').innerHTML = [...deals, ...deals].map(mkItem).join('');
}

function tickerClick(from, to) {
  S.origins = [];
  renderChips();
  const ap = AIRPORTS.find(a => a.code === from);
  addOrigin(from, ap ? ap.name : from);

  const destAp = AIRPORTS.find(a => a.code === to);
  pickDestAC(to, destAp ? destAp.name : to);

  if (!S.roundtrip) {
    const sw = document.getElementById('swRound');
    if (sw) { sw.classList.add('on'); sw.setAttribute('aria-checked', 'true'); }
    S.roundtrip = true;
  }

  S.sort = 'price';

  renderResults();
  document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
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

  function availableDests() {
    if (S.origins.length > 0 && FLIGHTS.length > 0) {
      const fromSet = new Set(S.origins.map(o => o.code));
      const toSet   = new Set(FLIGHTS.filter(f => fromSet.has(f.from)).map(f => f.to));
      return AIRPORTS.filter(a => !a.isPL && toSet.has(a.code));
    }
    return AIRPORTS.filter(a => !a.isPL);
  }

  function showDrop(q) {
    const extras = (!q || 'gdziekolwiek'.includes(q)) ? [{code:'ANY',name:'Gdziekolwiek',country:'Wszystkie destynacje',flag:'🌍'}] : [];
    const pool   = availableDests();
    const m = q
      ? pool.filter(a => a.name.toLowerCase().includes(q)||a.code.toLowerCase().includes(q)||a.country.toLowerCase().includes(q)).slice(0, 7)
      : pool.slice(0, 6);
    const all = [...extras, ...m];
    if (!all.length) { drop.classList.remove('open'); return; }
    drop.innerHTML = all.map(a=>`<div class="ac-item" role="option" tabindex="0" onclick="pickDestAC('${a.code}','${a.name}')" onkeydown="if(event.key==='Enter')pickDestAC('${a.code}','${a.name}')"><span class="ap-flag">${a.flag}</span><div><div class="ap-name">${a.name}</div><div class="ap-ctry">${a.country}</div></div><span class="ap-code">${a.code}</span></div>`).join('');
    drop.classList.add('open');
  }

  inp.addEventListener('focus', () => {
    if (inp.value.trim() || S.origins.length === 0) return;
    showDrop('');
  });
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { drop.classList.remove('open'); if (S.origins.length > 0) showDrop(''); return; }
    showDrop(q);
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
function updBudget(v) {
  S.budget = +v;
  document.getElementById('budgetV').textContent = S.budget >= 3000 ? 'Bez limitu' : `${S.budget} PLN`;
  document.querySelectorAll('.b-chip').forEach(c => c.classList.remove('on'));
  _syncSliderFill(document.getElementById('budgetR'));
}
function setBudget(v) {
  S.budget = v;
  const r = document.getElementById('budgetR');
  r.value = v;
  document.getElementById('budgetV').textContent = v >= 3000 ? 'Bez limitu' : `${v} PLN`;
  document.querySelectorAll('.b-chip').forEach(c => c.classList.toggle('on', c.textContent.includes(v >= 3000 ? 'limit' : v)));
  _syncSliderFill(r);
}
function _syncSliderFill(r) {
  const pct = ((r.value - r.min) / (r.max - r.min) * 100).toFixed(1) + '%';
  r.style.setProperty('--val', pct);
}
function togSw(el) { el.classList.toggle('on'); const on=el.classList.contains('on'); el.setAttribute('aria-checked',on); if(el.id==='swRound')S.roundtrip=on; if(el.id==='swSea')S.seaOnly=on; if(el.id==='swLgbt')S.lgbtOnly=on; if(el.id==='swAllDates')S.allDates=on; }

function showAltDates(from, to) {
  S.origins = []; renderChips();
  const ap = AIRPORTS.find(a => a.code === from);
  addOrigin(from, ap ? ap.name : from);
  const dp = AIRPORTS.find(a => a.code === to);
  pickDestAC(to, dp ? dp.name : to);
  const sw = document.getElementById('swAllDates');
  if (sw && !S.allDates) { sw.classList.add('on'); sw.setAttribute('aria-checked', 'true'); S.allDates = true; }
  S.sort = 'date';
  renderResults();
  document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
}

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
    // Fly map to searched destination if specific one was chosen
    const codeMatch = document.getElementById('destIn').value.match(/\(([A-Z]{3})\)$/);
    if (codeMatch) flyMapTo(codeMatch[1]);
  }, 900);
}
function showLoad() { document.getElementById('loadingDiv').style.display='block'; document.getElementById('resultsGrid').style.display='none'; document.getElementById('emptyDiv').style.display='none'; }
function hideLoad() { document.getElementById('loadingDiv').style.display='none'; document.getElementById('resultsGrid').style.display='grid'; }

function getFlights() {
  const _now = new Date(); _now.setHours(0,0,0,0);
  const todayTs = _now.getTime();
  const destRaw=document.getElementById('destIn').value.trim().toLowerCase();
  const codeMatch=destRaw.match(/\(([a-z]{3})\)$/i);
  const destCode=codeMatch?codeMatch[1].toUpperCase():'';
  const destCity=destRaw.replace(/\s*\([a-z]{3}\)$/i,'').trim();

  // Pre-compute cheapest to avoid O(n²) spread inside filter
  const cheapestMin = S.filter==='cheapest'
    ? Math.min.apply(null, FLIGHTS.map(x=>S.roundtrip?x.price2:x.price1))
    : 0;

  let fl = FLIGHTS.filter(f => {
    if ((f._ts || Date.parse(f.raw)) < todayTs) return false;
    if (!S.airlines[f.airline]) return false;
    if (S.days.length > 0 && f.pattern && !S.days.includes(f.pattern)) return false;
    const p=S.roundtrip?f.price2:f.price1;
    if (S.budget<3000&&p>S.budget) return false;
    if (S.seaOnly&&!f.sea) return false;
    if (S.lgbtOnly&&!f.lgbt) return false;

    if (S.yearMode === 'current') {
      if (f.year !== CUR_YR) return false;
      if (S.months.length > 0 && !S.months.includes(`${f.year}-${f.month}`)) return false;
    } else if (S.yearMode === 'next') {
      if (f.year !== CUR_YR + 1) return false;
      if (S.months.length > 0 && !S.months.includes(`${f.year}-${f.month}`)) return false;
    }

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
    if (S.filter==='cheapest'&&p>cheapestMin*1.65)return false;
    return true;
  });

  // Deduplikacja — jeden najtańszy termin na trasę (jeśli tryb allDates wyłączony)
  _altCounts = {};
  if (!S.allDates) {
    const byRoute = new Map();
    fl.forEach(f => {
      const k = `${f.from}-${f.to}`;
      if (!byRoute.has(k)) byRoute.set(k, []);
      byRoute.get(k).push(f);
    });
    fl = [];
    byRoute.forEach(flights => {
      const price = f => S.roundtrip ? (f.price2 || 9999) : (f.price1 || 9999);
      const best  = flights.reduce((a, b) => price(a) <= price(b) ? a : b);
      _altCounts[best.id] = flights.length - 1;
      fl.push(best);
    });
  }

  fl.sort((a,b)=>{
    const pa=S.roundtrip?a.price2:a.price1, pb=S.roundtrip?b.price2:b.price1;
    if(S.sort==='price')return pa-pb; if(S.sort==='price-desc')return pb-pa;
    if(S.sort==='date')return (a._ts||Date.parse(a.raw))-(b._ts||Date.parse(b.raw));
    if(S.sort==='dur')return parseDur(a.dur)-parseDur(b.dur);
    if(S.sort==='dist')return a.distKm-b.distKm;
    return 0;
  });
  return fl;
}
function parseDur(d){const m=d.match(/(\d+)h (\d+)m/);return m?+m[1]*60+ +m[2]:999;}

function renderResults() {
  _cachedFlights = getFlights();
  _shownCount = 0;
  const grid = document.getElementById('resultsGrid');

  // Remove stale load-more button before re-render
  document.getElementById('loadMoreBtn')?.remove();

  const ryCount = _cachedFlights.filter(f => f.airline === 'ryanair').length;
  const wzCount = _cachedFlights.filter(f => f.airline === 'wizzair').length;
  const unitLabel = S.allDates ? 'terminów' : 'tras';
  document.getElementById('resNum').innerHTML =
    `${_cachedFlights.length} ${unitLabel} <span style="font-size:.75rem;opacity:.7">(🔵 ${ryCount} · 💜 ${wzCount})</span>`;

  if (!_cachedFlights.length) {
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
  _appendFlightCards(grid, true);
}

function _appendFlightCards(grid, reset) {
  const batch = _cachedFlights.slice(_shownCount, _shownCount + PAGE_SIZE);
  if (reset) {
    grid.innerHTML = batch.map((f,i) => cardHTML(f,i)).join('');
  } else {
    const div = document.createElement('div');
    div.innerHTML = batch.map((f,i) => cardHTML(f, _shownCount+i)).join('');
    while (div.firstChild) grid.appendChild(div.firstChild);
  }
  _shownCount += batch.length;

  let btn = document.getElementById('loadMoreBtn');
  const remaining = _cachedFlights.length - _shownCount;
  if (remaining > 0) {
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'loadMoreBtn';
      btn.className = 'btn-load-more';
      btn.onclick = () => _appendFlightCards(document.getElementById('resultsGrid'), false);
      grid.insertAdjacentElement('afterend', btn);
    }
    btn.textContent = `Załaduj więcej — jeszcze ${remaining} lotów ↓`;
  } else {
    btn?.remove();
  }
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
function buildFlightUrl(airline, from, to, date, retDate) {
  // Walidacja wejścia — zabezpieczenie przed nieprawidłowymi danymi.
  // Fallback do strony głównej linii jeśli dane są niepoprawne.
  if (!from || !to || !date) {
    console.error('[buildFlightUrl] Brak wymaganych parametrów:', {airline, from, to, date, retDate});
    return airline === 'ryanair' ? 'https://www.ryanair.com/pl/pl' : 'https://www.wizzair.com/pl-pl';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('[buildFlightUrl] Zły format daty (oczekiwane YYYY-MM-DD):', date);
    return airline === 'ryanair' ? 'https://www.ryanair.com/pl/pl' : 'https://www.wizzair.com/pl-pl';
  }
  const fromU = from.toUpperCase();
  const toU = to.toUpperCase();

  if (airline === 'ryanair') {
    // /trip/flights/select — strona wyników dla konkretnej daty (nie fare-finder z elastycznym weekendem,
    // który pre-selekcjonuje inne loty niż w naszych danych). Użytkownik widzi wszystkie loty na dany
    // dzień i wybiera ten z godziną podaną w tooltipie.
    const params = new URLSearchParams([
      ['adults', '1'], ['teens', '0'], ['children', '0'], ['infants', '0'],
      ['dateOut', date],
      ['isConnectedFlight', 'false'],
      ['isReturn', 'false'],
      ['discount', '0'],
      ['promoCode', ''],
      ['originIata', fromU],
      ['destinationIata', toU],
      ['tpAdults', '1'], ['tpTeens', '0'], ['tpChildren', '0'], ['tpInfants', '0'],
      ['tpStartDate', date],
      ['tpDiscount', '0'],
      ['tpPromoCode', ''],
      ['tpOriginIata', fromU],
      ['tpDestinationIata', toU],
    ]);

    return `https://www.ryanair.com/pl/pl/trip/flights/select?${params.toString()}`;
  }

  if (airline === 'wizzair') {
    if (retDate) {
      return `https://www.wizzair.com/pl-pl/loty/wyszukiwarka-lotow/${fromU.toLowerCase()}/${toU.toLowerCase()}/0/0/0/1/0/0/${date}/${retDate}?flexible=anytime&duration=weekend`;
    }
    return `https://www.wizzair.com/pl-pl/booking/select-flight/${fromU}/${toU}/${date}/null/1/0/0/null`;
  }

  return airline === 'ryanair' ? 'https://www.ryanair.com/pl/pl' : 'https://www.wizzair.com/pl-pl';
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
  const urlOut = S.roundtrip
    ? buildFlightUrl(f.airline, f.from, f.to, f.raw, f.retRaw)
    : buildFlightUrl(f.airline, f.from, f.to, f.raw);
  // Powrót: od lotniska docelowego z powrotem do startowego, na datę powrotu
  const urlRet = buildFlightUrl(f.airline, f.to, f.from, f.retRaw);

  // Etykiety przycisków z datą i godziną wylotu — żeby użytkownik wiedział
  // który lot wybrać po otwarciu strony linii
  const outDateFmt = formatDateShort(f.raw);    // np. "17.04.2026"
  const retDateFmt = formatDateShort(f.retRaw); // np. "19.04.2026"
  // Skrócony format na przycisku: "17.04 · 06:40"
  const outLabel = `${outDateFmt.slice(0,5)}${f.dept ? ' · ' + f.dept : ''}`;
  const retTime  = f.retDept || '?';
  const retLabel = `${retDateFmt.slice(0,5)}${f.retDept ? ' · ' + f.retDept : ''}`;

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
        <span class="leg-lbl-txt">↩ Powrót: ${retStr} &nbsp;·&nbsp;
          <span style="color:var(--color-accent)">${f.to}</span> →
          <span style="color:var(--color-accent)">${f.from}</span>
        </span>
        <span class="leg-price">${f.price2 - f.price1} PLN</span>
      </div>
      <div class="leg-row">
        <div class="t-block">
          <div class="t-val">${f.retDept || '—'}</div>
          <div class="t-city">${f.toCity}</div>
          <div style="font-size:.62rem;color:var(--text-muted)">${f.to}</div>
        </div>
        <div class="dur-center">
          ${f.dur ? `<div class="dur-txt">${f.dur}</div>` : ''}
          <div class="dur-line"></div>
        </div>
        <div class="t-block" style="text-align:right">
          <div class="t-val">${f.retArr || '—'}</div>
          <div class="t-city">${f.fromCity}</div>
          <div style="font-size:.62rem;color:var(--text-muted)">${f.from}</div>
        </div>
      </div>
    </div>` : '';

  // ── Przyciski zakupu ────────────────────────────────────────────────────────
  // Tooltip wyjaśnia, że po kliknięciu użytkownik trafi na stronę linii z
  // wynikami dla tej daty — powinien wybrać lot o godzinie widocznej na przycisku.
  const outTooltip = `Otworzy ${f.airline === 'ryanair' ? 'Ryanair' : 'Wizzair'} z wynikami dla ${f.from}→${f.to} dnia ${outDateFmt}.${f.dept ? ` Wybierz lot o godz. ${f.dept}.` : ''}`;
  const retTooltip = `Otworzy ${f.airline === 'ryanair' ? 'Ryanair' : 'Wizzair'} z wynikami dla ${f.to}→${f.from} dnia ${retDateFmt}.${f.retDept ? ` Wybierz lot o godz. ${f.retDept}.` : ''}`;

  const buyButtons = S.roundtrip ? `
    <div class="fc-buy-btns">
      <a href="${urlOut}"
         target="_blank" rel="noopener noreferrer"
         class="btn-book"
         title="${outTooltip}"
         aria-label="Kup bilet: ${f.fromCity} → ${f.toCity}, ${outDateFmt}${f.dept ? ` godz. ${f.dept}` : ''}">
        ✈ Tam &nbsp;${outLabel} ↗
      </a>
      <a href="${urlRet}"
         target="_blank" rel="noopener noreferrer"
         class="btn-book btn-book-ret"
         title="${retTooltip}"
         aria-label="Kup bilet powrotny: ${f.toCity} → ${f.fromCity}, ${retDateFmt}${f.retDept ? ` godz. ${f.retDept}` : ''}">
        ↩ Powrót &nbsp;${retLabel} ↗
      </a>
    </div>` : `
    <a href="${urlOut}"
       target="_blank" rel="noopener noreferrer"
       class="btn-book"
       title="${outTooltip}"
       aria-label="Kup bilet: ${f.fromCity} → ${f.toCity}, ${outDateFmt}${f.dept ? ` godz. ${f.dept}` : ''}">
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
      ${f.dur ? `<span class="fc-date-dur">${f.dur} lotu</span>` : ''}
    </div>

    <div class="fc-times">
      <div class="leg-lbl">
        <span class="leg-lbl-txt">✈ Wylot: ${cap(f.deptDay)} · ${f.from} → ${f.to} · ${f.toCity}</span>
        <span class="leg-price">${f.price1} PLN</span>
      </div>
      <div class="leg-row">
        <div class="t-block">
          <div class="t-val">${f.dept || '—'}</div>
          <div class="t-city">${f.fromCity}</div>
          <div style="font-size:.62rem;color:var(--text-muted)">${f.from}</div>
        </div>
        <div class="dur-center">
          <div class="dur-txt">${f.dur}</div>
          <div class="dur-line"></div>
          <div class="dur-txt" style="font-size:.67rem">bezpośredni</div>
        </div>
        <div class="t-block" style="text-align:right">
          <div class="t-val">${f.arr || '—'}</div>
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
    ${(!S.allDates && _altCounts[f.id] > 0) ? `
    <button class="alt-dates-btn" onclick="showAltDates('${f.from}','${f.to}')"
            aria-label="Pokaż ${_altCounts[f.id]} inne terminy na trasie ${f.from}→${f.to}">
      📅 +${_altCounts[f.id]} ${_altCounts[f.id] === 1 ? 'inny termin' : (_altCounts[f.id] < 5 ? 'inne terminy' : 'innych terminów')} w tym budżecie
    </button>` : ''}
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
   SEKCJA 13: MAPA — Leaflet (OpenStreetMap + CartoDB tiles)
================================================================ */

/** Generate a smooth arc between two lat/lng points */
function arcPoints(lat1, lng1, lat2, lng2, steps) {
  steps = steps || 60;
  var dlat = lat2 - lat1, dlng = lng2 - lng1;
  var len  = Math.hypot(dlat, dlng);
  var px = -dlng / len, py = dlat / len;
  var h  = len * 0.20;
  var pts = [];
  for (var i = 0; i <= steps; i++) {
    var t   = i / steps;
    var arc = h * Math.sin(Math.PI * t);
    pts.push([lat1 + dlat * t + px * arc, lng1 + dlng * t + py * arc]);
  }
  return pts;
}

function makeTileLayer(isDark) {
  var url = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png';
  return L.tileLayer(url, {
    attribution: '\u00a9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> \u00a9 <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  });
}

function makeLabelsLayer(isDark) {
  var url = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png';
  return L.tileLayer(url, { subdomains: 'abcd', maxZoom: 19, pane: 'labelsPane' });
}

function priceColor(p) {
  if (p < 100) return '#10b981';
  if (p < 150) return '#84cc16';
  if (p < 200) return '#f59e0b';
  if (p < 300) return '#f97316';
  return '#ef4444';
}

async function _loadGeoData() {
  if (_geoData) return _geoData;
  if (typeof topojson === 'undefined') return null;
  try {
    const r    = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
    const topo = await r.json();
    const geo  = topojson.feature(topo, topo.objects.countries);
    const valid = new Set(Object.values(COUNTRY_ISO));
    geo.features = geo.features.filter(f => valid.has(+f.id));
    _geoData = geo;
    return geo;
  } catch(e) {
    console.warn('[Map] GeoJSON load failed:', e);
    return null;
  }
}

function drawChoropleth() {
  if (!LMap || !_geoData) return;
  if (LGeoLayer) { LMap.removeLayer(LGeoLayer); LGeoLayer = null; }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const border = isDark ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.7)';

  LGeoLayer = L.geoJSON(_geoData, {
    style(feature) {
      const name = ISO_COUNTRY[+feature.id];
      const d    = name ? CHEAPEST_BY_COUNTRY[name] : null;
      return d
        ? { fillColor: priceColor(d.price1), fillOpacity: 0.50, color: border, weight: 0.8 }
        : { fillColor: isDark ? '#1a1a2e' : '#d8dce8', fillOpacity: 0.30,
            color: isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.07)', weight: 0.5 };
    },
    onEachFeature(feature, layer) {
      const name = ISO_COUNTRY[+feature.id];
      const d    = name ? CHEAPEST_BY_COUNTRY[name] : null;
      if (!d) return;
      const flag = AIRPORTS.find(a => a.country === name && !a.isPL)?.flag || '';
      layer.bindTooltip(
        '<div class="ltt-name">' + flag + ' ' + name + '</div>' +
        '<div class="ltt-price">od ' + d.price1 + ' PLN / os.</div>' +
        '<div class="ltt-sub">' + d.from + ' \u2192 ' + d.to + '</div>',
        { direction: 'top', className: 'ltt', sticky: true }
      );
      layer.on('mouseover', function() { this.setStyle({ fillOpacity: 0.72, weight: 1.4 }); });
      layer.on('mouseout',  function() { LGeoLayer.resetStyle(this); });
      layer.on('click', function() {
        var ap = AIRPORTS.find(function(a) { return a.code === d.to; });
        if (ap) goToMap(ap.code, ap.name);
      });
    },
  });

  LGeoLayer.addTo(LMap);
  LGeoLayer.bringToBack();
}

function addChoroplethLegend() {
  var ctl = L.control({ position: 'bottomright' });
  ctl.onAdd = function() {
    var div = L.DomUtil.create('div', 'choropleth-legend');
    div.innerHTML =
      '<div class="cl-title">najtańszy lot \u2022 1 os. \u2022 1 strona</div>' +
      [['#10b981','&lt; 100 PLN'], ['#84cc16','100\u2013150 PLN'], ['#f59e0b','150\u2013200 PLN'],
       ['#f97316','200\u2013300 PLN'], ['#ef4444','&gt; 300 PLN']]
        .map(function(x) { return '<div class="cl-row"><span style="background:' + x[0] + '"></span>' + x[1] + '</div>'; })
        .join('');
    return div;
  };
  ctl.addTo(LMap);
}

function initMap() {
  if (LMap) return;
  if (typeof L === 'undefined') { console.warn('[Map] Leaflet not loaded — map disabled'); return; }
  var isDark = document.documentElement.getAttribute('data-theme') !== 'light';

  LMap = L.map('worldMap', {
    center: [50.5, 18],
    zoom: 4,
    minZoom: 2,
    maxZoom: 12,
    zoomControl: true,
    attributionControl: true,
  });

  LMap.createPane('labelsPane');
  LMap.getPane('labelsPane').style.zIndex = 450;
  LMap.getPane('labelsPane').style.pointerEvents = 'none';

  LTileLayer = makeTileLayer(isDark);
  LTileLayer.addTo(LMap);

  _loadGeoData().then(function(geo) { if (geo) drawChoropleth(); });

  drawDots();
  drawRoutes();
  addChoroplethLegend();

  LLabelsLayer = makeLabelsLayer(isDark);
  LLabelsLayer.addTo(LMap);

  setTimeout(function() { if (LMap) LMap.invalidateSize(); }, 300);
}

function drawRoutes(origins) {
  if (!LMap) return;
  origins = origins || ['KTW', 'KRK'];
  LRoutes.forEach(function(l) { LMap.removeLayer(l); });
  LRoutes = [];

  var ors  = AIRPORTS.filter(function(a) { return origins.includes(a.code); });
  var seen = new Set();

  FLIGHTS.forEach(function(f) {
    var key = f.from + '\u2192' + f.to;
    if (seen.has(key)) return;
    var o = ors.find(function(x) { return x.code === f.from; });
    var d = AIRPORTS.find(function(a) { return a.code === f.to; });
    if (!o || !d) return;
    seen.add(key);

    // Najta\u0144szy lot na tej trasie (mo\u017ce by\u0107 kilka linii/dat)
    var best = FLIGHTS
      .filter(function(fl) { return fl.from === f.from && fl.to === f.to; })
      .sort(function(a, b) { return (a.price2 || 9999) - (b.price2 || 9999); })[0] || f;

    var pts      = arcPoints(o.lat, o.lng, d.lat, d.lng);
    var color    = best.airline === 'ryanair' ? '#5e9eff' : '#c066f0';
    var airline  = best.airline === 'ryanair' ? 'Ryanair' : 'Wizzair';
    var destName = d.name.replace(/\s*\(.*\)/, '');

    // Widoczna linia (non-interactive \u2014 zdarzenia obs\u0142uguje hitbox)
    var vis = L.polyline(pts, { color: color, weight: 2, opacity: 0.40, smoothFactor: 1, interactive: false });
    vis._toCode = f.to; vis._fromCode = f.from; vis._isVis = true;
    vis.addTo(LMap);
    LRoutes.push(vis);

    // Niewidoczny szeroki hitbox \u2014 \u0142atwy cel klikni\u0119cia
    var hit = L.polyline(pts, { color: color, weight: 14, opacity: 0, smoothFactor: 1 });
    hit._toCode = f.to; hit._fromCode = f.from; hit._isHit = true;

    var tt =
      '<div class="ltt-name">' + (d.flag || '') + ' ' + destName + '</div>' +
      '<div class="ltt-price">od ' + best.price2 + ' PLN w obie strony</div>' +
      '<div class="ltt-sub">' + f.from + ' \u2192 ' + f.to + ' \u00b7 ' + airline + '</div>' +
      '<div class="ltt-hint">Kliknij aby wyszuka\u0107 \u2193</div>';
    hit.bindTooltip(tt, { direction: 'top', className: 'ltt', sticky: true, offset: [0, -6] });

    (function(vis, fromCode, toCode, toName) {
      hit.on('mouseover', function() {
        vis.setStyle({ opacity: 0.92, weight: 3.5 });
        vis.bringToFront();
      });
      hit.on('mouseout', function() {
        vis.setStyle({ opacity: 0.40, weight: 2 });
      });
      hit.on('click', function() {
        S.origins = []; renderChips();
        var ap = AIRPORTS.find(function(a) { return a.code === fromCode; });
        addOrigin(fromCode, ap ? ap.name : fromCode);
        pickDestAC(toCode, toName);
        S.sort = 'price';
        if (!S.roundtrip) {
          var sw = document.getElementById('swRound');
          if (sw) { sw.classList.add('on'); sw.setAttribute('aria-checked', 'true'); }
          S.roundtrip = true;
        }
        renderResults();
        document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
      });
    })(vis, f.from, f.to, d.name);

    hit.addTo(LMap);
    LRoutes.push(hit);
  });
}

function drawDots() {
  if (!LMap) return;
  LMarkers.forEach(function(m) { LMap.removeLayer(m); });
  LMarkers = [];

  AIRPORTS.forEach(function(a) {
    var cheapest = FLIGHTS
      .filter(function(f) { return f.to === a.code; })
      .sort(function(x, y) { return x.price1 - y.price1; })[0];

    if (a.isPL) {
      var icon = L.divIcon({
        className: '',
        html: '<div class="dep-marker"><div class="dep-pulse"></div><div class="dep-dot"></div><div class="dep-lbl">' + a.code + '</div></div>',
        iconSize:   [52, 52],
        iconAnchor: [14, 14],
      });
      var m = L.marker([a.lat, a.lng], { icon: icon, zIndexOffset: 1000 });
      m.bindTooltip(
        '<div class="ltt-name">' + a.flag + ' ' + a.name + '</div><div class="ltt-sub">\u2708 Lotnisko startowe</div>',
        { direction: 'top', className: 'ltt', offset: [0, -10] }
      );
      m.addTo(LMap);
      LMarkers.push(m);

    } else if (cheapest) {
      var isCheap = TOP3.has(a.country);
      var color = isCheap ? '#f58c3d' : (cheapest.airline === 'ryanair' ? '#5e9eff' : '#c066f0');

      var circle = L.circleMarker([a.lat, a.lng], {
        radius: isCheap ? 8 : 6,
        fillColor: color,
        color: '#ffffff',
        weight: 1.5,
        opacity: 0.9,
        fillOpacity: 0.85,
      });

      var airlineLbl = cheapest.airline === 'ryanair' ? 'Ryanair' : 'Wizzair';
      var ttHtml = '<div class="ltt-name">' + a.flag + ' ' + a.name + '</div>' +
        '<div class="ltt-price">od ' + cheapest.price1 + ' PLN</div>' +
        '<div class="ltt-sub">' + cheapest.from + ' \u2192 ' + a.code + ' \u00b7 ' + airlineLbl + '</div>';
      circle.bindTooltip(ttHtml, { direction: 'top', className: 'ltt', offset: [0, -4], sticky: false });

      (function(code, name) {
        circle.on('mouseover', function() { hlRoutes(code); });
        circle.on('mouseout',  function() { clRoutes(); });
        circle.on('click',     function() { goToMap(code, name); });
      })(a.code, a.name);

      circle.addTo(LMap);
      LMarkers.push(circle);
    }
  });
}

function hlRoutes(toCode) {
  LRoutes.forEach(function(l) {
    if (l._isHit) return;
    var match = l._toCode === toCode;
    l.setStyle({ opacity: match ? 0.92 : 0.05, weight: match ? 3.5 : 2 });
    if (match) l.bringToFront();
  });
}

function clRoutes() {
  LRoutes.forEach(function(l) {
    if (l._isHit) return;
    l.setStyle({ opacity: 0.40, weight: 2 });
  });
}

function updateMapRoutes() {
  var codes = S.origins.map(function(o) { return o.code; });
  if (S.favAp && !codes.includes(S.favAp.code)) codes.push(S.favAp.code);
  drawRoutes(codes.length ? codes : ['KTW', 'KRK']);
}

function goToMap(code, name) {
  document.getElementById('destIn').value = name + ' (' + code + ')';
  S.destFilter = code.toLowerCase();
  showDestBadge(name);
  document.getElementById('search').scrollIntoView({ behavior: 'smooth' });
}

function flyMapTo(toCode) {
  if (!LMap) return;
  var ap = AIRPORTS.find(function(a) { return a.code === toCode; });
  if (ap) LMap.flyTo([ap.lat, ap.lng], 6, { duration: 1.2 });
}

function updateMapTheme(isDark) {
  if (!LMap || !LTileLayer) return;
  LMap.removeLayer(LTileLayer);
  LTileLayer = makeTileLayer(isDark);
  LTileLayer.addTo(LMap);
  if (LLabelsLayer) { LMap.removeLayer(LLabelsLayer); }
  LLabelsLayer = makeLabelsLayer(isDark);
  LLabelsLayer.addTo(LMap);
  drawChoropleth();
}


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
  const carrierUrl = buildFlightUrl(f.airline, f.from, f.to, f.raw, f.retRaw);
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
function toggleTheme(){const h=document.documentElement,d=h.getAttribute('data-theme')==='dark';h.setAttribute('data-theme',d?'light':'dark');document.getElementById('themeBtn').textContent=d?'☀️':'🌙';localStorage.setItem('lnw_th',d?'light':'dark');updateMapTheme(!d);}

/* ================================================================
   SEKCJA 18: TOAST
================================================================ */
function toast(type,icon,title,msg){
  const c=document.getElementById('toastWrap'),t=document.createElement('div');
  t.className=`toast ${type||'info'}`;t.setAttribute('role','alert');
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
