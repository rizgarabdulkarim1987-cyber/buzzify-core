/**
 * Writes a text's digits in the menu's numeral system: Arabic-Indic digits (٠-٩) for `arab`, as they are for `latn`.
 * For short labels such as a time ("19:00") or a percentage, where Intl's number formats do not fit, and the same on
 * the server and in the browser.
 */
export function localDigits(text: string, numerals: 'latn' | 'arab'): string {
  if (numerals === 'latn') return text;
  return text.replace(/[0-9]/g, (digit) => String.fromCharCode(0x0660 + Number(digit)));
}
