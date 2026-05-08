# ⚠️ UWAGA: Kiwi API nie jest już używane!

**Status**: Zdeprecjonowane (maj 2026)

Ze względu na niedostępność Kiwi Tequila API, projekt został przeswitchowany na **Aviasales API**, które jest całkowicie darmowe i nie wymaga rejestracji.

👉 **Przejdź do**: [AVIASALES-API-SETUP.md](./AVIASALES-API-SETUP.md)

Poniższa dokumentacja jest zachowana dla celów historycznych.

---

# Konfiguracja Kiwi Tequila API (Bezpłatny Plan) - ARCHIWUM

Ten przewodnik wyjaśnia krok po kroku, jak skonfigurować bezpłatny klucz API z Kiwi Tequila API, aby aplikacja "Loty-na-weekendy" mogła pobierać rzeczywiste ceny lotów Wizzair.

## Co to jest Kiwi Tequila API?

Kiwi (dawniej Skypicker) to agregator lotów, który pobiera ceny bezpośrednio z linii lotniczych, w tym Wizzair. Ich API pozwala na bezpłatne pobieranie cen lotów (limit 1000 requestów dziennie).

## Krok 1: Zarejestruj się na Kiwi Tequila API

1. Otwórz przeglądarkę internetową (np. Chrome, Firefox).
2. Przejdź na stronę: [https://tequila.kiwi.com/portal/login](https://tequila.kiwi.com/portal/login)
3. Kliknij przycisk **"Sign Up"** (jeśli nie masz konta).
4. Wypełnij formularz rejestracyjny:
   - **Email**: Wpisz swój adres email (np. mojemail@example.com).
   - **Password**: Wybierz bezpieczne hasło (minimum 8 znaków).
   - **Confirm Password**: Powtórz hasło.
   - **First Name**: Twoje imię.
   - **Last Name**: Twoje nazwisko.
   - **Company**: Możesz wpisać "Personal" lub nazwę swojej aplikacji.
   - **Website**: Możesz wpisać "https://github.com/Agresto/Loty-na-weekendy" lub zostawić puste.
5. Zaznacz zgodę na warunki (Terms of Service).
6. Kliknij **"Sign Up"**.
7. Sprawdź swoją skrzynkę email — Kiwi wyśle link aktywacyjny. Kliknij w niego, aby aktywować konto.

## Krok 2: Zaloguj się i utwórz projekt

1. Po aktywacji konta, wróć na [https://tequila.kiwi.com/portal/login](https://tequila.kiwi.com/portal/login) i zaloguj się używając email i hasła.
2. Po zalogowaniu, kliknij **"Create Project"** lub **"New Project"**.
3. Wypełnij szczegóły projektu:
   - **Project Name**: Np. "Loty-na-weekendy".
   - **Description**: Np. "Aplikacja do wyszukiwania tanich lotów weekendowych".
   - **Website**: "https://github.com/Agresto/Loty-na-weekendy".
   - **Platform**: Wybierz "Web" lub "Other".
4. Kliknij **"Create"**.

## Krok 3: Uzyskaj bezpłatny API Key

1. W panelu projektu, znajdź sekcję **"API Keys"** lub **"Keys"**.
2. Kliknij **"Generate API Key"** lub podobny przycisk.
3. Wybierz plan **"Free"** (powinien być domyślny).
4. Skopiuj wygenerowany **API Key** (to długi ciąg znaków, np. `abcdefgh123456789`).
   - **Uwaga**: Trzymaj klucz w bezpiecznym miejscu — nie udostępniaj go nikomu!

## Krok 4: Skonfiguruj API Key w aplikacji

### Opcja 1: Ustawienie zmiennej środowiskowej (Zalecane)

1. Otwórz terminal lub wiersz poleceń na swoim komputerze.
2. Przejdź do folderu z projektem: `cd /path/to/Loty-na-weekendy` (zamień `/path/to/` na rzeczywistą ścieżkę).
3. Uruchom polecenie: `export KIWI_API_KEY=twój_api_key_tutaj`
   - Przykład: `export KIWI_API_KEY=abcdefgh123456789`
   - **Uwaga**: Zastąp `abcdefgh123456789` swoim rzeczywistym kluczem.
4. Teraz uruchom odświeżanie cen: `node refresh-flights.js`
5. Jeśli wszystko działa, ceny Wizzair powinny być pobrane.

### Opcja 2: Bezpośrednie ustawienie w kodzie (Tylko do testów)

1. Otwórz plik `refresh-flights.js` w edytorze tekstu (np. VS Code).
2. Znajdź linię: `const apiKey = process.env.KIWI_API_KEY || 'YOUR_FREE_API_KEY';`
3. Zastąp `'YOUR_FREE_API_KEY'` swoim kluczem, np.: `const apiKey = process.env.KIWI_API_KEY || 'abcdefgh123456789';`
4. Zapisz plik.
5. Uruchom: `node refresh-flights.js`

**Uwaga**: Nie commituj klucza do repozytorium! Używaj zmiennej środowiskowej.

## Krok 5: Sprawdź, czy działa

1. Po uruchomieniu `node refresh-flights.js`, sprawdź wyjście w terminalu.
2. Powinno pojawić się: `[refresh] Pobieranie 46 tras Wizzair przez Kiwi API...`
3. Jeśli zobaczysz błędy jak "HTTP 401" lub "Invalid API key", sprawdź klucz.
4. Jeśli wszystko OK, plik `flights.json` zostanie zaktualizowany z rzeczywistymi cenami.

## Problemy i rozwiązania

- **Błąd "API key not found"**: Sprawdź, czy klucz jest poprawnie skopiowany i ustawiony.
- **Błąd "Rate limit exceeded"**: Czekaj 24 godziny lub przejdź na płatny plan.
- **Błąd "No flights found"**: Sprawdź daty — API może nie mieć lotów na wybrane terminy.
- **Inne błędy**: Sprawdź połączenie internetowe i spróbuj ponownie.

## Limity bezpłatnego planu

- 1000 requestów dziennie.
- 46 tras Wizzair = ~46 requestów na odświeżenie.
- Odświeżanie raz dziennie = bezpieczne zużycie.

Jeśli potrzebujesz pomocy, otwórz issue na GitHub: [https://github.com/Agresto/Loty-na-weekendy/issues](https://github.com/Agresto/Loty-na-weekendy/issues)