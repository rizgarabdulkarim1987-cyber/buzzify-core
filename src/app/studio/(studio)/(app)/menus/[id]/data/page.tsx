import type { Metadata } from 'next';
import { ImportExport } from '@/studio/workspace/ImportExport';
import { loadMenu, tabMetadata } from '../load';

// Reading a sheet of 2,000 rows and applying it in one transaction can take a while; the page's actions get this long.
export const maxDuration = 60;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return tabMetadata((await params).id, 'data');
}

/** The Import and export tab: the draft out as a sheet, and a sheet in, previewed before it is applied. */
export default async function DataPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const menu = await loadMenu(id);
  const permissions = new Set(menu.permissions);
  return (
    <ImportExport
      menuId={id}
      slug={menu.slug}
      currency={menu.currency}
      canImport={permissions.has('import.run')}
      canExport={permissions.has('export.run')}
      canChangeLive={permissions.has('content.availability')}
    />
  );
}
