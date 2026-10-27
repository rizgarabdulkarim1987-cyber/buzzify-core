import { themeOf } from '@/lib/templates/palette';
import type { DesignPalette, TemplateId } from '@/lib/templates/types';

/**
 * The template whose background art (poster, 3D scene) a template without its own borrows: a menu style starts on the
 * static scene and gets art of its own only when someone draws it. Dark backgrounds borrow Neon Noir, light ones
 * Gallery Blanc.
 */
export function borrowedArt(palette: Pick<DesignPalette, 'bg'>): TemplateId {
  return themeOf(palette.bg) === 'dark' ? 'neon-noir' : 'gallery-blanc';
}
