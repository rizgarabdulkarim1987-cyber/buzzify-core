import { definePreset } from '../define';

/** Bakery and pastry shop presets, 19 to 25 of the brief. */

export const parisMaison = definePreset({
  id: 'paris-maison',
  number: 19,
  name: 'Paris Maison',
  business: 'bakery',
  tags: ['light', 'minimal'],
  seed: { bg: '#F5EBDC', text: '#49342C', accent: '#9E5F63', raised: '#EED9D3' },
  alternatives: [
    { id: 'macaron', name: 'Macaron', seed: { bg: '#F8EEEA', text: '#4A2F33', accent: '#A65D6A' } },
    { id: 'pistache', name: 'Pistache', seed: { bg: '#F2F0E2', text: '#3B3A2C', accent: '#6E7D4C' } },
    { id: 'salon-noir', name: 'Salon noir', seed: { bg: '#2B1F1B', text: '#F5EBDC', accent: '#D5ACAC' } },
  ],
  type: { fontPairId: 'bakery', scale: 1.04 },
  layout: {
    hero: 'collection',
    nav: 'tiles',
    card: 'cake',
    detail: 'sheet',
    options: 'tiles',
    imageRatio: 'portrait',
    density: 'comfortable',
    corners: 'soft',
    shadow: 'soft',
    heading: 'script',
    body: 'scroll',
  },
});

export const butterAndFold = definePreset({
  id: 'butter-and-fold',
  number: 20,
  name: 'Butter & Fold',
  business: 'bakery',
  tags: ['light', 'playful'],
  seed: { bg: '#FAF5E9', text: '#3F2E22', accent: '#674D3C', raised: '#F3E4B8' },
  alternatives: [
    { id: 'golden-crust', name: 'Golden crust', seed: { bg: '#F6EBCF', text: '#3F2E22', accent: '#7A5A3F' } },
    { id: 'rye', name: 'Rye', seed: { bg: '#2C231C', text: '#F7EEDC', accent: '#E8CE86' } },
    { id: 'flour', name: 'Flour', seed: { bg: '#FCFBF7', text: '#3A2D24', accent: '#8B6542' } },
  ],
  type: { fontPairId: 'botanical', scale: 1.02 },
  layout: {
    hero: 'daily',
    nav: 'pills',
    card: 'list',
    detail: 'sheet',
    options: 'chips',
    imageRatio: 'square',
    density: 'comfortable',
    corners: 'round',
    shadow: 'none',
    heading: 'band',
    body: 'scroll',
  },
});

export const rosePatisserie = definePreset({
  id: 'rose-patisserie',
  number: 21,
  name: 'Rose Patisserie',
  business: 'bakery',
  tags: ['light', 'playful'],
  seed: { bg: '#FFF5EE', text: '#684454', accent: '#C98E9C' },
  alternatives: [
    { id: 'plum-velvet', name: 'Plum velvet', seed: { bg: '#3A2530', text: '#FBEFF0', accent: '#E3A9B6' } },
    { id: 'peony', name: 'Peony', seed: { bg: '#FCEFF1', text: '#5A3343', accent: '#C2788A' } },
    { id: 'champagne-rose', name: 'Champagne rose', seed: { bg: '#F8F1E7', text: '#5B4249', accent: '#C79A8A' } },
  ],
  type: { fontPairId: 'rose', scale: 1.06, tracking: 0.02 },
  layout: {
    hero: 'arch',
    nav: 'underline',
    card: 'cake',
    detail: 'drawer',
    options: 'tiles',
    imageRatio: 'portrait',
    density: 'airy',
    corners: 'pill',
    shadow: 'soft',
    heading: 'script',
    body: 'scroll',
  },
  scene: { intensity: 0.5 },
});

export const cocoaAtelier = definePreset({
  id: 'cocoa-atelier',
  number: 22,
  name: 'Cocoa Atelier',
  business: 'bakery',
  tags: ['dark', 'cinematic'],
  seed: { bg: '#38241F', text: '#F0E1CB', accent: '#AC8059' },
  alternatives: [
    { id: 'ganache', name: 'Ganache', seed: { bg: '#241613', text: '#F3E5CF', accent: '#C4956B' } },
    { id: 'vanilla-bean', name: 'Vanilla bean', seed: { bg: '#F0E1CB', text: '#38241F', accent: '#7E5636' } },
    { id: 'praline', name: 'Praline', seed: { bg: '#4A3026', text: '#F5E9D6', accent: '#D2A57A' } },
  ],
  type: { fontPairId: 'cocoa', scale: 1.04 },
  layout: {
    hero: 'editorial',
    nav: 'pills',
    card: 'gallery',
    detail: 'drawer',
    options: 'tiles',
    imageRatio: 'square',
    density: 'comfortable',
    corners: 'soft',
    shadow: 'lifted',
    heading: 'ornament',
    body: 'scroll',
  },
});

