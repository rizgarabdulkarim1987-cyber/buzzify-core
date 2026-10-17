import { redirect } from 'next/navigation';
import { MenuApp } from '@/ui/menu/MenuApp';
import { loadPreview } from './load';

/**
 * The draft's menu page, drawn by the public menu's own component. `?revision={id}` asks for a published revision
 * instead, which has a document of its own (its brand and fonts may differ from the draft's).
 */
export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ menuId: string; locale: string }>;
  searchParams: Promise<{ revision?: string | string[] }>;
}) {
  const { menuId, locale } = await params;
  const { revision } = await searchParams;
  if (typeof revision === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(revision)) {
    redirect(`/studio/preview/${encodeURIComponent(menuId)}/revision/${revision}/${encodeURIComponent(locale)}`);
  }
  const { view } = await loadPreview(menuId, locale);
  return <MenuApp view={view} />;
}
