import { LifeBuoy } from 'lucide-react';
import type { Locale } from '@/lib/locale';
import { formatStamp, ltr } from '@/lib/pos-format';
import type { PhActor } from '@/server/pharmacy/actor';
import { getStudioTranslator } from '@/studio/messages';

/**
 * The strip a support actor sees on every pharmacy screen while their grant lasts: "Support mode" and when it ends. A
 * server component without motion; it renders nothing for the pharmacy's own staff (`support` null). The icon and the
 * words carry the state, never the colour alone.
 */
export function SupportBanner({ support, locale }: { support: PhActor['support']; locale: Locale }) {
  if (!support) return null;
  const t = getStudioTranslator(locale);
  return (
    <p
      role="status"
      data-testid="support-banner"
      className="flex items-center gap-2 border-b border-accent bg-accent-wash px-4 py-2 text-sm text-text"
    >
      <LifeBuoy aria-hidden size={18} className="shrink-0" />
      <strong className="font-semibold">{t('pharmacy.support.banner')}</strong>
      <span dir="auto">{t('pharmacy.support.until', { time: ltr(formatStamp(support.expiresAt)) })}</span>
    </p>
  );
}
