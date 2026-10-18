import { redirect } from 'next/navigation';
import { fontVariablesFor } from '@/app/fonts';
import { FONT_PAIR_IDS, type FontPairId } from '@/lib/font-pairs';
import { isTemplateId, TEMPLATES } from '@/lib/templates';
import { resolveDesign } from '@/lib/templates/resolve';
import { PreviewDesign } from '@/ui/template/PreviewDesign';
import { loadPreview } from './load';

/**
 * The draft's menu page, drawn by the public menu's own components. `?revision={id}` asks for a published revision
 * instead, which has a document of its own (its brand and fonts may differ from the draft's). `?template={id}` shows the
 * draft in another template (with the draft's overrides when it is the draft's own template), and `?template=classic`
 * without one; the Design tab also sends unsaved changes to the frame as messages.
 */
export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ menuId: string; locale: string }>;
  searchParams: Promise<{ revision?: string | string[]; template?: string | string[] }>;
}) {
  const { menuId, locale } = await params;
  const { revision, template } = await searchParams;
  if (typeof revision === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(revision)) {
    redirect(`/studio/preview/${encodeURIComponent(menuId)}/revision/${revision}/${encodeURIComponent(locale)}`);
  }
  const { view, tenant, designContext, locale: pageLocale } = await loadPreview(menuId, locale);
  const current = tenant.brand.design ?? null;
  let initial = current;
  if (template === 'classic') initial = null;
  else if (isTemplateId(template) && template !== current?.templateId) {
    initial = resolveDesign(TEMPLATES[template], {}, { details: designContext.details, poweredBy: designContext.showPoweredBy });
  }
  const fontClasses = Object.fromEntries(FONT_PAIR_IDS.map((pair) => [pair, fontVariablesFor(pageLocale, pair)])) as Record<FontPairId, string>;
  return (
    <PreviewDesign
      view={view}
      initial={initial}
      details={designContext.details}
      poweredBy={designContext.showPoweredBy}
      tagline={tenant.seo[pageLocale]?.description || undefined}
      fontClasses={fontClasses}
    />
  );
}
