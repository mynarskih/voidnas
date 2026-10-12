# Rzeczywisty wynik kontroli â€” 2026-10-12

75 testĂłw PASS; 6 pominiÄ™tych testĂłw integracyjnych wymagajÄ…cych bazy. Prisma generate PASS; peĹ‚ny build obu aplikacji PASS po poprawkach.

## Sekrety i dane

Gitleaks 8.30.1: przygotowany zestaw ĹşrĂłdeĹ‚ PASS. Wykluczono rzeczywiste .env, token DDNS, dane NAS, prywatne zasoby, bazy, kopie, zaleĹĽnoĹ›ci i wyniki buildĂłw. Szablony .env.example zawierajÄ… nazwy oraz puste wartoĹ›ci/przykĹ‚adowÄ… konfiguracjÄ™. W Temp Mail sprawdzono takĹĽe caĹ‚Ä… oryginalnÄ… historiÄ™ --all, bez wykryÄ‡. DokĹ‚adny finalny zestaw wersjonowanych plikĂłw i SHA zapisuje projects-index/MANIFESTY.json po przygotowaniu commitĂłw.

Sprawdzono pliki juĹĽ Ĺ›ledzone; .gitignore nie byĹ‚ traktowany jako dowĂłd braku sekretĂłw. Kod obejmuje przykĹ‚adowe dane testowe i publiczne treĹ›ci stron, ale nie bazy klientĂłw/uĹĽytkownikĂłw, sesje lub listy kontaktĂłw. Skaner nie gwarantuje wykrycia kaĹĽdego nietypowego sekretu ani wszystkich danych osobowych; przeglÄ…d obejmowaĹ‚ ĹşrĂłdĹ‚a/config oraz wykluczenie danych lokalnych. Nie przepisywano historii.

## ZaleĹĽnoĹ›ci

KoĹ„cowy audyt npm/pnpm: critical: 0, high: 0, moderate: 0, low: 0.

Brak zgĹ‚oszeĹ„ w bazie npm w chwili audytu. To nie dowodzi braku nieznanych problemĂłw.

Poprawiono sharp 0.35.5 i source-map-js 1.2.2. SpĂłjny lock zweryfikowano instalacjÄ… frozen-lockfile. Audyt zmniejszyĹ‚ zgĹ‚oszenia z 2 do 0. Oryginalnych kontenerĂłw nie przebudowano.


## Obrazy Docker i ograniczenia

Lokalny Trivy 0.75.0 przeskanowaĹ‚ obrazy bez wysyĹ‚ania kodu. Obrazy dziaĹ‚ajÄ…cych aplikacji pochodzÄ… z obecnego wdroĹĽenia, nie z poprawionych kopii ĹşrĂłdeĹ‚. SzczegĂłĹ‚owe CVE i wersje: projects-index/AUDYT-DOCKER.json, podsumowanie: projects-index/RAPORT.md. Nie restartowano produkcji, nie zmieniano sekretĂłw ani danych. Aktualizacja baz/obrazĂłw i odtwarzanie wymagajÄ… osobnego planu wdroĹĽenia. Lokalny build JS nie jest skanem nowego kompletnego obrazu produkcyjnego.

## GitHub — stan po publikacji

- Repozytorium: https://github.com/HMpower1/voidnas — prywatność potwierdzona przez API.
- Gałąź: main; opublikowany commit wydania: eec4030d83655b559a86332f87582e0b65d4ed27.
- Tag v0.1.0 wskazuje commit eec4030d83655b559a86332f87582e0b65d4ed27; zgodność lokalnego i zdalnego tagu potwierdzona.
- Wydanie: https://github.com/HMpower1/voidnas/releases/tag/v0.1.0 — prerelease.
- CI commita wydania: success, https://github.com/HMpower1/voidnas/actions/runs/38307098182.
- Włączone: Dependabot alerts, security updates oraz read-only workflow permissions; odczytane przez API. Secret Scanning/push protection niedostępne: Secret scanning is not available for this repository.
- Wyniki ochrony gałęzi i CI kolejnych commitów dokumentacji: aktualny RAPORT.md oraz STATUS-GITHUB.json w projects-index.

Commity dokumentacji po publikacji nie przepisują historii i nie zmieniają taga wydania. Oryginalne wdrożenie oraz dane nie były zmieniane.
