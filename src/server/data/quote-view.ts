import type { Locale } from '@/lib/locale';
import type { Catalog, Quote, QuoteBundleLine, QuoteLine } from '@/server/domain';
import { resolveText } from '@/server/domain';

export interface QuoteLineView extends QuoteLine {
  name: string;
  variantName: string | null;
  optionNames: string[];
}

export interface QuoteBundleView extends QuoteBundleLine {
  name: string;
}

export interface QuoteView extends Omit<Quote, 'lines' | 'bundles'> {
  lines: QuoteLineView[];
  bundles: QuoteBundleView[];
}

export function describeQuote(catalog: Catalog, quote: Quote, locale: Locale): QuoteView {
  const fallback = catalog.defaultLocale;
  const products = new Map(catalog.products.map((product) => [product.id, product]));
  const bundles = new Map(catalog.bundles.map((bundle) => [bundle.id, bundle]));

  return {
    ...quote,
    lines: quote.lines.map((line) => {
      const product = products.get(line.productId);
      if (!product) return { ...line, name: '', variantName: null, optionNames: [] };
      const variant = line.variantId ? product.variants.find((v) => v.id === line.variantId) : undefined;
      const optionNames = product.groups
        .flatMap((group) => group.options)
        .filter((option) => line.optionIds.includes(option.id))
        .map((option) => resolveText(option.translations, 'name', locale, fallback));
      return {
        ...line,
        name: resolveText(product.translations, 'name', locale, fallback),
        variantName: variant ? resolveText(variant.translations, 'name', locale, fallback) : null,
        optionNames,
      };
    }),
    bundles: quote.bundles.map((line) => {
      const bundle = bundles.get(line.bundleId);
      return { ...line, name: bundle ? resolveText(bundle.translations, 'name', locale, fallback) : '' };
    }),
  };
}
