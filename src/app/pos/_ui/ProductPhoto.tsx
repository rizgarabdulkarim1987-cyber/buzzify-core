import type { TillProduct } from '@/server/pos/till-catalog';
import { cx } from '@/studio/ui/cx';

/**
 * A dish's picture at the top of its till tile, the one the menu shows. Nothing when the dish has none, so its tile keeps
 * the text-only shape. `image` can be missing from a catalog the till cached before pictures existed.
 */
export function ProductPhoto({ product, dim }: { product: Pick<TillProduct, 'image'>; dim?: boolean }) {
  const image = product.image;
  if (!image) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- library renditions are already sized; the blur placeholder fills in while it loads
    <img
      src={image.url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      style={image.placeholder ? { backgroundImage: `url(${image.placeholder})`, backgroundSize: 'cover' } : undefined}
      className={cx('aspect-[4/3] w-full bg-hover object-cover', dim && 'grayscale')}
    />
  );
}
