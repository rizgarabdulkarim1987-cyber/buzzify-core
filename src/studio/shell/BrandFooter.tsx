import { BrandLogo } from './BrandLogo';

/** The small Buzzify mark at the foot of every screen. Outside the order screen's own area, and not printed on receipts. */
export function BrandFooter() {
  return (
    <footer className="print:hidden flex justify-center px-4 py-3 opacity-70">
      <BrandLogo height={14} />
    </footer>
  );
}
