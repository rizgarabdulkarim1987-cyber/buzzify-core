/** The dish a Magazine spread leads with: the first with a real photo, else the first; `rest` keeps menu order. */
export function splitLead<T extends { media: { kind: string }[] }>(products: T[]): { lead: T | undefined; rest: T[] } {
  const lead = products.find((product) => product.media[0]?.kind === 'image') ?? products[0];
  return { lead, rest: products.filter((product) => product !== lead) };
}
