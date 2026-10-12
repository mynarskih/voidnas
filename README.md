# VoidNAS

Windows deployment status (2026-09-27): features 4–8 are deployed at https://nas.serwerbb.win after explicit approval, a fresh verified backup and controlled migrations. The updated interface includes restrained page/scroll, panel and hover animations, disabled for reduced-motion preferences. See [DEPLOYMENT-2026-09-27.md](DEPLOYMENT-2026-09-27.md) for deployment evidence and rollback preparation, [FEATURES-5-8.md](FEATURES-5-8.md) for server settings/sharing/previews/alerts and [FEATURE-4-DURABLE-UPLOADS.md](FEATURE-4-DURABLE-UPLOADS.md) for durable upload instructions and limits.

VoidNAS is a focused, self-hosted file manager for a private NAS. It uses a React/Vite interface, a Fastify API, PostgreSQL with Prisma, direct filesystem storage, Caddy HTTPS and an isolated node-exporter service for host metrics.

## Architecture

```text
Internet / LAN
     │ 80, 443
   Caddy ───── web (static React)
     │
     └─────── api (Fastify, unprivileged)
                  ├── PostgreSQL (internal network)
                  ├── /srv/nas/storage (host bind mount)
                  └── node-exporter (internal, read-only host view)
```

Binary files are never stored in PostgreSQL. Uploads use 16 MiB resumable chunks, stream to `.tmp`, reserve quota transactionally and are atomically renamed after completion. Downloads stream from disk and support HTTP Range requests.

## Requirements

- Linux NAS with Docker Engine 25+ and Docker Compose v2
- A DNS name pointing to the NAS (for public ACME HTTPS), or an internal DNS name with a locally trusted Caddy configuration
- Ports 80 and 443 reachable by clients
- A dedicated storage directory owned by UID/GID `10001`

## Installation

```sh
cp .env.example .env
openssl rand -base64 48
sudo install -d -o 10001 -g 10001 -m 0750 /srv/nas/storage
```

Put separate generated secrets into `POSTGRES_PASSWORD`, `SESSION_PEPPER` and `CSRF_SECRET`. Set `DOMAIN` and:

```env
STORAGE_HOST_PATH=/srv/nas/storage
DATABASE_URL=postgresql://voidnas:THE_SAME_POSTGRES_PASSWORD@postgres:5432/voidnas?schema=public
```

### Local Windows deployment

Docker Desktop must be running with Linux containers. The included local override binds the application **only to Windows loopback** at `http://localhost:8090`, disables the Secure cookie flag only for local HTTP, and does not request a public certificate. Do not forward port 8090 from your router:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml build
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
docker compose -f docker-compose.yml -f docker-compose.local.yml ps
```

Open `http://localhost:8090`. For real Windows CPU and RAM charts, start with `start-local.ps1`. It launches the included read-only monitor on Windows loopback port 9182 before starting Docker. The API reads it through `host.docker.internal`; the monitor is not reachable from the public network. The charts retain up to two minutes of samples while the System page is open. If the monitor is unavailable, the charts show `Unavailable` rather than Docker VM readings.

For later starts and stops you can also use:

```powershell
.\start-local.ps1
.\stop-local.ps1
```

Validate and start:

```sh
docker compose config
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=100 caddy api migrate
```

## First setup

### This computer: public gateway deployment

The existing home Caddy gateway owns ports 80/443 and joins `voidnas_public`. It serves `nas.serwerbb.win`, routes `/api/*` directly to the NAS API, and the remaining paths to the frontend. PostgreSQL stays on the internal network. Do not run a second gateway on the same public ports.

The `.public-deployment` marker makes `start-local.ps1` and `backup-local.ps1` retain the production override. Start or update this Windows installation with:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.public.yml build
docker compose -f docker-compose.yml -f docker-compose.local.yml -f docker-compose.public.yml up -d
```

This override keeps Secure cookies enabled, drops backend capabilities, and makes its container root filesystem read-only. Use `https://nas.serwerbb.win` for remote access. The loopback-only `http://localhost:8090` fallback remains available in Chromium browsers; it is not an internet listener and must never be forwarded by the router. Some browsers will not accept Secure cookies over local HTTP; use the HTTPS address in that case. The existing DDNS service updates the NAS domain when the public IP changes; credentials stay outside this repository.

