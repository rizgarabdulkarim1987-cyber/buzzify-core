/**
 * The payable amount of a bill rounded to the restaurant's step (0 = off), half up, and the signed difference it made.
 * A bill of nothing (comped) is never rounded, and a real bill never rounds down to nothing: it pays at least one step.
 */
export function roundTo(total: number, step: number): { total: number; rounding: number } {
  if (step <= 0 || total <= 0) return { total, rounding: 0 };
  const rounded = Math.max(step, Math.floor((total + step / 2) / step) * step);
  return { total: rounded, rounding: rounded - total };
}
