import { describe, expect, it } from 'vitest';
import { withKeepAlive } from '@/server/ai/keep-alive';

describe('keep-alive', () => {
  it('passes a fast answer through with its own status', async () => {
    const response = await withKeepAlive(async () => new Response('{"a":1}', { status: 403 }))();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ a: 1 });
  });

  it('streams a slow answer as JSON the client reads as before', async () => {
    const response = await withKeepAlive(() => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('{"data":{"ok":true}}')), 2_000)))();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { ok: true } });
  });

  it('answers with an error body when the work throws', async () => {
    const response = await withKeepAlive(() => new Promise<Response>((_, reject) => setTimeout(() => reject(new Error('x')), 2_000)))();
    expect((await response.json()).error.message).toBe('failed');
  });
});