export const artisanCrust = definePreset({
  id: 'artisan-crust',
  number: 23,
  name: 'Artisan Crust',
  business: 'bakery',
  tags: ['light', 'minimal'],
  seed: { bg: '#F1E9DB', text: '#37342E', accent: '#8A6A3B', raised: '#E9DCC1' },
  alternatives: [
    { id: 'stone-mill', name: 'Stone mill', seed: { bg: '#E9E5DC', text: '#2F2D29', accent: '#6F5A3A' } },
    { id: 'night-bake', name: 'Night bake', seed: { bg: '#26231F', text: '#F1E9DB', accent: '#CFB185' } },
    { id: 'rye-field', name: 'Rye field', seed: { bg: '#F3E7D0', text: '#3A3128', accent: '#97692F' } },
  ],
  type: { fontPairId: 'pearl', scale: 1.0 },
  layout: {
    hero: 'pedestal',
    nav: 'underline',
    card: 'list',
    detail: 'sheet',
    options: 'list',
    imageRatio: 'landscape',
    density: 'comfortable',
    corners: 'none',
    shadow: 'none',
    heading: 'rule',
    body: 'scroll',
  },
  scene: { mode: 'motion', intensity: 0.45 },
});

export const pistachioBoutique = definePreset({
  id: 'pistachio-boutique',
  number: 24,
  name: 'Pistachio Boutique',
  business: 'bakery',
  tags: ['light', 'playful'],
  seed: { bg: '#F6F0DF', text: '#3A2A30', accent: '#754454', raised: '#E4E8D2' },
  alternatives: [
    { id: 'pistachio-cream', name: 'Pistachio cream', seed: { bg: '#EEF0DD', text: '#33362A', accent: '#5F7344' } },
    { id: 'berry-night', name: 'Berry night', seed: { bg: '#2E1D23', text: '#F6F0DF', accent: '#C7D3AE' } },
    { id: 'nougat', name: 'Nougat', seed: { bg: '#F5EEE4', text: '#3D2C2A', accent: '#8C4F5E' } },
  ],
  type: { fontPairId: 'riviera', scale: 1.02 },
  layout: {
    hero: 'asymmetric',
    nav: 'pills',
    card: 'gallery',
    detail: 'card',
    options: 'tiles',
    imageRatio: 'square',
    density: 'comfortable',
    corners: 'round',
    shadow: 'soft',
    heading: 'ornament',
    body: 'scroll',
  },
});

export const celebrationHouse = definePreset({
  id: 'celebration-house',
  number: 25,
  name: 'Celebration House',
  business: 'bakery',
  tags: ['light', 'cinematic'],
  seed: { bg: '#F7EFE9', text: '#4A3A48', accent: '#A986A5', raised: '#EFE3D2' },
  alternatives: [
    { id: 'champagne', name: 'Champagne', seed: { bg: '#F6EFE3', text: '#433829', accent: '#9C7F4E' } },
    { id: 'midnight-gala', name: 'Midnight gala', seed: { bg: '#211A24', text: '#F6EEF0', accent: '#C9AE84' } },
    { id: 'lilac-ribbon', name: 'Lilac ribbon', seed: { bg: '#F4EEF5', text: '#3F3045', accent: '#8E6A8C' } },
  ],
  type: { fontPairId: 'rose', scale: 1.06, tracking: 0.02 },
  layout: {
    hero: 'occasion',
    nav: 'tiles',
    card: 'cake',
    detail: 'page',
    options: 'tiles',
    imageRatio: 'portrait',
    density: 'airy',
    corners: 'soft',
    shadow: 'soft',
    heading: 'script',
    body: 'scroll',
  },
});

export const BAKERY_PRESETS = [parisMaison, butterAndFold, rosePatisserie, cocoaAtelier, artisanCrust, pistachioBoutique, celebrationHouse];
