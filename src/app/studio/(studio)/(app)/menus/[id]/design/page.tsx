import type { Metadata } from 'next';
import { allPairFontVariables } from '@/app/fonts';
import { query } from '@/server/studio/framework/invoke';
import * as designQueries from '@/server/studio/queries/design';
import { DesignStudio } from '@/studio/workspace/design/DesignStudio';
import { tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'design');
}

/**
 * The Design tab (spec 2026-10-18-template-studio-design.md, section 7): the template gallery, customizing the template
 * in use, saved designs, and a live preview of the menu's own products. Every font pair's faces are attached, so the
 * gallery and the type choices draw each pair in its own type (a face is fetched only once something uses it).
 */
export default async function DesignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ customize?: string }> }) {
  const { id } = await params;
  const { customize } = await searchParams;
  const state = await query(designQueries.get, { menuId: id });
  return (
    <div className={allPairFontVariables()}>
      <DesignStudio key={state.version} menuId={id} state={state} customizing={customize === '1' && state.templateId !== null} />
    </div>
  );
}
