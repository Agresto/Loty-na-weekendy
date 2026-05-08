# Konfiguracja Aviasales API (Bezpłatny Plan)

## Zmiana z Kiwi API na Aviasales API

Ze względu na niedostępność Kiwi API, projekt "Loty-na-weekendy" został przeswitchowany na **Aviasales API**, które jest:
- ✅ **Całkowicie darmowe**
- ✅ **Bez wymaganych rejestracji i API key**
- ✅ **Publiczny dostęp bez ograniczeń handlowych**
- ✅ **Dobra obsługa lotów europejskich** (w tym Wizzair)

## Co to jest Aviasales?

Aviasales to popularny międzynarodowy agregator lotów, który pobiera ceny z wielu linii lotniczych, w tym:
- Wizzair
- Ryanair
- LOT Polish Airlines
- i wiele innych

## Jak działa integracja?

### Automatyczne pobieranie

Skrypt `refresh-flights.js` automatycznie:
1. Wysyła zapytania do publicznego API Aviasales
2. Parsuje wyniki dla tras weekendowych
3. Filtruje loty poniżej budżetu (domyślnie 500 PLN w obie strony)
4. Zapisuje do `flights.json`

### Co potrzebujesz?

**NIC!** — Aviasales API nie wymaga rejestracji ani API key. Po prostu uruchom:

```bash
npm install
node refresh-flights.js
```

## Limity

- **Brak limitów per IP** dla tego publicznego endpointu
- Rekomendowany delay między requestami: ~1 sekunda (aby nie obciążać serwera)
- Automatycznie ustawiany w konfiguracji

## Fallback na Wizzair Direct API

Jeśli Aviasales API będzie niedostępny, aplikacja automatycznie przełączy się na:
1. Generator statyczny lotów weekendowych (`generate-flights.js`)
2. Opcjonalnie: bezpośrednie web scraping Wizzair via Playwright (dostępne w `generate-flights.js`)

## Problemy?

Jeśli napotkasz problemy:

### 1. API zwraca 0 lotów
```bash
# Sprawdź dostępność Aviasales:
curl -s "https://api.aviasales.com/v2/prices/latest?origin=WAW&destination=KRK&departureDate=2026-05-23&returnDate=2026-05-25" | head -20
```

### 2. Timeout
- Zwiększ `TIMEOUT_MS` w `refresh-flights.js` (domyślnie 20000ms)
- Lub zwiększ delay `WZ_DELAY` między requestami

### 3. Aplikacja powinna pracować w trybie fallback
- Jeśli Aviasales zawiedzie, aplikacja automatycznie przełączy się na generator statyczny
- Aplikacja będzie wtedy wyświetlać "ryanair-api+wizzair-static" w `flights.json`

## Przyszłość

W przyszłości można rozważyć:
- Dodanie obsługi Other Airlines APIs (Skyscanner, Kayak)
- Rozszerzenie timeout observability
- Caching wyników na poziomie CDN
- Migracja do innego agregator (np. Skyscanner) jeśli Aviasales zmieni politykę dostępu

---

**Status**: ✅ Aktywnie używane od maja 2026
**Ostatnia aktualizacja**: 2026-05-06
