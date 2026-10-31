/**
 * Keeping exported sheet cells as text (CSV formula injection). A cell that starts with `=`, `+`, `-` or `@` would be
 * read as a formula by a spreadsheet, and one that starts with a tab or carriage return is stripped to one by some of
 * them; an export writes such a cell with a leading quote, and an import takes exactly that quote off again, so a
 * file exported and imported again gives back the same text. Shared by the menu sheet and the pharmacy catalog.
 */

/**
 * What reads as a formula: `= + - @` (and their full-width lookalikes, which some importers fold to the plain ones), after any
 * leading white space (a space, a no-break space, an ideographic space, a line feed: some importers trim before they look); and a
 * cell that starts with a tab, carriage return or line feed on its own (stripped to a formula start by some of them).
 */
const FORMULA_START = /^(?:[\s 　]*[=+\-@＝＋－＠]|[\t\r\n])/;

/** A cell an export writes, with a leading quote when the text would read as a formula. */
export function escapeCell(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** A cell as written, without the quote an export puts before a formula start. Any other leading quote is kept. */
export function unescapeCell(cell: string): string {
  return cell.startsWith("'") && FORMULA_START.test(cell.slice(1)) ? cell.slice(1) : cell;
}
