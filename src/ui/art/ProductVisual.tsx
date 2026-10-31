import Image from 'next/image';
import type { ImageItem, MediaItem } from '@/lib/media';
import { ProductArt } from './ProductArt';

interface Props {
  media: MediaItem[];
  name: string;
  slug: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
  /** Paint the photo's tiny blurred stand-in behind it while it loads (the product page; rows skip it to keep the HTML small). */
  placeholder?: boolean;
}

/**
 * A library photo in the formats the library made: AVIF where the browser takes it, else WebP, each at the width the
 * layout needs (`sizes`). Width and height are given so the page never shifts while it loads.
 */
function LibraryPhoto({ image, sizes, priority, placeholder }: { image: ImageItem; sizes: string; priority: boolean; placeholder: boolean }) {
  return (
    <picture>
      {image.srcset && <source type="image/avif" srcSet={image.srcset.avif} sizes={sizes} />}
      <img
        src={image.url}
        srcSet={image.srcset?.webp}
        sizes={image.srcset ? sizes : undefined}
        alt={image.alt}
        width={image.width}
        height={image.height}
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        className="size-full object-cover"
        style={placeholder && image.placeholder ? { backgroundImage: `url(${image.placeholder})`, backgroundSize: 'cover' } : undefined}
      />
    </picture>
  );
}

export function ProductVisual({ media, name, slug, className = '', priority = false, sizes = '96px', placeholder = false }: Props) {
  // A dish's own 3D model has no picture of itself: the first thing a guest can see is the first item that does.
  const first = media.find((item) => item.kind !== 'model3d' || item.poster !== undefined);
  const frame = `relative block overflow-hidden bg-raised ${className}`;

  if (!first) return <span className={frame} aria-hidden="true" />;

  if (first.kind === 'art') {
    return (
      <span className={frame}>
        <ProductArt kind={first.art} tone={first.tone} uid={slug} className="size-full" />
      </span>
    );
  }

  // A photo or drawing from the media library (an SVG has no srcset): served as the library made it.
  if (first.kind === 'image' && (first.srcset || first.assetId)) {
    return (
      <span className={frame}>
        <LibraryPhoto image={first} sizes={sizes} priority={priority} placeholder={placeholder} />
      </span>
    );
  }

  const source = first.kind === 'image' ? first.url : first.poster;
  if (source === undefined) return <span className={frame} aria-hidden="true" />;
  const sameOrigin = source.startsWith('/');
  return (
    <span className={frame}>
      {sameOrigin ? (
        <Image
          src={source}
          alt={first.kind === 'image' ? first.alt : name}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt={first.kind === 'image' ? first.alt : name} className="size-full object-cover" />
      )}
    </span>
  );
}
