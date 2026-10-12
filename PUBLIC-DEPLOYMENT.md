# Publikacja NAS — stan 27.09.2026

## Stan bieżący

- 27.09.2026 wdrożono funkcje 4–8 i animacje po świeżym backupie i kontrolowanych migracjach. API i baza są healthy; istniejące dwa konta oraz folder i plik zachowano. [Raport wdrożenia](DEPLOYMENT-2026-09-27.md).
- Bieżąca kontrola przez zwykły publiczny DNS/HTTPS zwróciła 200; przeglądarka poprawnie wyświetliła ekran logowania na desktopie i bez poziomego overflow przy 390 px. Nie wykonywano logowania za użytkownika ani niezależnego testu z internetu mobilnego.
- NAS jest skonfigurowany pod adresem https://nas.serwerbb.win przez istniejącą bramę Caddy.
- 26.09.2026 Let's Encrypt pomyślnie zweryfikował domenę z internetu i wydał certyfikat produkcyjny. Caddy przechowuje go w trwałym wolumenie i automatycznie odnawia.
- HTTPS zwraca HTTP 200; w przeglądarce sprawdzono prawidłowy ekran logowania oraz przejście z przycisku „Chmura”.
- /api/health zwraca {"status":"ok"}. /api/setup/status zwraca {"required":false}.
- Bez sesji /api/files i /api/admin/system zwracają HTTP 401.
- Przyciski na stronie głównej i w portfolio, także na ich podstronach, prowadzą do https://nas.serwerbb.win i mają etykietę „Chmura” lub „Otwórz chmurę”.
- Sprawdzono 11 automatycznych testów stron po zmianie etykiet; wszystkie przeszły. Nie wykonywano nowego pełnego audytu ani logowania za użytkownika.

## Konfiguracja

- DNS nas.serwerbb.win jest aktualizowany przez istniejący Cloudflare DDNS. Ruch nie przechodzi przez proxy Cloudflare.
- Publicznie potrzebne są TCP 80 i TCP 443 obsługiwane przez Caddy. Nie wystawiono PostgreSQL, backendu ani monitora systemowego.
- Backend działa z Secure/HttpOnly cookies, ograniczonymi uprawnieniami i systemem plików kontenera tylko do odczytu.
- Komputer jest obecnie połączony przez Ethernet, z adresem lokalnym 192.168.1.36. Poprzednia informacja o aktywnym Wi-Fi 192.168.1.15 jest nieaktualna.
- Nie wyłączano zapory Windows i nie zmieniano routera podczas tej aktualizacji.
- Dane oraz certyfikaty pozostają w dotychczasowych katalogach i trwałych wolumenach.

## Jak sprawdzić dostęp spoza domu

1. Na telefonie wyłącz Wi-Fi i włącz internet mobilny.
2. Otwórz https://nas.serwerbb.win.
3. Powinien pojawić się ekran logowania bez ostrzeżeń certyfikatu.
4. Zaloguj się własnym dotychczasowym kontem. Hasła nie należy przesyłać w rozmowie.

Kontrolę odpowiedzi można wykonać również w PowerShell:

```powershell
curl.exe --fail --show-error https://nas.serwerbb.win/api/health
```

Oczekiwany wynik: {"status":"ok"}. Sprawdzenie z własnej sieci nie jest niezależnym testem dostępu przez internet mobilny. Weryfikacja Let's Encrypt potwierdziła dostępność domeny dla walidacji certyfikatu z internetu.

## Utrzymanie

Komputer, Docker Desktop i router muszą pozostawać uruchomione. Zachowaj połączenie Ethernet i przekierowania TCP 80/443 do właściwego adresu komputera. Warto zarezerwować 192.168.1.36 dla tej karty w DHCP routera; zmiana adresu może zerwać dostęp do usług.

Nie otwieraj portów 8090, 3000, 5432 ani 9182 z internetu. Nie używaj DMZ. Certyfikat nie wymaga ręcznego odnawiania.

## Kopie i granice

- Kopie konfiguracji sprzed przełączenia znajdują się w backups/public-switch-20260926.
- Wcześniej zweryfikowano odtworzenie kopii backups/20260926T091026Z w oddzielnej bazie i katalogu.
- Konta i pliki Nextcloud nie są automatycznie importowane do NAS. Nie usunięto jego danych ani wolumenów; ta aktualizacja nie obejmowała kasowania starej usługi.
- NAS nie ma obecnie MFA ani szyfrowania plików na poziomie aplikacji. HTTPS nie zastępuje pełnego audytu bezpieczeństwa. Używaj silnych, unikalnych haseł i przechowuj kopie poza tym komputerem.
