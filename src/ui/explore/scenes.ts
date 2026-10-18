import { stageOf, type StageArt } from '@/lib/stage';
import type { MenuProductView, MenuView } from '@/server/data/menu-view';

export interface ExploreScene {
  /** Stable id for DOM anchors. */
  id: string;
  slug: string;
  productId: string;
  categoryId: string;
  categoryName: string;
  /** Which 3D model draws the dish. */
  art: StageArt;
  /** The dish's art colour, which also tints the scene's light. */
  tone: string;
  /** A scanned dish drawn in place of the model once loaded; it cannot be pulled apart. */
  scan?: string;
  product: MenuProductView;
}

/**
 * One scene per category, led by that category's signature dish, in the menu's category order.
 * Only dishes that can be ordered and have a 3D model are staged; the full list stays in the
 * Quick Menu. Scenes come from data, so a new signature or category appears without code.
 */
export function buildScenes(view: MenuView): ExploreScene[] {
  const scenes: ExploreScene[] = [];
  for (const category of view.categories) {
    const star = view.products.find(
      (product) =>
        product.categoryId === category.id &&
        product.isSignature &&
        product.orderState === 'OK' &&
        stageOf(product.media) !== null,
    );
    if (!star) continue;
    const stage = stageOf(star.media)!;
    scenes.push({
      id: `scene-${star.slug}`,
      slug: star.slug,
      productId: star.id,
      categoryId: category.id,
      categoryName: category.name,
      art: stage.art,
      tone: stage.tone,
      ...(stage.scan ? { scan: stage.scan } : {}),
      product: star,
    });
  }
  return scenes;
}