Public access is **not yet verified**: the certificate authority cannot reach ports 80/443. See `PUBLIC-DEPLOYMENT.md` for the required router step and the exact current status. A DNS record alone does not mean the service is reachable.

Open `https://YOUR_DOMAIN/setup`. When no administrator exists, the application displays a one-time administrator form. Creation is serialized with a PostgreSQL advisory lock. After the first administrator exists, setup returns HTTP 410 and cannot create another account.

After signing in, the file manager opens immediately. Administration is available from the profile menu only to users whose server-confirmed role is `ADMIN`.

## Configuration

All configuration is documented in `.env.example`. Never commit `.env`. `COOKIE_SECURE` must stay `true` in HTTPS deployments. `TRUST_PROXY=true` is correct behind the included Caddy service.

### Personal preferences

Open the profile menu → **Settings**. Each account can select English or Polish, an IANA time zone (including UTC), and a light or dark appearance. Changes preview immediately; select **Save changes** to persist them in PostgreSQL. Leaving without saving restores the account's saved preferences. They apply again after signing in on another device. The browser caches only these three display preferences, never credentials or session tokens.

Time-zone selection affects displayed file, account and audit dates only. Database timestamps stay UTC and the server clock is not changed. Defaults for existing and new accounts are English, Europe/Warsaw and dark mode. Theme and language are also reflected in the document accessibility properties.

## Interface design

All NAS pages share the DESIGN3 visual language: a pure black canvas and surfaces, 1px `#292d30` borders, outlined actions, 6px control radii and 16px cards. Inter and JetBrains Mono are bundled locally; no external font service is contacted. Violet `#9281f7` is reserved for technical identifiers, utilization indicators and keyboard focus; status colors are not used as decorative card fills. There are no decorative gradients or drop shadows.

Files, sharing, trash, profile, preferences, authentication, the text editor and every administration tab use the same component rules. The light preference preserves the same layout and outlines. Small screens use a drawer; hidden navigation cannot receive keyboard focus. A skip link and reduced-motion rules are included. Three new visual-contract tests supplement the 10 existing frontend tests and prevent accidental changes to core tokens and outlined primary actions.

## Storage

Physical data is stored by immutable user UUID and file UUID:

```text
/srv/nas/storage/users/<user UUID>/files/<file UUID>
/srv/nas/storage/users/<user UUID>/.tmp/<upload UUID>.part
```

Names and folder structure remain metadata in PostgreSQL. Do not edit the storage tree manually. Incomplete uploads expire after `UPLOAD_TTL_HOURS` and are cleaned at startup and hourly. Startup also reconciles interrupted upload commits and permanent deletions before accepting requests.

### Durable upload resumption

The account-scoped browser queue persists metadata in IndexedDB, not binary files or session secrets. Transfers continue across pages; after closing/reloading the browser, sign into the same account on the same origin/profile and use **Transfers → Choose original file**. Filename, size and full SHA-256 must match. The worker reads 8 MiB at a time and uses local, incremental hashing without changing CSP; large-file verification adds an extra local disk read. The API streams a final SHA-256 verification before publication and also verifies recovered full uploads at startup.

Pause retains the server reservation; cancel releases it only after removing staging bytes. Resume always obtains the committed offset from the API. Stable upload UUIDs make initiation idempotent, including when a response is lost. Completed sessions remain queryable so the last chunk cannot accidentally create a duplicate. Account isolation, CSRF, current write grants, quota locks and exclusive server writes apply to resumed transfers. Web Locks additionally coordinates the same transfer across supported browser tabs.

Resume before the displayed expiry (default 24 hours of inactivity). Changing origin/profile, private browsing or clearing/evicting website data can lose the local queue. Filenames remain in browser metadata after logout to support later resumption; use separate profiles on shared computers. Closing the browser does NOT continue transfers in the background. Old browser sessions that never stored metadata/fingerprints cannot be recovered through the new queue. The queue is limited to 100 entries and sends files sequentially with 16 MiB chunks.

