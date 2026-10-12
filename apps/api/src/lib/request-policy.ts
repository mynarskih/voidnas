// Browser-origin checks complement session-bound CSRF, including login/setup.
export function allowedMutationOrigin(origin: unknown, site: unknown, host: string | undefined, secure: boolean) {
  if (site === 'cross-site') return false;
  if (origin === undefined) return true; // CLI clients still need session CSRF.
  if (typeof origin !== 'string' || !host) return false;
  try {
    const url = new URL(origin);
    return !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
      && url.host.toLowerCase() === host.toLowerCase()
      && (secure ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol));
  } catch { return false; }
}
