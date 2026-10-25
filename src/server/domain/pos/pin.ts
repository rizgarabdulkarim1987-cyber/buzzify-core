/** The quick sign-in PIN rules that need no database: its shape, which PINs are too weak, and the limits. Pure. */

export const PIN_LIMITS = {
  /** Consecutive wrong PINs before a staff member is locked. */
  staffFailures: 5,
  staffLockMs: 15 * 60_000,
  /** Failed attempts on one device, across everyone, inside the window before the device is refused. */
  deviceFailures: 20,
  deviceWindowMs: 15 * 60_000,
} as const;

/** Four to eight digits, ASCII only. */
export const PIN_PATTERN = /^\d{4,8}$/;

export function isPinShape(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/**
 * Too easy to guess: one digit repeated (0000), a run going up or down by one (1234, 98765), or a two-digit pair repeated
 * (1212, 121212). The input is assumed to have the right shape.
 */
export function isWeakPin(pin: string): boolean {
  const digits = [...pin].map(Number);
  if (digits.every((d) => d === digits[0])) return true;
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  if (pin.length % 2 === 0 && pin.length >= 4) {
    const pair = pin.slice(0, 2);
    if (pin === pair.repeat(pin.length / 2)) return true;
  }
  return false;
}

export const DEVICE_COOKIE = 'bz_device';
/** 400 days, the longest a browser keeps a cookie. */
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 3600;
