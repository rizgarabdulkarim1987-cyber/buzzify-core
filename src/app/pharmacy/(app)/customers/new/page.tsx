import type { Metadata } from 'next';
import { CustomerForm } from '@/app/pharmacy/_ui/CustomerForm';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { customersGate } from '../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.customers.new') };
}

/** A new customer: name, phone, currency (chosen once) and a credit limit. Only for `customer.manage`. */
export default async function NewCustomerPage() {
  const g = await customersGate('pharmacy.customers.new', { href: '/pharmacy/customers', labelKey: 'pharmacy.customers.back' });
  if (g.blocked) return g.blocked;
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={g.t('pharmacy.customers.new')} />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {!g.writable.ok && <WriteBlocked writable={g.writable} scope="sales" />}
        {g.mayManage ? <CustomerForm customer={null} writable={g.writable.ok} defaultCurrency="IQD" /> : null}
      </div>
    </>
  );
}
