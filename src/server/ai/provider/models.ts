import type { AiPurpose } from './types';

/** Models by purpose: from the environment, with defaults. No sampling parameters and no forced tool choice are ever sent. */
const DEFAULTS: Record<AiPurpose, { env: string; model: string; effort: 'low' | 'medium' }> = {
  ask: { env: 'AI_MODEL_ASK', model: 'claude-opus-5-5', effort: 'medium' },
  extract: { env: 'AI_MODEL_EXTRACT', model: 'claude-opus-5-5', effort: 'medium' },
  phrase: { env: 'AI_MODEL_FAST', model: 'claude-haiku-5-5', effort: 'low' },
  classify: { env: 'AI_MODEL_FAST', model: 'claude-haiku-5-5', effort: 'low' },
};

export function modelFor(purpose: AiPurpose, env: Record<string, string | undefined> = process.env): string {
  const entry = DEFAULTS[purpose];
  return env[entry.env]?.trim() || entry.model;
}

export function effortFor(purpose: AiPurpose): 'low' | 'medium' {
  return DEFAULTS[purpose].effort;
}

export const AI_TIMEOUTS_MS: Record<AiPurpose, number> = { ask: 45_000, extract: 60_000, phrase: 20_000, classify: 30_000 };

export const MAX_TOKENS: Record<AiPurpose, number> = { ask: 4000, extract: 8000, phrase: 1200, classify: 3000 };

/** Opus and Sonnet go through the beta endpoint with the server-side refusal fallback; Haiku has none. */
export function usesFallback(model: string): boolean {
  return /opus|sonnet|fable/.test(model);
}
