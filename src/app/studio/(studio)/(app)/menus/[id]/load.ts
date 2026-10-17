import type { Metadata } from 'next';
import { cache } from 'react';
import { query } from '@/server/studio/framework/invoke';
import { getMenu } from '@/server/studio/queries/menus';
import { getStudioTranslator } from '@/studio/messages';
import { requestStudioLocale } from '@/studio/request-locale';
import type { WorkspaceTabKey } from '@/studio/workspace/tabs';

/**
 * The menu of the page's address, read once per request: the workspace's frame (header, bar and tabs) and the tab's own
 * page share the one answer. Something that does not exist, or that the person may not see, is the not-found page.
 */
export const loadMenu = cache((menuId: string) => query(getMenu, { menuId }));

/** The tab's title for the browser: the tab and the menu, so several open tabs can be told apart. */
export async function tabMetadata(menuId: string, tab: WorkspaceTabKey): Promise<Metadata> {
  const [t, menu] = [getStudioTranslator(await requestStudioLocale()), await loadMenu(menuId)];
  return { title: `${t(`workspace.tab.${tab}`)} · ${menu.name}` };
}