Shares support `READ` and `READ_WRITE` without copying physical data. In a writable folder recipients can create folders, upload, edit text, rename/move descendants within the shared scope and move descendants to the owner's trash. All writes charge and reserve the owner's quota. Recipients cannot re-share, permanently delete, rename/move/trash the shared root, or move items outside their granted scope. Revocation and disabled owners block subsequent access, including upload resumption.

The file **Share** dialog also creates optional read-only public links, with a password and expiry (seven days by default). Existing access can be changed, revoked or regenerated. Bearer secrets live in the URL fragment, are sent in a redacted header and are stored only as hashes. A password unlock creates a scoped two-hour HttpOnly cookie, not an account session. Password changes and token regeneration revoke visitor sessions. Links never grant write access or administration. Anyone possessing an unprotected link can read it; use a password for sensitive files. Revocation cannot recall bytes already transferred.

**Preview** in the file options opens validated raster images, PDF, browser-supported audio/video and UTF-8 text. Media uses streamed Range responses. HTML/SVG are escaped text, never executable frames. PDF rendering is local, lazy-loaded and canvas-only, without scripting/XFA/annotation layers; no external viewer/CDN is used. PDF previews are limited to 64 MiB and text to 1 MiB. Unsupported files can always be downloaded. Local WebP thumbnails are limited to 320×240, input ≤32 MiB/16 million pixels, two active decoders and sixteen waiters. Cache storage is bounded to roughly 65 MiB per owner and excluded from backups; purging a file removes its cached thumbnails.

## Users and quota

Administrators can create accounts, block/unblock them, change role and quota, and reset passwords through **Administration → Users → Manage**. Blocking an account revokes all sessions. Quota is enforced by the API, not the browser. Parallel uploads cannot overbook a user's remaining space because reservations are checked while holding a per-user database lock.

**Administration → Settings** configures trash retention (7/30/90 days or never), per-stream upload/download speed, concurrent transfers per account, the public-link switch, low-storage threshold and backup age. Defaults are retention disabled, speed unlimited (`0`), four concurrent transfers, 90% storage and 48-hour backup warning. Enabling/changing timed retention requires explicit confirmation and also applies to files already in Trash. A folder and all its descendants are permanently removed when its retention expires. Cleanup is checked every minute in batches, using the existing recoverable filesystem/DB purge workflow. An already running purge cannot be undone by disabling retention.

Limits are enforced by the API with stream backpressure, not just the UI. Rates are per stream, not an aggregate bandwidth cap, and nonzero rates must be at least 64 KiB/s. Transfer slots apply to this single backend process; horizontal API replication would require distributed coordination. The browser uploads 16 MiB chunks. At low rates a custom client's chunks must fit the five-minute HTTP timeout.

**Profile → Your devices** shows active sessions with last activity, browser and IP, and allows signing out individual sessions. **Administration → Security** gives administrators the server-wide session list. Session tokens and CSRF hashes are never returned. Browser/IP labels describe sessions, not a verified hardware identity.

**Administration → Alerts** and the admin bell show persisted local notices for low/unavailable storage, unavailable host monitor, recorded backup failures, missing/overdue successful backups and repeated failed logins (eight in fifteen minutes). Administrators can acknowledge notices and inspect resolved history. The worker checks every minute; the visible view/bell refresh every thirty seconds. When the database is down authentication/API requests may be unavailable, and the UI reports a connection problem. An outage observed by the running worker is recorded as resolved history after database recovery; this in-memory observation does not survive an API restart. This is not an independent uptime monitor. No emails, external notifications or telemetry are sent.

## HTTPS and DNS

Create an `A`/`AAAA` record for `DOMAIN` pointing to the NAS. Forward TCP 80 and TCP/UDP 443 only if access from the public internet is intended. Caddy obtains and renews certificates automatically. For a LAN-only deployment, use split DNS and either a public domain with DNS challenge configuration or Caddy's internal CA; trust that CA on each client.

Check:

