/**
 * The Erbil Citadel's skyline (CitadelBody): the colours of the dusk strip, which are the shape's own and the same on
 * every palette (a sunset sky behind a dark wall), and the pure rules for its windows. Each is unit-tested for contrast.
 */
export const SKY = {
  skyTop: '#24164A',
  skyMid: '#7A3550',
  skyLow: '#E98A4A',
  sun: '#F5C27A',
  wall: '#2F1B29',
  roof: '#2F1B29',
  /** A window with no light yet: a section still below. */
  darkPane: '#4A2C3A',
  darkInk: '#F1D9B8',
  /** A window lit: a section already passed. */
  litPane: '#F0A63C',
  litInk: '#2A1408',
  /** The window of the section in view. */
  activePane: '#FFE29A',
  activeInk: '#2A1408',
  /** The caption naming the section in view, in the sky. */
  caption: '#FBE9C8',
  /** A keyboard focus ring round a window, on the wall. */
  ring: '#FFF4DC',
} as const;

export type WindowState = 'dark' | 'lit' | 'active';

/** A window's light: the section in view is `active`, those before it `lit`, those after it `dark`; none known is all dark. */
export function windowState(index: number, activeIndex: number): WindowState {
  if (activeIndex < 0 || index > activeIndex) return 'dark';
  return index === activeIndex ? 'active' : 'lit';
}

/** How many house shapes the skyline cycles through. */
export const ROOFS = 8;

/** The roof of the house at `index`: a place in a cycle of eight (a flat parapet, a dome, a minaret, steps, …). */
export function roofOf(index: number): number {
  return ((index % ROOFS) + ROOFS) % ROOFS;
}
