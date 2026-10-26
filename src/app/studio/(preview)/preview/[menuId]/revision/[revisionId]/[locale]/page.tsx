import { MenuApp } from '@/ui/menu/MenuApp';
import { TemplateMenu } from '@/ui/template/TemplateMenu';
import { loadRevisionPreview } from './load';

/** A past revision's menu page, in the template it was published with. */
export default async function RevisionPreviewPage({ params }: { params: Promise<{ menuId: string; revisionId: string; locale: string }> }) {
  const { menuId, revisionId, locale } = await params;
  const { view, tenant } = await loadRevisionPreview(menuId, revisionId, locale);
  const { design } = tenant.brand;
  if (design) return <TemplateMenu view={view} design={design} />;
  return <MenuApp view={view} />;
}