```sh
curl -I https://YOUR_DOMAIN/api/health
```

Expected status: `200` and HSTS/X-Content-Type-Options headers.

## Backup

Load the environment and run:

```sh
set -a; . ./.env; set +a
sh scripts/backup.sh
```

The backup contains a PostgreSQL custom-format dump, filesystem archive and checksums. Incomplete `.tmp` uploads, `.edits/*.tmp` edit streams, thumbnail caches and operations temporary files are excluded. Keep `.purge` staging files and edit recovery journals: after an uncertain database commit they can contain the complete copy needed to recover a file. Copy the whole timestamped directory to independent storage. Scripts record their actual outcome and last successful completion in `storage/.operations/backup-status.json` for local alerts. They restart the existing API container rather than silently upgrading it. This feature does not schedule backups automatically; the administrator must run or schedule the backup script separately. Older backups made before result recording are shown as “Not recorded”, not invented successful runs.

On this Windows-local deployment, run `./backup-local.ps1` from PowerShell instead. It resolves the actual storage bind mount from Docker Compose, briefly stops the API to keep the database and files consistent, and writes the same three artifacts to `backups/<UTC timestamp>/`. Verify the two SHA-256 values in `SHA256SUMS` with `Get-FileHash`. Keep an additional copy outside this computer.

## Restore

Stop uploads and verify free space. Then:

```sh
set -a; . ./.env; set +a
sh scripts/restore.sh ./backups/20260925T120000Z
```

The script verifies checksums and requires typing `RESTORE`. Test restore procedures periodically on a separate host.

The shell restore script targets the Linux deployment. For Windows, verify a backup non-destructively with:

```powershell
.\test-restore-local.ps1 -BackupPath .\backups\20260926T091026Z
```

This verifies checksums, restores storage to an isolated directory and PostgreSQL to a uniquely named test database, applies migrations, and verifies every physical file against its metadata. It does not overwrite the running NAS. The backup above passed this test on this computer (2 accounts and 1 physical file). This is a recovery verification, not an in-place Windows restore command: do not run the Linux restore script against this Windows deployment. A production replacement must stop writers and restore both the database and storage together, retaining the previous pair until verification succeeds. Never restore just one of them.

## Updating

Create a fresh backup first. Review migrations before applying them:

```sh
git pull --ff-only
docker compose build
docker compose run --rm migrate
docker compose up -d
docker compose ps
docker compose logs --tail=100 migrate api
```

Migrations run in a dedicated one-shot container. The API starts only after a successful migration. Never use `prisma migrate reset` on production data.

## Security

- Argon2id password hashing
- opaque HttpOnly, Secure, SameSite=Strict sessions
- per-session CSRF tokens
- request validation, security headers and targeted rate limits
- UUID ownership checks and database-derived paths
- no Docker socket, no privileged backend, no public database/metrics ports
- audit logging without credentials or session material

See `SECURITY.md` for boundaries and incident guidance. Public exposure still requires normal server patching, firewalling, backups and monitoring.

## Tests

For Windows Docker, run `./test-local.ps1` from the project folder. It creates a uniquely named disposable PostgreSQL database and an isolated temporary Windows storage directory mounted into the test container. Its 68 checks cover authentication and session revocation, admin/ownership authorization, CSRF and cross-origin rejection, account/IP throttling, executable uploads, range download, text editing and recovery, quota and expired reservations, interrupted/concurrent streams, folder-move races, READ_WRITE scope/owner quota/revocation, password-protected public links and rotated-IP throttling, previews/MIME spoofing, retention/cache cleanup, real transfer limits, backup alerts and database-outage recovery history. It removes only its temporary test database and directory and does not change your NAS accounts or storage. The API also has 39 unit tests on Linux (six filesystem-specific checks are skipped on native Windows); the frontend has 42 unit/contract tests, including durable queue recovery, account isolation, bounded SHA-256 reads and reduced-motion/scroll-animation cleanup. Durable upload checks include immutable identities, idempotent reservation/initiation, verified offsets, lost completion responses, checksum failures, zero-byte files and explicit expiry.

