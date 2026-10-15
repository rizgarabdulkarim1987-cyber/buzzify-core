import type { SeedData, Tri } from './atelier';

const LOCALES = ['en', 'ar', 'ckb'] as const;
const ARABIC_SCRIPT = /[؀-ۿ]/;

function checkTri(problems: string[], label: string, value: Tri | undefined): void {
  if (!value) {
    problems.push(`${label}: missing`);
    return;
  }
  for (const locale of LOCALES) {
    const text = value[locale];
    if (typeof text !== 'string' || text.trim() === '') {
      problems.push(`${label}: missing ${locale} text`);
    } else if (locale !== 'en' && !ARABIC_SCRIPT.test(text)) {
      problems.push(`${label}: ${locale} text is not in Arabic script ("${text}")`);
    }
  }
}

export function validateSeed(data: SeedData): string[] {
  const problems: string[] = [];
  const categories = new Set(data.categories.map((c) => c.slug));
  const slugs = new Set<string>();

  for (const category of data.categories) checkTri(problems, `category ${category.slug} name`, category.name);

  for (const product of data.products) {
    const label = `product ${product.slug}`;
    if (slugs.has(product.slug)) problems.push(`${label}: duplicate slug`);
    slugs.add(product.slug);
    if (!categories.has(product.category)) problems.push(`${label}: unknown category ${product.category}`);
    if (product.price <= 0) problems.push(`${label}: price must be positive`);
    if (product.cost !== null && product.cost >= product.price) {
      problems.push(`${label}: cost ${product.cost} is not below price ${product.price}`);
    }
    checkTri(problems, `${label} name`, product.name);
    checkTri(problems, `${label} description`, product.description);
    for (const locale of LOCALES) {
      if (product.ingredients[locale].length !== product.ingredients.en.length) {
        problems.push(`${label}: ${locale} ingredients count differs from English`);
      }
    }
    for (const group of product.groups ?? []) {
      checkTri(problems, `${label} group name`, group.name);
      if (group.min > group.max) problems.push(`${label}: group min above max`);
      for (const option of group.options) {
        checkTri(problems, `${label} option`, option.name);
        if (option.effect) checkTri(problems, `${label} option effect`, option.effect);
      }
    }
    for (const variant of product.variants ?? []) checkTri(problems, `${label} variant`, variant.name);
  }

  for (const rule of data.pairingRules) {
    const source = 'product' in rule.source ? rule.source.product : rule.source.category;
    const known = 'product' in rule.source ? slugs.has(source) : categories.has(source);
    if (!known) problems.push(`pairing rule: unknown source ${source}`);
    if (!slugs.has(rule.target)) problems.push(`pairing rule: unknown target ${rule.target}`);
    checkTri(problems, `pairing ${source}->${rule.target} reason`, rule.reason);
  }

  for (const rule of data.upsellRules) {
    if (!slugs.has(rule.source)) problems.push(`upsell rule: unknown source ${rule.source}`);
    if (!slugs.has(rule.target)) problems.push(`upsell rule: unknown target ${rule.target}`);
    checkTri(problems, `upsell ${rule.source} pitch`, rule.pitch);
    checkTri(problems, `upsell ${rule.source} effect`, rule.effect);
  }

  const priceBySlug = new Map(data.products.map((p) => [p.slug, p.price]));
  for (const bundle of data.bundles) {
    checkTri(problems, `bundle ${bundle.slug} name`, bundle.name);
    checkTri(problems, `bundle ${bundle.slug} description`, bundle.description);
    let total = 0;
    for (const item of bundle.items) {
      const price = priceBySlug.get(item.product);
      if (price === undefined) {
        problems.push(`bundle ${bundle.slug}: unknown item ${item.product}`);
        continue;
      }
      total += price * item.quantity;
    }
    if (bundle.price >= total) {
      problems.push(`bundle ${bundle.slug}: price ${bundle.price} is not cheaper than its items (${total})`);
    }
  }

  for (const window of data.schedule) {
    if (window.startMinute < 0 || window.startMinute > 1439 || window.endMinute < 0 || window.endMinute > 1439) {
      problems.push(`schedule ${window.daypart}: minutes out of range`);
    }
  }
  return problems;
}

export function assertSeedValid(data: SeedData): void {
  const problems = validateSeed(data);
  if (problems.length > 0) throw new Error(`Seed data is invalid:\n- ${problems.join('\n- ')}`);
}
