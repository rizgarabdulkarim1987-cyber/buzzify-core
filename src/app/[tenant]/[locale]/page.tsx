import { notFound } from 'next/navigation';
import { resolveRoute } from '@/server/route-context';
import { LanguageSwitch } from '@/ui/LanguageSwitch';

export default async function Page({ params }: { params: Promise<{ tenant: string; locale: string }> }) {
  const route = await resolveRoute(await params);
  if (!route) notFound();
  return (
    <main>
      <h1>{route.tenant.name}</h1>
      <LanguageSwitch />
    </main>
  );
}
