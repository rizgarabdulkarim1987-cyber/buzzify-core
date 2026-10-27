/**
 * Keeping exported sheet cells as text (CSV formula injection). A cell that starts with `=`, `+`, `-` or `@` would be
 * read as a formula by a spreadsheet, and one that starts with a tab or carriage return is stripped to one by some of
 * them; an export writes such a cell with a leading quote, and an import takes exactly that quote off again, so a
 * file exported and imported again gives back the same text. Shared by the menu sheet and the pharmacy catalog.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

/** A cell an export writes, with a leading quote when the text would read as a formula. */
export function escapeCell(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** A cell as written, without the quote an export puts before a formula start. Any other leading quote is kept. */
export function unescapeCell(cell: string): string {
  return /^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;
}
