const ARABIC_INDIC = /[٠-٩]/g;
const PERSIAN = /[۰-۹]/g;

/**
 * A phone number as it is stored and compared: Arabic-Indic and Persian digits become ASCII, spaces, dashes, dots and
 * brackets are dropped, and a leading `+` is kept. Returns '' for anything that is not 7 to 15 digits after that.
 */
export function normalizePhone(raw: string): string {
  const ascii = raw
    .replace(ARABIC_INDIC, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(PERSIAN, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\s\-.()\u200e\u200f\u202a-\u202e]/g, '');
  return /^\+?\d{7,15}$/.test(ascii) ? ascii : '';
}
