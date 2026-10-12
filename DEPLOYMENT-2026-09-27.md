# Wdrożenie NAS — 27.09.2026

## Wynik

Po zatwierdzeniu użytkownika wdrożono na https://nas.serwerbb.win trwałe wznawianie uploadów (4), ustawienia/sesje (5), udostępnianie (6), podglądy (7), alerty (8) i animacje interfejsu. Nie zmieniano DNS, routera, haseł ani uprawnień użytkowników.

## Bezpieczeństwo danych

- Świeża, spójna kopia DB i storage: `backups/20260927T071849Z/`. Wyklucza niekompletne tymczasowe uploady. Sprawdzono sumy kontrolne i próbne odtworzenie w osobnej bazie/katalogu wraz z migracjami.
- Przed zmianą: 2 konta, 2 wpisy plikowe (folder i plik), 23 954 bajty danych, brak aktywnych zapisów, 5 migracji.
- Po zmianie: te same liczby kont/wpisów/bajtów; 7 poprawnie zakończonych migracji. Niezależny odczyt rozmiaru fizycznego pliku potwierdził zgodność z metadanymi.
- Migracje `202609260003_sharing_operations` i `202609270001_durable_uploads` dodają tabele/kolumny; nie usuwają plików ani istniejących danych.
- Zachowano stare runtime’y jako `voidnas-api:rollback-20260927T071849Z` oraz `voidnas-web:rollback-20260927T071849Z` i lokalne archiwa `api-runtime.tar`, `web-runtime.tar` obok kopii danych. Oryginalnych obrazów nie można było oznaczyć tagiem, ponieważ Docker nie zachował ich warstw. Eksport nie obejmuje zamontowanego storage; import nie zachowuje sekretów środowiska. Runtime Node starego API sprawdzono w kontenerze bez sieci/danych.
- Backup zawiera prywatne dane. Pozostaje lokalny; należy przechowywać jego dodatkową zabezpieczoną kopię poza tym komputerem. Archiwa runtime są niezależne od manifestu `SHA256SUMS` kopii DB/storage.

## Kontenery i brama

Nowe API i frontend uruchomiono z kompletem `docker-compose.yml`, `docker-compose.local.yml`, `docker-compose.public.yml`. PostgreSQL nie był wymieniany. API jest healthy, działa jako `voidnas`, z root filesystem tylko do odczytu, bez privileged i bez portu hosta. Baza jest healthy, nie jest publicznie wystawiona. Utrzymano Secure cookies dla HTTPS.

Publiczną bramę przeładowano łagodnie sygnałem SIGUSR1, co potwierdziły logi. Pozostałe strony strona.serwerbb.win i portfolio.serwerbb.win po przeładowaniu zwróciły HTTP 200. Nagłówki CSP zezwalają na lokalne workery/media, nie na zewnętrzne usługi. Mechanizm sygnału jest opisany w [dokumentacji Caddy](https://caddyserver.com/docs/command-line#signals).

## Animacje

Subtelne wejście stron i paneli, reakcje przycisków/nawigacji oraz odsłanianie widocznych sekcji podczas przewijania. Animujemy wyłącznie opacity/transform, raz na element; nie każdy wiersz pliku. Nie ma globalnych glowów ani nowych ciężkich cieni. `prefers-reduced-motion` wyłącza efekty i natychmiast anuluje trwający ruch. Brak wsparcia API nie ukrywa treści. Obserwatory są sprzątane przy odmontowaniu.

## Sprawdzenie

- Frontend: TypeScript i Docker build poprawne, 42/42 testy (5 nowych testów animacji). Backend bez nowych zmian: wcześniej sprawdzone 39/39 testów Linux/Docker; pełna regresja PostgreSQL/filesystem 68/68 oraz rzeczywisty restart i wznowienie 20 MiB w izolacji.
- Po wdrożeniu: `/` HTTP 200; `/api/health` 200 i status ok; `/api/setup/status` 200 i required false; `/api/files`, `/api/admin/system` bez sesji 401.
- HTTPS zweryfikowano bez pomijania kontroli certyfikatu, zarówno przez loopback/SNI, jak i zwykły publiczny DNS z tego komputera. To nie jest niezależny test dostępu z innej sieci.
- Przeglądarka pobrała nowe pliki `index-71Rp6vDT.js` i `index-CRSaMVVq.css`, pokazała prawidłowy ekran logowania i nie zgłosiła błędów ani ostrzeżeń konsoli. Brak poziomego overflow przy desktopie 1280 px i telefonie 390 px. Nie logowano się za użytkownika ani nie zmieniano jego plików na potrzeby testów.

## Obsługa i powrót

Odśwież otwartą chmurę przez Ctrl+F5, następnie zaloguj się dotychczasowym kontem. Instrukcje trwałego wznawiania wraz z koniecznością ponownego wskazania oryginalnego pliku po zamknięciu przeglądarki są w FEATURE-4-DURABLE-UPLOADS.md. Backupy nie otrzymały automatycznego harmonogramu; retencji ani publicznych linków nie włączano automatycznie.

W razie problemu najpierw zatrzymaj nowe zapisy i zachowaj aktualną parę DB/storage. Powrót do starych runtime’ów wymaga jawnego wskazania powyższych tagów obrazów z zachowaniem obecnych produkcyjnych ustawień/montaży; nie usuwa się migracji ani nullable kolumn. Nie uruchamiaj `compose down -v`, `prisma migrate reset` ani odtwarzania samej bazy bez odpowiadającego storage. Starsza wersja nie udostępni nowych funkcji, lecz dodatkowe nullable kolumny nie wymagają destrukcyjnego cofnięcia schematu. Odtworzenie pary backupu jest osobną, kontrolowaną operacją — instrukcje w README.
