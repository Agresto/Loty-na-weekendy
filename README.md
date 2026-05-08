# Loty-na-weekendy

Polska aplikacja do wyszukiwania tanich lotów weekendowych z Ryanair i Wizzair.

## 🚀 Quick Start

```bash
npm install
node refresh-flights.js  # Pobiera loty z API
npm run serve            # Uruchamia na http://localhost:8080
```

## 📡 API

### Zmiana z Kiwi na Aviasales (mai 2026)

Ze względu na niedostępność Kiwi API, projekt został przeswitchowany na **Aviasales**:
- ✅ **Całkowicie darmowe** — brak wymaganych rejestracji
- ✅ **Brak limitów** — publiczny dostęp
- ✅ **Pełna obsługa** — Wizzair, Ryanair i inne

👉 **Detale**: [AVIASALES-API-SETUP.md](./AVIASALES-API-SETUP.md)

## 📦 Pliki

- `app.js` — Frontend (Firebase Auth + Firestore)
- `refresh-flights.js` — Pobiera loty z Ryanair + Aviasales
- `generate-flights.js` — Generator statyczny + Playwright scraper (fallback)
- `flights.json` — Cache lotów (auto-update)
- `firebase-config.js` — Konfiguracja Firebase

## 🛠 Zmienne środowiskowe (opcjonalnie)

```bash
# Brak wymaganych! Ryanair + Aviasales pracują bez kluczy
# Jeśli chcesz użyć Firebase:
FIREBASE_API_KEY=xxx
FIREBASE_AUTH_DOMAIN=xxx
```

## 📝 Licencja

MIT (@Agresto)