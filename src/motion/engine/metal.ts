/** Metal finishes as gradient stops: deep shadow, body, highlight, warm edge. */
export const METALS: Record<string, readonly [shadow: string, body: string, highlight: string, edge: string]> = {
  gold: ['#6d4c12', '#cf9f45', '#fff2c6', '#a87822'],
  silver: ['#4f5257', '#c3c7ce', '#ffffff', '#8d9199'],
  rose: ['#6e3f36', '#d79d8b', '#ffe8de', '#b0705f'],
};

export const metal = (name: string) => METALS[name] ?? METALS.gold!;

/** A brushed metal surface: the finish's gradient under fine horizontal grain. */
export function brushed(name: string): string {
  const [shadow, body, highlight, edge] = metal(name);
  return [
    'repeating-linear-gradient(0deg, rgb(255 255 255 / 0.06) 0 1px, transparent 1px 3px)',
    'repeating-linear-gradient(0deg, rgb(0 0 0 / 0.05) 0 1px, transparent 1px 5px)',
    `linear-gradient(160deg, ${edge} 0%, ${body} 22%, ${highlight} 46%, ${body} 62%, ${shadow} 100%)`,
  ].join(', ');
}
