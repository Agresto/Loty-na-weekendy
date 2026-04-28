/* ================================================================
   firebase-config.js
   ⚙️  WYPEŁNIJ SWOIMI DANYMI (patrz README-firebase-emailjs.md)
   Ten plik NIE powinien być w publicznym repozytorium z prawdziwymi
   kluczami — dodaj go do .gitignore lub użyj zmiennych środowiskowych.
================================================================ */

/* ------------------------------------------------------------------
   1. FIREBASE CONFIGURATION
   Znajdziesz te dane w: Firebase Console → Twój projekt →
   ⚙️ Ustawienia projektu → Twoje aplikacje → Konfiguracja SDK
------------------------------------------------------------------ */
// ⚠️ Nazwa zmiennej MUSI być FIREBASE_CONFIG (wielkie litery) — app.js czyta window.FIREBASE_CONFIG
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBvhUC3JgKuua6iWzh4a6WsX2C0u33KKBQ",
  authDomain: "loty-na-weekend.firebaseapp.com",
  projectId: "loty-na-weekend",
  storageBucket: "loty-na-weekend.firebasestorage.app",
  messagingSenderId: "807241285744",
  appId: "1:807241285744:web:39f7f24a186481a995f4b5"
};

/* ------------------------------------------------------------------
   2. EMAILJS CONFIGURATION
   Znajdziesz te dane w: EmailJS Dashboard →
   - Service ID: Email Services → Twój serwis
   - Template IDs: Email Templates → każdy szablon ma własne ID
   - Public Key: Account → API Keys → Public Key
------------------------------------------------------------------ */
const EMAILJS_CONFIG = {
  publicKey:              "_XZjX6B_EUX_KsMjW",    // np. "abc123XYZ..."
  serviceId:              "service_ilovepieski",             // np. "service_lotynaweekend"
  templateSubscribe:      "template_subscribe",              // Szablon: potwierdzenie zapisu na newsletter
  templatePriceAlert:     "template_price_alert",            // Szablon: alert o nowym tanim locie
  templateWelcome:        "template_welcome",                // Szablon: powitalny po rejestracji
};

/* ------------------------------------------------------------------
   3. APP SETTINGS (opcjonalne, możesz zostawić domyślne)
------------------------------------------------------------------ */
const APP_SETTINGS = {
  appName:        "Loty na Weekend",
  appUrl:         "https://twoj-login.github.io/loty-na-weekend",
  fromEmail:      "twoj@email.pl",      // Twój adres w EmailJS
  defaultOrigin:  "KTW",               // Domyślne lotnisko startowe
  currency:       "PLN",
  // Jak często sprawdzać nowe loty (ms) — symulacja w frontend
  syncIntervalMs: 60 * 60 * 1000,      // Co godzinę (tylko gdy karta otwarta)
};

/* EKSPORT — nie zmieniaj tej linii */
window.FIREBASE_CONFIG  = FIREBASE_CONFIG;
window.EMAILJS_CONFIG   = EMAILJS_CONFIG;
window.APP_SETTINGS     = APP_SETTINGS;
