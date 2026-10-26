import { cx } from '@/studio/ui/cx';
import { BrandLogo } from './BrandLogo';

/** The Buzzify logo and the word "Core": the product's name is its mark. Always left to right. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span dir="ltr" lang="en" className={cx('inline-flex items-center gap-2 text-md leading-none', className)}>
      <BrandLogo height={16} />
      <span className="text-muted">Core</span>
    </span>
  );
}