Text editing is available through the file options menu: **Edit text**. The editor accepts UTF-8 files up to 1 MiB, preserves line endings and the BOM, and rejects binary contents. Saving uses a new physical file and an atomic database pointer change; the previous contents remain until commit. Recovery journals reconcile unfinished saves on startup. Concurrent changes produce a conflict instead of overwriting newer content. Shared files are editable only with a current READ_WRITE grant; public links remain read-only. Clicking a file name downloads it; clicking a folder name opens the folder.

```sh
pnpm install
pnpm db:generate
pnpm build
pnpm test
docker compose config
```

Before production, also test login, disabled accounts, admin authorization, resumable upload, interrupted upload cleanup, range download, concurrent quota reservation, trash restore and symlink/path escape against a disposable PostgreSQL database and storage directory.

## Troubleshooting

- `502` from Caddy: inspect `docker compose ps` and `docker compose logs api migrate`.
- Setup unavailable: an administrator already exists; sign in or reset it through a controlled database recovery.
- Host metrics unavailable: inspect `docker compose logs system-metrics` and confirm the service is only on the internal network.
- Permission denied in storage: `sudo chown -R 10001:10001 /srv/nas/storage`.
- HTTPS failure: verify DNS, firewall and that ports 80/443 are not already in use.
- Upload stops at the same point: check filesystem free space, user quota and reverse-proxy logs.

## Przygotowanie prywatnego repozytorium — 2026-10-12

Interfejs NAS i API do zarządzania plikami: React/Vite, Node.js/TypeScript, Prisma/PostgreSQL i Caddy.

Źródło bieżącego wdrożenia: `C:\Users\hmpow\Documents\Codex\2026-09-25\chc-aby-zaprojektowa-i-stworzy-od\outputs\voidnas`. Ten katalog jest oddzielną kopią przygotowaną do wersjonowania; działające kontenery nadal używają oryginału. Nie przeniesiono baz danych ani wolumenów. Nie dodano licencji open source.

### Wymagania i instalacja

Windows/PowerShell, Git, Docker Desktop z kontenerami Linux i Compose obsługującym `!override` (2.24.4 lub nowszy). Aplikacje JS wymagają Node.js 22.13+; projekty z pnpm używają pnpm 11.19.0. Backend wymaga Python 3.13 przy uruchomieniu poza Dockerem. Klonuj dopiero po utworzeniu potwierdzonego prywatnego repozytorium.

### Konfiguracja, uruchomienie i testy

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Wypełnij hasła i klucze; DATABASE_URL musi używać tego samego hasła co PostgreSQL.
docker compose -p voidnas-dev -f docker-compose.yml -f docker-compose.local.yml config --quiet
docker compose -p voidnas-dev -f docker-compose.yml -f docker-compose.local.yml up -d --build
pnpm install --frozen-lockfile
$env:NODE_ENV = 'test'
pnpm test
pnpm build
```

Wartości `.env.example` są szablonem, nie konfiguracją produkcyjną. Wypełnij lokalny `.env` niezależnymi losowymi sekretami; nie zastępuj działających kluczy bez planu rotacji. Porty i sieci produkcyjne są zajęte: używaj osobnego projektu Compose i wolnych portów. Temp Mail w wariancie domowym współdzieli bramę; pełne odizolowanie wymaga dodatkowej konfiguracji sieci i routingu. Nie wykonuj `down -v` na produkcji.

### Faktyczny stan kontroli i ograniczenia

75 testów PASS; 6 testów integracyjnych pominiętych, wymagają przygotowanej bazy. Nie wykonywano operacji na produkcyjnych danych NAS.

Wyniki końcowe i audyt po poprawkach opisuje `KONTROLE.md`. Workflow ma uprawnienie `contents: read`, brak sekretów, przypięte Actions i osobny skan Gitleaks przed instalacją zależności. Obecność workflow nie oznacza, że CI na GitHub zostało uruchomione. Zabezpieczenia konta, prywatność zdalnego repo i zgodność SHA wymagają sprawdzenia po wysłaniu. Pierwsze wydanie 0.1.0 należy oznaczyć jako prerelease.
