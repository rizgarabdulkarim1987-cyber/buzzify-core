import { cx } from '@/studio/ui/cx';

/** "Buzzify Core" set in the interface face: the product's name is its mark. Always Latin, always left to right. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span dir="ltr" lang="en" className={cx('inline-flex items-baseline gap-1.5 text-md leading-none', className)}>
      <span className="font-semibold tracking-[-0.01em] text-text">Buzzify</span>
      <span className="text-muted">Core</span>
    </span>
  );
}
