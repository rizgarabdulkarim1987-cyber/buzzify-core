import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import type { ArtKind } from '@/lib/media';
import type { StageArt } from '@/lib/stage';
import { snapshotHash } from '@/server/domain/snapshot';
import { loadDraftSnapshot } from '@/server/publish/draft';
import { publishMenu } from '@/server/publish/publish';

/**
 * Gives a menu's products a 3D model and republishes the menu (`npm run studio:stage-models`). The Studio cannot yet
 * choose a model for a product, so this is how one is named: every product of a category gets an art entry after its
 * pictures, which keeps its photo as the picture while the art draws the 3D stage, and one product of the category can
 * be made its signature, which leads the category's scene in Explore.
 */

export interface StageModelRule {
  /** The category's slug or name in any language; a part of one, when only one category has it. */
  category: string;
  model: StageArt;
  /** The product to make the category's signature: its slug or name in any language. */
  signature?: string;
}

export interface StageModelPlan {
  menuId: string;
  restaurantId: string;
  /** The draft differs from what guests see: publishing would put someone's unpublished changes live too. */
  unpublished: boolean;
  products: Array<{
    id: string;
    slug: string;
    name: string;
    category: string;
    model: StageArt;
    addModel: boolean;
    media: unknown[];
    signature: { before: boolean; after: boolean };
  }>;
}

/** The art kind a model's entry carries (its 2D drawing, where no photo comes first) and the colour that lights it. */
const ART: Record<StageArt, { art: ArtKind; tone: string }> = {
  burger: { art: 'burger', tone: '#A5662F' },
  cup: { art: 'cup', tone: '#8A6A4B' },
  glass: { art: 'glass', tone: '#E8D96A' },
  croissant: { art: 'pastry', tone: '#C98B4A' },
  millefeuille: { art: 'pastry', tone: '#9DB07A' },
  bagchicken: { art: 'bowl', tone: '#F0A13A' },
  bagbeef: { art: 'bowl', tone: '#D9782A' },
};

type Translations = Record<string, { name?: string } | undefined>;

const names = (translations: unknown) =>
  Object.values((translations ?? {}) as Translations)
    .map((entry) => entry?.name ?? '')
    .filter(Boolean);

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A name to print: the English one when there is one. */
const nameOf = (translations: unknown, fallback: string) => (translations as Translations)?.en?.name ?? names(translations)[0] ?? fallback;

/** What would change, read without writing anything. Throws when a rule names no category or product, or several. */
export async function planStageModels(prisma: PrismaClient, slug: string, rules: StageModelRule[]): Promise<StageModelPlan> {
  const entry = await prisma.menuSlug.findUnique({ where: { slug }, select: { menu: { select: { id: true, restaurantId: true, liveHash: true } } } });
  const menu = entry?.menu;
  if (!menu) throw new Error(`No menu has the address ${slug}`);
  const categories = await prisma.category.findMany({ where: { menuId: menu.id }, select: { id: true, slug: true, translations: true } });
  const products = await prisma.product.findMany({
    where: { menuId: menu.id },
    orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
    select: { id: true, slug: true, categoryId: true, translations: true, media: true, isSignature: true },
  });

  const plan: StageModelPlan['products'] = [];
  for (const rule of rules) {
    const exact = categories.filter((c) => same(c.slug, rule.category) || names(c.translations).some((n) => same(n, rule.category)));
    const partial = categories.filter((c) =>
      [c.slug, ...names(c.translations)].some((n) => n.toLowerCase().includes(rule.category.trim().toLowerCase())),
    );
    const found = exact.length === 1 ? exact : partial;
    if (found.length !== 1) throw new Error(`"${rule.category}" names ${found.length} categories, not one`);
    const category = found[0]!;
    const label = nameOf(category.translations, category.slug);
    const inCategory = products.filter((p) => p.categoryId === category.id);

    let signatureId: string | null = null;
    if (rule.signature) {
      const matches = inCategory.filter((p) => same(p.slug, rule.signature!) || names(p.translations).some((n) => same(n, rule.signature!)));
      if (matches.length !== 1) throw new Error(`"${rule.signature}" names ${matches.length} products in ${label}, not one`);
      signatureId = matches[0]!.id;
    }

    for (const product of inCategory) {
      const media = Array.isArray(product.media) ? (product.media as unknown[]) : [];
      const has = media.some((item) => (item as { kind?: unknown; model?: unknown })?.kind === 'art' && (item as { model?: unknown }).model === rule.model);
      plan.push({
        id: product.id,
        slug: product.slug,
        name: nameOf(product.translations, product.slug),
        category: label,
        model: rule.model,
        addModel: !has,
        media,
        signature: { before: product.isSignature, after: product.id === signatureId ? true : product.isSignature },
      });
    }
  }

  const draft = snapshotHash(await loadDraftSnapshot(prisma, menu.id));
  return { menuId: menu.id, restaurantId: menu.restaurantId, unpublished: draft !== menu.liveHash, products: plan };
}

/**
 * Writes the plan and publishes the menu in one transaction, with an audit entry for each product and for the publish,
 * as the Studio would. Refuses a menu with unpublished changes, which would go live with it. Guests see the new revision
 * once the public cache lets go of the old one, within five minutes.
 */
export async function applyStageModels(
  prisma: PrismaClient,
  plan: StageModelPlan,
  { now, includeUnpublished = false }: { now: Date; includeUnpublished?: boolean },
): Promise<{ number: number }> {
  if (plan.unpublished && !includeUnpublished) {
    throw new Error('The menu has unpublished changes, which publishing would put live too. Publish or discard them first.');
  }
  return prisma.$transaction(async (tx) => {
    const before = await tx.menu.findUniqueOrThrow({ where: { id: plan.menuId }, select: { liveRevision: { select: { number: true } } } });
    for (const product of plan.products) {
      if (!product.addModel && product.signature.before === product.signature.after) continue;
      const entry = { kind: 'art', art: ART[product.model].art, tone: ART[product.model].tone, model: product.model };
      const media = product.addModel ? [...product.media, entry] : product.media;
      await tx.product.update({
        where: { id: product.id },
        data: { media: media as Prisma.InputJsonArray, isSignature: product.signature.after, version: { increment: 1 } },
      });
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      if (product.addModel) changes.media = { before: product.media.length, after: media.length };
      if (product.signature.before !== product.signature.after) changes.isSignature = product.signature;
      await tx.auditLog.create({
        data: { restaurantId: plan.restaurantId, menuId: plan.menuId, action: 'product.updated', entityType: 'Product', entityId: product.id, changes: changes as Prisma.InputJsonObject },
      });
    }
    const outcome = await publishMenu(tx, { menuId: plan.menuId, actorId: null, note: '3D models', now });
    if (!outcome.ok) throw new Error(`The menu cannot be published: ${JSON.stringify(outcome.issues.filter((i) => i.severity === 'block'))}`);
    await tx.auditLog.create({
      data: {
        restaurantId: plan.restaurantId,
        menuId: plan.menuId,
        action: 'menu.published',
        entityType: 'Menu',
        entityId: plan.menuId,
        changes: { revision: { before: before.liveRevision?.number ?? null, after: outcome.number } },
      },
    });
    return { number: outcome.number };
  });
}
