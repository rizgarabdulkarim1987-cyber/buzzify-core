import type { ComponentType } from 'react';
import type { DesignPalette, ModelFraming, SceneSettings, TemplateId } from '@/lib/templates/types';

export interface SceneProps {
  palette: DesignPalette;
  settings: SceneSettings;
  /** A phone or touch device: fewer, cheaper effects (no transmission, fewer instances). */
  low: boolean;
  /** Where the business's own model sits; template scenes ignore it. */
  framing?: ModelFraming | undefined;
}

/** One preset's 3D scene: what it draws, where the camera starts, and how strongly the studio environment lights it. */
export interface SceneModule {
  Scene: ComponentType<SceneProps>;
  camera?: { position: [number, number, number]; fov: number };
  environment?: number;
}

/** Each preset's scene in a chunk of its own, so a menu downloads only the scene it shows. */
const LOADERS: Record<TemplateId, () => Promise<{ default: SceneModule }>> = {
  'obsidian-gold': () => import('./scenes/obsidian-gold'),
  'ivory-marble': () => import('./scenes/ivory-marble'),
  'emerald-palace': () => import('./scenes/emerald-palace'),
  'royal-burgundy': () => import('./scenes/royal-burgundy'),
  'kyoto-ink': () => import('./scenes/kyoto-ink'),
  'mediterranean-riviera': () => import('./scenes/mediterranean-riviera'),
  'ember-grill': () => import('./scenes/ember-grill'),
  'botanical-table': () => import('./scenes/botanical-table'),
  'saffron-house': () => import('./scenes/saffron-house'),
  'ocean-pearl': () => import('./scenes/ocean-pearl'),
  'copper-roast': () => import('./scenes/copper-roast'),
  'cream-studio': () => import('./scenes/cream-studio'),
  'matcha-ritual': () => import('./scenes/matcha-ritual'),
  'midnight-espresso': () => import('./scenes/midnight-espresso'),
  'terra-cafe': () => import('./scenes/terra-cafe'),
  'nordic-brew': () => import('./scenes/nordic-brew'),
  'neon-noir': () => import('./scenes/neon-noir'),
  'gallery-blanc': () => import('./scenes/gallery-blanc'),
  'paris-maison': () => import('./scenes/paris-maison'),
  'butter-and-fold': () => import('./scenes/butter-and-fold'),
  'rose-patisserie': () => import('./scenes/rose-patisserie'),
  'cocoa-atelier': () => import('./scenes/cocoa-atelier'),
  'artisan-crust': () => import('./scenes/artisan-crust'),
  'pistachio-boutique': () => import('./scenes/pistachio-boutique'),
  'celebration-house': () => import('./scenes/celebration-house'),
  'gelato-riviera': () => import('./scenes/gelato-riviera'),
  'sorbet-garden': () => import('./scenes/sorbet-garden'),
  'vanilla-cloud': () => import('./scenes/vanilla-cloud'),
  'pop-gelato': () => import('./scenes/pop-gelato'),
  'frozen-jewel': () => import('./scenes/frozen-jewel'),
  // The menu styles start in the static mode; a business that picks 3D gets a neighbouring template's scene for now.
  'the-book': () => import('./scenes/gallery-blanc'),
  'the-magazine': () => import('./scenes/gallery-blanc'),
  'taste-airport': () => import('./scenes/neon-noir'),
};

export async function loadScene(id: TemplateId): Promise<SceneModule> {
  return (await LOADERS[id]()).default;
}
