import { config } from '@/src/config';
import { screenshotRequestJson } from '@/src/screenshots/fixtures';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  mobileSessionToken?: string | null;
  mobileAccountToken?: string | null;
  idempotencyKey?: string | null;
  timeoutMs?: number;
  credentials?: 'omit';
};

function errorMessage(body: unknown, status: number) {
  if (body && typeof body === 'object' && 'error' in body) {
    const value = (body as { error?: unknown }).error;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return `Pack One request failed (${status}).`;
}

export async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  if (config.screenshots.enabled) {
    return screenshotRequestJson<T>(path, { method, body: options.body });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const headers = new Headers({ accept: 'application/json' });
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.mobileSessionToken) headers.set('x-pack1-mobile-session', options.mobileSessionToken);
  if (options.mobileAccountToken) headers.set('x-pack1-mobile-account', options.mobileAccountToken);
  if (options.idempotencyKey) headers.set('x-idempotency-key', options.idempotencyKey);
  try {
    const response = await fetch(`${config.api.origin}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      ...(options.credentials ? { credentials: options.credentials } : {}),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(errorMessage(body, response.status), response.status, body);
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}
