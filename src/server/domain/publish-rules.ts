import { paletteProblems } from '@/lib/palette';
import { designPaletteProblems } from '@/lib/templates/palette';
import type { MenuSnapshot } from './snapshot';
import type { Locale, TranslationMap } from './types';

export type PublishIssueCode =
  | 'EMPTY_MENU'
  | 'NO_PRICE'
  | 'EMPTY_CATEGORY'
  | 'UNSATISFIABLE_GROUP'
  | 'BROKEN_REFERENCE'
  | 'MISSING_TRANSLATION'
  | 'NO_IMAGE'
  | 'LOW_CONTRAST'
  | 'MISSING_ASSET';

export interface PublishIssue {
  code: PublishIssueCode;
  /** A blocking issue stops the publish; a warning is shown and can be published past. */
  severity: 'block' | 'warn';
  entity?: { type: 'category' | 'product' | 'group' | 'rule' | 'bundle'; id: string; slug?: string };
  locale?: Locale;
  /** For `LOW_CONTRAST`: the two palette colours and how much they contrast. */
  pair?: { foreground: string; background: string; ratio: number };
}

function hasName(translations: TranslationMap, locale: Locale): boolean {
  const name = translations[locale]?.name;
  return typeof name === 'string' && name.trim() !== '';
}

/**
 * What stands in the way of publishing a menu, and what is worth a second look. Pure and exhaustive: every problem is
 * reported, in the order of the snapshot, so the editor can list them all at once.
 */
export function validateForPublish(snapshot: MenuSnapshot): PublishIssue[] {
  const { catalog, menu } = snapshot;
  const issues: PublishIssue[] = [];

  const categoryIds = new Set(catalog.categories.map((c) => c.id));
  const productIds = new Set(catalog.products.map((p) => p.id));
  const variantIdsByProduct = new Map(catalog.products.map((p) => [p.id, new Set(p.variants.map((v) => v.id))]));
  const usedCategoryIds = new Set(catalog.products.map((p) => p.categoryId));

  if (catalog.products.length === 0) issues.push({ code: 'EMPTY_MENU', severity: 'block' });

  // Body text guests cannot read blocks the publish (spec 12); a weak accent is the brand tab's warning, not a block.
  // Only the palette guests are shown counts: the template's when the menu has one, else the kit's theme.
  const design = snapshot.brand.design;
  const problems = design ? designPaletteProblems(design.palette) : paletteProblems(snapshot.brand.tokens[snapshot.brand.theme]);
  for (const problem of problems) {
    if (problem.severity !== 'block') continue;
    issues.push({
      code: 'LOW_CONTRAST',
      severity: 'block',
      pair: { foreground: problem.foreground, background: problem.background, ratio: problem.ratio },
    });
  }

  for (const category of catalog.categories) {
    const entity = { type: 'category' as const, id: category.id, slug: category.slug };
    if (!usedCategoryIds.has(category.id)) issues.push({ code: 'EMPTY_CATEGORY', severity: 'block', entity });
    for (const locale of menu.locales) {
      if (!hasName(category.translations, locale)) {
        issues.push({ code: 'MISSING_TRANSLATION', severity: 'warn', entity, locale });
      }
    }
  }

  for (const product of catalog.products) {
    const entity = { type: 'product' as const, id: product.id, slug: product.slug };
    if (product.basePrice <= 0) issues.push({ code: 'NO_PRICE', severity: 'block', entity });
    if (!categoryIds.has(product.categoryId)) issues.push({ code: 'BROKEN_REFERENCE', severity: 'block', entity });
    if (product.media.length === 0) issues.push({ code: 'NO_IMAGE', severity: 'warn', entity });
    // A library photo that could not be resolved (its asset is gone, or belongs elsewhere) would show nothing.
    for (const entry of product.media) {
      if ((entry as { kind?: unknown } | null)?.kind === 'asset') issues.push({ code: 'MISSING_ASSET', severity: 'block', entity });
    }
    for (const locale of menu.locales) {
      if (!hasName(product.translations, locale)) {
        issues.push({ code: 'MISSING_TRANSLATION', severity: 'warn', entity, locale });
      }
    }
    for (const group of product.groups) {
      if (group.minSelect > group.options.length || group.minSelect > group.maxSelect) {
        issues.push({ code: 'UNSATISFIABLE_GROUP', severity: 'block', entity: { type: 'group', id: group.id } });
      }
    }
  }

  for (const rule of catalog.upsellRules) {
    if (!productIds.has(rule.sourceProductId) || !productIds.has(rule.targetProductId)) {
      issues.push({ code: 'BROKEN_REFERENCE', severity: 'block', entity: { type: 'rule', id: rule.id } });
    }
  }

  for (const rule of catalog.pairingRules) {
    const sourceExists =
      rule.sourceType === 'PRODUCT'
        ? rule.sourceProductId !== null && productIds.has(rule.sourceProductId)
        : rule.sourceCategoryId !== null && categoryIds.has(rule.sourceCategoryId);
    if (!sourceExists || !productIds.has(rule.targetProductId)) {
      issues.push({ code: 'BROKEN_REFERENCE', severity: 'block', entity: { type: 'rule', id: rule.id } });
    }
  }

  for (const bundle of catalog.bundles) {
    const intact = bundle.items.every(
      (item) =>
        productIds.has(item.productId) &&
        (item.variantId === null || variantIdsByProduct.get(item.productId)?.has(item.variantId) === true),
    );
    if (!intact) {
      issues.push({
        code: 'BROKEN_REFERENCE',
        severity: 'block',
        entity: { type: 'bundle', id: bundle.id, slug: bundle.slug },
      });
    }
  }

  return issues;
}
