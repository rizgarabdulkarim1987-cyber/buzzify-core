/**
 * The cashier's calculator (the prototype's "الآلة الحاسبة" panel), pure: a sum typed as text (`2000*5-500`) is read with the usual
 * order (brackets, then * and /, then + and -) and answered as a number, or null when it is not a whole sum yet or divides by zero.
 * Digits, a decimal point, + - * / ( ) and spaces only; Arabic-Indic and Persian digits and the × ÷ signs are read as their ASCII
 * twins. Never `eval`: nothing typed here is ever run as code, and the answer never touches the receipt.
 */

const MAX_LEN = 200;

const normalise = (text: string): string =>
  text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/٫/g, '.')
    .replace(/\s+/g, '');

export function evalCalc(input: string): number | null {
  const text = normalise(input);
  if (text === '' || text.length > MAX_LEN || !/^[0-9.+\-*/()]+$/.test(text)) return null;
  let at = 0;
  const peek = () => text[at];
  // expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)* ; factor := ('+'|'-') factor | number | '(' expr ')'
  const expr = (): number | null => {
    let left = term();
    while (left !== null && (peek() === '+' || peek() === '-')) {
      const op = text[at++];
      const right = term();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };
  const term = (): number | null => {
    let left = factor();
    while (left !== null && (peek() === '*' || peek() === '/')) {
      const op = text[at++];
      const right = factor();
      if (right === null) return null;
      if (op === '/' && right === 0) return null;
      left = op === '*' ? left * right : left / right;
    }
    return left;
  };
  const factor = (): number | null => {
    const c = peek();
    if (c === '+' || c === '-') {
      at += 1;
      const inner = factor();
      return inner === null ? null : c === '-' ? -inner : inner;
    }
    if (c === '(') {
      at += 1;
      const inner = expr();
      if (inner === null || peek() !== ')') return null;
      at += 1;
      return inner;
    }
    const match = /^(\d+(\.\d*)?|\.\d+)/.exec(text.slice(at));
    if (!match) return null;
    at += match[0].length;
    return Number(match[0]);
  };
  const value = expr();
  return value !== null && at === text.length && Number.isFinite(value) ? value : null;
}

/** The answer as the till shows money: grouped digits, at most two decimals (none for a whole number). */
export const formatCalc = (value: number): string => value.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** A key from the side keypad typed into the sum: a digit is added, C clears it. */
export const calcKey = (text: string, key: string): string => (key === 'C' ? '' : /^\d$/.test(key) ? (text + key).slice(0, MAX_LEN) : text);
