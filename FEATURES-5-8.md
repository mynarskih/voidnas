# Funkcje 5–8 — 26 września 2026

## Stan

27.09.2026, po osobnym potwierdzeniu „Wdrażaj”, funkcje wdrożono na https://nas.serwerbb.win wraz z trwałym wznawianiem uploadów i subtelnymi animacjami. Migracje i przeładowanie CSP zakończyły się poprawnie. Świeży backup sprawdzono przez odtworzenie w izolacji. Szczegóły: [raport wdrożenia](DEPLOYMENT-2026-09-27.md).

## Co dodano

5. Ustawienia serwera: retencja kosza 7/30/90 dni lub nigdy, limity prędkości i równoczesnych transferów. Lista sesji w Profilu i Administracji pozwala wylogować konkretne urządzenie. Retencja domyślnie wyłączona; jej włączenie wymaga potwierdzenia trwałego usuwania również istniejących elementów kosza.

6. Udostępnianie READ/READ_WRITE z rzeczywistą kontrolą backendu. Zapis w folderze współdzielonym obciąża quota właściciela. Odbiorca nie może wyjść poza zakres folderu, ponownie go udostępnić ani trwale usunąć danych. Opcjonalne publiczne linki tylko do odczytu: hasło, termin ważności, regeneracja sekretu i natychmiastowe cofnięcie kolejnych żądań. Nie da się odwołać już pobranych bajtów.

7. Lokalny podgląd obrazów, PDF, audio, wideo i tekstu oraz miniatury WebP. PDF renderuje lokalny [PDF.js](https://mozilla.github.io/pdf.js/examples/) bez warstwy wykonywania skryptów/akcji. HTML i SVG wyświetlane są jako tekst, nie aktywne strony. Obsługa audio/wideo zależy od kodeków przeglądarki; nieobsługiwany plik można pobrać. Ograniczenia: tekst 1 MiB, PDF 64 MiB; miniatury z obrazów do 32 MiB i 16 mln pikseli, maksymalnie dwa dekodery i szesnaście oczekujących, ograniczony cache. Nie wprowadzono zewnętrznego podglądu ani CDN.

8. Dzwonek i panel Alerty dla ADMIN: brak miejsca/dostępności storage, niedostępność monitora, nieudane/brak zarejestrowanych/przeterminowane backupy i seria nieudanych logowań. Historia i potwierdzanie komunikatów. Awaria bazy uniemożliwia odczyt sesji/API; interfejs zgłasza błąd połączenia, a działający worker zapisuje zaobserwowaną awarię po odzyskaniu bazy. Ta obserwacja w pamięci nie przetrwa restartu backendu. Bez powiadomień zewnętrznych.

## Weryfikacja

- TypeScript/Vite oraz budowy Docker API, migracji i frontendu: poprawne.
- Backend w Linux/Docker: 36 testów; frontend: 22 testy/kontrakty.
- Izolowana integracja: 62/62 scenariusze, w tym równoległe quota, przerwany upload, CSRF/IDOR, zakres READ_WRITE, blokada właściciela, rotacja/cofnięcie linku, zabezpieczenia hasła, rozpoznanie zawartości, retencja, limity strumieni i alerty z faktycznego wyniku backupu.
- Sprawdzono UI desktop i telefon 390×844: PDF rzeczywiście wyrenderował stronę, audio załadowało metadane, HTML pozostał widocznym tekstem, obraz miał lokalną miniaturę. Sprawdzono ustawienia, sesje, alerty i folder READ_WRITE zwykłego użytkownika. Poprawiono poziome przewijanie formularza i powrót fokusu po opcjach plików.
- Katalog podatności zależności produkcyjnych: brak znanych zgłoszeń w używanym zestawie na czas sprawdzenia. Nie jest to gwarancja braku innych luk.
- Jednorazowe środowisko podglądu, baza testowa i sztuczne pliki zostały po weryfikacji usunięte. Wymienione wyżej wyniki dotyczą pierwotnej weryfikacji 26.09. Po dodaniu trwałych uploadów i animacji zestaw obejmuje 39 testów backendu, 42 frontendu i 68 scenariuszy integracyjnych. Produkcyjne API i PostgreSQL zgłaszają healthy; frontend został zaktualizowany 27.09.
- Backup przed aktualizacją: `backups/20260926T201159Z/` (dump PostgreSQL, storage i SHA256SUMS). Odtworzenie do oddzielnej bazy/katalogu wraz z nową migracją: poprawne; metadane dwóch kont i jednego fizycznego pliku zweryfikowane. Oryginalnych danych nie odtwarzano ani nie usuwano.

## Gdzie znaleźć funkcje po wdrożeniu

- Profil → Twoje urządzenia.
- Administracja → Ustawienia / Bezpieczeństwo / Alerty.
- Opcje pliku → Udostępnij → Użytkownikowi albo Link publiczny.
- Opcje pliku → Podgląd; w linku publicznym przy pliku jest przycisk Podgląd.
- Udostępnione mi → Otwórz folder z prawem zapisu.

Po wdrożeniu odśwież przeglądarkę Ctrl+F5. Backupy nadal trzeba wykonywać lub osobno zaplanować; te funkcje nie włączają harmonogramu backupów ani 2FA. Domyślna retencja pozostaje wyłączona i żadne produkcyjne linki ani uprawnienia użytkowników nie zostały automatycznie utworzone.

## Wdrożenie

Migracja `202609260003_sharing_operations` jedynie dodaje kolumny i tabele. Zastosowano ją kontrolowanie 27.09, następnie uruchomiono nowe API i frontend oraz przeładowano reguły CSP dla lokalnych workerów PDF/haszowania i multimediów. Bez publicznego portu API/bazy, bez montowania Docker socket i bez zmiany DNS/routera. Aktualna kopia przed wdrożeniem: `backups/20260927T071849Z/`; jej odtworzenie zweryfikowano osobno.

Na tej instalacji wcześniejsze próby przez publiczny DNS kończyły się timeoutem. Podczas wdrożenia 27.09 zwykły adres HTTPS z publicznym DNS zwrócił 200, a przeglądarka wyświetliła prawidłowy ekran logowania bez błędów JavaScript. Nie zastępuje to niezależnego testu z innej sieci, np. internetu mobilnego. Nie zmieniano routera.
