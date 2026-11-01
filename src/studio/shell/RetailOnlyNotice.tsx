import type { Translate } from '@/lib/i18n';
import { buttonClasses } from '@/studio/ui/Button';
import { PageHeader } from '@/studio/ui/PageHeader';

/**
 * The one page an account made for Buzzify Retail sees in the Studio (`isRetailOnly`): what the account is for and the
 * way to Retail. `retailUrl` is Retail's address, or null when the link is not configured (then no link is offered).
 */
export function RetailOnlyNotice({ t, retailUrl }: { t: Translate; retailUrl: string | null }) {
  return (
    <PageHeader
      title={t('retailOnly.title')}
      description={t('retailOnly.body')}
      below={
        retailUrl ? (
          <div className="pb-6">
            <a href={retailUrl} className={buttonClasses('primary')}>
              {t('retailOnly.open')}
            </a>
          </div>
        ) : undefined
      }
    />
  );
}
