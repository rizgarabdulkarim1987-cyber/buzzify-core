import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getPrisma } from '@/server/data/prisma';
import { DEVICE_COOKIE } from '@/server/pos/device-cookie';
import { listPinStaff, resolveDevice } from '@/server/pos/pin';
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
  const prisma = getPrisma();
  const device = await resolveDevice(prisma, (await cookies()).get(DEVICE_COOKIE)?.value);
  const t = getStudioTranslator(await requestStudioLocale());
  return (
    <main id="main" className="min-h-dvh">
      {device ? (
        <SwitchScreen deviceName={device.name} staff={await listPinStaff(prisma, device)} />
      ) : (
        <p className="mx-auto max-w-md px-4 py-8 text-base text-text">{t('pos.switch.notDevice')}</p>
      )}
    </main>
  );
}
