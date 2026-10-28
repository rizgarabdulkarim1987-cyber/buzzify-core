/** A scanner types like a very fast keyboard: characters under 40 ms apart, then Enter. A person never does. */
const MAX_GAP_MS = 40;
const MIN_LENGTH = 4;

export interface ScanKey {
  key: string;
  /** The key went to a text field or a select: the cashier is typing, not scanning. */
  targetIsField: boolean;
}

/** Feeds key presses in; calls `onScan` with the code of each burst that ended with Enter. Text stays text, so leading zeros survive. */
export function createScanner(onScan: (code: string) => void, now: () => number = Date.now): { key(event: ScanKey): boolean } {
  let buffer = '';
  let last: number | null = null;
  return {
    /** True when the key belongs to a scan in progress (so the page must not also act on it: Enter would press the focused button). */
    key(event) {
      const at = now();
      if (event.targetIsField) {
        buffer = '';
        last = null;
        return false;
      }
      if (event.key === 'Enter') {
        const code = buffer;
        buffer = '';
        last = null;
        if (code.length < MIN_LENGTH) return false;
        onScan(code);
        return true;
      }
      if (event.key.length !== 1) return false;
      const inBurst = last !== null && at - last <= MAX_GAP_MS;
      if (!inBurst) buffer = '';
      buffer += event.key;
      last = at;
      return inBurst;
    },
  };
}

/** The product whose barcode is exactly this code (no trimming of zeros), else null. */
export function productByBarcode(products: readonly { id: string; barcode: string | null }[], code: string): string | null {
  return products.find((product) => product.barcode !== null && product.barcode === code)?.id ?? null;
}
