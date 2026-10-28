import { headers } from 'next/headers';
import { notFound, permanentRedirect, redirect } from 'next/navigation';
import { loadIntro } from '@/server/data/intro';
import { resolvePublicIntro, searchString, type SearchParams } from '@/server/public-page';
import { IntroPage } from '@/ui/intro/IntroPage';
import { MenuUnavailable } from '@/ui/MenuUnavailable';

export default async function Page({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<SearchParams> }) {
  const { tenant: slug } = await params;
  const search = searchString(await searchParams);
  const resolved = await resolvePublicIntro(slug, (await headers()).get('accept-language'));

  switch (resolved.kind) {
    case 'redirect':
      return permanentRedirect(`/${resolved.slug}/intro${search}`);
    case 'off':
      // The intro is switched off (or the plan lacks it): the menu is where the guest belongs.
      return redirect(`/${resolved.slug}${search}`);
    case 'unavailable':
      return <MenuUnavailable name={resolved.name} locale={resolved.locale} />;
    case 'missing':
      return notFound();
    case 'live': {
      const { tenant, locale } = resolved.route;
      const view = await loadIntro(tenant, locale, new Date());
      if (!view) return redirect(`/${tenant.slug}${search}`);
      return <IntroPage view={view} slug={tenant.slug} name={tenant.name} locale={locale} search={search} />;
    }
  }
}
