/**
 * The colour a shape draws in the palette's accent where it must stand out on its own dark fill (a lit chip's ring, an
 * LED, a rail's fill): the accent lifted 55% towards white. It mirrors `--tpl-rise` in shared/name-chip.css
 * (`color-mix(in srgb, var(--accent) 45%, #fff)`), so a test can compute the contrast the CSS draws.
 */
export function riseOf(accent: string): string {
  const lifted = [1, 3, 5].map((at) => Math.round(parseInt(accent.slice(at, at + 2), 16) * 0.45 + 255 * 0.55));
  return `#${lifted.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
