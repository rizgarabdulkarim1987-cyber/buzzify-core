import { Hourglass } from 'lucide-react';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';

/** While the movement list loads: a still icon and a sentence, no spinner. */
export default async function MovementsLoading() {
  const t = getStudioTranslator(await requestStudioLocale());
  return (
    <p role="status" className="flex items-center gap-2.5 px-4 py-10 text-sm text-muted sm:px-8">
      <Hourglass aria-hidden className="size-4 shrink-0" />
      {t('pharmacy.movements.loading')}
    </p>
  );
}
