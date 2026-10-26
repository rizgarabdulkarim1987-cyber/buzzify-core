import Image from 'next/image';
import { cx } from '@/studio/ui/cx';

/** Both files are trimmed to the wordmark; this is their shared proportion (width over height). */
const RATIO = 2.82;

/**
 * The Buzzify logo: the black one for light pages and the white one for dark ones. Both are in the markup and the
 * stylesheet shows the one that matches `<html data-tone>` (studio.css), so a server-rendered page, the offline till and a
 * person's own dark look all pick the right one with no script. The image alone names the logo for assistive technology.
 */
export function BrandLogo({ height = 18, className }: { height?: number; className?: string }) {
  const width = Math.round(height * RATIO);
  return (
    <span className={cx('inline-flex shrink-0 items-center', className)}>
      <Image src="/brand/buzzify-on-light.png" alt="Buzzify" width={width} height={height} unoptimized className="brand-logo-light" style={{ height, width: 'auto' }} />
      <Image src="/brand/buzzify-on-dark.png" alt="" width={width} height={height} unoptimized className="brand-logo-dark" style={{ height, width: 'auto' }} />
    </span>
  );
}
