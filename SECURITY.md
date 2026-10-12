# Security model

VoidNAS treats the database as the authority for identity, role, ownership, quota and physical storage location. The browser never supplies trusted `ownerId`, `userId`, `role`, `quota` or `storagePath` values.

## Boundaries

- File APIs accept UUIDs and resolve physical paths from database records.
- Every resolved path must remain under `STORAGE_ROOT`.
- Uploads are written to private `.tmp` files and atomically renamed only after the declared byte count is complete.
- New browser uploads declare an immutable full SHA-256; the API verifies it through a pinned descriptor before publication and restart recovery. Legacy API sessions without a declared checksum retain byte-count validation. A mismatch never publishes a FileEntry and keeps quota reserved until staging cleanup.
- Stable client upload UUIDs are opaque idempotency keys, not identity/ownership claims. Repeated initiation verifies actor, actual owner, target folder, filename, size and checksum; it cannot create a second reservation. Status endpoints are authenticated and no-store. Browser IndexedDB persists account-scoped metadata only, never File/Blob data or credentials. Metadata (including names) survives logout in that browser profile; profiles/site-data clearing define its privacy boundary.
- Quota reservations and accounting changes serialize on a per-user PostgreSQL advisory lock. Read-committed transactions read the latest ledger after acquiring the lock.
- Sessions are server-side, opaque, revocable and stored as hashes.
- Mutating authenticated requests require the per-session CSRF token.
- Every mutation, including login/setup, rejects cross-site requests and invalid Origin headers. HTTPS deployments accept only an HTTPS origin matching the gateway host and port.
- Login has both an IP rate limit and a persistent account-bound limit of eight failures per fifteen-minute window. Password checks use uniform Argon2id parameters and a dummy hash for unknown or unavailable accounts.
- Role changes, account blocking and administrative password resets revoke affected sessions.
- All outstanding quota reservations remain chargeable, including expired ones, until cleanup safely removes temporary bytes. Cleanup and upload renewal share the owner advisory lock.
- Folder hierarchy changes and upload finalization share the owner lock, preventing reciprocal concurrent moves from creating cycles.
- Public metadata omits physical storage paths. Download MIME types come from server-side extension inference, not client-provided MIME claims; downloads remain attachments with nosniff protection.
- Filenames reject traversal, reserved Windows names, control/directional characters, invalid Unicode and overlong UTF-8 encodings.
- `/api/admin/*` verifies `ADMIN` for every request.
- PostgreSQL and node-exporter are attached only to the internal Docker network.
- The backend has no Docker socket and is not privileged.
- Public user responses use an explicit allowlist; password hashes never leave the API.
- Reads/writes walk directories using `O_DIRECTORY | O_NOFOLLOW` and pinned Linux file descriptors, rejecting symlinks throughout the path. Storage creation/recovery directories are also checked and must not be writable by untrusted host processes.
- An upload has one exclusive writer. Its committed offset is advanced only after a complete chunk and `fsync`; cancellation cannot race an active writer. Chunks are bounded to 64 MiB and HTTP requests have a five-minute timeout.
- Copies reserve quota before filesystem work. Startup reconciles interrupted copies and uploads.
- Public deployment uses HTTPS, Secure cookies, CSP and frame protection. The API runs non-root with dropped capabilities and a read-only container root filesystem.
- READ_WRITE access is checked against active ancestor grants and the owner's enabled status on the server. Mutations share the owner's database lock and quota ledger, not the recipient's. Shared-root hierarchy changes, re-sharing and permanent deletion remain owner-only. Revoked uploads cannot finish during restart recovery.
- Public links store only random-token/password hashes. Visitor grants are HttpOnly, scoped to one link, expire within two hours and never authenticate an account. Expiry, revocation, password/token changes and the administrator's public-link switch are rechecked. Unlocks still reject foreign Origin; they are exempt only from account-session CSRF, not origin validation. Password guessing has both IP and persistent per-link throttling.
- Preview MIME is detected from file signatures. Only allowlisted raster/media/PDF contents stream inline; HTML/SVG are escaped text. PDF uses a same-origin local worker and canvas-only rendering. Strict CSP never enables unsafe-eval, external scripts or iframes. Decoder input/pixel/queue/cache bounds limit resource consumption; unsupported formats are downloads.
- Timed trash retention is disabled by default. Enabling/changing it requires explicit ADMIN confirmation, is audited, and uses recoverable purge staging. Backup failure/age alerts reflect actual script status, not a claimed backup schedule.

## Reporting

The dated review and verification results are in `SECURITY-AUDIT-2026-09-26.md`. Passing these checks is not a security certification or a guarantee that no further vulnerabilities exist.

Do not include passwords, cookies, tokens, database URLs or private filenames in a report. Rotate `SESSION_PEPPER`, `CSRF_SECRET` and the affected credentials after any suspected exposure; rotating the session pepper invalidates every active session.
