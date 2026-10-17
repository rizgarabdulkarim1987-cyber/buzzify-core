import { MenuApp } from '@/ui/menu/MenuApp';
import { loadPreview } from './load';

/** The draft's menu page, drawn by the public menu's own component. */
export default async function PreviewPage({ params }: { params: Promise<{ menuId: string; locale: string }> }) {
  const { menuId, locale } = await params;
  const { view } = await loadPreview(menuId, locale);
  return <MenuApp view={view} />;
}
