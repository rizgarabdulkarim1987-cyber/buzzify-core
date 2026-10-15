import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_CONFIG, resolveEngineConfig } from '@/server/domain/config';

describe('resolveEngineConfig', () => {
  it('returns defaults for empty or invalid input', () => {
    expect(resolveEngineConfig({})).toEqual(DEFAULT_ENGINE_CONFIG);
    expect(resolveEngineConfig(null)).toEqual(DEFAULT_ENGINE_CONFIG);
    expect(resolveEngineConfig('nope')).toEqual(DEFAULT_ENGINE_CONFIG);
  });

  it('merges valid overrides', () => {
    const config = resolveEngineConfig({ upsellMaxOffers: 2, weights: { margin: 0.5 } });
    expect(config.upsellMaxOffers).toBe(2);
    expect(config.weights.margin).toBe(0.5);
    expect(config.weights.popularity).toBe(DEFAULT_ENGINE_CONFIG.weights.popularity);
  });

  it('clamps out-of-range and ignores non-numeric values', () => {
    const config = resolveEngineConfig({ upsellMaxOffers: 99, upsellDeltaCapRatio: -1, weights: { margin: 'high', popularity: 7 } });
    expect(config.upsellMaxOffers).toBe(10);
    expect(config.upsellDeltaCapRatio).toBe(0.05);
    expect(config.weights.margin).toBe(DEFAULT_ENGINE_CONFIG.weights.margin);
    expect(config.weights.popularity).toBe(1);
  });
});
