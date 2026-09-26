const PACKONE_HOSTS = new Set(['packone.pro', 'www.packone.pro']);
const NATIVE_SCHEME = 'packone:';
const NATIVE_PATHS = new Set([
  '/',
  '/account',
  '/career',
  '/draft-run',
  '/how-to',
  '/leaderboard',
  '/method',
  '/practice',
  '/profile',
  '/scoring',
  '/sets',
]);

function environmentFromSet(value: string | null) {
  if (value === 'powered-cube' || value === 'latest') return value;
  return 'mixed';
}

function directArticlePath(pathname: string) {
  const normalized = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
  if (normalized === '/how-it-works') return '/how-to';
  if (normalized === '/methodology') return '/method';
  if (normalized === '/scoring') return '/scoring';
  if (normalized === '/sets') return '/sets';
  return null;
}

function nativeDirectPath(pathname: string) {
  const normalized = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;
  return NATIVE_PATHS.has(normalized) ? normalized : null;
}

function parseIncomingPath(path: string) {
  if (path.startsWith('/')) {
    const url = new URL(path, 'https://packone.pro');
    return { pathname: url.pathname, searchParams: url.searchParams, search: url.search };
  }

  const url = new URL(path);
  if (url.protocol === NATIVE_SCHEME) {
    const hostPath = url.hostname ? `/${url.hostname}` : '';
    return {
      pathname: `${hostPath}${url.pathname || ''}` || '/',
      searchParams: url.searchParams,
      search: url.search,
    };
  }

  if ((url.protocol === 'https:' || url.protocol === 'http:') && PACKONE_HOSTS.has(url.hostname)) {
    return { pathname: url.pathname, searchParams: url.searchParams, search: url.search };
  }

  return null;
}

function safeNativeSearch(pathname: string, searchParams: URLSearchParams) {
  if (pathname === '/account') {
    const next = new URLSearchParams();
    const returnTo = searchParams.get('returnTo');
    if (returnTo === 'practice') next.set('returnTo', 'practice');
    const environment = environmentFromSet(searchParams.get('environment'));
    if (searchParams.has('environment')) next.set('environment', environment);
    return next.size ? `?${next.toString()}` : '';
  }

  if (pathname === '/draft-run') {
    const next = new URLSearchParams();
    const environment = environmentFromSet(searchParams.get('environment'));
    next.set('environment', environment);
    if (searchParams.get('mode') === 'practice') next.set('mode', 'practice');
    const shared = searchParams.get('shared') || searchParams.get('challenge');
    if (shared && /^[a-f0-9]{24}$/.test(shared)) next.set('shared', shared);
    const rawSets = searchParams.get('setIds');
    if (rawSets) {
      const safeSets = [...new Set(
        rawSets.split(',').map((value) => value.trim().toLowerCase()).filter((value) => /^[-a-z0-9]{2,40}$/.test(value)),
      )].sort();
      if (safeSets.length) next.set('setIds', safeSets.join(','));
    }
    return `?${next.toString()}`;
  }

  if (pathname === '/profile') {
    const key = searchParams.get('key');
    return key && /^[a-f0-9]{16}$/.test(key) ? `?key=${key}` : '';
  }

  if (pathname === '/leaderboard') {
    const next = new URLSearchParams();
    next.set('environment', environmentFromSet(searchParams.get('environment')));
    const requestedPeriod = searchParams.get('period');
    const canonicalPeriod = requestedPeriod === 'month' ? 'season' : requestedPeriod;
    next.set('period', ['daily', 'week', 'season', 'all'].includes(canonicalPeriod || '') ? canonicalPeriod! : 'daily');
    return `?${next.toString()}`;
  }

  // Never carry arbitrary query parameters onto native screens. In particular,
  // OAuth handoff material belongs to AuthSession, not router state.
  return '';
}

export function rewriteIncomingPath(path: string) {
  try {
    const parsed = parseIncomingPath(path);
    if (!parsed) return '/';

    const { pathname, searchParams } = parsed;
    const article = directArticlePath(pathname);
    if (article) return article;

    const direct = nativeDirectPath(pathname);
    if (direct && direct !== '/') return `${direct}${safeNativeSearch(direct, searchParams)}`;

    if (pathname !== '/') return '/';

    if (searchParams.get('account') === '1') return '/account';

    const publicProfile = searchParams.get('profile');
    if (publicProfile && /^[a-f0-9]{16}$/.test(publicProfile)) return `/profile?key=${publicProfile}`;

    if (searchParams.get('game') === 'draft-run') {
      const environment = environmentFromSet(searchParams.get('set'));

      if (searchParams.has('board')) {
        const requestedPeriod = searchParams.get('board');
        const canonicalPeriod = requestedPeriod === 'month' ? 'season' : requestedPeriod;
        const period = ['daily', 'week', 'season', 'all'].includes(canonicalPeriod || '')
          ? canonicalPeriod
          : 'daily';
        return `/leaderboard?environment=${environment}&period=${period}`;
      }

      if (searchParams.get('daily') === '1') {
        return `/draft-run?environment=${environment}`;
      }

      const shared = searchParams.get('shared') || searchParams.get('challenge');
      if (shared) return /^[a-f0-9]{24}$/.test(shared)
        ? `/draft-run?shared=${shared}`
        : '/';

      if (searchParams.get('custom') === '1') return '/practice';

      if (environment === 'powered-cube') {
        return '/draft-run?mode=practice&environment=powered-cube';
      }

      return '/practice';
    }

    return '/';
  } catch {
    return '/';
  }
}
