const PACKONE_HOSTS = new Set(['packone.pro', 'www.packone.pro']);
const NATIVE_SCHEME = 'packone:';

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

export function rewriteIncomingPath(path: string) {
  try {
    const parsed = parseIncomingPath(path);
    if (!parsed) return path;

    const { pathname, searchParams, search } = parsed;
    const article = directArticlePath(pathname);
    if (article) return article;

    if (pathname !== '/' && pathname) {
      return `${pathname}${search}`;
    }

    if (searchParams.get('account') === '1') return '/account';

    if (searchParams.get('game') === 'draft-run') {
      const environment = environmentFromSet(searchParams.get('set'));

      if (searchParams.has('board')) {
        const requestedPeriod = searchParams.get('board');
        const period = ['daily', 'week', 'month', 'all'].includes(requestedPeriod || '')
          ? requestedPeriod
          : 'daily';
        return `/leaderboard?environment=${environment}&period=${period}`;
      }

      if (searchParams.get('daily') === '1') {
        return `/draft-run?environment=${environment}`;
      }

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
