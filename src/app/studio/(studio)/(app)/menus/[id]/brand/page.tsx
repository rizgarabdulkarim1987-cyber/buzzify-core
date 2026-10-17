import type { Metadata } from 'next';
import { allPairFontVariables } from '@/app/fonts';
import { query } from '@/server/studio/framework/invoke';
import * as brandQueries from '@/server/studio/queries/brand';
import { BrandForm } from '@/studio/workspace/brand/BrandForm';
import { tabMetadata } from '../load';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'brand');
}

/**
 * The Brand tab: the menu's logos, colours, type and motion. Every font pair's faces are attached here, so each pair's
 * sample is drawn in its own type (each face is fetched only once a sample uses it).
 */
export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const kit = await query(brandQueries.get, { menuId: id });
  return (
    <div className={allPairFontVariables()}>
      <BrandForm key={kit.version} menuId={id} kit={kit} />
    </div>
  );
}
