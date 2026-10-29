import { headers } from 'next/headers';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { loadIntro } from '@/server/data/intro';
import { resolvePublicIntro, searchString, type SearchParams } from '@/server/public-page';
import { IntroPage } from '@/ui/intro/IntroPage';
import { introTable } from '@/ui/intro/language-href';
import { MenuUnavailable } from '@/ui/MenuUnavailable';

export default async function Page({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<SearchParams> }) {
  const { tenant: slug } = await params;
  const incoming = await searchParams;
  const { table: tableParam, ...query } = incoming;
  const search = searchString(query);
  const table = introTable(tableParam);
  // Where the guest belongs when there is no intro to show: the menu, at the table the scan came from.
  const menuPath = (menuSlug: string) => `/${menuSlug}${table ? `/t/${table}` : ''}${search}`;
  const resolved = await resolvePublicIntro(slug, (await headers()).get('accept-language'));

  switch (resolved.kind) {
    case 'redirect':
      return permanentRedirect(`/${resolved.slug}/intro${searchString(incoming)}`);
    case 'off':
      // The intro is switched off (or the plan lacks it): the menu is where the guest belongs.
      return redirect(menuPath(resolved.slug));
    case 'unavailable':
      return <MenuUnavailable name={resolved.name} locale={resolved.locale} />;
    case 'missing':
      return notFound();
    case 'live': {
      const { tenant, locale } = resolved.route;
      const view = await loadIntro(tenant, locale, new Date());
      if (!view) return redirect(menuPath(tenant.slug));
      return <IntroPage view={view} slug={tenant.slug} name={tenant.name} locale={locale} search={search} table={table} />;
    }
  }
}
