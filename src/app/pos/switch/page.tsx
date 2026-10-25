import type { Metadata } from 'next';
import { switchScreenData } from '@/server/pos/device-session';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import { SwitchScreen } from '@/app/pos/_ui/SwitchScreen';

export async function generateMetadata(): Promise<Metadata> {
  return { title: getStudioTranslator(await requestStudioLocale())('pos.switch.title') };
}

export const dynamic = 'force-dynamic';

/**
 * The quick sign-in screen of a registered shared device. It needs no session (that is the point of switching), only the
 * device cookie; a browser without a live one is told how to register it and shown nothing else.
 */
export default async function PosSwitchPage() {
  const data = await switchScreenData();
  const t = getStudioTranslator(await requestStudioLocale());
  return (
    <main id="main" className="min-h-dvh">
      {data ? (
        <SwitchScreen deviceName={data.deviceName} staff={data.staff} />
      ) : (
        <p className="mx-auto max-w-md px-4 py-8 text-base text-text">{t('pos.switch.notDevice')}</p>
      )}
    </main>
  );
}
