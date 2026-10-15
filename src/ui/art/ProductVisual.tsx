import Image from 'next/image';
import type { MediaItem } from '@/lib/media';
import { ProductArt } from './ProductArt';

interface Props {
  media: MediaItem[];
  name: string;
  slug: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
}

export function ProductVisual({ media, name, slug, className = '', priority = false, sizes = '96px' }: Props) {
  const first = media[0];
  const frame = `relative block overflow-hidden bg-raised ${className}`;

  if (!first) return <span className={frame} aria-hidden="true" />;

  if (first.kind === 'art') {
    return (
      <span className={frame}>
        <ProductArt kind={first.art} tone={first.tone} uid={slug} className="size-full" />
      </span>
    );
  }

  const source = first.kind === 'image' ? first.url : first.poster;
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
