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
    hero: 'compact',
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

export const theElevator = definePreset({
  id: 'the-elevator',
  number: 34,
  name: 'The Elevator',
  business: 'restaurant',
  tags: ['light', 'playful'],
  seed: { bg: '#F2ECE1', text: '#2B2620', accent: '#A64B00', raised: '#E6DDCC' },
  alternatives: [
    { id: 'lobby-marble', name: 'Lobby marble', seed: { bg: '#F4F2EE', text: '#22252B', accent: '#8A5A12' } },
    { id: 'brass-night', name: 'Brass night', seed: { bg: '#1C1812', text: '#F1E8D6', accent: '#E8A33D' } },
    { id: 'steel-car', name: 'Steel car', seed: { bg: '#E9ECEF', text: '#1F2429', accent: '#B34A00' } },
  ],
  type: { fontPairId: 'modern', scale: 1.0 },
  layout: {
    body: 'elevator',
    hero: 'compact',
    nav: 'index',
    card: 'row',
    detail: 'sheet',
    options: 'list',
    imageRatio: 'square',
    density: 'comfortable',
    corners: 'soft',
    shadow: 'none',
    heading: 'plain',
  },
  scene: { mode: 'static' },
});

export const thePeriodicTable = definePreset({
  id: 'the-periodic-table',
  number: 35,
  name: 'Periodic Table of Food',
  business: 'restaurant',
  tags: ['light', 'playful'],
  seed: { bg: '#F6F4EE', text: '#181A1F', accent: '#1457B8', raised: '#FFFFFF' },
  alternatives: [
    { id: 'lab-night', name: 'Lab night', seed: { bg: '#12151C', text: '#EDEFF4', accent: '#6FA8FF' } },
    { id: 'chalk-lab', name: 'Chalk lab', seed: { bg: '#1D2B26', text: '#EEF3EC', accent: '#F2C14E' } },
    { id: 'blueprint', name: 'Blueprint', seed: { bg: '#EAF0F8', text: '#14213A', accent: '#C4410C' } },
  ],
  type: { fontPairId: 'modern', scale: 1.0 },
  layout: {
    body: 'periodic',
    hero: 'compact',
    nav: 'chips',
    card: 'photo',
    detail: 'sheet',
    options: 'chips',
    imageRatio: 'square',
    density: 'compact',
    corners: 'soft',
    shadow: 'none',
    heading: 'plain',
  },
  scene: { mode: 'static' },
});

export const STYLE_PRESETS = [theBook, theMagazine, tasteAirport, theElevator, thePeriodicTable];
