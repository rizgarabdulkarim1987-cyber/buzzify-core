import type { Metadata } from 'next';
import Link from 'next/link';
import { getPosAccess } from '@/server/pos/actor';
import { query } from '@/server/studio/framework/invoke';
import { posCatalogEditor, posCatalogMenu } from '@/server/studio/queries/pos';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { buttonClasses } from '@/studio/ui/Button';
import { PageHeader } from '@/studio/ui/PageHeader';
import { CatalogEditor } from './CatalogEditor';
import { CatalogImport } from './CatalogImport';
import { CatalogSetup } from './CatalogSetup';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.catalog.title') };
}

/**
 * The restaurant's product list: the one menu the till sells from, set up here and edited with the Studio's own content
 * services. A role without `catalog.manage` gets the 404 page.
 */
export default async function PosCatalogPage() {
  const [state, access, locale] = await Promise.all([query(posCatalogMenu, {}), getPosAccess(), requestStudioLocale()]);
  const t = getStudioTranslator(locale);
  const editor = state.chosenId === null ? null : await query(posCatalogEditor, {});
  return (
    <>
      <PageHeader
        title={t('pos.catalog.title')}
        description={t('pos.catalog.intro')}
        actions={
          // Only an owner has a Studio login for the menu; a manager's till role stops at the till.
          editor && access.actor?.viaMembership ? (
            <Link href={`/studio/menus/${editor.menuId}`} className={buttonClasses('secondary')}>
              {t('pos.catalog.open')}
            </Link>
          ) : null
        }
      />
      <div className="flex flex-col gap-8 px-8 pb-8">
        {editor ? (
          <>
            <CatalogImport />
            <CatalogEditor data={editor} />
          </>
        ) : (
          <CatalogSetup menus={state.menus} />
        )}
      </div>
    </>
  );
}
