import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CustomerForm } from '@/app/pharmacy/_ui/CustomerForm';
import { WriteBlocked } from '@/app/pharmacy/_ui/WriteBlocked';
import { get } from '@/server/pharmacy/queries/customers';
import { query } from '@/server/studio/framework/invoke';
import { StudioError } from '@/server/studio/framework/result';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { PageHeader } from '@/studio/ui/PageHeader';
import { customersGate } from '../../gate';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pharmacy.customers.edit') };
}

/** Edit or archive a customer. The currency is fixed; a save carries the version the page was read at. */
export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, g] = await Promise.all([params, customersGate('pharmacy.customers.edit', { href: '/pharmacy/customers', labelKey: 'pharmacy.customers.back' })]);
  if (g.blocked) return g.blocked;
  if (!g.mayManage) notFound();
  let customer;
  try {
    customer = await query(get, { ...g.access.placeInput, customerId: id.slice(0, 64) });
  } catch (error) {
    if (error instanceof StudioError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')) notFound();
    throw error;
  }
  return (
    <>
      <PageHeader className="max-sm:px-4" above={g.back} title={g.t('pharmacy.customers.edit')} />
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-10 sm:px-8">
        {!g.writable.ok && <WriteBlocked writable={g.writable} scope="sales" />}
        <CustomerForm customer={customer} writable={g.writable.ok} defaultCurrency={customer.currency} />
      </div>
    </>
  );
}
