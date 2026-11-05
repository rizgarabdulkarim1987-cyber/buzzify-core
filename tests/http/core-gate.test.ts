import { describe, expect, it } from 'vitest';
import { CORE_GATE_COOKIE, coreGateToken, hasCoreGate } from '@/server/http/core-gate';

const SECRET = 's'.repeat(32);

describe('core gate cookie', () => {
  it('is a fixed name that does not hint at what it opens', () => expect(CORE_GATE_COOKIE).toBe('__cg'));

  it('is the same token every time for the same path and secret', () =>
    expect(coreGateToken('path-one-123', SECRET)).toBe(coreGateToken('path-one-123', SECRET)));

  it('changes with the path and with the secret', () => {
    expect(coreGateToken('path-one-123', SECRET)).not.toBe(coreGateToken('path-two-456', SECRET));
    expect(coreGateToken('path-one-123', SECRET)).not.toBe(coreGateToken('path-one-123', 'o'.repeat(32)));
  });

  it('never contains the secret path', () => expect(coreGateToken('path-one-123', SECRET)).not.toContain('path-one-123'));

  it('accepts its own token and nothing else', () => {
    const token = coreGateToken('path-one-123', SECRET);
    expect(hasCoreGate(token, 'path-one-123', SECRET)).toBe(true);
    expect(hasCoreGate(undefined, 'path-one-123', SECRET)).toBe(false);
    expect(hasCoreGate('', 'path-one-123', SECRET)).toBe(false);
    expect(hasCoreGate(token.slice(1), 'path-one-123', SECRET)).toBe(false);
    expect(hasCoreGate(`${token}x`, 'path-one-123', SECRET)).toBe(false);
    expect(hasCoreGate(token, 'path-two-456', SECRET)).toBe(false);
  });
});
