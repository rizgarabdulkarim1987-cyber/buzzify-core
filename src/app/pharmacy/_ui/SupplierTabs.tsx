import Link from 'next/link';
import type { Translate } from '@/lib/i18n';
import { buttonClasses } from '@/studio/ui/Button';

type Tab = 'details' | 'statement' | 'invoices' | 'payments' | 'credits' | 'returns';

/**
 * The ways into one supplier's money: its details, statement, and its invoices, payments, credit notes and returns (the
 * lists filtered to this supplier). Plain links, so each is a page of its own and works without a script.
 */
export function SupplierTabs({ supplierId, current, t }: { supplierId: string; current: Tab; t: Translate }) {
  const q = `?supplier=${encodeURIComponent(supplierId)}`;
  const tabs: { id: Tab; href: string }[] = [
    { id: 'details', href: `/pharmacy/purchasing/suppliers/${supplierId}` },
    { id: 'statement', href: `/pharmacy/purchasing/suppliers/${supplierId}/statement` },
    { id: 'invoices', href: `/pharmacy/purchasing/invoices${q}` },
    { id: 'payments', href: `/pharmacy/purchasing/payments${q}` },
    { id: 'credits', href: `/pharmacy/purchasing/credits${q}` },
    { id: 'returns', href: `/pharmacy/purchasing/returns${q}` },
  ];
  return (
    <nav aria-label={t('pharmacy.purchasing.m.tabs')} data-testid="supplier-tabs" className="flex flex-wrap gap-2 print:hidden">
      {tabs.map((tab) => (
        <Link key={tab.id} href={tab.href} aria-current={tab.id === current ? 'page' : undefined} className={buttonClasses(tab.id === current ? 'primary' : 'secondary', 'lg', 'min-h-11')}>
          {t(`pharmacy.purchasing.m.tab.${tab.id}`)}
        </Link>
      ))}
    </nav>
  );
}
