# Przegląd bezpieczeństwa i interfejsu — 26.09.2026

Przejrzano kod VoidNAS, uwierzytelnianie, sesje, operacje plikowe, udostępnienia, limity, recovery, konfigurację Docker/Caddy, monitor systemowy oraz interfejs. Poprawiona aplikacja została zbudowana i uruchomiona w istniejących kontenerach. Nie zmieniano haseł, kont ani plików użytkownika. Testy zapisu wykonywano na oddzielnych bazach i katalogach.

## Naprawy

- **Limit przestrzeni i cleanup:** wygasła rezerwacja mogła przestać być liczona mimo istniejących bajtów uploadu. Wszystkie rezerwacje liczą się do limitu aż do usunięcia pliku tymczasowego. Cleanup ponownie sprawdza stan pod tą samą blokadą właściciela co odnowienie uploadu; nie usuwa aktywnego strumienia. Quota zostaje zwolniona dopiero po fizycznym usunięciu danych.
- **Równoległe zmiany folderów:** równoczesne przeniesienia A do B i B do A mogły ominąć wcześniejszą kontrolę rodziców. Tworzenie, przenoszenie, kosz, przywracanie i finalizacja uploadu sprawdzają hierarchię w transakcji pod wspólną blokadą właściciela.
- **Ochrona logowania:** dodano trwały limit ośmiu nieudanych prób na konto w oknie 15 minut, niezależnie od adresu IP. Dotychczasowy limit na IP pozostaje. Nieznane, zablokowane i wyłączone konta wykonują weryfikację zastępczego hasha Argon2id. Wszystkie miejsca ustawiania haseł używają jednakowych parametrów.
- **Żądania z innych stron:** każda operacja modyfikująca stan, także login i setup, odrzuca cross-site oraz niedozwolony Origin. W HTTPS origin musi być HTTPS i odpowiadać hostowi oraz portowi bramy. Uwierzytelnione operacje nadal wymagają tokenu CSRF. Klienci bez nagłówka Origin nadal potrzebują sesji i CSRF.
- **Sesje i role:** zmiana roli unieważnia sesje konta. Blokada konta i administracyjny reset hasła również je unieważniają; rola jest sprawdzana po stronie serwera.
- **Nazwy i odpowiedzi:** odrzucane są nieprawidłowe nazwy, kontrolne znaki kierunku tekstu, nazwy zastrzeżone Windows, nieprawidłowy Unicode oraz przekroczenie 255 bajtów UTF-8. Publiczne odpowiedzi nie zawierają fizycznych ścieżek ani hashy sekretów.
- **Pobieranie:** deklarowany przez klienta MIME nie decyduje o nagłówku pobieranego pliku. Typ jest wyznaczany na serwerze z rozszerzenia; pozostają attachment i nosniff. Range i pobieranie strumieniowe przechodzą testy.
- **Logi:** usunięto pełne obiekty błędów mogące zawierać parametry zapytań; włączono redakcję nagłówków uwierzytelniania. Nieudany zapis audytu daje ostrzeżenie bez sekretów.
- **Kopie zapasowe:** niekompletne strumienie są wykluczane, lecz zachowywane są kompletne pliki w stagingu purge i dzienniki recovery. Mogą być potrzebne po niejednoznacznym wyniku zatwierdzenia transakcji.
- **Biblioteki:** zaktualizowano deepmerge-ts do 8.0.0 i Vitest do 4.1.11. Obie kontrolowane listy zależności — produkcyjna i pełna — nie zgłosiły znanych advisories w momencie sprawdzenia.

Aktualizacje bibliotek są działaniem zapobiegawczym: advisory deepmerge-ts dotyczy rekursywnych grafów obiektów, a nie zwykłego JSON; zależność występuje w narzędziach Prisma. Advisory Vitest dotyczy serwera deweloperskiego z mockerem, nie normalnego produkcyjnego endpointu NAS. Źródła: [deepmerge-ts](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx), [Vitest](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).

## Wygląd i dostępność

Zachowano DESIGN3: czarne powierzchnie, cienkie grafitowe obramowania, lokalne fonty, subtelny violet, bez gradientów i ciężkich cieni. Dodano krótkie przejścia stron/paneli i reakcje przycisków; prefers-reduced-motion je wyłącza. Menu pliku jest nad tabelą, mieści się w wysokości ekranu i nie wymaga przewijania do ostatniej opcji. Poprawiono klawiaturę, etykiety, fokus i blokowanie przewijania pod modalem, mobilne rozmiary przycisków oraz zawijanie breadcrumbs.

