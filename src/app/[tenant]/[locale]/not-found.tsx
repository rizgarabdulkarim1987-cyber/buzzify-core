import { headers } from 'next/headers';
import { REQUEST_PATH_HEADER } from '@/server/http/request-path';
import { backToMenuHref } from '@/server/public-page';

/**
 * Next renders this with every page of the menu (it travels in the page's payload, ready for a `notFound()`), so it
 * stays a server component with no client code: whatever it imports would be in every menu page's first scripts. The
 * link is a plain anchor for the same reason; a full load is right anyway, since the 404 may be the bare shell.
 */
export default async function NotFound() {
  const href = await backToMenuHref((await headers()).get(REQUEST_PATH_HEADER));
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="font-display text-3xl">We couldn’t find that page</h1>
      <p className="text-muted">Check the link, or go back to the menu.</p>
      <a href={href} className="mt-2 inline-flex min-h-11 w-fit items-center rounded-full bg-accent px-5 text-on-accent">
        Back to the menu
      </a>
    </main>
  );
}
