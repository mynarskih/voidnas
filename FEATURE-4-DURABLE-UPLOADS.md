# Trwałe wznawianie uploadów — funkcja 4

Status na 27.09.2026: wdrożone na https://nas.serwerbb.win po zgodzie użytkownika. Zastosowano obie oczekujące migracje, uruchomiono nowe kontenery oraz przeładowano CSP dla lokalnych workerów. Funkcje 5–8 także są wdrożone. Szczegóły: [raport wdrożenia](DEPLOYMENT-2026-09-27.md).

## Obsługa

1. W Plikach albo zapisywalnym udostępnionym folderze wybierz Prześlij. Można dodać wiele plików lub przeciągnąć je do własnego folderu.
2. Transfery są dostępne w nagłówku całej aplikacji. Możesz przechodzić między stronami albo zamknąć panel bez zatrzymywania kolejki.
3. Wstrzymaj zatrzymuje bieżącą operację. Wznów kontynuuje w tej samej karcie, jeżeli przeglądarka nadal ma plik.
4. Po zamknięciu/odświeżeniu strony zaloguj się na to samo konto, w tej samej przeglądarce i pod tym samym adresem. W Transferach wybierz Wskaż oryginalny plik.
5. Nazwa, rozmiar i SHA-256 muszą pasować. Zmieniony plik nie zostanie doklejony do wcześniejszych fragmentów.
6. Anuluj upload usuwa niekompletny transfer i zwalnia rezerwację na serwerze. Jeżeli anulowanie napotka błąd sieci, pozostaje widoczne do ponowienia. Nie usuwa pliku już ukończonego.
7. Ukryj usuwa jedynie wpis zakończonego/anulowanego transferu z kolejki przeglądarki, a nie zapisany plik NAS.

## Ważne ograniczenia

- Przy zamkniętej przeglądarce nie trwa wysyłanie w tle. Ponowne wskazanie pliku jest wymagane, ponieważ witryna nie otrzymuje trwałego dostępu do dysku.
- Serwer zachowuje aktywną sesję przez UPLOAD_TTL_HOURS (domyślnie 24 godziny, maksymalnie 168); zaakceptowany fragment odnawia termin. Panel pokazuje faktyczny termin zwrócony przez serwer.
- Po wygaśnięciu anuluj sesję i dodaj plik ponownie. Zarezerwowane miejsce jest zwalniane dopiero po bezpiecznym usunięciu fragmentów.
- Czyszczenie danych witryny, tryb prywatny, automatyczne usunięcie danych przez przeglądarkę, inny profil/przeglądarka lub inny adres strony mogą uniemożliwić odtworzenie kolejki.
- IndexedDB przechowuje wyłącznie metadane (m.in. nazwę, rozmiar, folder docelowy, sumę kontrolną, ID i offset), nie pliki ani dane uwierzytelniające. Nazwy pozostają w profilu przeglądarki po wylogowaniu, aby umożliwić wznowienie na tym samym koncie. Na wspólnym komputerze używaj osobnego profilu.
- Najpierw następuje pełne lokalne odczytanie pliku porcjami 8 MiB w osobnym workerze. Nie blokuje to interfejsu, lecz bardzo duży plik wymaga czasu i dodatkowego odczytu z dysku. Przy wznowieniu zawartość jest sprawdzana ponownie.
- Serwer sprawdza SHA-256 strumieniowo przed opublikowaniem pliku, więc ostatni fragment może czekać na kontrolę całości.
- Kolejka ma limit 100 wpisów; usuń z niej zakończone transfery, aby zrobić miejsce. Wysyłanie plików jest kolejkowane, nie odbywa się równolegle przez sto strumieni.
- Web Locks blokuje równoczesne wysyłanie tej samej sesji przez dwie karty, jeżeli przeglądarka wspiera ten mechanizm. Niezależnie od niego serwer zawsze sprawdza wyłączność zapisu i offset.
- Frontend wymaga HTTPS lub zaufanego adresu loopback (localhost/127.0.0.1). Nie osłabiono CSP ani ochrony CSRF.
- Nie można bezpiecznie wznowić w tej kolejce transferów rozpoczętych przez starą wersję strony, która nie zapisywała metadanych i SHA-256. Stare sesje API bez zadeklarowanej sumy zachowują kompatybilność, ale nie otrzymują nowej kontroli SHA-256.

