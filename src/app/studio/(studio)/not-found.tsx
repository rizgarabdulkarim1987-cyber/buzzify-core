import Link from 'next/link';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { Wordmark } from '@/studio/shell/Wordmark';
import { buttonClasses } from '@/studio/ui/Button';

/**
 * What a Studio page shows for something that does not exist or that the person may not see (`query()` answers both
 * the same way, so the page never says which).
 */
export default async function StudioNotFound() {
  const t = getStudioTranslator(await requestStudioLocale());
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center px-8">
        <Wordmark />
      </header>
      <main id="main" className="flex flex-1 flex-col justify-center px-8 pb-24">
        <div className="mx-auto flex w-full max-w-[420px] flex-col items-start gap-3">
          <p className="font-mono text-sm text-muted">404</p>
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-text">{t('common.notFoundTitle')}</h1>
          <p className="text-base text-muted">{t('common.notFoundBody')}</p>
          <Link href="/studio" className={buttonClasses('secondary', 'md', 'mt-3')}>
            {t('common.notFoundAction')}
          </Link>
        </div>
      </main>
    </div>
  );
}
