'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FontPairId } from '@/lib/font-pairs';
import { isTemplateId, TEMPLATES } from '@/lib/templates';
import { previewMotions, type MotionSwap } from '@/lib/templates/motions';
import { parseOverrides, parseSceneMedia, resolveDesign, type RestaurantDetails } from '@/lib/templates/resolve';
import type { MenuDesign } from '@/lib/templates/types';
import type { MenuView } from '@/server/data/menu-view';
import { motionsView } from '@/server/domain/menu-motions';
import { useApp } from '@/ui/AppProviders';
import { MenuApp } from '@/ui/menu/MenuApp';
import { TemplateMenu } from './TemplateMenu';

/**
 * What the Studio's Design tab sends a preview frame: a template and overrides to show, or null for the classic menu,
 * and the background file the overrides name, resolved (the frame cannot look it up in the library itself).
 */
export interface DesignMessage {
  type: 'buzzify:design';
  templateId: string | null;
  overrides: unknown;
  media?: unknown;
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
  motionSwap,
}: {
  view: MenuView;
  initial: MenuDesign | null;
  details: RestaurantDetails;
  poweredBy: boolean;
  tagline?: string;
  fontClasses: Record<FontPairId, string>;
  motionSwap: MotionSwap;
}) {
  const [design, setDesign] = useState<MenuDesign | null>(initial);
  const { locale } = useApp();

  // Another template than the draft's shows the motions applying it would give: the designer's own, and that template's
  // suggestions in the places they leave empty (spec 2026-10-18-template-motions-design.md, section 5).
  const shown = useMemo(() => {
    const templateId = design && isTemplateId(design.templateId) ? design.templateId : null;
    if (templateId === motionSwap.templateId) return view;
    const motions = previewMotions(motionSwap, templateId, design?.palette ?? { bg: '#000000', accent: '#ffffff' });
    const guest = { locale, defaultLocale: view.restaurant.defaultLocale, logoText: motionSwap.logoText, playing: motionSwap.playing };
    return { ...view, motions: motionsView(motions, guest) };
  }, [view, design, motionSwap, locale]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<DesignMessage>) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'buzzify:design') return;
      const { templateId, overrides } = event.data;
      if (templateId === null) setDesign(null);
      else if (isTemplateId(templateId)) {
        const parsed = parseOverrides(overrides);
        const next = resolveDesign(TEMPLATES[templateId], parsed, { details, poweredBy });
        // The file is shown only as the one the overrides name, and only as safe as a snapshot would hold it.
        const media = parseSceneMedia(event.data.media);
        if (media && media.assetId === parsed.sceneAsset?.assetId) next.media = media;
        setDesign(next);
      }
    };
    window.addEventListener('message', onMessage);
    if (window.parent !== window) window.parent.postMessage({ type: 'buzzify:preview-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, [details, poweredBy]);

  if (!design) return <MenuApp view={shown} />;
  return <TemplateMenu key={design.templateId} view={shown} design={design} tagline={tagline} fontClass={fontClasses[design.type.fontPairId]} />;
}
