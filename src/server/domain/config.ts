export interface EngineWeights {
  rulePriority: number;
  margin: number;
  popularity: number;
  priority: number;
  daypart: number;
  stockPenalty: number;
}

export interface EngineConfig {
  upsellMaxOffers: number;
  upsellDeltaCapRatio: number;
  pairingMaxOffers: number;
  cartPairingMaxOffers: number;
  weights: EngineWeights;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  upsellMaxOffers: 3,
  upsellDeltaCapRatio: 0.75,
  pairingMaxOffers: 3,
  cartPairingMaxOffers: 2,
  weights: { rulePriority: 0.45, margin: 0.25, popularity: 0.2, priority: 0.1, daypart: 0.2, stockPenalty: 0.15 },
};

function num(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(max, Math.max(min, value));
  return integer ? Math.round(clamped) : clamped;
}

export function resolveEngineConfig(raw: unknown): EngineConfig {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const weights = (typeof source.weights === 'object' && source.weights !== null ? source.weights : {}) as Record<string, unknown>;
  const d = DEFAULT_ENGINE_CONFIG;
  return {
    upsellMaxOffers: num(source.upsellMaxOffers, d.upsellMaxOffers, 1, 10, true),
    upsellDeltaCapRatio: num(source.upsellDeltaCapRatio, d.upsellDeltaCapRatio, 0.05, 5),
    pairingMaxOffers: num(source.pairingMaxOffers, d.pairingMaxOffers, 1, 10, true),
    cartPairingMaxOffers: num(source.cartPairingMaxOffers, d.cartPairingMaxOffers, 1, 10, true),
    weights: {
      rulePriority: num(weights.rulePriority, d.weights.rulePriority, 0, 1),
      margin: num(weights.margin, d.weights.margin, 0, 1),
      popularity: num(weights.popularity, d.weights.popularity, 0, 1),
      priority: num(weights.priority, d.weights.priority, 0, 1),
      daypart: num(weights.daypart, d.weights.daypart, 0, 1),
      stockPenalty: num(weights.stockPenalty, d.weights.stockPenalty, 0, 1),
    },
  };
}
