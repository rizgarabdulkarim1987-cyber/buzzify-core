import { definePreset } from '../define';

/** Ice cream and gelato presets, 26 to 30 of the brief. */

export const gelatoRiviera = definePreset({
  id: 'gelato-riviera',
  number: 26,
  name: 'Gelato Riviera',
  business: 'icecream',
  tags: ['light', 'playful'],
  seed: { bg: '#FFF3DF', text: '#3A2E2A', accent: '#65A7A5', raised: '#F6DCCB' },
  alternatives: [
    { id: 'pesca', name: 'Pesca', seed: { bg: '#FCEDE4', text: '#4A2E26', accent: '#D27F5F' } },
    { id: 'laguna', name: 'Laguna', seed: { bg: '#EAF4F2', text: '#1F3634', accent: '#3F8B88' } },
    { id: 'sera', name: 'Sera', seed: { bg: '#1E2B2C', text: '#FFF3DF', accent: '#EAB29A' } },
  ],
  type: { fontPairId: 'riviera', scale: 1.04 },
  layout: {
    hero: 'flavorWall',
    nav: 'pills',
    card: 'flavor',
    detail: 'sheet',
    options: 'tiles',
    imageRatio: 'circle',
    density: 'comfortable',
    corners: 'pill',
    shadow: 'soft',
    heading: 'script',
    body: 'scroll',
  },
});

export const sorbetGarden = definePreset({
  id: 'sorbet-garden',
  number: 27,
  name: 'Sorbet Garden',
  business: 'icecream',
  tags: ['light', 'playful'],
  seed: { bg: '#FBF6F0', text: '#3D2A30', accent: '#C85F78', raised: '#E6EFE2' },
  alternatives: [
    { id: 'mango', name: 'Mango', seed: { bg: '#FFF6E6', text: '#43301E', accent: '#C47F1E' } },
    { id: 'mint-leaf', name: 'Mint leaf', seed: { bg: '#F0F6EF', text: '#25362A', accent: '#4F8A5C' } },
    { id: 'berry-dusk', name: 'Berry dusk', seed: { bg: '#2A1A22', text: '#FFF1F3', accent: '#F08AA2' } },
  ],
  type: { fontPairId: 'gelato', scale: 1.04 },
  layout: {
    hero: 'asymmetric',
    nav: 'chips',
    card: 'flavor',
    detail: 'sheet',
    options: 'tiles',
    imageRatio: 'square',
    density: 'comfortable',
    corners: 'round',
    shadow: 'none',
    heading: 'band',
    body: 'scroll',
  },
});

export const vanillaCloud = definePreset({
  id: 'vanilla-cloud',
  number: 28,
  name: 'Vanilla Cloud',
  business: 'icecream',
  tags: ['light', 'minimal'],
  seed: { bg: '#F7EDD9', text: '#4A3B2E', accent: '#B78C65', raised: '#E3ECF0' },
  alternatives: [
    { id: 'sky', name: 'Sky', seed: { bg: '#EEF4F8', text: '#2E3A44', accent: '#5F86A3' } },
    { id: 'caramel', name: 'Caramel', seed: { bg: '#F5E8D6', text: '#45331F', accent: '#9C6B3F' } },
    { id: 'twilight', name: 'Twilight', seed: { bg: '#26303A', text: '#F7EDD9', accent: '#E1C29F' } },
  ],
  type: { fontPairId: 'cloud', scale: 1.04 },
  layout: {
    hero: 'compact',
    nav: 'pills',
    card: 'photo',
    detail: 'steps',
    options: 'tiles',
    imageRatio: 'landscape',
    density: 'airy',
    corners: 'pill',
    shadow: 'soft',
    heading: 'plain',
    body: 'scroll',
  },
  scene: { intensity: 0.5, speed: 0.8 },
});

export const popGelato = definePreset({
  id: 'pop-gelato',
  number: 29,
  name: 'Pop Gelato',
  business: 'icecream',
  tags: ['light', 'playful'],
  seed: { bg: '#FFF0D8', text: '#1E2A55', accent: '#4163B8', button: '#EB8077', onButton: '#1E2A55', raised: '#FFE0D6' },
  alternatives: [
    { id: 'coral', name: 'Coral', seed: { bg: '#FFE9E2', text: '#3A1F1B', accent: '#C64E43' } },
    { id: 'cobalt-night', name: 'Cobalt night', seed: { bg: '#14214A', text: '#FFF0D8', accent: '#EB8077' } },
    { id: 'lemon-pop', name: 'Lemon pop', seed: { bg: '#FFF7C9', text: '#262315', accent: '#3459B0' } },
  ],
  type: { fontPairId: 'pop', scale: 1.06, tracking: -0.02 },
  layout: {
    hero: 'carousel',
    nav: 'dock',
    card: 'oversized',
    detail: 'card',
    options: 'tiles',
    imageRatio: 'square',
    density: 'comfortable',
    corners: 'round',
    shadow: 'lifted',
    heading: 'band',
    body: 'scroll',
  },
  scene: { intensity: 0.6 },
});

export const frozenJewel = definePreset({
  id: 'frozen-jewel',
  number: 30,
  name: 'Frozen Jewel',
  business: 'icecream',
  tags: ['dark', 'cinematic'],
  seed: { bg: '#412D4D', text: '#F5EDF4', accent: '#BAA4D1' },
  alternatives: [
    { id: 'amethyst', name: 'Amethyst', seed: { bg: '#2A1C33', text: '#F6EEF7', accent: '#C9B3E0' } },
    { id: 'pearl-salon', name: 'Pearl salon', seed: { bg: '#F5EDF4', text: '#412D4D', accent: '#7A5C93' } },
    { id: 'sapphire', name: 'Sapphire', seed: { bg: '#1D2442', text: '#EEF0F8', accent: '#A9B8E6' } },
  ],
  type: { fontPairId: 'palace', scale: 1.02, displayCase: 'upper', tracking: 0.08 },
  layout: {
    hero: 'editorial',
    nav: 'index',
    card: 'photo',
    detail: 'drawer',
    options: 'tiles',
    imageRatio: 'portrait',
    density: 'airy',
    corners: 'soft',
    shadow: 'lifted',
    heading: 'outline',
    body: 'scroll',
  },
});

export const ICECREAM_PRESETS = [gelatoRiviera, sorbetGarden, vanillaCloud, popGelato, frozenJewel];
