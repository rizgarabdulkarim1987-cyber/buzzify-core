import { MenuApp } from '@/ui/menu/MenuApp';
import { loadRevisionPreview } from './load';

/** A past revision's menu page. */
export default async function RevisionPreviewPage({ params }: { params: Promise<{ menuId: string; revisionId: string; locale: string }> }) {
  const { menuId, revisionId, locale } = await params;
  const { view } = await loadRevisionPreview(menuId, revisionId, locale);
  return <MenuApp view={view} />;
}
