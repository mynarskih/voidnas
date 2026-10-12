# Rzeczywisty wynik kontroli — 2026-10-12

75 testów PASS; 6 pominiętych testów integracyjnych wymagających bazy. Prisma generate PASS; pełny build obu aplikacji PASS po poprawkach.

## Sekrety i dane

Gitleaks 8.30.1: przygotowany zestaw źródeł PASS. Wykluczono rzeczywiste .env, token DDNS, dane NAS, prywatne zasoby, bazy, kopie, zależności i wyniki buildów. Szablony .env.example zawierają nazwy oraz puste wartości/przykładową konfigurację. W Temp Mail sprawdzono także całą oryginalną historię --all, bez wykryć. Dokładny finalny zestaw wersjonowanych plików i SHA zapisuje projects-index/MANIFESTY.json po przygotowaniu commitów.

Sprawdzono pliki już śledzone; .gitignore nie był traktowany jako dowód braku sekretów. Kod obejmuje przykładowe dane testowe i publiczne treści stron, ale nie bazy klientów/użytkowników, sesje lub listy kontaktów. Skaner nie gwarantuje wykrycia każdego nietypowego sekretu ani wszystkich danych osobowych; przegląd obejmował źródła/config oraz wykluczenie danych lokalnych. Nie przepisywano historii.

## Zależności

Końcowy audyt npm/pnpm: critical: 0, high: 0, moderate: 0, low: 0.

Brak zgłoszeń w bazie npm w chwili audytu. To nie dowodzi braku nieznanych problemów.

Poprawiono sharp 0.35.5 i source-map-js 1.2.2. Spójny lock zweryfikowano instalacją frozen-lockfile. Audyt zmniejszył zgłoszenia z 2 do 0. Oryginalnych kontenerów nie przebudowano.


## Obrazy Docker i ograniczenia

Lokalny Trivy 0.75.0 przeskanował obrazy bez wysyłania kodu. Obrazy działających aplikacji pochodzą z obecnego wdrożenia, nie z poprawionych kopii źródeł. Szczegółowe CVE i wersje: projects-index/AUDYT-DOCKER.json, podsumowanie: projects-index/RAPORT.md. Nie restartowano produkcji, nie zmieniano sekretów ani danych. Aktualizacja baz/obrazów i odtwarzanie wymagają osobnego planu wdrożenia. Lokalny build JS nie jest skanem nowego kompletnego obrazu produkcyjnego.

## GitHub

Repozytorium zdalne, prywatność, SHA i tag, CI oraz Release: jeszcze niewykonane. Nie ma potwierdzonego uwierzytelnienia CLI. Pliki workflow i Dependabot są przygotowane; nie oznacza to aktywacji zabezpieczeń na GitHub. Nie aktywowano płatnych dodatków ani próbnych subskrypcji.
