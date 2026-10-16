import { vi } from 'vitest';
import { cookies, headers } from 'next/headers';

interface CookieOptions {
  maxAge?: number;
  expires?: Date;
}

/**
 * A browser for tests of Server Actions: a cookie jar that stands in for Next's `cookies()` and `headers()`. A test file
 * mocks the module first (`vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }))`); `activate()` then
 * makes the mocks answer for this browser, so Better Auth's `nextCookies()` plugin writes the session and two-factor
 * cookies into the jar the way it writes them into a response, and the next action reads them back from the request.
 */
export class Browser {
  /** Cookie values as the application set them (decoded); they are encoded again on the way out, as a browser sends them. */
  readonly jar = new Map<string, string>();

  constructor(
    public ip = '198.51.100.7',
    public userAgent = 'Mozilla/5.0 (vitest browser)',
  ) {}

  /** The headers of the next request this browser makes. */
  requestHeaders(): Headers {
    const sent = new Headers({ 'x-forwarded-for': this.ip, 'user-agent': this.userAgent });
    const cookie = [...this.jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
    if (cookie) sent.set('cookie', cookie);
    return sent;
  }

  /** Makes `headers()` and `cookies()` answer for this browser. Call it before an action when several browsers take turns. */
  activate(): this {
    vi.mocked(headers).mockImplementation(async () => this.requestHeaders() as never);
    vi.mocked(cookies).mockImplementation(
      async () =>
        ({
          set: (name: string, value: string, options: CookieOptions = {}) => this.store(name, value, options),
          get: (name: string) => (this.jar.has(name) ? { name, value: this.jar.get(name) } : undefined),
        }) as never,
    );
    return this;
  }

  has(name: string): boolean {
    return this.jar.has(name);
  }

  /** A cleared cookie (empty value, `Max-Age=0` or a past expiry) leaves the jar, as it leaves a real one. */
  private store(name: string, value: string, options: CookieOptions): void {
    const gone = value === '' || options.maxAge === 0 || (options.expires !== undefined && options.expires.getTime() <= Date.now());
    if (gone) this.jar.delete(name);
    else this.jar.set(name, value);
  }
}

export const SESSION_COOKIE = 'studio.session_token';
export const CHALLENGE_COOKIE = 'studio.two_factor';
