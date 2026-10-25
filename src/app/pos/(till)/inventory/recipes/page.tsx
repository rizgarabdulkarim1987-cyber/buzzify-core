import type { Metadata } from 'next';
import Link from 'next/link';
import { formatNumber } from '@/lib/pos-format';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posRecipe, posRecipes } from '@/server/studio/queries/pos-inventory';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { EmptyState } from '@/studio/ui/EmptyState';
import { PageHeader } from '@/studio/ui/PageHeader';
import { RecipeEditor } from '@/app/pos/_ui/stock/RecipeEditor';
import { SectionTabs } from '@/app/pos/_ui/stock/view';
import { stockTabs } from '../tabs';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.stock.tab.recipes') };
}

/** Which ingredients a paid product takes out of stock. Optional per product. Needs `inventory.manage`. */
export default async function RecipesPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const [{ product: chosen }, access, locale] = await Promise.all([searchParams, getPosAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const data = await query(posRecipes, {});
  const nameOf = (names: Partial<Record<string, string>>) => names[locale] ?? names[data.defaultLocale] ?? Object.values(names)[0] ?? '';
  const selected = chosen ? data.products.find((p) => p.id === chosen) : undefined;
  const recipe = selected ? await query(posRecipe, { productId: selected.id }) : null;
  const categoryName = new Map(data.categories.map((c) => [c.id, nameOf(c.names)]));
  return (
    <>
      <PageHeader title={t('pos.stock.tab.recipes')} description={t('pos.stock.recipesIntro')} />
      <SectionTabs label={t('pos.stock.sections')} current="recipes" items={stockTabs(t, access.actor?.role ?? 'CASHIER')} />
      <div className="flex flex-col gap-8 px-8 pb-8">
        {selected && recipe ? (
          <section aria-labelledby="recipe-edit" className="flex flex-col gap-4">
            <h2 id="recipe-edit" className="text-base font-semibold text-text" dir="auto">
              {nameOf(selected.names)}
            </h2>
            {data.items.length === 0 ? <p className="text-base text-muted">{t('pos.stock.recipeNeedsItems')}</p> : null}
            <RecipeEditor key={selected.id} productId={selected.id} items={data.items} initial={recipe.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity }))} />
          </section>
        ) : null}
        {data.products.length === 0 ? (
          <EmptyState title={t('pos.stock.recipesEmpty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {data.products.map((product) => (
              <li key={product.id}>
                <Link href={`/pos/inventory/recipes?product=${product.id}`} aria-current={product.id === selected?.id ? 'true' : undefined} className="flex min-h-12 flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-hover">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-base text-text" dir="auto">
                      {nameOf(product.names)}
                    </span>
                    <span className="truncate text-sm text-muted" dir="auto">
                      {categoryName.get(product.categoryId)}
                    </span>
                  </span>
                  <span className="text-sm text-muted">{product.lines === 0 ? t('pos.stock.noRecipe') : t('pos.stock.recipeLines', { n: formatNumber(product.lines) })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
