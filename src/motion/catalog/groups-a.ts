import { color, group, model, PALETTE as P, range, choice, text, toggle } from './define';

/** 1–15: 3D motion graphics. */
export const THREE_D = group('three-d', 1, [
  ['product-rotation', 'webgl', 'time', { model: model('burger'), background: color(P.ink) }],
  ['product-spin-360', 'webgl', 'time', { model: model('cup'), background: color(P.ink), pause: range(0.8, 0, 3, 0.1) }],
  ['product-reveal-3d', 'webgl', 'time', { model: model('croissant'), background: color(P.ink), accent: color('#ffcf8a') }],
  ['product-assembly', 'webgl', 'time', { background: color(P.night), bounce: range(0.5, 0, 1, 0.05) }],
  ['product-disassembly', 'webgl', 'time', { background: color(P.night), spread: range(1, 0.4, 2, 0.1) }],
  ['floating-objects', 'webgl', 'time', { background: color(P.roast), count: range(6, 3, 12, 1) }],
  ['object-morphing', 'webgl', 'time', { color: color(P.gold), background: color(P.ink), shape: choice('ring', ['ring', 'drop', 'pill']) }],
  ['camera-flythrough', 'webgl', 'time', { background: color(P.night), fog: toggle(true) }],
  ['camera-orbit', 'webgl', 'time', { model: model('glass'), background: color(P.ink), height: range(0.5, 0, 1, 0.05) }],
  ['depth-animation', 'webgl', 'time', { background: color(P.roast), depth: range(1, 0.5, 2, 0.1) }],
  ['layered-parallax-3d', 'webgl', 'pointer', { color: color(P.gold), background: color(P.ink), depth: range(1, 0.5, 2, 0.1) }],
  ['object-explosion', 'webgl', 'time', { color: color(P.gold), background: color(P.ink), spread: range(1, 0.4, 2, 0.1) }],
  ['physics-simulation', 'webgl', 'time', { color: color(P.cherry), background: color(P.night), count: range(14, 4, 30, 1), bounce: range(0.45, 0, 0.9, 0.05) }],
  ['perspective-shift', 'webgl', 'time', { model: model('burger'), background: color(P.roast), intensity: range(0.6, 0.2, 1, 0.05) }],
  ['scene-transition-3d', 'webgl', 'progress', { background: color(P.roast), accent: color('#10202b') }],
]);

/** 16–30: scroll-based animations. */
export const SCROLL = group('scroll', 16, [
  ['scroll-scrub', 'dom', 'progress', { background: color(P.cream), accent: color(P.espresso) }],
  ['scroll-triggered', 'dom', 'progress', { background: color(P.cream), accent: color(P.espresso), count: range(5, 3, 8, 1) }],
  ['scroll-rotation-3d', 'webgl', 'progress', { model: model('croissant'), background: color(P.ink), turns: range(1, 0.5, 3, 0.5) }],
  ['scroll-product-reveal', 'dom', 'progress', { background: color(P.ink), accent: color(P.gold), shape: choice('arch', ['circle', 'arch', 'diamond']) }],
  ['scroll-storytelling', 'dom', 'progress', { background: color(P.roast), accent: color(P.gold) }],
  ['scroll-parallax', 'dom', 'progress', { background: color('#e9dcc5'), depth: range(1, 0.5, 2, 0.1) }],
  ['scroll-zoom', 'dom', 'progress', { background: color(P.cream), accent: color(P.espresso) }],
  ['scroll-depth-transition', 'dom', 'progress', { background: color(P.ink), count: range(6, 3, 10, 1), depth: range(1, 0.5, 2, 0.1) }],
  ['scroll-horizontal-gallery', 'dom', 'progress', { background: color(P.cream), accent: color(P.espresso), count: range(6, 4, 10, 1) }],
  ['scroll-image-sequence', 'canvas', 'progress', { background: color(P.ink), frames: range(48, 12, 96, 12) }],
  ['scroll-camera-movement', 'webgl', 'progress', { background: color(P.night) }],
  ['scroll-object-morphing', 'canvas', 'progress', { color: color(P.gold), background: color(P.ink), fill: toggle(false) }],
  ['scroll-synced-video', 'canvas', 'progress', { background: color(P.ink), accent: color(P.gold), grain: toggle(true) }],
  ['scroll-color-transition', 'dom', 'progress', { color: color('#f6e7c8'), accent: color('#1b1530') }],
  ['scroll-particles', 'canvas', 'progress', { text: text('Buzzify', 14, 'brand'), color: color(P.gold), background: color(P.ink) }],
]);

