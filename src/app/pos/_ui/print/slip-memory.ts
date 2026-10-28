const SLIPS_KEY = 'pos.printedCancelSlips';

/** Cancellation slips this device already printed (kept in the browser; a cleared browser at worst prints one again). */
export function printedSlips(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SLIPS_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function rememberSlip(printed: Set<string>, key: string): void {
  printed.add(key);
  try {
    localStorage.setItem(SLIPS_KEY, JSON.stringify([...printed].slice(-200)));
  } catch {
    // Private mode or a full store: the slip may print again later, which is safe.
  }
}
