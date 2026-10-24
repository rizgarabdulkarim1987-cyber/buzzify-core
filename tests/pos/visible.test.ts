import { describe, expect, it } from 'vitest';
import { CATEGORY_PREVIEW, previewOf } from '@/server/domain/pos/visible';

describe('previewOf', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, index) => index);

  it('shows a short list whole', () => {
    expect(previewOf(rows(CATEGORY_PREVIEW), false)).toEqual({ shown: rows(CATEGORY_PREVIEW), hidden: 0 });
  });

  it('cuts a 1,000-product category to the preview and says how many are hidden', () => {
    const result = previewOf(rows(1000), false);
    expect(result.shown).toHaveLength(CATEGORY_PREVIEW);
    expect(result.hidden).toBe(1000 - CATEGORY_PREVIEW);
  });

  it('shows everything once expanded', () => {
    expect(previewOf(rows(1000), true)).toEqual({ shown: rows(1000), hidden: 0 });
  });
});
