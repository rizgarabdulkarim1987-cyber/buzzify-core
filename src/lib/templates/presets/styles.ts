import { definePreset } from '../define';

/**
 * Menu styles, 31 to 33: templates whose first choice is how guests browse (`layout.body`), not only how it looks.
 * Each starts with the quiet static scene; the business can still switch to motion or 3D.
 */

export const theBook = definePreset({
  id: 'the-book',
  number: 31,
  name: 'The Book',
  business: 'restaurant',
  tags: ['light', 'minimal'],
  seed: { bg: '#F6F0E3', text: '#2A2420', accent: '#8A3B2B', raised: '#EAE0CC' },
  alternatives: [
    { id: 'vellum', name: 'Vellum', seed: { bg: '#FAF6EC', text: '#26221D', accent: '#3E5C76' } },
    { id: 'sepia', name: 'Sepia', seed: { bg: '#EBDDC3', text: '#33261A', accent: '#7A4A1F' } },
    { id: 'night-reading', name: 'Night reading', seed: { bg: '#1F1B17', text: '#EFE6D3', accent: '#D9A66A' } },
  ],
  type: { fontPairId: 'pearl', scale: 1.04 },
  layout: {
    body: 'book',
    hero: 'chapters',
    nav: 'chapters',
    card: 'row',
    detail: 'sheet',
    options: 'list',
    imageRatio: 'landscape',
    density: 'comfortable',
    corners: 'soft',
    shadow: 'none',
    heading: 'numbered',
  },
  scene: { mode: 'static' },
});

export const theMagazine = definePreset({
  id: 'the-magazine',
  number: 32,
  name: 'The Magazine',
  business: 'restaurant',
  tags: ['light', 'cinematic'],
  seed: { bg: '#FBF8F3', text: '#1B1B1B', accent: '#C0392B', raised: '#F0EAE0' },
  alternatives: [
    { id: 'cobalt-issue', name: 'Cobalt issue', seed: { bg: '#F7F8FB', text: '#16181F', accent: '#2B4DB5' } },
    { id: 'olive-issue', name: 'Olive issue', seed: { bg: '#F6F5EC', text: '#1E2118', accent: '#5B6B2E' } },
    { id: 'after-hours', name: 'After hours', seed: { bg: '#18181A', text: '#F5F1EA', accent: '#F0745F' } },
  ],
  type: { fontPairId: 'classic', scale: 1.02, tracking: -0.01 },
  layout: {
    body: 'magazine',
    hero: 'compact',
    nav: 'chips',
    card: 'photo',
    detail: 'sheet',
    options: 'chips',
    imageRatio: 'portrait',
    density: 'comfortable',
    corners: 'none',
    shadow: 'none',
    heading: 'rule',
  },
  scene: { mode: 'static' },
});

export const tasteAirport = definePreset({
  id: 'taste-airport',
  number: 33,
  name: 'Taste Airport',
  business: 'restaurant',
  tags: ['dark', 'cinematic'],
  seed: { bg: '#0E0E0E', text: '#F4F1E6', accent: '#FFC400', raised: '#1B1B1B' },
  alternatives: [
    { id: 'night-shift', name: 'Night shift', seed: { bg: '#101820', text: '#EEF2F5', accent: '#FFB81C' } },
    { id: 'terminal-green', name: 'Terminal green', seed: { bg: '#0B140F', text: '#E7F3EA', accent: '#FFD23F' } },
    { id: 'daylight', name: 'Daylight', seed: { bg: '#F4F1E6', text: '#141414', accent: '#9A6B00' } },
  ],
  type: { fontPairId: 'modern', displayCase: 'upper', tracking: 0.04 },
  layout: {
    body: 'board',
    hero: 'compact',
    nav: 'segmented',
    card: 'list',
    detail: 'sheet',
    options: 'tiles',
    imageRatio: 'square',
    density: 'compact',
    corners: 'none',
    shadow: 'none',
    heading: 'band',
  },
  scene: { mode: 'static' },
});

export const STYLE_PRESETS = [theBook, theMagazine, tasteAirport];
