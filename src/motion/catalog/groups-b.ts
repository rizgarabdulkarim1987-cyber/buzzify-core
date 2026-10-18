import { choice, color, font, group, model, PALETTE as P, range, text, toggle } from './define';

/** 61–75: interactive animations. */
export const INTERACTIVE = group('interactive', 61, [
  ['hover-scale', 'dom', 'pointer', { accent: color(P.gold), background: color(P.cream), scale: range(1.06, 1.02, 1.2, 0.01) }],
  ['hover-3d-tilt', 'dom', 'pointer', { background: color(P.night), tilt: range(14, 4, 30, 1), glare: toggle(true) }],
  ['interactive-product-rotation', 'webgl', 'pointer', { model: model('burger'), background: color(P.ink) }],
  ['cursor-follow', 'dom', 'pointer', { color: color(P.amber), background: color(P.night), size: range(1, 0.5, 2, 0.1) }],
  ['magnetic-button', 'dom', 'pointer', { accent: color(P.amber), background: color(P.night), intensity: range(0.5, 0.1, 1, 0.05), text: text('Order now', 18, 'action') }],
  ['interactive-product-zoom', 'dom', 'pointer', { background: color(P.cream), zoom: range(2.2, 1.5, 4, 0.1) }],
  ['click-to-expand', 'dom', 'pointer', { accent: color(P.espresso), background: color(P.cream) }],
  ['interactive-ingredient-reveal', 'dom', 'pointer', { accent: color(P.amber), background: color(P.night) }],
  ['interactive-3d-menu', 'dom', 'pointer', { accent: color(P.gold), background: color(P.ink), count: range(8, 5, 12, 1) }],
  ['drag-to-rotate', 'webgl', 'pointer', { model: model('millefeuille'), background: color(P.ink) }],
  ['swipe-product-transition', 'dom', 'pointer', { accent: color(P.espresso), background: color('#e9dcc5') }],
  ['touch-ripple', 'dom', 'pointer', { color: color(P.gold), background: color(P.espresso) }],
  ['interactive-liquid-distortion', 'webgl', 'pointer', { color: color(P.gold), intensity: range(0.6, 0.2, 1, 0.05) }],
  ['interactive-card-flip', 'dom', 'pointer', { accent: color(P.espresso), background: color('#e9dcc5') }],
  ['interactive-product-customization', 'dom', 'pointer', { accent: color(P.espresso), background: color(P.cream) }],
]);

/** 76–90: background motion graphics. */
export const BACKGROUND = group('background', 76, [
  ['animated-gradient', 'dom', 'time', { color: color(P.honey), accent: color(P.berry), background: color(P.violet) }],
  ['mesh-gradient', 'webgl', 'time', { color: color('#f7b267'), accent: color('#f25f5c'), background: color('#247ba0'), highlight: color('#70c1b3') }],
  ['fluid-background', 'webgl', 'time', { color: color(P.gold), accent: color(P.berry), background: color(P.night), intensity: range(0.6, 0.2, 1, 0.05) }],
  ['liquid-background', 'canvas', 'time', { color: color('#c69c6d'), accent: color(P.espresso), background: color(P.cream) }],
  ['abstract-particle-background', 'canvas', 'time', { color: color(P.gold), background: color(P.night), count: range(70, 20, 160, 10) }],
  ['floating-geometric-shapes', 'dom', 'time', { color: color(P.gold), background: color(P.ink), count: range(12, 6, 24, 1) }],
  ['ambient-light', 'dom', 'time', { color: color(P.amber), accent: color(P.berry), background: color(P.night) }],
  ['animated-noise', 'canvas', 'time', { background: color(P.roast), intensity: range(0.35, 0.05, 1, 0.05) }],
  ['aurora-background', 'webgl', 'time', { color: color(P.mint), accent: color(P.violet), background: color('#060912') }],
  ['slow-smoke', 'canvas', 'time', { color: color('#d8d2c8'), background: color(P.night), intensity: range(0.6, 0.2, 1, 0.05) }],
  ['animated-bokeh', 'canvas', 'time', { color: color(P.amber), accent: color(P.rose), background: color(P.night), count: range(26, 8, 60, 2) }],
  ['procedural-waves', 'canvas', 'time', { color: color(P.gold), background: color(P.ink), count: range(18, 6, 40, 1) }],
  ['organic-blob', 'dom', 'time', { color: color(P.berry), accent: color(P.honey), background: color(P.cream) }],
  ['glass-refraction', 'webgl', 'time', { color: color(P.amber), accent: color(P.teal), background: color(P.night) }],
  ['interactive-shader', 'webgl', 'pointer', { color: color(P.gold), accent: color(P.violet), background: color('#07060a') }],
]);

