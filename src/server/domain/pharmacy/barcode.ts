/** Barcode text handling for the pharmacy: always text, never a number, so leading zeros survive. */

/** A scanner's or spreadsheet's text as the code: digits in Latin, surrounding whitespace (Enter, Tab) gone. */
export function normalizeScan(raw: string): string {
  return raw
    .replace(/[٠-٩۰-۹]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .trim();
}

/**
 * GS1 check digit (expects `normalizeScan`'d input) for EAN-8, EAN-13 and UPC-A (chosen by length). Any other length, or text with non-digits, is an
 * internal code: legal, so 'not-applicable' rather than invalid.
 */
export function checkDigitStatus(code: string): 'valid' | 'invalid' | 'not-applicable' {
  if (!/^\d+$/.test(code) || (code.length !== 8 && code.length !== 12 && code.length !== 13)) return 'not-applicable';
  let sum = 0;
  for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(code[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(code[code.length - 1]) ? 'valid' : 'invalid';
}

/**
 * True when the text shows a spreadsheet turned the code into a number: scientific notation (`1.23457E+12`), or, when
 * the caller knows the cell was numeric (`fromNumericCell`), a plain integer of 7 to 11 digits, which may have lost
 * leading zeros.
 */
export function looksNumericLossy(raw: string, fromNumericCell = false): boolean {
  const text = normalizeScan(raw);
  if (/^\d+(?:\.\d+)?e[+-]?\d+$/i.test(text)) return true;
  return fromNumericCell && /^\d{7,11}$/.test(text);
}
