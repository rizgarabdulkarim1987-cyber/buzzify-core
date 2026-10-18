import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applyStageModels, planStageModels } from '../../scripts/stage-models';
import { createMenuFixture, publishFixture, resetTestData, testPrisma } from '../helpers/db';

const prisma = testPrisma();
const PHOTO = { kind: 'image', url: 'https://cdn.example.com/bag.webp', alt: 'Bag', width: 800, height: 800 };

/** A menu shaped like a loaded-bag shop: two categories of four sizes, every product with its photo, published. */
async function bagShop() {
  const { menu, category: chicken, product: first } = await createMenuFixture(prisma, 'bags', { publish: false });
  await prisma.category.update({ where: { id: chicken.id }, data: { slug: 'chicken', translations: { en: { name: 'Zhamitos Chicken' } } } });
  const meat = await prisma.category.create({ data: { menuId: menu.id, slug: 'meat', translations: { en: { name: 'Zhamitos Meat' } } } });
  await prisma.product.delete({ where: { id: first.id } });
  for (const [category, prefix] of [
    [chicken, 'c'],
    [meat, 'm'],
  ] as const) {
    for (const [i, name] of ['Small', 'Small Extra', 'Big', 'Big Extra'].entries()) {
      await prisma.product.create({
        data: {
          menuId: menu.id,
          categoryId: category.id,
          slug: `${prefix}-${i}`,
          basePrice: 3_000 + i * 1_000,
          sortOrder: i,
          media: [PHOTO],
          translations: { en: { name } },
        },
      });
    }
  }
  await publishFixture(prisma, menu.id);
  return { menuId: menu.id };
}

const RULES = [
  { category: 'chicken', model: 'bagchicken' as const, signature: 'small' },
  { category: 'zhamitos meat', model: 'bagbeef' as const, signature: 'Small' },
];

beforeEach(async () => {
  await resetTestData(prisma);
});

afterAll(async () => {
  await resetTestData(prisma);
  await prisma.$disconnect();
});

describe('stage models', () => {
  it('names each category model after the photo, marks the chosen size as the signature and publishes it', async () => {
    const { menuId } = await bagShop();
    const plan = await planStageModels(prisma, 'bags', RULES);
    expect(plan.unpublished).toBe(false);
    expect(plan.products.filter((p) => p.addModel)).toHaveLength(8);
    expect(plan.products.filter((p) => p.signature.after && !p.signature.before).map((p) => p.slug).sort()).toEqual(['c-0', 'm-0']);

    const outcome = await applyStageModels(prisma, plan, { now: new Date() });
    expect(outcome.number).toBe(2);

    const small = await prisma.product.findFirstOrThrow({ where: { menuId, slug: 'c-0' } });
    expect(small.isSignature).toBe(true);
    expect(small.version).toBe(2);
    expect(small.media).toEqual([PHOTO, { kind: 'art', art: 'bowl', tone: '#F0A13A', model: 'bagchicken' }]);
    const beef = await prisma.product.findFirstOrThrow({ where: { menuId, slug: 'm-2' } });
    expect(beef.isSignature).toBe(false);
    expect((beef.media as Array<{ model?: string }>)[1]?.model).toBe('bagbeef');

    const menu = await prisma.menu.findUniqueOrThrow({ where: { id: menuId }, select: { liveRevision: { select: { number: true, snapshot: true } }, liveHash: true, draftHash: true } });
    expect(menu.liveRevision?.number).toBe(2);
    expect(menu.draftHash).toBe(menu.liveHash);
    const live = menu.liveRevision!.snapshot as { catalog: { products: Array<{ slug: string; media: unknown[] }> } };
    expect(live.catalog.products.find((p) => p.slug === 'm-0')?.media).toHaveLength(2);

    const audit = await prisma.auditLog.findMany({ where: { menuId }, select: { action: true } });
    expect(audit.filter((a) => a.action === 'product.updated')).toHaveLength(8);
    expect(audit.filter((a) => a.action === 'menu.published')).toHaveLength(1);
  });

  it('adds nothing a second time', async () => {
    await bagShop();
    await applyStageModels(prisma, await planStageModels(prisma, 'bags', RULES), { now: new Date() });
    const again = await planStageModels(prisma, 'bags', RULES);
    expect(again.products.some((p) => p.addModel || p.signature.before !== p.signature.after)).toBe(false);
  });

  it('will not publish changes someone left unpublished in the Studio', async () => {
    const { menuId } = await bagShop();
    await prisma.product.updateMany({ where: { menuId, slug: 'c-1' }, data: { basePrice: 9_000 } });
    const plan = await planStageModels(prisma, 'bags', RULES);
    expect(plan.unpublished).toBe(true);
    await expect(applyStageModels(prisma, plan, { now: new Date() })).rejects.toThrow(/unpublished/);
    expect((await prisma.product.findFirstOrThrow({ where: { menuId, slug: 'c-0' } })).isSignature).toBe(false);
  });

  it('refuses a category or a signature it cannot name exactly', async () => {
    await bagShop();
    await expect(planStageModels(prisma, 'bags', [{ category: 'zhamitos', model: 'bagbeef' }])).rejects.toThrow(/2 categories/);
    await expect(planStageModels(prisma, 'bags', [{ category: 'meat', model: 'bagbeef', signature: 'Medium' }])).rejects.toThrow(/Medium/);
    await expect(planStageModels(prisma, 'nowhere', RULES)).rejects.toThrow(/nowhere/);
  });
});