/** 91–105: UI and UX micro-animations. */
export const MICRO = group('micro', 91, [
  ['button-press', 'dom', 'pointer', { accent: color(P.espresso), background: color(P.cream), text: text('Order now', 18, 'action') }],
  ['add-to-cart', 'dom', 'time', { accent: color(P.espresso), background: color(P.cream) }],
  ['cart-item-fly-in', 'dom', 'time', { accent: color(P.espresso), background: color(P.cream) }],
  ['quantity-selector', 'dom', 'pointer', { accent: color(P.espresso), background: color(P.cream) }],
  ['price-change', 'dom', 'time', { accent: color(P.espresso), background: color(P.cream) }],
  ['product-card-expansion', 'dom', 'pointer', { accent: color(P.espresso), background: color('#e9dcc5') }],
  ['category-tab-transition', 'dom', 'pointer', { accent: color(P.espresso), background: color(P.cream) }],
  ['favorite-heart', 'dom', 'pointer', { color: color('#e5484d'), background: color(P.cream) }],
  ['order-confirmation', 'dom', 'time', { color: color('#2fa36b'), background: color(P.cream) }],
  ['loading-skeleton', 'dom', 'time', { color: color('#e6dccb'), background: color(P.milk), count: range(3, 1, 6, 1) }],
  ['progress-indicator', 'dom', 'time', { accent: color(P.espresso), background: color(P.cream) }],
  ['notification-slide-in', 'dom', 'time', { accent: color(P.espresso), background: color('#e9dcc5') }],
  ['menu-accordion', 'dom', 'pointer', { accent: color(P.espresso), background: color(P.cream) }],
  ['checkout-success', 'dom', 'time', { color: color('#2fa36b'), background: color('#e9dcc5') }],
  ['order-status-progress', 'dom', 'time', { accent: color(P.espresso), background: color(P.cream) }],
]);

/** 106–120: typography and text motion. */
export const TYPE = group('type', 106, [
  ['kinetic-typography', 'dom', 'time', { text: text('Fresh. Bold. Yours.', 40, 'words'), color: color(P.cream), background: color(P.cherry), font: font('condensed') }],
  ['text-reveal', 'dom', 'time', { text: text('Fresh every morning', 40, 'headline'), color: color(P.espresso), background: color(P.cream), font: font() }],
  ['split-text', 'dom', 'time', { text: text('Fresh every morning', 40, 'headline'), color: color(P.cream), background: color(P.espresso), font: font() }],
  ['letter-by-letter', 'dom', 'time', { text: text('Fresh every morning', 40, 'headline'), color: color(P.espresso), background: color(P.cream), font: font('sans') }],
  ['word-morphing', 'dom', 'time', { text: text('Coffee, Tea, Juice', 60, 'words'), color: color(P.cream), background: color(P.ink), font: font() }],
  ['text-mask-reveal', 'dom', 'time', { text: text('Coffee', 14, 'word'), color: color(P.honey), accent: color(P.berry), background: color(P.ink), font: font('condensed') }],
  ['text-tracking', 'dom', 'time', { text: text('Buzzify', 14, 'brand'), color: color(P.cream), background: color(P.ink), font: font('sans') }],
  ['text-blur-reveal', 'dom', 'time', { text: text('Fresh every morning', 40, 'headline'), color: color(P.cream), background: color(P.roast), font: font() }],
  ['text-fade-up', 'dom', 'time', { text: text('Fresh every morning', 40, 'headline'), color: color(P.espresso), background: color('#e9dcc5'), font: font('sans') }],
  ['typography-3d', 'dom', 'time', { text: text('Buzzify', 14, 'brand'), color: color(P.amber), accent: color('#9a5b00'), background: color(P.night) }],
  ['liquid-text', 'dom', 'time', { text: text('Coffee', 14, 'word'), color: color(P.sky), background: color(P.ink), intensity: range(0.6, 0.2, 1, 0.05) }],
  ['metallic-text-reveal', 'dom', 'time', { text: text('Buzzify', 14, 'brand'), metal: choice('gold', ['gold', 'silver', 'rose']), background: color('#050403'), font: font() }],
  ['gradient-text', 'dom', 'time', { text: text('Buzzify', 14, 'brand'), color: color(P.honey), accent: color(P.berry), background: color(P.ink), font: font('condensed') }],
  ['character-stagger', 'dom', 'time', { text: text('Fresh every morning', 40, 'headline'), color: color(P.cream), background: color(P.teal), font: font('sans') }],
  ['text-path', 'dom', 'time', { text: text('Fresh every morning', 40, 'headline'), color: color(P.gold), background: color(P.espresso) }],
]);
