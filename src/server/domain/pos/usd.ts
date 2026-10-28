/** Cash in US dollars: whole dollars, a whole-dinar rate, and the dinar change for any overpayment. Pure, so the till screen shares it. */

/** The whole dollars to take to cover `amount` dinars at `rate` dinars per dollar (rounded up); 0 when there is no rate. */
export function usdNeeded(amount: number, rate: number): number {
  return rate > 0 && amount > 0 ? Math.ceil(amount / rate) : 0;
}

/** The dinars to give back when `dollars` were handed over for `amount` dinars: never negative. */
export function usdChange(dollars: number, rate: number, amount: number): number {
  return Math.max(0, dollars * rate - amount);
}