## Integralność i bezpieczeństwo

Przed inicjacją zapisujemy UUID transferu i SHA-256 w IndexedDB. Powtórzony POST z tym samym UUID jest idempotentny i nie rezerwuje miejsca drugi raz. UUID nie ustala użytkownika ani ścieżki: właściciel i uprawnienia nadal pochodzą z sesji/bazy. Zmieniona tożsamość transferu zwraca 409; obcy transfer 404; wygasły 410.

GET /api/uploads/:id zwraca tylko bezpieczny status, zatwierdzony offset, rozmiar, SHA-256 i termin. Każde wznowienie korzysta z offsetu serwera, nie wartości lokalnej. COMPLETE pozwala rozpoznać utratę końcowej odpowiedzi bez tworzenia duplikatu. HEAD pozostaje dostępny i zwraca także Upload-Status oraz Upload-Expires. Odczyty statusu nie są cache'owane.

Fragmenty 16 MiB są wysyłane bez base64. Backend używa pipeline/backpressure oraz fsync przed zatwierdzeniem offsetu. SHA-256 serwera korzysta z przypiętego deskryptora z ochroną przed symlinkami. Nieprawidłowa suma daje FAILED/422 i nie tworzy FileEntry. Quota pozostaje zarezerwowana do usunięcia pliku tymczasowego. Odzyskiwanie po restarcie też sprawdza sumę i bieżące uprawnienia, a ukończony odzyskany upload trafia do dziennika audytu.

Frontend korzysta z lokalnie bundlowanego, przyrostowego SHA-256 [noble-hashes](https://github.com/paulmillr/noble-hashes). Brak CDN, WebAssembly, dodatkowych zezwoleń eval, telemetrii i zewnętrznego przesyłania zawartości.

## Weryfikacja

- Backend w Linux/Docker: 39/39 testów jednostkowych.
- Frontend: 42/42 testów; w tym 15 dla trwałej kolejki, kont, przerw, idempotencji, anulowania, zmienionych plików i porcjowanego hashowania oraz 5 dla nowych animacji.
- Pełna regresja PostgreSQL + filesystem: 68/68 sprawdzeń na osobnej bazie i katalogu, bez dotykania produkcyjnych kont.
- Rzeczywisty restart testowego kontenera: odzyskano offset 16 MiB i dosłano pozostałe 4 MiB; SHA-256 pobranego pliku pasował. Poprawny pełny plik odzyskano, a uszkodzony odrzucono i posprzątano.
- Build React/TypeScript, backendu i obrazów Docker.
- Kontrola panelu w przeglądarce: czarny interfejs zgodny z DESIGN3.md, zamykany panel, przycisk globalny; bez poziomego overflow przy 320/390 px.
- Nie przeprowadzono ręcznego transferu pliku przez chooser przeglądarki; logikę wznowienia i trwałości sprawdzają automatyczne testy, a transfer/restart test rzeczywistego serwera.
- Audyt zależności produkcyjnych: brak znanych podatności w momencie sprawdzenia (27.09.2026). To nie zastępuje pełnego audytu bezpieczeństwa.

## Wdrożenie

Nowa migracja 202609270001_durable_uploads dodaje tylko opcjonalne pole UploadSession.sha256. Nie usuwa ani nie przepisuje plików. Przed wdrożeniem wykonaj świeży backup DB i storage; backup wyklucza niekompletne uploady. Nie wdrażaj w środku aktywnych transferów.

27.09.2026 wykonano świeży backup backups/20260927T071849Z i sprawdzono jego odtworzenie w osobnej bazie/katalogu. Kontrolowane migracje 202609260003_sharing_operations i 202609270001_durable_uploads zakończyły się poprawnie. Nowe API i frontend działają; nagłówek worker-src 'self' jest aktywny. Liczby kont i plików oraz rozmiary plików fizycznych pozostały zgodne. Poprzednia wersja może pracować z dodatkową nullable kolumną; ewentualny rollback obrazu nie powinien usuwać kolumny ani danych. Dokładne kroki aktualizacji i backupu są w README.