/** 31–45: luxury and cinematic motion. */
export const LUXURY = group('luxury', 31, [
  ['cinematic-cgi', 'webgl', 'time', { model: model('cup'), background: color('#050403'), letterbox: toggle(true) }],
  ['luxury-product-reveal', 'webgl', 'time', { model: model('glass'), background: color('#050403'), accent: color(P.gold) }],
  ['slow-motion', 'canvas', 'time', { color: color(P.espresso), background: color(P.cream), intensity: range(0.5, 0.1, 1, 0.05) }],
  ['golden-particles', 'canvas', 'time', { color: color(P.gold), background: color(P.ink), count: range(140, 40, 400, 20) }],
  ['metallic-reflection', 'dom', 'time', { metal: choice('gold', ['gold', 'silver', 'rose']), text: text('Buzzify', 14, 'brand'), background: color(P.ink) }],
  ['liquid-gold', 'webgl', 'time', { color: color(P.gold), intensity: range(0.5, 0.1, 1, 0.05) }],
  ['glass-reflection', 'dom', 'time', { color: color('#cfe6ff'), background: color(P.roast) }],
  ['holographic', 'dom', 'pointer', { text: text('Buzzify', 14, 'brand'), intensity: range(0.7, 0.2, 1, 0.05), background: color(P.ink) }],
  ['satin-silk', 'webgl', 'time', { color: color('#7a1f3d'), accent: color('#ffd7e2') }],
  ['cinematic-light-sweep', 'dom', 'time', { text: text('Fresh every morning', 32, 'headline'), color: color('#fff1d0'), background: color('#050403') }],
  ['soft-glow', 'dom', 'time', { color: color(P.amber), background: color(P.ink), size: range(1, 0.5, 1.6, 0.1) }],
  ['volumetric-lighting', 'webgl', 'time', { color: color('#ffd9a0'), background: color('#070605'), intensity: range(0.7, 0.2, 1, 0.05) }],
  ['lens-flare', 'canvas', 'pointer', { color: color('#ffb36b'), background: color('#070605'), intensity: range(0.7, 0.2, 1, 0.05) }],
  ['depth-of-field', 'dom', 'time', { background: color(P.roast), blur: range(6, 2, 14, 1) }],
  ['premium-logo-reveal', 'dom', 'time', { text: text('BUZZIFY', 14, 'brand'), color: color(P.gold), background: color('#050403') }],
]);

/** 46–60: food and beverage motion. */
export const FOOD = group('food', 46, [
  ['coffee-pouring', 'canvas', 'time', { color: color(P.espresso), background: color(P.cream) }],
  ['espresso-extraction', 'canvas', 'time', { color: color('#b5733a'), background: color(P.roast) }],
  ['coffee-beans-falling', 'canvas', 'time', { background: color(P.cream), count: range(28, 10, 60, 2) }],
  ['coffee-steam', 'canvas', 'time', { background: color(P.roast), intensity: range(0.6, 0.2, 1, 0.05) }],
  ['milk-splash', 'canvas', 'time', { color: color(P.milk), background: color(P.espresso) }],
  ['latte-art', 'canvas', 'time', { color: color('#a86b3c'), accent: color(P.milk), shape: choice('heart', ['heart', 'rosetta', 'tulip']) }],
  ['chocolate-dripping', 'canvas', 'time', { color: color(P.chocolate), background: color(P.cream) }],
  ['honey-flow', 'canvas', 'time', { color: color(P.honey), background: color(P.cream) }],
  ['ice-cream-melting', 'canvas', 'time', { color: color(P.rose), background: color('#bfe3dd') }],
  ['ice-cream-swirl', 'canvas', 'time', { color: color('#fbefd5'), accent: color('#d9a066'), background: color('#f6c8c0') }],
  ['burger-layer-assembly', 'webgl', 'time', { background: color(P.roast), bounce: range(0.5, 0, 1, 0.05) }],
  ['pizza-cheese-stretch', 'canvas', 'time', { background: color(P.roast), stretch: range(1, 0.5, 1.5, 0.05) }],
  ['ingredient-explosion', 'webgl', 'time', { background: color(P.night), spread: range(1, 0.4, 2, 0.1) }],
  ['beverage-splash', 'canvas', 'time', { color: color('#e9b44c'), background: color('#173a3a') }],
  ['food-levitation', 'webgl', 'time', { model: model('croissant'), background: color(P.cream), height: range(0.5, 0.1, 1, 0.05) }],
]);
