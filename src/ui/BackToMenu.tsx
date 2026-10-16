'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useOptionalApp } from '@/ui/AppProviders';

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The 404 page's way back. Inside a live menu that is the menu's home in the visitor's language. When the menu did
 * not render (a language it lacks, or none at all) it is the menu's entry address, `/{slug}`, which picks a language
 * the menu has; for a menu that does not exist that is a 404 again, and with no usable slug the link goes to `/`.
 */
export function BackToMenu({ className, children }: { className?: string; children: ReactNode }) {
  const app = useOptionalApp();
  const tenant = useParams<{ tenant?: string }>()?.tenant;
  const href = app ? app.href() : tenant && SLUG.test(tenant) ? `/${tenant}` : '/';
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
