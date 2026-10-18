import type { MotionMeta, MotionParams, ParamSpec, ParamValue } from './types';

const HEX = /^#[0-9a-f]{6}$/i;

function resolveOne(spec: ParamSpec, value: unknown): ParamValue {
  switch (spec.type) {
    case 'color':
      return typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : spec.default;
    case 'range': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return spec.default;
      const clamped = Math.min(spec.max, Math.max(spec.min, value));
      const stepped = spec.min + Math.round((clamped - spec.min) / spec.step) * spec.step;
      // Round away the float noise of the step arithmetic (0.1 + 0.2), to the step's own decimals.
      const decimals = (String(spec.step).split('.')[1] ?? '').length;
      return Number(Math.min(spec.max, stepped).toFixed(decimals));
    }
    case 'toggle':
      return typeof value === 'boolean' ? value : spec.default;
    case 'choice':
      return typeof value === 'string' && spec.options.includes(value) ? value : spec.default;
    case 'text': {
      if (typeof value !== 'string' || value.trim() === '') return spec.default;
      return Array.from(value).slice(0, spec.maxLength).join('');
    }
  }
}

/**
 * Every parameter of a motion with a value it can draw: the given one when it is valid, clamped into range for numbers,
 * else the default. Keys the motion does not have are dropped, so a snippet edited by hand or a value saved for an
 * older version of a motion can never reach its code.
 */
export function resolveParams(meta: Pick<MotionMeta, 'params'>, given: Partial<MotionParams> = {}): MotionParams {
  const out: MotionParams = {};
  for (const [key, spec] of Object.entries(meta.params)) out[key] = resolveOne(spec, given[key]);
  return out;
}

/** The parameters whose values differ from the defaults: what a snippet has to say. */
export function changedParams(meta: Pick<MotionMeta, 'params'>, params: MotionParams): MotionParams {
  const resolved = resolveParams(meta, params);
  return Object.fromEntries(Object.entries(resolved).filter(([key, value]) => value !== meta.params[key]!.default));
}
