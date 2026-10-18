'use client';

import { useEffect, useState } from 'react';
import type { FontPairId } from '@/lib/font-pairs';
import { isTemplateId, TEMPLATES } from '@/lib/templates';
import { parseOverrides, resolveDesign, type RestaurantDetails } from '@/lib/templates/resolve';
import type { MenuDesign } from '@/lib/templates/types';
import type { MenuView } from '@/server/data/menu-view';
import { MenuApp } from '@/ui/menu/MenuApp';
import { TemplateMenu } from './TemplateMenu';

/** What the Studio's Design tab sends a preview frame: a template and overrides to show, or null for the classic menu. */
export interface DesignMessage {
  type: 'buzzify:design';
  templateId: string | null;
  overrides: unknown;
}

/**
 * The Studio's preview of a menu's design. It starts with the draft's design (or a template asked for in the address)
 * and redraws at once when the Design tab sends changes that are not saved yet, so customizing needs no reload. Only
 * messages from the Studio's own origin are read, and they are parsed like stored overrides.
 */
export function PreviewDesign({
  view,
  initial,
  details,
  poweredBy,
  tagline,
  fontClasses,
}: {
  view: MenuView;
  initial: MenuDesign | null;
  details: RestaurantDetails;
  poweredBy: boolean;
  tagline?: string;
  fontClasses: Record<FontPairId, string>;
}) {
  const [design, setDesign] = useState<MenuDesign | null>(initial);

  useEffect(() => {
    const onMessage = (event: MessageEvent<DesignMessage>) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'buzzify:design') return;
      const { templateId, overrides } = event.data;
      if (templateId === null) setDesign(null);
      else if (isTemplateId(templateId)) setDesign(resolveDesign(TEMPLATES[templateId], parseOverrides(overrides), { details, poweredBy }));
    };
    window.addEventListener('message', onMessage);
    if (window.parent !== window) window.parent.postMessage({ type: 'buzzify:preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, [details, poweredBy]);

  if (!design) return <MenuApp view={view} />;
  return <TemplateMenu key={design.templateId} view={view} design={design} tagline={tagline} fontClass={fontClasses[design.type.fontPairId]} />;
}
