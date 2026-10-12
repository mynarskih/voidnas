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

## GitHub — stan po publikacji

- Repozytorium: https://github.com/HMpower1/voidnas — prywatność potwierdzona przez API.
- Gałąź: main; opublikowany commit wydania: eec4030d83655b559a86332f87582e0b65d4ed27.
- Tag v0.1.0 wskazuje commit eec4030d83655b559a86332f87582e0b65d4ed27; zgodność lokalnego i zdalnego tagu potwierdzona.
- Wydanie: https://github.com/HMpower1/voidnas/releases/tag/v0.1.0 — prerelease.
- CI commita wydania: success, https://github.com/HMpower1/voidnas/actions/runs/38307098182.
- Włączone: Dependabot alerts, security updates oraz read-only workflow permissions; odczytane przez API. Secret Scanning/push protection niedostępne: Secret scanning is not available for this repository.
- Wyniki ochrony gałęzi i CI kolejnych commitów dokumentacji: aktualny RAPORT.md oraz STATUS-GITHUB.json w projects-index.

Commity dokumentacji po publikacji nie przepisują historii i nie zmieniają taga wydania. Oryginalne wdrożenie oraz dane nie były zmieniane.