Wykresy zasobów nie łączą odcinków przez brakujące pomiary i nie pokazują ostatniego poprawnego procentu jako aktualnego, gdy monitor jest niedostępny. Linux nie przedstawia liczby logicznych wątków jako liczby fizycznych rdzeni.

Testy w przeglądarce używały osobnego konta testowego i pustych plików testowych, nie kont użytkownika. Sprawdzono desktop oraz 390 × 844 px, menu przy dolnej krawędzi, Escape i powrót fokusu. Nie zaobserwowano błędów konsoli w testowanej sesji. Skill computer-use posłużył do rzeczywistej kontroli tych zachowań i wykrycia poprawionej utraty fokusu.

## Weryfikacja

- Build TypeScript/Vite i oba obrazy Docker: poprawne.
- Backend w Linux/Docker: 29/29 testów jednostkowych.
- Frontend w Docker: 17/17 testów jednostkowych/kontraktów.
- Integracja na oddzielnej bazie i storage: 47/47 sprawdzeń. Obejmują login, disabled user, CSRF, uprawnienia ADMIN, IDOR, quota i równoległe rezerwacje, upload 16 MiB/EXE, przerwany strumień, Range, edytor, recovery, kosz, udostępnienia, throttle, race folderów i audyt.
- Po wdrożeniu backend i PostgreSQL healthy. Lokalny HTTPS przez bramę dla nas.serwerbb.win: health 200, administracja bez sesji 401, cross-origin login 403. Strona podaje nowy bundle interfejsu.
- Potwierdzone CSP, HSTS, nosniff, zakaz ramek i ograniczenie uprawnień przeglądarki. Backend nie jest privileged, działa jako nie-root, ma read-only root i wszystkie capabilities usunięte. API i PostgreSQL nie mają publicznych portów hosta.
- Zwykłe połączenie HTTPS przez publiczny DNS z tego komputera zakończyło się timeoutem. Lokalny test TLS z mapowaniem domeny na loopback działa. To nie potwierdza dostępu z internetu; do rozróżnienia dostępu zewnętrznego od braku NAT loopback potrzebny jest test spoza domowej sieci.

## Granice przeglądu i pozostałe ograniczenia

Uwaga: ten raport dotyczy wcześniejszego audytu. READ_WRITE, retencja, linki publiczne, podglądy i alerty zostały następnie zaimplementowane i zweryfikowane w kodzie; aktualny stan wdrożenia i wyniki znajdują się w `FEATURES-5-8.md`. Poniższa historyczna lista nie opisuje dostępności nowej wersji na produkcji.

To przegląd kodu i konfiguracji z testami, nie certyfikacja ani gwarancja braku innych luk. Nie przeprowadzano zewnętrznego pentestu routera, Windows ani infrastruktury operatora. Dane produkcyjne nie były usuwane ani odtwarzane, a pełne produkcyjne backup/restore nie były ponownie wykonywane w tym przeglądzie.

- Brak 2FA. Silne unikatowe hasło administratora pozostaje istotne; throttling może też czasowo zablokować konto po celowych próbach logowania.
- Odbiorcy udostępnień mają READ; READ_WRITE nie jest zaimplementowane. Automatyczna retencja kosza nie jest aktywna. Backend obsługuje wznowienie uploadu po offsetach, ale kolejka frontendu nie oferuje kompletnego trwałego wznowienia po zamknięciu przeglądarki.
- Storage nie może być zapisywalny przez nieufne procesy na hoście. Niektóre operacje tworzenia/recovery opierają się na tej granicy; zabezpieczenia deskryptorów w kontenerze nie zastępują prawidłowych uprawnień hosta.
- W Linux należy potwierdzić, że monitorowany filesystem jest rzeczywistym dyskiem NAS, szczególnie przy zewnętrznym mount. Nieznane dane powinny pozostać Unavailable.
- Kopie muszą być przechowywane również poza komputerem. Windowsowy test odtwarzania jest niedestrukcyjny; produkcyjne zastąpienie wymaga kontrolowanego zatrzymania zapisu i wspólnego odtworzenia DB oraz storage. Linuxowego restore.sh nie uruchamiać przeciw tej instalacji Windows. Przyjmować tylko własne zaufane kopie; suma kontrolna sama nie uwierzytelnia źródła archiwum.

Po otwarciu chmury odśwież stronę Ctrl+F5, aby wczytać nowy interfejs. Nie dodano zewnętrznej telemetryki.
