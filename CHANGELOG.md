# Historia zmian

## 0.1.0 — przygotowanie pierwszego wydania, 2026-10-12

- Zapis aktualnego kodu i zasobów projektu: Interfejs NAS i API do zarządzania plikami: React/Vite, Node.js/TypeScript, Prisma/PostgreSQL i Caddy.
- Dodanie reguł wykluczania sekretów, danych, zależności i wyników buildów.
- Dokumentacja uruchomienia, konfiguracji, kontroli i ograniczeń.
- Workflow CI z minimalnymi uprawnieniami i lokalnym skanowaniem Gitleaks.
- 75 testów PASS; 6 testów integracyjnych pominiętych, wymagają przygotowanej bazy. Nie wykonywano operacji na produkcyjnych danych NAS.

Wydanie przygotowywane jako prerelease. Nie tworzono historii wcześniejszych wydań. Istniejące numery w package.json pozostają zachowane. Szczegóły poprawionych zależności i wykonanych kontroli: KONTROLE.md. GitHub Release jeszcze nie utworzony.

### Końcowa kontrola przygotowanej kopii

75 testów PASS; 6 pominiętych testów integracyjnych wymagających bazy. Prisma generate PASS; pełny build obu aplikacji PASS po poprawkach.

Końcowy audyt npm/pnpm: critical: 0, high: 0, moderate: 0, low: 0.

Brak zgłoszeń w bazie npm w chwili audytu. To nie dowodzi braku nieznanych problemów.

Poprawiono sharp 0.35.5 i source-map-js 1.2.2. Spójny lock zweryfikowano instalacją frozen-lockfile. Audyt zmniejszył zgłoszenia z 2 do 0. Oryginalnych kontenerów nie przebudowano.

