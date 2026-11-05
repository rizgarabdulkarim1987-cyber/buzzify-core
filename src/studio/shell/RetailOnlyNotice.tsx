import type { Translate } from '@/lib/i18n';
import { PageHeader } from '@/studio/ui/PageHeader';

/**
 * What an account made for Buzzify Retail (`isRetailOnly`) sees on a Studio address while the link to Retail is off:
 * what the account is for, in words that name no Studio. With the link on it never gets here: it is sent into Retail.
 */
export function RetailOnlyNotice({ t }: { t: Translate }) {
  return <PageHeader title={t('retailOnly.title')} description={t('retailOnly.body')} />;
}
