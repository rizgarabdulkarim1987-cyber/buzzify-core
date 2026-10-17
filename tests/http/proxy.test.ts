import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { REQUEST_PATH_HEADER } from '@/server/http/request-path';
import { proxy } from '@/proxy';

/** The request headers the proxy hands on to the page, as Next encodes them on the proxy's response. */
function forwarded(response: Response): Record<string, string | null> {
  const names = (response.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean);
  return Object.fromEntries(names.map((name) => [name, response.headers.get(`x-middleware-request-${name}`)]));
}

describe('proxy', () => {
  it('hands the requested path on to the page, for the 404 page’s link back', () => {
    const response = proxy(new NextRequest('http://127.0.0.1:3100/atelier/en/p/does-not-exist?x=1'));
    expect(forwarded(response)[REQUEST_PATH_HEADER]).toBe('/atelier/en/p/does-not-exist');
  });

  it('replaces a path header the browser sent', () => {
    const response = proxy(
      new NextRequest('http://127.0.0.1:3100/atelier/en', { headers: { [REQUEST_PATH_HEADER]: '/other-menu/en' } }),
    );
    expect(forwarded(response)[REQUEST_PATH_HEADER]).toBe('/atelier/en');
  });

  it('keeps the request’s other headers', () => {
    const response = proxy(new NextRequest('http://127.0.0.1:3100/atelier/en', { headers: { 'accept-language': 'ar' } }));
    expect(forwarded(response)['accept-language']).toBe('ar');
  });
});
