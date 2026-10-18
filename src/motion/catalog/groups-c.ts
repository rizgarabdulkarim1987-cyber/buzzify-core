import { color, group, PALETTE as P, range, text } from './define';

/** Every transition plays between the same two pages: a light breakfast page and a dark dinner page. */
const PAGES = { background: color(P.cream), accent: color(P.roast) };

/** 121–135: page and scene transitions. */
export const TRANSITION = group('transition', 121, [
  ['cinematic-fade-transition', 'dom', 'progress', PAGES],
  ['liquid-wipe-transition', 'dom', 'progress', PAGES],
  ['morphing-page-transition', 'dom', 'progress', PAGES],
  ['cube-3d-transition', 'dom', 'progress', PAGES],
  ['depth-zoom-transition', 'dom', 'progress', PAGES],
  ['mask-reveal-transition', 'dom', 'progress', PAGES],
  ['circular-reveal-transition', 'dom', 'progress', PAGES],
  ['card-stack-transition', 'dom', 'progress', PAGES],
  ['horizontal-slide-transition', 'dom', 'progress', PAGES],
  ['vertical-slide-transition', 'dom', 'progress', PAGES],
  ['blur-dissolve-transition', 'dom', 'progress', PAGES],
  ['camera-push-transition', 'dom', 'progress', PAGES],
  ['perspective-flip-transition', 'dom', 'progress', PAGES],
  ['seamless-scene-transition', 'dom', 'progress', PAGES],
  ['shared-element-transition', 'dom', 'progress', PAGES],
]);

/** 136–150: advanced visual effects. */
export const EFFECTS = group('effects', 136, [
  ['particle-dissolve', 'canvas', 'time', { text: text('Buzzify', 14, 'brand'), color: color(P.gold), background: color(P.ink) }],
  ['fluid-simulation', 'canvas', 'pointer', { color: color(P.honey), accent: color(P.berry), background: color('#07060a') }],
  ['smoke-simulation', 'canvas', 'time', { color: color('#e8e2d8'), background: color(P.night) }],
  ['fire-simulation', 'canvas', 'time', { background: color('#080504'), intensity: range(0.7, 0.3, 1, 0.05) }],
  ['water-ripple-simulation', 'canvas', 'pointer', { color: color(P.teal), intensity: range(0.6, 0.2, 1, 0.05) }],
  ['cloth-simulation', 'canvas', 'pointer', { color: color(P.berry), background: color(P.cream), wind: range(0.5, 0, 1, 0.05) }],
  ['soft-body-simulation', 'canvas', 'time', { color: color('#e2445c'), background: color(P.cream) }],
  ['rigid-body-simulation', 'canvas', 'time', { background: color(P.cream), count: range(14, 4, 28, 1) }],
  ['procedural-noise-distortion', 'webgl', 'time', { color: color(P.gold), intensity: range(0.5, 0.1, 1, 0.05) }],
  ['motion-blur-trails', 'canvas', 'time', { color: color(P.amber), background: color(P.night), count: range(5, 2, 10, 1) }],
  ['chromatic-aberration', 'dom', 'time', { text: text('Buzzify', 14, 'brand'), background: color(P.ink), intensity: range(0.6, 0.2, 1, 0.05) }],
  ['refraction-distortion', 'webgl', 'pointer', { color: color(P.amber), accent: color(P.berry), background: color(P.night) }],
  ['caustic-light', 'webgl', 'time', { color: color('#9fe3ff'), background: color('#06324a') }],
  ['glass-shatter', 'canvas', 'time', { color: color(P.gold), background: color(P.ink) }],
  ['physics-particle-interaction', 'canvas', 'pointer', { text: text('Buzzify', 14, 'brand'), color: color(P.gold), background: color(P.ink) }],
]);
