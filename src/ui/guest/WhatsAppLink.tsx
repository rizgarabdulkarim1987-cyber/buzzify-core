'use client';

import { useApp } from '@/ui/AppProviders';
import { ChatIcon } from '@/ui/Icons';

/** The header link to chat with the restaurant on WhatsApp. Absent when the plan or the restaurant's number does not allow it. */
export function WhatsAppLink() {
  const { tenant, t, preview } = useApp();
  if (!tenant.whatsapp || preview) return null;
  return (
    <a
      href={`https://wa.me/${tenant.whatsapp}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('whatsapp.label')}
      title={t('whatsapp.label')}
      data-testid="whatsapp-link"
      className="grid min-h-11 min-w-11 place-items-center text-muted transition-colors duration-150 [@media(hover:hover)]:hover:text-text"
    >
      <ChatIcon className="size-5" />
    </a>
  );
}
